from __future__ import annotations

import asyncio
import hashlib
from io import BytesIO
from urllib.parse import quote

import httpx
import pytest
from starlette.datastructures import Headers, UploadFile

from app.config import Settings
from app.services.file_guard_client import FileGuardClient, FileGuardUnavailableError


def upload() -> UploadFile:
    return UploadFile(
        file=BytesIO(b"content"),
        filename="offer.pdf",
        headers=Headers({"content-type": "application/pdf"}),
    )


def test_client_maps_timeout_to_unavailable_and_rewinds_upload(monkeypatch) -> None:
    class TimeoutClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, *args, **kwargs):
            raise httpx.ReadTimeout("timed out")

    monkeypatch.setattr(httpx, "AsyncClient", TimeoutClient)
    file = upload()

    with pytest.raises(FileGuardUnavailableError):
        asyncio.run(FileGuardClient(Settings()).validate(file))

    assert file.file.tell() == 0


def test_client_rejects_malformed_response(monkeypatch) -> None:
    class BadResponse:
        status_code = 200

        def json(self):
            return {"valid": True}

    class BadClient:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def post(self, *args, **kwargs):
            return BadResponse()

    monkeypatch.setattr(httpx, "AsyncClient", BadClient)

    with pytest.raises(FileGuardUnavailableError):
        asyncio.run(FileGuardClient(Settings()).validate(upload()))


def test_client_decodes_cyrillic_filenames_from_file_guard_headers(monkeypatch) -> None:
    content = b"safe pdf"
    original_name = "договор.pdf"
    output_name = "договор.cleaned.pdf"

    async def fake_post(self, url, uploaded):
        return httpx.Response(
            200,
            content=content,
            headers={
                "content-type": "application/pdf",
                "X-File-Guard-Action": "sanitized",
                "X-File-Guard-Original-Name": quote(original_name, safe=""),
                "X-File-Guard-Output-Name": quote(output_name, safe=""),
                "X-File-Guard-Source-Sha256": "a" * 64,
                "X-File-Guard-Output-Sha256": hashlib.sha256(content).hexdigest(),
            },
        )

    monkeypatch.setattr(FileGuardClient, "_post", fake_post)

    result = asyncio.run(FileGuardClient(Settings()).process(upload()))

    assert result.original_name == original_name
    assert result.output_name == output_name

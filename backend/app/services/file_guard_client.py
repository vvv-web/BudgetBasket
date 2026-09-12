from __future__ import annotations

import hashlib
import logging
from io import BytesIO
from tempfile import SpooledTemporaryFile
from typing import Any
from urllib.parse import unquote

import httpx
from fastapi import HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.concurrency import run_in_threadpool

from app.config import Settings


logger = logging.getLogger(__name__)
XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class FileValidationResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)
    valid: bool
    detected_mime_type: str = Field(alias="detectedMimeType")
    size_bytes: int = Field(alias="sizeBytes")
    reason_code: str | None = Field(alias="reasonCode")
    message: str | None
    warnings: list[str] = Field(default_factory=list)


class ProcessedFile(BaseModel):
    content: bytes = b""
    content_stream: Any = Field(default=None, exclude=True)
    original_name: str
    output_name: str
    source_mime_type: str
    output_mime_type: str
    source_size_bytes: int
    output_size_bytes: int
    source_sha256: str
    output_sha256: str
    sanitized: bool
    removed_components: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)

    def open_content(self):
        stream = self.content_stream if self.content_stream is not None else BytesIO(self.content)
        stream.seek(0)
        return stream

    def close(self):
        if self.content_stream is not None:
            self.content_stream.close()


class FileGuardUnavailableError(RuntimeError):
    pass


class FileGuardRejectedError(RuntimeError):
    pass


class FileGuardClient:
    def __init__(self, settings: Settings):
        self.validate_url = f"{settings.file_guard_url}/internal/files/validate"
        self.process_url = f"{settings.file_guard_url}/internal/files/process"
        self.timeout = httpx.Timeout(connect=settings.file_guard_connect_timeout_seconds, read=settings.file_guard_read_timeout_seconds, write=settings.file_guard_read_timeout_seconds, pool=settings.file_guard_connect_timeout_seconds)
        self.allowed_mime_types = set(settings.allowed_upload_mime_types)
        self.max_size_bytes = settings.max_upload_file_size_mb * 1024 * 1024

    async def validate(self, upload: UploadFile) -> FileValidationResult:
        response = await self._post(self.validate_url, upload)
        if response.status_code != 200:
            raise FileGuardUnavailableError
        try:
            return FileValidationResult.model_validate(response.json())
        except (ValueError, ValidationError) as exc:
            raise FileGuardUnavailableError from exc

    async def process(self, upload: UploadFile) -> ProcessedFile:
        response = await self._post(self.process_url, upload)
        if response.status_code == 503:
            raise FileGuardUnavailableError
        if response.status_code != 200:
            message = "не прошёл проверку безопасности."
            try:
                message = FileValidationResult.model_validate(response.json()).message or message
            except (ValueError, ValidationError):
                pass
            raise FileGuardRejectedError(message)
        headers = response.headers
        stream = response.extensions.get("processed_stream")
        try:
            output_name = _header_filename(_required_header(headers, "X-File-Guard-Output-Name"))
            output_sha256 = _required_header(headers, "X-File-Guard-Output-Sha256").lower()
            source_sha256 = _required_header(headers, "X-File-Guard-Source-Sha256").lower()
            output_mime = headers.get("content-type", "").split(";", 1)[0].lower()
            action = _required_header(headers, "X-File-Guard-Action")
            content = b"" if stream is not None else response.content
            size = response.extensions.get("processed_size", len(content))
            digest = response.extensions.get("processed_sha256") if stream is not None else hashlib.sha256(content).hexdigest()
            if action not in {"accepted", "sanitized"} or not size or output_mime not in self.allowed_mime_types:
                raise ValueError("unexpected response")
            if len(output_sha256) != 64 or len(source_sha256) != 64 or digest != output_sha256:
                raise ValueError("invalid output digest")
            if size > self.max_size_bytes:
                raise ValueError("output too large")
            return ProcessedFile(
                content=content,
                content_stream=stream,
                original_name=_header_filename(headers.get("X-File-Guard-Original-Name", upload.filename or "file")),
                output_name=output_name,
                source_mime_type=headers.get("X-File-Guard-Source-Mime", upload.content_type or "application/octet-stream"), output_mime_type=output_mime,
                source_size_bytes=0, output_size_bytes=size, source_sha256=source_sha256, output_sha256=output_sha256,
                sanitized=action == "sanitized", removed_components=_csv_header(headers, "X-File-Guard-Removed"), warnings=_csv_header(headers, "X-File-Guard-Warnings"),
            )
        except (ValueError, ValidationError) as exc:
            if stream is not None:
                stream.close()
            logger.error("file_guard вернул некорректный результат обработки")
            raise FileGuardUnavailableError from exc

    async def _post(self, url: str, upload: UploadFile) -> httpx.Response:
        await upload.seek(0)
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                if url == self.process_url:
                    spool = SpooledTemporaryFile(max_size=1024 * 1024, mode="w+b")
                    try:
                        async with client.stream("POST", url, files={"file": (upload.filename or "file", upload.file, upload.content_type or "application/octet-stream")}) as response:
                            digest = hashlib.sha256()
                            size = 0
                            async for chunk in response.aiter_bytes(chunk_size=64 * 1024):
                                size += len(chunk)
                                if size > (self.max_size_bytes if response.status_code == 200 else 64 * 1024):
                                    raise FileGuardUnavailableError("file_guard response exceeds limit")
                                digest.update(chunk)
                                await run_in_threadpool(spool.write, chunk)
                            spool.seek(0)
                            if response.status_code != 200:
                                body = spool.read()
                                spool.close()
                                return httpx.Response(response.status_code, headers=response.headers, content=body)
                            response.extensions.update(processed_stream=spool, processed_size=size, processed_sha256=digest.hexdigest())
                            return response
                    except BaseException:
                        spool.close()
                        raise
                return await client.post(url, files={"file": (upload.filename or "file", upload.file, upload.content_type or "application/octet-stream")})
        except httpx.TransportError as exc:
            logger.warning("file_guard недоступен: error_type=%s", type(exc).__name__)
            raise FileGuardUnavailableError from exc
        finally:
            await upload.seek(0)


def _required_header(headers: httpx.Headers, name: str) -> str:
    value = headers.get(name)
    if not value:
        raise ValueError(f"Missing {name}")
    return value


def _header_filename(value: str) -> str:
    """Decode RFC 3986-encoded file names received from file_guard."""
    return unquote(value)


def _csv_header(headers: httpx.Headers, name: str) -> list[str]:
    return [item for item in (headers.get(name) or "").split(",") if item]


async def require_processed_file(client: FileGuardClient, upload: UploadFile) -> ProcessedFile:
    file_name = upload.filename or "файл без имени"
    try:
        return await client.process(upload)
    except FileGuardRejectedError as exc:
        raise HTTPException(status_code=400, detail=f"Файл «{file_name}»: {exc}") from exc
    except FileGuardUnavailableError as exc:
        raise HTTPException(status_code=503, detail=f"Файл «{file_name}»: проверка файлов временно недоступна. Повторите попытку позже.") from exc


async def require_valid_file(client: FileGuardClient, upload: UploadFile) -> FileValidationResult:
    """Compatibility helper for callers that only need the legacy endpoint."""
    result = await client.validate(upload)
    if not result.valid:
        raise HTTPException(status_code=400, detail=f"Файл «{upload.filename or 'файл без имени'}»: {result.message or 'не прошёл проверку безопасности.'}")
    return result

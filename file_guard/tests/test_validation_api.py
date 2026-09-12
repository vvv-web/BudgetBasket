from __future__ import annotations

import io
import os
import struct
import zipfile
import zlib
from dataclasses import replace

from openpyxl import Workbook, load_workbook

from fastapi.testclient import TestClient

os.environ.setdefault("FILE_GUARD_ANTIVIRUS_ENABLED", "false")

from file_guard.app import config as config_module
from file_guard.app import main as main_module
from file_guard.app import office_security as office_security_module
from file_guard.app import scanner as scanner_module
from file_guard.app.scanner import FileScanner


client = TestClient(main_module.app)
VALIDATE_URL = "/internal/files/validate"
PROCESS_URL = "/internal/files/process"


class ReadyAntivirus:
    def is_ready(self) -> bool:
        return True

    def scan_bytes(self, *, content_bytes: bytes):
        return type("Result", (), {"infected": False, "signature": None})()


class MalwareAntivirus(ReadyAntivirus):
    def scan_bytes(self, *, content_bytes: bytes):
        return type("Result", (), {"infected": True, "signature": "Test-Signature"})()


class UnavailableAntivirus:
    def is_ready(self) -> bool:
        return False

    def scan_bytes(self, *, content_bytes: bytes):
        raise scanner_module.AntivirusUnavailableError("clamd unavailable")


def valid_pdf() -> bytes:
    return (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 100 100]>>endobj\n"
        b"xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n0000000052 00000 n \n0000000101 00000 n \n"
        b"trailer<</Size 4/Root 1 0 R>>\nstartxref\n168\n%%EOF"
    )


def office_bytes(*entries: tuple[str, bytes | str]) -> bytes:
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", "<Types></Types>")
        for name, value in entries:
            archive.writestr(name, value)
    return payload.getvalue()


def png_bytes() -> bytes:
    def chunk(kind: bytes, payload: bytes) -> bytes:
        return len(payload).to_bytes(4, "big") + kind + payload + zlib.crc32(kind + payload).to_bytes(4, "big")

    raw = zlib.compress(b"\x00\xff\x00\x00")
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", raw)
        + chunk(b"IEND", b"")
    )


def patch_scanner(monkeypatch, *, antivirus=None, **overrides) -> None:
    if overrides:
        patched = replace(scanner_module.settings, **overrides)
        monkeypatch.setattr(config_module, "settings", patched)
        monkeypatch.setattr(scanner_module, "settings", patched)
        monkeypatch.setattr(office_security_module, "settings", patched)
        monkeypatch.setattr(main_module, "settings", patched)
    monkeypatch.setattr(main_module, "_scanner", FileScanner(antivirus_scanner=antivirus or ReadyAntivirus()))


def test_valid_pdf_contract(monkeypatch) -> None:
    patch_scanner(monkeypatch)
    response = client.post(VALIDATE_URL, files={"file": ("ok.pdf", valid_pdf(), "application/pdf")})

    assert response.status_code == 200
    assert response.json() == {
        "valid": True,
        "detectedMimeType": "application/pdf",
        "sizeBytes": len(valid_pdf()),
        "reasonCode": None,
        "message": None,
        "warnings": [],
    }


def test_empty_file_is_rejected(monkeypatch) -> None:
    patch_scanner(monkeypatch)
    response = client.post(VALIDATE_URL, files={"file": ("empty.pdf", b"", "application/pdf")})
    assert response.json()["reasonCode"] == "EMPTY_FILE"


def test_size_limit_is_enforced_during_chunked_read(monkeypatch) -> None:
    patch_scanner(monkeypatch, max_file_size_bytes=1024, upload_read_chunk_bytes=256)
    response = client.post(VALIDATE_URL, files={"file": ("large.pdf", b"x" * 2048, "application/pdf")})
    assert response.json()["reasonCode"] == "FILE_TOO_LARGE"
    assert response.json()["sizeBytes"] > 1024


def test_forbidden_executable_is_rejected(monkeypatch) -> None:
    patch_scanner(monkeypatch)
    response = client.post(VALIDATE_URL, files={"file": ("bad.exe", b"MZ", "application/octet-stream")})
    assert response.json()["reasonCode"] == "FILE_TYPE_NOT_ALLOWED"


def test_double_extension_is_rejected(monkeypatch) -> None:
    patch_scanner(monkeypatch)
    response = client.post(VALIDATE_URL, files={"file": ("report.pdf.exe", valid_pdf(), "application/pdf")})
    assert response.json()["reasonCode"] == "FILE_TYPE_NOT_ALLOWED"


def test_content_extension_mismatch_is_rejected(monkeypatch) -> None:
    patch_scanner(monkeypatch)
    response = client.post(VALIDATE_URL, files={"file": ("wrong.pdf", png_bytes(), "application/pdf")})
    assert response.json()["reasonCode"] == "MIME_MISMATCH"


def test_claimed_mime_mismatch_is_rejected(monkeypatch) -> None:
    patch_scanner(monkeypatch)
    response = client.post(VALIDATE_URL, files={"file": ("ok.pdf", valid_pdf(), "image/png")})
    assert response.json()["reasonCode"] == "MIME_MISMATCH"


def test_corrupt_supported_file_is_rejected(monkeypatch) -> None:
    patch_scanner(monkeypatch)
    response = client.post(VALIDATE_URL, files={"file": ("broken.pdf", b"%PDF-1.4 broken", "application/pdf")})
    assert response.json()["reasonCode"] == "INVALID_PDF"


def test_standalone_archives_are_allowed(monkeypatch) -> None:
    patch_scanner(monkeypatch)
    response = client.post(VALIDATE_URL, files={"file": ("archive.zip", office_bytes(("x", "y")), "application/zip")})
    assert response.json()["valid"] is True
    assert response.json()["detectedMimeType"] == "application/zip"

    windows_mime_response = client.post(
        VALIDATE_URL,
        files={"file": ("archive.zip", office_bytes(("x", "y")), "application/x-zip-compressed")},
    )
    assert windows_mime_response.json()["valid"] is True


def test_zip_is_detected_when_libmagic_returns_generic_binary(monkeypatch) -> None:
    class GenericBinaryMagic:
        @staticmethod
        def from_buffer(*_args, **_kwargs) -> str:
            return "application/octet-stream"

    monkeypatch.setattr(scanner_module, "magic_lib", GenericBinaryMagic())
    patch_scanner(monkeypatch)
    response = client.post(VALIDATE_URL, files={"file": ("archive.zip", office_bytes(("x", "y")), "application/zip")})

    assert response.json()["valid"] is True
    assert response.json()["detectedMimeType"] == "application/zip"


def test_unsafe_or_corrupted_archives_are_rejected(monkeypatch) -> None:
    patch_scanner(monkeypatch)
    unsafe = client.post(
        VALIDATE_URL,
        files={"file": ("unsafe.zip", office_bytes(("../evil.txt", "x")), "application/zip")},
    )
    corrupted = client.post(
        VALIDATE_URL,
        files={"file": ("broken.zip", b"PK\x03\x04broken", "application/zip")},
    )
    assert unsafe.json()["reasonCode"] == "INVALID_ARCHIVE"
    assert corrupted.json()["reasonCode"] == "INVALID_ARCHIVE"


def test_office_zip_slip_and_macro_payloads_are_rejected(monkeypatch) -> None:
    patch_scanner(monkeypatch)
    slip = client.post(
        VALIDATE_URL,
        files={"file": ("slip.docx", office_bytes(("word/document.xml", "<xml />"), ("../evil.exe", b"x")), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    macro = client.post(
        VALIDATE_URL,
        files={"file": ("macro.xlsx", office_bytes(("xl/workbook.xml", "<xml />"), ("xl/vbaProject.bin", b"x")), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert slip.json()["reasonCode"] == "INVALID_OFFICE_DOCUMENT"
    # Active spreadsheet parts are accepted by the preliminary bounded ZIP
    # check and removed only by the /process sanitizer.
    assert macro.json()["valid"] is True


def test_office_zip_bomb_limit_is_enforced(monkeypatch) -> None:
    patch_scanner(monkeypatch, office_max_compression_ratio=5.0)
    response = client.post(
        VALIDATE_URL,
        files={"file": ("bomb.docx", office_bytes(("word/document.xml", "A" * 5000)), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
    )
    assert response.json()["reasonCode"] == "INVALID_OFFICE_DOCUMENT"


def test_antivirus_detection_and_unavailability_fail_closed(monkeypatch) -> None:
    patch_scanner(monkeypatch, antivirus=MalwareAntivirus(), antivirus_enabled=True)
    infected = client.post(VALIDATE_URL, files={"file": ("infected.pdf", valid_pdf(), "application/pdf")})
    assert infected.json()["reasonCode"] == "MALWARE_DETECTED"

    patch_scanner(monkeypatch, antivirus=UnavailableAntivirus(), antivirus_enabled=True)
    unavailable = client.post(VALIDATE_URL, files={"file": ("file.pdf", valid_pdf(), "application/pdf")})
    assert unavailable.status_code == 503
    assert unavailable.json()["reasonCode"] == "VALIDATION_UNAVAILABLE"


def test_internal_error_is_safe(monkeypatch) -> None:
    class BrokenScanner:
        def scan_bytes(self, **kwargs):
            raise RuntimeError("secret command and path")

    monkeypatch.setattr(main_module, "_scanner", BrokenScanner())
    response = client.post(VALIDATE_URL, files={"file": ("file.pdf", valid_pdf(), "application/pdf")})
    assert response.status_code == 500
    assert response.json()["reasonCode"] == "INTERNAL_ERROR"
    assert "secret" not in response.text


def test_health_and_readiness(monkeypatch) -> None:
    patch_scanner(monkeypatch)
    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/ready").status_code == 200

    patch_scanner(monkeypatch, antivirus=UnavailableAntivirus(), antivirus_enabled=True)
    assert client.get("/health").status_code == 200
    assert client.get("/ready").status_code == 503


def test_process_rebuilds_excel_without_executable_formulas(monkeypatch) -> None:
    patch_scanner(monkeypatch)
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = "Данные"
    sheet["A1"] = "значение"
    sheet["B1"] = '=HYPERLINK("https://example.test", "Внешняя ссылка")'
    sheet["A2"].hyperlink = "https://example.test"
    source = io.BytesIO()
    workbook.save(source)

    response = client.post(PROCESS_URL, files={"file": ("budget.xlsx", source.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")})

    assert response.status_code == 200
    assert response.headers["x-file-guard-action"] == "sanitized"
    assert response.headers["x-file-guard-output-name"] == "budget.cleaned.xlsx"
    assert response.content != source.getvalue()
    sanitized = load_workbook(io.BytesIO(response.content), data_only=False)
    assert sanitized["Данные"]["A1"].value == "значение"
    assert sanitized["Данные"]["B1"].data_type != "f"
    assert sanitized["Данные"]["B1"].value == "Внешняя ссылка"
    assert sanitized["Данные"]["A2"].hyperlink is None


def test_process_accepts_cyrillic_filename_and_encodes_response_headers(monkeypatch) -> None:
    patch_scanner(monkeypatch)

    response = client.post(
        PROCESS_URL,
        files={"file": ("договор на услуги.pdf", valid_pdf(), "application/pdf")},
    )

    assert response.status_code == 200
    assert response.headers["x-file-guard-original-name"] == "%D0%B4%D0%BE%D0%B3%D0%BE%D0%B2%D0%BE%D1%80%20%D0%BD%D0%B0%20%D1%83%D1%81%D0%BB%D1%83%D0%B3%D0%B8.pdf"
    assert response.headers["x-file-guard-output-name"] == response.headers["x-file-guard-original-name"]
    assert "filename*=UTF-8''%D0%B4" in response.headers["content-disposition"]

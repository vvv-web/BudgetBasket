from __future__ import annotations

import asyncio
import logging
from urllib.parse import quote

from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse, Response

from .config import settings
from .scanner import FileScanner, ScanUnavailableError
from .schemas import ValidationResponse


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="BudgetBasket file_guard", version="1.0.0", docs_url=None, redoc_url=None)
_scanner = FileScanner()

_REASON_MESSAGES = {
    "EMPTY_FILE": "Пустые файлы не допускаются.",
    "FILE_TOO_LARGE": "Размер файла превышает допустимый лимит.",
    "FILE_TYPE_NOT_ALLOWED": "Формат файла не поддерживается.",
    "MIME_MISMATCH": "Тип содержимого файла не соответствует его расширению.",
    "UNSAFE_FILE_NAME": "Имя файла содержит недопустимые элементы.",
    "INVALID_PDF": "PDF-файл повреждён, нечитаем или содержит активное содержимое.",
    "ENCRYPTED_PDF_NOT_ALLOWED": "Зашифрованные PDF-файлы не поддерживаются.",
    "INVALID_OFFICE_DOCUMENT": "Документ Office повреждён, нечитаем или содержит опасное содержимое.",
    "INVALID_IMAGE": "Изображение повреждено, нечитаемо или превышает допустимые размеры.",
    "MALWARE_DETECTED": "Файл отклонён антивирусной проверкой.",
    "VALIDATION_UNAVAILABLE": "Проверка файлов временно недоступна.",
    "INTERNAL_ERROR": "Не удалось безопасно проверить файл.",
    "EXCEL_SANITIZATION_FAILED": "Не удалось безопасно обработать Excel-файл.",
    "EXCEL_LIMIT_EXCEEDED": "Excel-файл превышает допустимые ограничения для просмотра.",
    "ENCRYPTED_EXCEL_NOT_ALLOWED": "Зашифрованные Excel-файлы не поддерживаются.",
    "UNSUPPORTED_EXCEL_FORMAT": "Старый формат Excel .xls не поддерживается. Сохраните файл как .xlsx.",
    "SANITIZED_FILE_INVALID": "Не удалось подтвердить безопасность обработанного Excel-файла.",
}


def _header_filename(name: str) -> str:
    """Encode a UTF-8 filename for an HTTP header, which must be ASCII/Latin-1."""
    return quote(name, safe="")


def _response(
    *, valid: bool, detected_mime: str = "application/octet-stream", size_bytes: int = 0,
    reason_code: str | None = None,
) -> ValidationResponse:
    stable_code = reason_code.upper() if reason_code else None
    return ValidationResponse(
        valid=valid,
        detectedMimeType=detected_mime,
        sizeBytes=size_bytes,
        reasonCode=stable_code,
        message=(
            _REASON_MESSAGES.get(stable_code, "Файл не прошёл проверку безопасности.")
            if stable_code
            else None
        ),
        warnings=[],
    )


def _unavailable(status_code: int, reason_code: str) -> JSONResponse:
    payload = _response(valid=False, reason_code=reason_code)
    return JSONResponse(status_code=status_code, content=payload.model_dump(by_alias=True))


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
async def ready() -> JSONResponse:
    if settings.require_antivirus and not settings.antivirus_enabled:
        return JSONResponse(status_code=503, content={"status": "not_ready", "reasonCode": "VALIDATION_UNAVAILABLE"})
    if settings.antivirus_enabled and not _scanner.is_ready():
        return JSONResponse(status_code=503, content={"status": "not_ready", "reasonCode": "VALIDATION_UNAVAILABLE"})
    return JSONResponse(
        status_code=200,
        content={"status": "ready", "antivirus": "enabled" if settings.antivirus_enabled else "disabled"},
    )


async def _read_upload_bytes(file: UploadFile) -> tuple[bytes, bool]:
    content = bytearray()
    while chunk := await file.read(settings.upload_read_chunk_bytes):
        content.extend(chunk)
        if len(content) > settings.max_file_size_bytes:
            return bytes(content), True
    return bytes(content), False


@app.post("/internal/files/validate", response_model=ValidationResponse, response_model_by_alias=True)
async def validate_file(file: UploadFile = File(...)) -> ValidationResponse | JSONResponse:
    content_bytes, exceeded_limit = await _read_upload_bytes(file)
    if exceeded_limit:
        return _response(valid=False, size_bytes=len(content_bytes), reason_code="FILE_TOO_LARGE")
    if settings.require_antivirus and not settings.antivirus_enabled:
        return _unavailable(503, "VALIDATION_UNAVAILABLE")
    try:
        verdict = await asyncio.wait_for(
            asyncio.to_thread(
                _scanner.scan_bytes,
                original_name=file.filename or "",
                content_bytes=content_bytes,
                claimed_mime_type=file.content_type,
            ),
            timeout=settings.scan_timeout_seconds,
        )
    except (TimeoutError, ScanUnavailableError):
        logger.exception("Проверка файла временно недоступна")
        return _unavailable(503, "VALIDATION_UNAVAILABLE")
    except Exception:
        logger.exception("Внутренняя ошибка проверки файла")
        return _unavailable(500, "INTERNAL_ERROR")
    return _response(
        valid=verdict.allowed,
        detected_mime=verdict.detected_mime,
        size_bytes=verdict.size_bytes,
        reason_code=verdict.reason_code,
    )


@app.post("/internal/files/process", response_model=None)
async def process_file(file: UploadFile = File(...)) -> Response:
    """Return the exact safe bytes the backend is allowed to persist."""
    content_bytes, exceeded_limit = await _read_upload_bytes(file)
    if exceeded_limit:
        return JSONResponse(status_code=400, content=_response(valid=False, size_bytes=len(content_bytes), reason_code="FILE_TOO_LARGE").model_dump(by_alias=True))
    if (file.filename or "").lower().endswith(".xls"):
        return JSONResponse(status_code=400, content=_response(valid=False, reason_code="UNSUPPORTED_EXCEL_FORMAT").model_dump(by_alias=True))
    if settings.require_antivirus and not settings.antivirus_enabled:
        return _unavailable(503, "VALIDATION_UNAVAILABLE")
    try:
        processed = await asyncio.wait_for(
            asyncio.to_thread(_scanner.process_bytes, original_name=file.filename or "", content_bytes=content_bytes, claimed_mime_type=file.content_type),
            timeout=settings.scan_timeout_seconds,
        )
    except (TimeoutError, ScanUnavailableError):
        logger.exception("Обработка файла временно недоступна")
        return _unavailable(503, "VALIDATION_UNAVAILABLE")
    except ValueError as exc:
        reason = str(exc).upper()
        if reason not in _REASON_MESSAGES:
            reason = "EXCEL_SANITIZATION_FAILED"
        return JSONResponse(status_code=400, content=_response(valid=False, reason_code=reason).model_dump(by_alias=True))
    except Exception:
        logger.exception("Внутренняя ошибка обработки файла")
        return _unavailable(500, "INTERNAL_ERROR")

    output_name_header = _header_filename(processed.output_name)
    original_name_header = _header_filename(processed.original_name)
    headers = {
        "Content-Disposition": f"attachment; filename=\"download\"; filename*=UTF-8''{output_name_header}",
        "X-File-Guard-Action": "sanitized" if processed.sanitized else "accepted",
        "X-File-Guard-Original-Name": original_name_header,
        "X-File-Guard-Output-Name": output_name_header,
        "X-File-Guard-Source-Sha256": processed.source_sha256,
        "X-File-Guard-Output-Sha256": processed.output_sha256,
        "X-File-Guard-Source-Mime": processed.source_mime_type,
        "X-File-Guard-Removed": ",".join(processed.removed_components),
        "X-File-Guard-Warnings": ",".join(processed.warnings),
    }
    return Response(content=processed.content, media_type=processed.output_mime_type, headers=headers)

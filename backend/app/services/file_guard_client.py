from __future__ import annotations

import logging

import httpx
from fastapi import HTTPException, UploadFile
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from app.config import Settings


logger = logging.getLogger(__name__)


class FileValidationResult(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    valid: bool
    detected_mime_type: str = Field(alias="detectedMimeType")
    size_bytes: int = Field(alias="sizeBytes")
    reason_code: str | None = Field(alias="reasonCode")
    message: str | None
    warnings: list[str] = Field(default_factory=list)


class FileGuardUnavailableError(RuntimeError):
    pass


class FileGuardClient:
    def __init__(self, settings: Settings):
        self.url = f"{settings.file_guard_url}/internal/files/validate"
        self.timeout = httpx.Timeout(
            connect=settings.file_guard_connect_timeout_seconds,
            read=settings.file_guard_read_timeout_seconds,
            write=settings.file_guard_read_timeout_seconds,
            pool=settings.file_guard_connect_timeout_seconds,
        )

    async def validate(self, upload: UploadFile) -> FileValidationResult:
        await upload.seek(0)
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    self.url,
                    files={
                        "file": (
                            upload.filename or "file",
                            upload.file,
                            upload.content_type or "application/octet-stream",
                        )
                    },
                )
        except (httpx.TimeoutException, httpx.NetworkError) as exc:
            logger.warning("file_guard недоступен: error_type=%s", type(exc).__name__)
            raise FileGuardUnavailableError from exc
        finally:
            await upload.seek(0)

        if response.status_code != 200:
            logger.warning("file_guard вернул ошибку: status_code=%s", response.status_code)
            raise FileGuardUnavailableError
        try:
            return FileValidationResult.model_validate(response.json())
        except (ValueError, ValidationError) as exc:
            logger.error("file_guard вернул некорректный ответ")
            raise FileGuardUnavailableError from exc


async def require_valid_file(client: FileGuardClient, upload: UploadFile) -> FileValidationResult:
    file_name = upload.filename or "файл без имени"
    try:
        result = await client.validate(upload)
    except FileGuardUnavailableError as exc:
        raise HTTPException(
            status_code=503,
            detail=f"Файл «{file_name}»: проверка файлов временно недоступна. Повторите попытку позже.",
        ) from exc
    if not result.valid:
        raise HTTPException(
            status_code=400,
            detail=f"Файл «{file_name}»: {result.message or 'не прошёл проверку безопасности.'}",
        )
    return result

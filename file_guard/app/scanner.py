from __future__ import annotations

import hashlib
import io
import logging
import unicodedata
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from .antivirus import AntivirusUnavailableError, ClamAVScanner, DisabledAntivirusScanner
from .config import settings
from .office_security import validate_office_archive
from .excel_sanitizer import ExcelSanitizationError, XLSX_MIME, sanitize_excel
from .schemas import ProcessedFile

logger = logging.getLogger(__name__)

try:
    import magic as magic_lib
except Exception:  # pragma: no cover - optional dependency
    magic_lib = None

try:
    from pypdf import PdfReader
except Exception:  # pragma: no cover - optional dependency
    PdfReader = None

try:
    from PIL import Image, UnidentifiedImageError

    try:
        from PIL import DecompressionBombError
    except Exception:  # pragma: no cover - optional dependency
        DecompressionBombError = ValueError
except Exception:  # pragma: no cover - optional dependency
    Image = None
    UnidentifiedImageError = Exception
    DecompressionBombError = ValueError

_DANGEROUS_EXTENSIONS = frozenset(
    {
        ".exe",
        ".dll",
        ".msi",
        ".bat",
        ".cmd",
        ".ps1",
        ".sh",
        ".js",
        ".html",
        ".htm",
        ".php",
        ".py",
        ".jar",
        ".war",
        ".apk",
        ".scr",
        ".com",
        ".svg",
        ".docm",
        ".pptm",
        ".rar",
        ".7z",
        ".tar",
        ".gz",
    }
)
_EXPECTED_MIME_BY_EXTENSION = {
    ".pdf": {"application/pdf"},
    ".docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
    ".xlsx": {"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"},
    ".xlsm": {"application/vnd.ms-excel.sheet.macroenabled.12"},
    ".zip": {"application/zip"},
    ".jpg": {"image/jpeg"},
    ".jpeg": {"image/jpeg"},
    ".png": {"image/png"},
}
_SUSPICIOUS_PDF_TOKENS = (
    b"/JavaScript",
    b"/JS",
    b"/OpenAction",
    b"/AA",
    b"/Launch",
    b"/EmbeddedFile",
    b"/RichMedia",
    b"/XFA",
)


class ScanUnavailableError(RuntimeError):
    """Raised when the scan engine cannot complete mandatory checks."""


@dataclass(frozen=True, slots=True)
class ScanVerdict:
    allowed: bool
    reason_code: str | None
    message: str
    detected_mime: str
    size_bytes: int
    sha256: str


class FileScanner:
    def __init__(self, *, antivirus_scanner=None) -> None:
        self._antivirus_scanner = antivirus_scanner or self._build_antivirus_scanner()

    def is_ready(self) -> bool:
        probe_readiness = getattr(self._antivirus_scanner, "probe_readiness", None)
        if callable(probe_readiness):
            return bool(probe_readiness())
        return bool(self._antivirus_scanner.is_ready())

    def scan_bytes(
        self,
        *,
        original_name: str,
        content_bytes: bytes,
        claimed_mime_type: str | None = None,
    ) -> ScanVerdict:
        size_bytes = len(content_bytes)
        sha256 = hashlib.sha256(content_bytes).hexdigest()
        logger.info(
            "Получен файл для проверки: filename=%s size_bytes=%s sha256_prefix=%s",
            original_name,
            size_bytes,
            _hash_prefix(sha256),
        )

        try:
            safe_name = self._normalize_filename(original_name)
            extension = Path(safe_name).suffix.lower()
            detected_mime = self._detect_mime(content_bytes=content_bytes)
            verdict = self._scan_validated_content(
                original_name=original_name,
                safe_name=safe_name,
                extension=extension,
                detected_mime=detected_mime,
                content_bytes=content_bytes,
                size_bytes=size_bytes,
                sha256=sha256,
                claimed_mime_type=(claimed_mime_type or "").split(";", 1)[0].strip().lower() or None,
            )
        except ScanUnavailableError:
            logger.exception(
                "Проверка файла не может быть завершена из-за недоступности обязательной зависимости: filename=%s size_bytes=%s sha256_prefix=%s",
                original_name,
                size_bytes,
                _hash_prefix(sha256),
            )
            raise
        except ValueError as exc:
            return self._blocked(
                original_name=original_name,
                normalized_name=None,
                extension=None,
                reason_code="unsafe_file_name",
                message=str(exc),
                detected_mime=self._best_effort_detect_mime(content_bytes=content_bytes),
                size_bytes=size_bytes,
                sha256=sha256,
            )

        logger.info(
            "Проверка файла завершена успешно: filename=%s extension=%s detected_mime=%s size_bytes=%s sha256_prefix=%s",
            safe_name,
            extension,
            detected_mime,
            size_bytes,
            _hash_prefix(sha256),
        )
        return verdict

    def process_bytes(
        self,
        *,
        original_name: str,
        content_bytes: bytes,
        claimed_mime_type: str | None = None,
    ) -> ProcessedFile:
        """Validate source bytes and return only bytes approved for storage."""
        source_verdict = self.scan_bytes(
            original_name=original_name,
            content_bytes=content_bytes,
            claimed_mime_type=claimed_mime_type,
        )
        if not source_verdict.allowed:
            raise ValueError(source_verdict.reason_code or "invalid_office_document")
        safe_name = self._normalize_filename(original_name)
        extension = Path(safe_name).suffix.lower()
        if extension not in {".xlsx", ".xlsm"}:
            return ProcessedFile(
                content=content_bytes, original_name=safe_name, output_name=safe_name,
                source_mime_type=source_verdict.detected_mime, output_mime_type=source_verdict.detected_mime,
                source_size_bytes=len(content_bytes), output_size_bytes=len(content_bytes),
                source_sha256=source_verdict.sha256, output_sha256=source_verdict.sha256,
                sanitized=False, removed_components=(), warnings=(),
            )
        if not settings.excel_sanitization_enabled:
            raise ValueError("excel_sanitization_failed")
        try:
            sanitized = sanitize_excel(content_bytes)
        except ExcelSanitizationError as exc:
            message = str(exc).lower()
            if "encrypted" in message:
                raise ValueError("encrypted_excel_not_allowed") from exc
            if "limit" in message or "too large" in message or "exceeds" in message:
                raise ValueError("excel_limit_exceeded") from exc
            raise ValueError("excel_sanitization_failed") from exc
        output_name = f"{Path(safe_name).stem}.cleaned.xlsx"
        # Re-run all structural and AV checks against the bytes that will be stored.
        output_verdict = self.scan_bytes(
            original_name=output_name, content_bytes=sanitized.content, claimed_mime_type=XLSX_MIME,
        )
        if not output_verdict.allowed:
            raise ValueError("sanitized_file_invalid")
        return ProcessedFile(
            content=sanitized.content, original_name=safe_name, output_name=output_name,
            source_mime_type=source_verdict.detected_mime, output_mime_type=XLSX_MIME,
            source_size_bytes=len(content_bytes), output_size_bytes=len(sanitized.content),
            source_sha256=source_verdict.sha256, output_sha256=output_verdict.sha256,
            sanitized=True, removed_components=sanitized.removed_components, warnings=sanitized.warnings,
        )

    def _scan_validated_content(
        self,
        *,
        original_name: str,
        safe_name: str,
        extension: str,
        detected_mime: str,
        content_bytes: bytes,
        size_bytes: int,
        sha256: str,
        claimed_mime_type: str | None,
    ) -> ScanVerdict:
        logger.info(
            "Имя файла нормализовано: original_name=%s normalized_name=%s extension=%s",
            original_name,
            safe_name,
            extension,
        )
        logger.info(
            "Определен MIME-тип файла: filename=%s extension=%s detected_mime=%s",
            safe_name,
            extension,
            detected_mime,
        )

        if extension in _DANGEROUS_EXTENSIONS or extension not in settings.allowed_extensions:
            return self._blocked(
                original_name=original_name,
                normalized_name=safe_name,
                extension=extension,
                reason_code="file_type_not_allowed",
                message="File extension is not allowed",
                detected_mime=detected_mime,
                size_bytes=size_bytes,
                sha256=sha256,
            )
        if size_bytes == 0:
            return self._blocked(
                original_name=original_name,
                normalized_name=safe_name,
                extension=extension,
                reason_code="empty_file",
                message="File is empty",
                detected_mime=detected_mime,
                size_bytes=size_bytes,
                sha256=sha256,
            )
        if size_bytes > settings.max_file_size_bytes:
            return self._blocked(
                original_name=original_name,
                normalized_name=safe_name,
                extension=extension,
                reason_code="file_too_large",
                message="File exceeds maximum size",
                detected_mime=detected_mime,
                size_bytes=size_bytes,
                sha256=sha256,
            )

        expected_mimes = _EXPECTED_MIME_BY_EXTENSION.get(extension, set())
        if not expected_mimes or not expected_mimes.issubset(settings.allowed_mime_types):
            return self._blocked(
                original_name=original_name,
                normalized_name=safe_name,
                extension=extension,
                reason_code="file_type_not_allowed",
                message="File type is not allowed",
                detected_mime=detected_mime,
                size_bytes=size_bytes,
                sha256=sha256,
            )
        claimed_mime_type = self._normalize_claimed_mime(claimed_mime_type)
        if claimed_mime_type and (claimed_mime_type not in expected_mimes or claimed_mime_type != detected_mime):
            return self._blocked(
                original_name=original_name,
                normalized_name=safe_name,
                extension=extension,
                reason_code="mime_mismatch",
                message="Claimed MIME type does not match file content",
                detected_mime=detected_mime,
                size_bytes=size_bytes,
                sha256=sha256,
            )
        logger.info(
            "Запускаем базовые проверки файла: filename=%s extension=%s expected_mimes=%s",
            safe_name,
            extension,
            ",".join(sorted(expected_mimes)),
        )
        if detected_mime not in expected_mimes:
            if self._looks_like_extension(extension=extension, content_bytes=content_bytes):
                logger.info(
                    "MIME не совпал с ожидаемым, но сигнатура похожа на заявленный тип: начинаем углубленную структурную проверку файла"
                )
                failure = self._validate_content(extension=extension, content_bytes=content_bytes)
                if failure is not None:
                    return self._blocked(
                        original_name=original_name,
                        normalized_name=safe_name,
                        extension=extension,
                        reason_code=failure[0],
                        message=failure[1],
                        detected_mime=detected_mime,
                        size_bytes=size_bytes,
                        sha256=sha256,
                    )
            return self._blocked(
                original_name=original_name,
                normalized_name=safe_name,
                extension=extension,
                reason_code="mime_mismatch",
                message="File extension does not match detected MIME type",
                detected_mime=detected_mime,
                size_bytes=size_bytes,
                sha256=sha256,
            )

        failure = (
            self._validate_content(extension=extension, content_bytes=content_bytes)
            if settings.structural_validation_enabled
            else None
        )
        if failure is not None:
            return self._blocked(
                original_name=original_name,
                normalized_name=safe_name,
                extension=extension,
                reason_code=failure[0],
                message=failure[1],
                detected_mime=detected_mime,
                size_bytes=size_bytes,
                sha256=sha256,
            )

        logger.info("Структурная проверка файла пройдена успешно: extension=%s", extension)
        failure = self._scan_antivirus(content_bytes=content_bytes)
        if failure is not None:
            return self._blocked(
                original_name=original_name,
                normalized_name=safe_name,
                extension=extension,
                reason_code=failure[0],
                message=failure[1],
                detected_mime=detected_mime,
                size_bytes=size_bytes,
                sha256=sha256,
            )

        logger.info("Антивирусная проверка файла пройдена успешно")
        return ScanVerdict(
            allowed=True,
            reason_code=None,
            message="File is allowed",
            detected_mime=detected_mime,
            size_bytes=size_bytes,
            sha256=sha256,
        )

    def _scan_antivirus(self, *, content_bytes: bytes) -> tuple[str, str] | None:
        if not settings.antivirus_enabled:
            logger.info("Антивирусная проверка пропущена: FILE_GUARD_ANTIVIRUS_ENABLED=false")
            return None

        logger.info("Начинаем антивирусную проверку файла")
        try:
            result = self._antivirus_scanner.scan_bytes(content_bytes=content_bytes)
        except AntivirusUnavailableError as exc:
            raise ScanUnavailableError("Antivirus is unavailable") from exc

        if result.infected:
            logger.warning("Файл заблокирован антивирусом: signature=%s", result.signature or "unknown")
            return ("malware_detected", "Malware detected")
        return None

    def _blocked(
        self,
        *,
        original_name: str,
        normalized_name: str | None,
        extension: str | None,
        reason_code: str,
        message: str,
        detected_mime: str,
        size_bytes: int,
        sha256: str,
    ) -> ScanVerdict:
        logger.warning(
            "Файл заблокирован по результатам проверки: original_name=%s normalized_name=%s extension=%s reason_code=%s detected_mime=%s size_bytes=%s sha256_prefix=%s",
            original_name,
            normalized_name or "",
            extension or "",
            reason_code,
            detected_mime,
            size_bytes,
            _hash_prefix(sha256),
        )
        return ScanVerdict(
            allowed=False,
            reason_code=reason_code,
            message=message,
            detected_mime=detected_mime,
            size_bytes=size_bytes,
            sha256=sha256,
        )

    @staticmethod
    def _normalize_filename(original_name: str) -> str:
        normalized = unicodedata.normalize("NFKC", (original_name or "").strip())
        if not normalized:
            raise ValueError("File name is required")
        if len(normalized) > 255:
            raise ValueError("File name is too long")
        if any(unicodedata.category(ch).startswith("C") for ch in normalized):
            raise ValueError("File name contains control characters")
        if Path(normalized).name != normalized or "/" in normalized or "\\" in normalized:
            raise ValueError("Unsafe file name")
        return normalized

    def _detect_mime(self, *, content_bytes: bytes) -> str:
        if magic_lib is not None:
            try:
                detected = str(magic_lib.from_buffer(content_bytes, mime=True) or "").strip()
                if detected:
                    return self._normalize_magic_mime(detected, content_bytes=content_bytes)
            except Exception as exc:
                if not settings.allow_libmagic_fallback:
                    raise ScanUnavailableError("libmagic MIME detection failed") from exc
                logger.warning("Определение MIME через libmagic завершилось ошибкой; переключаемся на определение по сигнатуре")
        return self._detect_mime_fallback(content_bytes)

    def _best_effort_detect_mime(self, *, content_bytes: bytes) -> str:
        try:
            return self._detect_mime(content_bytes=content_bytes)
        except ScanUnavailableError:
            return "application/octet-stream"

    def _normalize_magic_mime(self, detected: str, *, content_bytes: bytes) -> str:
        if detected in {"application/zip", "application/octet-stream"} and self._looks_like_zip(content_bytes):
            return self._detect_mime_fallback(content_bytes)
        if detected == "image/jpg":
            return "image/jpeg"
        return detected

    @staticmethod
    def _normalize_claimed_mime(claimed_mime_type: str | None) -> str | None:
        if claimed_mime_type == "application/x-zip-compressed":
            return "application/zip"
        return claimed_mime_type

    def _detect_mime_fallback(self, content_bytes: bytes) -> str:
        if content_bytes.startswith(b"%PDF-"):
            return "application/pdf"
        if content_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
            return "image/png"
        if content_bytes.startswith(b"\xff\xd8\xff"):
            return "image/jpeg"
        office_mime = self._detect_office_mime(content_bytes)
        if office_mime is not None:
            return office_mime
        if self._looks_like_zip(content_bytes):
            return "application/zip"
        return "application/octet-stream"

    def _detect_office_mime(self, content_bytes: bytes) -> str | None:
        if not content_bytes.startswith(b"PK\x03\x04"):
            return None
        try:
            with zipfile.ZipFile(io.BytesIO(content_bytes)) as archive:
                names = set(archive.namelist())
                content_types = archive.read("[Content_Types].xml") if "[Content_Types].xml" in names else b""
        except zipfile.BadZipFile:
            return None
        if "word/document.xml" in names:
            return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        if "xl/workbook.xml" in names:
            if b"macroEnabled" in content_types or b"macroenabled" in content_types.lower():
                return "application/vnd.ms-excel.sheet.macroenabled.12"
            return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        return None

    def _validate_content(self, *, extension: str, content_bytes: bytes) -> tuple[str, str] | None:
        logger.info("Запускаем структурную проверку содержимого файла: extension=%s", extension)
        if extension == ".pdf":
            return self._validate_pdf(content_bytes)
        if extension in {".docx", ".xlsx", ".xlsm"}:
            return self._validate_office(extension=extension, content_bytes=content_bytes)
        if extension == ".zip":
            return self._validate_zip(content_bytes)
        if extension in {".jpg", ".jpeg", ".png"}:
            return self._validate_image(extension=extension, content_bytes=content_bytes)
        return None

    @staticmethod
    def _looks_like_extension(*, extension: str, content_bytes: bytes) -> bool:
        if extension == ".pdf":
            return content_bytes.startswith(b"%PDF-")
        if extension in {".docx", ".xlsx", ".xlsm"}:
            return content_bytes.startswith(b"PK\x03\x04")
        if extension == ".zip":
            return FileScanner._looks_like_zip(content_bytes)
        if extension == ".png":
            return content_bytes.startswith(b"\x89PNG\r\n\x1a\n")
        if extension in {".jpg", ".jpeg"}:
            return content_bytes.startswith(b"\xff\xd8\xff")
        return False

    @staticmethod
    def _looks_like_zip(content_bytes: bytes) -> bool:
        return content_bytes.startswith((b"PK\x03\x04", b"PK\x05\x06", b"PK\x07\x08"))

    def _validate_pdf(self, content_bytes: bytes) -> tuple[str, str] | None:
        logger.info("Проверяем PDF-файл: сигнатуру, структуру и активное содержимое")
        if not content_bytes.startswith(b"%PDF-"):
            return ("invalid_pdf", "PDF is corrupted or unreadable")
        if self._contains_suspicious_pdf_tokens(content_bytes):
            return ("invalid_pdf", "PDF contains active content")

        if PdfReader is not None:
            try:
                reader = PdfReader(io.BytesIO(content_bytes), strict=False)
                if getattr(reader, "is_encrypted", False):
                    return ("encrypted_pdf_not_allowed", "Encrypted PDF files are not allowed")
                if len(reader.pages) < 1:
                    return ("invalid_pdf", "PDF is corrupted or unreadable")
                logger.info("PDF успешно разобран через pypdf: pages=%s", len(reader.pages))
                return None
            except Exception:
                logger.info("pypdf не смог разобрать PDF; проверяем сигнатуру")
                if b"/Encrypt" in content_bytes[:65536]:
                    return ("encrypted_pdf_not_allowed", "Encrypted PDF files are not allowed")
                return ("invalid_pdf", "PDF is corrupted or unreadable")

        if b"%%EOF" not in content_bytes[-2048:]:
            return ("invalid_pdf", "PDF is corrupted or unreadable")
        if b"/Encrypt" in content_bytes[:65536]:
            return ("encrypted_pdf_not_allowed", "Encrypted PDF files are not allowed")
        if self._contains_suspicious_pdf_tokens(content_bytes):
            return ("invalid_pdf", "PDF contains active content")
        return None

    @staticmethod
    def _contains_suspicious_pdf_tokens(content_bytes: bytes) -> bool:
        return any(token in content_bytes for token in _SUSPICIOUS_PDF_TOKENS)

    def _validate_office(self, *, extension: str, content_bytes: bytes) -> tuple[str, str] | None:
        logger.info("Проверяем Office-файл: extension=%s", extension)
        failure = validate_office_archive(extension=extension, content_bytes=content_bytes)
        if failure is None:
            logger.info("Office-файл прошел структурную проверку: extension=%s", extension)
        return failure

    def _validate_zip(self, content_bytes: bytes) -> tuple[str, str] | None:
        if not self._looks_like_zip(content_bytes):
            return ("invalid_archive", "ZIP archive is corrupted or invalid")
        try:
            with zipfile.ZipFile(io.BytesIO(content_bytes)) as archive:
                infos = archive.infolist()
                if not infos:
                    return ("invalid_archive", "ZIP archive must contain at least one file")
                if len(infos) > settings.office_max_entries:
                    return ("invalid_archive", "ZIP archive exceeds safety limits")

                total_uncompressed = 0
                for info in infos:
                    if not info.filename or len(info.filename) > settings.office_max_entry_name_length:
                        return ("invalid_archive", "ZIP archive is corrupted or invalid")
                    normalized_path = PurePosixPath(info.filename)
                    if info.filename.startswith(("/", "\\")) or "\\" in info.filename or ".." in normalized_path.parts:
                        return ("invalid_archive", "ZIP archive contains an unsafe path")
                    if info.flag_bits & 0x1:
                        return ("encrypted_archive_not_allowed", "Encrypted ZIP archives are not allowed")
                    if info.file_size > settings.office_max_entry_uncompressed_bytes:
                        return ("invalid_archive", "ZIP archive exceeds safety limits")
                    total_uncompressed += info.file_size
                    if total_uncompressed > settings.office_max_total_uncompressed_bytes:
                        return ("invalid_archive", "ZIP archive exceeds safety limits")
                    if info.file_size and (info.compress_size <= 0 or info.file_size / info.compress_size > settings.office_max_compression_ratio):
                        return ("invalid_archive", "ZIP archive exceeds safety limits")

                if archive.testzip() is not None:
                    return ("invalid_archive", "ZIP archive is corrupted or invalid")
        except (OSError, RuntimeError, zipfile.BadZipFile):
            return ("invalid_archive", "ZIP archive is corrupted or invalid")
        return None

    def _validate_image(self, *, extension: str, content_bytes: bytes) -> tuple[str, str] | None:
        logger.info("Проверяем изображение: extension=%s", extension)
        if Image is not None:
            try:
                with Image.open(io.BytesIO(content_bytes)) as image:
                    format_name = (image.format or "").upper()
                    width, height = image.size
                    if width > settings.image_max_width or height > settings.image_max_height:
                        return ("invalid_image", "Image exceeds allowed dimensions")
                    if width * height > settings.image_max_pixels:
                        return ("invalid_image", "Image exceeds allowed dimensions")
                    image.load()
                logger.info(
                    "Изображение успешно декодировано: extension=%s format=%s width=%s height=%s",
                    extension,
                    format_name,
                    width,
                    height,
                )
                if extension == ".png" and format_name != "PNG":
                    return ("invalid_image", "Image is corrupted or invalid")
                if extension in {".jpg", ".jpeg"} and format_name != "JPEG":
                    return ("invalid_image", "Image is corrupted or invalid")
                return None
            except (DecompressionBombError, UnidentifiedImageError, OSError, ValueError):
                return ("invalid_image", "Image is corrupted or invalid")
        if extension == ".png":
            return self._validate_png(content_bytes)
        return self._validate_jpeg(content_bytes)

    @staticmethod
    def _validate_png(content_bytes: bytes) -> tuple[str, str] | None:
        if not content_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
            return ("invalid_image", "Image is corrupted or invalid")
        if b"IEND" not in content_bytes[-32:]:
            return ("invalid_image", "Image is corrupted or invalid")
        return None

    @staticmethod
    def _validate_jpeg(content_bytes: bytes) -> tuple[str, str] | None:
        if not content_bytes.startswith(b"\xff\xd8\xff"):
            return ("invalid_image", "Image is corrupted or invalid")
        if not content_bytes.endswith(b"\xff\xd9"):
            return ("invalid_image", "Image is corrupted or invalid")
        return None

    @staticmethod
    def _build_antivirus_scanner():
        if not settings.antivirus_enabled:
            return DisabledAntivirusScanner()
        return ClamAVScanner()


def _hash_prefix(value: str) -> str:
    return value[:12]

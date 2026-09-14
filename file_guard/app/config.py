from __future__ import annotations

import os
from dataclasses import dataclass


def _env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _env_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def _env_float(name: str, default: float) -> float:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = float(raw)
    except ValueError:
        return default
    return value if value > 0 else default


def _env_csv(name: str, default: str) -> tuple[str, ...]:
    return tuple(item.strip().lower() for item in os.getenv(name, default).split(",") if item.strip())


@dataclass(frozen=True, slots=True)
class Settings:
    max_file_size_bytes: int = _env_int("FILE_GUARD_MAX_FILE_SIZE_BYTES", 25 * 1024 * 1024)
    allowed_extensions: tuple[str, ...] = _env_csv(
        "FILE_GUARD_ALLOWED_EXTENSIONS", ".pdf,.png,.jpg,.jpeg,.xlsx,.xlsm,.docx,.zip"
    )
    allowed_mime_types: tuple[str, ...] = _env_csv(
        "FILE_GUARD_ALLOWED_MIME_TYPES",
        "application/pdf,image/png,image/jpeg,"
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,"
        "application/vnd.ms-excel.sheet.macroenabled.12,"
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/zip",
    )
    allow_libmagic_fallback: bool = _env_bool("FILE_GUARD_ALLOW_LIBMAGIC_FALLBACK", True)
    structural_validation_enabled: bool = _env_bool("FILE_GUARD_STRUCTURAL_VALIDATION_ENABLED", True)
    antivirus_enabled: bool = _env_bool("FILE_GUARD_ANTIVIRUS_ENABLED", True)
    # When true, the service refuses to operate (health 503, scans rejected) while the
    # antivirus is disabled. Set to true in production to guarantee malware scanning.
    require_antivirus: bool = _env_bool("FILE_GUARD_REQUIRE_ANTIVIRUS", False)
    antivirus_timeout_seconds: float = _env_float("FILE_GUARD_ANTIVIRUS_TIMEOUT_SECONDS", 10.0)
    # End-to-end deadline for a single validation (parsing + structural checks + AV).
    scan_timeout_seconds: float = _env_float("FILE_GUARD_SCAN_TIMEOUT_SECONDS", 30.0)
    clamd_socket_path: str = os.getenv("FILE_GUARD_CLAMD_SOCKET_PATH", "/run/clamav/clamd.sock").strip() or "/run/clamav/clamd.sock"
    clamd_stream_chunk_bytes: int = _env_int("FILE_GUARD_CLAMD_STREAM_CHUNK_BYTES", 65536)
    # Shared safety limits for ZIP-based files (DOCX, XLSX and standalone ZIP archives).
    office_max_entries: int = _env_int("FILE_GUARD_OFFICE_MAX_ENTRIES", 200)
    office_max_total_uncompressed_bytes: int = _env_int("FILE_GUARD_OFFICE_MAX_TOTAL_UNCOMPRESSED_BYTES", 40 * 1024 * 1024)
    office_max_entry_uncompressed_bytes: int = _env_int("FILE_GUARD_OFFICE_MAX_ENTRY_UNCOMPRESSED_BYTES", 12 * 1024 * 1024)
    office_max_compression_ratio: float = _env_float("FILE_GUARD_OFFICE_MAX_COMPRESSION_RATIO", 120.0)
    office_max_xml_scan_bytes: int = _env_int("FILE_GUARD_OFFICE_MAX_XML_SCAN_BYTES", 1024 * 1024)
    office_max_entry_name_length: int = _env_int("FILE_GUARD_OFFICE_MAX_ENTRY_NAME_LENGTH", 255)
    upload_read_chunk_bytes: int = _env_int("FILE_GUARD_UPLOAD_READ_CHUNK_BYTES", 1024 * 1024)
    image_max_width: int = _env_int("FILE_GUARD_IMAGE_MAX_WIDTH", 12000)
    image_max_height: int = _env_int("FILE_GUARD_IMAGE_MAX_HEIGHT", 12000)
    image_max_pixels: int = _env_int("FILE_GUARD_IMAGE_MAX_PIXELS", 40_000_000)
    excel_sanitization_enabled: bool = _env_bool("FILE_GUARD_EXCEL_SANITIZATION_ENABLED", True)
    excel_max_sheets: int = _env_int("FILE_GUARD_EXCEL_MAX_SHEETS", 100)
    excel_max_rows_per_sheet: int = _env_int("FILE_GUARD_EXCEL_MAX_ROWS_PER_SHEET", 200_000)
    excel_max_columns_per_sheet: int = _env_int("FILE_GUARD_EXCEL_MAX_COLUMNS_PER_SHEET", 500)
    excel_max_non_empty_cells: int = _env_int("FILE_GUARD_EXCEL_MAX_NON_EMPTY_CELLS", 1_000_000)
    excel_max_merged_ranges: int = _env_int("FILE_GUARD_EXCEL_MAX_MERGED_RANGES", 10_000)
    excel_max_cell_string_length: int = _env_int("FILE_GUARD_EXCEL_MAX_CELL_STRING_LENGTH", 32_767)
    excel_max_output_size_bytes: int = _env_int("FILE_GUARD_EXCEL_MAX_OUTPUT_SIZE_BYTES", 25 * 1024 * 1024)
    excel_remove_formulas: bool = _env_bool("FILE_GUARD_EXCEL_REMOVE_FORMULAS", True)
    excel_remove_external_links: bool = _env_bool("FILE_GUARD_EXCEL_REMOVE_EXTERNAL_LINKS", True)
    excel_remove_images: bool = _env_bool("FILE_GUARD_EXCEL_REMOVE_IMAGES", True)
    excel_remove_charts: bool = _env_bool("FILE_GUARD_EXCEL_REMOVE_CHARTS", True)


settings = Settings()

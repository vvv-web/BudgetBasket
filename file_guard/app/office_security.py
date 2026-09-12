from __future__ import annotations

import io
import re
import unicodedata
import zipfile
from pathlib import Path, PurePosixPath

from .config import settings

_OFFICE_FORBIDDEN_EXTENSIONS = frozenset(
    {
        ".js",
        ".jse",
        ".vbs",
        ".vbe",
        ".wsf",
        ".wsh",
        ".ps1",
        ".psm1",
        ".bat",
        ".cmd",
        ".sh",
        ".py",
        ".php",
        ".pl",
        ".rb",
        ".jar",
        ".class",
        ".exe",
        ".dll",
        ".msi",
        ".com",
        ".scr",
        ".hta",
        ".html",
        ".htm",
        ".svg",
        ".bin",
    }
)

_OFFICE_XML_SCAN_PATHS = frozenset(
    {
        "[Content_Types].xml",
        "word/document.xml",
        "word/_rels/document.xml.rels",
        "word/settings.xml",
        "word/webSettings.xml",
        "xl/workbook.xml",
        "xl/_rels/workbook.xml.rels",
    }
)

_SUSPICIOUS_XML_MARKERS = (
    b"vbaProject",
    b"macros",
    b"macroEnabled",
    b"activeX",
    b"oleObject",
    b"Object",
    b"embed",
    b"ms-its:",
    b"javascript:",
    b"vbscript:",
    b"powershell:",
    b"cmd.exe",
    b"wscript",
    b"cscript",
    b"shell",
    b"DDEAUTO",
    b"application/vnd.ms-office.vbaProject",
)

_EXTERNAL_REL_PATTERN = re.compile(
    rb'<Relationship\b[^>]*\bTargetMode\s*=\s*"External"[^>]*\bTarget\s*=\s*"([^"]+)"',
    re.IGNORECASE,
)

_SUSPICIOUS_EXTERNAL_TARGET_MARKERS = (
    b"javascript:",
    b"vbscript:",
    b"file:",
    b"cmd",
    b"powershell",
    b"ms-its:",
)


def validate_office_archive(
    *,
    extension: str,
    content_bytes: bytes,
) -> tuple[str, str] | None:
    required_entry = "word/document.xml" if extension == ".docx" else "xl/workbook.xml"
    if not content_bytes.startswith(b"PK\x03\x04"):
        return ("invalid_office_document", "Office document is corrupted or invalid")

    try:
        with zipfile.ZipFile(io.BytesIO(content_bytes)) as archive:
            infos = archive.infolist()
            names = {info.filename for info in infos}
    except zipfile.BadZipFile:
        return ("invalid_office_document", "Office document is corrupted or invalid")

    if "[Content_Types].xml" not in names or required_entry not in names:
        return ("invalid_office_document", "Office document is corrupted or invalid")
    if len(infos) > settings.office_max_entries:
        return ("invalid_office_document", "Office document exceeds safety limits")

    total_uncompressed = 0
    rels_to_scan: list[tuple[str, zipfile.ZipInfo]] = []

    for info in infos:
        path_failure = _validate_entry_path(info.filename)
        if path_failure is not None:
            return path_failure

        is_excel = extension in {".xlsx", ".xlsm"}
        suffix = Path(info.filename).suffix.lower()
        if suffix in _OFFICE_FORBIDDEN_EXTENSIONS and not (is_excel and suffix == ".bin"):
            return ("invalid_office_document", "Office document contains forbidden content")
        lowered_name = info.filename.lower()
        # Spreadsheet active parts are deliberately allowed through this initial
        # bounded ZIP check.  The sanitizer rebuilds a new workbook without them.
        if not is_excel and (lowered_name.endswith("vbaproject.bin") or "/embeddings/" in lowered_name and lowered_name.endswith(".bin")):
            return ("invalid_office_document", "Office document contains forbidden content")

        if info.file_size > settings.office_max_entry_uncompressed_bytes:
            return ("invalid_office_document", "Office document exceeds safety limits")
        total_uncompressed += info.file_size
        if total_uncompressed > settings.office_max_total_uncompressed_bytes:
            return ("invalid_office_document", "Office document exceeds safety limits")
        if info.file_size > 0:
            if info.compress_size <= 0:
                return ("invalid_office_document", "Office document exceeds safety limits")
            if (info.file_size / info.compress_size) > settings.office_max_compression_ratio:
                return ("invalid_office_document", "Office document exceeds safety limits")

        if (not is_excel) and (info.filename.endswith(".rels") or info.filename in _OFFICE_XML_SCAN_PATHS):
            rels_to_scan.append((info.filename, info))

    with zipfile.ZipFile(io.BytesIO(content_bytes)) as archive:
        for entry_name, info in rels_to_scan:
            content_failure = _scan_xml_entry(archive=archive, entry_name=entry_name, info=info)
            if content_failure is not None:
                return content_failure

    return None


def _validate_entry_path(name: str) -> tuple[str, str] | None:
    if not name:
        return ("invalid_office_document", "Office document is corrupted or invalid")
    if len(name) > settings.office_max_entry_name_length:
        return ("invalid_office_document", "Office document exceeds safety limits")
    if any(unicodedata.category(ch).startswith("C") for ch in name):
        return ("invalid_office_document", "Office document is corrupted or invalid")

    normalized_path = PurePosixPath(name)
    if (
        name.startswith(("/", "\\"))
        or "\\" in name
        or ".." in normalized_path.parts
    ):
        return ("invalid_office_document", "Office document is corrupted or invalid")
    return None


def _scan_xml_entry(
    *,
    archive: zipfile.ZipFile,
    entry_name: str,
    info: zipfile.ZipInfo,
) -> tuple[str, str] | None:
    if info.file_size > settings.office_max_xml_scan_bytes:
        return ("invalid_office_document", "Office document exceeds safety limits")

    try:
        with archive.open(info, "r") as entry:
            payload = entry.read(settings.office_max_xml_scan_bytes + 1)
    except (OSError, zipfile.BadZipFile, RuntimeError):
        return ("invalid_office_document", "Office document is corrupted or invalid")

    if len(payload) > settings.office_max_xml_scan_bytes:
        return ("invalid_office_document", "Office document exceeds safety limits")

    lowered = payload.lower()
    if any(marker.lower() in lowered for marker in _SUSPICIOUS_XML_MARKERS):
        return ("invalid_office_document", "Office document contains forbidden content")

    if entry_name.endswith(".rels"):
        return _scan_relationships(payload)
    return None


def _scan_relationships(payload: bytes) -> tuple[str, str] | None:
    for match in _EXTERNAL_REL_PATTERN.finditer(payload):
        target = match.group(1)
        lowered_target = target.lower()
        if any(marker in lowered_target for marker in _SUSPICIOUS_EXTERNAL_TARGET_MARKERS):
            return ("invalid_office_document", "Office document contains forbidden content")
    return None

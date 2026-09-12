from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, Field


class ValidationResponse(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    valid: bool
    detected_mime_type: str = Field(alias="detectedMimeType")
    size_bytes: int = Field(alias="sizeBytes")
    reason_code: str | None = Field(alias="reasonCode")
    message: str | None
    warnings: list[str] = Field(default_factory=list)


@dataclass(frozen=True, slots=True)
class ProcessedFile:
    """Safe bytes and non-sensitive metadata returned by the processing pipeline."""

    content: bytes
    original_name: str
    output_name: str
    source_mime_type: str
    output_mime_type: str
    source_size_bytes: int
    output_size_bytes: int
    source_sha256: str
    output_sha256: str
    sanitized: bool
    removed_components: tuple[str, ...]
    warnings: tuple[str, ...]

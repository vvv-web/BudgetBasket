import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    app_env: str = os.getenv("APP_ENV", "development")
    app_port: int = int(os.getenv("APP_PORT", "8000"))

    database_url: str | None = os.getenv("DATABASE_URL")

    s3_endpoint: str | None = os.getenv("S3_ENDPOINT")
    s3_region: str = os.getenv("S3_REGION", "us-east-1")
    s3_access_key: str | None = os.getenv("S3_ACCESS_KEY")
    s3_secret_key: str | None = os.getenv("S3_SECRET_KEY")
    s3_bucket: str = os.getenv("S3_BUCKET", "budgetbasket-files")
    s3_force_path_style: bool = os.getenv("S3_FORCE_PATH_STYLE", "true").lower() in {"1", "true", "yes"}
    s3_public_url: str | None = os.getenv("S3_PUBLIC_URL")

    max_upload_file_size_mb: int = int(os.getenv("MAX_UPLOAD_FILE_SIZE_MB", "25"))
    allowed_upload_mime_types: tuple[str, ...] = tuple(
        item.strip()
        for item in os.getenv(
            "ALLOWED_UPLOAD_MIME_TYPES",
            "application/pdf,image/png,image/jpeg,"
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,"
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ).split(",")
        if item.strip()
    )

    @property
    def use_s3(self) -> bool:
        return bool(self.s3_endpoint)


def get_settings() -> Settings:
    return Settings()

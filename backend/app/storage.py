from __future__ import annotations

from pathlib import Path
from typing import BinaryIO
from shutil import copyfileobj

import boto3
from fastapi import HTTPException
from botocore.client import Config
from botocore.exceptions import ClientError

from app.config import Settings


class LocalObjectStorage:
    def __init__(self, root: str | Path):
        self.root = Path(root)
        self.root.mkdir(parents=True, exist_ok=True)

    def ensure_bucket(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)

    def put_object(self, key: str, content: bytes | BinaryIO, content_type: str) -> None:
        path = self.root / key
        path.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            path.write_bytes(content)
        else:
            with path.open("wb") as destination:
                copyfileobj(content, destination, length=64 * 1024)

    def get_object(self, key: str) -> tuple[BinaryIO, int | None, str | None]:
        path = self.root / key
        if not path.exists():
            raise HTTPException(status_code=404, detail="File object not found")
        return path.open("rb"), path.stat().st_size, None

    def delete_object(self, key: str) -> None:
        path = self.root / key
        if path.exists():
            path.unlink()


class S3ObjectStorage:
    def __init__(self, settings: Settings):
        self.bucket = settings.s3_bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            config=Config(s3={"addressing_style": "path" if settings.s3_force_path_style else "auto"}),
        )

    def ensure_bucket(self) -> None:
        try:
            self.client.head_bucket(Bucket=self.bucket)
        except ClientError:
            self.client.create_bucket(Bucket=self.bucket)

    def put_object(self, key: str, content: bytes | BinaryIO, content_type: str) -> None:
        self.client.put_object(Bucket=self.bucket, Key=key, Body=content, ContentType=content_type)

    def get_object(self, key: str):
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        return response["Body"], response.get("ContentLength"), response.get("ContentType")

    def delete_object(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)

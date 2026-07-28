from __future__ import annotations

import hashlib
import mimetypes
import re
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import uuid4

from fastapi import HTTPException, UploadFile

from app.config import Settings
from app.repositories.base import Repository
from app.services.common import get_required
from app.services.file_guard_client import FileGuardClient, require_valid_file
from app.services.permission_service import PermissionService
from app.storage import LocalObjectStorage, S3ObjectStorage

if TYPE_CHECKING:
    from app.services.request_service import RequestService


SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")
MIME_TYPE_ALIASES = {"application/x-zip-compressed": "application/zip"}
CHAT_IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}


class FileService:
    def __init__(self, repo: Repository, permissions: PermissionService, upload_dir: str | Path, settings: Settings, file_guard: FileGuardClient, object_storage: LocalObjectStorage | S3ObjectStorage | None = None, request_service: RequestService | None = None):
        self.repo = repo
        self.permissions = permissions
        self.settings = settings
        self.file_guard = file_guard
        self.object_storage = object_storage or (S3ObjectStorage(settings) if settings.use_s3 else LocalObjectStorage(upload_dir))
        self.request_service = request_service

    def ensure_bucket(self) -> None:
        self.object_storage.ensure_bucket()

    @staticmethod
    def safe_original_name(original_name: str) -> str:
        return SAFE_NAME_RE.sub("_", original_name.strip()).strip("._") or "file"

    def storage_key(self, original_name: str, *, prefix: str = "request-items") -> str:
        return f"{prefix}/{uuid4()}-{self.safe_original_name(original_name)}"

    def _allowed_mime(self, original_name: str, content_type: str | None) -> str:
        expected, _ = mimetypes.guess_type(original_name)
        expected = MIME_TYPE_ALIASES.get(expected or "", expected)
        actual = (content_type or expected or "application/octet-stream").split(";")[0]
        actual = MIME_TYPE_ALIASES.get(actual, actual)
        if actual not in self.settings.allowed_upload_mime_types:
            raise HTTPException(status_code=400, detail="Неподдерживаемый тип файла")
        if expected and actual != expected:
            raise HTTPException(status_code=400, detail="Содержимое файла не соответствует его расширению")
        return actual

    def _validate_content(self, content: bytes) -> None:
        if not content:
            raise HTTPException(status_code=400, detail="Нельзя прикрепить пустой файл")
        if len(content) > self.settings.max_upload_file_size_mb * 1024 * 1024:
            raise HTTPException(status_code=400, detail="Файл превышает допустимый размер")

    async def _upload(self, upload: UploadFile, *, prefix: str = "request-items", images_only: bool = False) -> dict:
        validation = await require_valid_file(self.file_guard, upload)
        original_name = upload.filename or "file"
        content = await upload.read()
        self._validate_content(content)
        mime_type = self._allowed_mime(original_name, validation.detected_mime_type)
        if images_only and mime_type not in CHAT_IMAGE_MIME_TYPES:
            raise HTTPException(status_code=400, detail="В чат можно прикреплять только изображения PNG, JPEG, GIF или WebP")
        digest = hashlib.sha256(content).hexdigest()
        storage = next((entry for entry in self.repo.load_all("storage_objects") if entry["content_sha256"] == digest), None)
        if not storage:
            key = self.storage_key(original_name, prefix=prefix)
            self.object_storage.put_object(key, content, mime_type)
            storage = self.repo.create("storage_objects", {"storage_bucket": self.settings.s3_bucket if self.settings.use_s3 else "local", "storage_key": key, "content_sha256": digest, "mime_type": mime_type, "size_bytes": len(content)})
        return self.repo.create("files", {"id_storage_object": storage["id"], "original_name": original_name})

    def _item_and_request(self, item_id: str) -> tuple[dict, dict]:
        item = get_required(self.repo, "req_items", item_id)
        return item, get_required(self.repo, "requests", item["request_id"])

    async def upload_for_item(self, user: dict, item_id: str, upload: UploadFile) -> dict:
        item, request = self._item_and_request(item_id)
        self.permissions.require_employee_upload_file(user, request)
        file = await self._upload(upload)
        self._link_uploaded_file(user, item_id, file["id"])
        if self.request_service:
            self.request_service.log(
                user,
                request["id"],
                "file_attached",
                entity="file",
                entity_id=str(file["id"]),
                after={"name": file["original_name"], "item_id": item["id"]},
            )
        return file

    async def validate_chat_images(self, uploads: list[UploadFile]) -> None:
        """Reject invalid attachments before creating a chat message."""
        for upload in uploads:
            validation = await require_valid_file(self.file_guard, upload)
            original_name = upload.filename or "file"
            content = await upload.read()
            self._validate_content(content)
            mime_type = self._allowed_mime(original_name, validation.detected_mime_type)
            if mime_type not in CHAT_IMAGE_MIME_TYPES:
                raise HTTPException(status_code=400, detail="В чат можно прикреплять только изображения PNG, JPEG, GIF или WebP")
            await upload.seek(0)

    async def upload_for_chat_message(self, user: dict, request_id: str, message_id: str, upload: UploadFile) -> dict:
        request = get_required(self.repo, "requests", request_id)
        message = get_required(self.repo, "chat_messages", message_id)
        chat = get_required(self.repo, "req_chats", message["chat_id"])
        if chat.get("req_id") != request["id"] or message.get("sender_id") != user["id"]:
            raise HTTPException(status_code=403, detail="Нельзя прикрепить изображение к этому сообщению")
        self.permissions.require_chat_access(user, request, write=True)
        file = await self._upload(upload, prefix="chat-images", images_only=True)
        self.repo.insert("message_files", {"file_id": file["id"], "message_id": message_id})
        if self.request_service:
            self.request_service.log(
                user,
                request_id,
                "chat_image_attached",
                entity="file",
                entity_id=str(file["id"]),
                after={"name": file["original_name"], "message_id": message_id},
            )
        return file

    def _link_uploaded_file(self, user: dict, item_id: str, file_id: str | int) -> dict:
        _item, request = self._item_and_request(item_id)
        self.permissions.require_employee_upload_file(user, request)
        get_required(self.repo, "files", file_id)
        file_id = int(file_id) if str(file_id).isdigit() else file_id
        if any(link.get("file_id") == file_id and link.get("req_item_id") == item_id for link in self.repo.load_all("req_item_files")):
            raise HTTPException(status_code=400, detail="Файл уже прикреплён")
        return self.repo.insert("req_item_files", {"file_id": file_id, "req_item_id": item_id})

    def delete_link(self, user: dict, item_id: str, file_id: str | int) -> None:
        item, request = self._item_and_request(item_id)
        self.permissions.require_request_unfrozen(request)
        self.permissions.require_employee_upload_file(user, request)
        file_id = int(file_id) if str(file_id).isdigit() else file_id
        if not self.repo.delete_where("req_item_files", {"req_item_id": item_id, "file_id": file_id}):
            raise HTTPException(status_code=404, detail="Вложение не найдено")
        file = get_required(self.repo, "files", file_id)
        if self.request_service:
            self.request_service.log(
                user,
                request["id"],
                "file_deleted",
                entity="file",
                entity_id=str(file_id),
                before={"name": file["original_name"], "item_id": item["id"]},
            )
        if self._file_has_links(file_id):
            return
        storage_id = file["id_storage_object"]
        self.repo.delete("files", file_id)
        if not any(entry.get("id_storage_object") == storage_id for entry in self.repo.load_all("files")):
            storage = get_required(self.repo, "storage_objects", storage_id)
            try:
                self.object_storage.delete_object(storage["storage_key"])
            except Exception:
                pass
            self.repo.delete("storage_objects", storage_id)

    def _file_has_links(self, file_id: str | int) -> bool:
        return any(link.get("file_id") == file_id for link in self.repo.load_all("req_item_files")) or any(
            link.get("file_id") == file_id for link in self.repo.load_all("message_files")
        )

    def _requests_for_file(self, file_id: str | int) -> list[dict]:
        file_id = int(file_id) if str(file_id).isdigit() else file_id
        requests = []
        for link in self.repo.load_all("req_item_files"):
            if link.get("file_id") == file_id:
                item = self.repo.get_by_id("req_items", link["req_item_id"])
                if item:
                    requests.append(get_required(self.repo, "requests", item["request_id"]))
        chats = {chat["id"]: chat for chat in self.repo.load_all("req_chats")}
        messages = {message["id"]: message for message in self.repo.load_all("chat_messages")}
        for link in self.repo.load_all("message_files"):
            message = messages.get(link.get("message_id"))
            chat = chats.get(message.get("chat_id")) if message else None
            if link.get("file_id") == file_id and chat:
                requests.append(get_required(self.repo, "requests", chat["req_id"]))
        return requests

    def require_file_access(self, user: dict, file_id: str | int) -> None:
        linked = self._requests_for_file(file_id)
        if user["role"] == "admin":
            return
        if not linked or not any(self.permissions.can_view_request(user, request) for request in linked):
            raise HTTPException(status_code=403, detail="Нет доступа к этому файлу")

    def files_for_item(self, user: dict, item_id: str) -> list[dict]:
        _item, request = self._item_and_request(item_id)
        self.permissions.require_view_request(user, request)
        ids = {link["file_id"] for link in self.repo.load_all("req_item_files") if link.get("req_item_id") == item_id}
        return [file for file in self.repo.load_all("files") if file["id"] in ids]

    def download(self, user: dict, file_id: str | int):
        file = get_required(self.repo, "files", file_id)
        self.require_file_access(user, file_id)
        storage = get_required(self.repo, "storage_objects", file["id_storage_object"])
        body, size, content_type = self.object_storage.get_object(storage["storage_key"])
        return body, file, storage, size, content_type or storage.get("mime_type")

    def download_path(self, user: dict, file_id: str | int):
        body, file, storage, _size, _content_type = self.download(user, file_id)
        path = getattr(body, "name", None)
        if not path:
            raise HTTPException(status_code=400, detail="Файл не хранится локально")
        return Path(path), file

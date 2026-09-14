from __future__ import annotations

import hashlib
import mimetypes
import re
from pathlib import Path
from typing import TYPE_CHECKING
from uuid import uuid4

from fastapi import HTTPException, UploadFile

from app.config import Settings
from app.models import RequestStatus
from app.repositories.base import Repository
from app.repositories.pagination import numbered_page
from app.repositories.queries import find_rows, find_one
from starlette.concurrency import run_in_threadpool
from app.services.common import get_required
from app.services.file_guard_client import FileGuardClient, require_processed_file
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
        processed = await require_processed_file(self.file_guard, upload)
        try:
            return await run_in_threadpool(self._store_processed, processed, upload.filename or "file", prefix, images_only)
        finally:
            if getattr(processed, "content_stream", None) is not None:
                processed.close()

    def _store_processed(self, processed, original_name: str, prefix: str, images_only: bool) -> dict:
        stream = getattr(processed, "content_stream", None)
        digest_builder = hashlib.sha256()
        if stream is not None:
            stream.seek(0)
            size = 0
            while chunk := stream.read(64 * 1024):
                size += len(chunk)
                if size > self.settings.max_upload_file_size_mb * 1024 * 1024:
                    raise HTTPException(status_code=400, detail="Файл превышает допустимый размер")
                digest_builder.update(chunk)
            stream.seek(0)
            if not size:
                raise HTTPException(status_code=400, detail="Нельзя прикрепить пустой файл")
            content = stream
        else:
            content = processed.content
            self._validate_content(content)
            size = len(content)
            digest_builder.update(content)
        mime_type = self._allowed_mime(processed.output_name, processed.output_mime_type)
        if images_only and mime_type not in CHAT_IMAGE_MIME_TYPES:
            raise HTTPException(status_code=400, detail="В чат можно прикреплять только изображения PNG, JPEG, GIF или WebP")
        digest = digest_builder.hexdigest()
        if digest != processed.output_sha256:
            raise HTTPException(status_code=503, detail="Проверка файлов вернула некорректный результат. Повторите попытку позже.")
        storage = find_one(self.repo, "storage_objects", content_sha256=digest)
        if not storage:
            key = self.storage_key(processed.output_name, prefix=prefix)
            self.object_storage.put_object(key, content, mime_type)
            storage = self.repo.create("storage_objects", {"storage_bucket": self.settings.s3_bucket if self.settings.use_s3 else "local", "storage_key": key, "content_sha256": digest, "mime_type": mime_type, "size_bytes": size})
        return self.repo.create("files", {
            "id_storage_object": storage["id"], "original_name": original_name,
            "stored_name": processed.output_name, "is_sanitized": processed.sanitized,
            "sanitization_report": {"removed": processed.removed_components, "warnings": processed.warnings} if processed.sanitized else None,
        })

    def _item_and_request(self, item_id: str) -> tuple[dict, dict]:
        item = get_required(self.repo, "req_items", item_id)
        return item, get_required(self.repo, "requests", item["request_id"])

    def _require_item_file_edit(self, user: dict, item: dict, request: dict) -> None:
        """Allow files for drafts and module-owned revision lines only."""
        if item.get("fixed") or item.get("frozen"):
            raise HTTPException(status_code=409, detail="Закрытую строку нельзя изменять")
        if request.get("status") == RequestStatus.draft:
            self.permissions.require_employee_edit_request(user, request)
            return
        if (
            request.get("status") == RequestStatus.on_review
            and self.request_service
            and item["id"] in self.request_service.returned_item_ids(request["id"])
        ):
            self.permissions.require_employee_unit_access(user, request["unit_id"])
            return
        self.permissions.require_employee_upload_file(user, request)

    def _check_item_upload(self, user: dict, item_id: str):
        item, request = self._item_and_request(item_id)
        self._require_item_file_edit(user, item, request)
        return item, request

    async def upload_for_item(self, user: dict, item_id: str, upload: UploadFile) -> dict:
        await run_in_threadpool(self._check_item_upload, user, item_id)
        file = await self._upload(upload)
        return await run_in_threadpool(self._finish_item_upload, user, item_id, file)

    def _finish_item_upload(self, user: dict, item_id: str, file: dict) -> dict:
        item, request = self._check_item_upload(user, item_id)
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
            if file.get("is_sanitized"):
                report = file.get("sanitization_report") or {}
                self.request_service.log(
                    user, request["id"], "file_sanitized", entity="file", entity_id=str(file["id"]),
                    before={"name": file["original_name"]},
                    after={"name": file.get("stored_name"), "removed": report.get("removed", [])},
                )
        return file

    async def validate_chat_images(self, uploads: list[UploadFile]) -> None:
        """Reject invalid attachments before creating a chat message."""
        for upload in uploads:
            processed = await require_processed_file(self.file_guard, upload)
            try:
                if getattr(processed, "content_stream", None) is None:
                    self._validate_content(processed.content)
                mime_type = self._allowed_mime(processed.output_name, processed.output_mime_type)
                if mime_type not in CHAT_IMAGE_MIME_TYPES:
                    raise HTTPException(status_code=400, detail="В чат можно прикреплять только изображения PNG, JPEG, GIF или WebP")
            finally:
                if getattr(processed, "content_stream", None) is not None:
                    processed.close()

    def _check_chat_upload(self, user: dict, chat_id: str, message_id: str):
        message = get_required(self.repo, "chat_messages", message_id)
        chat = get_required(self.repo, "chats", message["chat_id"])
        if chat["id"] != chat_id or message.get("sender_id") != user["id"]:
            raise HTTPException(status_code=403, detail="Нельзя прикрепить изображение к этому сообщению")
        if not getattr(self, "chat_service", None):
            raise HTTPException(status_code=500, detail="Сервис чатов не инициализирован")
        self.chat_service._sync_participants(chat, repo=self.repo)
        self.chat_service._require_access(user, chat, write=True)

    async def upload_for_chat_message(self, user: dict, chat_id: str, message_id: str, upload: UploadFile) -> dict:
        await run_in_threadpool(self._check_chat_upload, user, chat_id, message_id)
        file = await self._upload(upload, prefix="chat-images", images_only=True)
        await run_in_threadpool(self._finish_chat_upload, user, chat_id, message_id, file)
        return file

    def _finish_chat_upload(self, user: dict, chat_id: str, message_id: str, file: dict):
        self._check_chat_upload(user, chat_id, message_id)
        self.repo.insert("message_files", {"file_id": file["id"], "message_id": message_id})

    def _link_uploaded_file(self, user: dict, item_id: str, file_id: str | int) -> dict:
        item, request = self._item_and_request(item_id)
        self._require_item_file_edit(user, item, request)
        get_required(self.repo, "files", file_id)
        file_id = int(file_id) if str(file_id).isdigit() else file_id
        if any(link.get("file_id") == file_id and link.get("req_item_id") == item_id for link in find_rows(self.repo, "req_item_files", filters={"file_id": file_id})):
            raise HTTPException(status_code=400, detail="Файл уже прикреплён")
        return self.repo.insert("req_item_files", {"file_id": file_id, "req_item_id": item_id})

    def delete_link(self, user: dict, item_id: str, file_id: str | int) -> None:
        item, request = self._item_and_request(item_id)
        self._require_item_file_edit(user, item, request)
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
        return any(link.get("file_id") == file_id for link in find_rows(self.repo, "req_item_files", filters={"file_id": file_id})) or any(
            link.get("file_id") == file_id for link in find_rows(self.repo, "message_files", filters={"file_id": file_id})
        )

    def _requests_for_file(self, file_id: str | int) -> list[dict]:
        file_id = int(file_id) if str(file_id).isdigit() else file_id
        requests = []
        for link in find_rows(self.repo, "req_item_files", filters={"file_id": file_id}):
            if link.get("file_id") == file_id:
                item = self.repo.get_by_id("req_items", link["req_item_id"])
                if item:
                    requests.append(get_required(self.repo, "requests", item["request_id"]))
        return requests

    def _chat_ids_for_file(self, file_id: str | int) -> set[str]:
        file_id = int(file_id) if str(file_id).isdigit() else file_id
        links = find_rows(self.repo, "message_files", filters={"file_id": file_id})
        messages = {message["id"]: message for message in find_rows(self.repo, "chat_messages", in_filters={"id": {link["message_id"] for link in links}})}
        return {
            message["chat_id"]
            for link in find_rows(self.repo, "message_files", filters={"file_id": file_id})
            if link.get("file_id") == file_id
            for message in [messages.get(link.get("message_id"))]
            if message
        }

    def require_file_access(self, user: dict, file_id: str | int) -> None:
        linked = self._requests_for_file(file_id)
        chat_ids = self._chat_ids_for_file(file_id)
        if user["role"] == "admin":
            return
        request_allowed = any(self.permissions.can_view_request(user, request) for request in linked)
        chat_allowed = bool(getattr(self, "chat_service", None)) and any(
            self.chat_service.can_access(user, chat_id) for chat_id in chat_ids
        )
        if not request_allowed and not chat_allowed:
            raise HTTPException(status_code=403, detail="Нет доступа к этому файлу")

    def files_for_item(self, user: dict, item_id: str, *, page=1, page_size=None) -> list[dict] | dict:
        _item, request = self._item_and_request(item_id)
        self.permissions.require_view_request(user, request)
        ids = {link["file_id"] for link in find_rows(self.repo, "req_item_files", filters={"req_item_id": item_id})}
        if page_size:
            return numbered_page(self.repo, "files", in_filters={"id": ids}, page=page, page_size=page_size)
        return find_rows(self.repo, "files", in_filters={"id": ids})

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

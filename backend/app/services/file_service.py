import hashlib
import mimetypes
import re
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException, UploadFile

from app.config import Settings
from app.models import RequestStatus
from app.repositories.base import Repository
from app.services.common import get_required
from app.services.permission_service import PermissionService
from app.storage import LocalObjectStorage, S3ObjectStorage


SAFE_NAME_RE = re.compile(r"[^A-Za-z0-9._-]+")


class FileService:
    def __init__(
        self,
        repo: Repository,
        permissions: PermissionService,
        upload_dir: str | Path,
        settings: Settings,
        object_storage: LocalObjectStorage | S3ObjectStorage | None = None,
    ):
        self.repo = repo
        self.permissions = permissions
        self.settings = settings
        self.object_storage = object_storage or (
            S3ObjectStorage(settings) if settings.use_s3 else LocalObjectStorage(upload_dir)
        )

    def ensure_bucket(self) -> None:
        self.object_storage.ensure_bucket()

    @staticmethod
    def safe_original_name(original_name: str) -> str:
        cleaned = SAFE_NAME_RE.sub("_", original_name.strip()).strip("._")
        return cleaned or "file"

    def storage_key(self, request_id: str, item_type: str, item_id: str, original_name: str) -> str:
        return f"budget-items/{uuid4()}-{self.safe_original_name(original_name)}"

    def _allowed_mime(self, original_name: str, content_type: str | None) -> str:
        expected_mime, _ = mimetypes.guess_type(original_name)
        actual_mime = (content_type or expected_mime or "application/octet-stream").split(";")[0]
        if actual_mime not in self.settings.allowed_upload_mime_types:
            raise HTTPException(status_code=400, detail="File MIME type is not allowed")
        if expected_mime and actual_mime != expected_mime:
            raise HTTPException(status_code=400, detail="MIME type does not match file extension")
        return actual_mime

    def _validate_content(self, content: bytes) -> None:
        if not content:
            raise HTTPException(status_code=400, detail="Empty files are not allowed")
        max_size = self.settings.max_upload_file_size_mb * 1024 * 1024
        if len(content) > max_size:
            raise HTTPException(status_code=400, detail=f"File is larger than {self.settings.max_upload_file_size_mb} MB")

    def _create_storage_object(self, storage_payload: dict) -> dict:
        return self.repo.create("storage_objects", storage_payload)

    def _create_file(self, storage_id: int, original_name: str) -> dict:
        payload = {"id_storage_object": storage_id, "original_name": original_name}
        return self.repo.create("files", payload)

    async def upload(self, upload: UploadFile, *, request_id: str | None = None, item_type: str = "detached", item_id: str = "detached") -> dict:
        original_name = upload.filename or "file"
        content = await upload.read()
        self._validate_content(content)
        mime_type = self._allowed_mime(original_name, upload.content_type)
        digest = hashlib.sha256(content).hexdigest()
        storage = next((item for item in self.repo.load_all("storage_objects") if item["content_sha256"] == digest), None)
        if not storage:
            key_request_id = request_id or "detached"
            storage_key = self.storage_key(key_request_id, item_type, item_id, original_name)
            self.object_storage.put_object(storage_key, content, mime_type)
            storage = self._create_storage_object(
                {
                    "storage_bucket": self.settings.s3_bucket if self.settings.use_s3 else "local",
                    "storage_key": storage_key,
                    "content_sha256": digest,
                    "mime_type": mime_type,
                    "size_bytes": len(content),
                }
            )
        return self._create_file(storage["id"], original_name)

    async def upload_for_item(self, user: dict, kind: str, item_id: str, upload: UploadFile) -> dict:
        collection = "dds_items" if kind == "dds" else "invest_items"
        item = get_required(self.repo, collection, item_id)
        budget_request = get_required(self.repo, "requests", item["request_id"])
        self.permissions.require_employee_upload_file(user, budget_request)
        file = await self.upload(upload, request_id=item["request_id"], item_type=kind, item_id=item_id)
        self.link(user, kind, item_id, file["id"], allow_on_review=True)
        return file

    def link(self, user: dict, kind: str, item_id: str, file_id: str | int, allow_on_review: bool = False) -> dict:
        collection = "dds_items" if kind == "dds" else "invest_items"
        item = get_required(self.repo, collection, item_id)
        budget_request = get_required(self.repo, "requests", item["request_id"])
        self.permissions.require_request_unfrozen(budget_request)
        if allow_on_review:
            self.permissions.require_employee_upload_file(user, budget_request)
        else:
            self.permissions.require_employee_edit_request(user, budget_request)
        get_required(self.repo, "files", file_id)
        link_collection = "dds_item_files" if kind == "dds" else "invest_item_files"
        key = "dds_item_id" if kind == "dds" else "invest_item_id"
        file_id = int(file_id) if str(file_id).isdigit() else file_id
        if any(link.get("file_id") == file_id and link.get(key) == item_id for link in self.repo.load_all(link_collection)):
            raise HTTPException(status_code=400, detail="File is already attached to item")
        link = {"file_id": file_id, key: item_id}
        return self.repo.insert(link_collection, link)

    def delete_link(self, user: dict, kind: str, item_id: str, file_id: str | int) -> None:
        collection = "dds_items" if kind == "dds" else "invest_items"
        item = get_required(self.repo, collection, item_id)
        budget_request = get_required(self.repo, "requests", item["request_id"])
        self.permissions.require_request_unfrozen(budget_request)
        self.permissions.require_employee_upload_file(user, budget_request)

        link_collection = "dds_item_files" if kind == "dds" else "invest_item_files"
        key = "dds_item_id" if kind == "dds" else "invest_item_id"
        file_id = int(file_id) if str(file_id).isdigit() else file_id
        deleted = self.repo.delete_where(link_collection, {key: item_id, "file_id": file_id})
        if not deleted:
            raise HTTPException(status_code=404, detail="File link not found")

        remaining_links = [
            link
            for collection_name in ("dds_item_files", "invest_item_files")
            for link in self.repo.load_all(collection_name)
            if link.get("file_id") == file_id
        ]
        if remaining_links:
            return

        file = get_required(self.repo, "files", file_id)
        storage_id = file["id_storage_object"]
        self.repo.delete("files", file_id)
        if not any(entry.get("id_storage_object") == storage_id for entry in self.repo.load_all("files")):
            storage = get_required(self.repo, "storage_objects", storage_id)
            try:
                self.object_storage.delete_object(storage["storage_key"])
            except Exception:
                pass
            self.repo.delete("storage_objects", storage_id)

    def _request_for_file(self, file_id: str | int) -> list[dict]:
        file_id = int(file_id) if str(file_id).isdigit() else file_id
        requests = []
        for link in self.repo.load_all("dds_item_files"):
            if link.get("file_id") == file_id:
                item = self.repo.get_by_id("dds_items", link["dds_item_id"])
                if item:
                    requests.append(get_required(self.repo, "requests", item["request_id"]))
        for link in self.repo.load_all("invest_item_files"):
            if link.get("file_id") == file_id:
                item = self.repo.get_by_id("invest_items", link["invest_item_id"])
                if item:
                    requests.append(get_required(self.repo, "requests", item["request_id"]))
        return requests

    def require_file_access(self, user: dict, file_id: str | int) -> None:
        linked_requests = self._request_for_file(file_id)
        if user["role"] == "admin":
            return
        if not linked_requests:
            raise HTTPException(status_code=403, detail="No access to detached file")
        if not any(self.permissions.can_view_request(user, budget_request) for budget_request in linked_requests):
            raise HTTPException(status_code=403, detail="No access to file")

    def files_for_item(self, user: dict, kind: str, item_id: str) -> list[dict]:
        collection = "dds_items" if kind == "dds" else "invest_items"
        item = get_required(self.repo, collection, item_id)
        budget_request = get_required(self.repo, "requests", item["request_id"])
        self.permissions.require_view_request(user, budget_request)
        link_collection = "dds_item_files" if kind == "dds" else "invest_item_files"
        key = "dds_item_id" if kind == "dds" else "invest_item_id"
        file_ids = {link["file_id"] for link in self.repo.load_all(link_collection) if link.get(key) == item_id}
        return [file for file in self.repo.load_all("files") if file["id"] in file_ids]

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
            raise HTTPException(status_code=400, detail="File is not stored on local filesystem")
        return Path(path), file

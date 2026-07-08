import hashlib
import mimetypes
from pathlib import Path

from fastapi import HTTPException, UploadFile

from app.repositories.json_repository import JsonRepository
from app.services.common import get_required
from app.services.permission_service import PermissionService


ALLOWED_EXTENSIONS = {"pdf", "doc", "docx", "xls", "xlsx", "png", "jpg", "jpeg"}
MAX_SIZE = 25 * 1024 * 1024


class FileService:
    def __init__(self, repo: JsonRepository, permissions: PermissionService, upload_dir: str | Path):
        self.repo = repo
        self.permissions = permissions
        self.upload_dir = Path(upload_dir)
        self.upload_dir.mkdir(parents=True, exist_ok=True)

    def next_int_id(self, collection: str) -> int:
        ids = [int(item["id"]) for item in self.repo.load_all(collection) if str(item.get("id", "")).isdigit()]
        return max(ids, default=0) + 1

    async def upload(self, upload: UploadFile) -> dict:
        original_name = upload.filename or "file"
        ext = original_name.rsplit(".", 1)[-1].lower() if "." in original_name else ""
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(status_code=400, detail="Недопустимое расширение файла")
        content = await upload.read()
        if not content:
            raise HTTPException(status_code=400, detail="Пустые файлы запрещены")
        if len(content) > MAX_SIZE:
            raise HTTPException(status_code=400, detail="Файл больше 25 MB")
        expected_mime, _ = mimetypes.guess_type(original_name)
        actual_mime = upload.content_type or expected_mime or "application/octet-stream"
        if expected_mime and actual_mime and actual_mime != "application/octet-stream" and actual_mime.split(";")[0] != expected_mime:
            raise HTTPException(status_code=400, detail="MIME-type не соответствует расширению")
        digest = hashlib.sha256(content).hexdigest()
        storage = next((item for item in self.repo.load_all("storage_objects") if item["content_sha256"] == digest), None)
        if not storage:
            storage_id = self.next_int_id("storage_objects")
            storage_key = f"{digest}.{ext}"
            (self.upload_dir / storage_key).write_bytes(content)
            storage = self.repo.create(
                "storage_objects",
                {"id": storage_id, "storage_bucket": "local", "storage_key": storage_key, "content_sha256": digest, "mime_type": actual_mime, "size_bytes": len(content)},
            )
        return self.repo.create("files", {"id": self.next_int_id("files"), "id_storage_object": storage["id"], "original_name": original_name})

    def link(self, user: dict, kind: str, item_id: str, file_id: str) -> dict:
        collection = "dds_items" if kind == "dds" else "invest_items"
        item = get_required(self.repo, collection, item_id)
        request = get_required(self.repo, "requests", item["request_id"])
        self.permissions.require_employee_edit_request(user, request)
        get_required(self.repo, "files", file_id)
        link_collection = "dds_item_files" if kind == "dds" else "invest_item_files"
        key = "dds_item_id" if kind == "dds" else "invest_item_id"
        if any(link.get("file_id") == file_id and link.get(key) == item_id for link in self.repo.load_all(link_collection)):
            raise HTTPException(status_code=400, detail="Файл уже прикреплен к строке")
        link = {"file_id": file_id, key: item_id}
        self.repo.save_all(link_collection, [*self.repo.load_all(link_collection), link])
        return link

    def files_for_item(self, kind: str, item_id: str) -> list[dict]:
        link_collection = "dds_item_files" if kind == "dds" else "invest_item_files"
        key = "dds_item_id" if kind == "dds" else "invest_item_id"
        file_ids = {link["file_id"] for link in self.repo.load_all(link_collection) if link.get(key) == item_id}
        return [file for file in self.repo.load_all("files") if file["id"] in file_ids]

    def download_path(self, user: dict, file_id: str) -> tuple[Path, dict]:
        file = get_required(self.repo, "files", file_id)
        storage = get_required(self.repo, "storage_objects", file["id_storage_object"])
        path = self.upload_dir / storage["storage_key"]
        if not path.exists():
            raise HTTPException(status_code=404, detail="Файл не найден на диске")
        return path, file

from pathlib import Path

from app.repositories.json_repository import JsonRepository
from app.services.common import require_role


class ArchiveService:
    def __init__(self, current_repo: JsonRepository, data_root: str | Path):
        self.current_repo = current_repo
        self.data_root = Path(data_root)

    def archive_repo(self, year: int) -> JsonRepository:
        return JsonRepository(self.data_root / "archive" / str(year))

    def archive_year(self, user: dict, year: int) -> dict:
        require_role(user, "admin")
        archive = self.archive_repo(year)
        requests = self.current_repo.load_all("requests")
        moved_requests = list(requests)
        request_ids = {item["id"] for item in moved_requests}
        dds_items = [item for item in self.current_repo.load_all("dds_items") if item["request_id"] in request_ids]
        invest_items = [item for item in self.current_repo.load_all("invest_items") if item["request_id"] in request_ids]
        dds_item_ids = {item["id"] for item in dds_items}
        invest_item_ids = {item["id"] for item in invest_items}
        dds_links = [link for link in self.current_repo.load_all("dds_item_files") if link["dds_item_id"] in dds_item_ids]
        invest_links = [link for link in self.current_repo.load_all("invest_item_files") if link["invest_item_id"] in invest_item_ids]
        file_ids = {link["file_id"] for link in [*dds_links, *invest_links]}
        files = [file for file in self.current_repo.load_all("files") if file["id"] in file_ids]
        storage_ids = {file["id_storage_object"] for file in files}
        storage_objects = [item for item in self.current_repo.load_all("storage_objects") if item["id"] in storage_ids]

        for collection, data in {
            "requests": moved_requests,
            "dds_items": dds_items,
            "invest_items": invest_items,
            "dds_item_files": dds_links,
            "invest_item_files": invest_links,
            "files": files,
            "storage_objects": storage_objects,
        }.items():
            archive.save_all(collection, [*archive.load_all(collection), *data])

        self.current_repo.save_all("requests", [item for item in requests if item["id"] not in request_ids])
        self.current_repo.save_all("dds_items", [item for item in self.current_repo.load_all("dds_items") if item["id"] not in dds_item_ids])
        self.current_repo.save_all("invest_items", [item for item in self.current_repo.load_all("invest_items") if item["id"] not in invest_item_ids])
        self.current_repo.save_all("dds_item_files", [link for link in self.current_repo.load_all("dds_item_files") if link["dds_item_id"] not in dds_item_ids])
        self.current_repo.save_all("invest_item_files", [link for link in self.current_repo.load_all("invest_item_files") if link["invest_item_id"] not in invest_item_ids])

        return {"year": year, "requests_count": len(moved_requests), "note": "Метаданные файлов продублированы в архив; физические uploads остаются в общем локальном хранилище."}

    def list_archive_requests(self, user: dict, year: int) -> list[dict]:
        archive = self.archive_repo(year)
        return archive.load_all("requests")

    def get_archive_request(self, user: dict, year: int, request_id: str) -> dict:
        archive = self.archive_repo(year)
        request = archive.get_by_id("requests", request_id)
        if not request:
            from fastapi import HTTPException

            raise HTTPException(status_code=404, detail="Архивная заявка не найдена")
        return request

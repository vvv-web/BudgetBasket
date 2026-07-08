from app.repositories.json_repository import JsonRepository
from app.services.common import require_role


class CatalogService:
    def __init__(self, repo: JsonRepository):
        self.repo = repo

    def list_catalog(self, collection: str) -> list[dict]:
        return self.repo.load_all(collection)

    def create_catalog(self, user: dict, collection: str, payload: dict) -> dict:
        require_role(user, "admin")
        payload = {key: value for key, value in payload.items() if key != "code"}
        if "unit_id" not in payload:
            department = next((unit for unit in self.repo.load_all("units") if unit.get("parent_id") is None), None)
            payload["unit_id"] = department["id"] if department else None
        return self.repo.create(collection, payload)

    def update_catalog(self, user: dict, collection: str, item_id: str, patch: dict) -> dict:
        require_role(user, "admin")
        patch = {key: value for key, value in patch.items() if key != "code"}
        return self.repo.update(collection, item_id, patch)

    def list_mappings(self, collection: str) -> list[dict]:
        return self.repo.load_all(collection)

    def create_mapping(self, user: dict, collection: str, payload: dict) -> dict:
        require_role(user, "admin")
        key = "dds_id" if collection == "unit_dds_mappings" else "invest_id"
        if payload.get("is_active"):
            for item in self.repo.load_all(collection):
                if item.get("unit_id") == payload.get("unit_id") and item.get(key) == payload.get(key) and item.get("is_active"):
                    item["is_active"] = False
        return self.repo.create(collection, payload)

    def update_mapping(self, user: dict, collection: str, item_id: str, patch: dict) -> dict:
        require_role(user, "admin")
        return self.repo.update(collection, item_id, patch)

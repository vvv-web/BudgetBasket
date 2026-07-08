from fastapi import HTTPException

from app.repositories.json_repository import JsonRepository
from app.services.common import require_role


class CatalogService:
    COLLECTIONS = {
        "dds": "dds_catalog",
        "invests": "invests_catalog",
    }

    def __init__(self, repo: JsonRepository):
        self.repo = repo

    def collection_name(self, kind: str) -> str:
        if kind not in self.COLLECTIONS:
            raise HTTPException(status_code=400, detail="Неизвестный тип справочника")
        return self.COLLECTIONS[kind]

    def department_id_for_unit(self, unit_id: str | None) -> str | None:
        if not unit_id:
            return None
        unit = self.repo.get_by_id("units", unit_id)
        if not unit:
            return None
        return unit["parent_id"] or unit["id"]

    def list_catalog(
        self,
        collection: str,
        *,
        unit_id: str | None = None,
        module_id: str | None = None,
        active_only: bool = False,
        query: str | None = None,
    ) -> list[dict]:
        department_id = None
        if module_id:
            department_id = self.department_id_for_unit(module_id)
        elif unit_id:
            department_id = self.department_id_for_unit(unit_id)

        needle = (query or "").strip().lower()
        result = []
        for item in self.repo.load_all(collection):
            if department_id and item.get("unit_id") != department_id:
                continue
            if active_only and not item.get("is_active", True):
                continue
            if needle:
                haystack = str(item.get("name", "")).lower()
                if needle not in haystack:
                    continue
            result.append(item)
        return result

    def create_catalog(self, user: dict, collection: str, payload: dict) -> dict:
        require_role(user, "admin")
        item = {
            "parent_id": payload.get("parent_id"),
            "name": payload["name"],
            "is_active": payload.get("is_active", True),
            "unit_id": payload.get("unit_id"),
        }
        if not item["unit_id"]:
            department = next((unit for unit in self.repo.load_all("units") if unit.get("parent_id") is None), None)
            item["unit_id"] = department["id"] if department else None
        else:
            item["unit_id"] = self.department_id_for_unit(item["unit_id"])
        return self.repo.create(collection, item)

    def update_catalog(self, user: dict, collection: str, item_id: str, patch: dict) -> dict:
        require_role(user, "admin")
        allowed = {key: patch[key] for key in ("parent_id", "name", "is_active", "unit_id") if key in patch}
        if "unit_id" in allowed and allowed["unit_id"]:
            allowed["unit_id"] = self.department_id_for_unit(allowed["unit_id"])
        return self.repo.update(collection, item_id, allowed)

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

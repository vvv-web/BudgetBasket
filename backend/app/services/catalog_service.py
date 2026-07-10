from fastapi import HTTPException

from app.repositories.base import Repository
from app.services.common import require_role


class CatalogService:
    COLLECTIONS = {
        "dds": "dds_catalog",
        "invests": "invests_catalog",
    }

    def __init__(self, repo: Repository):
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

    def _default_department_id(self) -> str | None:
        department = next((unit for unit in self.repo.load_all("units") if unit.get("parent_id") is None), None)
        return department["id"] if department else None

    @staticmethod
    def _normalized_name(value: str | None) -> str:
        return (value or "").strip().casefold()

    @staticmethod
    def _same_id(left: object, right: object) -> bool:
        return (left is None and right is None) or str(left) == str(right)

    def _ensure_unique_item(
        self,
        collection: str,
        *,
        parent_id: str | None,
        unit_id: str | None,
        name: str,
        exclude_id: str | None = None,
    ) -> None:
        duplicate = next(
            (
                item
                for item in self.repo.load_all(collection)
                if item.get("id") != exclude_id
                and self._same_id(item.get("parent_id"), parent_id)
                and self._same_id(item.get("unit_id"), unit_id)
                and self._normalized_name(item.get("name")) == self._normalized_name(name)
            ),
            None,
        )
        if duplicate:
            raise HTTPException(status_code=400, detail="Запись с такой категорией, наименованием и подразделением уже существует")

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
        unit_id = payload.get("unit_id")
        if unit_id:
            unit_id = self.department_id_for_unit(unit_id)
        else:
            unit_id = self._default_department_id()
        item = {
            "parent_id": payload.get("parent_id"),
            "name": payload["name"],
            "is_active": payload.get("is_active", True),
            "unit_id": unit_id,
        }
        self._ensure_unique_item(collection, parent_id=item["parent_id"], unit_id=item["unit_id"], name=item["name"])
        return self.repo.create(collection, item)

    def update_catalog(self, user: dict, collection: str, item_id: str, patch: dict) -> dict:
        require_role(user, "admin")
        current = self.repo.get_by_id(collection, item_id)
        if not current:
            raise HTTPException(status_code=404, detail="Запись не найдена")
        allowed = {key: patch[key] for key in ("parent_id", "name", "is_active", "unit_id") if key in patch}
        if "unit_id" in allowed and allowed["unit_id"]:
            allowed["unit_id"] = self.department_id_for_unit(allowed["unit_id"])
        merged = {**current, **allowed}
        merged["unit_id"] = merged.get("unit_id") or self._default_department_id()
        self._ensure_unique_item(
            collection,
            parent_id=merged.get("parent_id"),
            unit_id=merged.get("unit_id"),
            name=merged.get("name", ""),
            exclude_id=item_id,
        )
        return self.repo.update(collection, item_id, allowed)

    def delete_catalog(self, user: dict, collection: str, item_id: str) -> None:
        require_role(user, "admin")
        target = self.repo.get_by_id(collection, item_id)
        if not target:
            raise HTTPException(status_code=404, detail="Запись не найдена")

        references_collection = "dds_items" if collection == "dds_catalog" else "invest_items"
        reference_field = "dds_id" if collection == "dds_catalog" else "invest_id"
        if any(item.get(reference_field) == item_id or item.get("category_id") == item_id for item in self.repo.load_all(references_collection)):
            raise HTTPException(status_code=400, detail="Нельзя удалить запись, пока она используется в заявках")

        for item in self.repo.load_all(collection):
            if item.get("parent_id") == item_id:
                self.repo.update(collection, item["id"], {"parent_id": None})
        self.repo.delete(collection, item_id)

    def list_mappings(self, collection: str) -> list[dict]:
        return self.repo.load_all(collection)

    def create_mapping(self, user: dict, collection: str, payload: dict) -> dict:
        require_role(user, "admin")
        key = "dds_id" if collection == "unit_dds_mappings" else "invest_id"
        if payload.get("is_active"):
            for item in self.repo.load_all(collection):
                if item.get("unit_id") == payload.get("unit_id") and item.get(key) == payload.get(key) and item.get("is_active"):
                    self.repo.update(collection, item["id"], {"is_active": False})
        return self.repo.create(collection, payload)

    def update_mapping(self, user: dict, collection: str, item_id: str, patch: dict) -> dict:
        require_role(user, "admin")
        return self.repo.update(collection, item_id, patch)

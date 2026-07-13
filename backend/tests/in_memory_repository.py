from __future__ import annotations

from copy import deepcopy
from uuid import uuid4

from fastapi import HTTPException


class InMemoryRepository:
    def __init__(self) -> None:
        self.rows: dict[str, list[dict]] = {}
        self._next_ids: dict[str, int] = {"files": 1, "storage_objects": 1}

    def load_all(self, collection_name: str) -> list[dict]:
        return deepcopy(self.rows.setdefault(collection_name.removesuffix(".json"), []))

    def save_all(self, collection_name: str, data: list[dict]) -> None:
        self.rows[collection_name.removesuffix(".json")] = deepcopy(data)

    def get_by_id(self, collection_name: str, item_id: str | int) -> dict | None:
        return next(
            (deepcopy(item) for item in self.rows.setdefault(collection_name.removesuffix(".json"), []) if str(item.get("id")) == str(item_id)),
            None,
        )

    def create(self, collection_name: str, item: dict) -> dict:
        collection = collection_name.removesuffix(".json")
        created = deepcopy(item)
        if "id" not in created:
            if collection in self._next_ids:
                created["id"] = self._next_ids[collection]
                self._next_ids[collection] += 1
            elif collection not in {"profiles", "units_responsibles", "dds_item_files", "invest_item_files"}:
                created["id"] = str(uuid4())
        if collection == "requests":
            created.setdefault("budget_frozen", False)
        self.rows.setdefault(collection, []).append(created)
        return deepcopy(created)

    insert = create

    def update(self, collection_name: str, item_id: str | int, patch: dict) -> dict:
        collection = collection_name.removesuffix(".json")
        for item in self.rows.setdefault(collection, []):
            if str(item.get("id")) == str(item_id):
                item.update(deepcopy(patch))
                return deepcopy(item)
        raise HTTPException(status_code=404, detail="Record not found")

    def update_where(self, collection_name: str, filters: dict, patch: dict) -> int:
        updated = 0
        for item in self.rows.setdefault(collection_name.removesuffix(".json"), []):
            if all(str(item.get(key)) == str(value) for key, value in filters.items()):
                item.update(deepcopy(patch))
                updated += 1
        return updated

    def delete(self, collection_name: str, item_id: str | int) -> None:
        collection = collection_name.removesuffix(".json")
        rows = self.rows.setdefault(collection, [])
        for index, item in enumerate(rows):
            if str(item.get("id")) == str(item_id):
                rows.pop(index)
                return
        raise HTTPException(status_code=404, detail="Record not found")

    def delete_where(self, collection_name: str, filters: dict) -> int:
        collection = collection_name.removesuffix(".json")
        rows = self.rows.setdefault(collection, [])
        remaining = [item for item in rows if not all(str(item.get(key)) == str(value) for key, value in filters.items())]
        deleted = len(rows) - len(remaining)
        self.rows[collection] = remaining
        return deleted

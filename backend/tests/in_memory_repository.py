from __future__ import annotations

from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException


class InMemoryRepository:
    def __init__(self) -> None:
        self.rows: dict[str, list[dict]] = {}
        self._next_ids: dict[str, int] = {
            "roles": 1,
            "files": 1,
            "storage_objects": 1,
            "req_logs": 1,
            "step_logs": 1,
        }

    def _public_row(self, collection: str, item: dict) -> dict:
        result = deepcopy(item)
        if collection == "users" and "role" not in result:
            role = next(
                (
                    role
                    for role in self.rows.setdefault("roles", [])
                    if str(role.get("id")) == str(result.get("id_role"))
                ),
                None,
            )
            if role:
                result["role"] = role["name"]
        return result

    def _normalize_user(self, item: dict) -> dict:
        normalized = deepcopy(item)
        role_name = normalized.pop("role", None)
        if role_name is not None:
            role = next(
                (role for role in self.rows.setdefault("roles", []) if role.get("name") == str(role_name)),
                None,
            )
            if not role:
                role = self.create("roles", {"name": str(role_name)})
            normalized["id_role"] = role["id"]
        return normalized

    def load_all(self, collection_name: str) -> list[dict]:
        collection = collection_name.removesuffix(".json")
        return [self._public_row(collection, item) for item in self.rows.setdefault(collection, [])]

    def save_all(self, collection_name: str, data: list[dict]) -> None:
        collection = collection_name.removesuffix(".json")
        self.rows[collection] = [
            self._normalize_user(item) if collection == "users" else deepcopy(item)
            for item in data
        ]

    def get_by_id(self, collection_name: str, item_id: str | int) -> dict | None:
        return next(
            (
                self._public_row(collection_name.removesuffix(".json"), item)
                for item in self.rows.setdefault(collection_name.removesuffix(".json"), [])
                if str(item.get("id")) == str(item_id)
            ),
            None,
        )

    def create(self, collection_name: str, item: dict) -> dict:
        collection = collection_name.removesuffix(".json")
        created = self._normalize_user(item) if collection == "users" else deepcopy(item)
        if "id" not in created:
            if collection in self._next_ids:
                created["id"] = self._next_ids[collection]
                self._next_ids[collection] += 1
            elif collection not in {"profiles", "units_responsibles", "req_item_files", "chats_participants", "step_edges", "request_step_states"}:
                created["id"] = str(uuid4())
        if collection == "requests":
            created.setdefault("frozen", False)
            created.setdefault("fixed", False)
        if collection in {"req_logs", "step_logs"}:
            created.setdefault("created_at", datetime.now(timezone.utc).isoformat())
        self.rows.setdefault(collection, []).append(created)
        return self._public_row(collection, created)

    insert = create

    def update(self, collection_name: str, item_id: str | int, patch: dict) -> dict:
        collection = collection_name.removesuffix(".json")
        normalized_patch = self._normalize_user(patch) if collection == "users" else deepcopy(patch)
        for item in self.rows.setdefault(collection, []):
            if str(item.get("id")) == str(item_id):
                item.update(normalized_patch)
                return self._public_row(collection, item)
        raise HTTPException(status_code=404, detail="Record not found")

    def update_where(self, collection_name: str, filters: dict, patch: dict) -> int:
        collection = collection_name.removesuffix(".json")
        normalized_patch = self._normalize_user(patch) if collection == "users" else deepcopy(patch)
        updated = 0
        for item in self.rows.setdefault(collection, []):
            if all(str(item.get(key)) == str(value) for key, value in filters.items()):
                item.update(normalized_patch)
                updated += 1
        return updated

    def delete(self, collection_name: str, item_id: str | int) -> None:
        collection = collection_name.removesuffix(".json")
        rows = self.rows.setdefault(collection, [])
        for index, item in enumerate(rows):
            if str(item.get("id")) == str(item_id):
                rows.pop(index)
                if collection == "steps":
                    for log in self.rows.setdefault("step_logs", []):
                        if str(log.get("step_id")) == str(item_id):
                            log["step_id"] = None
                    self.rows["step_edges"] = [
                        edge
                        for edge in self.rows.setdefault("step_edges", [])
                        if str(edge.get("parent_step_id")) != str(item_id)
                        and str(edge.get("child_step_id")) != str(item_id)
                    ]
                return
        raise HTTPException(status_code=404, detail="Record not found")

    def delete_where(self, collection_name: str, filters: dict) -> int:
        collection = collection_name.removesuffix(".json")
        rows = self.rows.setdefault(collection, [])
        remaining = [item for item in rows if not all(str(item.get(key)) == str(value) for key, value in filters.items())]
        deleted = len(rows) - len(remaining)
        self.rows[collection] = remaining
        return deleted

    def lock_by_id(self, collection_name: str, item_id: str | int) -> dict | None:
        return self.get_by_id(collection_name, item_id)

    @contextmanager
    def transaction(self):
        snapshot = deepcopy(self.rows)
        next_ids = deepcopy(self._next_ids)
        try:
            yield self
        except Exception:
            self.rows = snapshot
            self._next_ids = next_ids
            raise

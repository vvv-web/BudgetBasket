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

    def _validate_parent_category(self, collection: str, parent_id: str | None, unit_id: str | None) -> None:
        if not parent_id:
            return
        parent = self.repo.get_by_id(collection, parent_id)
        if not parent or parent.get("parent_id"):
            raise HTTPException(status_code=400, detail="Для статьи выберите существующую категорию")
        if not self._same_id(parent.get("unit_id"), unit_id):
            raise HTTPException(status_code=400, detail="Категория должна относиться к тому же подразделению, что и статья")

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
        items = self.repo.load_all(collection)
        by_id = {item["id"]: item for item in items}
        active_child_parent_ids = {
            item["parent_id"]
            for item in items
            if item.get("parent_id")
            and item.get("is_active", True)
            and (not department_id or item.get("unit_id") == department_id)
        }
        result = []
        for item in items:
            if department_id and item.get("unit_id") != department_id:
                continue
            if active_only and not item.get("is_active", True) and item.get("id") not in active_child_parent_ids:
                continue
            if needle:
                parent = by_id.get(item.get("parent_id"))
                haystack = f"{item.get('name', '')} {parent.get('name', '') if parent else ''}".lower()
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
        self._validate_parent_category(collection, item["parent_id"], item["unit_id"])
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
        reference_field = "dds_id" if collection == "dds_catalog" else "invest_id"
        is_used = any(
            item.get(reference_field) == item_id
            for item in self.repo.load_all("req_items")
        )
        if is_used and (
            not self._same_id(current.get("parent_id"), merged.get("parent_id"))
            or not self._same_id(current.get("unit_id"), merged.get("unit_id"))
        ):
            raise HTTPException(
                status_code=400,
                detail="Нельзя переместить запись НСИ, пока она используется в заявках. Создайте нужную категорию и перенесите строку черновика на другую статью.",
            )
        self._validate_parent_category(collection, merged.get("parent_id"), merged.get("unit_id"))
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

        reference_field = "dds_id" if collection == "dds_catalog" else "invest_id"
        if any(item.get(reference_field) == item_id for item in self.repo.load_all("req_items")):
            raise HTTPException(status_code=400, detail="Нельзя удалить запись, пока она используется в заявках")

        if any(item.get("parent_id") == item_id for item in self.repo.load_all(collection)):
            raise HTTPException(status_code=400, detail="Нельзя удалить категорию, пока в ней есть статьи. Сначала перенесите статьи в другую категорию")

        self.repo.delete(collection, item_id)

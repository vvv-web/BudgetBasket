from fastapi import HTTPException

from app.repositories.base import Repository
from app.services.common import require_role


class CatalogService:
    """NSI hierarchy: roots are articles/projects, children are categories."""

    COLLECTIONS = {"dds": "dds_catalog", "invests": "invests_catalog"}

    def __init__(self, repo: Repository):
        self.repo = repo

    def collection_name(self, kind: str) -> str:
        if kind not in self.COLLECTIONS:
            raise HTTPException(status_code=400, detail="Неизвестный тип справочника")
        return self.COLLECTIONS[kind]

    def department_id_for_unit(self, unit_id: str | None) -> str | None:
        if not unit_id:
            return None
        units = {item["id"]: item for item in self.repo.load_all("units")}
        unit = units.get(unit_id)
        if not unit:
            return None
        visited: set[str] = set()
        while unit.get("parent_id") and unit["id"] not in visited:
            visited.add(unit["id"])
            parent = units.get(unit["parent_id"])
            if not parent:
                break
            unit = parent
        return unit["id"]

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
        self, collection: str, *, parent_id: str | None, unit_id: str | None,
        name: str, exclude_id: str | None = None,
    ) -> None:
        duplicate = next(
            (
                item for item in self.repo.load_all(collection)
                if item.get("id") != exclude_id
                and self._same_id(item.get("parent_id"), parent_id)
                and self._same_id(item.get("unit_id"), unit_id)
                and self._normalized_name(item.get("name")) == self._normalized_name(name)
            ),
            None,
        )
        if duplicate:
            raise HTTPException(status_code=400, detail="Запись с таким наименованием уже существует")

    def _children(self, collection: str, article_id: str) -> list[dict]:
        return [
            item for item in self.repo.load_all(collection)
            if self._same_id(item.get("parent_id"), article_id)
        ]

    def _create_default_category(self, collection: str, article: dict) -> dict | None:
        """Create the fallback only while the article has no child categories."""
        if self._children(collection, article["id"]):
            return None
        return self.repo.create(collection, {
            "parent_id": article["id"],
            "name": article["name"],
            "is_active": article["is_active"],
            "unit_id": article["unit_id"],
        })

    def _validate_parent_article(self, collection: str, parent_id: str | None, unit_id: str | None) -> None:
        if not parent_id:
            return
        parent = self.repo.get_by_id(collection, parent_id)
        if not parent or parent.get("parent_id"):
            raise HTTPException(status_code=400, detail="Категорию можно добавить только к существующей статье или инвест-проекту")
        if not self._same_id(parent.get("unit_id"), unit_id):
            raise HTTPException(status_code=400, detail="Категория должна относиться к тому же объединению, что и статья")

    def _require_category_manager(self, user: dict, department_id: str | None) -> None:
        if user.get("role") == "admin":
            return
        if user.get("role") != "economist":
            raise HTTPException(status_code=403, detail="Недостаточно прав для управления категориями")
        units = {item["id"]: item for item in self.repo.load_all("units")}
        assigned_cfos = {
            item["unit_id"]
            for item in self.repo.load_all("units_responsibles")
            if item.get("user_id") == user.get("id")
            and item.get("is_active")
            and units.get(item.get("unit_id"), {}).get("parent_id") == department_id
        }
        if not assigned_cfos:
            raise HTTPException(status_code=403, detail="Экономист не назначен на ЦФО этого объединения")

    def list_catalog(
        self, collection: str, *, unit_id: str | None = None, module_id: str | None = None,
        active_only: bool = False, query: str | None = None,
    ) -> list[dict]:
        department_id = self.department_id_for_unit(module_id or unit_id)
        needle = (query or "").strip().lower()
        items = self.repo.load_all(collection)
        by_id = {item["id"]: item for item in items}
        result = []
        for item in items:
            if department_id and item.get("unit_id") != department_id:
                continue
            if active_only and not item.get("is_active", True):
                continue
            if needle:
                parent = by_id.get(item.get("parent_id"))
                if needle not in f"{item.get('name', '')} {parent.get('name', '') if parent else ''}".lower():
                    continue
            impact = self.delete_impact(collection, item)
            result.append({
                **item,
                "can_delete": impact is None,
                "delete_block_reason": impact,
            })
        return result

    def create_catalog(self, user: dict, collection: str, payload: dict) -> dict:
        unit_id = self.department_id_for_unit(payload.get("unit_id")) if payload.get("unit_id") else self._default_department_id()
        item = {
            "parent_id": payload.get("parent_id"),
            "name": payload["name"].strip(),
            "is_active": payload.get("is_active", True),
            "unit_id": unit_id,
        }
        if not item["name"]:
            raise HTTPException(status_code=422, detail="Укажите наименование")
        if item["parent_id"]:
            self._require_category_manager(user, unit_id)
            self._validate_parent_article(collection, item["parent_id"], unit_id)
            self._ensure_unique_item(collection, parent_id=item["parent_id"], unit_id=unit_id, name=item["name"])
            return self.repo.create(collection, item)

        require_role(user, "admin")
        self._ensure_unique_item(collection, parent_id=None, unit_id=unit_id, name=item["name"])
        create_default_category = payload.get("create_default_category", True)
        with self.repo.transaction() as repo:
            article = repo.create(collection, item)
            if create_default_category:
                children = [
                    entry for entry in repo.load_all(collection)
                    if self._same_id(entry.get("parent_id"), article["id"])
                ]
                if not children:
                    repo.create(collection, {
                        "parent_id": article["id"], "name": article["name"],
                        "is_active": article["is_active"], "unit_id": article["unit_id"],
                    })
        return article

    def ensure_default_category(self, user: dict, collection: str, article_id: str) -> dict:
        article = self.repo.get_by_id(collection, article_id)
        if not article or article.get("parent_id"):
            raise HTTPException(status_code=404, detail="Статья или инвест-проект не найден")
        self._require_category_manager(user, article.get("unit_id"))
        category = self._create_default_category(collection, article)
        return {"created": bool(category), "item": category}

    def update_catalog(self, user: dict, collection: str, item_id: str, patch: dict) -> dict:
        current = self.repo.get_by_id(collection, item_id)
        if not current:
            raise HTTPException(status_code=404, detail="Запись не найдена")
        allowed = {key: patch[key] for key in ("parent_id", "name", "is_active", "unit_id") if key in patch}
        if current.get("parent_id"):
            self._require_category_manager(user, current.get("unit_id"))
            if "parent_id" in allowed and not self._same_id(allowed["parent_id"], current["parent_id"]):
                raise HTTPException(status_code=400, detail="Нельзя перенести категорию в другую статью")
            if "unit_id" in allowed and not self._same_id(allowed["unit_id"], current.get("unit_id")):
                raise HTTPException(status_code=400, detail="Нельзя перенести категорию в другое объединение")
            allowed.pop("parent_id", None)
            allowed.pop("unit_id", None)
        else:
            require_role(user, "admin")
            if "unit_id" in allowed and allowed["unit_id"]:
                allowed["unit_id"] = self.department_id_for_unit(allowed["unit_id"])

        if "name" in allowed:
            allowed["name"] = allowed["name"].strip()
            if not allowed["name"]:
                raise HTTPException(status_code=422, detail="Укажите наименование")
        merged = {**current, **allowed}
        reference_field = "dds_id" if collection == "dds_catalog" else "invest_id"
        is_used = any(item.get(reference_field) == item_id for item in self.repo.load_all("req_items"))
        if is_used and not self._same_id(current.get("unit_id"), merged.get("unit_id")):
            raise HTTPException(status_code=400, detail="Нельзя переместить используемую запись НСИ")
        self._validate_parent_article(collection, merged.get("parent_id"), merged.get("unit_id"))
        self._ensure_unique_item(
            collection, parent_id=merged.get("parent_id"), unit_id=merged.get("unit_id"),
            name=merged.get("name", ""), exclude_id=item_id,
        )
        return self.repo.update(collection, item_id, allowed)

    def delete_impact(self, collection: str, target: dict) -> str | None:
        reference_field = "dds_id" if collection == "dds_catalog" else "invest_id"
        if self._children(collection, target["id"]):
            entity = "статью" if collection == "dds_catalog" else "инвест-проект"
            return f"Нельзя удалить {entity}: у неё существуют категории." if entity == "статью" else f"Нельзя удалить {entity}: у него существуют категории."
        if any(item.get(reference_field) == target["id"] for item in self.repo.load_all("req_items")):
            return "Запись используется в заявках и не может быть удалена. Деактивируйте её."
        return None

    def delete_catalog(self, user: dict, collection: str, item_id: str) -> None:
        target = self.repo.get_by_id(collection, item_id)
        if not target:
            raise HTTPException(status_code=404, detail="Запись не найдена")
        if target.get("parent_id"):
            self._require_category_manager(user, target.get("unit_id"))
        else:
            require_role(user, "admin")
        impact = self.delete_impact(collection, target)
        if impact:
            raise HTTPException(status_code=409, detail=impact)
        self.repo.delete(collection, item_id)

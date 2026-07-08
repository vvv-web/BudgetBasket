from fastapi import HTTPException

from app.models import ItemStatus, RequestStatus
from app.repositories.json_repository import JsonRepository
from app.services.common import get_required
from app.services.permission_service import PermissionService
from app.services.request_service import RequestService


class BudgetItemService:
    def __init__(self, repo: JsonRepository, permissions: PermissionService, requests: RequestService):
        self.repo = repo
        self.permissions = permissions
        self.requests = requests

    @staticmethod
    def collection(kind: str) -> str:
        return "dds_items" if kind == "dds" else "invest_items"

    @staticmethod
    def catalog_collection(kind: str) -> str:
        return "dds_catalog" if kind == "dds" else "invests_catalog"

    def list_items(self, user: dict, request_id: str, kind: str) -> list[dict]:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_view_request(user, request)
        return [item for item in self.repo.load_all(self.collection(kind)) if item["request_id"] == request_id]

    def _resolve_category_id(self, kind: str, article_id: str) -> str | None:
        article = self.repo.get_by_id(self.catalog_collection(kind), article_id)
        if not article:
            raise HTTPException(status_code=400, detail="Элемент справочника не найден")
        return article.get("parent_id")

    def create_item(self, user: dict, request_id: str, kind: str, payload: dict) -> dict:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_employee_edit_request(user, request)
        field = "dds_id" if kind == "dds" else "invest_id"
        article_id = payload.get(field)
        if not article_id:
            raise HTTPException(status_code=400, detail="Не выбран справочник строки")
        item = {
            "request_id": request_id,
            field: article_id,
            "category_id": self._resolve_category_id(kind, article_id),
            "sum_plan": payload["sum_plan"],
            "sum_fact": None,
            "status": ItemStatus.on_review,
            "comment": None,
        }
        created = self.repo.create(self.collection(kind), item)
        self.requests.recalculate_total(request_id)
        return created

    def _find_item(self, item_id: str) -> tuple[str, dict]:
        for collection in ("dds_items", "invest_items"):
            item = self.repo.get_by_id(collection, item_id)
            if item:
                return collection, item
        raise HTTPException(status_code=404, detail="Строка бюджета не найдена")

    @staticmethod
    def _normalize_patch(item: dict, patch: dict, economist: bool) -> dict:
        if economist:
            allowed = {key: patch[key] for key in ("status", "sum_fact", "comment") if key in patch}
            status = allowed.get("status", item["status"])
            if status == ItemStatus.approved and allowed.get("sum_fact") is None and item.get("sum_fact") is None:
                allowed["sum_fact"] = item["sum_plan"]
            if status == ItemStatus.approved_with_changes and allowed.get("sum_fact", item.get("sum_fact")) is None:
                raise HTTPException(status_code=400, detail="Для принятия с корректировкой нужна утвержденная сумма")
            if status == ItemStatus.rejected and allowed.get("sum_fact", item.get("sum_fact")) not in (None, 0):
                raise HTTPException(status_code=400, detail="Для отказа утвержденная сумма должна быть 0 или пустой")
            return allowed
        return {key: patch[key] for key in ("dds_id", "invest_id", "sum_plan") if key in patch}

    def patch_item(self, user: dict, item_id: str, patch: dict) -> dict:
        collection, item = self._find_item(item_id)
        request = get_required(self.repo, "requests", item["request_id"])
        if request["status"] in {RequestStatus.approved, RequestStatus.partially_approved, RequestStatus.rejected, RequestStatus.cancelled}:
            raise HTTPException(status_code=400, detail="Завершённую заявку нельзя редактировать")
        if user["role"] == "economist":
            self.permissions.require_economist_review_request(user, request)
            normalized = self._normalize_patch(item, patch, True)
        else:
            self.permissions.require_employee_edit_request(user, request)
            normalized = self._normalize_patch(item, patch, False)
            kind = "dds" if collection == "dds_items" else "invest"
            article_field = "dds_id" if kind == "dds" else "invest_id"
            if article_field in normalized and normalized[article_field]:
                normalized["category_id"] = self._resolve_category_id(kind, normalized[article_field])
        updated = self.repo.update(collection, item_id, normalized)
        self.requests.recalculate_total(item["request_id"])
        return updated

    def delete_item(self, user: dict, item_id: str) -> None:
        collection, item = self._find_item(item_id)
        request = get_required(self.repo, "requests", item["request_id"])
        self.permissions.require_employee_edit_request(user, request)
        self.repo.delete(collection, item_id)
        links_collection = "dds_item_files" if collection == "dds_items" else "invest_item_files"
        key = "dds_item_id" if collection == "dds_items" else "invest_item_id"
        self.repo.save_all(links_collection, [link for link in self.repo.load_all(links_collection) if link.get(key) != item_id])
        self.requests.recalculate_total(item["request_id"])

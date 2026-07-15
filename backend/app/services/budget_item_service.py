from fastapi import HTTPException

from app.models import ItemStatus, RequestStatus
from app.repositories.base import Repository
from app.services.common import get_required
from app.services.permission_service import PermissionService
from app.services.request_service import RequestService


class BudgetItemService:
    def __init__(self, repo: Repository, permissions: PermissionService, requests: RequestService):
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
        budget_request = get_required(self.repo, "requests", request_id)
        self.permissions.require_view_request(user, budget_request)
        return [item for item in self.repo.load_all(self.collection(kind)) if item["request_id"] == request_id]

    def _resolve_category_id(self, kind: str, article_id: str) -> str | None:
        article = self.repo.get_by_id(self.catalog_collection(kind), article_id)
        if not article:
            raise HTTPException(status_code=400, detail="Catalog item not found")
        parent = self.repo.get_by_id(self.catalog_collection(kind), article["parent_id"]) if article.get("parent_id") else None
        if not article.get("is_active", True) or (parent is not None and not parent.get("is_active", True)):
            raise HTTPException(status_code=400, detail="Нельзя использовать неактивную запись НСИ в строке заявки")
        return article.get("parent_id")

    def create_item(self, user: dict, request_id: str, kind: str, payload: dict) -> dict:
        budget_request = get_required(self.repo, "requests", request_id)
        self.permissions.require_request_unfrozen(budget_request)
        self.permissions.require_employee_edit_request(user, budget_request)

        field = "dds_id" if kind == "dds" else "invest_id"
        article_id = payload.get(field)
        if not article_id:
            raise HTTPException(status_code=400, detail="Budget item catalog article is required")
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
        raise HTTPException(status_code=404, detail="Budget item not found")

    @staticmethod
    def _normalize_patch(item: dict, patch: dict, role: str) -> dict:
        if role == "economist":
            forbidden = set(patch) - {"status", "sum_fact", "comment"}
            if forbidden:
                raise HTTPException(status_code=403, detail="Economist cannot change employee fields")
            allowed = {key: patch[key] for key in ("status", "sum_fact", "comment") if key in patch}
            status = allowed.get("status", item["status"])
            sum_fact = allowed.get("sum_fact", item.get("sum_fact"))
            if status == ItemStatus.approved:
                if sum_fact is None:
                    allowed["sum_fact"] = item["sum_plan"]
                elif float(sum_fact) != float(item["sum_plan"]):
                    raise HTTPException(status_code=400, detail="Для статуса «Утверждено» фактическая сумма должна быть равна плановой")
            if status == ItemStatus.approved_with_changes and sum_fact is None:
                raise HTTPException(status_code=400, detail="sum_fact is required for approved_with_changes")
            if status == ItemStatus.approved_with_changes and float(sum_fact) == float(item["sum_plan"]):
                raise HTTPException(status_code=400, detail="Для статуса «Утверждено с изменениями» фактическая сумма должна отличаться от плановой")
            if status == ItemStatus.rejected and sum_fact not in (None, 0):
                raise HTTPException(status_code=400, detail="sum_fact must be empty or 0 for rejected items")
            if status == ItemStatus.rejected:
                allowed["sum_fact"] = 0
            return allowed
        forbidden = set(patch) - {"dds_id", "invest_id", "sum_plan"}
        if forbidden:
            raise HTTPException(status_code=403, detail="Employee cannot change review fields")
        return {key: patch[key] for key in ("dds_id", "invest_id", "sum_plan") if key in patch}

    def patch_item(self, user: dict, item_id: str, patch: dict) -> dict:
        collection, item = self._find_item(item_id)
        budget_request = get_required(self.repo, "requests", item["request_id"])
        self.permissions.require_request_unfrozen(budget_request)
        if budget_request["status"] in {
            RequestStatus.approved,
            RequestStatus.approved_with_changes,
            RequestStatus.partially_approved,
            RequestStatus.rejected,
            RequestStatus.cancelled,
        }:
            raise HTTPException(status_code=400, detail="Completed request cannot be edited")

        if user["role"] == "economist":
            self.permissions.require_economist_review_request(user, budget_request)
            normalized = self._normalize_patch(item, patch, "economist")
        else:
            self.permissions.require_employee_edit_request(user, budget_request)
            normalized = self._normalize_patch(item, patch, "employee")

        if not normalized:
            return item

        kind = "dds" if collection == "dds_items" else "invest"
        article_field = "dds_id" if kind == "dds" else "invest_id"
        if article_field in normalized and normalized[article_field]:
            normalized["category_id"] = self._resolve_category_id(kind, normalized[article_field])

        updated = self.repo.update(collection, item_id, normalized)
        self.requests.recalculate_total(item["request_id"])
        return updated

    def delete_item(self, user: dict, item_id: str) -> None:
        collection, item = self._find_item(item_id)
        budget_request = get_required(self.repo, "requests", item["request_id"])
        self.permissions.require_request_unfrozen(budget_request)
        self.permissions.require_employee_edit_request(user, budget_request)
        links_collection = "dds_item_files" if collection == "dds_items" else "invest_item_files"
        key = "dds_item_id" if collection == "dds_items" else "invest_item_id"
        self.repo.delete_where(links_collection, {key: item_id})
        self.repo.delete(collection, item_id)
        self.requests.recalculate_total(item["request_id"])

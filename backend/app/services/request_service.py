from fastapi import HTTPException

from app.models import APPROVED_ITEM_STATUSES, ItemStatus, RequestStatus
from app.repositories.base import Repository
from app.services.common import get_required
from app.services.permission_service import PermissionService


class RequestService:
    def __init__(self, repo: Repository, permissions: PermissionService):
        self.repo = repo
        self.permissions = permissions

    def _items(self, request_id: str) -> list[dict]:
        return [
            *[item for item in self.repo.load_all("dds_items") if item["request_id"] == request_id],
            *[item for item in self.repo.load_all("invest_items") if item["request_id"] == request_id],
        ]

    @staticmethod
    def public_request(request: dict, summary: dict | None = None) -> dict:
        return {**request, "total_approved_sum": request.get("sum", 0), "summary": summary}

    def summary(self, request_id: str) -> dict:
        items = self._items(request_id)
        accepted = [item for item in items if item["status"] in APPROVED_ITEM_STATUSES]
        rejected = [item for item in items if item["status"] == ItemStatus.rejected]
        in_review = [item for item in items if item["status"] == ItemStatus.on_review]
        return {
            "request_id": request_id,
            "planned_sum": sum(float(item.get("sum_plan") or 0) for item in items),
            "approved_sum": sum(float(item.get("sum_fact") or 0) for item in accepted),
            "items_count": len(items),
            "accepted_count": len(accepted),
            "rejected_count": len(rejected),
            "in_review_count": len(in_review),
        }

    def recalculate_total(self, request_id: str) -> dict:
        summary = self.summary(request_id)
        return self.repo.update("requests", request_id, {"sum": summary["planned_sum"]})

    def list_requests(
        self,
        user: dict,
        status: str | None = None,
        unit_id: str | None = None,
        created_from: str | None = None,
        created_to: str | None = None,
    ) -> list[dict]:
        visible = self.permissions.visible_request_ids(user)
        result = []
        for budget_request in self.repo.load_all("requests"):
            if visible is not None and budget_request["id"] not in visible:
                continue
            if status and budget_request.get("status") != status:
                continue
            if unit_id and budget_request.get("unit_id") != unit_id:
                continue
            created_at = str(budget_request.get("created_at") or "")
            if created_from and created_at and created_at < created_from:
                continue
            if created_to and created_at and created_at > created_to:
                continue
            result.append(self.public_request(budget_request, self.summary(budget_request["id"])))
        return result

    def get_request(self, user: dict, request_id: str) -> dict:
        budget_request = get_required(self.repo, "requests", request_id)
        self.permissions.require_view_request(user, budget_request)
        return self.public_request(budget_request, self.summary(request_id))

    def create_request(self, user: dict, payload: dict) -> dict:
        if user["role"] not in {"employee", "admin"}:
            raise HTTPException(status_code=403, detail="Only employee or admin can create requests")
        if user["role"] == "employee" and payload["unit_id"] not in self.permissions.employee_module_ids(user["id"]):
            raise HTTPException(status_code=403, detail="Employee is not responsible for this unit")
        item = {
            "economist_id": payload.get("economist_id"),
            "unit_id": payload["unit_id"],
            "sum": 0,
            "status": RequestStatus.draft,
        }
        created = self.repo.create("requests", item)
        return self.public_request(created, self.summary(created["id"]))

    def delete_request(self, user: dict, request_id: str) -> None:
        budget_request = get_required(self.repo, "requests", request_id)
        self.permissions.require_request_delete_request(user, budget_request)

        dds_item_ids = {item["id"] for item in self.repo.load_all("dds_items") if item["request_id"] == request_id}
        invest_item_ids = {item["id"] for item in self.repo.load_all("invest_items") if item["request_id"] == request_id}
        for item_id in dds_item_ids:
            self.repo.delete_where("dds_item_files", {"dds_item_id": item_id})
        for item_id in invest_item_ids:
            self.repo.delete_where("invest_item_files", {"invest_item_id": item_id})
        self.repo.delete_where("dds_items", {"request_id": request_id})
        self.repo.delete_where("invest_items", {"request_id": request_id})
        self.repo.delete("requests", request_id)

    def patch_request(self, user: dict, request_id: str, patch: dict) -> dict:
        budget_request = get_required(self.repo, "requests", request_id)
        if user["role"] == "admin":
            return self.public_request(
                self.repo.update(
                    "requests",
                    request_id,
                    {key: value for key, value in patch.items() if key in {"economist_id", "unit_id", "sum", "status"}},
                ),
                self.summary(request_id),
            )
        self.permissions.require_employee_edit_request(user, budget_request)
        return self.public_request(budget_request, self.summary(request_id))

    def submit(self, user: dict, request_id: str) -> dict:
        budget_request = get_required(self.repo, "requests", request_id)
        self.permissions.require_employee_edit_request(user, budget_request)
        if not self._items(request_id):
            raise HTTPException(status_code=400, detail="Cannot submit request without budget items")
        for collection in ("dds_items", "invest_items"):
            for item in self.repo.load_all(collection):
                if item["request_id"] == request_id:
                    self.repo.update(collection, item["id"], {"status": ItemStatus.on_review})
        return self.public_request(self.repo.update("requests", request_id, {"status": RequestStatus.on_review}), self.summary(request_id))

    def start_review(self, user: dict, request_id: str) -> dict:
        budget_request = get_required(self.repo, "requests", request_id)
        self.permissions.require_economist_review_request(user, budget_request)
        if budget_request["status"] != RequestStatus.on_review:
            raise HTTPException(status_code=400, detail="Request cannot be taken into review")
        return self.public_request(
            self.repo.update("requests", request_id, {"status": RequestStatus.on_review, "economist_id": user["id"]}),
            self.summary(request_id),
        )

    @staticmethod
    def status_from_items(items: list[dict]) -> RequestStatus:
        accepted = [item for item in items if item["status"] in APPROVED_ITEM_STATUSES]
        rejected = [item for item in items if item["status"] == ItemStatus.rejected]
        changed = [item for item in items if item["status"] == ItemStatus.approved_with_changes]
        if accepted and rejected:
            return RequestStatus.partially_approved
        if accepted and len(accepted) == len(items):
            return RequestStatus.approved_with_changes if changed else RequestStatus.approved
        return RequestStatus.rejected

    def refresh_review_status(self, request_id: str) -> dict | None:
        budget_request = get_required(self.repo, "requests", request_id)
        if budget_request.get("status") != RequestStatus.on_review:
            return None
        items = self._items(request_id)
        if not items or any(item["status"] == ItemStatus.on_review for item in items):
            return None
        self.recalculate_total(request_id)
        return self.repo.update("requests", request_id, {"status": self.status_from_items(items)})

    def finalize(self, user: dict, request_id: str) -> dict:
        budget_request = get_required(self.repo, "requests", request_id)
        self.permissions.require_economist_review_request(user, budget_request)
        items = self._items(request_id)
        if not items:
            raise HTTPException(status_code=400, detail="Cannot finalize request without items")
        if any(item["status"] == ItemStatus.on_review for item in items):
            raise HTTPException(status_code=400, detail="Cannot finalize request while items are on review")

        self.recalculate_total(request_id)
        return self.public_request(
            self.repo.update("requests", request_id, {"status": self.status_from_items(items)}),
            self.summary(request_id),
        )

    def fix(self, user: dict, request_id: str) -> dict:
        return self.finalize(user, request_id)

    def reopen(self, user: dict, request_id: str) -> dict:
        budget_request = get_required(self.repo, "requests", request_id)
        self.permissions.require_economist_review_request(user, budget_request)
        if budget_request["status"] not in {
            RequestStatus.approved,
            RequestStatus.approved_with_changes,
            RequestStatus.partially_approved,
            RequestStatus.rejected,
        }:
            raise HTTPException(status_code=400, detail="Only completed request can be reopened")
        return self.public_request(self.repo.update("requests", request_id, {"status": RequestStatus.draft}), self.summary(request_id))

    def unfreeze(self, user: dict, request_id: str) -> dict:
        return self.reopen(user, request_id)

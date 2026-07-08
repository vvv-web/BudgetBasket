from fastapi import HTTPException

from app.models import APPROVED_ITEM_STATUSES, ItemStatus, RequestStatus
from app.repositories.json_repository import JsonRepository
from app.services.common import get_required
from app.services.permission_service import PermissionService


class RequestService:
    def __init__(self, repo: JsonRepository, permissions: PermissionService):
        self.repo = repo
        self.permissions = permissions

    def _items(self, request_id: str) -> list[dict]:
        return [
            *[item for item in self.repo.load_all("dds_items") if item["request_id"] == request_id],
            *[item for item in self.repo.load_all("invest_items") if item["request_id"] == request_id],
        ]

    @staticmethod
    def public_request(request: dict, summary: dict | None = None) -> dict:
        return {
            **request,
            "total_approved_sum": request.get("sum", 0),
            "summary": summary,
        }

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
        return self.repo.update("requests", request_id, {"sum": summary["approved_sum"]})

    def list_requests(self, user: dict, status: str | None = None, unit_id: str | None = None) -> list[dict]:
        visible = self.permissions.visible_request_ids(user)
        requests = self.repo.load_all("requests")
        result = []
        for request in requests:
            if visible is not None and request["id"] not in visible:
                continue
            if status and request.get("status") != status:
                continue
            if unit_id and request.get("unit_id") != unit_id:
                continue
            summary = self.summary(request["id"])
            result.append(self.public_request(request, summary))
        return result

    def get_request(self, user: dict, request_id: str) -> dict:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_view_request(user, request)
        return self.public_request(request, self.summary(request_id))

    def create_request(self, user: dict, payload: dict) -> dict:
        if user["role"] != "employee":
            raise HTTPException(status_code=403, detail="Заявки создает только сотрудник")
        if payload["unit_id"] not in self.permissions.employee_module_ids(user["id"]):
            raise HTTPException(status_code=403, detail="Сотрудник не является ответственным за модуль")
        item = {
            "economist_id": None,
            "unit_id": payload["unit_id"],
            "sum": 0,
            "status": RequestStatus.draft,
        }
        created = self.repo.create("requests", item)
        return self.public_request(created, self.summary(created["id"]))

    def patch_request(self, user: dict, request_id: str, patch: dict) -> dict:
        request = get_required(self.repo, "requests", request_id)
        if user["role"] == "admin":
            return self.public_request(
                self.repo.update(
                    "requests",
                    request_id,
                    {key: value for key, value in patch.items() if key in {"economist_id", "unit_id", "sum", "status"}},
                ),
                self.summary(request_id),
            )
        self.permissions.require_employee_edit_request(user, request)
        return self.public_request(request, self.summary(request_id))

    def submit(self, user: dict, request_id: str) -> dict:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_employee_edit_request(user, request)
        if not self._items(request_id):
            raise HTTPException(status_code=400, detail="Нельзя отправить заявку без строк бюджета")
        return self.public_request(
            self.repo.update("requests", request_id, {"status": RequestStatus.on_review}),
            self.summary(request_id),
        )

    def start_review(self, user: dict, request_id: str) -> dict:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_economist_review_request(user, request)
        if request["status"] != RequestStatus.on_review:
            raise HTTPException(status_code=400, detail="Заявку нельзя взять в проверку")
        return self.public_request(
            self.repo.update("requests", request_id, {"status": RequestStatus.on_review, "economist_id": user["id"]}),
            self.summary(request_id),
        )

    def finalize(self, user: dict, request_id: str) -> dict:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_economist_review_request(user, request)
        items = self._items(request_id)
        if not items:
            raise HTTPException(status_code=400, detail="Нельзя завершить заявку без строк")
        if any(item["status"] == ItemStatus.on_review for item in items):
            raise HTTPException(status_code=400, detail="Нельзя завершить заявку со строками на рассмотрении")

        accepted = [item for item in items if item["status"] in APPROVED_ITEM_STATUSES]
        rejected = [item for item in items if item["status"] == ItemStatus.rejected]
        if accepted and rejected:
            status = RequestStatus.partially_approved
        elif accepted:
            status = RequestStatus.approved
        else:
            status = RequestStatus.rejected

        self.recalculate_total(request_id)
        return self.public_request(
            self.repo.update("requests", request_id, {"status": status}),
            self.summary(request_id),
        )

    # Backward-compatible alias used by older routes/tests naming
    def fix(self, user: dict, request_id: str) -> dict:
        return self.finalize(user, request_id)

    def reopen(self, user: dict, request_id: str) -> dict:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_economist_review_request(user, request)
        if request["status"] not in {
            RequestStatus.approved,
            RequestStatus.partially_approved,
            RequestStatus.rejected,
        }:
            raise HTTPException(status_code=400, detail="Вернуть в черновик можно только завершённую заявку")
        return self.public_request(
            self.repo.update("requests", request_id, {"status": RequestStatus.draft}),
            self.summary(request_id),
        )

    def unfreeze(self, user: dict, request_id: str) -> dict:
        return self.reopen(user, request_id)

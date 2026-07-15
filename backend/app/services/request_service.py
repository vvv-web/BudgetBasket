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

    def _assigned_economist_id(self, unit_id: str) -> str | None:
        users = {item["id"]: item for item in self.repo.load_all("users")}
        assignments = [
            item
            for item in self.repo.load_all("units_responsibles")
            if item.get("unit_id") == unit_id
            and item.get("is_active")
            and users.get(item.get("user_id"), {}).get("role") == "economist"
        ]
        if len(assignments) > 1:
            raise HTTPException(status_code=409, detail="Для модуля назначено несколько экономистов. Оставьте одного активного экономиста")
        return assignments[0]["user_id"] if assignments else None

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

    def dashboard(self, user: dict, unit_id: str | None = None) -> dict:
        """Return pre-aggregated budget data within the caller's permitted scope."""
        visible = self.permissions.visible_request_ids(user)
        units = {item["id"]: item for item in self.repo.load_all("units")}

        def root_unit_id(value: str | None) -> str | None:
            current_id = value
            visited: set[str] = set()
            while current_id and current_id not in visited:
                visited.add(current_id)
                current = units.get(current_id)
                if not current or not current.get("parent_id"):
                    return current_id
                current_id = current["parent_id"]
            return value

        allowed_module_ids = (
            {item["id"] for item in units.values() if item.get("parent_id")}
            if visible is None
            else self.permissions.economist_module_ids(user["id"])
            if user["role"] == "economist"
            else self.permissions.employee_module_ids(user["id"])
        )
        available_root_ids = {root_unit_id(item_id) for item_id in allowed_module_ids}
        available_units = [
            {"id": item["id"], "name": item["name"], "parent_id": item.get("parent_id")}
            for item in units.values()
            if item["id"] in available_root_ids and not item.get("parent_id")
        ]
        available_units.sort(key=lambda item: item["name"])

        requests = [
            item
            for item in self.repo.load_all("requests")
            if (
                (visible is None or item["id"] in visible)
                and item.get("status") not in {RequestStatus.draft, RequestStatus.cancelled}
                and (not unit_id or root_unit_id(item.get("unit_id")) == unit_id)
            )
        ]
        request_ids = {item["id"] for item in requests}
        frozen_request_ids = {item["id"] for item in requests if item.get("budget_frozen")}
        request_unit_ids = {item["id"]: root_unit_id(item["unit_id"]) for item in requests}
        dds_catalog = {item["id"]: item for item in self.repo.load_all("dds_catalog")}
        invest_catalog = {item["id"]: item for item in self.repo.load_all("invests_catalog")}

        by_unit: dict[str, dict] = {}
        by_category: dict[str, dict] = {}
        by_article: dict[str, dict] = {}

        def add(target: dict, key: str, name: str, kind: str, planned: float, approved: float) -> None:
            item = target.setdefault(key, {"id": key, "name": name, "kind": kind, "planned": 0.0, "approved": 0.0, "items_count": 0})
            item["planned"] += planned
            item["approved"] += approved
            item["items_count"] += 1

        planned_total = 0.0
        approved_total = 0.0
        frozen_total = 0.0
        for kind, collection, article_field, catalog in (
            ("dds", "dds_items", "dds_id", dds_catalog),
            ("invest", "invest_items", "invest_id", invest_catalog),
        ):
            for item in self.repo.load_all(collection):
                if item.get("request_id") not in request_ids:
                    continue
                planned = float(item.get("sum_plan") or 0)
                approved = float(item.get("sum_fact") or 0) if item.get("status") in APPROVED_ITEM_STATUSES else 0.0
                planned_total += planned
                approved_total += approved
                if approved and item.get("request_id") in frozen_request_ids:
                    frozen_total += approved
                article = catalog.get(item.get(article_field), {})
                category = catalog.get(article.get("parent_id")) or article
                add(by_category, f"{kind}:{category.get('id', 'unknown')}", category.get("name", "Без категории"), kind, planned, approved)
                add(by_article, f"{kind}:{article.get('id', 'unknown')}", article.get("name", "Без статьи"), kind, planned, approved)

                request_unit_id = request_unit_ids.get(item.get("request_id"))
                unit = units.get(request_unit_id, {})
                add(by_unit, request_unit_id or "unknown", unit.get("name", "Неизвестное подразделение"), "unit", planned, approved)

        for request in ({**item, "unit_id": root_unit_id(item["unit_id"])} for item in requests):
            if request["unit_id"] not in by_unit:
                unit = units.get(request["unit_id"], {})
                by_unit[request["unit_id"]] = {"id": request["unit_id"], "name": unit.get("name", "Неизвестное подразделение"), "kind": "unit", "planned": 0.0, "approved": 0.0, "items_count": 0}

        def ordered(items: dict[str, dict]) -> list[dict]:
            return sorted(items.values(), key=lambda item: (-item["planned"], item["name"]))

        approved_requests = sum(1 for item in requests if item.get("status") in {RequestStatus.approved, RequestStatus.approved_with_changes, RequestStatus.partially_approved})
        review_requests = sum(1 for item in requests if item.get("status") == RequestStatus.on_review)
        frozen_requests = sum(1 for item in requests if item.get("budget_frozen"))
        return {
            "scope": {"unit_id": unit_id, "available_units": available_units},
            "totals": {
                "planned": planned_total,
                "approved": approved_total,
                "frozen": frozen_total,
                "remaining": max(planned_total - approved_total, 0),
                "requests_count": len(requests),
                "approved_requests_count": approved_requests,
                "review_requests_count": review_requests,
                "frozen_requests_count": frozen_requests,
            },
            "by_unit": ordered(by_unit),
            "by_category": ordered(by_category),
            "by_article": ordered(by_article),
        }

    def get_request(self, user: dict, request_id: str) -> dict:
        budget_request = get_required(self.repo, "requests", request_id)
        self.permissions.require_view_request(user, budget_request)
        return self.public_request(budget_request, self.summary(request_id))

    def counterparty_contact(self, user: dict, request_id: str) -> dict | None:
        budget_request = get_required(self.repo, "requests", request_id)
        self.permissions.require_view_request(user, budget_request)
        target_id: str | None = None
        target_role: str | None = None
        if user["role"] == "economist":
            users = {item["id"]: item for item in self.repo.load_all("users")}
            responsible = next(
                (
                    item
                    for item in self.repo.load_all("units_responsibles")
                    if item.get("unit_id") == budget_request.get("unit_id")
                    and item.get("is_active")
                    and users.get(item.get("user_id"), {}).get("role") == "employee"
                ),
                None,
            )
            if responsible:
                target_id = responsible["user_id"]
                target_role = "employee"
        elif user["role"] == "employee" and budget_request.get("economist_id"):
            target_id = budget_request["economist_id"]
            target_role = "economist"
        if not target_id:
            return None
        target = self.repo.get_by_id("users", target_id)
        if not target:
            return None
        profile = next((item for item in self.repo.load_all("profiles") if item.get("user_id") == target_id), None)
        return {"user_id": target_id, "login": target["login"], "role": target_role, "profile": profile}

    def create_request(self, user: dict, payload: dict) -> dict:
        if user["role"] != "employee":
            raise HTTPException(status_code=403, detail="Only employee can create requests")
        if payload["unit_id"] not in self.permissions.employee_module_ids(user["id"]):
            raise HTTPException(status_code=403, detail="Employee is not responsible for this unit")
        item = {
            "economist_id": self._assigned_economist_id(payload["unit_id"]),
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
        self.permissions.require_request_unfrozen(budget_request)
        self.permissions.require_employee_edit_request(user, budget_request)
        return self.public_request(budget_request, self.summary(request_id))

    def submit(self, user: dict, request_id: str) -> dict:
        budget_request = get_required(self.repo, "requests", request_id)
        self.permissions.require_request_unfrozen(budget_request)
        self.permissions.require_employee_edit_request(user, budget_request)
        if not self._items(request_id):
            raise HTTPException(status_code=400, detail="Cannot submit request without budget items")
        for collection in ("dds_items", "invest_items"):
            for item in self.repo.load_all(collection):
                if item["request_id"] == request_id:
                    self.repo.update(collection, item["id"], {"status": ItemStatus.on_review})
        economist_id = budget_request.get("economist_id") or self._assigned_economist_id(budget_request["unit_id"])
        if not economist_id:
            raise HTTPException(status_code=400, detail="Для модуля не назначен экономист")
        return self.public_request(
            self.repo.update(
                "requests",
                request_id,
                {"status": RequestStatus.on_review, "economist_id": economist_id},
            ),
            self.summary(request_id),
        )

    def withdraw(self, user: dict, request_id: str) -> dict:
        budget_request = get_required(self.repo, "requests", request_id)
        self.permissions.require_employee_withdraw_request(user, budget_request)
        return self.public_request(self.repo.update("requests", request_id, {"status": RequestStatus.draft}), self.summary(request_id))

    def cancel(self, user: dict, request_id: str) -> dict:
        budget_request = get_required(self.repo, "requests", request_id)
        self.permissions.require_employee_cancel_request(user, budget_request)
        return self.public_request(self.repo.update("requests", request_id, {"status": RequestStatus.cancelled}), self.summary(request_id))

    def start_review(self, user: dict, request_id: str) -> dict:
        budget_request = get_required(self.repo, "requests", request_id)
        self.permissions.require_request_unfrozen(budget_request)
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
        self.permissions.require_request_unfrozen(budget_request)
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
        self.permissions.require_request_unfrozen(budget_request)
        self.permissions.require_economist_review_request(user, budget_request)
        if budget_request["status"] not in {
            RequestStatus.approved,
            RequestStatus.approved_with_changes,
            RequestStatus.partially_approved,
            RequestStatus.rejected,
        }:
            raise HTTPException(status_code=400, detail="Only completed request can be reopened")
        return self.public_request(self.repo.update("requests", request_id, {"status": RequestStatus.on_review}), self.summary(request_id))

    def unfreeze(self, user: dict, request_id: str) -> dict:
        return self.reopen(user, request_id)

    def freeze_budget(self, user: dict, request_id: str) -> dict:
        budget_request = get_required(self.repo, "requests", request_id)
        self.permissions.require_budget_control_access(user, budget_request)
        if budget_request.get("budget_frozen"):
            raise HTTPException(status_code=400, detail="Budget is already frozen")
        if budget_request.get("status") not in {RequestStatus.approved, RequestStatus.approved_with_changes}:
            raise HTTPException(status_code=400, detail="Budget can be frozen only for approved request")
        return self.public_request(
            self.repo.update("requests", request_id, {"budget_frozen": True}),
            self.summary(request_id),
        )

    def unfreeze_budget(self, user: dict, request_id: str) -> dict:
        budget_request = get_required(self.repo, "requests", request_id)
        self.permissions.require_budget_control_access(user, budget_request)
        if not budget_request.get("budget_frozen"):
            raise HTTPException(status_code=400, detail="Budget is already unfrozen")
        return self.public_request(
            self.repo.update("requests", request_id, {"budget_frozen": False}),
            self.summary(request_id),
        )

    def approve_all_items(self, user: dict, request_id: str) -> dict:
        budget_request = get_required(self.repo, "requests", request_id)
        self.permissions.require_request_unfrozen(budget_request)
        self.permissions.require_economist_review_request(user, budget_request)
        if budget_request.get("status") != RequestStatus.on_review:
            raise HTTPException(status_code=400, detail="Request is not on review")
        items = self._items(request_id)
        if not items:
            raise HTTPException(status_code=400, detail="Cannot approve request without items")

        for collection in ("dds_items", "invest_items"):
            for item in self.repo.load_all(collection):
                if item["request_id"] != request_id or item["status"] != ItemStatus.on_review:
                    continue
                sum_fact = item.get("sum_fact")
                if sum_fact is None:
                    self.repo.update(collection, item["id"], {"status": ItemStatus.approved, "sum_fact": item["sum_plan"]})
                elif float(sum_fact) == float(item["sum_plan"]):
                    self.repo.update(collection, item["id"], {"status": ItemStatus.approved})
                else:
                    self.repo.update(collection, item["id"], {"status": ItemStatus.approved_with_changes})

        return self.finalize(user, request_id)

from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder

from app.models import APPROVED_ITEM_STATUSES, ItemStatus, RequestStatus
from app.repositories.base import Repository
from app.services.budget_totals import sync_annual_budgets
from app.services.common import get_required
from app.services.permission_service import PermissionService


class RequestService:
    def __init__(self, repo: Repository, permissions: PermissionService):
        self.repo = repo
        self.permissions = permissions
        self.approval_service = None

    def _items(self, request_id: str, *, include_deleted: bool = False) -> list[dict]:
        items = [item for item in self.repo.load_all("req_items") if item["request_id"] == request_id]
        return items if include_deleted else [item for item in items if item.get("status") != ItemStatus.deleted]

    def log(
        self,
        user: dict,
        request_id: str,
        action: str,
        *,
        entity: str = "request",
        entity_id: str | None = None,
        before: dict | None = None,
        after: dict | None = None,
        event_id: str | None = None,
        comment: str | None = None,
        repo: Repository | None = None,
        **extra,
    ) -> None:
        before = before or {}
        after = after or {}
        changed = {
            key: {"from": before.get(key), "to": after.get(key)}
            for key in set(before) | set(after)
            if before.get(key) != after.get(key)
        }
        (repo or self.repo).create(
            "req_logs",
            {
                "req_id": request_id,
                "user_id": user["id"],
                "log": jsonable_encoder(
                    {
                        "action": action,
                        "entity": entity,
                        "entity_id": entity_id or request_id,
                        "event_id": event_id,
                        "changes": changed,
                        "comment": comment,
                        **extra,
                    }
                ),
            },
        )

    def _assigned_economist_id(self, unit_id: str) -> str | None:
        users = {item["id"]: item for item in self.repo.load_all("users")}
        assignments = [
            item for item in self.repo.load_all("units_responsibles")
            if item.get("unit_id") == unit_id and item.get("is_active") and users.get(item.get("user_id"), {}).get("role") == "economist"
        ]
        if len(assignments) > 1:
            raise HTTPException(status_code=409, detail="К этому подразделению назначено несколько экономистов")
        return assignments[0]["user_id"] if assignments else None

    def public_request(self, request: dict, summary: dict | None = None) -> dict:
        return {
            **request,
            "total_approved_sum": request.get("sum_fact", 0),
            "summary": summary,
            "unit_budget": {"annual_budget": float(get_required(self.repo, "units", request["unit_id"]).get("annual_budget") or 0)},
        }

    def summary(self, request_id: str) -> dict:
        items = self._items(request_id)
        expense_items = [item for item in items if not item.get("is_income", False)]
        income_items = [item for item in items if item.get("is_income", False)]
        accepted = [item for item in items if item["status"] in APPROVED_ITEM_STATUSES]
        rejected = [item for item in items if item["status"] == ItemStatus.rejected]
        in_review = [item for item in items if item["status"] == ItemStatus.on_review]
        return {
            "request_id": request_id,
            "planned_sum": sum(float(item.get("sum_plan") or 0) for item in expense_items),
            "approved_sum": sum(float(item.get("sum_fact") or 0) for item in accepted if not item.get("is_income", False)),
            "income_planned_sum": sum(float(item.get("sum_plan") or 0) for item in income_items),
            "income_approved_sum": sum(
                float(item.get("sum_fact") or 0)
                for item in accepted
                if item.get("is_income", False)
            ),
            "items_count": len(items),
            "accepted_count": len(accepted),
            "rejected_count": len(rejected),
            "in_review_count": len(in_review),
            "deleted_count": len(self._items(request_id, include_deleted=True)) - len(items),
        }

    def recalculate_total(self, request_id: str, *, repo: Repository | None = None) -> dict:
        active_repo = repo or self.repo
        items = [item for item in active_repo.load_all("req_items") if item["request_id"] == request_id and item.get("status") != ItemStatus.deleted]
        expense_items = [item for item in items if not item.get("is_income", False)]
        return active_repo.update(
            "requests",
            request_id,
            {
                "sum_plan": sum((Decimal(str(item.get("sum_plan") or 0)) for item in expense_items), Decimal("0")),
                "sum_fact": sum(
                    (Decimal(str(item.get("sum_fact") or 0))
                    for item in expense_items
                    if item["status"] in APPROVED_ITEM_STATUSES),
                    Decimal("0"),
                ),
            },
        )

    def list_requests(self, user: dict, status: str | None = None, unit_id: str | None = None, created_from: str | None = None, created_to: str | None = None) -> list[dict]:
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
            public_request = self.public_request(budget_request, self.summary(budget_request["id"]))
            if user.get("role") in {"approver", "zgd"} and self.approval_service:
                package_id, package_name = self.approval_service._request_package(self.repo, budget_request)
                public_request["package_id"] = package_id
                public_request["package_name"] = package_name
                public_request["my_step_statuses"] = [
                    {
                        "step_id": step["id"],
                        "status": self.approval_service._request_step_state(self.repo, step, budget_request["id"])["status"],
                        "reviewed": self.approval_service._request_reviewed_at_step(self.repo, budget_request["id"], step["id"]),
                    }
                    for step in self.approval_service._request_route(self.repo, budget_request["unit_id"])
                    if step.get("user_id") == user.get("id")
                ]
            result.append(public_request)
        return result

    def dashboard(self, user: dict, unit_id: str | None = None, *, is_income: bool = False) -> dict:
        visible = self.permissions.visible_request_ids(user)
        units = {item["id"]: item for item in self.repo.load_all("units")}

        def root(value: str | None) -> str | None:
            current, seen = value, set()
            while current and current not in seen:
                seen.add(current)
                item = units.get(current)
                if not item or not item.get("parent_id"):
                    return current
                current = item["parent_id"]
            return value

        requests = [
            item for item in self.repo.load_all("requests")
            if (visible is None or item["id"] in visible)
            and item.get("status") not in {RequestStatus.draft, RequestStatus.cancelled}
            and (not unit_id or root(item.get("unit_id")) == unit_id)
        ]
        dds_catalog = {item["id"]: item for item in self.repo.load_all("dds_catalog")}
        invest_catalog = {item["id"]: item for item in self.repo.load_all("invests_catalog")}
        by_unit: dict[str, dict] = {}
        by_category: dict[str, dict] = {}
        by_article: dict[str, dict] = {}

        def add(target: dict[str, dict], key: str, name: str, kind: str, planned: float, approved: float) -> None:
            row = target.setdefault(key, {"id": key, "name": name, "kind": kind, "planned": 0.0, "approved": 0.0, "items_count": 0})
            row["planned"] += planned
            row["approved"] += approved
            row["items_count"] += 1

        total_plan = total_fact = frozen_total = 0.0
        request_by_id = {item["id"]: item for item in requests}
        request_ids_with_matching_items: set[str] = set()
        for item in self.repo.load_all("req_items"):
            request = request_by_id.get(item.get("request_id"))
            if not request or item.get("is_income", False) != is_income or item.get("status") == ItemStatus.deleted:
                continue
            request_ids_with_matching_items.add(request["id"])
            kind = "dds" if item.get("dds_id") else "invest"
            catalog = dds_catalog if kind == "dds" else invest_catalog
            article = catalog.get(item.get("dds_id") or item.get("invest_id"), {})
            category = catalog.get(article.get("parent_id")) or article
            planned = float(item.get("sum_plan") or 0)
            approved = float(item.get("sum_fact") or 0) if item.get("status") in APPROVED_ITEM_STATUSES else 0.0
            total_plan += planned
            total_fact += approved
            if approved and request.get("frozen"):
                frozen_total += approved
            add(by_category, f"{kind}:{category.get('id', 'unknown')}", category.get("name", "Uncategorized"), kind, planned, approved)
            add(by_article, f"{kind}:{article.get('id', 'unknown')}", article.get("name", "Unknown"), kind, planned, approved)
            unit_id_key = root(request.get("unit_id")) or "unknown"
            add(by_unit, unit_id_key, units.get(unit_id_key, {}).get("name", "Unknown unit"), "unit", planned, approved)

        def ordered(rows: dict[str, dict]) -> list[dict]:
            return sorted(rows.values(), key=lambda item: (-item["planned"], item["name"]))

        matching_requests = [item for item in requests if item["id"] in request_ids_with_matching_items]

        if user["role"] == "admin":
            available_department_ids = {item["id"] for item in units.values() if not item.get("parent_id")}
        elif user["role"] == "economist":
            available_department_ids = self.permissions.economist_visible_department_ids(user["id"])
        else:
            available_department_ids = {
                root(item.get("unit_id"))
                for item in self.repo.load_all("requests")
                if item["id"] in (visible or set())
            }
        table_units = [
            {"id": item["id"], "name": item["name"], "parent_id": item.get("parent_id")}
            for item in units.values()
            if item["id"] in available_department_ids
        ]
        return {
            "scope": {"unit_id": unit_id, "available_units": [{"id": item["id"], "name": item["name"], "parent_id": item.get("parent_id")} for item in units.values() if item["id"] in available_department_ids], "table_units": sorted(table_units, key=lambda item: item["name"])},
            "totals": {"planned": total_plan, "approved": total_fact, "frozen": frozen_total, "remaining": max(total_plan - total_fact, 0), "requests_count": len(matching_requests), "approved_requests_count": sum(item.get("status") in APPROVED_ITEM_STATUSES for item in matching_requests), "review_requests_count": sum(item.get("status") == RequestStatus.on_review for item in matching_requests), "frozen_requests_count": sum(item.get("frozen") for item in matching_requests)},
            "by_unit": ordered(by_unit), "by_category": ordered(by_category), "by_article": ordered(by_article),
        }

    def dashboard_article_cfo(self, user: dict, article_key: str, unit_id: str | None = None, *, is_income: bool = False) -> list[dict]:
        """Return one selected article split by the request's parent CFO."""
        kind, separator, article_id = article_key.partition(":")
        if separator != ":" or kind not in {"dds", "invest"} or not article_id:
            return []

        visible = self.permissions.visible_request_ids(user)
        units = {item["id"]: item for item in self.repo.load_all("units")}

        def path(value: str | None) -> list[dict]:
            result: list[dict] = []
            current, seen = value, set()
            while current and current not in seen:
                seen.add(current)
                item = units.get(current)
                if not item:
                    break
                result.append(item)
                current = item.get("parent_id")
            return list(reversed(result))

        def root(value: str | None) -> str | None:
            hierarchy = path(value)
            return hierarchy[0]["id"] if hierarchy else value

        requests = {
            item["id"]: item for item in self.repo.load_all("requests")
            if (visible is None or item["id"] in visible)
            and item.get("status") not in {RequestStatus.draft, RequestStatus.cancelled}
            and (not unit_id or root(item.get("unit_id")) == unit_id)
        }
        by_cfo: dict[str, dict] = {}

        def add(cfo_id: str, name: str, planned: float, approved: float) -> None:
            row = by_cfo.setdefault(cfo_id, {"id": cfo_id, "name": name, "kind": "unit", "planned": 0.0, "approved": 0.0, "items_count": 0})
            row["planned"] += planned
            row["approved"] += approved
            row["items_count"] += 1

        for item in self.repo.load_all("req_items"):
            budget_request = requests.get(item.get("request_id"))
            item_kind = "dds" if item.get("dds_id") else "invest"
            item_article_id = item.get("dds_id") or item.get("invest_id")
            if (
                not budget_request
                or item.get("is_income", False) != is_income
                or item.get("status") == ItemStatus.deleted
                or item_kind != kind
                or item_article_id != article_id
            ):
                continue
            hierarchy = path(budget_request.get("unit_id"))
            cfo = hierarchy[-2] if len(hierarchy) >= 2 else (hierarchy[-1] if hierarchy else {})
            approved = float(item.get("sum_fact") or 0) if item.get("status") in APPROVED_ITEM_STATUSES else 0.0
            add(cfo.get("id", "unknown"), cfo.get("name", "Не указано"), float(item.get("sum_plan") or 0), approved)

        return sorted(by_cfo.values(), key=lambda item: (-item["planned"], item["name"]))

    def dashboard_articles_cfo(self, user: dict, unit_id: str | None = None, *, is_income: bool = False) -> list[dict]:
        """Return every article with its planned amount split by parent CFO."""
        visible = self.permissions.visible_request_ids(user)
        units = {item["id"]: item for item in self.repo.load_all("units")}
        dds_catalog = {item["id"]: item for item in self.repo.load_all("dds_catalog")}
        invest_catalog = {item["id"]: item for item in self.repo.load_all("invests_catalog")}

        def path(value: str | None) -> list[dict]:
            result: list[dict] = []
            current, seen = value, set()
            while current and current not in seen:
                seen.add(current)
                item = units.get(current)
                if not item:
                    break
                result.append(item)
                current = item.get("parent_id")
            return list(reversed(result))

        def root(value: str | None) -> str | None:
            hierarchy = path(value)
            return hierarchy[0]["id"] if hierarchy else value

        requests = {
            item["id"]: item for item in self.repo.load_all("requests")
            if (visible is None or item["id"] in visible)
            and item.get("status") not in {RequestStatus.draft, RequestStatus.cancelled}
            and (not unit_id or root(item.get("unit_id")) == unit_id)
        }
        articles: dict[str, dict] = {}

        for item in self.repo.load_all("req_items"):
            budget_request = requests.get(item.get("request_id"))
            if not budget_request or item.get("is_income", False) != is_income or item.get("status") == ItemStatus.deleted:
                continue
            kind = "dds" if item.get("dds_id") else "invest"
            article_id = item.get("dds_id") or item.get("invest_id")
            catalog = dds_catalog if kind == "dds" else invest_catalog
            article = catalog.get(article_id, {})
            key = f"{kind}:{article_id or 'unknown'}"
            article_row = articles.setdefault(key, {
                "id": key,
                "name": article.get("name", "Не указано"),
                "kind": kind,
                "planned": 0.0,
                "approved": 0.0,
                "items_count": 0,
                "cfo": {},
            })
            planned = float(item.get("sum_plan") or 0)
            approved = float(item.get("sum_fact") or 0) if item.get("status") in APPROVED_ITEM_STATUSES else 0.0
            article_row["planned"] += planned
            article_row["approved"] += approved
            article_row["items_count"] += 1

            hierarchy = path(budget_request.get("unit_id"))
            cfo = hierarchy[-2] if len(hierarchy) >= 2 else (hierarchy[-1] if hierarchy else {})
            cfo_id = cfo.get("id", "unknown")
            cfo_row = article_row["cfo"].setdefault(cfo_id, {"id": cfo_id, "name": cfo.get("name", "Не указано"), "kind": "unit", "planned": 0.0, "approved": 0.0, "items_count": 0})
            cfo_row["planned"] += planned
            cfo_row["approved"] += approved
            cfo_row["items_count"] += 1

        result = []
        for article in articles.values():
            article["cfo"] = sorted(article["cfo"].values(), key=lambda item: (-item["planned"], item["name"]))
            result.append(article)
        return sorted(result, key=lambda item: (-item["planned"], item["name"]))

    def dashboard_table(self, user: dict, unit_id: str | None = None, *, is_income: bool = False) -> list[dict]:
        """Detailed dashboard rows.  Keep hierarchy labels on the server so the
        table and an exported view use the same access scope as the dashboard."""
        visible = self.permissions.visible_request_ids(user)
        units = {item["id"]: item for item in self.repo.load_all("units")}

        def path(value: str | None) -> list[dict]:
            result: list[dict] = []
            current, seen = value, set()
            while current and current not in seen:
                seen.add(current)
                item = units.get(current)
                if not item:
                    break
                result.append(item)
                current = item.get("parent_id")
            return list(reversed(result))

        def department_id(value: str | None) -> str | None:
            hierarchy = path(value)
            return hierarchy[0]["id"] if hierarchy else value

        requests = {
            item["id"]: item for item in self.repo.load_all("requests")
            if (visible is None or item["id"] in visible)
            and item.get("status") not in {RequestStatus.draft, RequestStatus.cancelled}
            and (
                not unit_id
                or item.get("unit_id") == unit_id
                or (not units.get(unit_id, {}).get("parent_id") and department_id(item.get("unit_id")) == unit_id)
            )
        }
        dds_catalog = {item["id"]: item for item in self.repo.load_all("dds_catalog")}
        invest_catalog = {item["id"]: item for item in self.repo.load_all("invests_catalog")}
        rows: list[dict] = []
        for item in self.repo.load_all("req_items"):
            budget_request = requests.get(item.get("request_id"))
            if not budget_request or item.get("is_income", False) != is_income or item.get("status") == ItemStatus.deleted:
                continue
            hierarchy = path(budget_request.get("unit_id"))
            department = hierarchy[0] if hierarchy else {}
            cfo = hierarchy[-2] if len(hierarchy) >= 2 else (hierarchy[-1] if hierarchy else {})
            kind = "dds" if item.get("dds_id") else "invest"
            catalog = dds_catalog if kind == "dds" else invest_catalog
            article = catalog.get(item.get("dds_id") or item.get("invest_id"), {})
            category = catalog.get(article.get("parent_id")) or article
            approved = float(item.get("sum_fact") or 0) if item.get("status") in APPROVED_ITEM_STATUSES else 0.0
            rows.append({
                "id": item["id"],
                "request_id": budget_request["id"],
                "organization": department.get("name", "Не указано"),
                "cfo": cfo.get("name", "Не указано"),
                "unit": units.get(budget_request.get("unit_id"), {}).get("name", "Не указано"),
                "article": article.get("name", "Не указано"),
                "category": category.get("name", "Не указано"),
                "kind": kind,
                "status": str(budget_request.get("status")),
                "planned": float(item.get("sum_plan") or 0),
                "approved": approved,
            })
        return rows

    def get_request(self, user: dict, request_id: str) -> dict:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_view_request(user, request)
        return self.public_request(request, self.summary(request_id))

    def counterparty_contact(self, user: dict, request_id: str) -> dict | None:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_view_request(user, request)
        users = {item["id"]: item for item in self.repo.load_all("users")}
        target_id = (request.get("economist_id") or self._assigned_economist_id(request["unit_id"])) if user["role"] == "employee" else None
        target_role = "economist" if target_id else None
        if user["role"] == "economist":
            employee = next((item for item in self.repo.load_all("units_responsibles") if item.get("unit_id") == request["unit_id"] and item.get("is_active") and users.get(item.get("user_id"), {}).get("role") == "employee"), None)
            target_id, target_role = (employee["user_id"], "employee") if employee else (None, None)
        target = users.get(target_id) if target_id else None
        profile = next((item for item in self.repo.load_all("profiles") if item.get("user_id") == target_id), None)
        return {"user_id": target_id, "login": target["login"], "role": target_role, "profile": profile} if target else None

    def create_request(self, user: dict, payload: dict) -> dict:
        if user["role"] != "employee" or payload["unit_id"] not in self.permissions.employee_module_ids(user["id"]):
            raise HTTPException(status_code=403, detail="Создать заявку может только ответственный сотрудник")
        created = self.repo.create("requests", {"economist_id": self._assigned_economist_id(payload["unit_id"]), "unit_id": payload["unit_id"], "sum_plan": 0, "sum_fact": 0, "status": RequestStatus.draft, "frozen": False, "fixed": False})
        self.log(user, created["id"], "created", after=created)
        return self.public_request(created, self.summary(created["id"]))

    def delete_request(self, user: dict, request_id: str) -> None:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_request_delete_request(user, request)
        self.repo.delete("requests", request_id)

    def patch_request(self, user: dict, request_id: str, patch: dict) -> dict:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_request_unfrozen(request)
        self.permissions.require_employee_edit_request(user, request)
        return self.public_request(request, self.summary(request_id))

    def submit(self, user: dict, request_id: str) -> dict:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_request_unfrozen(request)
        self.permissions.require_employee_edit_request(user, request)
        items = self._items(request_id)
        if not items:
            raise HTTPException(status_code=400, detail="Нельзя отправить заявку без строк")
        economist_id = request.get("economist_id") or self._assigned_economist_id(request["unit_id"])
        if not economist_id:
            raise HTTPException(status_code=400, detail="К подразделению не назначен экономист")
        with self.repo.transaction() as repo:
            updated = repo.update("requests", request_id, {"status": RequestStatus.on_review, "economist_id": economist_id})
            self.log(user, request_id, "submitted", before=request, after=updated, repo=repo)
            if self.approval_service:
                self.approval_service.open_leaf_for_request(
                    user,
                    request["unit_id"],
                    request_id,
                    repo=repo,
                )
        return self.public_request(updated, self.summary(request_id))

    def withdraw(self, user: dict, request_id: str) -> dict:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_employee_withdraw_request(user, request)
        updated = self.repo.update("requests", request_id, {"status": RequestStatus.draft})
        self.log(user, request_id, "withdrawn", before=request, after=updated)
        return self.public_request(updated, self.summary(request_id))

    def cancel(self, user: dict, request_id: str) -> dict:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_employee_cancel_request(user, request)
        updated = self.repo.update("requests", request_id, {"status": RequestStatus.cancelled})
        self.log(user, request_id, "cancelled", before=request, after=updated)
        return self.public_request(updated, self.summary(request_id))

    def start_review(self, user: dict, request_id: str) -> dict:
        raise HTTPException(
            status_code=400,
            detail="Заявка поступает на рассмотрение только после отправки сотрудником",
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

    def finalize(self, user: dict, request_id: str) -> dict:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_request_unfrozen(request)
        self.permissions.require_economist_review_request(user, request)
        items = self._items(request_id)
        if not items or any(item["status"] == ItemStatus.on_review for item in items):
            raise HTTPException(status_code=400, detail="Перед завершением необходимо рассмотреть все строки заявки")
        expense_items = [item for item in items if not item.get("is_income", False)]
        with self.repo.transaction() as repo:
            updated = repo.update(
                "requests",
                request_id,
                {
                    "sum_plan": sum(float(item.get("sum_plan") or 0) for item in expense_items),
                    "sum_fact": sum(
                        float(item.get("sum_fact") or 0)
                        for item in expense_items
                        if item["status"] in APPROVED_ITEM_STATUSES
                    ),
                    "status": self.status_from_items(items),
                    "frozen": True,
                },
            )
            sync_annual_budgets(repo)
            self.log(user, request_id, "finalized", before=request, after=updated, repo=repo)
            if self.approval_service:
                self.approval_service.complete_economist_review(
                    user,
                    request_id,
                    repo=repo,
                )
        return self.public_request(updated, self.summary(request_id))

    def fix(self, user: dict, request_id: str) -> dict:
        return self.finalize(user, request_id)

    def reopen(self, user: dict, request_id: str) -> dict:
        raise HTTPException(
            status_code=400,
            detail="Возврат на доработку выполняется только по маршруту согласования",
        )

    def unfreeze(self, user: dict, request_id: str) -> dict:
        return self.reopen(user, request_id)

    def freeze_budget(self, user: dict, request_id: str) -> dict:
        raise HTTPException(
            status_code=400,
            detail="Заявка замораживается автоматически, когда экономист завершает проверку и передаёт её по маршруту",
        )

    def unfreeze_budget(self, user: dict, request_id: str) -> dict:
        raise HTTPException(
            status_code=400,
            detail="Разморозить заявку можно только через возврат на доработку по маршруту согласования",
        )

    def approve_all_items(self, user: dict, request_id: str) -> dict:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_request_unfrozen(request)
        self.permissions.require_economist_review_request(user, request)
        if request.get("status") != RequestStatus.on_review:
            raise HTTPException(status_code=400, detail="Заявка не находится на рассмотрении")
        for item in self._items(request_id):
            if item["status"] == ItemStatus.on_review:
                sum_fact = float(item.get("sum_fact") or 0)
                if sum_fact == 0:
                    patch = {"status": ItemStatus.approved, "sum_fact": item["sum_plan"]}
                elif sum_fact == float(item["sum_plan"]):
                    patch = {"status": ItemStatus.approved}
                else:
                    patch = {"status": ItemStatus.approved_with_changes}
                self.repo.update("req_items", item["id"], patch)
        return self.finalize(user, request_id)

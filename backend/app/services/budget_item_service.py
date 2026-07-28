from decimal import Decimal

from fastapi import HTTPException

from app.models import ItemStatus, RequestStatus
from app.repositories.base import Repository
from app.services.common import clean_request_item_name, get_required
from app.services.permission_service import PermissionService
from app.services.request_service import RequestService


class BudgetItemService:
    def __init__(self, repo: Repository, permissions: PermissionService, requests: RequestService):
        self.repo = repo
        self.permissions = permissions
        self.requests = requests

    @staticmethod
    def _public_item(item: dict, month_plans: list[dict] | None = None) -> dict:
        plans = month_plans if item.get("is_income", False) else []
        return {
            **item,
            "name": clean_request_item_name(item.get("name")),
            "month_plans": plans or [],
        }

    @staticmethod
    def _decimal(value: object) -> Decimal:
        return value if isinstance(value, Decimal) else Decimal(str(value))

    @staticmethod
    def _zero_month_plans() -> list[dict]:
        return [{"month": month, "sum_plan": Decimal("0")} for month in range(1, 13)]

    def _month_plans_by_item(self, item_ids: set[str] | None = None) -> dict[str, list[dict]]:
        plans: dict[str, dict[int, Decimal]] = {}
        for row in self.repo.load_all("req_item_month_plans"):
            item_id = row["req_item_id"]
            if item_ids is None or item_id in item_ids:
                plans.setdefault(item_id, {})[int(row["month"])] = self._decimal(row["sum_plan"])
        return {
            item_id: [
                {"month": month, "sum_plan": values.get(month, Decimal("0"))}
                for month in range(1, 13)
            ]
            for item_id, values in plans.items()
        }

    def _month_plans_for_item(self, item: dict) -> list[dict]:
        if not item.get("is_income", False):
            return []
        return self._month_plans_by_item({item["id"]}).get(
            item["id"],
            self._zero_month_plans(),
        )

    @classmethod
    def _validate_month_plans(cls, month_plans: list[dict]) -> tuple[list[dict], Decimal]:
        by_month: dict[int, Decimal] = {}
        for plan in month_plans:
            month = int(plan["month"])
            if month in by_month:
                raise HTTPException(status_code=422, detail="Месяцы в помесячном плане не должны повторяться")
            if not 1 <= month <= 12:
                raise HTTPException(status_code=422, detail="Номер месяца должен быть от 1 до 12")
            amount = cls._decimal(plan["sum_plan"])
            if amount < 0:
                raise HTTPException(status_code=422, detail="Сумма за месяц не может быть отрицательной")
            if amount.as_tuple().exponent < -2 or amount >= Decimal("1000000000000"):
                raise HTTPException(status_code=422, detail="Сумма должна соответствовать формату NUMERIC(14,2)")
            by_month[month] = amount
        normalized = [
            {"month": month, "sum_plan": by_month.get(month, Decimal("0"))}
            for month in range(1, 13)
        ]
        return normalized, sum((plan["sum_plan"] for plan in normalized), Decimal("0"))

    @staticmethod
    def _replace_month_plans(repo: Repository, item_id: str, month_plans: list[dict]) -> None:
        repo.delete_where("req_item_month_plans", {"req_item_id": item_id})
        for plan in month_plans:
            repo.create("req_item_month_plans", {"req_item_id": item_id, **plan})

    @staticmethod
    def catalog_collection(kind: str) -> str:
        return "dds_catalog" if kind == "dds" else "invests_catalog"

    def list_items(self, user: dict, request_id: str, *, include_deleted: bool = True) -> list[dict]:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_view_request(user, request)
        items = [item for item in self.repo.load_all("req_items") if item["request_id"] == request_id]
        visible_items = items if include_deleted else [item for item in items if item.get("status") != ItemStatus.deleted]
        plans_by_item = self._month_plans_by_item({item["id"] for item in visible_items})
        return [self._public_item(item, plans_by_item.get(item["id"], self._zero_month_plans())) for item in visible_items]

    def _kind_for_request(self, request: dict) -> str:
        unit = get_required(self.repo, "units", request["unit_id"])
        return "invest" if unit.get("uses_invest_projects") else "dds"

    def _department_id_for_request(self, request: dict) -> str:
        units = {item["id"]: item for item in self.repo.load_all("units")}
        current = get_required(self.repo, "units", request["unit_id"])
        visited: set[str] = set()
        while current.get("parent_id") and current["id"] not in visited:
            visited.add(current["id"])
            current = units.get(current["parent_id"], current)
        return current["id"]

    def _validate_article(self, request: dict, payload: dict) -> tuple[str, str]:
        kind = self._kind_for_request(request)
        allowed_field = "invest_id" if kind == "invest" else "dds_id"
        forbidden_field = "dds_id" if kind == "invest" else "invest_id"
        article_id = payload.get(allowed_field)
        if not article_id or payload.get(forbidden_field):
            label = "инвестиционные проекты" if kind == "invest" else "статьи ДДС"
            raise HTTPException(status_code=400, detail=f"Для этого подразделения доступны только {label}")
        article = get_required(self.repo, self.catalog_collection(kind), article_id)
        if not article.get("is_active", True):
            raise HTTPException(status_code=400, detail="Нельзя использовать неактивную запись НСИ в строке заявки")
        if article.get("unit_id") != self._department_id_for_request(request):
            raise HTTPException(status_code=400, detail="Запись НСИ относится к другому подразделению")
        return kind, article_id

    def create_item(self, user: dict, request_id: str, payload: dict) -> dict:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_request_unfrozen(request)
        self.permissions.require_employee_edit_request(user, request)
        kind, article_id = self._validate_article(request, payload)
        if not payload["name"].strip():
            raise HTTPException(status_code=400, detail="Укажите наименование строки заявки")
        is_income = payload.get("is_income", False)
        raw_month_plans = payload.get("month_plans") if "month_plans" in payload else (
            [{"month": 1, "sum_plan": payload["sum_plan"]}] if is_income else []
        )
        raw_month_plans = raw_month_plans or []
        if not is_income and raw_month_plans:
            raise HTTPException(status_code=422, detail="Помесячный план доступен только для доходной строки")
        month_plans, total = self._validate_month_plans(raw_month_plans) if is_income else ([], self._decimal(payload["sum_plan"]))
        item = {
            "request_id": request_id,
            "dds_id": article_id if kind == "dds" else None,
            "invest_id": article_id if kind == "invest" else None,
            "is_income": is_income,
            "name": payload["name"].strip(),
            "sum_plan": total,
            "sum_fact": 0,
            "justification": payload.get("justification", "").strip(),
            "status": ItemStatus.on_review,
            "comment": "",
        }
        with self.repo.transaction() as repo:
            created = repo.create("req_items", item)
            if is_income:
                self._replace_month_plans(repo, created["id"], month_plans)
            self.requests.recalculate_total(request_id, repo=repo)
            public_created = self._public_item(created, month_plans)
            self.requests.log(user, request_id, "line_created", entity="req_item", entity_id=created["id"], after=public_created, repo=repo)
        return public_created

    def _find_item(self, item_id: str) -> dict:
        return get_required(self.repo, "req_items", item_id)

    @staticmethod
    def _employee_patch(patch: dict) -> dict:
        allowed = {
            key: patch[key]
            for key in ("dds_id", "invest_id", "name", "sum_plan", "justification", "is_income", "month_plans", "clear_month_plans")
            if key in patch
        }
        if len(allowed) != len(patch):
            raise HTTPException(status_code=403, detail="Сотрудник не может изменять поля рассмотрения")
        return allowed

    @staticmethod
    def _economist_patch(item: dict, patch: dict) -> dict:
        allowed = {key: patch[key] for key in ("status", "sum_fact", "comment", "month_plans") if key in patch}
        if len(allowed) != len(patch):
            raise HTTPException(status_code=403, detail="Экономист не может изменять поля сотрудника")
        status = allowed.get("status", item["status"])
        sum_fact = allowed.get("sum_fact", item.get("sum_fact"))
        if status in {ItemStatus.on_review, ItemStatus.rejected, ItemStatus.deleted}:
            allowed["sum_fact"] = 0
            if status == ItemStatus.deleted:
                allowed["sum_plan"] = 0
            return allowed
        if status == ItemStatus.approved:
            allowed["sum_fact"] = item["sum_plan"]
            return allowed
        if status == ItemStatus.approved:
            if sum_fact in (None, 0):
                allowed["sum_fact"] = item["sum_plan"]
            elif float(sum_fact) != float(item["sum_plan"]):
                raise HTTPException(status_code=400, detail="Для утверждённой строки фактическая сумма должна совпадать с плановой")
        if status == ItemStatus.approved_with_changes and (sum_fact is None or float(sum_fact) == float(item["sum_plan"])):
            raise HTTPException(status_code=400, detail="При утверждении с изменениями укажите фактическую сумму, отличающуюся от плановой")
        if status == ItemStatus.rejected:
            if sum_fact not in (None, 0):
                raise HTTPException(status_code=400, detail="Для отклонённой строки фактическая сумма должна быть равна нулю")
            allowed["sum_fact"] = 0
        return allowed

    def patch_item(self, user: dict, item_id: str, patch: dict) -> dict:
        item = self._find_item(item_id)
        request = get_required(self.repo, "requests", item["request_id"])
        self.permissions.require_request_unfrozen(request)
        if item.get("status") == ItemStatus.deleted:
            raise HTTPException(status_code=400, detail="Удалённую строку заявки нельзя изменить")
        if request["status"] in {RequestStatus.approved, RequestStatus.approved_with_changes, RequestStatus.partially_approved, RequestStatus.rejected, RequestStatus.cancelled}:
            raise HTTPException(status_code=400, detail="Завершённую заявку нельзя изменить")
        is_economist = user["role"] == "economist"
        if is_economist:
            self.permissions.require_economist_review_request(user, request)
            normalized = self._economist_patch(item, patch)
        else:
            self.permissions.require_employee_edit_request(user, request)
            normalized = self._employee_patch(patch)
            if "dds_id" in normalized or "invest_id" in normalized:
                candidate = {**item, **normalized}
                kind, article_id = self._validate_article(request, candidate)
                normalized["dds_id"] = article_id if kind == "dds" else None
                normalized["invest_id"] = article_id if kind == "invest" else None
            if "name" in normalized:
                normalized["name"] = normalized["name"].strip()
                if not normalized["name"]:
                    raise HTTPException(status_code=400, detail="Укажите наименование строки заявки")
            if "justification" in normalized:
                normalized["justification"] = normalized["justification"].strip()
        if not normalized:
            return self._public_item(item, self._month_plans_for_item(item))

        is_income = normalized.get("is_income", item.get("is_income", False))
        raw_month_plans = normalized.pop("month_plans", None)
        clear_month_plans = normalized.pop("clear_month_plans", False)
        if not is_income and raw_month_plans:
            raise HTTPException(status_code=422, detail="Помесячный план доступен только для доходной строки")
        if item.get("is_income", False) and not is_income and not clear_month_plans:
            raise HTTPException(status_code=422, detail="Подтвердите очистку помесячного плана перед сменой типа строки")

        month_plans: list[dict] | None = None
        if is_income:
            if raw_month_plans is not None:
                month_plans, total = self._validate_month_plans(raw_month_plans)
                if is_economist:
                    normalized["sum_fact"] = total
                else:
                    normalized["sum_plan"] = total
            elif is_economist and "sum_fact" in patch and self._decimal(normalized["sum_fact"]) != sum(
                (plan["sum_plan"] for plan in self._month_plans_for_item(item)), Decimal("0")
            ):
                raise HTTPException(
                    status_code=422,
                    detail="Утверждённая сумма должна совпадать с суммой месячного плана. Используйте автоподбор или скорректируйте месяцы.",
                )
            elif not item.get("is_income", False):
                month_plans, total = self._validate_month_plans([])
                normalized["sum_plan"] = total
            else:
                normalized.pop("sum_plan", None)
        elif item.get("is_income", False):
            month_plans = []

        effective = {key: value for key, value in normalized.items() if item.get(key) != value}
        before = self._public_item(item, self._month_plans_for_item(item))
        if not effective and month_plans is None:
            return before
        with self.repo.transaction() as repo:
            updated = repo.update("req_items", item_id, effective) if effective else item
            if month_plans is not None:
                self._replace_month_plans(repo, item_id, month_plans)
            self.requests.recalculate_total(item["request_id"], repo=repo)
            public_updated = self._public_item(
                updated,
                (month_plans if month_plans is not None else before["month_plans"]) if updated.get("is_income", False) else [],
            )
            action = "line_deleted" if updated.get("status") == ItemStatus.deleted else "line_updated"
            self.requests.log(user, item["request_id"], action, entity="req_item", entity_id=item_id, before=before, after=public_updated, repo=repo)
        return public_updated

    def delete_item(self, user: dict, item_id: str) -> dict:
        item = self._find_item(item_id)
        request = get_required(self.repo, "requests", item["request_id"])
        self.permissions.require_request_unfrozen(request)
        self.permissions.require_employee_edit_request(user, request)
        if item.get("status") == ItemStatus.deleted:
            return self._public_item(item)
        updated = self.repo.update("req_items", item_id, {"status": ItemStatus.deleted, "sum_plan": 0, "sum_fact": 0})
        self.requests.recalculate_total(item["request_id"])
        self.requests.log(user, item["request_id"], "line_deleted", entity="req_item", entity_id=item_id, before=item, after=updated)
        return self._public_item(updated)

from decimal import Decimal

from fastapi import HTTPException

from app.models import CfoPositionStatus, ItemStatus, RequestStatus
from app.repositories.base import Repository
from app.repositories.pagination import numbered_page
from app.repositories.queries import find_rows
from app.services.common import cfo_position_current_step_id, clean_request_item_name, get_required
from app.services.permission_service import PermissionService
from app.services.request_service import ANALYTICS_FIELDS, RequestService


class BudgetItemService:
    def __init__(self, repo: Repository, permissions: PermissionService, requests: RequestService):
        self.repo = repo
        self.permissions = permissions
        self.requests = requests
        self.chat_service = None

    @staticmethod
    def _decimal(value: object) -> Decimal:
        return value if isinstance(value, Decimal) else Decimal(str(value))

    @staticmethod
    def _public_item(item: dict, month_plans: list[dict] | None = None) -> dict:
        return {
            **item,
            "name": clean_request_item_name(item.get("name")),
            "month_plans": month_plans if month_plans is not None else [],
        }

    @staticmethod
    def _zero_month_plans() -> list[dict]:
        return [{"month": month, "sum_plan": Decimal("0")} for month in range(1, 13)]

    @classmethod
    def _even_month_plans(cls, total: object) -> list[dict]:
        """Split an annual amount over 12 months without losing kopecks."""
        total_cents = int(cls._decimal(total) * 100)
        base, remainder = divmod(total_cents, 12)
        return [
            {
                "month": month,
                "sum_plan": Decimal(base + (1 if month <= remainder else 0)) / 100,
            }
            for month in range(1, 13)
        ]

    def _month_plans_by_item(self, item_ids: set[str] | None = None) -> dict[str, list[dict]]:
        plans: dict[str, dict[int, Decimal]] = {}
        for row in find_rows(self.repo, "req_item_month_plans", in_filters={"req_item_id": item_ids} if item_ids is not None else None):
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
        return self._month_plans_by_item({item["id"]}).get(
            item["id"], self._even_month_plans(item.get("sum_plan") or 0)
        )

    def _is_cfo_revision_item(self, item: dict, *, repo: Repository | None = None) -> bool:
        """Whether the item was returned by the economist to the CFO owner."""
        storage = repo or self.repo
        if item["id"] in self.requests.returned_item_ids(item["request_id"], repo=storage):
            return False
        position_id = item.get("cfo_position_id")
        position = storage.get_by_id("cfo_positions", position_id) if position_id else None
        if not position or position.get("status") != "on_revision":
            return False
        step = storage.get_by_id("steps", position.get("current_step_id"))
        if not step or step.get("unit_id") != position.get("cfo_unit_id"):
            return False
        returns = [
            row for row in storage.load_all("cfo_position_logs")
            if row.get("cfo_position_id") == position_id
            and (row.get("log") or {}).get("action") == "position_returned"
        ]
        if not returns:
            return False
        latest = max(returns, key=lambda row: (str(row.get("created_at") or ""), int(row.get("id") or 0)))
        latest_key = (str(latest.get("created_at") or ""), int(latest.get("id") or 0))
        returned_to_module = any(
            (row.get("log") or {}).get("action") == "item_returned_to_module"
            and (row.get("log") or {}).get("req_item_id") == item["id"]
            and (str(row.get("created_at") or ""), int(row.get("id") or 0)) > latest_key
            for row in storage.load_all("cfo_position_logs")
            if row.get("cfo_position_id") == position_id
        )
        return (
            item["id"] in set((latest.get("log") or {}).get("item_ids") or [])
            and not returned_to_module
        )

    @classmethod
    def _validate_month_plans(cls, month_plans: list[dict]) -> tuple[list[dict], Decimal]:
        by_month: dict[int, Decimal] = {}
        for plan in month_plans:
            month = int(plan["month"])
            if month in by_month:
                raise HTTPException(status_code=422, detail="Месяцы в помесячном плане не должны повторяться")
            amount = cls._decimal(plan["sum_plan"])
            if not 1 <= month <= 12 or amount < 0:
                raise HTTPException(status_code=422, detail="Проверьте месяц и сумму помесячного плана")
            if amount.as_tuple().exponent < -2 or amount >= Decimal("1000000000000"):
                raise HTTPException(status_code=422, detail="Сумма должна соответствовать формату NUMERIC(14,2)")
            by_month[month] = amount
        normalized = [
            {"month": month, "sum_plan": by_month.get(month, Decimal("0"))}
            for month in range(1, 13)
        ]
        return normalized, sum((row["sum_plan"] for row in normalized), Decimal("0"))

    @classmethod
    def _require_matching_sum_plan(cls, sum_plan: object | None, month_total: Decimal) -> None:
        """Reject ambiguous payloads instead of silently picking one total."""
        if sum_plan is not None and cls._decimal(sum_plan) != month_total:
            raise HTTPException(
                status_code=422,
                detail="Годовая сумма должна совпадать с суммой помесячного плана",
            )

    @staticmethod
    def _replace_month_plans(repo: Repository, item_id: str, month_plans: list[dict]) -> None:
        repo.delete_where("req_item_month_plans", {"req_item_id": item_id})
        for plan in month_plans:
            repo.create("req_item_month_plans", {"req_item_id": item_id, **plan})

    @staticmethod
    def catalog_collection(kind: str) -> str:
        return "dds_catalog" if kind == "dds" else "invests_catalog"

    def list_items(self, user: dict, request_id: str, *, include_deleted: bool = True, page: int = 1, page_size: int | None = None) -> list[dict] | dict:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_view_request(user, request)
        paged = numbered_page(self.repo, "req_items", filters={"request_id": request_id}, excluded={"status": "deleted"} if not include_deleted else None, page=page, page_size=page_size) if page_size else None
        items = paged["items"] if paged else find_rows(self.repo, "req_items", filters={"request_id": request_id})
        if not include_deleted:
            items = [row for row in items if row.get("status") != ItemStatus.deleted]
        plans = self._month_plans_by_item({row["id"] for row in items})
        result = [
            self._public_item(
                row,
                plans.get(row["id"], self._even_month_plans(row.get("sum_plan") or 0)),
            )
            for row in items
        ]
        return {**paged, "items": result} if paged else result

    def _kind_for_request(self, request: dict) -> str:
        return "invest" if get_required(self.repo, "units", request["unit_id"]).get("uses_invest_projects") else "dds"

    def _department_id_for_request(self, request: dict) -> str:
        units = {row["id"]: row for row in self.repo.load_all("units")}
        current = get_required(self.repo, "units", request["unit_id"])
        while current.get("parent_id") in units:
            current = units[current["parent_id"]]
        return current["id"]

    def _validate_article(self, request: dict, payload: dict) -> tuple[str, str]:
        kind = self._kind_for_request(request)
        field = "invest_id" if kind == "invest" else "dds_id"
        forbidden = "dds_id" if kind == "invest" else "invest_id"
        article_id = payload.get(field)
        if not article_id or payload.get(forbidden):
            raise HTTPException(status_code=400, detail="Строка должна ссылаться на допустимую статью")
        category = get_required(self.repo, self.catalog_collection(kind), article_id)
        article = get_required(self.repo, self.catalog_collection(kind), category["parent_id"]) if category.get("parent_id") else None
        if not category.get("parent_id") or not article:
            raise HTTPException(status_code=400, detail="Для строки заявки выберите категорию статьи или инвест-проекта")
        if not category.get("is_active", True) or not article.get("is_active", True):
            raise HTTPException(status_code=400, detail="Нельзя использовать неактивную запись НСИ")
        if category.get("unit_id") != self._department_id_for_request(request):
            raise HTTPException(status_code=400, detail="Запись НСИ относится к другому подразделению")
        return kind, article_id

    def create_item(self, user: dict, request_id: str, payload: dict) -> dict:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_employee_edit_request(user, request)
        kind, article_id = self._validate_article(request, payload)
        name = payload["name"].strip()
        if not name:
            raise HTTPException(status_code=400, detail="Укажите наименование строки")
        is_income = payload.get("is_income", False)
        annual_sum = payload.get("sum_plan") if "sum_plan" in payload else None
        raw_plans = payload.get("month_plans") if "month_plans" in payload else None
        if raw_plans is None or (not is_income and not raw_plans):
            raw_plans = self._even_month_plans(payload.get("sum_plan", 0))
        plans, total = self._validate_month_plans(raw_plans)
        self._require_matching_sum_plan(annual_sum, total)
        item = {
            "request_id": request_id,
            "cfo_position_id": None,
            "dds_id": article_id if kind == "dds" else None,
            "invest_id": article_id if kind == "invest" else None,
            "is_income": is_income,
            "name": name,
            "sum_plan": total,
            "sum_fact": Decimal("0"),
            "justification": payload.get("justification", "").strip(),
            "status": ItemStatus.on_review,
            "comment": "",
            **{field: str(payload.get(field) or "").strip() for field in ANALYTICS_FIELDS},
        }
        with self.repo.transaction() as repo:
            created = repo.create("req_items", item)
            self._replace_month_plans(repo, created["id"], plans)
            self.requests.recalculate_total(request_id, repo=repo)
            public = self._public_item(created, plans)
            self.requests.log(
                user, request_id, "line_created", entity="req_item",
                entity_id=created["id"], after=public, repo=repo,
            )
        return public

    @staticmethod
    def _employee_patch(patch: dict, *, allow_sum_fact: bool = False) -> dict:
        fields = {
            "dds_id", "invest_id", "name", "sum_plan", "justification",
            "is_income", "month_plans", "clear_month_plans",
            *ANALYTICS_FIELDS,
        }
        if allow_sum_fact:
            fields.add("sum_fact")
        if set(patch) - fields:
            raise HTTPException(status_code=403, detail="Поля рассмотрения изменяются только командами решения")
        return dict(patch)

    def _apply_item_update(
        self,
        user: dict,
        item: dict,
        request: dict,
        normalized: dict,
        *,
        plans: list[dict] | None = None,
    ) -> dict:
        before = self._public_item(item, self._month_plans_for_item(item))
        effective = {key: value for key, value in normalized.items() if item.get(key) != value}
        if not effective and plans is None:
            return before
        with self.repo.transaction() as repo:
            updated = repo.update("req_items", item["id"], effective) if effective else item
            if plans is not None:
                self._replace_month_plans(repo, item["id"], plans)
            self.requests.recalculate_total(item["request_id"], repo=repo)
            after = self._public_item(
                updated,
                plans if plans is not None else before["month_plans"],
            )
            self.requests.log(
                user, item["request_id"], "line_updated", entity="req_item",
                entity_id=item["id"], before=before, after=after, repo=repo,
            )
        return after

    def _patch_item_analytics(self, user: dict, item: dict, request: dict, patch: dict) -> dict:
        self._require_analytics_edit_access(user, item, request)
        normalized = {
            field: str(patch[field]).strip()
            for field in patch
            if field in ANALYTICS_FIELDS
        }
        return self._apply_item_update(user, item, request, normalized)

    def _require_analytics_edit_access(self, user: dict, item: dict, request: dict) -> None:
        if item.get("fixed"):
            raise HTTPException(status_code=409, detail="Зафиксированную строку нельзя изменить")
        if item.get("frozen"):
            raise HTTPException(status_code=409, detail="Сначала разморозьте строку")
        if item.get("status") == ItemStatus.deleted:
            raise HTTPException(status_code=409, detail="Удалённую строку нельзя изменить")
        if self._is_cfo_revision_item(item):
            raise HTTPException(
                status_code=403,
                detail="Ответственному ЦФО доступно изменение только фактической суммы",
            )
        if request.get("status") == RequestStatus.draft:
            self.permissions.require_employee_edit_request(user, request)
            return
        if (
            request.get("status") == RequestStatus.on_review
            and item["id"] in self.requests.returned_item_ids(request["id"])
        ):
            self.permissions.require_employee_unit_access(user, request["unit_id"])
            return
        position = (
            self.repo.get_by_id("cfo_positions", item.get("cfo_position_id"))
            if item.get("cfo_position_id")
            else None
        )
        if not self.requests.cfo_review_completed(request["id"]):
            self.permissions.require_cfo_request_access(user, request)
            return
        if position and user.get("role") == "economist":
            self.permissions.require_economist_position_access(user, position)
            step = self.repo.get_by_id("steps", position.get("current_step_id"))
            if step and step.get("user_id") == user.get("id"):
                return
        raise HTTPException(status_code=403, detail="Строка недоступна для редактирования аналитики")

    def apply_analytics_bulk(self, user: dict, item_ids: list[str], patch: dict) -> dict:
        normalized = {
            field: str(patch[field]).strip()
            for field in patch
            if field in ANALYTICS_FIELDS
        }
        if not normalized:
            raise HTTPException(status_code=400, detail="Укажите поля аналитики")
        updated_ids: list[str] = []
        with self.repo.transaction() as repo:
            for item_id in item_ids:
                item = get_required(repo, "req_items", item_id)
                request = get_required(repo, "requests", item["request_id"])
                self._require_analytics_edit_access(user, item, request)
                effective = {
                    key: value for key, value in normalized.items()
                    if item.get(key) != value
                }
                if not effective:
                    continue
                before = self._public_item(item, self._month_plans_for_item(item))
                updated = repo.update("req_items", item_id, effective)
                after = self._public_item(updated, before["month_plans"])
                self.requests.log(
                    user, item["request_id"], "line_updated", entity="req_item",
                    entity_id=item_id, before=before, after=after, repo=repo,
                )
                updated_ids.append(item_id)
        if not updated_ids:
            raise HTTPException(status_code=409, detail="Нет строк для обновления аналитики")
        return {"updated_count": len(updated_ids), "item_ids": updated_ids}

    def _require_comment_edit_access(self, user: dict, item: dict, request: dict) -> None:
        """Allow the person responsible at the active stage to edit a line comment."""
        if request.get("status") == RequestStatus.draft:
            self.permissions.require_employee_edit_request(user, request)
            return
        if request.get("status") != RequestStatus.on_review:
            raise HTTPException(status_code=409, detail="Комментарий нельзя изменить на текущем статусе заявки")
        if item["id"] in self.requests.returned_item_ids(request["id"]):
            self.permissions.require_employee_unit_access(user, request["unit_id"])
            return
        if self._is_cfo_revision_item(item) or not self.requests.cfo_review_completed(request["id"]):
            self.permissions.require_cfo_request_access(user, request)
            return
        position_id = item.get("cfo_position_id")
        position = self.repo.get_by_id("cfo_positions", position_id) if position_id else None
        if not position:
            raise HTTPException(status_code=409, detail="Для строки не определён текущий этап согласования")
        step_id = cfo_position_current_step_id(self.repo, position)
        step = self.repo.get_by_id("steps", step_id) if step_id else None
        if not step:
            raise HTTPException(status_code=409, detail="Для строки не определён текущий этап согласования")
        self.permissions.require_step_assignee(user, step)

    def _patch_item_comment(self, user: dict, item: dict, request: dict, comment: object) -> dict:
        self._require_comment_edit_access(user, item, request)
        return self._apply_item_update(
            user,
            item,
            request,
            {"comment": str(comment or "").strip()},
        )

    def patch_item(self, user: dict, item_id: str, patch: dict) -> dict:
        item = get_required(self.repo, "req_items", item_id)
        request = get_required(self.repo, "requests", item["request_id"])
        if item.get("status") == ItemStatus.deleted:
            raise HTTPException(status_code=400, detail="Удалённую строку нельзя изменить")
        if set(patch) == {"comment"}:
            return self._patch_item_comment(user, item, request, patch["comment"])
        returned_item_ids = self.requests.returned_item_ids(request["id"])
        cfo_review_cycle_item_ids = self.requests.cfo_review_cycle_item_ids(request["id"])
        saved_cfo_decision_editable = False
        if cfo_review_cycle_item_ids is not None and item_id not in cfo_review_cycle_item_ids:
            latest_cfo_decision = None
            for row in sorted(
                (row for row in self.repo.load_all("req_logs") if row.get("req_id") == request["id"]),
                key=lambda row: (str(row.get("created_at") or ""), int(row.get("id") or 0)),
            ):
                log = row.get("log") or {}
                if (
                    log.get("action") == "cfo_item_decided"
                    and log.get("entity") == "req_item"
                    and log.get("entity_id") == item_id
                ):
                    latest_cfo_decision = row
            saved_cfo_decision_editable = bool(
                latest_cfo_decision
                and latest_cfo_decision.get("user_id") == user.get("id")
            )
        if request.get("status") == RequestStatus.on_review and (
            (
                returned_item_ids
                and item_id not in returned_item_ids
            )
            or (
                cfo_review_cycle_item_ids is not None
                and item_id not in cfo_review_cycle_item_ids
                and not saved_cfo_decision_editable
            )
        ):
            raise HTTPException(
                status_code=409,
                detail="Строка недоступна для редактирования в текущем цикле доработки",
            )
        if patch and set(patch) <= set(ANALYTICS_FIELDS):
            return self._patch_item_analytics(user, item, request, patch)
        is_module_revision = (
            request.get("status") == RequestStatus.on_review
            and item_id in self.requests.returned_item_ids(request["id"])
        )
        is_cfo_revision = self._is_cfo_revision_item(item)
        if is_module_revision or is_cfo_revision:
            if is_module_revision:
                self.permissions.require_employee_unit_access(user, request["unit_id"])
            else:
                self.permissions.require_cfo_request_access(user, request)
            if is_cfo_revision and set(patch) - {"sum_fact"}:
                raise HTTPException(
                    status_code=409,
                    detail="Ответственному ЦФО доступно изменение только фактической суммы",
                )
            if is_cfo_revision and {"sum_plan", "month_plans", "clear_month_plans"} & set(patch):
                raise HTTPException(
                    status_code=409,
                    detail="При доработке ответственному ЦФО доступна фактическая, а не плановая сумма",
                )
            if item.get("fixed") or item.get("frozen"):
                raise HTTPException(status_code=409, detail="Закрытую строку нельзя изменить")
            if {"dds_id", "invest_id", "is_income"} & set(patch):
                raise HTTPException(
                    status_code=409,
                    detail="При доработке нельзя менять тип или статью строки",
                )
        else:
            cfo_plan_edit = (
                request.get("status") == RequestStatus.on_review
                and not self.requests.cfo_review_completed(request["id"])
                and not self.requests.returned_item_ids(request["id"])
                and set(patch) in ({"sum_plan"}, {"month_plans"}, {"sum_plan", "month_plans"})
            )
            if cfo_plan_edit:
                self.permissions.require_cfo_request_access(user, request)
                if item.get("fixed") or item.get("frozen"):
                    raise HTTPException(status_code=409, detail="Закрытую строку нельзя изменить")
            else:
                self.permissions.require_employee_edit_request(user, request)
        normalized = self._employee_patch(patch, allow_sum_fact=is_cfo_revision)
        if is_cfo_revision and "sum_fact" in normalized:
            if normalized["sum_fact"] is None:
                raise HTTPException(status_code=422, detail="Укажите фактическую сумму")
            if item.get("status") in {ItemStatus.approved, ItemStatus.approved_with_changes}:
                normalized["status"] = (
                    ItemStatus.approved
                    if self._decimal(normalized["sum_fact"]) == self._decimal(item["sum_plan"])
                    else ItemStatus.approved_with_changes
                )
        if "dds_id" in normalized or "invest_id" in normalized:
            kind, article_id = self._validate_article(request, {**item, **normalized})
            normalized["dds_id"] = article_id if kind == "dds" else None
            normalized["invest_id"] = article_id if kind == "invest" else None
        for field in ("name", "justification", *ANALYTICS_FIELDS):
            if field in normalized:
                normalized[field] = str(normalized[field]).strip()
        if "name" in normalized and not normalized["name"]:
            raise HTTPException(status_code=400, detail="Укажите наименование строки")

        annual_sum = normalized.get("sum_plan")
        raw_plans = normalized.pop("month_plans", None)
        clear_plans = normalized.pop("clear_month_plans", False)
        plans: list[dict] | None = None
        if raw_plans is not None:
            plans, month_total = self._validate_month_plans(raw_plans)
            self._require_matching_sum_plan(annual_sum, month_total)
            normalized["sum_plan"] = month_total
        elif "sum_plan" in normalized:
            plans = self._even_month_plans(normalized["sum_plan"])
        elif clear_plans:
            plans = self._zero_month_plans()
            normalized["sum_plan"] = Decimal("0")

        return self._apply_item_update(user, item, request, normalized, plans=plans)

    @staticmethod
    def normalize_decision(item: dict, payload: dict, *, require_change_comment: bool = True) -> dict:
        decision = payload["decision"]
        if decision not in {
            ItemStatus.approved, ItemStatus.approved_with_changes, ItemStatus.rejected
        }:
            raise HTTPException(status_code=422, detail="Недопустимое решение по строке")
        comment = (payload.get("comment") or "").strip()
        patch = {"status": decision, "comment": comment}
        if decision == ItemStatus.approved:
            patch["sum_fact"] = item["sum_plan"]
        elif decision == ItemStatus.rejected:
            if not comment:
                raise HTTPException(status_code=422, detail="Для отклонения нужен комментарий")
            patch["sum_fact"] = Decimal("0")
        else:
            changed_plan = payload.get("sum_plan")
            fact = payload.get("sum_fact")
            if changed_plan is not None:
                patch["sum_plan"] = changed_plan
            patch["sum_fact"] = fact if fact is not None else patch.get("sum_plan", item["sum_plan"])
            for field in ("name", "justification"):
                if payload.get(field) is not None:
                    patch[field] = payload[field].strip()
            if require_change_comment and not comment:
                raise HTTPException(status_code=422, detail="Для одобрения с изменениями нужен комментарий")
            if all(item.get(key) == value for key, value in patch.items() if key not in {"status", "comment"}):
                raise HTTPException(status_code=422, detail="Укажите изменённые значения")
        return patch

    def _decide_cfo(self, repo: Repository, user: dict, item: dict, payload: dict) -> dict:
        request = get_required(repo, "requests", item["request_id"])
        self.permissions.require_cfo_request_access(user, request)
        if request.get("status") != RequestStatus.on_review:
            raise HTTPException(status_code=409, detail="Заявка не находится на проверке ЦФО")
        cfo_revision = self._is_cfo_revision_item(item, repo=repo)
        position = repo.get_by_id("cfo_positions", item.get("cfo_position_id")) if item.get("cfo_position_id") else None
        current_step = repo.get_by_id("steps", position.get("current_step_id")) if position else None
        cfo_stage_is_open = bool(
            position
            and position.get("status") in {
                CfoPositionStatus.waiting,
                CfoPositionStatus.on_review,
                CfoPositionStatus.on_revision,
            }
            and current_step
            and current_step.get("unit_id") == position.get("cfo_unit_id")
        )
        if self.requests.cfo_review_completed(request["id"], repo=repo) and not cfo_revision and not cfo_stage_is_open:
            raise HTTPException(status_code=409, detail="Проверка заявки ЦФО уже завершена")
        cfo_review_cycle_item_ids = self.requests.cfo_review_cycle_item_ids(
            request["id"], repo=repo,
        )
        if (
            cfo_review_cycle_item_ids is not None
            and item["id"] not in cfo_review_cycle_item_ids
        ):
            latest_cfo_decision = None
            for row in sorted(
                (row for row in repo.load_all("req_logs") if row.get("req_id") == request["id"]),
                key=lambda row: (str(row.get("created_at") or ""), int(row.get("id") or 0)),
            ):
                log = row.get("log") or {}
                if (
                    log.get("action") == "cfo_item_decided"
                    and log.get("entity") == "req_item"
                    and log.get("entity_id") == item["id"]
                ):
                    latest_cfo_decision = row
            if not latest_cfo_decision or latest_cfo_decision.get("user_id") != user.get("id"):
                raise HTTPException(
                    status_code=409,
                    detail="Строка ещё не возвращена из модуля на повторную проверку ЦФО",
                )
        returned_item_ids = self.requests.returned_item_ids(request["id"], repo=repo)
        # A saved position-revision flag must not reopen a line after the CFO
        # has handed the revision package to the module.  It becomes available
        # to the CFO again only after the module resubmits the package.
        if returned_item_ids:
            raise HTTPException(status_code=409, detail="Заявка находится на доработке у модуля")
        if not cfo_revision:
            latest_decision = None
            for row in sorted(
                (row for row in repo.load_all("req_logs") if row.get("req_id") == request["id"]),
                key=lambda row: (str(row.get("created_at") or ""), int(row.get("id") or 0)),
            ):
                log = row.get("log") or {}
                if log.get("action") == "request_restored":
                    latest_decision = None
                elif log.get("action") == "cfo_items_returned_for_revision":
                    if item["id"] in {str(item_id) for item_id in log.get("item_ids") or []}:
                        latest_decision = None
                elif (
                    log.get("action") == "cfo_item_decided"
                    and log.get("entity") == "req_item"
                    and log.get("entity_id") == item["id"]
                ):
                    latest_decision = row
            if latest_decision and latest_decision.get("user_id") != user.get("id"):
                raise HTTPException(status_code=403, detail="Изменять можно только своё решение")
        if item.get("status") == ItemStatus.deleted:
            raise HTTPException(status_code=409, detail="Удалённая строка не рассматривается")
        if item.get("frozen") or item.get("fixed"):
            raise HTTPException(status_code=409, detail="Закрытая строка не рассматривается")
        before = dict(item)
        decision_payload = dict(payload)
        raw_plans = decision_payload.pop("month_plans", None)
        plans: list[dict] | None = None
        if raw_plans is not None:
            plans, month_total = self._validate_month_plans(raw_plans)
            self._require_matching_sum_plan(decision_payload.get("sum_plan"), month_total)
            decision_payload["sum_plan"] = month_total
        elif decision_payload.get("sum_plan") is not None:
            plans = self._even_month_plans(decision_payload["sum_plan"])
        if payload["decision"] == "on_revision":
            # This is only a saved choice in the register.  The item's domain
            # status remains on review until the explicit revision package is
            # sent to the module from the dialog.
            normalized = {"status": ItemStatus.on_review, "comment": (payload.get("comment") or "").strip()}
        else:
            normalized = self.normalize_decision(item, decision_payload, require_change_comment=False)
        if payload["decision"] in {ItemStatus.approved, ItemStatus.approved_with_changes}:
            # CFO approval is an intermediate review result.  The line gets its
            # accepted domain status only after the economist's decision.
            normalized["status"] = ItemStatus.on_review
        after = repo.update("req_items", item["id"], normalized)
        if plans is not None:
            self._replace_month_plans(repo, item["id"], plans)
        self.requests.recalculate_total(request["id"], repo=repo)
        self.requests.log(
            user, request["id"], "cfo_item_decided", stage="cfo_review",
            entity="req_item", entity_id=item["id"], before=before, after=after,
            comment=payload.get("comment"), decision=str(payload["decision"]), repo=repo,
        )
        if self.chat_service and (payload.get("comment") or "").strip() and not payload.get("skip_chat"):
            line_comment = (payload.get("comment") or "").strip()
            if str(payload.get("decision")) == "on_revision":
                message = self.chat_service.system_message_for_request(
                    request,
                    self.requests.revision_message(
                        repo,
                        [{**after, "comment": line_comment}],
                        action="Ответственный за ЦФО отметил строку на доработку."
                    ),
                    repo=repo,
                )
            else:
                message = self.chat_service.comment_for_request(
                    user, request, f"{item.get('name')}: {line_comment}", repo=repo,
                )
            after["chat_messages"] = [message]
        return after

    def decide_cfo(self, user: dict, item_id: str, payload: dict) -> dict:
        with self.repo.transaction() as repo:
            item = get_required(repo, "req_items", item_id)
            result = self._decide_cfo(repo, user, item, payload)
        return self._public_item(result, self._month_plans_for_item(result))

    def select_cfo_revision(self, user: dict, item_id: str, payload: dict) -> dict:
        """Save a row's revision state while leaving the CFO review open."""
        with self.repo.transaction() as repo:
            item = get_required(repo, "req_items", item_id)
            result = self._decide_cfo(
                repo,
                user,
                item,
                {"decision": "on_revision", "comment": payload.get("comment") or "", "skip_chat": True},
            )
        return self._public_item(result, self._month_plans_for_item(result))

    def bulk_decide_cfo(self, user: dict, payload: dict) -> list[dict]:
        with self.repo.transaction() as repo:
            result = [
                self._decide_cfo(
                    repo, user, get_required(repo, "req_items", item_id), payload
                )
                for item_id in payload["item_ids"]
            ]
        return [self._public_item(row, self._month_plans_for_item(row)) for row in result]

    def cfo_revision_from_register(
        self,
        user: dict,
        group_type: str,
        group_id: str,
        payload: dict,
        **filters,
    ) -> dict:
        allowed_ids = set(
            self.requests.approval_register_group_cfo_revision_item_ids(
                user, group_type, group_id, **filters
            )
        )
        selected = payload.get("items") or []
        if not selected:
            raise HTTPException(status_code=422, detail="Выберите хотя бы одну строку")
        unknown = [row["item_id"] for row in selected if row["item_id"] not in allowed_ids]
        if unknown:
            raise HTTPException(status_code=422, detail="Часть выбранных строк недоступна для возврата")
        block_comment = (payload.get("comment") or "").strip()
        line_comment = (selected[0].get("comment") or "").strip() if len(selected) == 1 else ""
        if not block_comment and (len(selected) != 1 or not line_comment):
            raise HTTPException(status_code=422, detail="Укажите комментарий к доработке")
        chat_messages: list[dict] = []
        with self.repo.transaction() as repo:
            results: list[dict] = []
            by_request: dict[str, list[str]] = {}
            requests_for_chat: dict[str, dict] = {}
            affected_positions: set[str] = set()
            for row in selected:
                item = get_required(repo, "req_items", row["item_id"])
                request = get_required(repo, "requests", item["request_id"])
                self.permissions.require_cfo_request_access(user, request)
                if request.get("status") != RequestStatus.on_review:
                    raise HTTPException(status_code=409, detail="Заявка не находится на проверке ЦФО")
                position = (
                    get_required(repo, "cfo_positions", item["cfo_position_id"])
                    if item.get("cfo_position_id") else None
                )
                position_step = (
                    repo.get_by_id("steps", position.get("current_step_id"))
                    if position and position.get("current_step_id") else None
                )
                returned_to_cfo = bool(
                    position
                    and position.get("status") == "on_revision"
                    and position_step
                    and position_step.get("unit_id") == position.get("cfo_unit_id")
                )
                if self.requests.returned_item_ids(request["id"], repo=repo):
                    raise HTTPException(status_code=409, detail="Заявка находится на доработке у модуля")
                if self.requests.cfo_review_completed(request["id"], repo=repo) and not returned_to_cfo:
                    raise HTTPException(status_code=409, detail="Проверка заявки ЦФО уже завершена")
                if item.get("fixed") or item.get("frozen") or item.get("status") == ItemStatus.deleted:
                    raise HTTPException(status_code=409, detail="Закрытую строку нельзя вернуть на доработку")
                line_comment = (row.get("comment") or "").strip()
                before = dict(item)
                item_patch = {"status": ItemStatus.on_review}
                if "comment" in row:
                    item_patch["comment"] = line_comment
                result = repo.update("req_items", item["id"], item_patch)
                self.requests.log(
                    user,
                    request["id"],
                    "cfo_item_decided",
                    decision="on_revision",
                    stage="cfo_review",
                    entity="req_item",
                    entity_id=item["id"],
                    before=before,
                    after=result,
                    comment=line_comment,
                    repo=repo,
                )
                by_request.setdefault(request["id"], []).append(item["id"])
                requests_for_chat[request["id"]] = request
                if position:
                    affected_positions.add(position["id"])
                results.append(self._public_item(result, self._month_plans_for_item(result)))
            sent_item_ids: list[str] = []
            for request_id, item_ids in by_request.items():
                sent_item_ids.extend(
                    self.requests.send_cfo_revision(
                        repo,
                        user,
                        request_id,
                        item_ids=set(item_ids),
                        require_complete_review=False,
                        common_comment=block_comment,
                        group_type=group_type,
                    )
                )
            if self.chat_service and not sent_item_ids:
                for request_id, request in requests_for_chat.items():
                    request_items = [
                        row for row in results if row.get("request_id") == request_id
                    ]
                    chat_messages.append(
                        self.chat_service.system_message_for_request(
                            request,
                            self.requests.revision_message(
                                repo,
                                request_items,
                                action="Ответственный за ЦФО отметил выбранные строки на доработку.",
                                common_comment=block_comment,
                                group_type=group_type,
                            ),
                            repo=repo,
                        )
                    )
        return {
            "items": results,
            "chat_messages": chat_messages,
            "affected_item_ids": sorted(sent_item_ids),
            "affected_cfo_position_ids": sorted(affected_positions),
        }

    def delete_item(self, user: dict, item_id: str) -> dict:
        item = get_required(self.repo, "req_items", item_id)
        request = get_required(self.repo, "requests", item["request_id"])
        if item.get("status") == ItemStatus.deleted:
            return self._public_item(item)
        is_returned_revision = (
            request.get("status") == RequestStatus.on_review
            and item_id in self.requests.returned_item_ids(request["id"])
        )
        if is_returned_revision:
            self.permissions.require_employee_unit_access(user, request["unit_id"])
            if item.get("frozen") or item.get("fixed"):
                raise HTTPException(status_code=409, detail="Закрытую строку нельзя удалить")
        else:
            self.permissions.require_employee_edit_request(user, request)
        with self.repo.transaction() as repo:
            updated = repo.update(
                "req_items", item_id,
                {"status": ItemStatus.deleted, "sum_plan": Decimal("0"), "sum_fact": Decimal("0")},
            )
            self._replace_month_plans(repo, item_id, self._zero_month_plans())
            self.requests.recalculate_total(item["request_id"], repo=repo)
            self.requests.log(
                user, item["request_id"], "line_deleted", entity="req_item",
                entity_id=item_id, before=item, after=updated, repo=repo,
            )
        return self._public_item(updated)

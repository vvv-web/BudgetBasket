"""Bounded register responses; legacy endpoints remain available for API clients."""
from __future__ import annotations

from collections import Counter
from decimal import Decimal, ROUND_HALF_UP
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from app.services.request_service import ANALYTICS_FIELDS, DEFAULT_REGISTER_GROUPS
from app.models import RegisterGroupDecisionIn, RegisterGroupWorkflowActionIn, RevisionItemIn


class RegisterFilters(BaseModel):
    model_config = ConfigDict(extra="forbid")
    budget_year: int | None = None
    cfo_id: str | None = None
    category_id: str | None = None
    article_id: str | None = None
    module_id: str | None = None
    request_id: str | None = None
    status: str | None = None
    request_status: str | None = None
    frozen: str | None = None
    search: str | None = None
    mine_only: bool = False
    is_income: bool | None = None
    positioned_only: bool = False
    analytics_1: str | None = None
    analytics_2: str | None = None
    analytics_3: str | None = None
    analytics_4: str | None = None
    analytics_5: str | None = None


Column = Literal["structure", "requested", "approved", "rejected", "previous_step", "your_step", "status", "justification", "comment", "files", "analytics_1", "analytics_2", "analytics_3", "analytics_4", "analytics_5"]
ScopeField = Literal["cfo_id", "article_id", "category_id", "module_id", "request_id", "analytics_1", "analytics_2", "analytics_3", "analytics_4", "analytics_5"]


class RegisterSort(BaseModel):
    column: Column
    direction: Literal["asc", "desc"]


class RegisterQuery(BaseModel):
    model_config = ConfigDict(extra="forbid")
    mode: Literal["summary", "groups", "rows", "facets", "selection"] = "summary"
    view: Literal["cfo", "article", "category", "module", "request"] = "cfo"
    group_by: list[str] | None = None
    filters: RegisterFilters = Field(default_factory=RegisterFilters)
    columns: dict[Column, list[str] | None] = Field(default_factory=dict)
    sort: RegisterSort | None = None
    scope: dict[ScopeField, str] = Field(default_factory=dict)
    expanded: list[str] | None = None
    page: int = Field(default=1, ge=1)
    page_size: Literal[1, 10, 25, 50, 100, 200] = 50
    include_aggregates: bool = True


class RegisterExport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: RegisterQuery
    include_files: bool = True
    export_kind: Literal["all", "income", "expense"] = "all"
    fixed_only: bool = False
    department_ids: list[str] | None = None
    module_ids: list[str] | None = None


class FilteredGroupDecision(RegisterGroupDecisionIn):
    register_query: RegisterQuery | None = None


class FilteredGroupWorkflowAction(RegisterGroupWorkflowActionIn):
    register_query: RegisterQuery | None = None


def money(value):
    amount = Decimal(str(value or 0)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return f"{amount:,.0f}".replace(",", "\u00a0") + "\u00a0₽"


FINAL_LABELS = {"approved": "Утверждено", "approved_with_changes": "Утверждено с изменениями", "rejected": "Отклонено"}


def row_status(row):
    context = row.get("status_context") or {}
    editable = context.get("editability") or {}
    final = row["status"] in FINAL_LABELS
    if row.get("fixed"):
        return "Зафиксировано"
    if row["status"] == "deleted":
        return "Удалена"
    if row.get("is_cfo_revision_pending") or row.get("is_workflow_revision_marked"):
        return "Выбрано на доработку"
    if row.get("is_in_approval") and final and not any(row.get(key) for key in ("fixed", "is_revision", "is_module_revision", "is_approval_actionable", "is_decision_editable", "is_position_submission_actionable", "is_workflow_submission_actionable", "is_workflow_revision_actionable")):
        return "На согласовании"
    if row.get("is_revision") and row.get("is_current_step_owner") and not row.get("is_position_submission_actionable") and context and not editable.get("can_decide") and final:
        return "Отклонено после доработки" if row["status"] == "rejected" else "Согласовано после доработки"
    saved = (context.get("last_decision") or {}).get("item_status")
    if row.get("is_decision_editable") and saved in FINAL_LABELS:
        return FINAL_LABELS[saved]
    if editable.get("can_decide"):
        return "Ожидает вашего решения"
    if row.get("is_module_revision"):
        return "На доработке"
    if row.get("is_position_submission_actionable") and not row.get("is_revision_actionable"):
        return FINAL_LABELS.get(saved, FINAL_LABELS.get(row["status"], "Передайте экономисту"))
    if row.get("is_revision"):
        return "На доработке"
    if final:
        return FINAL_LABELS[row["status"]]
    if row.get("is_collecting") or row["request_status"] == "draft":
        return "Черновик"
    if row["request_status"] in {"cancelled", "rejected"}:
        return "Заявка отменена" if row["request_status"] == "cancelled" else "Заявка отклонена"
    if row.get("is_cfo_review"):
        return "Ожидает вашего решения" if row.get("is_cfo_review_actionable") else "Проверка ЦФО"
    if row.get("is_in_approval"):
        return "Ожидает вашего решения" if row.get("is_approval_actionable") else "Ожидает предыдущих этапов"
    return "На рассмотрении" if row["status"] == "on_review" else "Не начато"


def group_status(a):
    if not a["total_rows"]:
        return "Нет данных"
    if a.get("cfo_revision_rows"):
        return "На доработке"
    if a["cfo_review_actionable_requests"] + max(a["actionable_positions"] - a.get("submission_positions", 0) - a.get("economist_completion_positions", 0), 0) > 0:
        return "Ожидает вашего решения"
    if a.get("revision_rows") and not a.get("cfo_review_completable_requests"):
        return "На доработке"
    for key, label in (("submission_positions", "Передайте экономисту"), ("economist_completion_positions", "Согласуйте и передайте"), ("cfo_review_completable_requests", "Завершите проверку"), ("revision_rows", "На доработке")):
        if a.get(key):
            return label
    if a["aggregate_status"] in {"approved", "rejected", "partially_approved"}:
        return {"approved": "Всё согласовано", "rejected": "Есть отклонения", "partially_approved": "Частично рассмотрено"}[a["aggregate_status"]]
    if a["collecting_requests"]:
        return "Черновик" if a["collecting_requests"] == a["requests_count"] else "Частично в черновике"
    if a["cfo_review_requests"]:
        return "Проверка ЦФО"
    if a["in_approval_positions"]:
        return "На согласовании"
    return "Частично рассмотрено" if a["aggregate_status"] == "in_progress" else "На рассмотрении"


def values(row=None, group=None):
    if group is not None:
        a = group["aggregates"]
        waiting = max(a["pending_rows"] - a["cfo_review_actionable_requests"] - a["actionable_positions"], 0)
        previous = f'ЦФО: {a["cfo_review_requests"]} на проверке' if a["cfo_review_requests"] else f"Ожидает: {waiting}" if waiting else f'Проверено: {a["approved_rows"] + a["rejected_rows"]}' if a["approved_rows"] else "—"
        decisions = a["cfo_review_actionable_requests"] + max(a["actionable_positions"] - sum(a.get(key, 0) for key in ("submission_positions", "economist_completion_positions", "workflow_ready_positions", "workflow_revision_positions")), 0)
        your = f"К решению: {decisions}" if decisions else None
        for key, label in (("economist_completion_positions", "Согласовать и передать"), ("workflow_ready_positions", "Согласовать и передать"), ("workflow_revision_positions", "На доработку"), ("revision_rows", "На доработке"), ("submission_positions", "Передать экономисту"), ("cfo_review_completable_requests", "Можно передать")):
            if your is None and a.get(key):
                your = label if key == "revision_rows" else f"{label}: {a[key]}"
        if your is None and a["approved_rows"] == a["total_rows"] and a["total_rows"] > 0:
            your = "Все проверено"
        result = {"structure": f'{group["name"]} · {group["label"]}', "requested": money(a["requested_sum"]), "approved": money(a["approved_sum"]), "rejected": money(a["difference"]), "previous_step": previous, "your_step": your or "—", "status": "group:" + group_status(a), "justification": "—", "comment": "—", "files": "—"}
        for field in ANALYTICS_FIELDS:
            value = ((group.get("analytics") or {}).get("fields") or {}).get(field) or {}
            result[field] = "Разные значения" if value.get("mixed") else value.get("value") or "—"
        return result
    context = row.get("status_context") or {}
    previous = context.get("previous_step") or {}
    return {"structure": row.get("name") or "—", "requested": money(row["requested_sum"]), "approved": money(previous["amount"]) if previous.get("amount") is not None else previous.get("label") or money(row["approved_sum"]), "rejected": money(row["approved_sum"] - row["requested_sum"]), "previous_step": previous.get("label") or "—", "your_step": (context.get("your_step") or {}).get("label") or "—", "status": "row:" + row_status(row), "justification": row.get("justification") or "—", "comment": row.get("comment") or "—", "files": str(row.get("files_count") or "—"), **{field: row.get(field) or "—" for field in ANALYTICS_FIELDS}}


class RegisterQueryService:
    def __init__(self, requests):
        self.requests = requests

    def _column_aggregates(self, base, entries):
        # Match the existing table's aggregateRegisterRows contract. Workflow
        # context fields outside this set still describe the complete package.
        fields = {"requested_sum", "approved_sum", "rejected_sum", "pending_sum", "difference", "total_rows", "approved_rows", "rejected_rows", "revision_rows", "cfo_revision_rows", "pending_rows", "requests_count", "modules_count", "aggregate_status", "collecting_requests", "cfo_review_requests", "cfo_review_actionable_requests", "cfo_review_completable_requests", "in_approval_positions", "actionable_positions", "submission_positions", "economist_completion_positions", "workflow_ready_positions", "fixed_rows", "zgd_lock_positions"}
        calculated = self.requests._register_aggregates(entries, include_interim_facts=False)
        return {**base, **{key: calculated[key] for key in fields}}

    def query(self, user, query: RegisterQuery):
        filters = query.filters.model_dump(exclude_none=True)
        active = {key: selected for key, selected in query.columns.items() if selected}
        if not active and query.mode in {"rows", "groups", "selection"}:
            allowed = {"cfo_id", "article_id", "category_id", "module_id", "request_id", *ANALYTICS_FIELDS}
            filters.update({key: "__empty__" if key in ANALYTICS_FIELDS and value == "" else value for key, value in query.scope.items() if key in allowed})
        fast_selection = (
            query.mode == "selection" and not active
            and not filters.get("search") and not filters.get("mine_only")
            and not any(filters.get(key) in {"uncategorized", "unassigned"} for key in ("article_id", "category_id", "cfo_id"))
            and hasattr(self.requests.repo, "register_item_ids")
        )
        if fast_selection:
            repo = self.requests.repo
            return {
                "item_ids": repo.register_item_ids(
                    self.requests.permissions.visible_request_ids(user),
                    filters,
                    repo.load_all("units"),
                )
            }
        fast_page = (
            query.mode == "rows" and not query.include_aggregates and not active
            and not filters.get("search") and not filters.get("mine_only")
            and (query.sort is None or query.sort.column in {"requested", "rejected"})
            and not any(filters.get(key) in {"uncategorized", "unassigned"} for key in ("article_id", "category_id", "cfo_id"))
            and hasattr(self.requests.repo, "register_page_ids")
        )
        if fast_page:
            repo = self.requests.repo
            ids, pagination = repo.register_page_ids(self.requests.permissions.visible_request_ids(user), filters, repo.load_all("units"), page=query.page, page_size=query.page_size, sort=query.sort)
            details = {row["id"]: row for row in self.requests._register_entries(user, **filters, item_ids=set(ids))} if ids else {}
            return {"items": [details[identity] for identity in ids if identity in details], "pagination": pagination, "group": query.scope}
        needs_context = bool(active or query.sort or query.mode == "facets")
        entries = self.requests._register_entries(user, **filters, _details=False, _status_context=needs_context)
        result = self.requests.approval_register(user, view=query.view, group_by=query.group_by, _entries=entries, **filters)
        paths = {}
        groups = []
        def walk(nodes, path=()):
            for group in nodes:
                groups.append(group)
                paths[group["id"]] = (*path, group)
                walk(group["children"], (*path, group))
        walk(result["groups"])
        contextual = {"structure", "requested", "approved", "rejected", "previous_step", "your_step", "status", *ANALYTICS_FIELDS}
        group_values = {group["id"]: values(group=group) for group in groups} if needs_context else {}
        def matches(row, scope):
            return all(str(row.get(key) or "") == value for key, value in scope.items())
        # Scope tuples provide O(depth) membership instead of scanning all groups per line.
        groups_by_scope = {tuple(sorted(group["scope"].items())): group for group in groups}
        levels = query.group_by or DEFAULT_REGISTER_GROUPS[query.view]
        def row_path(row):
            scope = {}
            found = []
            for level in levels:
                key = level if level in ANALYTICS_FIELDS else f"{level}_id"
                scope[key] = str(row.get(key) or "")
                group = groups_by_scope.get(tuple(sorted(scope.items())))
                if group:
                    found.append(group)
            return found
        controls = []
        if needs_context:
            for group in groups:
                controls.append((None, group, {key: {value} for key, value in group_values[group["id"]].items()}))
            for row in entries:
                opts = {key: {value} for key, value in values(row=row).items()}
                for group in row_path(row):
                    for key in contextual:
                        opts[key].add(group_values[group["id"]][key])
                controls.append((row, None, opts))
        def accepted(opts, ignored=None):
            return all(key == ignored or bool(opts[key].intersection(selected)) for key, selected in active.items())
        if query.mode == "facets":
            options = {}
            for key in values(group=groups[0]) if groups else []:
                counts = Counter(value for _, _, opts in controls if accepted(opts, key) for value in opts[key])
                options[key] = [{"value": value, "label": value, "count": count} for value, count in sorted(counts.items())]
            covered = {}
            status_rows = [(row, opts) for row, _, opts in controls if row is not None and accepted(opts, "status")]
            by_status = {}
            by_group_status = {}
            for row, opts in status_rows:
                by_status.setdefault("row:" + row_status(row), set()).add(row["id"])
                for value in opts["status"]:
                    if value.startswith("group:"):
                        by_group_status.setdefault(value, set()).add(row["id"])
            for label, ids in by_group_status.items():
                covered[label] = [status for status, item_ids in by_status.items() if item_ids <= ids]
            return {"options": options, "covered_statuses": covered}
        if active:
            source_aggregates = result["aggregates"]
            source_groups = {group["id"]: group for group in groups}
            accepted_groups = {group["id"] for row, group, opts in controls if group and accepted(opts)}
            accepted_items = {row["id"] for row, group, opts in controls if row and accepted(opts)}
            entries = [row for row in entries if row["id"] in accepted_items or any(group["id"] in accepted_groups for group in row_path(row))]
            result = self.requests.approval_register(user, view=query.view, group_by=query.group_by, _entries=entries, **filters)
            # Column filtering historically counts only accepted facts.
            result["aggregates"] = self._column_aggregates(source_aggregates, entries)
            rows_by_group = {}
            for row in entries:
                for group in row_path(row):
                    rows_by_group.setdefault(group["id"], []).append(row)
            def filtered_groups(nodes):
                for group in nodes:
                    source = source_groups[group["id"]]
                    group["source_aggregates"] = source["aggregates"]
                    group["aggregates"] = self._column_aggregates(source["aggregates"], rows_by_group.get(group["id"], []))
                    if group.get("analytics") and group["aggregates"]["total_rows"] != source["aggregates"]["total_rows"]:
                        group["analytics"]["can_edit"] = False
                    filtered_groups(group["children"])
            filtered_groups(result["groups"])
        if query.scope:
            entries = [row for row in entries if matches(row, query.scope)]
        if query.mode == "selection":
            return {"item_ids": [row["id"] for row in entries]}
        if query.mode == "rows":
            entries = self.requests._sort_register_entries(entries)
            if query.sort:
                field = query.sort.column
                def sort_value(row):
                    if field in {"requested", "approved", "rejected"}:
                        if field == "requested": return row["requested_sum"]
                        if field == "rejected": return row["approved_sum"] - row["requested_sum"]
                        previous = (row.get("status_context") or {}).get("previous_step") or {}
                        return previous["amount"] if previous.get("amount") is not None else row["approved_sum"]
                    value = row["status"] if field == "status" else values(row=row)[field]
                    return tuple((0, int(part)) if part.isdigit() else (1, part.casefold()) for part in re.split(r"(\d+)", value))
                entries.sort(key=sort_value, reverse=query.sort.direction == "desc")
            pagination = self.requests._register_pagination(len(entries), query.page, query.page_size)
            page = self.requests._slice_register_page(entries, pagination["page"], query.page_size)
            if page:
                details = {row["id"]: row for row in self.requests._register_entries(user, **filters, item_ids={row["id"] for row in page})}
                page = [details[row["id"]] for row in page]
            return {"items": page, "pagination": pagination, "group": {**query.scope, "aggregates": self.requests._register_aggregates(entries, include_interim_facts=not active and not filters.get("positioned_only"))}}
        result.pop("summary_items", None)
        result["visible_request_statuses"] = sorted({row["request_status"] for row in entries})
        result["visible_unit_ids"] = sorted({row[key] for row in entries for key in ("cfo_id", "module_id")})
        result["matched_item_ids"] = [row["id"] for row in entries] if active else None
        defaults = {"cfo": {"cfo", "article"}, "module": {"module", "article"}, "article": {"article"}, "category": {"category", "module"}, "request": set()}[query.view]
        expanded = set(query.expanded or [])
        def prune(nodes):
            return [{**group, "has_children": bool(group["children"]), "children": prune(group["children"]) if (group["id"] in expanded or query.expanded is None and group["type"] in defaults) else []} for group in nodes]
        if query.mode == "groups":
            def children(nodes):
                for group in nodes:
                    if group["scope"] == query.scope:
                        return group["children"]
                    found = children(group["children"])
                    if found is not None:
                        return found
                return None
            result["groups"] = [{**group, "has_children": bool(group["children"]), "children": []} for group in (children(result["groups"]) or [])]
        else:
            result["groups"] = prune(result["groups"])
        return result

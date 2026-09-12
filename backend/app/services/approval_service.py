from __future__ import annotations

from contextlib import nullcontext
from uuid import uuid4

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder

from app.models import APPROVED_ITEM_STATUSES, CfoPositionStatus, ItemStatus, RequestStatus, StepStatus
from app.repositories.base import Repository
from app.repositories.queries import find_rows
from app.repositories.pagination import cursor_page, decode_cursor, encode_cursor
from app.services.budget_item_service import BudgetItemService
from app.services.budget_totals import sync_annual_budgets
from app.services.common import (
    cfo_position_current_step_id,
    derived_request_status,
    get_required,
    now_iso,
    public_user,
    request_author_id,
    request_cfo_review_completed,
)
from app.services.permission_service import PermissionService


class ApprovalService:
    def __init__(self, repo: Repository, permissions: PermissionService, chat_service=None):
        self.repo = repo
        self.permissions = permissions
        self.chat_service = chat_service
        self.notifications = None

    @staticmethod
    def _event_id() -> str:
        return str(uuid4())

    @staticmethod
    def _preload_approval_batch(repo: Repository) -> list[dict]:
        """Prime stable lookup tables once before a multi-position write."""
        for collection in (
            "requests",
            "req_items",
            "cfo_positions",
            "steps",
            "users",
            "dds_catalog",
            "invests_catalog",
        ):
            repo.load_all(collection)
        return repo.load_all("cfo_position_logs")

    @staticmethod
    def _steps(repo: Repository) -> dict[str, dict]:
        return {row["id"]: row for row in repo.load_all("steps")}

    @staticmethod
    def _edges(repo: Repository) -> list[dict]:
        return repo.load_all("step_edges")

    @staticmethod
    def _current_step_id(repo: Repository, position: dict) -> str | None:
        return cfo_position_current_step_id(repo, position)

    @staticmethod
    def _parents(step_id: str, edges: list[dict]) -> list[str]:
        return [row["parent_step_id"] for row in edges if row["child_step_id"] == step_id]

    @staticmethod
    def _children(step_id: str, edges: list[dict]) -> list[str]:
        return [row["child_step_id"] for row in edges if row["parent_step_id"] == step_id]

    @staticmethod
    def _descendant_step_ids(step_id: str, edges: list[dict]) -> set[str]:
        found: set[str] = set()
        pending = list(ApprovalService._children(step_id, edges))
        while pending:
            current = pending.pop()
            if current in found:
                continue
            found.add(current)
            pending.extend(ApprovalService._children(current, edges))
        return found

    def _handover_source_step_id(
        self, repo: Repository, step_id: str, position: dict, candidates: list[str]
    ) -> str | None:
        """Return the lower step that last forwarded this position to `step_id`."""
        candidate_set = set(candidates)
        if not candidate_set:
            return None
        incoming = [
            row
            for row in find_rows(
                repo,
                "cfo_position_logs",
                filters={"cfo_position_id": position["id"]},
            )
            if row.get("cfo_position_id") == position["id"]
            and (row.get("log") or {}).get("action") in {
                "position_sent_to_economist",
                "position_frozen_and_forwarded",
                "position_approved_at_step",
            }
            and (row.get("log") or {}).get("current_step_id") == step_id
            and (row.get("log") or {}).get("step_id") in candidate_set
        ]
        if not incoming:
            return None
        latest = max(
            incoming,
            key=lambda row: (str(row.get("created_at") or ""), int(row.get("id") or 0)),
        )
        return (latest.get("log") or {}).get("step_id")

    def _default_return_step_id(self, repo: Repository, step_id: str, position: dict) -> str:
        """Pick the previous route stage for this position without user input."""
        edges = self._edges(repo)
        children = self._children(step_id, edges)
        if not children:
            raise HTTPException(status_code=422, detail="Для текущего шага нет нижнего шага возврата")
        # Return one hop toward the origin: the unique child that still leads to
        # this position's CFO leaf. Sibling branches of a later reviewer must
        # not steal the return.
        route_children = list(children)
        cfo_unit_id = position.get("cfo_unit_id")
        if cfo_unit_id:
            try:
                leaf_id = self._leaf_for_cfo(repo, cfo_unit_id)["id"]
            except HTTPException:
                leaf_id = None
            if leaf_id:
                matching = [
                    child_id
                    for child_id in children
                    if child_id == leaf_id or leaf_id in self._descendant_step_ids(child_id, edges)
                ]
                if matching:
                    route_children = matching
        if len(route_children) == 1:
            return route_children[0]
        # A diamond in the graph can leave several children on the same CFO path.
        # Prefer the step that actually handed the position over.
        source = self._handover_source_step_id(repo, step_id, position, route_children)
        if source:
            return source
        if cfo_unit_id:
            for child_id in route_children:
                child = get_required(repo, "steps", child_id)
                if child.get("unit_id") == cfo_unit_id:
                    return child_id
            for child_id in route_children:
                child = get_required(repo, "steps", child_id)
                if cfo_unit_id in self._economist_cfo_ids(repo, child):
                    return child_id
        if len(children) == 1:
            return children[0]
        raise HTTPException(
            status_code=422,
            detail="Не удалось автоматически определить шаг возврата — укажите шаг явно",
        )

    @staticmethod
    def _approver_approved_item_ids(
        repo: Repository,
        position_id: str,
        step_id: str,
        *,
        logs: list[dict] | None = None,
    ) -> set[str]:
        """Return line decisions made during the position's current visit to a reviewer step."""
        logs = [
            row
            for row in (
                logs
                if logs is not None
                else find_rows(
                    repo,
                    "cfo_position_logs",
                    filters={"cfo_position_id": position_id},
                )
            )
            if row.get("cfo_position_id") == position_id
        ]
        reset_key = max(
            (
                (str(row.get("created_at") or ""), int(row.get("id") or 0))
                for row in logs
                if (row.get("log") or {}).get("action") in {
                    "position_frozen_and_forwarded", "position_returned"
                }
                and (row.get("log") or {}).get("current_step_id") == step_id
            ),
            default=("", 0),
        )
        return {
            str(item_id)
            for row in logs
            if (row.get("log") or {}).get("action") == "position_items_approved_at_step"
            and (row.get("log") or {}).get("step_id") == step_id
            and (str(row.get("created_at") or ""), int(row.get("id") or 0)) > reset_key
            for item_id in (row.get("log") or {}).get("item_ids") or []
        }

    def _root_ids(self, repo: Repository) -> list[str]:
        steps = self._steps(repo)
        children = {row["child_step_id"] for row in self._edges(repo)}
        return [step_id for step_id in steps if step_id not in children]

    @staticmethod
    def _system_actor(repo: Repository) -> dict | None:
        """Use an administrator as the auditable actor for system bootstrap."""
        admins = [row for row in repo.load_all("users") if row.get("role") == "admin"]
        return min(admins, key=lambda row: (row.get("login", ""), row["id"])) if admins else None

    def sync_automatic_steps(self, user: dict | None = None) -> dict:
        """Synchronise system-owned CFO, economist and ZGD route anchors.

        A single economist step may have several CFO anchors as children.  The
        CFO-to-economist links are derived from ``units_responsibles``; further
        reviewer links remain administrator-configured.
        """
        actor = user or self._system_actor(self.repo)
        if not actor:
            return {"created": [], "skipped": [{"reason": "no_admin_for_audit_log"}]}

        created: list[dict] = []
        skipped: list[dict] = []
        with self.repo.transaction() as repo:
            existing = repo.load_all("steps")
            existing_zgd_ids = {
                row.get("user_id")
                for row in existing
                if row.get("user_id")
                and repo.get_by_id("users", row["user_id"])
                and repo.get_by_id("users", row["user_id"]).get("role") == "zgd"
            }
            cfo_units = sorted(
                (
                    row
                    for row in repo.load_all("units")
                    if row.get("is_active") and self.permissions.unit_level(row["id"]) == 2
                ),
                key=lambda row: (row.get("name", ""), row["id"]),
            )

            def user_role(step: dict) -> str | None:
                account = repo.get_by_id("users", step.get("user_id")) if step.get("user_id") else None
                return account.get("role") if account else None

            # Preserve one existing automatic-like step per economist and merge
            # the former per-CFO duplicates into it.
            economist_steps: dict[str, dict] = {}
            candidates = sorted(
                (step for step in existing if step.get("unit_id") is None and user_role(step) == "economist"),
                key=lambda step: step["id"],
            )
            for step in candidates:
                economist_steps.setdefault(step["user_id"], step)

            for cfo in cfo_units:
                cfo_step = next((row for row in existing if row.get("unit_id") == cfo["id"]), None)
                if not cfo_step:
                    cfo_step = repo.create(
                        "steps",
                        {"unit_id": cfo["id"], "user_id": None, "status": StepStatus.waiting},
                    )
                    existing.append(cfo_step)
                    self._step_log(
                        repo, actor, cfo_step, "automatic_cfo_step_created",
                        event_id=self._event_id(), changes=self._changes({}, cfo_step), source="system",
                    )
                    created.append({"step_id": cfo_step["id"], "kind": "cfo", "unit_id": cfo["id"]})

                economist_id = self.permissions.cfo_economist_id(cfo["id"])
                if not economist_id:
                    skipped.append({"unit_id": cfo["id"], "reason": "no_cfo_economist"})
                    continue
                economist_step = economist_steps.get(economist_id)
                if not economist_step:
                    economist_step = repo.create(
                        "steps",
                        {"unit_id": None, "user_id": economist_id, "status": StepStatus.waiting},
                    )
                    existing.append(economist_step)
                    economist_steps[economist_id] = economist_step
                    self._step_log(
                        repo, actor, economist_step, "automatic_economist_step_created",
                        event_id=self._event_id(), changes=self._changes({}, economist_step),
                        source="system", cfo_unit_id=cfo["id"],
                    )
                    created.append({"step_id": economist_step["id"], "kind": "economist", "unit_id": cfo["id"]})

                parent_ids = self._parents(cfo_step["id"], self._edges(repo))
                for parent_id in list(parent_ids):
                    if parent_id == economist_step["id"]:
                        continue
                    parent = get_required(repo, "steps", parent_id)
                    # If this is a duplicate economist step, it was previously
                    # dedicated to this CFO. Move the CFO to the shared step,
                    # while retaining any downstream reviewer links.
                    if user_role(parent) == "economist":
                        repo.delete_where(
                            "step_edges",
                            {"parent_step_id": parent_id, "child_step_id": cfo_step["id"]},
                        )
                        for grandparent_id in self._parents(parent_id, self._edges(repo)):
                            if grandparent_id == economist_step["id"]:
                                continue
                            if not any(
                                edge.get("parent_step_id") == grandparent_id
                                and edge.get("child_step_id") == economist_step["id"]
                                for edge in self._edges(repo)
                            ):
                                repo.create(
                                    "step_edges",
                                    {"parent_step_id": grandparent_id, "child_step_id": economist_step["id"]},
                                )
                        for position in repo.load_all("cfo_positions"):
                            if (
                                self._current_step_id(repo, position) == parent_id
                                and position.get("cfo_unit_id") == cfo["id"]
                            ):
                                before = dict(position)
                                after = repo.update(
                                    "cfo_positions",
                                    position["id"],
                                    {"current_step_id": economist_step["id"]},
                                )
                                self._position_log(
                                    repo, actor, after, "position_moved_to_shared_economist_step",
                                    before=before, after=after, step_id=economist_step["id"],
                                    current_step_id=economist_step["id"], source="system",
                                )
                    else:
                        # Legacy direct reviewer -> CFO link: insert the shared
                        # economist step between them.
                        repo.delete_where(
                            "step_edges",
                            {"parent_step_id": parent_id, "child_step_id": cfo_step["id"]},
                        )
                        if not any(
                            edge.get("parent_step_id") == parent_id
                            and edge.get("child_step_id") == economist_step["id"]
                            for edge in self._edges(repo)
                        ):
                            repo.create(
                                "step_edges",
                                {"parent_step_id": parent_id, "child_step_id": economist_step["id"]},
                            )
                if not any(
                    edge.get("parent_step_id") == economist_step["id"]
                    and edge.get("child_step_id") == cfo_step["id"]
                    for edge in self._edges(repo)
                ):
                    repo.create(
                        "step_edges",
                        {"parent_step_id": economist_step["id"], "child_step_id": cfo_step["id"]},
                    )
                    self._step_log(
                        repo, actor, economist_step, "automatic_economist_link_created",
                        event_id=self._event_id(), source="system", cfo_unit_id=cfo["id"],
                        parent_step_id=economist_step["id"], child_step_id=cfo_step["id"],
                    )
            shared_ids = {step["id"] for step in economist_steps.values()}
            for step in list(existing):
                if (
                    step.get("id") in shared_ids
                    or step.get("unit_id") is not None
                    or user_role(step) != "economist"
                    or self._children(step["id"], self._edges(repo))
                    or any(self._current_step_id(repo, position) == step["id"] for position in repo.load_all("cfo_positions"))
                ):
                    continue
                repo.delete_where("step_edges", {"parent_step_id": step["id"]})
                repo.delete_where("step_edges", {"child_step_id": step["id"]})
                self._step_log(
                    repo, actor, step, "automatic_duplicate_economist_step_removed",
                    event_id=self._event_id(), source="system",
                )
                repo.delete("steps", step["id"])

            zgd_users = sorted(
                (row for row in repo.load_all("users") if row.get("role") == "zgd"),
                key=lambda row: (row.get("login", ""), row["id"]),
            )
            for zgd in zgd_users:
                if zgd["id"] in existing_zgd_ids:
                    continue
                step = repo.create(
                    "steps",
                    {"unit_id": None, "user_id": zgd["id"], "status": StepStatus.waiting},
                )
                self._step_log(
                    repo, actor, step, "automatic_zgd_step_created",
                    event_id=self._event_id(), changes=self._changes({}, step), source="system",
                )
                created.append({"step_id": step["id"], "kind": "zgd", "user_id": zgd["id"]})
            # Route maintenance may move an active position between equivalent
            # automatic steps.  Keep the presentation status derived from the
            # resulting current step in the same transaction.
            self._sync_step_statuses(repo)
        return {"created": created, "skipped": skipped}

    def _leaf_for_cfo(self, repo: Repository, cfo_id: str) -> dict:
        step = next(
            (row for row in repo.load_all("steps") if row.get("unit_id") == cfo_id),
            None,
        )
        if not step:
            raise HTTPException(status_code=409, detail="Для ЦФО не настроен листовой шаг")
        if self._children(step["id"], self._edges(repo)):
            raise HTTPException(status_code=409, detail="Шаг ЦФО должен быть листовым")
        return step

    def _economist_step_for_cfo(self, repo: Repository, cfo_id: str) -> dict:
        leaf = self._leaf_for_cfo(repo, cfo_id)
        economist_id = self.permissions.cfo_economist_id(cfo_id)
        step = next(
            (
                get_required(repo, "steps", parent_id)
                for parent_id in self._parents(leaf["id"], self._edges(repo))
                if get_required(repo, "steps", parent_id).get("user_id") == economist_id
                and get_required(repo, "steps", parent_id).get("unit_id") is None
            ),
            None,
        )
        if not step:
            raise HTTPException(status_code=409, detail="Для ЦФО не настроен шаг экономиста")
        return step

    def _economist_cfo_ids(self, repo: Repository, step: dict) -> set[str]:
        if step.get("unit_id") or not step.get("user_id"):
            return set()
        return {
            child["unit_id"]
            for child_id in self._children(step["id"], self._edges(repo))
            if (child := repo.get_by_id("steps", child_id))
            and child.get("unit_id")
            and self.permissions.cfo_economist_id(child["unit_id"]) == step["user_id"]
        }

    def _economist_cfo_id(self, repo: Repository, step: dict) -> str | None:
        return next(iter(sorted(self._economist_cfo_ids(repo, step))), None)

    def _step_actor(self, repo: Repository, step: dict) -> dict | None:
        user_id = None if step.get("unit_id") else step.get("user_id")
        return repo.get_by_id("users", user_id) if user_id else None

    @staticmethod
    def _changes(before: dict, after: dict) -> dict:
        return {
            key: {"from": before.get(key), "to": after.get(key)}
            for key in set(before) | set(after)
            if before.get(key) != after.get(key)
        }

    def _position_log(
        self,
        repo: Repository,
        user: dict,
        position: dict,
        action: str,
        *,
        before: dict | None = None,
        after: dict | None = None,
        comment: str | None = None,
        event_id: str | None = None,
        step_id: str | None = None,
        current_step_id: str | None = None,
        req_item_id: str | None = None,
        request_id: str | None = None,
        **extra,
    ) -> dict:
        event_id = event_id or self._event_id()
        active_step_id = (
            self._current_step_id(repo, position)
            if current_step_id is None and action != "position_fixed"
            else current_step_id
        )
        return repo.create(
            "cfo_position_logs",
            {
                "cfo_position_id": position["id"],
                "user_id": user["id"],
                "step_id": step_id if step_id is not None else active_step_id,
                "log": jsonable_encoder(
                    {
                        "event_id": event_id,
                        "action": action,
                        "stage": "cfo_position",
                        "entity": "req_item" if req_item_id else "cfo_position",
                        "entity_id": req_item_id or position["id"],
                        "request_id": request_id,
                        "req_item_id": req_item_id,
                        "cfo_position_id": position["id"],
                        "step_id": step_id if step_id is not None else active_step_id,
                        "current_step_id": active_step_id,
                        "changes": self._changes(before or {}, after or {}),
                        "comment": comment,
                        **extra,
                    }
                ),
                "created_at": now_iso(),
            },
        )

    @staticmethod
    def _step_log(
        repo: Repository,
        user: dict,
        step: dict,
        action: str,
        *,
        event_id: str,
        changes: dict | None = None,
        comment: str | None = None,
        **extra,
    ) -> dict:
        return repo.create(
            "step_logs",
            {
                "step_id": step["id"],
                "user_id": user["id"],
                "log": jsonable_encoder(
                    {
                        "event_id": event_id,
                        "action": action,
                        "stage": "approval_graph",
                        "entity": "step",
                        "entity_id": step["id"],
                        "step_id": step["id"],
                        "changes": changes or {},
                        "comment": comment,
                        **extra,
                    }
                ),
                "created_at": now_iso(),
            },
        )

    @staticmethod
    def _collect_upstream_step_ids(step_id: str, edges: list[dict]) -> set[str]:
        result: set[str] = set()
        queue = ApprovalService._parents(step_id, edges)
        while queue:
            current = queue.pop()
            if current in result:
                continue
            result.add(current)
            queue.extend(ApprovalService._parents(current, edges))
        return result

    def _positions_for_step(
        self,
        repo: Repository,
        step: dict,
        positions: list[dict],
        edges: list[dict],
        *,
        position_logs: list[dict] | None = None,
    ) -> list[dict]:
        if step.get("unit_id"):
            return [row for row in positions if row.get("cfo_unit_id") == step["unit_id"]]
        cfo_ids = self._economist_cfo_ids(repo, step)
        if cfo_ids:
            return [row for row in positions if row.get("cfo_unit_id") in cfo_ids]
        historical_ids = {
            row.get("cfo_position_id")
            for row in (
                position_logs
                if position_logs is not None
                else repo.load_all("cfo_position_logs")
            )
            if row.get("step_id") == step["id"]
            or (row.get("log") or {}).get("step_id") == step["id"]
        }
        return [
            row for row in positions
            if self._current_step_id(repo, row) == step["id"] or row["id"] in historical_ids
        ]

    def _step_runtime_status(
        self,
        repo: Repository,
        step: dict,
        positions: list[dict],
        edges: list[dict],
        *,
        position_items: dict[str, list[dict]] | None = None,
        position_logs: list[dict] | None = None,
    ) -> str:
        step_id = step["id"]
        active = [row for row in positions if self._current_step_id(repo, row) == step_id]

        # The responsible-CFO step is opened only after all already-created
        # applications of this CFO have been submitted.  A draft application
        # is therefore a real prerequisite even when another module has
        # already delivered its position.  Do not infer this from positions:
        # a draft has no position yet and would otherwise be invisible here.
        if step.get("unit_id"):
            cfo_modules = self.permissions.modules_for_cfos({step["unit_id"]})
            cfo_requests = [
                request
                for request in repo.load_all("requests")
                if request.get("unit_id") in cfo_modules
                and request.get("status") != RequestStatus.cancelled
            ]
            if any(row.get("status") == CfoPositionStatus.on_revision for row in active):
                return StepStatus.on_revision
            if not cfo_requests or any(
                request.get("status") == RequestStatus.draft
                for request in cfo_requests
            ):
                return StepStatus.waiting

        if active:
            if any(row.get("status") == CfoPositionStatus.on_revision for row in active):
                return StepStatus.on_revision
            if any(row.get("status") == CfoPositionStatus.on_approval for row in active):
                return StepStatus.on_approval
            if all(row.get("status") == CfoPositionStatus.approved for row in active):
                return StepStatus.approved
            return StepStatus.on_approval

        scoped = self._positions_for_step(
            repo, step, positions, edges, position_logs=position_logs
        )
        if not scoped:
            return StepStatus.waiting

        if all(
            self._all_items_fixed(
                position_items.get(row["id"], [])
                if position_items is not None
                else self._position_items(repo, row["id"])
            )
            for row in scoped
        ):
            return StepStatus.closed

        upstream = self._collect_upstream_step_ids(step_id, edges)
        if any(
            self._current_step_id(repo, row) in upstream
            for row in scoped
            if row.get("status") in {CfoPositionStatus.on_approval, CfoPositionStatus.approved}
        ):
            return StepStatus.approved

        if all(row.get("status") == CfoPositionStatus.approved for row in scoped):
            return StepStatus.approved

        if any(row.get("status") == CfoPositionStatus.on_revision for row in scoped):
            return StepStatus.on_revision

        if any(row.get("status") == CfoPositionStatus.waiting for row in scoped):
            return StepStatus.waiting

        return StepStatus.waiting

    def _sync_step_statuses(self, repo: Repository) -> None:
        steps = list(repo.load_all("steps"))
        active_request_ids = {
            request["id"]
            for request in repo.load_all("requests")
            if request.get("status") != RequestStatus.cancelled
        }
        position_items: dict[str, list[dict]] = {}
        for item in repo.load_all("req_items"):
            position_id = item.get("cfo_position_id")
            if (
                position_id
                and item.get("status") != ItemStatus.deleted
                and item.get("request_id") in active_request_ids
            ):
                position_items.setdefault(position_id, []).append(item)
        positions = [
            position
            for position in repo.load_all("cfo_positions")
            if position["id"] in position_items
        ]
        edges = self._edges(repo)
        position_logs = repo.load_all("cfo_position_logs")
        for step in steps:
            status = self._step_runtime_status(
                repo,
                step,
                positions,
                edges,
                position_items=position_items,
                position_logs=position_logs,
            )
            if step.get("status") != status:
                repo.update("steps", step["id"], {"status": status})

    def _sync_request_statuses(
        self,
        repo: Repository,
        user: dict,
        request_ids: set[str],
        *,
        event_id: str,
        action: str,
    ) -> None:
        for request_id in sorted(request_ids):
            request = get_required(repo, "requests", request_id)
            if request.get("status") in {RequestStatus.draft, RequestStatus.cancelled}:
                continue
            items = [
                row for row in repo.load_all("req_items")
                if row.get("request_id") == request_id
            ]
            status = derived_request_status(items)
            if request.get("status") == status:
                continue
            updated = repo.update("requests", request_id, {"status": status})
            repo.create(
                "req_logs",
                {
                    "req_id": request_id,
                    "user_id": user["id"],
                    "log": {
                        "event_id": event_id,
                        "action": action,
                        "stage": "final_approval",
                        "entity": "request",
                        "entity_id": request_id,
                        "request_id": request_id,
                        "changes": {
                            "status": {"from": request.get("status"), "to": updated.get("status")}
                        },
                        "comment": None,
                    },
                },
            )

    def _public_steps(
        self,
        repo: Repository,
        steps: list[dict],
        *,
        positions_override: list[dict] | None = None,
    ) -> list[dict]:
        edges = self._edges(repo)
        units = {row["id"]: row for row in repo.load_all("units")}
        users = {row["id"]: row for row in repo.load_all("users")}
        profiles = {row["user_id"]: row for row in repo.load_all("profiles")}
        positions = positions_override if positions_override is not None else repo.load_all("cfo_positions")
        assignments = repo.load_all("units_responsibles")
        requests = repo.load_all("requests")
        position_items: dict[str, list[dict]] = {}
        for item in repo.load_all("req_items"):
            if item.get("cfo_position_id"):
                position_items.setdefault(item["cfo_position_id"], []).append(item)

        def enrich_user(user_id: str | None) -> dict | None:
            account = users.get(user_id) if user_id else None
            if not account:
                return None
            return {**public_user(account), "profile": profiles.get(account["id"])}

        def employee_for(unit_id: str) -> dict | None:
            return enrich_user(next((
                assignment["user_id"]
                for assignment in assignments
                if assignment.get("unit_id") == unit_id
                and assignment.get("is_active")
                and users.get(assignment.get("user_id"), {}).get("role") == "employee"
            ), None))

        def modules_for(cfo_id: str) -> list[dict]:
            modules = [
                row for row in units.values()
                if row.get("parent_id") == cfo_id
                and not any(child.get("parent_id") == row["id"] for child in units.values())
            ]
            result = []
            for module in sorted(modules, key=lambda row: (row.get("name", ""), row["id"])):
                counts: dict[str, int] = {}
                for request in requests:
                    if request.get("unit_id") == module["id"]:
                        status = str(request.get("status"))
                        counts[status] = counts.get(status, 0) + 1
                result.append(
                    {
                        "id": module["id"],
                        "name": module["name"],
                        "responsible": employee_for(module["id"]),
                        "request_statuses": [
                            {"status": status.value, "count": counts[status.value]}
                            for status in RequestStatus
                            if counts.get(status.value)
                        ],
                    }
                )
            return result

        def readiness_for(step: dict, active_positions: list[dict]) -> dict[str, int]:
            """Summarise the next real action for positions at one route step."""
            readiness = {
                "needs_line_decisions": 0,
                "awaiting_return_confirmation": 0,
                "needs_revision": 0,
                "ready_for_next_action": 0,
            }
            is_economist_step = bool(self._economist_cfo_ids(repo, step))
            for position in active_positions:
                items = [
                    item for item in position_items.get(position["id"], [])
                    if item.get("status") != ItemStatus.deleted
                ]
                if not items or self._all_items_fixed(items):
                    continue
                if position.get("status") == CfoPositionStatus.on_revision:
                    readiness["needs_revision"] += 1
                    continue
                if step.get("unit_id"):
                    if position.get("status") in {
                        CfoPositionStatus.waiting,
                        CfoPositionStatus.on_review,
                    }:
                        readiness["needs_line_decisions"] += 1
                    else:
                        readiness["ready_for_next_action"] += 1
                    continue
                if is_economist_step:
                    decisions = self._economist_decisions(repo, position["id"])
                    if any(item["id"] not in decisions for item in items):
                        readiness["needs_line_decisions"] += 1
                    elif any(decisions.get(item["id"]) == "on_revision" for item in items):
                        readiness["awaiting_return_confirmation"] += 1
                    else:
                        readiness["ready_for_next_action"] += 1
                    continue
                if self._pending_position_decision_ids(repo, position, step, items):
                    readiness["needs_line_decisions"] += 1
                else:
                    readiness["ready_for_next_action"] += 1
            return readiness

        result = []
        for step in steps:
            actor = self._step_actor(repo, step)
            active = [row for row in positions if self._current_step_id(repo, row) == step["id"]]
            scoped_positions = self._positions_for_step(repo, step, positions, edges)
            economist_cfo_ids = sorted(self._economist_cfo_ids(repo, step))
            economist_cfo_id = economist_cfo_ids[0] if economist_cfo_ids else None
            cfo = units.get(step.get("unit_id") or economist_cfo_id)
            department = units.get(cfo.get("parent_id")) if cfo else None
            result.append(
                {
                    **step,
                    "unit": cfo,
                    "cfo": cfo,
                    "department": department,
                    "unit_path": [row["name"] for row in (department, cfo) if row],
                    "responsible": employee_for(cfo["id"]) if cfo else None,
                    "modules": modules_for(cfo["id"]) if step.get("unit_id") and cfo else [],
                    "user": enrich_user(actor["id"] if actor else None),
                    "is_economist_step": bool(economist_cfo_id),
                    "cfo_unit_id": economist_cfo_id,
                    "cfo_unit_ids": economist_cfo_ids,
                    "cfo_names": [units[cfo_id]["name"] for cfo_id in economist_cfo_ids if cfo_id in units],
                    "parent_step_ids": self._parents(step["id"], edges),
                    "child_step_ids": self._children(step["id"], edges),
                    "active_positions_count": len(active),
                    "revision_positions_count": sum(
                        row.get("status") == CfoPositionStatus.on_revision
                        for row in scoped_positions
                    ),
                    "readiness": readiness_for(step, active),
                    "request_status": self._step_runtime_status(repo, step, positions, edges),
                }
            )
        return result

    def _validate_step_shape(
        self,
        repo: Repository,
        user_id: str | None,
        unit_id: str | None,
        *,
        exclude_step_id: str | None = None,
    ) -> None:
        if unit_id:
            get_required(repo, "units", unit_id)
            if self.permissions.unit_level(unit_id) != 2:
                raise HTTPException(status_code=422, detail="Листовой шаг относится к ЦФО")
            if user_id is not None:
                raise HTTPException(status_code=422, detail="Экономист листового шага определяется назначением ЦФО")
            if not self.permissions.cfo_economist_id(unit_id):
                raise HTTPException(status_code=409, detail="У ЦФО нет активного экономиста")
            if any(
                row["id"] != exclude_step_id and row.get("unit_id") == unit_id
                for row in repo.load_all("steps")
            ):
                raise HTTPException(status_code=409, detail="Для ЦФО уже существует листовой шаг")
            return
        if not user_id:
            raise HTTPException(status_code=422, detail="Для проверяющего укажите пользователя")
        actor = get_required(repo, "users", user_id)
        if actor.get("role") not in {"approver", "zgd"}:
            raise HTTPException(status_code=422, detail="Шаг назначается проверяющему или ЗГД")

    def list_steps(self, user: dict) -> list[dict]:
        if user.get("role") == "admin":
            self.sync_automatic_steps(user)
        steps = self.repo.load_all("steps")
        if user.get("role") == "admin":
            return self._public_steps(self.repo, steps)
        allowed: set[str] = set()
        for step in steps:
            actor = self._step_actor(self.repo, step)
            if actor and actor["id"] == user["id"]:
                allowed.add(step["id"])
        return self._public_steps(self.repo, [row for row in steps if row["id"] in allowed])

    def approval_route(self, user: dict, request_id: str | None = None) -> list[dict]:
        """Return the connected, read-only approval branch relevant to the viewer."""
        self.sync_automatic_steps(user)
        positions_override = None
        if request_id:
            request = get_required(self.repo, "requests", request_id)
            self.permissions.require_view_request(user, request)
            request_item_ids = {
                item["id"]
                for item in self.repo.load_all("req_items")
                if item.get("request_id") == request_id
            }
            position_ids = {
                item.get("cfo_position_id")
                for item in self.repo.load_all("req_items")
                if item.get("id") in request_item_ids and item.get("cfo_position_id")
            }
            positions_override = [
                position for position in self.repo.load_all("cfo_positions")
                if position.get("id") in position_ids
            ]
        all_steps = self._public_steps(
            self.repo,
            self.repo.load_all("steps"),
            positions_override=positions_override,
        )
        if user.get("role") == "admin":
            return all_steps
        if user.get("role") == "employee":
            directly_responsible_cfo_ids = self.permissions.employee_cfo_ids(user["id"])
            module_ids = self.permissions.employee_module_ids(user["id"])
            cfo_ids = directly_responsible_cfo_ids | {
                cfo_id
                for module_id in module_ids
                if (cfo_id := self.permissions.cfo_for_module(module_id))
            }
            relevant = {
                step["id"]
                for step in all_steps
                if step.get("unit_id") in cfo_ids
            }
        elif user.get("role") == "economist":
            cfo_ids = self.permissions.economist_cfo_ids(user["id"])
            relevant = {
                step["id"]
                for step in all_steps
                if step.get("unit_id") in cfo_ids or step.get("user_id") == user["id"]
            }
        elif user.get("role") in {"approver", "zgd"}:
            relevant = {step["id"] for step in all_steps if step.get("user_id") == user["id"]}
        else:
            raise HTTPException(status_code=403, detail="Нет доступа к маршруту согласования")
        if not relevant:
            return []
        by_id = {step["id"]: step for step in all_steps}
        # Edges point from the next approval stage (parent) to the previous one
        # (child).  Show every viewer the full branch through their own step:
        # all preceding stages below it and all subsequent stages above it.
        # The two directed walks start from the viewer's initial steps so a
        # shared next stage does not pull in unrelated sibling branches.
        viewer_step_ids = set(relevant)

        def expand_from_viewer(edge_key: str) -> set[str]:
            expanded = set(viewer_step_ids)
            pending = list(viewer_step_ids)
            while pending:
                step = by_id.get(pending.pop())
                if not step:
                    continue
                for linked_id in step.get(edge_key, []):
                    if linked_id not in expanded:
                        expanded.add(linked_id)
                        pending.append(linked_id)
            return expanded

        relevant = (
            expand_from_viewer("child_step_ids")
            | expand_from_viewer("parent_step_ids")
        )

        # Return a stable child-to-parent order for the vertical route.  This
        # preserves every branch while keeping the visual flow from the first
        # responsible stage to the final stage (ZGD).
        by_id = {step["id"]: step for step in all_steps}
        ordered: list[dict] = []
        visited: set[str] = set()

        def append_branch(step_id: str) -> None:
            if step_id in visited or step_id not in relevant:
                return
            visited.add(step_id)
            step = by_id.get(step_id)
            if not step:
                return
            for child_id in step.get("child_step_ids", []):
                append_branch(child_id)
            ordered.append(step)

        roots = [
            step["id"] for step in all_steps
            if step["id"] in relevant
            and not any(parent_id in relevant for parent_id in step.get("parent_step_ids", []))
        ]
        for step_id in roots:
            append_branch(step_id)
        for step in all_steps:
            append_branch(step["id"])
        result = ordered
        if user.get("role") == "employee" and not directly_responsible_cfo_ids:
            result = [
                {
                    **step,
                    "modules": [
                        module for module in step.get("modules", [])
                        if module["id"] in module_ids
                    ],
                }
                for step in result
            ]
        return result

    def my_steps(self, user: dict) -> list[dict]:
        result = self.list_steps(user)
        if not result and user.get("role") not in {"admin", "economist", "approver", "zgd"}:
            raise HTTPException(status_code=403, detail="У пользователя нет шагов согласования")
        return result

    def get_step(self, user: dict, step_id: str) -> dict:
        step = get_required(self.repo, "steps", step_id)
        if user.get("role") != "admin":
            self.permissions.require_step_assignee(user, step)
        return self._public_steps(self.repo, [step])[0]

    def create_step(self, user: dict, payload: dict) -> dict:
        self.permissions.require_admin(user)
        if str(payload.get("status", StepStatus.waiting)) != StepStatus.waiting:
            raise HTTPException(status_code=422, detail="Новый шаг создаётся в статусе waiting")
        with self.repo.transaction() as repo:
            self._validate_step_shape(repo, payload.get("user_id"), payload.get("unit_id"))
            step = repo.create(
                "steps",
                {
                    "user_id": payload.get("user_id"),
                    "unit_id": payload.get("unit_id"),
                    "status": StepStatus.waiting,
                },
            )
            event_id = self._event_id()
            self._step_log(
                repo, user, step, "step_created", event_id=event_id,
                changes=self._changes({}, step),
            )
            child_id = payload.get("child_step_id")
            if child_id:
                self._create_edge(repo, user, step["id"], child_id, event_id)
        return self._public_steps(self.repo, [step])[0]

    def update_step(self, user: dict, step_id: str, patch: dict) -> dict:
        self.permissions.require_admin(user)
        with self.repo.transaction() as repo:
            before = repo.lock_by_id("steps", step_id)
            if not before:
                raise HTTPException(status_code=404, detail="Шаг не найден")
            if "status" in patch and patch["status"] != before.get("status"):
                raise HTTPException(status_code=403, detail="Статус шага не редактируется напрямую")
            automatic_actor = self._step_actor(repo, before)
            if (
                before.get("unit_id")
                or self._economist_cfo_id(repo, before)
                or automatic_actor and automatic_actor.get("role") == "zgd"
            ):
                raise HTTPException(status_code=403, detail="Automatic route anchors cannot be reassigned")
            candidate_user = patch.get("user_id", before.get("user_id"))
            candidate_unit = patch.get("unit_id", before.get("unit_id"))
            self._validate_step_shape(
                repo, candidate_user, candidate_unit, exclude_step_id=step_id
            )
            effective = {key: value for key, value in patch.items() if key != "status"}
            after = repo.update("steps", step_id, effective)
            self._step_log(
                repo, user, after, "step_updated", event_id=self._event_id(),
                changes=self._changes(before, after),
            )
        return self._public_steps(self.repo, [after])[0]

    def delete_step(self, user: dict, step_id: str) -> None:
        self.permissions.require_admin(user)
        if any(self._current_step_id(self.repo, row) == step_id for row in self.repo.load_all("cfo_positions")):
            raise HTTPException(status_code=409, detail="На шаге есть активные позиции")
        with self.repo.transaction() as repo:
            step = get_required(repo, "steps", step_id)
            actor = self._step_actor(repo, step)
            if (
                step.get("unit_id")
                or self._economist_cfo_id(repo, step)
                or actor and actor.get("role") == "zgd"
            ):
                raise HTTPException(status_code=403, detail="Automatic route anchors cannot be deleted")
            self._step_log(repo, user, step, "step_deleted", event_id=self._event_id())
            repo.delete("steps", step_id)

    def _assert_graph(self, repo: Repository, *, require_complete: bool = False) -> None:
        steps = self._steps(repo)
        edges = self._edges(repo)
        for step in steps.values():
            parents = self._parents(step["id"], edges)
            children = self._children(step["id"], edges)
            actor = self._step_actor(repo, step)
            if step.get("unit_id") and children:
                raise HTTPException(status_code=409, detail="Шаг ЦФО должен быть листовым")
            if actor and actor.get("role") == "zgd" and parents:
                raise HTTPException(status_code=409, detail="Шаг ЗГД должен быть корневым")
            if require_complete and actor and actor.get("role") != "zgd" and not parents:
                raise HTTPException(status_code=409, detail="Маршрут должен завершаться шагом ЗГД")
        state: dict[str, int] = {}

        def visit(step_id: str) -> None:
            if state.get(step_id) == 1:
                raise HTTPException(status_code=409, detail="В графе согласования обнаружен цикл")
            if state.get(step_id) == 2:
                return
            state[step_id] = 1
            for child_id in self._children(step_id, edges):
                visit(child_id)
            state[step_id] = 2

        for step_id in steps:
            visit(step_id)

    def _create_edge(
        self,
        repo: Repository,
        user: dict,
        parent_id: str,
        child_id: str,
        event_id: str,
    ) -> dict:
        parent = get_required(repo, "steps", parent_id)
        child = get_required(repo, "steps", child_id)
        if parent_id == child_id:
            raise HTTPException(status_code=422, detail="Шаг нельзя связать с самим собой")
        edge = repo.create(
            "step_edges", {"parent_step_id": parent_id, "child_step_id": child_id}
        )
        try:
            self._assert_graph(repo)
        except Exception:
            repo.delete_where("step_edges", edge)
            raise
        self._step_log(
            repo, user, parent, "step_edge_created", event_id=event_id,
            parent_step_id=parent_id, child_step_id=child_id,
        )
        return edge

    def create_edge(self, user: dict, payload: dict) -> dict:
        self.permissions.require_admin(user)
        with self.repo.transaction() as repo:
            return self._create_edge(
                repo, user, payload["parent_step_id"], payload["child_step_id"], self._event_id()
            )

    def preview_delete_edge(self, user: dict, payload: dict) -> dict:
        self.permissions.require_admin(user)
        edges = self.repo.load_all("step_edges")
        exists = any(
            row.get("parent_step_id") == payload["parent_step_id"]
            and row.get("child_step_id") == payload["child_step_id"]
            for row in edges
        )
        parent = self.repo.get_by_id("steps", payload["parent_step_id"])
        child = self.repo.get_by_id("steps", payload["child_step_id"])
        removes_economist_assignment = bool(
            parent
            and child
            and child.get("unit_id")
            and child["unit_id"] in self._economist_cfo_ids(self.repo, parent)
        )

        units = {row["id"]: row for row in self.repo.load_all("units")}
        users = {row["id"]: row for row in self.repo.load_all("users")}
        profiles = {row["user_id"]: row for row in self.repo.load_all("profiles")}

        def graph_node(step: dict) -> dict:
            account = users.get(step.get("user_id"))
            if step.get("unit_id") or self._economist_cfo_id(self.repo, step):
                return {
                    "id": step["id"],
                    "label": units.get(step["unit_id"], {}).get("name", "ЦФО"),
                    "kind": "leaf",
                }
            role = account.get("role") if account else None
            profile = profiles.get(account["id"]) if account else None
            full_name = " ".join(
                part for part in (
                    profile.get("last_name") if profile else None,
                    profile.get("name") if profile else None,
                    profile.get("second_name") if profile else None,
                ) if part
            )
            label = full_name or (account.get("login") if account else "Не назначен")
            return {
                "id": step["id"],
                "label": ("ЗГД · " if role == "zgd" else "") + label,
                "kind": "zgd" if role == "zgd" else "review",
            }

        steps = self.repo.load_all("steps")
        before_edges = [
            {"parent_step_id": row["parent_step_id"], "child_step_id": row["child_step_id"]}
            for row in edges
        ]
        after_edges = [
            row for row in before_edges
            if not (
                row["parent_step_id"] == payload["parent_step_id"]
                and row["child_step_id"] == payload["child_step_id"]
            )
        ]
        leaf_ids: set[str] = set()
        children_by_parent: dict[str, list[str]] = {}
        for edge in before_edges:
            children_by_parent.setdefault(edge["parent_step_id"], []).append(edge["child_step_id"])
        pending = [payload["child_step_id"]]
        while pending:
            step_id = pending.pop()
            if step_id in leaf_ids:
                continue
            leaf_ids.add(step_id)
            pending.extend(children_by_parent.get(step_id, []))
        affected_leaf_count = sum(
            1 for step in steps if step["id"] in leaf_ids and step.get("unit_id")
        )
        impacted = [
            row["id"]
            for row in self.repo.load_all("cfo_positions")
            if (
                row.get("cfo_unit_id") == child.get("unit_id")
                if removes_economist_assignment and child else self._current_step_id(self.repo, row) in set(payload.values())
            )
            and self._current_step_id(self.repo, row) in set(payload.values())
        ]
        return {
            "exists": exists,
            "impacted_position_ids": impacted,
            "removed_edge": payload,
            "before_graph": {"nodes": [graph_node(step) for step in steps], "edges": before_edges},
            "after_graph": {"nodes": [graph_node(step) for step in steps], "edges": after_edges},
            "affected_leaf_count": affected_leaf_count,
            "has_approved_past": False,
            "approved_past_count": 0,
            "removes_economist_assignment": removes_economist_assignment,
            "assignment_removal_reason": "Удаление связи снимет назначение этого экономиста с данного ЦФО. Остальные ЦФО экономиста не изменятся.",
        }

    def delete_edge(self, user: dict, payload: dict) -> None:
        self.permissions.require_admin(user)
        preview = self.preview_delete_edge(user, payload)
        if preview["impacted_position_ids"]:
            raise HTTPException(status_code=409, detail="Связь используется активными позициями")
        with self.repo.transaction() as repo:
            parent = get_required(repo, "steps", payload["parent_step_id"])
            child = get_required(repo, "steps", payload["child_step_id"])
            if not repo.delete_where("step_edges", payload):
                raise HTTPException(status_code=404, detail="Связь шагов не найдена")
            if preview["removes_economist_assignment"]:
                repo.update_where(
                    "units_responsibles",
                    {
                        "unit_id": child["unit_id"],
                        "user_id": parent["user_id"],
                        "is_active": True,
                    },
                    {"is_active": False},
                )
            self._step_log(
                repo, user, parent, "step_edge_deleted", event_id=self._event_id(), **payload
            )
            if preview["removes_economist_assignment"]:
                self._step_log(
                    repo, user, parent, "economist_unassigned_from_cfo_by_route",
                    event_id=self._event_id(), cfo_unit_id=child["unit_id"],
                )

    def validate_graph(self, user: dict) -> dict:
        self.permissions.require_admin(user)
        self._assert_graph(self.repo, require_complete=True)
        return {
            "valid": True,
            "steps_count": len(self.repo.load_all("steps")),
            "edges_count": len(self.repo.load_all("step_edges")),
            "root_step_ids": self._root_ids(self.repo),
        }

    def bootstrap_reviewed_leaf_steps(self, user: dict) -> dict:
        self.permissions.require_admin(user)
        return self.sync_automatic_steps(user)

    def _position_items(self, repo: Repository, position_id: str) -> list[dict]:
        candidates = find_rows(
            repo, "req_items", filters={"cfo_position_id": position_id}
        )
        request_ids = {row.get("request_id") for row in candidates if row.get("request_id")}
        active_request_ids = {
            request["id"]
            for request in find_rows(repo, "requests", in_filters={"id": request_ids})
            if request.get("status") != RequestStatus.cancelled
        }
        return [
            row for row in candidates
            if row.get("status") != ItemStatus.deleted
            and row.get("request_id") in active_request_ids
        ]

    @staticmethod
    def _position_chat_label(repo: Repository, position: dict) -> str:
        catalog_name = "dds_catalog" if position.get("dds_id") else "invests_catalog"
        article = repo.get_by_id(catalog_name, position.get("dds_id") or position.get("invest_id")) or {}
        cfo = repo.get_by_id("units", position.get("cfo_unit_id")) or {}
        return f"Позиция «{article.get('name') or 'Без статьи'}» ЦФО «{cfo.get('name') or 'не указан'}»"

    @classmethod
    def _revision_chat_text(
        cls,
        repo: Repository,
        position: dict,
        items: list[dict],
        comment: str,
        line_comments: dict[str, str] | None = None,
    ) -> str:
        """Describe a position return in a compact system message."""
        comments = line_comments or {}
        label = cls._position_chat_label(repo, position)
        names = [str(item.get("name") or "\u0421\u0442\u0440\u043e\u043a\u0430") for item in items]
        preview_limit = 4
        preview_names = names[:preview_limit]
        lines = [
            f"{label} \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0430 \u043d\u0430 \u0434\u043e\u0440\u0430\u0431\u043e\u0442\u043a\u0443.",
            "",
            f"\u0421\u0442\u0440\u043e\u043a\u0438 ({len(items)}):",
            *(f"\u2022 {name}" for name in preview_names),
        ]
        if len(names) > preview_limit:
            lines.append(f"\u2022 \u0415\u0449\u0451 {len(names) - preview_limit} \u0441\u0442\u0440\u043e\u043a")
        line_comment_rows: list[tuple[str, str]] = []
        for item in items:
            line_comment = str(comments.get(item.get("id"), item.get("comment")) or "").strip()
            if line_comment:
                line_comment_rows.append((str(item.get("name") or "\u0421\u0442\u0440\u043e\u043a\u0430"), line_comment))
        if line_comment_rows:
            lines.extend(["", "\u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0438 \u043a \u0441\u0442\u0440\u043e\u043a\u0430\u043c:"])
            lines.extend(f"\u2022 {name}: {line_comment}" for name, line_comment in line_comment_rows)
        if comment.strip():
            lines.extend(["", f"\u041e\u0431\u0449\u0438\u0439 \u043a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439: {comment.strip()}"])
        return "\n".join(lines)

    @staticmethod
    def _all_items_frozen(items: list[dict]) -> bool:
        return bool(items) and all(bool(row.get("frozen")) for row in items)

    @staticmethod
    def _all_items_fixed(items: list[dict]) -> bool:
        return bool(items) and all(bool(row.get("fixed")) for row in items)

    def public_position(
        self,
        position: dict,
        *,
        repo: Repository | None = None,
        public_steps_by_id: dict[str, dict] | None = None,
    ) -> dict:
        storage = repo or self.repo
        units = {row["id"]: row for row in storage.load_all("units")}
        requests = {row["id"]: row for row in storage.load_all("requests")}
        users = {row["id"]: row for row in storage.load_all("users")}
        items = self._position_items(storage, position["id"])
        current_step_id = self._current_step_id(storage, position)
        accepted = [row for row in items if row.get("status") in APPROVED_ITEM_STATUSES]
        contributions = []
        for item in items:
            request = requests.get(item["request_id"], {})
            contributions.append(
                {
                    **item,
                    "request": request,
                    "module": units.get(request.get("unit_id")),
                    "author": (
                        public_user(users[request_author_id(storage, request.get("id"))])
                        if request_author_id(storage, request.get("id")) in users
                        else None
                    ),
                }
            )
        article = storage.get_by_id(
            "dds_catalog" if position.get("dds_id") else "invests_catalog",
            position.get("dds_id") or position.get("invest_id"),
        )
        return {
            **position,
            "current_step_id": current_step_id,
            "cfo": units.get(position["cfo_unit_id"]),
            "article": article,
            "sum_plan": sum(float(row.get("sum_plan") or 0) for row in accepted),
            "sum_fact": sum(float(row.get("sum_fact") or 0) for row in accepted),
            "items_count": len(items),
            "frozen_items_count": sum(bool(row.get("frozen")) for row in items),
            "fixed_items_count": sum(bool(row.get("fixed")) for row in items),
            "open_items_count": sum(not bool(row.get("frozen")) for row in items),
            "all_items_frozen": self._all_items_frozen(items),
            "all_items_fixed": self._all_items_fixed(items),
            "can_forward": self._all_items_frozen(items),
            "contributions": contributions,
            "current_step": (
                public_steps_by_id.get(current_step_id)
                if public_steps_by_id is not None
                else self._public_steps(
                    storage, [get_required(storage, "steps", current_step_id)]
                )[0]
                if current_step_id
                else None
            ),
        }

    def _public_position_batch(self, repo: Repository, positions: list[dict]) -> list[dict]:
        """Serialize several positions while calculating their step context once."""
        step_ids = {
            step_id
            for position in positions
            if (step_id := self._current_step_id(repo, position))
        }
        public_steps = self._public_steps(
            repo,
            [get_required(repo, "steps", step_id) for step_id in sorted(step_ids)],
        ) if step_ids else []
        by_id = {step["id"]: step for step in public_steps}
        return [
            self.public_position(
                position,
                repo=repo,
                public_steps_by_id=by_id,
            )
            for position in positions
        ]

    def list_positions(
        self,
        user: dict,
        *,
        budget_year: int | None = None,
        cfo_unit_id: str | None = None,
        status: str | None = None,
        page: int = 1,
        page_size: int | None = None,
    ) -> list[dict]:
        visible = self.permissions.visible_position_ids(user)
        paged = None
        filters = {key: value for key, value in {"budget_year": budget_year, "cfo_unit_id": cfo_unit_id, "status": status}.items() if value is not None}
        if page_size and hasattr(self.repo, "page_rows"):
            paged = self.repo.page_rows("cfo_positions", filters=filters, in_filters={"id": visible} if visible is not None else None, page=page, page_size=page_size, nonempty_positions=True)
            position_ids = {row["id"] for row in paged["items"]}
            items = find_rows(self.repo, "req_items", in_filters={"cfo_position_id": position_ids})
            request_ids = {row["request_id"] for row in items}
            with self.repo.read_snapshot({"req_items": items, "requests": find_rows(self.repo, "requests", in_filters={"id": request_ids}), "req_logs": find_rows(self.repo, "req_logs", in_filters={"req_id": request_ids}), "cfo_position_logs": find_rows(self.repo, "cfo_position_logs", in_filters={"cfo_position_id": position_ids})}):
                return {**paged, "items": [self.public_position(row) for row in paged["items"]]}
        rows = [
            row for row in find_rows(self.repo, "cfo_positions", filters=filters, in_filters={"id": visible} if visible is not None else None)
            if (visible is None or row["id"] in visible)
            and bool(self._position_items(self.repo, row["id"]))
            and (budget_year is None or int(row["budget_year"]) == budget_year)
            and (cfo_unit_id is None or row["cfo_unit_id"] == cfo_unit_id)
            and (status is None or row["status"] == status)
        ]
        if page_size:
            from app.repositories.pagination import numbered_page
            paged = numbered_page(self.repo, "cfo_positions", in_filters={"id": {row["id"] for row in rows}}, page=page, page_size=page_size)
            return {**paged, "items": [self.public_position(row) for row in paged["items"]]}
        return [self.public_position(row) for row in rows]

    def get_position(self, user: dict, position_id: str) -> dict:
        position = get_required(self.repo, "cfo_positions", position_id)
        self.permissions.require_view_position(user, position)
        return self.public_position(position)

    def _notify(
        self,
        repo: Repository,
        user_id: str | None,
        notification_type: str,
        payload: dict,
    ) -> None:
        if user_id and self.notifications:
            self.notifications.create(user_id, notification_type, payload, repo=repo)

    @staticmethod
    def _cfo_pending_revision_item_ids(repo: Repository, request_id: str) -> set[str]:
        """Return unsent CFO revision selections for one request.

        A line decision is only a saved choice until the CFO explicitly sends
        the package to the module. Decisions from a completed, returned package
        are historical and must not block a later handoff to the economist.
        """
        rows = sorted(
            (row for row in repo.load_all("req_logs") if row.get("req_id") == request_id),
            key=lambda row: (str(row.get("created_at") or ""), int(row.get("id") or 0)),
        )
        boundary: tuple[str, int] | None = None
        for row in rows:
            if (row.get("log") or {}).get("action") in {
                "cfo_items_returned_for_revision",
                "request_revision_resubmitted_to_cfo",
                "request_restored",
            }:
                boundary = (str(row.get("created_at") or ""), int(row.get("id") or 0))
        decisions: dict[str, str] = {}
        for row in rows:
            key = (str(row.get("created_at") or ""), int(row.get("id") or 0))
            if boundary is not None and key <= boundary:
                continue
            log = row.get("log") or {}
            if log.get("action") != "cfo_item_decided" or log.get("entity") != "req_item":
                continue
            item_id = str(log.get("entity_id") or "")
            if item_id:
                decisions[item_id] = str(log.get("decision") or "")
        return {item_id for item_id, decision in decisions.items() if decision == "on_revision"}

    def submit_to_economist(
        self,
        user: dict,
        position_id: str,
        comment: str = "",
        *,
        event_id: str | None = None,
        repo: Repository | None = None,
    ) -> dict:
        if repo is None:
            self.sync_automatic_steps(user)
        result_repo = repo
        transaction = nullcontext(repo) if repo is not None else self.repo.transaction()
        with transaction as storage:
            repo = storage
            position = repo.lock_by_id("cfo_positions", position_id)
            if not position:
                raise HTTPException(status_code=404, detail="Позиция не найдена")
            if (
                user.get("role") != "employee"
                or position["cfo_unit_id"] not in self.permissions.employee_cfo_ids(user["id"])
            ):
                raise HTTPException(status_code=403, detail="Позиция относится к другому ЦФО")
            if self._all_items_fixed(self._position_items(repo, position_id)):
                raise HTTPException(status_code=409, detail="Все строки позиции окончательно зафиксированы")
            position_items = self._position_items(repo, position_id)
            if not any(row.get("status") != ItemStatus.rejected for row in position_items):
                raise HTTPException(status_code=409, detail="В позиции нет строк для согласования")
            if position.get("status") not in {
                CfoPositionStatus.waiting,
                CfoPositionStatus.on_review,
                CfoPositionStatus.on_revision,
            }:
                raise HTTPException(status_code=409, detail="Позицию нельзя передать на этом этапе")
            cfo_modules = self.permissions.modules_for_cfos({position["cfo_unit_id"]})
            pending_revision_request_ids = sorted({
                item["request_id"]
                for item in position_items
                if self._cfo_pending_revision_item_ids(repo, item["request_id"])
            })
            if pending_revision_request_ids:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": "Есть строки, отмеченные на доработку. Отправьте их модулю через окно «На доработку».",
                        "request_ids": pending_revision_request_ids,
                    },
                )
            incomplete_request_ids = []
            not_submitted_request_ids = []
            units_by_id = {
                row["id"]: row
                for row in repo.load_all("units")
            }
            for request in repo.load_all("requests"):
                if (
                    request.get("unit_id") not in cfo_modules
                    or int(request.get("budget_year") or 0) != int(position.get("budget_year") or 0)
                ):
                    continue
                if request.get("status") == RequestStatus.draft:
                    not_submitted_request_ids.append(request["id"])
                elif (
                    request.get("status") == RequestStatus.on_review
                    and not request_cfo_review_completed(repo, request["id"])
                ):
                    incomplete_request_ids.append(request["id"])
            if not_submitted_request_ids:
                module_names = sorted({
                    str(units_by_id.get(request.get("unit_id"), {}).get("name") or "модуля")
                    for request in repo.load_all("requests")
                    if request.get("id") in not_submitted_request_ids
                })
                modules_label = ", ".join(f"«{name}»" for name in module_names)
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": (
                            "Передача невозможна: заявка "
                            f"модуля {modules_label or 'ещё не отправлена'} "
                            "ещё не отправлена на проверку ЦФО. Дождитесь заявки модуля для проверки."
                        ),
                        "reason": "module_request_not_submitted",
                        "request_ids": sorted(not_submitted_request_ids),
                    },
                )
            if incomplete_request_ids:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": "Передача невозможна: не все заявки ЦФО прошли проверку по строкам",
                        "reason": "cfo_review_incomplete",
                        "request_ids": sorted(incomplete_request_ids),
                    },
                )
            economist_step = self._economist_step_for_cfo(repo, position["cfo_unit_id"])
            source_step = self._leaf_for_cfo(repo, position["cfo_unit_id"])
            before = dict(position)
            after = repo.update(
                "cfo_positions", position_id,
                {
                    "status": CfoPositionStatus.on_approval,
                    "current_step_id": economist_step["id"],
                },
            )
            event_id = event_id or self._event_id()
            self._position_log(
                repo, user, after, "position_sent_to_economist", before=before,
                after=after, comment=comment, event_id=event_id, step_id=source_step["id"],
                current_step_id=economist_step["id"],
            )
            self._step_log(
                repo, user, economist_step, "position_received", event_id=event_id,
                comment=comment, cfo_position_id=position_id,
            )
            self._sync_step_statuses(repo)
            if self.chat_service:
                self.chat_service.system_message_for_position(
                    after,
                    f"{self._position_chat_label(repo, after)} передана экономисту на проверку.",
                    repo=repo,
                )
            economist_id = self.permissions.cfo_economist_id(position["cfo_unit_id"])
            self._notify(
                repo, economist_id, "cfo_position.assigned",
                {"cfo_position_id": position_id, "reload_required": True},
            )
        result = self.public_position(after, repo=result_repo)
        result["notification_user_ids"] = [economist_id] if economist_id else []
        return result

    def _require_economist_work(
        self, user: dict, position: dict, *, repo: Repository | None = None
    ) -> dict:
        storage = repo or self.repo
        self.permissions.require_economist_position_access(user, position)
        step = get_required(storage, "steps", self._current_step_id(storage, position))
        if self._economist_cfo_id(storage, step) != position["cfo_unit_id"]:
            raise HTTPException(status_code=409, detail="Позиция не находится на шаге экономиста")
        return step

    def _decide_item_economist(
        self,
        repo: Repository,
        user: dict,
        position: dict,
        item_id: str,
        payload: dict,
        *,
        event_id: str | None = None,
    ) -> dict:
        item = get_required(repo, "req_items", item_id)
        if item.get("cfo_position_id") != position["id"]:
            raise HTTPException(status_code=409, detail="Строка не относится к позиции")
        if item.get("frozen") or item.get("fixed"):
            raise HTTPException(status_code=409, detail="Строка закрыта для редактирования")
        decision_payload = dict(payload)
        if decision_payload.pop("month_plans", None) is not None:
            raise HTTPException(
                status_code=422,
                detail="Экономист меняет фактическую сумму; помесячный план изменяет ответственный модуля или ЦФО",
            )
        before = dict(item)
        if decision_payload["decision"] == "on_revision":
            comment = (decision_payload.get("comment") or "").strip()
            if not comment:
                raise HTTPException(status_code=422, detail="Для возврата строки на доработку нужен комментарий")
            after = repo.update(
                "req_items",
                item_id,
                {"status": ItemStatus.on_review, "comment": comment},
            )
        else:
            after = repo.update(
                "req_items",
                item_id,
                BudgetItemService.normalize_decision(item, decision_payload),
            )
        self._position_log(
            repo, user, position, "economist_item_decided",
            before=before, after=after, comment=payload.get("comment"),
            req_item_id=item_id, request_id=item["request_id"],
            event_id=event_id, item_ids=[item_id],
            decision=decision_payload["decision"],
            agreed_sum=after.get("sum_fact"),
        )
        return after

    def decide_item_economist(
        self, user: dict, position_id: str, item_id: str, payload: dict
    ) -> dict:
        with self.repo.transaction() as repo:
            position = repo.lock_by_id("cfo_positions", position_id)
            if not position:
                raise HTTPException(status_code=404, detail="Позиция не найдена")
            self._require_economist_work(user, position, repo=repo)
            after = self._decide_item_economist(
                repo, user, position, item_id, payload
            )
        return after

    def bulk_decide_economist(self, user: dict, position_id: str, payload: dict) -> list[dict]:
        with self.repo.transaction() as repo:
            position = repo.lock_by_id("cfo_positions", position_id)
            if not position:
                raise HTTPException(status_code=404, detail="Позиция не найдена")
            self._require_economist_work(user, position, repo=repo)
            event_id = self._event_id()
            return [
                self._decide_item_economist(
                    repo,
                    user,
                    position,
                    item_id,
                    {
                        "decision": payload["decision"],
                        "comment": payload.get("comment", ""),
                    },
                    event_id=event_id,
                )
                for item_id in payload["item_ids"]
            ]

    @staticmethod
    def _latest_returned_item_ids(repo: Repository, position_id: str) -> set[str]:
        logs = [
            row for row in find_rows(
                repo, "cfo_position_logs", filters={"cfo_position_id": position_id}
            )
            if row.get("cfo_position_id") == position_id
            and (row.get("log") or {}).get("action") == "position_returned"
        ]
        if not logs:
            return set()
        latest = max(
            logs,
            key=lambda row: (str(row.get("created_at") or ""), int(row.get("id") or 0)),
        )
        return {str(item_id) for item_id in (latest.get("log") or {}).get("item_ids") or []}

    def _economist_decisions(self, repo: Repository, position_id: str) -> dict[str, str]:
        logs = [
            row for row in find_rows(
                repo, "cfo_position_logs", filters={"cfo_position_id": position_id}
            )
            if row.get("cfo_position_id") == position_id
        ]
        latest_return = max(
            (
                (
                    (str(row.get("created_at") or ""), int(row.get("id") or 0)),
                    {str(item_id) for item_id in (row.get("log") or {}).get("item_ids") or []},
                )
                for row in logs
                if (row.get("log") or {}).get("action") == "position_returned"
            ),
            default=None,
        )
        invalidated_item_ids = latest_return[1] if latest_return else set()
        returned_at = latest_return[0] if latest_return else ("", 0)
        decisions: dict[str, str] = {}
        for row in logs:
            log = row.get("log") or {}
            if log.get("action") != "economist_item_decided" or not log.get("req_item_id"):
                continue
            item_id = str(log["req_item_id"])
            key = (str(row.get("created_at") or ""), int(row.get("id") or 0))
            if item_id in invalidated_item_ids and key <= returned_at:
                continue
            decisions[item_id] = str(log.get("decision") or "")
        return decisions

    def _economist_decided_item_ids(self, repo: Repository, position_id: str) -> set[str]:
        return set(self._economist_decisions(repo, position_id))

    def _pending_position_decision_ids(
        self, repo: Repository, position: dict, step: dict, items: list[dict]
    ) -> list[str]:
        """Return lines that still need a decision before a package action."""
        actor = get_required(repo, "users", step["user_id"]) if step.get("user_id") else {}
        if actor.get("role") == "economist":
            decisions = self._economist_decisions(repo, position["id"])
            return [
                row["id"]
                for row in items
                if row["id"] not in decisions
            ]
        if actor.get("role") in {"approver", "zgd"}:
            returned_ids = self._latest_returned_item_ids(repo, position["id"])
            required_ids = returned_ids or {row["id"] for row in items}
            decided = self._approver_approved_item_ids(repo, position["id"], step["id"])
            return [
                row["id"]
                for row in items
                if row["id"] in required_ids
                and not row.get("fixed")
                and row["id"] not in decided
            ]
        return []

    def complete_economist_review(
        self,
        user: dict,
        position_id: str,
        comment: str = "",
        *,
        repo: Repository | None = None,
    ) -> dict:
        result_repo = repo
        transaction = nullcontext(repo) if repo is not None else self.repo.transaction()
        with transaction as storage:
            repo = storage
            position = repo.lock_by_id("cfo_positions", position_id)
            if not position:
                raise HTTPException(status_code=404, detail="Позиция не найдена")
            self._require_economist_work(user, position, repo=repo)
            items = self._position_items(repo, position_id)
            decisions = self._economist_decisions(repo, position_id)
            pending = [
                row["id"] for row in items
                if row["id"] not in decisions or decisions.get(row["id"]) == "on_revision"
            ]
            if not items or pending:
                raise HTTPException(
                    status_code=409,
                    detail={"message": "Не все строки рассмотрены экономистом", "item_ids": pending},
                )
            before = dict(position)
            after = repo.update(
                "cfo_positions", position_id, {"status": CfoPositionStatus.approved}
            )
            self._position_log(
                repo, user, after, "economist_review_completed",
                before=before, after=after, comment=comment,
                current_step_id=self._current_step_id(repo, position),
            )
            if self.chat_service:
                self.chat_service.system_message_for_position(
                    after,
                    f"Экономист завершил проверку: {self._position_chat_label(repo, after)}.",
                    repo=repo,
                )
            self._sync_step_statuses(repo)
        return self.public_position(after, repo=result_repo)

    def freeze_position(
        self,
        user: dict,
        position_id: str,
        comment: str = "",
        item_ids: list[str] | None = None,
        *,
        event_id: str | None = None,
        repo: Repository | None = None,
    ) -> dict:
        result_repo = repo
        transaction = nullcontext(repo) if repo is not None else self.repo.transaction()
        with transaction as storage:
            repo = storage
            position = repo.lock_by_id("cfo_positions", position_id)
            if not position:
                raise HTTPException(status_code=404, detail="Позиция не найдена")
            leaf = self._require_economist_work(user, position, repo=repo)
            if position.get("status") != CfoPositionStatus.approved:
                raise HTTPException(status_code=409, detail="Сначала завершите проверку строк")
            parents = self._parents(leaf["id"], self._edges(repo))
            if len(parents) != 1:
                raise HTTPException(status_code=409, detail="У листового шага должен быть один родитель")
            next_step = get_required(repo, "steps", parents[0])
            items = self._position_items(repo, position_id)
            selected_ids = set(item_ids or [row["id"] for row in items if not row.get("fixed")])
            selected = [row for row in items if row["id"] in selected_ids]
            if not selected or len(selected) != len(selected_ids):
                raise HTTPException(status_code=422, detail="Выберите строки данной позиции")
            if any(row.get("fixed") for row in selected):
                raise HTTPException(status_code=409, detail="Зафиксированную строку нельзя изменить")
            for item in selected:
                repo.update("req_items", item["id"], {"frozen": True})
            frozen_items = self._position_items(repo, position_id)
            before = dict(position)
            forwarded = self._all_items_frozen(frozen_items)
            after = repo.update(
                "cfo_positions", position_id,
                ({"status": CfoPositionStatus.on_approval, "current_step_id": next_step["id"]} if forwarded else {}),
            ) if forwarded else position
            event_id = event_id or self._event_id()
            self._position_log(
                repo, user, after, "position_frozen_and_forwarded" if forwarded else "position_items_frozen",
                before=before, after=after, comment=comment, event_id=event_id,
                step_id=leaf["id"],
                current_step_id=next_step["id"] if forwarded else leaf["id"],
                item_ids=sorted(selected_ids),
            )
            if forwarded:
                self._step_log(repo, user, next_step, "position_received", event_id=event_id, comment=comment, cfo_position_id=position_id)
                self._notify(repo, next_step.get("user_id"), "cfo_position.assigned", {"cfo_position_id": position_id, "step_id": next_step["id"]})
            self._sync_step_statuses(repo)
        result = self.public_position(after, repo=result_repo)
        result["notification_user_ids"] = [next_step["user_id"]] if forwarded and next_step.get("user_id") else []
        return result

    def unfreeze_position(
        self, user: dict, position_id: str, comment: str = "", item_ids: list[str] | None = None
    ) -> dict:
        with self.repo.transaction() as repo:
            position = repo.lock_by_id("cfo_positions", position_id)
            if not position:
                raise HTTPException(status_code=404, detail="Позиция не найдена")
            self.permissions.require_economist_position_access(user, position)
            current = get_required(repo, "steps", self._current_step_id(repo, position))
            if self._economist_cfo_id(repo, current) != position["cfo_unit_id"]:
                raise HTTPException(status_code=409, detail="Позицию ещё не вернули экономисту")
            items = self._position_items(repo, position_id)
            selected_ids = set(item_ids or [row["id"] for row in items if row.get("frozen") and not row.get("fixed")])
            selected = [row for row in items if row["id"] in selected_ids]
            if item_ids and (not selected or any(row.get("fixed") for row in selected)):
                raise HTTPException(status_code=409, detail="Выберите незакреплённые строки")
            for item in selected:
                repo.update("req_items", item["id"], {"frozen": False})
            before = dict(position)
            after = repo.update("cfo_positions", position_id, {"status": CfoPositionStatus.on_approval})
            self._position_log(
                repo, user, after, "position_unfrozen",
                before=before, after=after, comment=comment,
                current_step_id=self._current_step_id(repo, position), item_ids=sorted(selected_ids),
            )
            self._sync_step_statuses(repo)
        return self.public_position(after)

    def list_step_positions(self, user: dict, step_id: str) -> list[dict]:
        step = get_required(self.repo, "steps", step_id)
        if user.get("role") != "admin":
            self.permissions.require_step_assignee(user, step)
        return [
            self.public_position(row)
            for row in self.repo.load_all("cfo_positions")
            if self._current_step_id(self.repo, row) == step_id
            and bool(self._position_items(self.repo, row["id"]))
        ]

    def step_dashboard(self, user: dict, step_id: str) -> dict:
        positions = self.list_step_positions(user, step_id)
        return {
            "step": self.get_step(user, step_id),
            "positions": positions,
            "totals": {
                "positions_count": len(positions),
                "sum_plan": sum(row["sum_plan"] for row in positions),
                "sum_fact": sum(row["sum_fact"] for row in positions),
            },
        }

    def approve_position_at_step(
        self,
        user: dict,
        step_id: str,
        position_id: str,
        comment: str = "",
        item_ids: list[str] | None = None,
        *,
        event_id: str | None = None,
        repo: Repository | None = None,
        sync_steps: bool = True,
        serialize_result: bool = True,
        previously_approved_ids: set[str] | None = None,
    ) -> dict:
        result_repo = repo
        transaction = nullcontext(repo) if repo is not None else self.repo.transaction()
        with transaction as storage:
            repo = storage
            step = get_required(repo, "steps", step_id)
            self.permissions.require_step_assignee(user, step)
            if step.get("unit_id") or self._economist_cfo_id(repo, step):
                raise HTTPException(status_code=409, detail="Используйте команды экономиста")
            position = repo.lock_by_id("cfo_positions", position_id)
            if not position or self._current_step_id(repo, position) != step_id:
                raise HTTPException(status_code=409, detail="Позиция не находится на этом шаге")
            items = self._position_items(repo, position_id)
            parents = self._parents(step_id, self._edges(repo))
            actor = get_required(repo, "users", step["user_id"])
            before = dict(position)
            # ZGD's approval is a reversible review decision.  Fixing the
            # budget is a separate explicit action.
            if actor.get("role") in {"approver", "zgd"} and (item_ids or actor.get("role") == "zgd"):
                requested_ids = list(item_ids) if item_ids else [row["id"] for row in items if not row.get("fixed")]
                if not requested_ids:
                    raise HTTPException(status_code=422, detail="Выберите хотя бы одну строку")
                if len(set(requested_ids)) != len(requested_ids):
                    raise HTTPException(status_code=422, detail="Идентификаторы строк не должны повторяться")
                items_by_id = {row["id"]: row for row in items}
                previously_approved_ids = (
                    self._approver_approved_item_ids(repo, position_id, step_id)
                    if previously_approved_ids is None
                    else previously_approved_ids
                )
                newly_approved_ids = set(requested_ids) - previously_approved_ids
                for item_id in requested_ids:
                    item = items_by_id.get(item_id)
                    if not item:
                        raise HTTPException(
                            status_code=422,
                            detail=f"Строка {item_id} не относится к выбранной позиции",
                        )
                    if item.get("status") == ItemStatus.deleted or item.get("fixed"):
                        raise HTTPException(status_code=409, detail=f"Строка {item_id} недоступна для согласования")
                    if not item.get("frozen"):
                        if (
                            position.get("status") != CfoPositionStatus.on_revision
                            or item_id not in self._latest_returned_item_ids(repo, position_id)
                        ):
                            raise HTTPException(status_code=409, detail=f"Строка {item_id} недоступна для согласования")
                        item = repo.update("req_items", item_id, {"frozen": True})
                        items_by_id[item_id] = item
                event_id = event_id or self._event_id()
                self._position_log(
                    repo, user, position, "position_items_approved_at_step",
                    before=before, after=position, comment=comment, event_id=event_id,
                    step_id=step_id, current_step_id=step_id, item_ids=sorted(requested_ids),
                    # A reviewer decision is represented by an audit event,
                    # not by the budget line's own status. Record the decision
                    # explicitly so history can show the actual change.
                    changes=(
                        {"reviewer_decision": {"from": "pending", "to": "approved"}}
                        if newly_approved_ids else {}
                    ),
                    req_item_id=requested_ids[0] if len(requested_ids) == 1 else None,
                )
                self._step_log(
                    repo, user, step, "position_items_approved_at_step",
                    event_id=event_id, comment=comment, cfo_position_id=position_id,
                    item_ids=sorted(requested_ids),
                )
                # A line decision must not implicitly move the whole
                # position.  The reviewer first records decisions for all
                # required lines; the separate group action sends the
                # position to the next step as one package.
                if sync_steps:
                    self._sync_step_statuses(repo)
                result = (
                    self.public_position(position, repo=result_repo)
                    if serialize_result
                    else dict(position)
                )
                result["notification_user_ids"] = []
                return result
            if not self._all_items_frozen(items):
                raise HTTPException(status_code=409, detail="Передать дальше можно только статью с замороженными строками")
            if actor.get("role") == "zgd":
                if parents:
                    raise HTTPException(status_code=409, detail="Шаг ЗГД должен завершать маршрут")
                requested_ids = (
                    list(item_ids)
                    if item_ids
                    else [row["id"] for row in items if not row.get("fixed")]
                )
                if not requested_ids:
                    raise HTTPException(status_code=409, detail="В позиции нет строк для фиксации")
                if len(set(requested_ids)) != len(requested_ids):
                    raise HTTPException(status_code=422, detail="Идентификаторы строк не должны повторяться")
                all_items_by_id = {row["id"]: row for row in repo.load_all("req_items")}
                selected = []
                for item_id in requested_ids:
                    item = all_items_by_id.get(item_id)
                    if not item or item.get("cfo_position_id") != position_id:
                        raise HTTPException(
                            status_code=422,
                            detail=f"Строка {item_id} не относится к выбранной позиции",
                        )
                    item_request = repo.get_by_id("requests", item.get("request_id"))
                    if not item_request or item_request.get("status") == RequestStatus.cancelled:
                        raise HTTPException(status_code=409, detail=f"Строка {item_id} недоступна в текущем workflow")
                    if item.get("status") == ItemStatus.deleted or not item.get("frozen"):
                        raise HTTPException(status_code=409, detail=f"Строка {item_id} недоступна для фиксации")
                    if item.get("fixed"):
                        raise HTTPException(status_code=409, detail=f"Строка {item_id} уже зафиксирована")
                    selected.append(item)
                selected_ids = set(requested_ids)
                for item in selected:
                    repo.update("req_items", item["id"], {"fixed": True, "frozen": True})
                fixed_items = self._position_items(repo, position_id)
                patch = ({"status": CfoPositionStatus.approved, "current_step_id": None}
                         if self._all_items_fixed(fixed_items) else {})
                action = "position_fixed" if self._all_items_fixed(fixed_items) else "position_items_fixed"
                next_step = None
            else:
                if len(parents) != 1:
                    raise HTTPException(status_code=409, detail="У шага должен быть один родитель")
                next_step = get_required(repo, "steps", parents[0])
                patch = {
                    "status": CfoPositionStatus.on_approval,
                    "current_step_id": next_step["id"],
                }
                action = "position_approved_at_step"
            after = repo.update("cfo_positions", position_id, patch) if patch else position
            if actor.get("role") == "zgd":
                request_ids = {row["request_id"] for row in fixed_items}
            event_id = event_id or self._event_id()
            self._position_log(
                repo, user, after, action, before=before, after=after,
                comment=comment, event_id=event_id, step_id=step_id,
                current_step_id=next_step["id"] if next_step else self._current_step_id(repo, after),
                item_ids=sorted(selected_ids if actor.get("role") == "zgd" else [row["id"] for row in items]),
            )
            self._step_log(
                repo, user, step, action, event_id=event_id, comment=comment,
                cfo_position_id=position_id,
            )
            if actor.get("role") == "zgd":
                self._sync_request_statuses(
                    repo,
                    user,
                    request_ids,
                    event_id=event_id,
                    action="request_finalized_by_zgd",
                )
                sync_annual_budgets(repo)
            if sync_steps:
                self._sync_step_statuses(repo)
            notify_id = next_step.get("user_id") if next_step else None
            self._notify(
                repo, notify_id, "cfo_position.assigned",
                {"cfo_position_id": position_id, "step_id": next_step["id"] if next_step else None},
            )
        result = (
            self.public_position(after, repo=result_repo)
            if serialize_result
            else dict(after)
        )
        result["notification_user_ids"] = [notify_id] if notify_id else []
        return result

    def fix_position(self, user: dict, position_id: str, comment: str = "", *, repo: Repository | None = None) -> dict:
        """Lock a fully reviewed final position. Only ZGD may lock or unlock it."""
        result_repo = repo
        transaction = nullcontext(repo) if repo is not None else self.repo.transaction()
        with transaction as storage:
            repo = storage
            position = repo.lock_by_id("cfo_positions", position_id)
            if not position:
                raise HTTPException(status_code=404, detail="Позиция не найдена")
            step_id = self._current_step_id(repo, position)
            step = get_required(repo, "steps", step_id) if step_id else None
            if not step or not step.get("user_id"):
                raise HTTPException(status_code=409, detail="Позиция не находится на этапе ЗГД")
            actor = get_required(repo, "users", step["user_id"])
            if user.get("role") != "zgd" or actor.get("role") != "zgd":
                raise HTTPException(status_code=403, detail="Только ЗГД может зафиксировать бюджет")
            self.permissions.require_step_assignee(user, step)
            if self._parents(step_id, self._edges(repo)):
                raise HTTPException(status_code=409, detail="Этап ЗГД должен быть последним этапом маршрута")
            items = self._position_items(repo, position_id)
            if not items:
                raise HTTPException(status_code=409, detail="В позиции нет строк для фиксации")
            items_to_fix = [row for row in items if not row.get("fixed")]
            if not items_to_fix:
                raise HTTPException(status_code=409, detail="Бюджет уже зафиксирован")
            pending = self._pending_position_decision_ids(repo, position, step, items_to_fix)
            if pending:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": "Сначала согласуйте все строки перед фиксацией",
                        "item_ids": pending,
                    },
                )
            before = dict(position)
            for item in items_to_fix:
                repo.update("req_items", item["id"], {"fixed": True, "frozen": True})
            fixed_items = self._position_items(repo, position_id)
            all_items_fixed = self._all_items_fixed(fixed_items)
            after = (
                repo.update(
                    "cfo_positions",
                    position_id,
                    {"status": CfoPositionStatus.approved, "current_step_id": None},
                )
                if all_items_fixed
                else position
            )
            event_id = self._event_id()
            self._position_log(repo, user, after, "position_fixed" if all_items_fixed else "position_items_fixed", before=before, after=after,
                               comment=comment, event_id=event_id, step_id=step_id,
                               current_step_id=None if all_items_fixed else step_id,
                               item_ids=[row["id"] for row in items_to_fix])
            self._step_log(repo, user, step, "position_fixed" if all_items_fixed else "position_items_fixed", event_id=event_id, comment=comment,
                           cfo_position_id=position_id)
            self._sync_request_statuses(repo, user, {row["request_id"] for row in items_to_fix},
                                        event_id=event_id, action="request_finalized_by_zgd")
            sync_annual_budgets(repo)
            self._sync_step_statuses(repo)
        return self.public_position(after, repo=result_repo)

    def unfix_position(self, user: dict, position_id: str, comment: str = "", *, repo: Repository | None = None) -> dict:
        """Unlock a ZGD-fixed position and restore its final route step."""
        result_repo = repo
        transaction = nullcontext(repo) if repo is not None else self.repo.transaction()
        with transaction as storage:
            repo = storage
            position = repo.lock_by_id("cfo_positions", position_id)
            if not position:
                raise HTTPException(status_code=404, detail="Позиция не найдена")
            items = self._position_items(repo, position_id)
            if not items or not self._all_items_fixed(items):
                raise HTTPException(status_code=409, detail="Бюджет ещё не зафиксирован полностью")
            fixed_log = max((row for row in repo.load_all("cfo_position_logs")
                             if row.get("cfo_position_id") == position_id
                             and (row.get("log") or {}).get("action") == "position_fixed"),
                            key=lambda row: (str(row.get("created_at") or ""), int(row.get("id") or 0)), default=None)
            step_id = (fixed_log.get("log") or {}).get("step_id") if fixed_log else None
            step = get_required(repo, "steps", step_id) if step_id else None
            if not step or not step.get("user_id"):
                raise HTTPException(status_code=409, detail="Не удалось восстановить этап ЗГД")
            actor = get_required(repo, "users", step["user_id"])
            if user.get("role") != "zgd" or actor.get("role") != "zgd":
                raise HTTPException(status_code=403, detail="Только ЗГД может снять фиксацию бюджета")
            self.permissions.require_step_assignee(user, step)
            before = dict(position)
            for item in items:
                repo.update("req_items", item["id"], {"fixed": False, "frozen": True})
            after = repo.update("cfo_positions", position_id, {"status": CfoPositionStatus.on_approval, "current_step_id": step_id})
            event_id = self._event_id()
            self._position_log(repo, user, after, "position_unfixed", before=before, after=after,
                               comment=comment, event_id=event_id, step_id=step_id,
                               current_step_id=step_id, item_ids=[row["id"] for row in items])
            self._step_log(repo, user, step, "position_unfixed", event_id=event_id, comment=comment,
                           cfo_position_id=position_id)
            self._sync_request_statuses(repo, user, {row["request_id"] for row in items},
                                        event_id=event_id, action="request_reopened_by_zgd")
            sync_annual_budgets(repo)
            self._sync_step_statuses(repo)
        return self.public_position(after, repo=result_repo)

    def fix_positions_from_register(self, user: dict, position_ids: list[str], comment: str = "") -> dict:
        with self.repo.transaction() as repo:
            return {"positions": [self.fix_position(user, position_id, comment, repo=repo) for position_id in sorted(set(position_ids))]}

    def unfix_positions_from_register(self, user: dict, position_ids: list[str], comment: str = "") -> dict:
        with self.repo.transaction() as repo:
            return {"positions": [self.unfix_position(user, position_id, comment, repo=repo) for position_id in sorted(set(position_ids))]}

    def approve_step(self, user: dict, step_id: str, position_ids: list[str]) -> dict:
        selected = sorted(set(position_ids)) if position_ids else [
            row["id"] for row in self.list_step_positions(user, step_id)
        ]
        with self.repo.transaction() as repo:
            position_logs = self._preload_approval_batch(repo)
            raw = [
                self.approve_position_at_step(
                    user,
                    step_id,
                    position_id,
                    repo=repo,
                    sync_steps=False,
                    serialize_result=False,
                    previously_approved_ids=self._approver_approved_item_ids(
                        repo,
                        position_id,
                        step_id,
                        logs=position_logs,
                    ),
                )
                for position_id in selected
            ]
            self._sync_step_statuses(repo)
            fresh = [get_required(repo, "cfo_positions", row["id"]) for row in raw]
            public = self._public_position_batch(repo, fresh)
            return {
                "positions": [
                    {
                        **public[index],
                        "notification_user_ids": row.get("notification_user_ids", []),
                    }
                    for index, row in enumerate(raw)
                ]
            }

    def approve_position_lines_bulk(
        self,
        user: dict,
        selections: list[dict],
        comment: str = "",
        event_id: str | None = None,
    ) -> dict:
        """Record reviewer decisions for many lines in one transaction."""
        if not selections:
            raise HTTPException(status_code=422, detail="Выберите хотя бы одну строку")
        grouped: dict[tuple[str, str], set[str]] = {}
        for selection in selections:
            key = (str(selection["step_id"]), str(selection["position_id"]))
            grouped.setdefault(key, set()).update(str(value) for value in selection["item_ids"])
        group_event_id = event_id or self._event_id()
        with self.repo.transaction() as repo:
            position_logs = self._preload_approval_batch(repo)
            raw = []
            for (step_id, position_id), item_ids in sorted(grouped.items()):
                raw.append(
                    self.approve_position_at_step(
                        user,
                        step_id,
                        position_id,
                        comment,
                        sorted(item_ids),
                        event_id=group_event_id,
                        repo=repo,
                        sync_steps=False,
                        serialize_result=False,
                        previously_approved_ids=self._approver_approved_item_ids(
                            repo,
                            position_id,
                            step_id,
                            logs=position_logs,
                        ),
                    )
                )
            self._sync_step_statuses(repo)
            fresh = [get_required(repo, "cfo_positions", row["id"]) for row in raw]
            public = self._public_position_batch(repo, fresh)
            results = [
                {
                    **public[index],
                    "notification_user_ids": row.get("notification_user_ids", []),
                }
                for index, row in enumerate(raw)
            ]
        return {
            "positions": results,
            "notification_user_ids": sorted({
                user_id
                for row in results
                for user_id in row.get("notification_user_ids", [])
                if user_id
            }),
        }

    def approve_positions_from_register(self, user: dict, position_ids: list[str], comment: str = "") -> dict:
        """Approve a whole article/CFO group at the actor's current route step.

        Economists complete their review and freeze the position in one group
        action; higher route steps use the regular position approval.  Keeping
        this here, instead of a line-level bulk decision, preserves the common
        route of every article position.
        """
        if user.get("role") == "employee":
            return self.submit_positions_from_register(user, position_ids, comment)
        with self.repo.transaction() as repo:
            return self._approve_positions_from_register(
                repo, user, position_ids, comment
            )

    def _approve_positions_from_register(
        self,
        repo: Repository,
        user: dict,
        position_ids: list[str],
        comment: str,
    ) -> dict:
        if not position_ids:
            raise HTTPException(status_code=422, detail="Выберите хотя бы одну позицию")
        position_ids = sorted(set(position_ids))
        position_logs = self._preload_approval_batch(repo)
        positions = [get_required(repo, "cfo_positions", position_id) for position_id in position_ids]
        group_event_id = self._event_id()
        step_ids = {self._current_step_id(repo, position) for position in positions}
        if None in step_ids:
            raise HTTPException(status_code=409, detail="Часть позиций ещё не передана на согласование")
        results: list[dict] = []
        deferred_indexes: list[int] = []
        for position in positions:
            step_id = self._current_step_id(repo, position)
            step = get_required(repo, "steps", step_id)
            if step.get("unit_id") or self._economist_cfo_id(repo, step):
                self.permissions.require_step_assignee(user, step)
                current = get_required(repo, "cfo_positions", position["id"])
                # Decisions are intentionally separate from route movement.
                # complete_economist_review validates that every line already
                # has a decision and raises with the pending line ids when it
                # does not.  It must never silently approve the remainder.
                self.complete_economist_review(user, current["id"], comment, repo=repo)
                results.append(
                    self.freeze_position(
                        user, position["id"], comment, event_id=group_event_id, repo=repo
                    )
                )
            else:
                deferred_indexes.append(len(results))
                results.append(
                    self.approve_position_at_step(
                        user,
                        step_id,
                        position["id"],
                        comment,
                        event_id=group_event_id,
                        repo=repo,
                        sync_steps=False,
                        serialize_result=False,
                        previously_approved_ids=self._approver_approved_item_ids(
                            repo,
                            position["id"],
                            step_id,
                            logs=position_logs,
                        ),
                    )
                )
        if deferred_indexes:
            self._sync_step_statuses(repo)
            fresh = [
                get_required(repo, "cfo_positions", results[index]["id"])
                for index in deferred_indexes
            ]
            public = self._public_position_batch(repo, fresh)
            for public_index, index in enumerate(deferred_indexes):
                row = results[index]
                results[index] = {
                    **public[public_index],
                    "notification_user_ids": row.get("notification_user_ids", []),
                }
        return {
            "positions": results,
            "notification_user_ids": sorted({
                user_id for result in results for user_id in result.get("notification_user_ids", []) if user_id
            }),
        }

    def submit_positions_from_register(self, user: dict, position_ids: list[str], comment: str = "") -> dict:
        self.sync_automatic_steps(user)
        with self.repo.transaction() as repo:
            return self._submit_positions_from_register(
                repo, user, position_ids, comment
            )

    def _submit_positions_from_register(
        self,
        repo: Repository,
        user: dict,
        position_ids: list[str],
        comment: str,
    ) -> dict:
        if not position_ids:
            raise HTTPException(status_code=422, detail="Выберите хотя бы одну позицию")
        position_ids = sorted(set(position_ids))
        group_event_id = self._event_id()
        results = [
            self.submit_to_economist(
                user, position_id, comment, event_id=group_event_id, repo=repo
            )
            for position_id in position_ids
        ]
        return {
            "positions": results,
            "notification_user_ids": sorted({
                user_id for result in results for user_id in result.get("notification_user_ids", []) if user_id
            }),
        }

    def return_positions_from_register(
        self,
        user: dict,
        position_ids: list[str],
        target_step_id: str,
        comment: str,
        revision_items: list[dict] | None = None,
    ) -> dict:
        """Return register article/CFO positions to one lower step."""
        with self.repo.transaction() as repo:
            return self._return_positions_from_register(
                repo,
                user,
                position_ids,
                target_step_id,
                comment,
                revision_items,
            )

    def _return_positions_from_register(
        self,
        repo: Repository,
        user: dict,
        position_ids: list[str],
        target_step_id: str,
        comment: str,
        revision_items: list[dict] | None,
    ) -> dict:
        if not position_ids:
            raise HTTPException(status_code=422, detail="Выберите хотя бы одну позицию")
        position_ids = sorted(set(position_ids))
        positions = [get_required(repo, "cfo_positions", position_id) for position_id in position_ids]
        group_event_id = self._event_id()
        revision_by_item = {row["item_id"]: row for row in (revision_items or [])}
        selected_item_ids = set(revision_by_item) if revision_by_item else None
        line_comment = ""
        if selected_item_ids and len(selected_item_ids) == 1:
            line_comment = (next(iter(revision_by_item.values())).get("comment") or "").strip()
        can_edit_lines = user.get("role") in {"economist", "employee"}
        if not comment.strip() and (
            not can_edit_lines or not selected_item_ids or len(selected_item_ids) != 1 or not line_comment
        ):
            raise HTTPException(status_code=422, detail="Укажите комментарий к доработке")
        if selected_item_ids is not None:
            all_position_item_ids = set()
            for position in positions:
                all_position_item_ids.update(
                    row["id"] for row in self._position_items(repo, position["id"])
                )
            unknown = selected_item_ids - all_position_item_ids
            if unknown:
                raise HTTPException(status_code=422, detail="Часть выбранных строк не относится к позициям группы")
        edges = self._edges(repo)
        for position in positions:
            step_id = self._current_step_id(repo, position)
            if not step_id:
                raise HTTPException(status_code=409, detail="Часть позиций ещё не находится на шаге согласования")
            step = get_required(repo, "steps", step_id)
            self.permissions.require_step_assignee(user, step)
            if target_step_id and target_step_id not in self._children(step_id, edges):
                raise HTTPException(
                    status_code=422,
                    detail="Выбранный шаг не является непосредственным нижним шагом для всех позиций группы",
                )
        results = []
        for position in positions:
            step_id = self._current_step_id(repo, position) or ""
            position_items = self._position_items(repo, position["id"])
            if selected_item_ids is not None:
                position_selected_ids = [row["id"] for row in position_items if row["id"] in selected_item_ids]
                if not position_selected_ids:
                    continue
                position_revision = [revision_by_item[item_id] for item_id in position_selected_ids]
                results.append(
                    self.return_position(
                        user,
                        step_id,
                        position["id"],
                        target_step_id,
                        comment.strip(),
                        item_ids=position_selected_ids,
                        revision_items=position_revision,
                        event_id=group_event_id,
                        repo=repo,
                    )
                )
            else:
                results.append(
                    self.return_position(
                        user,
                        step_id,
                        position["id"],
                        target_step_id,
                        comment.strip(),
                        event_id=group_event_id,
                        repo=repo,
                    )
                )
        if selected_item_ids is not None and not results:
            raise HTTPException(status_code=422, detail="Выберите хотя бы одну строку для доработки")
        return {
            "positions": results,
            "notification_user_ids": sorted({
                user_id for result in results for user_id in result.get("notification_user_ids", []) if user_id
            }),
            "chat_messages": [
                message for result in results for message in result.get("chat_messages", [])
            ],
        }

    def return_position(
        self,
        user: dict,
        step_id: str,
        position_id: str,
        target_step_id: str,
        comment: str,
        item_ids: list[str] | None = None,
        revision_items: list[dict] | None = None,
        *,
        event_id: str | None = None,
        repo: Repository | None = None,
    ) -> dict:
        result_repo = repo
        transaction = nullcontext(repo) if repo is not None else self.repo.transaction()
        with transaction as storage:
            repo = storage
            step = get_required(repo, "steps", step_id)
            self.permissions.require_step_assignee(user, step)
            position = repo.lock_by_id("cfo_positions", position_id)
            if not position or self._current_step_id(repo, position) != step_id:
                raise HTTPException(status_code=409, detail="Позиция не находится на этом шаге")
            children = self._children(step_id, self._edges(repo))
            target_step_id = target_step_id or self._default_return_step_id(repo, step_id, position)
            if target_step_id not in children:
                raise HTTPException(status_code=422, detail="Возврат возможен на непосредственный дочерний шаг")
            target = get_required(repo, "steps", target_step_id)
            items = self._position_items(repo, position_id)
            pending_decision_ids = self._pending_position_decision_ids(repo, position, step, items)
            actor = get_required(repo, "users", step["user_id"]) if step.get("user_id") else {}
            # A reviewer can return selected lines as a single group action.
            # The return itself is their decision; requiring an artificial
            # approval for every selected line made the group action invisible
            # and forced a contradictory two-step workflow.
            # ZGD may return a final-stage position for revision without first
            # approving every line.  This is especially important immediately
            # after unlocking a budget.  An intermediate approver still needs
            # an explicit selected-line return.
            reviewer_group_return = actor.get("role") == "zgd" or (
                actor.get("role") == "approver" and bool(item_ids)
            )
            if pending_decision_ids and not reviewer_group_return:
                raise HTTPException(
                    status_code=409,
                    detail={
                        "message": "Сначала вынесите решения по всем строкам позиции",
                        "item_ids": pending_decision_ids,
                    },
                )
            selected_ids = set(item_ids or [row["id"] for row in items if not row.get("fixed")])
            selected = [row for row in items if row["id"] in selected_ids]
            if not selected or len(selected) != len(selected_ids):
                raise HTTPException(status_code=422, detail="Выберите строки данной позиции")
            if any(row.get("fixed") for row in selected):
                raise HTTPException(status_code=409, detail="Финально зафиксированную строку может открыть только ЗГД")
            revision_by_item = {row["item_id"]: row for row in (revision_items or [])}
            revision_line_comments: dict[str, str] = {}
            event_id = event_id or self._event_id()
            can_edit_lines = user.get("role") in {"economist", "employee"}
            for item in selected:
                revision = revision_by_item.get(item["id"], {})
                before_item = dict(item)
                # A return for revision always reopens the selected rows.  The
                # recipient may be an intermediate reviewer; they pass the
                # reopened rows one direct step lower until they reach the
                # participant who edits the budget.
                patch = {"frozen": False}
                if can_edit_lines and revision.get("suggested_sum_fact") is not None:
                    patch["sum_fact"] = revision["suggested_sum_fact"]
                    patch["status"] = ItemStatus.approved_with_changes
                if can_edit_lines and (revision.get("comment") or "").strip():
                    patch["comment"] = revision["comment"].strip()
                updated_item = repo.update("req_items", item["id"], patch)
                line_comment = (revision.get("comment") or "").strip()
                # Returning a position is one workflow event.  Do not create
                # an identical audit entry for every selected row.  The
                # exception is an economist's explicit per-line correction:
                # it carries a distinct amount/comment and therefore remains
                # auditable at line level in addition to the group event.
                if user.get("role") == "economist" and (
                    line_comment or revision.get("suggested_sum_fact") is not None
                ):
                    self._position_log(
                        repo, user, position, "item_returned_for_revision", before=before_item,
                        after=updated_item, comment=line_comment,
                        req_item_id=item["id"], request_id=item["request_id"],
                        target_step_id=target_step_id,
                    )
                revision_line_comments[item["id"]] = line_comment
            before = dict(position)
            after = repo.update(
                "cfo_positions", position_id,
                {
                    "status": CfoPositionStatus.on_revision,
                    "current_step_id": target_step_id,
                },
            )
            self._position_log(
                repo, user, after, "position_returned", before=before, after=after,
                comment=comment, event_id=event_id, step_id=step_id,
                current_step_id=target_step_id,
                target_step_id=target_step_id, item_ids=sorted(selected_ids),
            )
            self._step_log(
                repo, user, step, "position_returned", event_id=event_id,
                comment=comment, cfo_position_id=position_id, target_step_id=target_step_id,
            )
            self._sync_step_statuses(repo)
            chat_messages: list[dict] = []
            if self.chat_service:
                role = user.get("role")
                if role == "employee":
                    selected_by_request: dict[str, list[dict]] = {}
                    for item in selected:
                        selected_by_request.setdefault(item["request_id"], []).append(item)
                    for request_id, request_items in selected_by_request.items():
                        request = get_required(repo, "requests", request_id)
                        chat_messages.append(
                            self.chat_service.system_message_for_request(
                                request,
                                self._revision_chat_text(
                                    repo, after, request_items, comment, revision_line_comments,
                                ),
                                repo=repo,
                            )
                        )
                else:
                    chat_messages.append(
                        self.chat_service.system_message_for_position(
                            after,
                            self._revision_chat_text(
                                repo, after, selected, comment, revision_line_comments,
                            ),
                            repo=repo,
                        )
                    )
            notify_id = (
                self.permissions.cfo_economist_id(target["unit_id"])
                if target.get("unit_id")
                else target.get("user_id")
            )
            self._notify(
                repo, notify_id, "cfo_position.returned",
                {"cfo_position_id": position_id, "step_id": target_step_id, "comment": comment},
            )
        result = self.public_position(after, repo=result_repo)
        result["notification_user_ids"] = [notify_id] if notify_id else []
        result["chat_messages"] = chat_messages
        return result

    def return_for_revision(self, user: dict, position_id: str, payload: dict) -> dict:
        position = get_required(self.repo, "cfo_positions", position_id)
        step_id = self._current_step_id(self.repo, position) or ""
        comment = (payload.get("comment") or "").strip()
        revision_items = payload.get("items") or []
        line_comment = (revision_items[0].get("comment") or "").strip() if len(revision_items) == 1 else ""
        if not comment and (
            user.get("role") not in {"economist", "employee"}
            or len(revision_items) != 1
            or not line_comment
        ):
            raise HTTPException(status_code=422, detail="Укажите комментарий к доработке")
        return self.return_position(
            user, step_id, position_id, payload.get("target_step_id") or "", comment,
            [row["item_id"] for row in revision_items], revision_items,
        )

    def reopen_fixed_items(
        self, user: dict, position_id: str, target_step_id: str, comment: str, item_ids: list[str]
    ) -> dict:
        """Final ZGD fixation is irreversible through application write APIs."""
        raise HTTPException(
            status_code=409,
            detail="Зафиксированный ЗГД бюджет нельзя повторно открыть",
        )

    def position_logs(self, user: dict, position_id: str, *, page_size=None, before=None) -> list[dict] | dict:
        position = get_required(self.repo, "cfo_positions", position_id)
        self.permissions.require_view_position(user, position)
        if page_size:
            return cursor_page(self.repo, "cfo_position_logs", filters={"cfo_position_id": position_id}, page_size=page_size, before=before)
        return sorted(
            [
                row for row in find_rows(self.repo, "cfo_position_logs", filters={"cfo_position_id": position_id})
                if row.get("cfo_position_id") == position_id
            ],
            key=lambda row: str(row.get("created_at") or ""),
            reverse=True,
        )

    def position_comments(self, user: dict, position_id: str) -> list[dict]:
        position = get_required(self.repo, "cfo_positions", position_id)
        self.permissions.require_view_position(user, position)
        users = {row["id"]: row for row in self.repo.load_all("users")}
        profiles = {row["user_id"]: row for row in self.repo.load_all("profiles")}
        comments = []
        for row in self.repo.load_all("cfo_position_logs"):
            log = row.get("log") or {}
            if row.get("cfo_position_id") != position_id or log.get("action") != "position_comment_added":
                continue
            author = users.get(row.get("user_id"))
            comments.append({
                "id": row["id"],
                "created_at": row.get("created_at"),
                "comment": log.get("comment") or "",
                "step_id": row.get("step_id"),
                "user": {
                    **public_user(author),
                    "profile": profiles.get(author["id"]),
                } if author else None,
            })
        return sorted(comments, key=lambda row: str(row.get("created_at") or ""), reverse=True)

    def add_position_comment(self, user: dict, position_id: str, comment: str) -> dict:
        if user.get("role") not in {"approver", "zgd"}:
            raise HTTPException(status_code=403, detail="Комментарий к статье ЦФО доступен согласующему и ЗГД")
        with self.repo.transaction() as repo:
            position = repo.lock_by_id("cfo_positions", position_id)
            if not position:
                raise HTTPException(status_code=404, detail="Позиция ЦФО не найдена")
            self.permissions.require_view_position(user, position)
            current_step_id = self._current_step_id(repo, position)
            if not current_step_id:
                raise HTTPException(status_code=409, detail="Позиция уже завершена")
            self.permissions.require_step_assignee(user, get_required(repo, "steps", current_step_id))
            logged = self._position_log(
                repo, user, position, "position_comment_added", comment=comment.strip(),
                current_step_id=current_step_id,
            )
        return {"id": logged["id"], "ok": True}

    def request_history(self, user: dict, request_id: str, *, page_size=None, before=None) -> list[dict] | dict:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_view_request(user, request)
        return self.register_history(user, request_id=request_id, page_size=page_size, before=before)

    def register_history(self, user: dict, request_id: str | None = None, *, page_size=None, before=None) -> list[dict] | dict:
        """Return one chronological audit trail for all requests visible to a user."""
        visible_request_ids = self.permissions.visible_request_ids(user)
        if request_id:
            request = get_required(self.repo, "requests", request_id)
            self.permissions.require_view_request(user, request)
            request_ids = {request_id}
        elif visible_request_ids is None:
            request_ids = {row["id"] for row in self.repo.load_all("requests")}
        else:
            request_ids = visible_request_ids
        if hasattr(self.repo, "history_rows"):
            logs = self.repo.history_rows(request_ids, limit=page_size + 1 if page_size else None, before=decode_cursor(before))
            return self._history_page(logs, page_size) if page_size else logs
        item_ids = {
            row["id"] for row in find_rows(self.repo, "req_items", in_filters={"request_id": request_ids})
            if row.get("request_id") in request_ids
        }
        position_ids = {
            row.get("cfo_position_id")
            for row in find_rows(self.repo, "req_items", in_filters={"request_id": request_ids})
            if row.get("id") in item_ids and row.get("cfo_position_id")
        }
        logs = [
            {**row, "source": "request"}
            for row in find_rows(self.repo, "req_logs", in_filters={"req_id": request_ids})
            if row.get("req_id") in request_ids
        ]
        logs += [
            {**row, "source": "cfo_position"}
            for row in self.repo.load_all("cfo_position_logs")
            if (row.get("log") or {}).get("request_id") in request_ids
            or (row.get("log") or {}).get("req_item_id") in item_ids
            or row.get("cfo_position_id") in position_ids
        ]
        if page_size:
            logs.sort(key=lambda row: (str(row["created_at"]), self._history_cursor_id(row)), reverse=True)
            cursor = decode_cursor(before)
            if cursor:
                logs = [row for row in logs if (str(row["created_at"]), self._history_cursor_id(row)) < tuple(cursor)]
            return self._history_page(logs[:page_size + 1], page_size)
        return sorted(logs, key=lambda row: str(row.get("created_at") or ""), reverse=True)

    @staticmethod
    def _history_cursor_id(row):
        return f"{row['source']}:{int(row['id']):020d}"

    def _history_page(self, rows, page_size):
        page = rows[:page_size]
        cursor = encode_cursor({"created_at": page[-1]["created_at"], "id": self._history_cursor_id(page[-1])}) if len(rows) > page_size else None
        return {"items": page, "next_cursor": cursor}

    def step_logs(self, user: dict, step_id: str, **filters) -> list[dict]:
        step = get_required(self.repo, "steps", step_id)
        self.permissions.require_step_log_access(user, step)
        return sorted(
            [row for row in self.repo.load_all("step_logs") if row.get("step_id") == step_id],
            key=lambda row: str(row.get("created_at") or ""),
            reverse=True,
        )

    def all_step_logs(self, user: dict, **filters) -> list[dict]:
        self.permissions.require_admin(user)
        rows = self.repo.load_all("step_logs")
        if filters.get("step_id"):
            rows = [row for row in rows if row.get("step_id") == filters["step_id"]]
        return sorted(rows, key=lambda row: str(row.get("created_at") or ""), reverse=True)

    # Explicit failures for removed request-based downstream operations.
    def request_approval_step(self, user: dict, request_id: str):
        raise HTTPException(status_code=410, detail="Согласование выполняется по позициям ЦФО")

    request_approval_route = request_approval_step

    def list_step_requests(self, user: dict, step_id: str):
        raise HTTPException(status_code=410, detail="Используйте /steps/{id}/positions")

    def approve_request_at_step(self, *args, **kwargs):
        raise HTTPException(status_code=410, detail="Согласование выполняется по позициям ЦФО")

    def return_requests(self, *args, **kwargs):
        raise HTTPException(status_code=410, detail="Возврат выполняется по позиции ЦФО")

    def revoke_final_approval(self, *args, **kwargs):
        raise HTTPException(status_code=410, detail="Фиксация относится к позиции ЦФО")

    def resume_economist_review(self, *args, **kwargs):
        raise HTTPException(status_code=410, detail="Используйте разморозку позиции ЦФО")

from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder

from app.models import APPROVED_ITEM_STATUSES, ItemStatus, RequestStatus, StepStatus
from app.repositories.base import Repository
from app.services.budget_totals import sync_annual_budgets
from app.services.common import get_required, now_iso
from app.services.permission_service import PermissionService


FINAL_REQUEST_STATUSES = {
    RequestStatus.approved,
    RequestStatus.approved_with_changes,
    RequestStatus.partially_approved,
    RequestStatus.rejected,
}


class ApprovalService:
    def __init__(self, repo: Repository, permissions: PermissionService, chat_service=None):
        self.repo = repo
        self.permissions = permissions
        self.chat_service = chat_service

    @staticmethod
    def _event_id() -> str:
        return str(uuid4())

    @staticmethod
    def _edges(repo: Repository) -> list[dict]:
        return repo.load_all("step_edges")

    @staticmethod
    def _steps(repo: Repository) -> dict[str, dict]:
        return {item["id"]: item for item in repo.load_all("steps")}

    @staticmethod
    def _children(step_id: str, edges: list[dict]) -> list[str]:
        return [edge["child_step_id"] for edge in edges if edge["parent_step_id"] == step_id]

    @staticmethod
    def _parents(step_id: str, edges: list[dict]) -> list[str]:
        return [edge["parent_step_id"] for edge in edges if edge["child_step_id"] == step_id]

    def _root_ids(self, repo: Repository) -> list[str]:
        steps = self._steps(repo)
        users = {item["id"]: item for item in repo.load_all("users")}
        parent_ids = {edge["child_step_id"] for edge in self._edges(repo)}
        return [
            step_id
            for step_id, step in steps.items()
            if step_id not in parent_ids
            and step.get("unit_id") is None
            and users.get(step.get("user_id"), {}).get("role") == "zgd"
        ]

    def _route_step_ids(self, repo: Repository, root_step_id: str) -> set[str]:
        edges = self._edges(repo)
        result: set[str] = set()
        stack = [root_step_id]
        while stack:
            step_id = stack.pop()
            if step_id in result:
                continue
            result.add(step_id)
            stack.extend(self._children(step_id, edges))
        return result

    @staticmethod
    def _step_log(
        repo: Repository,
        user: dict,
        step: dict,
        action: str,
        event_id: str,
        *,
        changes: dict | None = None,
        comment: str | None = None,
        **extra,
    ) -> dict:
        log = {
            "action": action,
            "entity": "step",
            "entity_id": step["id"],
            "event_id": event_id,
            "changes": changes or {},
            "comment": comment,
            **extra,
        }
        return repo.create(
            "step_logs",
            {
                "step_id": step["id"],
                "user_id": user["id"],
                "log": jsonable_encoder(log),
                "created_at": now_iso(),
            },
        )

    @staticmethod
    def _edge_log(
        repo: Repository,
        user: dict,
        edge: dict,
        action: str,
        event_id: str,
    ) -> dict:
        entity_id = f"{edge['parent_step_id']}:{edge['child_step_id']}"
        return repo.create(
            "step_logs",
            {
                "step_id": edge["parent_step_id"],
                "user_id": user["id"],
                "log": {
                    "action": action,
                    "entity": "step_edge",
                    "entity_id": entity_id,
                    "event_id": event_id,
                    **edge,
                },
                "created_at": now_iso(),
            },
        )

    @staticmethod
    def _request_log(
        repo: Repository,
        user: dict,
        request_id: str,
        action: str,
        event_id: str,
        *,
        comment: str | None = None,
        **extra,
    ) -> dict:
        return repo.create(
            "req_logs",
            {
                "req_id": request_id,
                "user_id": user["id"],
                "log": jsonable_encoder(
                    {
                        "action": action,
                        "entity": "request",
                        "entity_id": request_id,
                        "event_id": event_id,
                        "changes": extra.pop("changes", {}),
                        "comment": comment,
                        **extra,
                    }
                ),
                "created_at": now_iso(),
            },
        )

    def _validate_step_shape(
        self,
        repo: Repository,
        user_id: str,
        unit_id: str | None,
        *,
        exclude_step_id: str | None = None,
    ) -> None:
        assignee = get_required(repo, "users", user_id)
        if unit_id is not None:
            get_required(repo, "units", unit_id)
            if assignee.get("role") != "economist":
                raise HTTPException(status_code=400, detail="Листовой шаг должен быть назначен экономисту")
            PermissionService(repo).require_economist_unit_access(assignee, unit_id)
            duplicate = next(
                (
                    step
                    for step in repo.load_all("steps")
                    if step["id"] != exclude_step_id and step.get("unit_id") == unit_id
                ),
                None,
            )
            if duplicate:
                raise HTTPException(status_code=400, detail="Для подразделения уже существует листовой шаг")
            return
        if assignee.get("role") not in {"approver", "zgd"}:
            raise HTTPException(
                status_code=400,
                detail="Промежуточный шаг назначается согласующему, корневой — ЗГД",
            )

    def _public_steps(self, repo: Repository, steps: list[dict]) -> list[dict]:
        users = {item["id"]: item for item in repo.load_all("users")}
        profiles = {item["user_id"]: item for item in repo.load_all("profiles")}
        units = {item["id"]: item for item in repo.load_all("units")}
        responsibles = {
            item["unit_id"]: users[item["user_id"]]
            for item in repo.load_all("units_responsibles")
            if item.get("is_active")
            and users.get(item.get("user_id"), {}).get("role") == "employee"
        }
        edges = self._edges(repo)

        def unit_context(unit_id: str | None) -> dict:
            if not unit_id or unit_id not in units:
                return {"unit": None, "cfo": None, "department": None, "unit_path": []}
            path: list[dict] = []
            current = units[unit_id]
            seen: set[str] = set()
            while current and current["id"] not in seen:
                seen.add(current["id"])
                path.append(current)
                current = units.get(current.get("parent_id"))
            path.reverse()
            return {
                "unit": units[unit_id],
                "cfo": path[-2] if len(path) >= 2 else None,
                "department": path[0] if path else None,
                "unit_path": [item["name"] for item in path],
            }

        return [
            {
                **step,
                **unit_context(step.get("unit_id")),
                "user": (
                    {
                        "id": users[step["user_id"]]["id"],
                        "login": users[step["user_id"]]["login"],
                        "role": users[step["user_id"]]["role"],
                        "profile": profiles.get(step["user_id"]),
                    }
                    if step.get("user_id") in users
                    else None
                ),
                "responsible": (
                    {
                        "id": responsibles[step["unit_id"]]["id"],
                        "login": responsibles[step["unit_id"]]["login"],
                        "role": responsibles[step["unit_id"]]["role"],
                        "profile": profiles.get(responsibles[step["unit_id"]]["id"]),
                    }
                    if step.get("unit_id") in responsibles
                    else None
                ),
                "parent_step_ids": self._parents(step["id"], edges),
                "child_step_ids": self._children(step["id"], edges),
            }
            for step in steps
        ]

    def list_steps(self, user: dict) -> list[dict]:
        """Return the editable graph for admins and the caller's route branches otherwise."""
        all_steps = self.repo.load_all("steps")
        if user.get("role") in {"admin", "zgd"}:
            steps = all_steps
        else:
            edges = self._edges(self.repo)
            children: dict[str, list[str]] = {}
            parents: dict[str, list[str]] = {}
            for edge in edges:
                children.setdefault(edge["parent_step_id"], []).append(edge["child_step_id"])
                parents.setdefault(edge["child_step_id"], []).append(edge["parent_step_id"])

            if user.get("role") == "employee":
                module_ids = self.permissions.employee_module_ids(user["id"])
                seed_ids = {step["id"] for step in all_steps if step.get("unit_id") in module_ids}
            else:
                seed_ids = {step["id"] for step in all_steps if step.get("user_id") == user["id"]}

            visible_ids: set[str] = set()
            for seed_id in seed_ids:
                # A participant sees their own branch: all upstream stages and all
                # modules which reach their stage, but not neighbouring branches
                # attached to a shared higher-level stage.
                for adjacency in (children, parents):
                    stack = [seed_id]
                    seen: set[str] = set()
                    while stack:
                        step_id = stack.pop()
                        if step_id in seen:
                            continue
                        seen.add(step_id)
                        visible_ids.add(step_id)
                        stack.extend(adjacency.get(step_id, []))
            steps = [step for step in all_steps if step["id"] in visible_ids]
        public_steps = self._public_steps(self.repo, steps)
        visible_ids = {step["id"] for step in public_steps}
        for public_step in public_steps:
            public_step["parent_step_ids"] = [step_id for step_id in public_step["parent_step_ids"] if step_id in visible_ids]
            public_step["child_step_ids"] = [step_id for step_id in public_step["child_step_ids"] if step_id in visible_ids]
        steps_by_id = {step["id"]: step for step in steps}
        for public_step in public_steps:
            status, active_count = self._step_progress(self.repo, steps_by_id[public_step["id"]])
            public_step["status"] = status
            public_step["active_requests_count"] = active_count
        return public_steps

    def my_steps(self, user: dict) -> list[dict]:
        if user.get("role") not in {"economist", "approver", "zgd"}:
            raise HTTPException(status_code=403, detail="У пользователя нет шагов согласования")
        steps = [step for step in self.repo.load_all("steps") if step.get("user_id") == user["id"]]
        if user["role"] == "economist":
            steps = [
                step
                for step in steps
                if step.get("unit_id") in self.permissions.economist_editable_module_ids(user["id"])
            ]
        elif user["role"] == "approver":
            steps = [step for step in steps if step.get("unit_id") is None]
        else:
            root_ids = set(self._root_ids(self.repo))
            steps = [step for step in steps if step["id"] in root_ids]
        return self._public_steps(self.repo, steps)

    def request_approval_step(self, user: dict, request_id: str) -> dict | None:
        """Return the assignee's available actions for one request.

        A non-leaf step receives a request as soon as its direct child sends the
        request up the route.  It must not wait for other branches to finish:
        the assignee can review or return that request immediately.  Sending a
        step further remains a package operation and is exposed only when every
        received request of the step is reviewed.
        """
        request = get_required(self.repo, "requests", request_id)
        steps = [step for step in self.repo.load_all("steps") if step.get("user_id") == user["id"]]
        if user.get("role") == "economist":
            allowed_units = self.permissions.economist_editable_module_ids(user["id"])
            steps = [step for step in steps if step.get("unit_id") in allowed_units]
        elif user.get("role") == "approver":
            steps = [step for step in steps if step.get("unit_id") is None]
        elif user.get("role") == "zgd":
            root_ids = set(self._root_ids(self.repo))
            steps = [step for step in steps if step["id"] in root_ids]
        else:
            return None

        for step in steps:
            if request.get("unit_id") not in self._descendant_unit_ids(
                self.repo,
                step,
                approved_children_only=False,
            ):
                continue

            if step.get("unit_id") is not None:
                request_status = step.get("status")
                if request_status not in {StepStatus.on_approval, StepStatus.on_revision}:
                    continue
                public_step = self._public_steps(self.repo, [step])[0]
                public_step["request_status"] = request_status
                return {
                    "step": public_step,
                    "child_step_id": None,
                    "request_status": request_status,
                    "can_approve": False,
                    "can_forward": request_status == StepStatus.on_approval,
                    "can_return": request_status in {StepStatus.on_approval, StepStatus.on_revision},
                    "is_final": False,
                }

            state = self._request_step_state(self.repo, step, request_id)
            if state["status"] not in {StepStatus.on_approval, StepStatus.approved}:
                continue
            public_step = self._public_steps(self.repo, [step])[0]
            public_step["request_status"] = state["status"]
            is_final = step["id"] in self._root_ids(self.repo)
            return {
                "step": public_step,
                "child_step_id": state["child_step_id"],
                "request_status": state["status"],
                "can_approve": state["status"] == StepStatus.on_approval,
                "can_forward": not is_final and self._can_forward_step_package(self.repo, step),
                "can_return": True,
                "is_final": is_final,
            }
        return None

    def request_approval_route(self, user: dict, request_id: str) -> list[dict]:
        """Return only the route branch and step events relevant to one request."""
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_view_request(user, request)
        steps = self._steps(self.repo)
        edges = self._edges(self.repo)
        leaf = next(
            (step for step in steps.values() if step.get("unit_id") == request.get("unit_id")),
            None,
        )
        if not leaf:
            return []

        distance: dict[str, int] = {leaf["id"]: 0}
        stack = [leaf["id"]]
        while stack:
            step_id = stack.pop()
            for parent_id in self._parents(step_id, edges):
                next_distance = distance[step_id] + 1
                if parent_id in distance and distance[parent_id] <= next_distance:
                    continue
                distance[parent_id] = next_distance
                stack.append(parent_id)

        users = {item["id"]: item for item in self.repo.load_all("users")}
        profiles = {item["user_id"]: item for item in self.repo.load_all("profiles")}
        request_event_ids = {
            (item.get("log") or {}).get("event_id")
            for item in self.repo.load_all("req_logs")
            if item.get("req_id") == request_id and (item.get("log") or {}).get("event_id")
        }

        def log_is_relevant(log: dict) -> bool:
            if log.get("event_id") in request_event_ids:
                return True
            if request_id in (log.get("request_ids") or []):
                return True
            return any(
                request_id in (target.get("request_ids") or [])
                for target in log.get("targets") or []
            )

        logs_by_step: dict[str, list[dict]] = {step_id: [] for step_id in distance}
        for item in self.repo.load_all("step_logs"):
            step_id = item.get("step_id")
            log = item.get("log") or {}
            if step_id not in logs_by_step or not log_is_relevant(log):
                continue
            actor = users.get(item.get("user_id"))
            logs_by_step[step_id].append(
                {
                    **item,
                    "user": (
                        {
                            "id": actor["id"],
                            "login": actor["login"],
                            "role": actor["role"],
                            "profile": profiles.get(actor["id"]),
                        }
                        if actor
                        else None
                    ),
                }
            )

        public_steps = {}
        for item in self._public_steps(self.repo, [steps[step_id] for step_id in distance]):
            item["request_status"] = self._request_step_state(self.repo, steps[item["id"]], request_id)["status"]
            public_steps[item["id"]] = item
        return [
            {
                "step": public_steps[step_id],
                "logs": sorted(
                    logs_by_step[step_id],
                    key=lambda item: str(item.get("created_at") or ""),
                    reverse=True,
                ),
            }
            for step_id in sorted(distance, key=lambda item: distance[item])
        ]

    def _require_step_view(self, user: dict, step: dict) -> None:
        if user.get("role") == "admin":
            return
        self.permissions.require_step_assignee(user, step)
        if user.get("role") == "economist":
            if not step.get("unit_id"):
                raise HTTPException(status_code=403, detail="Экономисту доступен только листовой шаг")
            self.permissions.require_economist_unit_access(user, step["unit_id"])
        elif user.get("role") == "approver":
            self.permissions.require_approver_step_access(user, step)
        elif user.get("role") == "zgd":
            self.permissions.require_zgd_root_step_access(user, step)
        else:
            raise HTTPException(status_code=403, detail="Нет доступа к шагу согласования")

    def get_step(self, user: dict, step_id: str) -> dict:
        step = get_required(self.repo, "steps", step_id)
        self._require_step_view(user, step)
        return self._public_steps(self.repo, [step])[0]

    def create_step(self, user: dict, payload: dict) -> dict:
        self.permissions.require_admin(user)
        if str(payload.get("status", StepStatus.waiting)) != StepStatus.waiting:
            raise HTTPException(status_code=400, detail="Новый шаг создаётся в статусе waiting")
        with self.repo.transaction() as repo:
            child_step_id = payload.get("child_step_id")
            if child_step_id:
                get_required(repo, "steps", child_step_id)
            self._validate_step_shape(repo, payload["user_id"], payload.get("unit_id"))
            created = repo.create(
                "steps",
                {
                    "user_id": payload["user_id"],
                    "unit_id": payload.get("unit_id"),
                    "status": StepStatus.waiting,
                },
            )
            event_id = self._event_id()
            self._step_log(
                repo,
                user,
                created,
                "step_created",
                event_id,
                changes={
                    key: {"from": None, "to": created.get(key)}
                    for key in ("user_id", "unit_id", "status")
                },
            )
            if child_step_id:
                edge = {"parent_step_id": created["id"], "child_step_id": child_step_id}
                repo.create("step_edges", edge)
                self._edge_log(repo, user, edge, "step_edge_created", event_id)
            return self._public_steps(repo, [created])[0]

    def bootstrap_reviewed_leaf_steps(self, user: dict) -> dict:
        """Bring reviewed legacy requests into the first approval step exactly once."""
        self.permissions.require_admin(user)
        created: list[dict] = []
        skipped: list[dict] = []
        with self.repo.transaction() as repo:
            steps_by_unit = {
                step.get("unit_id"): step
                for step in repo.load_all("steps")
                if step.get("unit_id")
            }
            users = {item["id"]: item for item in repo.load_all("users")}
            requests_by_unit: dict[str, list[dict]] = {}
            for request in repo.load_all("requests"):
                if request.get("status") not in FINAL_REQUEST_STATUSES or request.get("fixed"):
                    continue
                requests_by_unit.setdefault(request["unit_id"], []).append(request)

            for unit_id, reviewed_requests in requests_by_unit.items():
                existing_step = steps_by_unit.get(unit_id)
                if existing_step:
                    if existing_step.get("status") == StepStatus.approved:
                        reopened = repo.update(
                            "steps",
                            existing_step["id"],
                            {"status": StepStatus.on_approval},
                        )
                        self._step_log(
                            repo,
                            user,
                            reopened,
                            "step_reopened",
                            self._event_id(),
                            changes={
                                "status": {
                                    "from": StepStatus.approved,
                                    "to": StepStatus.on_approval,
                                }
                            },
                            trigger="legacy_reviewed_requests_backfill",
                            request_ids=[item["id"] for item in reviewed_requests],
                        )
                    skipped.append({"unit_id": unit_id, "reason": "leaf_step_exists"})
                    continue
                economist_ids = {request.get("economist_id") for request in reviewed_requests if request.get("economist_id")}
                if len(economist_ids) != 1:
                    skipped.append({"unit_id": unit_id, "reason": "economist_is_ambiguous"})
                    continue
                economist_id = next(iter(economist_ids))
                economist = users.get(economist_id)
                if not economist or economist.get("role") != "economist":
                    skipped.append({"unit_id": unit_id, "reason": "economist_not_available"})
                    continue

                event_id = self._event_id()
                step = repo.create(
                    "steps",
                    {
                        "user_id": economist_id,
                        "unit_id": unit_id,
                        "status": StepStatus.on_approval,
                    },
                )
                request_ids = [request["id"] for request in reviewed_requests]
                self._step_log(
                    repo,
                    user,
                    step,
                    "step_created",
                    event_id,
                    changes={
                        "user_id": {"from": None, "to": economist_id},
                        "unit_id": {"from": None, "to": unit_id},
                        "status": {"from": None, "to": StepStatus.on_approval},
                    },
                    trigger="legacy_reviewed_requests_backfill",
                    request_ids=request_ids,
                    created_automatically=True,
                )
                for request in reviewed_requests:
                    before = repo.lock_by_id("requests", request["id"]) or request
                    updated = repo.update("requests", request["id"], {"frozen": True})
                    self._request_log(
                        repo,
                        user,
                        request["id"],
                        "approval_leaf_backfilled",
                        event_id,
                        step_id=step["id"],
                        changes={"frozen": {"from": before.get("frozen"), "to": updated.get("frozen")}},
                    )
                created.append({"step_id": step["id"], "unit_id": unit_id, "request_ids": request_ids})
        return {"created": created, "skipped": skipped}

    def update_step(self, user: dict, step_id: str, patch: dict) -> dict:
        self.permissions.require_admin(user)
        with self.repo.transaction() as repo:
            before = repo.lock_by_id("steps", step_id)
            if not before:
                raise HTTPException(status_code=404, detail="Шаг не найден")
            if "status" in patch and str(patch["status"]) != str(before["status"]):
                raise HTTPException(status_code=403, detail="Статус шага изменяется только бизнес-процессом")
            candidate_user_id = patch.get("user_id", before["user_id"])
            candidate_unit_id = patch.get("unit_id", before.get("unit_id"))
            self._validate_step_shape(
                repo,
                candidate_user_id,
                candidate_unit_id,
                exclude_step_id=step_id,
            )
            allowed_patch = {
                key: value
                for key, value in patch.items()
                if key in {"user_id", "unit_id"} and value != before.get(key)
            }
            updated = repo.update("steps", step_id, allowed_patch) if allowed_patch else before
            changes = {
                key: {"from": before.get(key), "to": updated.get(key)}
                for key in allowed_patch
            }
            if changes:
                event_id = self._event_id()
                self._step_log(repo, user, updated, "step_updated", event_id, changes=changes)
                if "user_id" in changes:
                    self._step_log(
                        repo,
                        user,
                        updated,
                        "step_assignee_changed",
                        event_id,
                        changes={"user_id": changes["user_id"]},
                    )
            return self._public_steps(repo, [updated])[0]

    def delete_step(self, user: dict, step_id: str) -> None:
        self.permissions.require_admin(user)
        with self.repo.transaction() as repo:
            step = repo.lock_by_id("steps", step_id)
            if not step:
                raise HTTPException(status_code=404, detail="Шаг не найден")
            if step.get("status") == StepStatus.closed:
                raise HTTPException(status_code=400, detail="Закрытый шаг нельзя удалить")
            progress_status, active_count = self._step_progress(repo, step)
            if active_count or progress_status in {
                StepStatus.on_approval,
                StepStatus.on_revision,
                StepStatus.approved,
                StepStatus.closed,
            }:
                raise HTTPException(
                    status_code=400,
                    detail="Нельзя удалить шаг: на него уже поступали заявки",
                )
            event_id = self._event_id()
            related_edges = [
                edge
                for edge in self._edges(repo)
                if step_id in {edge["parent_step_id"], edge["child_step_id"]}
            ]
            for edge in related_edges:
                self._edge_log(repo, user, edge, "step_edge_deleted", event_id)
                repo.delete_where(
                    "step_edges",
                    {
                        "parent_step_id": edge["parent_step_id"],
                        "child_step_id": edge["child_step_id"],
                    },
                )
            self._step_log(
                repo,
                user,
                step,
                "step_deleted",
                event_id,
                old_values={
                    "user_id": step.get("user_id"),
                    "unit_id": step.get("unit_id"),
                    "status": step.get("status"),
                },
            )
            repo.delete("steps", step_id)

    def _would_cycle(self, edges: list[dict], parent_id: str, child_id: str) -> bool:
        children: dict[str, set[str]] = {}
        for edge in edges:
            children.setdefault(edge["parent_step_id"], set()).add(edge["child_step_id"])
        stack = [child_id]
        seen: set[str] = set()
        while stack:
            current = stack.pop()
            if current == parent_id:
                return True
            if current in seen:
                continue
            seen.add(current)
            stack.extend(children.get(current, set()))
        return False

    def create_edge(self, user: dict, payload: dict) -> dict:
        self.permissions.require_admin(user)
        parent_id = payload["parent_step_id"]
        child_id = payload["child_step_id"]
        if parent_id == child_id:
            raise HTTPException(status_code=400, detail="Нельзя связать шаг с самим собой")
        with self.repo.transaction() as repo:
            parent = repo.lock_by_id("steps", parent_id)
            child = repo.lock_by_id("steps", child_id)
            if not parent or not child:
                raise HTTPException(status_code=404, detail="Шаг не найден")
            if parent.get("unit_id") is not None:
                raise HTTPException(status_code=400, detail="Листовой шаг не может иметь дочерние шаги")
            users = {item["id"]: item for item in repo.load_all("users")}
            if users.get(child.get("user_id"), {}).get("role") == "zgd":
                raise HTTPException(status_code=400, detail="ЗГД может быть только последним шагом маршрута")
            edges = self._edges(repo)
            if any(
                edge["parent_step_id"] == parent_id and edge["child_step_id"] == child_id
                for edge in edges
            ):
                raise HTTPException(status_code=400, detail="Связь уже существует")
            if self._would_cycle(edges, parent_id, child_id):
                raise HTTPException(status_code=400, detail="Связь создаёт цикл")
            edge = repo.create(
                "step_edges",
                {"parent_step_id": parent_id, "child_step_id": child_id},
            )
            self._edge_log(repo, user, edge, "step_edge_created", self._event_id())
            return edge

    def delete_edge(self, user: dict, payload: dict) -> None:
        self.permissions.require_admin(user)
        with self.repo.transaction() as repo:
            edge = next(
                (
                    edge
                    for edge in self._edges(repo)
                    if edge["parent_step_id"] == payload["parent_step_id"]
                    and edge["child_step_id"] == payload["child_step_id"]
                ),
                None,
            )
            if not edge:
                raise HTTPException(status_code=404, detail="Связь не найдена")
            self._edge_log(repo, user, edge, "step_edge_deleted", self._event_id())
            repo.delete_where("step_edges", payload)

    def _route_from_leaf(
        self,
        steps: dict[str, dict],
        edges: list[dict],
        leaf_id: str,
    ) -> list[dict]:
        if leaf_id not in steps:
            return []
        route = [steps[leaf_id]]
        seen = {leaf_id}
        current_id = leaf_id
        while True:
            parents = self._parents(current_id, edges)
            if not parents:
                break
            parent_id = parents[0]
            if parent_id in seen or parent_id not in steps:
                break
            route.append(steps[parent_id])
            seen.add(parent_id)
            current_id = parent_id
        return route

    def _public_step_label(self, public_step: dict) -> str:
        if public_step.get("unit_id"):
            path = public_step.get("unit_path") or []
            cfo = path[-2] if len(path) >= 2 else None
            unit = public_step.get("unit") or {}
            module = unit.get("name") or (path[-1] if path else None)
            label = " \\ ".join(part for part in (cfo, module) if part)
            return label or "Модуль"
        user = public_step.get("user") or {}
        profile = user.get("profile") or {}
        full_name = " ".join(
            part for part in (profile.get("last_name"), profile.get("name"), profile.get("second_name")) if part
        ).strip()
        name = full_name or user.get("login") or "Без назначения"
        if user.get("role") == "zgd":
            return f"ЗГД · {name}"
        return name

    def preview_delete_edge(self, user: dict, payload: dict) -> dict:
        """Show a compact affected subgraph before/after removing an edge."""
        self.permissions.require_admin(user)
        parent_id = payload["parent_step_id"]
        child_id = payload["child_step_id"]
        edges = self._edges(self.repo)
        edge = next(
            (
                item
                for item in edges
                if item["parent_step_id"] == parent_id and item["child_step_id"] == child_id
            ),
            None,
        )
        if not edge:
            raise HTTPException(status_code=404, detail="Связь не найдена")

        steps = self._steps(self.repo)
        public_by_id = {
            item["id"]: item
            for item in self._public_steps(self.repo, list(steps.values()))
        }
        remaining_edges = [
            item
            for item in edges
            if not (item["parent_step_id"] == parent_id and item["child_step_id"] == child_id)
        ]

        affected_leaf_ids: list[str] = []
        before_node_ids: set[str] = set()
        after_node_ids: set[str] = set()
        for leaf in steps.values():
            if not leaf.get("unit_id"):
                continue
            before = self._route_from_leaf(steps, edges, leaf["id"])
            before_ids = [item["id"] for item in before]
            uses_edge = any(
                before_ids[index] == child_id and before_ids[index + 1] == parent_id
                for index in range(len(before_ids) - 1)
            )
            if not uses_edge:
                continue
            affected_leaf_ids.append(leaf["id"])
            before_node_ids.update(before_ids)
            after = self._route_from_leaf(steps, remaining_edges, leaf["id"])
            after_node_ids.update(item["id"] for item in after)

        def graph_payload(node_ids: set[str], edge_list: list[dict]) -> dict:
            nodes = []
            for step_id in node_ids:
                public = public_by_id.get(step_id)
                raw = steps.get(step_id)
                if not public or not raw:
                    continue
                role = (public.get("user") or {}).get("role")
                kind = "leaf" if raw.get("unit_id") else ("zgd" if role == "zgd" else "review")
                nodes.append(
                    {
                        "id": step_id,
                        "label": self._public_step_label(public),
                        "kind": kind,
                    }
                )
            graph_edges = [
                {
                    "parent_step_id": item["parent_step_id"],
                    "child_step_id": item["child_step_id"],
                }
                for item in edge_list
                if item["parent_step_id"] in node_ids and item["child_step_id"] in node_ids
            ]
            return {"nodes": nodes, "edges": graph_edges}

        past_statuses = {
            StepStatus.on_approval,
            StepStatus.on_revision,
            StepStatus.approved,
            StepStatus.closed,
        }
        approved_past_count = 0
        for request in self.repo.load_all("requests"):
            if request.get("status") == RequestStatus.cancelled:
                continue
            route = self._request_route(self.repo, request["unit_id"])
            route_ids = [item["id"] for item in route]
            edge_index = next(
                (
                    index
                    for index in range(len(route_ids) - 1)
                    if route_ids[index] == child_id and route_ids[index + 1] == parent_id
                ),
                None,
            )
            if edge_index is None:
                continue
            for step in route[edge_index + 1 :]:
                status = self._request_step_state(self.repo, step, request["id"])["status"]
                if status in past_statuses:
                    approved_past_count += 1
                    break

        return {
            "removed_edge": {"parent_step_id": parent_id, "child_step_id": child_id},
            "before_graph": graph_payload(before_node_ids, edges),
            "after_graph": graph_payload(after_node_ids, remaining_edges),
            "affected_leaf_count": len(affected_leaf_ids),
            "has_approved_past": approved_past_count > 0,
            "approved_past_count": approved_past_count,
        }

    def validate_graph(self, user: dict) -> dict:
        self.permissions.require_admin(user)
        steps = self._steps(self.repo)
        edges = self._edges(self.repo)
        users = {item["id"]: item for item in self.repo.load_all("users")}
        errors: list[str] = []
        roots = self._root_ids(self.repo)
        if len(roots) != 1:
            errors.append("Граф должен иметь ровно один корневой шаг")
        root_id = roots[0] if len(roots) == 1 else None
        if root_id:
            root = steps[root_id]
            if users.get(root.get("user_id"), {}).get("role") != "zgd" or root.get("unit_id") is not None:
                errors.append("Корневой шаг должен быть назначен ЗГД и не иметь unit_id")

        unit_ids: list[str] = []
        for step_id, step in steps.items():
            child_ids = self._children(step_id, edges)
            role = users.get(step.get("user_id"), {}).get("role")
            if step.get("unit_id") is not None:
                unit_ids.append(step["unit_id"])
                if child_ids:
                    errors.append(f"Листовой шаг {step_id} не может иметь дочерние шаги")
                if role != "economist":
                    errors.append(f"Листовой шаг {step_id} должен быть назначен экономисту")
            elif step_id == root_id:
                if role != "zgd":
                    errors.append(f"Корневой шаг {step_id} должен быть назначен ЗГД")
            elif role != "approver":
                errors.append(f"Промежуточный шаг {step_id} должен быть назначен согласующему")
        if len(unit_ids) != len(set(unit_ids)):
            errors.append("Один модуль не может иметь два листовых шага")

        if root_id:
            reachable: set[str] = set()
            stack = [root_id]
            active: set[str] = set()

            def visit(step_id: str) -> None:
                if step_id in active:
                    errors.append("Граф содержит цикл")
                    return
                if step_id in reachable:
                    return
                active.add(step_id)
                reachable.add(step_id)
                for child_id in self._children(step_id, edges):
                    visit(child_id)
                active.remove(step_id)

            visit(root_id)
            if reachable != set(steps):
                errors.append("Не все шаги достижимы от корневого шага")
        return {
            "valid": not errors,
            "errors": errors,
            "root_step_id": root_id,
            "steps_count": len(steps),
            "edges_count": len(edges),
        }

    def _descendant_unit_ids(
        self,
        repo: Repository,
        step: dict,
        *,
        approved_children_only: bool,
    ) -> set[str]:
        if hasattr(repo, "descendant_step_unit_ids"):
            return repo.descendant_step_unit_ids(
                step["id"],
                approved_children_only=approved_children_only,
            )
        if step.get("unit_id"):
            return {step["unit_id"]}
        steps = self._steps(repo)
        edges = self._edges(repo)
        first_children = self._children(step["id"], edges)
        if approved_children_only:
            first_children = [
                child_id
                for child_id in first_children
                if steps.get(child_id, {}).get("status") == StepStatus.approved
            ]
        units: set[str] = set()
        stack = list(first_children)
        seen: set[str] = set()
        while stack:
            current = stack.pop()
            if current in seen:
                continue
            seen.add(current)
            current_step = steps.get(current)
            if current_step and current_step.get("unit_id"):
                units.add(current_step["unit_id"])
            stack.extend(self._children(current, edges))
        return units

    def _requests_for_units(
        self,
        repo: Repository,
        unit_ids: set[str],
        *,
        include_review: bool,
    ) -> list[dict]:
        result = []
        for request in repo.load_all("requests"):
            if request.get("unit_id") not in unit_ids:
                continue
            if request.get("status") in {RequestStatus.draft, RequestStatus.cancelled}:
                continue
            if not include_review and request.get("status") not in FINAL_REQUEST_STATUSES:
                continue
            if not include_review and not request.get("frozen"):
                continue
            result.append(request)
        return result

    def _requests_for_step(self, repo: Repository, step: dict) -> list[dict]:
        is_leaf = step.get("unit_id") is not None
        unit_ids = self._descendant_unit_ids(
            repo,
            step,
            approved_children_only=not is_leaf,
        )
        return self._requests_for_units(repo, unit_ids, include_review=is_leaf)

    @staticmethod
    def _log_order(item: dict) -> tuple[str, int]:
        return (str(item.get("created_at") or ""), int(item.get("id") or 0))

    def _direct_child_for_request(
        self,
        repo: Repository,
        step: dict,
        request_id: str,
    ) -> str | None:
        request = repo.get_by_id("requests", request_id)
        if not request or step.get("unit_id") is not None:
            return None
        for child_id in self._children(step["id"], self._edges(repo)):
            child = repo.get_by_id("steps", child_id)
            if child and request.get("unit_id") in self._descendant_unit_ids(
                repo,
                child,
                approved_children_only=False,
            ):
                return child_id
        return None

    def _request_step_state(
        self,
        repo: Repository,
        step: dict,
        request_id: str,
    ) -> dict:
        """Derive per-request progress from the immutable route events.

        The graph intentionally has no step-request table.  Delivery and review
        records in the request log are the source of truth for an individual
        request on a shared approval step.
        """
        request = repo.get_by_id("requests", request_id)
        if not request:
            return {"status": StepStatus.waiting, "child_step_id": None}
        if request.get("fixed"):
            return {
                "status": StepStatus.closed,
                "child_step_id": self._direct_child_for_request(repo, step, request_id),
            }
        if step.get("unit_id") is not None:
            return {"status": step.get("status", StepStatus.waiting), "child_step_id": None}

        child_step_id = self._direct_child_for_request(repo, step, request_id)
        if not child_step_id:
            return {"status": StepStatus.waiting, "child_step_id": None}
        logs = [
            item
            for item in repo.load_all("req_logs")
            if item.get("req_id") == request_id
        ]
        delivered = [
            item
            for item in logs
            if (item.get("log") or {}).get("action") == "approval_request_forwarded"
            and (item.get("log") or {}).get("step_id") == child_step_id
        ]
        if not delivered:
            return {"status": StepStatus.waiting, "child_step_id": child_step_id}
        last_delivery = max(delivered, key=self._log_order)
        returned = [
            item
            for item in logs
            if (item.get("log") or {}).get("action") == "approval_request_returned"
            and (item.get("log") or {}).get("step_id") == step["id"]
        ]
        if returned and self._log_order(max(returned, key=self._log_order)) > self._log_order(last_delivery):
            return {"status": StepStatus.waiting, "child_step_id": child_step_id}
        reviewed = [
            item
            for item in logs
            if (item.get("log") or {}).get("action") == "approval_request_step_approved"
            and (item.get("log") or {}).get("step_id") == step["id"]
        ]
        if reviewed and self._log_order(max(reviewed, key=self._log_order)) > self._log_order(last_delivery):
            return {"status": StepStatus.approved, "child_step_id": child_step_id}
        return {"status": StepStatus.on_approval, "child_step_id": child_step_id}

    def _package_requests(self, repo: Repository, step: dict) -> list[dict]:
        """All already reviewed-and-frozen requests expected by a shared step."""
        return self._requests_for_units(
            repo,
            self._descendant_unit_ids(repo, step, approved_children_only=False),
            include_review=False,
        )

    def _can_forward_step_package(self, repo: Repository, step: dict) -> bool:
        if step.get("unit_id") is not None or step["id"] in self._root_ids(repo):
            return False
        requests = self._package_requests(repo, step)
        return bool(requests) and all(
            self._request_step_state(repo, step, request["id"])["status"] == StepStatus.approved
            for request in requests
        )

    def list_step_requests(self, user: dict, step_id: str) -> list[dict]:
        step = get_required(self.repo, "steps", step_id)
        self._require_step_view(user, step)
        units = {item["id"]: item for item in self.repo.load_all("units")}
        items = self.repo.load_all("req_items")
        result = []
        seen: set[str] = set()
        unit_ids = self._descendant_unit_ids(
            self.repo,
            step,
            approved_children_only=False,
        )
        for request in self._requests_for_units(self.repo, unit_ids, include_review=True):
            if request["id"] in seen:
                continue
            seen.add(request["id"])
            request_items = [
                item
                for item in items
                if item.get("request_id") == request["id"] and item.get("status") != ItemStatus.deleted
            ]
            result.append(
                {
                    **request,
                    "unit": units.get(request.get("unit_id")),
                    "items_count": len(request_items),
                    "reviewed_items_count": sum(
                        item.get("status") != ItemStatus.on_review for item in request_items
                    ),
                }
            )
        return result

    def step_dashboard(self, user: dict, step_id: str) -> dict:
        requests = self.list_step_requests(user, step_id)
        units = {item["id"]: item for item in self.repo.load_all("units")}
        by_unit: dict[str, dict] = {}
        for request in requests:
            unit_id = request["unit_id"]
            row = by_unit.setdefault(
                unit_id,
                {
                    "unit_id": unit_id,
                    "name": units.get(unit_id, {}).get("name", unit_id),
                    "planned": 0.0,
                    "approved": 0.0,
                    "requests_count": 0,
                },
            )
            row["planned"] += float(request.get("sum_plan") or 0)
            row["approved"] += float(request.get("sum_fact") or 0)
            row["requests_count"] += 1
        return {
            "step_id": step_id,
            "totals": {
                "planned": sum(float(item.get("sum_plan") or 0) for item in requests),
                "approved": sum(float(item.get("sum_fact") or 0) for item in requests),
                "requests_count": len(requests),
                "fixed_requests_count": sum(bool(item.get("fixed")) for item in requests),
            },
            "by_unit": sorted(by_unit.values(), key=lambda item: item["name"]),
        }

    def _require_assignee_action(self, repo: Repository, user: dict, step: dict) -> None:
        permissions = PermissionService(repo)
        permissions.require_step_assignee(user, step)
        if step.get("unit_id") is not None:
            permissions.require_economist_unit_access(user, step["unit_id"])
        elif step["id"] in self._root_ids(repo):
            permissions.require_zgd_root_step_access(user, step)
        else:
            permissions.require_approver_step_access(user, step)

    def _open_ready_parents(
        self,
        repo: Repository,
        user: dict,
        child_step_id: str,
        event_id: str,
        request_ids: list[str],
    ) -> None:
        steps = self._steps(repo)
        for parent_id in self._parents(child_step_id, self._edges(repo)):
            parent = repo.lock_by_id("steps", parent_id) or steps[parent_id]
            if parent.get("status") == StepStatus.on_approval:
                updated = parent
            else:
                updated = repo.update("steps", parent_id, {"status": StepStatus.on_approval})
                self._step_log(
                    repo,
                    user,
                    updated,
                    "step_opened",
                    event_id,
                    changes={
                        "status": {
                            "from": parent.get("status"),
                            "to": StepStatus.on_approval,
                        }
                    },
                    trigger="child_step_forwarded",
                    trigger_step_id=child_step_id,
                    request_ids=request_ids,
                )
            for request_id in request_ids:
                self._request_log(
                    repo,
                    user,
                    request_id,
                    "approval_step_opened",
                    event_id,
                    step_id=parent_id,
                    child_step_id=child_step_id,
                )

    def _close_graph(
        self,
        repo: Repository,
        user: dict,
        root: dict,
        event_id: str,
    ) -> dict:
        route_step_ids = self._route_step_ids(repo, root["id"])
        steps = [
            step
            for step_id, step in self._steps(repo).items()
            if step_id in route_step_ids
        ]
        if any(step.get("status") == StepStatus.on_revision for step in steps):
            raise HTTPException(status_code=409, detail="В графе есть шаги на доработке")
        final_requests = self._requests_for_step(repo, root)
        if not final_requests:
            raise HTTPException(status_code=400, detail="В финальной области нет согласованных заявок")
        for request in final_requests:
            if request.get("status") not in FINAL_REQUEST_STATUSES or not request.get("frozen"):
                raise HTTPException(status_code=409, detail="Не все заявки готовы к финальной фиксации")

        approved_root = repo.update("steps", root["id"], {"status": StepStatus.approved})
        self._step_log(
            repo,
            user,
            approved_root,
            "step_approved",
            event_id,
            changes={
                "status": {
                    "from": root.get("status"),
                    "to": StepStatus.approved,
                }
            },
            request_ids=[item["id"] for item in final_requests],
        )
        for old_step in steps:
            current_status = (
                StepStatus.approved if old_step["id"] == root["id"] else old_step.get("status")
            )
            closed = repo.update("steps", old_step["id"], {"status": StepStatus.closed})
            self._step_log(
                repo,
                user,
                closed,
                "approval_graph_closed",
                event_id,
                changes={
                    "status": {
                        "from": current_status,
                        "to": StepStatus.closed,
                    }
                },
                root_step_id=root["id"],
            )
        for request in final_requests:
            updated = repo.update(
                "requests",
                request["id"],
                {"fixed": True, "frozen": True},
            )
            self._request_log(
                repo,
                user,
                request["id"],
                "approval_graph_closed",
                event_id,
                changes={
                    "fixed": {"from": request.get("fixed", False), "to": True},
                    "frozen": {"from": request.get("frozen", False), "to": True},
                },
                root_step_id=root["id"],
            )
        sync_annual_budgets(repo)
        return repo.get_by_id("steps", root["id"]) or approved_root

    def approve_step(self, user: dict, step_id: str) -> dict:
        with self.repo.transaction() as repo:
            step = repo.lock_by_id("steps", step_id)
            if not step:
                raise HTTPException(status_code=404, detail="Шаг не найден")
            self._require_assignee_action(repo, user, step)
            is_leaf = step.get("unit_id") is not None
            if is_leaf and step.get("status") != StepStatus.on_approval:
                raise HTTPException(status_code=409, detail="Шаг не находится на согласовании")
            if step_id in self._root_ids(repo):
                raise HTTPException(
                    status_code=409,
                    detail="ЗГД фиксирует каждую поступившую заявку из её карточки",
                )

            if not is_leaf and not self._can_forward_step_package(repo, step):
                raise HTTPException(
                    status_code=409,
                    detail="Нельзя передать пакет: не все заявки поступили на шаг или согласованы",
                )

            event_id = self._event_id()

            requests = self._requests_for_step(repo, step) if is_leaf else self._package_requests(repo, step)
            if not requests:
                raise HTTPException(status_code=400, detail="Для шага нет заявок, готовых к передаче")
            if is_leaf:
                request_ids = {item["id"] for item in requests}
                active_items = [
                    item
                    for item in repo.load_all("req_items")
                    if item.get("request_id") in request_ids and item.get("status") != ItemStatus.deleted
                ]
                if any(item.get("status") == ItemStatus.on_review for item in active_items):
                    raise HTTPException(status_code=409, detail="Не все строки заявок рассмотрены")
            if any(
                request.get("status") not in FINAL_REQUEST_STATUSES or not request.get("frozen")
                for request in requests
            ):
                raise HTTPException(
                    status_code=409,
                    detail="Экономист должен завершить проверку и заморозить все заявки",
                )

            updated = repo.update("steps", step_id, {"status": StepStatus.approved})
            request_ids = [request["id"] for request in requests]
            self._step_log(
                repo,
                user,
                updated,
                "step_approved",
                event_id,
                changes={
                    "status": {
                        "from": step.get("status"),
                        "to": StepStatus.approved,
                    }
                },
                request_ids=request_ids,
            )
            for request_id in request_ids:
                self._request_log(
                    repo,
                    user,
                    request_id,
                    "approval_request_forwarded",
                    event_id,
                    step_id=step_id,
                )
            self._open_ready_parents(repo, user, step_id, event_id, request_ids)
            return self._public_steps(repo, [updated])[0]

    def approve_request_at_step(self, user: dict, step_id: str, request_id: str) -> dict:
        """Record an individual review without advancing the whole step package."""
        with self.repo.transaction() as repo:
            step = repo.lock_by_id("steps", step_id)
            request = repo.lock_by_id("requests", request_id)
            if not step or not request:
                raise HTTPException(status_code=404, detail="Шаг или заявка не найдены")
            self._require_assignee_action(repo, user, step)
            if step.get("unit_id") is not None:
                raise HTTPException(
                    status_code=400,
                    detail="Экономист передаёт заявки на следующий шаг одним пакетом",
                )

            state = self._request_step_state(repo, step, request_id)
            if state["status"] != StepStatus.on_approval:
                raise HTTPException(status_code=409, detail="Заявка не поступила на этот шаг или уже обработана")
            if request.get("status") not in FINAL_REQUEST_STATUSES or not request.get("frozen"):
                raise HTTPException(status_code=409, detail="Заявка должна быть проверена экономистом и заморожена")

            event_id = self._event_id()
            if step_id in self._root_ids(repo):
                updated_request = repo.update(
                    "requests",
                    request_id,
                    {"fixed": True, "frozen": True},
                )
                action = "approval_request_fixed"
                changes = {
                    "fixed": {"from": request.get("fixed", False), "to": True},
                    "frozen": {"from": request.get("frozen", False), "to": True},
                }
            else:
                updated_request = request
                action = "approval_request_step_approved"
                changes = {}

            self._step_log(
                repo,
                user,
                step,
                action,
                event_id,
                changes=changes,
                request_ids=[request_id],
            )
            self._request_log(
                repo,
                user,
                request_id,
                action,
                event_id,
                step_id=step_id,
                changes=changes,
            )
            if step_id in self._root_ids(repo):
                sync_annual_budgets(repo)
            public_step = self._public_steps(repo, [step])[0]
            public_step["request_status"] = (
                StepStatus.closed if updated_request.get("fixed") else StepStatus.approved
            )
            return public_step

    def _invalidate_ancestors(
        self,
        repo: Repository,
        user: dict,
        step_id: str,
        event_id: str,
    ) -> None:
        edges = self._edges(repo)
        stack = self._parents(step_id, edges)
        seen: set[str] = set()
        while stack:
            ancestor_id = stack.pop()
            if ancestor_id in seen:
                continue
            seen.add(ancestor_id)
            ancestor = repo.lock_by_id("steps", ancestor_id)
            if ancestor and ancestor.get("status") not in {StepStatus.waiting, StepStatus.closed}:
                updated = repo.update("steps", ancestor_id, {"status": StepStatus.waiting})
                self._step_log(
                    repo,
                    user,
                    updated,
                    "step_status_changed",
                    event_id,
                    changes={
                        "status": {
                            "from": ancestor.get("status"),
                            "to": StepStatus.waiting,
                        }
                    },
                    trigger="child_step_returned",
                    trigger_step_id=step_id,
                )
            stack.extend(self._parents(ancestor_id, edges))

    def _return_from_leaf(
        self,
        repo: Repository,
        user: dict,
        step: dict,
        request_ids: list[str],
        comment: str,
        event_id: str,
    ) -> dict:
        if not request_ids:
            raise HTTPException(status_code=400, detail="Выберите заявки для возврата сотруднику")
        available = {item["id"]: item for item in self._requests_for_step(repo, step)}
        if any(request_id not in available for request_id in request_ids):
            raise HTTPException(status_code=403, detail="Заявка не входит в область листового шага")
        for request_id in dict.fromkeys(request_ids):
            request = repo.lock_by_id("requests", request_id)
            if not request:
                raise HTTPException(status_code=404, detail="Заявка не найдена")
            if request.get("fixed"):
                raise HTTPException(status_code=409, detail="Финальную заявку нельзя вернуть")
            for item in repo.load_all("req_items"):
                if item.get("request_id") == request_id and item.get("status") != ItemStatus.deleted:
                    repo.update(
                        "req_items",
                        item["id"],
                        {"status": ItemStatus.on_review, "sum_fact": 0},
                    )
            repo.update(
                "requests",
                request_id,
                {"status": RequestStatus.draft, "frozen": False, "sum_fact": 0},
            )
            self._request_log(
                repo,
                user,
                request_id,
                "approval_request_returned_to_employee",
                event_id,
                comment=comment,
                step_id=step["id"],
                changes={
                    "status": {
                        "from": request.get("status"),
                        "to": RequestStatus.draft,
                    },
                    "frozen": {
                        "from": request.get("frozen"),
                        "to": False,
                    },
                },
            )
        previous_status = step.get("status")
        updated = (
            repo.update("steps", step["id"], {"status": StepStatus.on_revision})
            if previous_status != StepStatus.on_revision
            else step
        )
        self._step_log(
            repo,
            user,
            updated,
            "step_returned",
            event_id,
            changes={
                "status": {
                    "from": previous_status,
                    "to": StepStatus.on_revision,
                }
            },
            comment=comment,
            request_ids=list(dict.fromkeys(request_ids)),
        )
        self._invalidate_ancestors(repo, user, step["id"], event_id)
        sync_annual_budgets(repo)
        return updated

    def return_requests(self, user: dict, step_id: str, payload: dict) -> dict:
        comment = (payload.get("comment") or "").strip()
        if not comment:
            raise HTTPException(status_code=400, detail="Комментарий при возврате обязателен")
        with self.repo.transaction() as repo:
            step = repo.lock_by_id("steps", step_id)
            if not step:
                raise HTTPException(status_code=404, detail="Шаг не найден")
            self._require_assignee_action(repo, user, step)
            if step.get("unit_id") is not None and step.get("status") not in {StepStatus.on_approval, StepStatus.on_revision}:
                raise HTTPException(status_code=409, detail="Шаг нельзя вернуть в текущем состоянии")
            event_id = self._event_id()
            if step.get("unit_id") is not None:
                updated = self._return_from_leaf(
                    repo,
                    user,
                    step,
                    payload.get("request_ids") or [],
                    comment,
                    event_id,
                )
                return self._public_steps(repo, [updated])[0]

            targets = payload.get("targets") or []
            if not targets:
                raise HTTPException(status_code=400, detail="Выберите непосредственную дочернюю ветку")
            edges = self._edges(repo)
            child_ids = set(self._children(step_id, edges))
            selected_requests: dict[str, str] = {}
            changed_children: dict[str, dict] = {}
            for target in targets:
                child_id = target["child_step_id"]
                if child_id not in child_ids:
                    raise HTTPException(status_code=400, detail="Выбранный шаг не является непосредственным дочерним")
                child = repo.lock_by_id("steps", child_id)
                if not child:
                    raise HTTPException(status_code=404, detail="Дочерний шаг не найден")
                unit_ids = self._descendant_unit_ids(
                    repo,
                    child,
                    approved_children_only=False,
                )
                available_ids = {
                    request["id"]
                    for request in self._requests_for_units(
                        repo,
                        unit_ids,
                        include_review=False,
                    )
                }
                for request_id in target.get("request_ids") or []:
                    if request_id not in available_ids:
                        raise HTTPException(status_code=403, detail="Заявка не входит в выбранную ветку")
                    request_state = self._request_step_state(repo, step, request_id)
                    if request_state["status"] not in {StepStatus.on_approval, StepStatus.approved}:
                        raise HTTPException(status_code=409, detail="Заявка не поступила на текущий шаг")
                    if request_id in selected_requests and selected_requests[request_id] != child_id:
                        raise HTTPException(status_code=400, detail="Заявка выбрана в нескольких ветках")
                    selected_requests[request_id] = child_id
                if not target.get("request_ids"):
                    raise HTTPException(status_code=400, detail="В каждой ветке выберите заявки")
                previous = child.get("status")
                changed = (
                    repo.update("steps", child_id, {"status": StepStatus.on_revision})
                    if previous != StepStatus.on_revision
                    else child
                )
                changed_children[child_id] = changed
                self._step_log(
                    repo,
                    user,
                    changed,
                    "step_status_changed",
                    event_id,
                    changes={
                        "status": {
                            "from": previous,
                            "to": StepStatus.on_revision,
                        }
                    },
                    comment=comment,
                    trigger="parent_step_returned",
                    trigger_step_id=step_id,
                    request_ids=target["request_ids"],
                )

            previous_status = step.get("status")
            updated = (
                repo.update("steps", step_id, {"status": StepStatus.on_revision})
                if previous_status != StepStatus.on_revision
                else step
            )
            self._step_log(
                repo,
                user,
                updated,
                "step_returned",
                event_id,
                changes={
                    "status": {
                        "from": previous_status,
                        "to": StepStatus.on_revision,
                    }
                },
                comment=comment,
                targets=targets,
                request_ids=list(selected_requests),
            )
            for request_id, child_id in selected_requests.items():
                self._request_log(
                    repo,
                    user,
                    request_id,
                    "approval_request_returned",
                    event_id,
                    comment=comment,
                    step_id=step_id,
                    child_step_id=child_id,
                )
            self._invalidate_ancestors(repo, user, step_id, event_id)
            return self._public_steps(repo, [updated])[0]

    def open_leaf_for_request(
        self,
        user: dict,
        unit_id: str,
        request_id: str,
        *,
        repo: Repository | None = None,
    ) -> None:
        def apply(transaction_repo: Repository) -> None:
            request = get_required(transaction_repo, "requests", request_id)
            economist_id = request.get("economist_id")
            economist = get_required(transaction_repo, "users", economist_id) if economist_id else None
            if not economist or economist.get("role") != "economist":
                raise HTTPException(status_code=400, detail="Для первого шага требуется назначенный экономист")
            step = next(
                (
                    item
                    for item in transaction_repo.load_all("steps")
                    if item.get("unit_id") == unit_id
                ),
                None,
            )
            event_id = self._event_id()
            if not step:
                created = transaction_repo.create(
                    "steps",
                    {
                        "user_id": economist_id,
                        "unit_id": unit_id,
                        "status": StepStatus.on_approval,
                    },
                )
                self._step_log(
                    transaction_repo,
                    user,
                    created,
                    "step_created",
                    event_id,
                    changes={
                        "user_id": {"from": None, "to": economist_id},
                        "unit_id": {"from": None, "to": unit_id},
                        "status": {"from": None, "to": StepStatus.on_approval},
                    },
                    trigger="request_submitted",
                    request_ids=[request_id],
                    created_automatically=True,
                )
                self._request_log(
                    transaction_repo,
                    user,
                    request_id,
                    "approval_leaf_created",
                    event_id,
                    step_id=created["id"],
                )
                self._invalidate_ancestors(transaction_repo, user, created["id"], event_id)
                return
            locked = transaction_repo.lock_by_id("steps", step["id"]) or step
            if locked.get("status") == StepStatus.closed:
                raise HTTPException(status_code=409, detail="Граф согласования уже закрыт")
            if locked.get("user_id") != economist_id:
                reassigned = transaction_repo.update("steps", locked["id"], {"user_id": economist_id})
                self._step_log(
                    transaction_repo,
                    user,
                    reassigned,
                    "step_assignee_changed",
                    event_id,
                    changes={"user_id": {"from": locked.get("user_id"), "to": economist_id}},
                    trigger="request_submitted",
                )
                locked = reassigned
            if locked.get("status") == StepStatus.on_approval:
                return
            updated = transaction_repo.update(
                "steps",
                locked["id"],
                {"status": StepStatus.on_approval},
            )
            self._step_log(
                transaction_repo,
                user,
                updated,
                "step_reopened",
                event_id,
                changes={
                    "status": {
                        "from": locked.get("status"),
                        "to": StepStatus.on_approval,
                    }
                },
                request_ids=[request_id],
            )
            self._request_log(
                transaction_repo,
                user,
                request_id,
                "approval_leaf_opened",
                event_id,
                step_id=locked["id"],
            )
            self._invalidate_ancestors(transaction_repo, user, locked["id"], event_id)

        if repo is not None:
            apply(repo)
            return
        with self.repo.transaction() as transaction_repo:
            apply(transaction_repo)

    # Per-request workflow state -------------------------------------------------
    #
    # A route step is shared by many requests.  Its configuration must therefore
    # not double as the state of a particular request: otherwise one request can
    # make every other request on the same step look approved.  These methods
    # keep the configured graph in ``steps`` and the actual progress in
    # ``request_step_states``.

    def _request_route(self, repo: Repository, unit_id: str) -> list[dict]:
        steps = self._steps(repo)
        leaf = next((step for step in steps.values() if step.get("unit_id") == unit_id), None)
        if not leaf:
            return []
        route = [leaf]
        seen = {leaf["id"]}
        current_id = leaf["id"]
        while True:
            parents = self._parents(current_id, self._edges(repo))
            if not parents:
                break
            parent_id = parents[0]
            if parent_id in seen or parent_id not in steps:
                raise HTTPException(status_code=400, detail="Маршрут согласования содержит цикл")
            route.append(steps[parent_id])
            seen.add(parent_id)
            current_id = parent_id
        return route

    @staticmethod
    def _state_row(repo: Repository, request_id: str, step_id: str) -> dict | None:
        return next(
            (
                item
                for item in repo.load_all("request_step_states")
                if item.get("request_id") == request_id and item.get("step_id") == step_id
            ),
            None,
        )

    def _request_step_state(self, repo: Repository, step: dict, request_id: str) -> dict:
        state = self._state_row(repo, request_id, step["id"])
        request = repo.get_by_id("requests", request_id)
        if request and request.get("status") == RequestStatus.draft and step.get("unit_id") is not None:
            return {
                "status": StepStatus.on_revision,
                "child_step_id": self._direct_child_for_request(repo, step, request_id),
            }
        return {
            "status": state.get("status", StepStatus.waiting) if state else StepStatus.waiting,
            "child_step_id": self._direct_child_for_request(repo, step, request_id),
        }

    def _set_request_step_state(
        self,
        repo: Repository,
        request_id: str,
        step_id: str,
        status: StepStatus,
    ) -> tuple[dict, StepStatus | None]:
        existing = self._state_row(repo, request_id, step_id)
        if existing:
            before = existing.get("status", StepStatus.waiting)
            if before == status:
                return existing, before
            repo.update_where(
                "request_step_states",
                {"request_id": request_id, "step_id": step_id},
                {"status": status},
            )
            return {**existing, "status": status}, before
        created = repo.create(
            "request_step_states",
            {"request_id": request_id, "step_id": step_id, "status": status},
        )
        return created, None

    def _log_request_step_status(
        self,
        repo: Repository,
        user: dict,
        request_id: str,
        step: dict,
        before: StepStatus | None,
        after: StepStatus,
        event_id: str,
        *,
        action: str,
        comment: str | None = None,
        **extra,
    ) -> None:
        if before == after:
            return
        changes = {"status": {"from": before, "to": after}}
        self._step_log(
            repo,
            user,
            step,
            action,
            event_id,
            changes=changes,
            comment=comment,
            request_ids=[request_id],
            **extra,
        )
        self._request_log(
            repo,
            user,
            request_id,
            action,
            event_id,
            changes=changes,
            comment=comment,
            step_id=step["id"],
            **extra,
        )

    def _active_step_ids_for_user(self, user: dict) -> set[str]:
        active_statuses = {StepStatus.on_approval, StepStatus.on_revision}
        step_ids = {
            state["step_id"]
            for state in self.repo.load_all("request_step_states")
            if state.get("status") in active_statuses
        }
        allowed_steps = [step for step in self.repo.load_all("steps") if step["id"] in step_ids]
        if user.get("role") == "economist":
            unit_ids = self.permissions.economist_editable_module_ids(user["id"])
            return {
                step["id"]
                for step in allowed_steps
                if step.get("user_id") == user["id"] and step.get("unit_id") in unit_ids
            }
        if user.get("role") == "approver":
            return {
                step["id"]
                for step in allowed_steps
                if step.get("user_id") == user["id"] and step.get("unit_id") is None
            }
        if user.get("role") == "zgd":
            roots = set(self._root_ids(self.repo))
            return {
                step["id"]
                for step in allowed_steps
                if step.get("user_id") == user["id"] and step["id"] in roots
            }
        return set()

    def my_steps(self, user: dict) -> list[dict]:
        if user.get("role") not in {"economist", "approver", "zgd"}:
            raise HTTPException(status_code=403, detail="У пользователя нет шагов согласования")
        active_ids = self._active_step_ids_for_user(user)
        steps = [step for step in self.repo.load_all("steps") if step["id"] in active_ids]
        public_steps = self._public_steps(self.repo, steps)
        states = self.repo.load_all("request_step_states")
        for step in public_steps:
            step_states = [
                state.get("status")
                for state in states
                if state.get("step_id") == step["id"]
                and state.get("status") in {StepStatus.on_approval, StepStatus.on_revision}
            ]
            step["status"] = (
                StepStatus.on_revision
                if StepStatus.on_revision in step_states
                else StepStatus.on_approval
            )
            step["active_requests_count"] = len(step_states)
        return public_steps

    def request_approval_step(self, user: dict, request_id: str) -> dict | None:
        request = get_required(self.repo, "requests", request_id)
        for step in self._request_route(self.repo, request["unit_id"]):
            if step.get("user_id") != user.get("id"):
                continue
            try:
                self._require_assignee_action(self.repo, user, step)
            except HTTPException:
                continue
            state = self._request_step_state(self.repo, step, request_id)
            request_status = state["status"]
            if request_status not in {StepStatus.on_approval, StepStatus.on_revision}:
                continue
            public_step = self._public_steps(self.repo, [step])[0]
            public_step["request_status"] = request_status
            is_final = step["id"] in self._root_ids(self.repo)
            return {
                "step": public_step,
                "child_step_id": state["child_step_id"],
                "request_status": request_status,
                "can_approve": request_status == StepStatus.on_approval and step.get("unit_id") is None,
                "can_forward": False,
                "can_return": request_status in {StepStatus.on_approval, StepStatus.on_revision},
                "is_final": is_final,
            }
        return None

    def request_approval_route(self, user: dict, request_id: str) -> list[dict]:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_view_request(user, request)
        route = self._request_route(self.repo, request["unit_id"])
        if not route:
            return []
        users = {item["id"]: item for item in self.repo.load_all("users")}
        profiles = {item["user_id"]: item for item in self.repo.load_all("profiles")}
        logs_by_step: dict[str, list[dict]] = {step["id"]: [] for step in route}
        for item in self.repo.load_all("step_logs"):
            log = item.get("log") or {}
            step_id = item.get("step_id")
            if step_id not in logs_by_step or request_id not in (log.get("request_ids") or []):
                continue
            actor = users.get(item.get("user_id"))
            logs_by_step[step_id].append(
                {
                    **item,
                    "user": {
                        "id": actor["id"],
                        "login": actor["login"],
                        "role": actor["role"],
                        "profile": profiles.get(actor["id"]),
                    } if actor else None,
                }
            )
        public = {item["id"]: item for item in self._public_steps(self.repo, route)}
        return [
            {
                "step": {
                    **public[step["id"]],
                    "request_status": self._request_step_state(self.repo, step, request_id)["status"],
                },
                "logs": sorted(logs_by_step[step["id"]], key=self._log_order, reverse=True),
            }
            for step in route
        ]

    def list_step_requests(self, user: dict, step_id: str) -> list[dict]:
        step = get_required(self.repo, "steps", step_id)
        self._require_step_view(user, step)
        active_statuses = {StepStatus.on_approval, StepStatus.on_revision}
        state_by_request = {
            state["request_id"]: state["status"]
            for state in self.repo.load_all("request_step_states")
            if state.get("step_id") == step_id and state.get("status") in active_statuses
        }
        units = {item["id"]: item for item in self.repo.load_all("units")}
        items = self.repo.load_all("req_items")
        result = []
        for request_id, approval_status in state_by_request.items():
            request = self.repo.get_by_id("requests", request_id)
            if not request:
                continue
            request_items = [
                item for item in items
                if item.get("request_id") == request_id and item.get("status") != ItemStatus.deleted
            ]
            result.append(
                {
                    **request,
                    "unit": units.get(request.get("unit_id")),
                    "approval_status": approval_status,
                    "items_count": len(request_items),
                    "reviewed_items_count": sum(
                        item.get("status") != ItemStatus.on_review for item in request_items
                    ),
                }
            )
        return sorted(result, key=lambda item: str(item.get("created_at") or ""), reverse=True)

    def step_dashboard(self, user: dict, step_id: str) -> dict:
        requests = self.list_step_requests(user, step_id)
        units = {item["id"]: item for item in self.repo.load_all("units")}
        by_unit: dict[str, dict] = {}
        for request in requests:
            unit_id = request["unit_id"]
            row = by_unit.setdefault(
                unit_id,
                {"unit_id": unit_id, "name": units.get(unit_id, {}).get("name", unit_id), "planned": 0.0, "approved": 0.0, "requests_count": 0},
            )
            row["planned"] += float(request.get("sum_plan") or 0)
            row["approved"] += float(request.get("sum_fact") or 0)
            row["requests_count"] += 1
        return {
            "step_id": step_id,
            "totals": {
                "planned": sum(float(item.get("sum_plan") or 0) for item in requests),
                "approved": sum(float(item.get("sum_fact") or 0) for item in requests),
                "requests_count": len(requests),
                "fixed_requests_count": sum(bool(item.get("fixed")) for item in requests),
            },
            "by_unit": sorted(by_unit.values(), key=lambda item: item["name"]),
        }

    def _open_parent_for_request(
        self,
        repo: Repository,
        user: dict,
        request_id: str,
        child_step: dict,
        event_id: str,
    ) -> None:
        parent_ids = self._parents(child_step["id"], self._edges(repo))
        if not parent_ids:
            return
        parent = get_required(repo, "steps", parent_ids[0])
        _, before = self._set_request_step_state(
            repo, request_id, parent["id"], StepStatus.on_approval,
        )
        self._log_request_step_status(
            repo,
            user,
            request_id,
            parent,
            before,
            StepStatus.on_approval,
            event_id,
            action="approval_step_opened",
            child_step_id=child_step["id"],
        )

    def _advance_request(
        self,
        repo: Repository,
        user: dict,
        request: dict,
        step: dict,
        event_id: str,
    ) -> dict:
        state = self._request_step_state(repo, step, request["id"])
        if state["status"] != StepStatus.on_approval:
            raise HTTPException(status_code=409, detail="Заявка не находится на согласовании этого шага")
        is_final = step["id"] in self._root_ids(repo)
        next_status = StepStatus.closed if is_final else StepStatus.approved
        _, before = self._set_request_step_state(repo, request["id"], step["id"], next_status)
        action = "approval_request_fixed" if is_final else "approval_request_forwarded"
        self._log_request_step_status(
            repo,
            user,
            request["id"],
            step,
            before,
            next_status,
            event_id,
            action=action,
        )
        if is_final:
            updated = repo.update("requests", request["id"], {"fixed": True, "frozen": True})
            self._request_log(
                repo,
                user,
                request["id"],
                "fixed",
                event_id,
                changes={"fixed": {"from": request.get("fixed", False), "to": True}},
                step_id=step["id"],
            )
            sync_annual_budgets(repo)
            return updated
        self._open_parent_for_request(repo, user, request["id"], step, event_id)
        return request

    def complete_economist_review(
        self,
        user: dict,
        request_id: str,
        *,
        repo: Repository | None = None,
    ) -> None:
        def apply(transaction_repo: Repository) -> None:
            request = get_required(transaction_repo, "requests", request_id)
            route = self._request_route(transaction_repo, request["unit_id"])
            if not route:
                raise HTTPException(status_code=400, detail="Для подразделения не настроен маршрут согласования")
            leaf = route[0]
            self._require_assignee_action(transaction_repo, user, leaf)
            self._advance_request(transaction_repo, user, request, leaf, self._event_id())

        if repo is not None:
            apply(repo)
            return
        with self.repo.transaction() as transaction_repo:
            apply(transaction_repo)

    def resume_economist_review(self, user: dict, request_id: str) -> dict:
        """Unfreeze a returned or locally completed request for economist revision."""
        with self.repo.transaction() as repo:
            request = get_required(repo, "requests", request_id)
            route = self._request_route(repo, request["unit_id"])
            if not route:
                raise HTTPException(status_code=400, detail="Для подразделения не настроен маршрут согласования")
            leaf = route[0]
            self._require_assignee_action(repo, user, leaf)
            state = self._request_step_state(repo, leaf, request_id)
            can_resume_returned = state["status"] == StepStatus.on_revision
            can_undo_local_review = state["status"] == StepStatus.approved
            if not (can_resume_returned or can_undo_local_review) or not request.get("frozen"):
                raise HTTPException(status_code=409, detail="Заявка не ожидает доработки экономистом")
            if request.get("fixed"):
                raise HTTPException(status_code=409, detail="Окончательно зафиксированную заявку нельзя разморозить")

            event_id = self._event_id()
            updated = repo.update(
                "requests",
                request_id,
                {"status": RequestStatus.on_review, "frozen": False},
            )
            _, before = self._set_request_step_state(repo, request_id, leaf["id"], StepStatus.on_approval)
            self._log_request_step_status(
                repo,
                user,
                request_id,
                leaf,
                before,
                StepStatus.on_approval,
                event_id,
                action="approval_economist_review_resumed",
            )
            self._request_log(
                repo,
                user,
                request_id,
                "reopened",
                event_id,
                changes={
                    "status": {"from": request.get("status"), "to": updated.get("status")},
                    "frozen": {"from": request.get("frozen"), "to": False},
                },
                step_id=leaf["id"],
            )
            return updated

    def approve_request_at_step(self, user: dict, step_id: str, request_id: str) -> dict:
        with self.repo.transaction() as repo:
            step = get_required(repo, "steps", step_id)
            request = get_required(repo, "requests", request_id)
            self._require_assignee_action(repo, user, step)
            if step.get("unit_id") is not None:
                raise HTTPException(status_code=400, detail="Экономист согласует заявку после проверки её строк")
            if request.get("status") not in FINAL_REQUEST_STATUSES or not request.get("frozen"):
                raise HTTPException(status_code=409, detail="Заявка должна быть согласована и заморожена экономистом")
            updated_request = self._advance_request(repo, user, request, step, self._event_id())
            public_step = self._public_steps(repo, [step])[0]
            public_step["request_status"] = self._request_step_state(repo, step, request_id)["status"]
            public_step["request"] = updated_request
            return public_step

    def approve_step(self, user: dict, step_id: str) -> dict:
        step = get_required(self.repo, "steps", step_id)
        self._require_assignee_action(self.repo, user, step)
        raise HTTPException(
            status_code=400,
            detail="Согласуйте конкретную заявку из списка задач или её карточки",
        )

    def _send_to_employee(
        self,
        repo: Repository,
        user: dict,
        request: dict,
        leaf: dict,
        comment: str,
        event_id: str,
    ) -> None:
        if request.get("fixed"):
            raise HTTPException(status_code=409, detail="Окончательно зафиксированную заявку нельзя вернуть")
        for item in repo.load_all("req_items"):
            if item.get("request_id") == request["id"] and item.get("status") != ItemStatus.deleted:
                repo.update("req_items", item["id"], {"status": ItemStatus.on_review, "sum_fact": 0})
        updated = repo.update(
            "requests",
            request["id"],
            {"status": RequestStatus.draft, "frozen": False, "sum_fact": 0},
        )
        _, before = self._set_request_step_state(
            repo, request["id"], leaf["id"], StepStatus.on_revision,
        )
        self._log_request_step_status(
            repo,
            user,
            request["id"],
            leaf,
            before,
            StepStatus.on_revision,
            event_id,
            action="approval_request_returned_to_employee",
            comment=comment,
        )
        for ancestor in self._request_route(repo, request["unit_id"])[1:]:
            self._set_request_step_state(repo, request["id"], ancestor["id"], StepStatus.waiting)
        self._request_log(
            repo,
            user,
            request["id"],
            "reopened",
            event_id,
            comment=comment,
            changes={
                "status": {"from": request.get("status"), "to": updated.get("status")},
                "frozen": {"from": request.get("frozen"), "to": False},
            },
            step_id=leaf["id"],
        )
        if self.chat_service:
            self.chat_service.send_return_to_employee_system_message(user, request["id"], comment, repo=repo)
        sync_annual_budgets(repo)

    def return_requests(self, user: dict, step_id: str, payload: dict) -> dict:
        comment = (payload.get("comment") or "").strip()
        if not comment:
            raise HTTPException(status_code=400, detail="Комментарий при возврате обязателен")
        with self.repo.transaction() as repo:
            step = get_required(repo, "steps", step_id)
            self._require_assignee_action(repo, user, step)
            event_id = self._event_id()
            if step.get("unit_id") is not None:
                request_ids = list(dict.fromkeys(payload.get("request_ids") or []))
                if not request_ids:
                    raise HTTPException(status_code=400, detail="Выберите заявку для возврата сотруднику")
                for request_id in request_ids:
                    request = get_required(repo, "requests", request_id)
                    state = self._request_step_state(repo, step, request_id)
                    if state["status"] not in {StepStatus.on_approval, StepStatus.on_revision}:
                        raise HTTPException(status_code=409, detail="Заявка не ожидает действий экономиста")
                    self._send_to_employee(repo, user, request, step, comment, event_id)
                public_step = self._public_steps(repo, [step])[0]
                public_step["request_status"] = StepStatus.on_revision
                return public_step

            targets = payload.get("targets") or []
            if not targets:
                raise HTTPException(status_code=400, detail="Выберите нижестоящий шаг для возврата")
            child_ids = set(self._children(step_id, self._edges(repo)))
            for target in targets:
                child_id = target.get("child_step_id")
                if child_id not in child_ids:
                    raise HTTPException(status_code=400, detail="Выбранный шаг не является нижестоящим")
                child = get_required(repo, "steps", child_id)
                request_ids = list(dict.fromkeys(target.get("request_ids") or []))
                if not request_ids:
                    raise HTTPException(status_code=400, detail="Выберите заявки для возврата")
                for request_id in request_ids:
                    request = get_required(repo, "requests", request_id)
                    state = self._request_step_state(repo, step, request_id)
                    if state["status"] != StepStatus.on_approval:
                        raise HTTPException(status_code=409, detail="Заявка не находится на согласовании этого шага")
                    if child_id not in {item["id"] for item in self._request_route(repo, request["unit_id"])}:
                        raise HTTPException(status_code=403, detail="Заявка не относится к выбранной ветке")
                    _, child_before = self._set_request_step_state(
                        repo, request_id, child_id, StepStatus.on_revision,
                    )
                    _, step_before = self._set_request_step_state(
                        repo, request_id, step_id, StepStatus.waiting,
                    )
                    self._log_request_step_status(
                        repo,
                        user,
                        request_id,
                        step,
                        step_before,
                        StepStatus.waiting,
                        event_id,
                        action="approval_request_returned",
                        comment=comment,
                        returned_to_step_id=child_id,
                    )
                    self._log_request_step_status(
                        repo,
                        user,
                        request_id,
                        child,
                        child_before,
                        StepStatus.on_revision,
                        event_id,
                        action="approval_request_reopened_for_revision",
                        returned_from_step_id=step_id,
                    )
            public_step = self._public_steps(repo, [step])[0]
            public_step["request_status"] = StepStatus.waiting
            return public_step

    def open_leaf_for_request(
        self,
        user: dict,
        unit_id: str,
        request_id: str,
        *,
        repo: Repository | None = None,
    ) -> None:
        def apply(transaction_repo: Repository) -> None:
            request = get_required(transaction_repo, "requests", request_id)
            economist_id = request.get("economist_id")
            economist = get_required(transaction_repo, "users", economist_id) if economist_id else None
            if not economist or economist.get("role") != "economist":
                raise HTTPException(status_code=400, detail="Для первого шага требуется назначенный экономист")
            leaf = next(
                (item for item in transaction_repo.load_all("steps") if item.get("unit_id") == unit_id),
                None,
            )
            event_id = self._event_id()
            if not leaf:
                leaf = transaction_repo.create(
                    "steps", {"user_id": economist_id, "unit_id": unit_id, "status": StepStatus.waiting},
                )
                self._step_log(
                    transaction_repo,
                    user,
                    leaf,
                    "step_created",
                    event_id,
                    changes={"user_id": {"from": None, "to": economist_id}, "unit_id": {"from": None, "to": unit_id}},
                    request_ids=[request_id],
                    created_automatically=True,
                )
            elif leaf.get("user_id") != economist_id:
                before_user = leaf.get("user_id")
                leaf = transaction_repo.update("steps", leaf["id"], {"user_id": economist_id})
                self._step_log(
                    transaction_repo,
                    user,
                    leaf,
                    "step_assignee_changed",
                    event_id,
                    changes={"user_id": {"from": before_user, "to": economist_id}},
                    request_ids=[request_id],
                )
            route = self._request_route(transaction_repo, unit_id)
            if not route:
                route = [leaf]
            for index, route_step in enumerate(route):
                status = StepStatus.on_approval if index == 0 else StepStatus.waiting
                _, before = self._set_request_step_state(
                    transaction_repo, request_id, route_step["id"], status,
                )
                if index == 0:
                    self._log_request_step_status(
                        transaction_repo,
                        user,
                        request_id,
                        route_step,
                        before,
                        status,
                        event_id,
                        action="approval_step_opened",
                    )

        if repo is not None:
            apply(repo)
            return
        with self.repo.transaction() as transaction_repo:
            apply(transaction_repo)

    def step_logs(
        self,
        user: dict,
        *,
        step_id: str | None = None,
        user_id: str | None = None,
        action: str | None = None,
        date_from: str | None = None,
        date_to: str | None = None,
    ) -> list[dict]:
        if step_id:
            step = get_required(self.repo, "steps", step_id)
            self.permissions.require_step_log_access(user, step)
        else:
            self.permissions.require_admin(user)
        users = {item["id"]: item for item in self.repo.load_all("users")}
        profiles = {item["user_id"]: item for item in self.repo.load_all("profiles")}
        result = []
        for item in self.repo.load_all("step_logs"):
            log = item.get("log") or {}
            created_at = str(item.get("created_at") or "")
            if step_id and item.get("step_id") != step_id and log.get("entity_id") != step_id:
                continue
            if user_id and item.get("user_id") != user_id:
                continue
            if action and log.get("action") != action:
                continue
            if date_from and created_at < date_from:
                continue
            if date_to and created_at > date_to:
                continue
            actor = users.get(item.get("user_id"))
            result.append(
                {
                    **item,
                    "user": (
                        {
                            "id": actor["id"],
                            "login": actor["login"],
                            "role": actor["role"],
                            "profile": profiles.get(actor["id"]),
                        }
                        if actor
                        else None
                    ),
                }
            )
        return sorted(result, key=lambda item: str(item.get("created_at") or ""), reverse=True)

    # Request progress belongs to request_step_states, not to the configured
    # step itself.  A reviewer confirms requests one by one and can transfer
    # them only as one complete packet after every request of the branch has
    # reached and been checked at the current step.
    def _requests_for_route_step(self, repo: Repository, step_id: str) -> list[dict]:
        """Requests currently actionable at a route step, not every request in its history."""
        step = get_required(repo, "steps", step_id)
        result = []
        for request in repo.load_all("requests"):
            if request.get("status") == RequestStatus.cancelled:
                continue
            route = self._request_route(repo, request["unit_id"])
            if not any(route_step["id"] == step_id for route_step in route):
                continue
            status = self._request_step_state(repo, step, request["id"])["status"]
            active_statuses = {StepStatus.on_approval, StepStatus.on_revision} if step.get("unit_id") else {StepStatus.on_approval}
            if status in active_statuses:
                result.append(request)
        return result

    def _request_package(self, repo: Repository, request: dict) -> tuple[str, str]:
        """Parent unit (ЦФО) of a request module — for display only, not package boundaries."""
        units = {item["id"]: item for item in repo.load_all("units")}
        unit = units.get(request.get("unit_id"))
        if not unit:
            return request.get("unit_id", "unknown"), "Неуказанное ЦФО"
        cfo = units.get(unit.get("parent_id")) or unit
        return cfo["id"], cfo.get("name") or "Неуказанное ЦФО"

    def _request_reviewed_at_step(self, repo: Repository, request_id: str, step_id: str) -> bool:
        """Whether the latest request-specific event at a step is its review."""
        relevant = []
        for item in repo.load_all("step_logs"):
            if item.get("step_id") != step_id:
                continue
            log = item.get("log") or {}
            if request_id not in (log.get("request_ids") or []):
                continue
            relevant.append(item)
        if not relevant:
            return False
        latest = max(relevant, key=lambda item: int(item.get("id") or 0))
        return (latest.get("log") or {}).get("action") == "approval_request_step_approved"

    def _step_progress(self, repo: Repository, step: dict) -> tuple[StepStatus, int]:
        """Aggregate the route state for graph display, including completed requests."""
        states = [
            self._request_step_state(repo, step, request["id"])["status"]
            for request in repo.load_all("requests")
            if request.get("status") != RequestStatus.cancelled
            and any(route_step["id"] == step["id"] for route_step in self._request_route(repo, request["unit_id"]))
        ]
        active = [status for status in states if status in {StepStatus.on_approval, StepStatus.on_revision}]
        if StepStatus.on_revision in active:
            return StepStatus.on_revision, len(active)
        if active:
            return StepStatus.on_approval, len(active)
        if StepStatus.approved in states:
            return StepStatus.approved, 0
        if states and all(status == StepStatus.closed for status in states):
            return StepStatus.closed, 0
        return StepStatus.waiting, 0

    def _active_step_ids_for_user(self, user: dict) -> set[str]:
        """Economists see only incoming requests; reviewers and ZGD see their routes."""
        if user.get("role") not in {"economist", "approver", "zgd"}:
            return set()
        result: set[str] = set()
        for step in self.repo.load_all("steps"):
            if step.get("user_id") != user.get("id"):
                continue
            if user.get("role") == "economist":
                if step.get("unit_id") is None:
                    continue
                _, active_count = self._step_progress(self.repo, step)
                if active_count:
                    result.add(step["id"])
                continue
            if step.get("unit_id") is not None:
                continue
            if user.get("role") == "zgd" and step["id"] not in self._root_ids(self.repo):
                continue
            if self._requests_for_route_step(self.repo, step["id"]):
                result.add(step["id"])
        return result

    def my_steps(self, user: dict) -> list[dict]:
        if user.get("role") not in {"economist", "approver", "zgd"}:
            raise HTTPException(status_code=403, detail="У пользователя нет шагов согласования")
        step_ids = self._active_step_ids_for_user(user)
        steps = [step for step in self.repo.load_all("steps") if step["id"] in step_ids]
        public_steps = self._public_steps(self.repo, steps)
        by_id = {step["id"]: step for step in steps}
        for public_step in public_steps:
            status, active_count = self._step_progress(self.repo, by_id[public_step["id"]])
            public_step["status"] = status
            public_step["active_requests_count"] = active_count
        return public_steps

    def list_step_requests(self, user: dict, step_id: str) -> list[dict]:
        step = get_required(self.repo, "steps", step_id)
        self._require_step_view(user, step)
        units = {item["id"]: item for item in self.repo.load_all("units")}
        items = self.repo.load_all("req_items")
        result = []
        for request in self._requests_for_route_step(self.repo, step_id):
            request_items = [
                item
                for item in items
                if item.get("request_id") == request["id"] and item.get("status") != ItemStatus.deleted
            ]
            approval_status = self._request_step_state(self.repo, step, request["id"])["status"]
            result.append(
                {
                    **request,
                    "unit": units.get(request.get("unit_id")),
                    "approval_status": approval_status,
                    "reviewed_at_step": self._request_reviewed_at_step(self.repo, request["id"], step_id),
                    "items_count": len(request_items),
                    "reviewed_items_count": sum(
                        item.get("status") != ItemStatus.on_review for item in request_items
                    ),
                    "package_id": self._request_package(self.repo, request)[0],
                    "package_name": self._request_package(self.repo, request)[1],
                }
            )
        return sorted(result, key=lambda item: str(item.get("created_at") or ""), reverse=True)

    def _advance_request(
        self,
        repo: Repository,
        user: dict,
        request: dict,
        step: dict,
        event_id: str,
    ) -> dict:
        state = self._request_step_state(repo, step, request["id"])
        if state["status"] != StepStatus.on_approval:
            raise HTTPException(status_code=409, detail="Заявка не находится на согласовании этого шага")
        is_final = step["id"] in self._root_ids(repo)
        next_status = StepStatus.closed if is_final else StepStatus.approved
        _, before = self._set_request_step_state(repo, request["id"], step["id"], next_status)
        self._log_request_step_status(
            repo,
            user,
            request["id"],
            step,
            before,
            next_status,
            event_id,
            action="approval_request_fixed" if is_final else "approval_request_forwarded",
        )
        if not is_final:
            self._open_parent_for_request(repo, user, request["id"], step, event_id)
            return request

        for previous_step in self._request_route(repo, request["unit_id"]):
            if previous_step["id"] == step["id"]:
                continue
            self._set_request_step_state(repo, request["id"], previous_step["id"], StepStatus.closed)
        updated = repo.update("requests", request["id"], {"fixed": True, "frozen": True})
        self._request_log(
            repo,
            user,
            request["id"],
            "fixed",
            event_id,
            changes={"fixed": {"from": request.get("fixed", False), "to": True}},
            step_id=step["id"],
        )
        sync_annual_budgets(repo)
        return updated

    def request_approval_step(self, user: dict, request_id: str) -> dict | None:
        request = get_required(self.repo, "requests", request_id)
        for step in self._request_route(self.repo, request["unit_id"]):
            if step.get("user_id") != user.get("id"):
                continue
            try:
                self._require_assignee_action(self.repo, user, step)
            except HTTPException:
                continue
            state = self._request_step_state(self.repo, step, request_id)
            if state["status"] not in {StepStatus.on_approval, StepStatus.on_revision}:
                continue
            public_step = self._public_steps(self.repo, [step])[0]
            public_step["request_status"] = state["status"]
            is_final = step["id"] in self._root_ids(self.repo)
            reviewed = self._request_reviewed_at_step(self.repo, request_id, step["id"])
            step_requests = self._requests_for_route_step(self.repo, step["id"])
            can_forward = (
                step.get("unit_id") is None
                and not is_final
                and reviewed
                and bool(step_requests)
                and all(
                    self._request_step_state(self.repo, step, item["id"])["status"] == StepStatus.on_approval
                    and self._request_reviewed_at_step(self.repo, item["id"], step["id"])
                    for item in step_requests
                )
            )
            return {
                "step": public_step,
                "child_step_id": state["child_step_id"],
                "request_status": state["status"],
                "can_approve": (
                    step.get("unit_id") is None
                    and state["status"] in {StepStatus.on_approval, StepStatus.on_revision}
                    and (is_final or not reviewed)
                ),
                "can_forward": can_forward,
                "package_request_ids": [item["id"] for item in step_requests],
                "can_return": state["status"] in {StepStatus.on_approval, StepStatus.on_revision},
                "is_final": is_final,
            }
        return None

    def approve_request_at_step(self, user: dict, step_id: str, request_id: str) -> dict:
        with self.repo.transaction() as repo:
            step = get_required(repo, "steps", step_id)
            request = get_required(repo, "requests", request_id)
            self._require_assignee_action(repo, user, step)
            if step.get("unit_id") is not None:
                raise HTTPException(status_code=400, detail="Экономист завершает проверку заявки из её карточки")
            state = self._request_step_state(repo, step, request_id)
            if state["status"] not in {StepStatus.on_approval, StepStatus.on_revision}:
                raise HTTPException(status_code=409, detail="Заявка ещё не передана на этот этап согласования")
            if request.get("status") not in FINAL_REQUEST_STATUSES or not request.get("frozen"):
                raise HTTPException(status_code=409, detail="Заявка должна быть проверена и заморожена экономистом")
            event_id = self._event_id()
            if state["status"] == StepStatus.on_revision:
                _, before = self._set_request_step_state(repo, request_id, step_id, StepStatus.on_approval)
                self._log_request_step_status(
                    repo,
                    user,
                    request_id,
                    step,
                    before,
                    StepStatus.on_approval,
                    event_id,
                    action="approval_request_revision_accepted",
                )
            if step_id in self._root_ids(repo):
                updated_request = self._advance_request(repo, user, request, step, event_id)
                public_step = self._public_steps(repo, [step])[0]
                public_step["request_status"] = StepStatus.closed
                public_step["request"] = updated_request
                return public_step
            if self._request_reviewed_at_step(repo, request_id, step_id):
                raise HTTPException(status_code=409, detail="Заявка уже проверена на этом шаге")
            self._step_log(
                repo,
                user,
                step,
                "approval_request_step_approved",
                event_id,
                request_ids=[request_id],
            )
            self._request_log(
                repo,
                user,
                request_id,
                "approval_request_step_approved",
                event_id,
                step_id=step_id,
            )
            public_step = self._public_steps(repo, [step])[0]
            public_step["request_status"] = StepStatus.on_approval
            public_step["request"] = request
            return public_step

    def approve_step(self, user: dict, step_id: str, request_ids: list[str] | None = None) -> dict:
        with self.repo.transaction() as repo:
            step = get_required(repo, "steps", step_id)
            self._require_assignee_action(repo, user, step)
            if step.get("unit_id") is not None:
                raise HTTPException(status_code=400, detail="Экономист завершает и отправляет каждую заявку из её карточки")
            if step_id in self._root_ids(repo):
                raise HTTPException(status_code=400, detail="ЗГД фиксирует каждую поступившую заявку из её карточки")
            requests = self._requests_for_route_step(repo, step_id)
            if not requests:
                raise HTTPException(status_code=400, detail="Для этого шага нет заявок")
            requested_ids = set(request_ids or [])
            if requested_ids:
                selected_requests = [request for request in requests if request["id"] in requested_ids]
                if len(selected_requests) != len(requested_ids):
                    raise HTTPException(status_code=400, detail="В пакет можно включать только заявки текущего шага")
                if {request["id"] for request in requests} != requested_ids:
                    raise HTTPException(
                        status_code=409,
                        detail="В пакет должны входить все заявки, поступившие на этот шаг",
                    )
                requests = selected_requests
            not_delivered = [
                request
                for request in requests
                if self._request_step_state(repo, step, request["id"])["status"] != StepStatus.on_approval
            ]
            if not_delivered:
                raise HTTPException(
                    status_code=409,
                    detail="Нельзя передать пакет: не все заявки маршрута поступили на этот шаг",
                )
            not_reviewed = [
                request
                for request in requests
                if not self._request_reviewed_at_step(repo, request["id"], step_id)
            ]
            if not_reviewed:
                raise HTTPException(
                    status_code=409,
                    detail="Нельзя передать пакет: не все поступившие заявки проверены",
                )
            event_id = self._event_id()
            for request in requests:
                self._advance_request(repo, user, request, step, event_id)
            public_step = self._public_steps(repo, [step])[0]
            public_step["status"] = StepStatus.approved
            public_step["request_ids"] = [request["id"] for request in requests]
            return public_step

    def revoke_final_approval(self, user: dict, request_id: str) -> dict:
        with self.repo.transaction() as repo:
            request = get_required(repo, "requests", request_id)
            if user.get("role") != "zgd":
                raise HTTPException(status_code=403, detail="Отменить финальное согласование может только ЗГД")
            if not request.get("fixed"):
                raise HTTPException(status_code=409, detail="Заявка не была финально согласована")
            route = self._request_route(repo, request["unit_id"])
            final_step = next((step for step in route if step["id"] in self._root_ids(repo) and step.get("user_id") == user.get("id")), None)
            if not final_step:
                raise HTTPException(status_code=403, detail="Заявка не относится к маршруту текущего ЗГД")
            event_id = self._event_id()
            for step in route:
                target_status = StepStatus.on_approval if step["id"] == final_step["id"] else StepStatus.approved
                self._set_request_step_state(repo, request_id, step["id"], target_status)
            updated = repo.update("requests", request_id, {"fixed": False, "frozen": True})
            self._request_log(
                repo,
                user,
                request_id,
                "approval_request_final_revoked",
                event_id,
                changes={"fixed": {"from": True, "to": False}},
                step_id=final_step["id"],
            )
            sync_annual_budgets(repo)
            return updated

    def all_step_logs(self, user: dict, **filters) -> list[dict]:
        self.permissions.require_admin(user)
        return self.step_logs(user, **filters)

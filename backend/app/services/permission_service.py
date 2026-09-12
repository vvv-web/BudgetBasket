from __future__ import annotations

from fastapi import HTTPException

from app.models import RequestStatus
from app.repositories.base import Repository
from app.services.common import cfo_position_current_step_id


class PermissionService:
    def __init__(self, repo: Repository):
        self.repo = repo

    def _units(self) -> dict[str, dict]:
        return {item["id"]: item for item in self.repo.load_all("units")}

    def unit_level(self, unit_id: str) -> int:
        units = self._units()
        level = 1
        current = units.get(unit_id)
        seen: set[str] = set()
        while current and current.get("parent_id") and current["id"] not in seen:
            seen.add(current["id"])
            level += 1
            current = units.get(current["parent_id"])
        return level

    def cfo_for_module(self, module_id: str) -> str | None:
        units = self._units()
        current = units.get(module_id)
        if not current:
            return None
        while current and self.unit_level(current["id"]) > 2:
            current = units.get(current.get("parent_id"))
        return current["id"] if current and self.unit_level(current["id"]) == 2 else None

    def _active_units_for_role(self, user_id: str, role: str, level: int) -> set[str]:
        users = {item["id"]: item for item in self.repo.load_all("users")}
        if users.get(user_id, {}).get("role") != role:
            return set()
        return {
            item["unit_id"]
            for item in self.repo.load_all("units_responsibles")
            if item.get("user_id") == user_id
            and item.get("is_active")
            and self.unit_level(item["unit_id"]) == level
        }

    def employee_module_ids(self, user_id: str) -> set[str]:
        return self._active_units_for_role(user_id, "employee", 3)

    def employee_cfo_ids(self, user_id: str) -> set[str]:
        return self._active_units_for_role(user_id, "employee", 2)

    def economist_cfo_ids(self, user_id: str) -> set[str]:
        return self._active_units_for_role(user_id, "economist", 2)

    def modules_for_cfos(self, cfo_ids: set[str]) -> set[str]:
        units = self._units()
        return {
            unit["id"]
            for unit in units.values()
            if self.cfo_for_module(unit["id"]) in cfo_ids and self.unit_level(unit["id"]) == 3
        }

    # Compatibility helpers used by catalogs, files and exports.
    def economist_editable_module_ids(self, user_id: str) -> set[str]:
        return self.modules_for_cfos(self.economist_cfo_ids(user_id))

    def economist_visible_module_ids(self, user_id: str) -> set[str]:
        return self.economist_editable_module_ids(user_id)

    def economist_visible_department_ids(self, user_id: str) -> set[str]:
        units = self._units()
        result: set[str] = set()
        for cfo_id in self.economist_cfo_ids(user_id):
            cfo = units.get(cfo_id)
            if cfo and cfo.get("parent_id"):
                result.add(cfo["parent_id"])
        return result

    def cfo_responsible_id(self, cfo_id: str) -> str | None:
        users = {item["id"]: item for item in self.repo.load_all("users")}
        matches = [
            item["user_id"]
            for item in self.repo.load_all("units_responsibles")
            if item.get("unit_id") == cfo_id
            and item.get("is_active")
            and users.get(item.get("user_id"), {}).get("role") == "employee"
        ]
        if len(matches) > 1:
            raise HTTPException(status_code=409, detail="Для ЦФО назначено несколько ответственных")
        return matches[0] if matches else None

    def cfo_economist_id(self, cfo_id: str) -> str | None:
        users = {item["id"]: item for item in self.repo.load_all("users")}
        matches = [
            item["user_id"]
            for item in self.repo.load_all("units_responsibles")
            if item.get("unit_id") == cfo_id
            and item.get("is_active")
            and users.get(item.get("user_id"), {}).get("role") == "economist"
        ]
        if len(matches) > 1:
            raise HTTPException(status_code=409, detail="Для ЦФО назначено несколько экономистов")
        return matches[0] if matches else None

    @staticmethod
    def require_admin(user: dict) -> None:
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Действие доступно только администратору")

    def require_employee_unit_access(self, user: dict, unit_id: str) -> None:
        if user.get("role") != "employee" or unit_id not in self.employee_module_ids(user["id"]):
            raise HTTPException(status_code=403, detail="Нет доступа ответственного модуля")

    def require_cfo_request_access(self, user: dict, request: dict) -> None:
        cfo_id = self.cfo_for_module(request["unit_id"])
        if (
            user.get("role") != "employee"
            or cfo_id not in self.employee_cfo_ids(user["id"])
        ):
            raise HTTPException(status_code=403, detail="Заявка относится к другому ЦФО")

    def require_economist_position_access(self, user: dict, position: dict) -> None:
        if (
            user.get("role") != "economist"
            or position.get("cfo_unit_id") not in self.economist_cfo_ids(user["id"])
        ):
            raise HTTPException(status_code=403, detail="Позиция относится к другому ЦФО")

    def require_step_assignee(self, user: dict, step: dict) -> None:
        if step.get("unit_id"):
            if user.get("role") != "economist":
                raise HTTPException(status_code=403, detail="Листовой шаг доступен экономисту ЦФО")
            if step["unit_id"] not in self.economist_cfo_ids(user["id"]):
                raise HTTPException(status_code=403, detail="Шаг относится к другому ЦФО")
            return
        if step.get("user_id") != user.get("id"):
            raise HTTPException(status_code=403, detail="Шаг назначен другому пользователю")

    def require_step_log_access(self, user: dict, step: dict) -> None:
        if user.get("role") == "admin":
            return
        self.require_step_assignee(user, step)

    def visible_position_ids(self, user: dict) -> set[str] | None:
        if hasattr(self.repo, "visible_position_ids"):
            return self.repo.visible_position_ids(user, self)
        positions = self.repo.load_all("cfo_positions")
        if user.get("role") == "admin":
            return None
        if user.get("role") == "economist":
            cfo_ids = self.economist_cfo_ids(user["id"])
            return {item["id"] for item in positions if item.get("cfo_unit_id") in cfo_ids}
        if user.get("role") == "employee":
            cfo_ids = self.employee_cfo_ids(user["id"])
            module_ids = self.employee_module_ids(user["id"])
            own_position_ids = {
                item.get("cfo_position_id")
                for item in self.repo.load_all("req_items")
                if item.get("request_id") in {
                    request["id"]
                    for request in self.repo.load_all("requests")
                    if request.get("unit_id") in module_ids
                }
            }
            return {
                item["id"]
                for item in positions
                if item.get("cfo_unit_id") in cfo_ids or item["id"] in own_position_ids
            }
        if user.get("role") in {"approver", "zgd"}:
            step_ids = {
                step["id"]
                for step in self.repo.load_all("steps")
                if step.get("user_id") == user["id"]
            }
            return {
                item["id"]
                for item in positions
                if cfo_position_current_step_id(self.repo, item) in step_ids
                or any(
                    log.get("cfo_position_id") == item["id"] and log.get("step_id") in step_ids
                    for log in self.repo.load_all("cfo_position_logs")
                )
            }
        return set()

    def require_view_position(self, user: dict, position: dict) -> None:
        visible = self.visible_position_ids(user)
        if visible is not None and position["id"] not in visible:
            raise HTTPException(status_code=403, detail="Нет доступа к позиции ЦФО")

    def visible_request_ids(self, user: dict) -> set[str] | None:
        if hasattr(self.repo, "visible_request_ids"):
            return self.repo.visible_request_ids(user, self)
        requests = self.repo.load_all("requests")
        if user.get("role") == "admin":
            return None
        if user.get("role") == "employee":
            modules = self.employee_module_ids(user["id"])
            cfo_modules = self.modules_for_cfos(self.employee_cfo_ids(user["id"]))
            return {
                item["id"]
                for item in requests
                # A CFO responsible sees a module's request only after the
                # author submits it for CFO review. Drafts remain local to
                # employees responsible for that specific module.
                if item.get("unit_id") in modules
                or (
                    item.get("unit_id") in cfo_modules
                    and item.get("status") != RequestStatus.draft
                )
            }
        if user.get("role") == "economist":
            modules = self.modules_for_cfos(self.economist_cfo_ids(user["id"]))
            return {
                item["id"]
                for item in requests
                if item.get("unit_id") in modules
                and item.get("status") != RequestStatus.draft
            }
        position_ids = self.visible_position_ids(user) or set()
        request_ids = {
            item["request_id"]
            for item in self.repo.load_all("req_items")
            if item.get("cfo_position_id") in position_ids
        }
        return request_ids

    def can_view_request(self, user: dict, request: dict) -> bool:
        visible = self.visible_request_ids(user)
        return visible is None or request["id"] in visible

    def require_view_request(self, user: dict, request: dict) -> None:
        if not self.can_view_request(user, request):
            raise HTTPException(status_code=403, detail="Нет доступа к заявке")

    def require_employee_edit_request(self, user: dict, request: dict) -> None:
        self.require_employee_unit_access(user, request["unit_id"])
        if request.get("status") != RequestStatus.draft:
            raise HTTPException(status_code=409, detail="Редактировать можно только черновик")

    def require_request_delete_request(self, user: dict, request: dict) -> None:
        self.require_employee_edit_request(user, request)

    def require_employee_cancel_request(self, user: dict, request: dict) -> None:
        self.require_employee_unit_access(user, request["unit_id"])
        if request.get("status") != RequestStatus.on_review:
            raise HTTPException(
                status_code=409,
                detail="Отменить можно только уже отправленную заявку",
            )

    def require_employee_upload_file(self, user: dict, request: dict) -> None:
        self.require_employee_edit_request(user, request)

    def require_request_line_edit(self, user: dict, request: dict, *, review_fields: bool) -> None:
        if review_fields:
            self.require_cfo_request_access(user, request)
            if request.get("status") != RequestStatus.on_review:
                raise HTTPException(status_code=409, detail="Заявка не находится на проверке ЦФО")
            return
        self.require_employee_edit_request(user, request)

    # Removed request-level workflow methods retained as explicit failures for
    # callers that have not yet been migrated.
    @staticmethod
    def require_request_unfrozen(request: dict) -> None:
        return

    def require_employee_withdraw_request(self, user: dict, request: dict) -> None:
        raise HTTPException(status_code=410, detail="Отзыв заменен отменой черновика")

    def require_economist_unit_access(self, user: dict, unit_id: str) -> None:
        cfo_id = self.cfo_for_module(unit_id)
        if user.get("role") != "economist" or cfo_id not in self.economist_cfo_ids(user["id"]):
            raise HTTPException(status_code=403, detail="Нет доступа экономиста к ЦФО")

    def require_economist_review_request(self, user: dict, request: dict) -> None:
        raise HTTPException(
            status_code=410,
            detail="Экономист работает с позициями ЦФО, а не с исходной заявкой",
        )

    require_economist_edit_request = require_economist_review_request
    require_budget_control_access = require_economist_review_request

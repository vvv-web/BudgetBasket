from fastapi import HTTPException

from app.models import RequestStatus
from app.repositories.base import Repository


class PermissionService:
    def __init__(self, repo: Repository):
        self.repo = repo

    def _child_modules(self, unit_id: str) -> set[str]:
        units = {item["id"]: item for item in self.repo.load_all("units")}
        child_ids = {item["id"] for item in self.repo.load_all("units") if item.get("parent_id") == unit_id}
        result = set(child_ids)
        stack = list(child_ids)
        while stack:
            current_id = stack.pop()
            for item in units.values():
                if item.get("parent_id") == current_id and item["id"] not in result:
                    result.add(item["id"])
                    stack.append(item["id"])
        return {item_id for item_id in result if units.get(item_id, {}).get("parent_id")}

    def employee_module_ids(self, user_id: str) -> set[str]:
        assigned_units = {
            item["unit_id"]
            for item in self.repo.load_all("units_responsibles")
            if item.get("user_id") == user_id and item.get("is_active")
        }
        module_ids = set(assigned_units)
        for unit_id in assigned_units:
            unit = self.repo.get_by_id("units", unit_id)
            if not unit:
                continue
            if not unit.get("parent_id"):
                module_ids.update(self._child_modules(unit_id))
        return module_ids

    def economist_editable_module_ids(self, user_id: str) -> set[str]:
        """Modules where the economist may make review decisions."""
        assigned_units = {
            item["unit_id"]
            for item in self.repo.load_all("units_responsibles")
            if item.get("user_id") == user_id and item.get("is_active")
        }
        units = {item["id"]: item for item in self.repo.load_all("units")}
        assigned_modules = {
            unit_id for unit_id in assigned_units if units.get(unit_id, {}).get("parent_id")
        }
        request_units = {request["unit_id"] for request in self.repo.load_all("requests") if request.get("economist_id") == user_id}
        return assigned_modules | request_units

    def economist_visible_module_ids(self, user_id: str) -> set[str]:
        """Modules visible to an economist, including read-only department scopes."""
        assigned_units = {
            item["unit_id"]
            for item in self.repo.load_all("units_responsibles")
            if item.get("user_id") == user_id and item.get("is_active")
        }
        units = {item["id"]: item for item in self.repo.load_all("units")}
        department_ids = {
            unit_id for unit_id in assigned_units if unit_id in units and not units[unit_id].get("parent_id")
        }
        visible_modules = self.economist_editable_module_ids(user_id)
        for department_id in department_ids:
            visible_modules.update(self._child_modules(department_id))
        return visible_modules

    def economist_visible_department_ids(self, user_id: str) -> set[str]:
        """Root departments represented by the economist's assignments."""
        units = {item["id"]: item for item in self.repo.load_all("units")}
        assigned_units = {
            item["unit_id"]
            for item in self.repo.load_all("units_responsibles")
            if item.get("user_id") == user_id and item.get("is_active")
        }
        department_ids = {
            unit_id for unit_id in assigned_units if unit_id in units and not units[unit_id].get("parent_id")
        }
        for module_id in self.economist_editable_module_ids(user_id):
            current = module_id
            seen: set[str] = set()
            while current and current not in seen:
                seen.add(current)
                unit = units.get(current)
                if not unit or not unit.get("parent_id"):
                    if unit:
                        department_ids.add(current)
                    break
                current = unit["parent_id"]
        return department_ids

    @staticmethod
    def require_admin(user: dict) -> None:
        if user.get("role") != "admin":
            raise HTTPException(status_code=403, detail="Действие доступно только администратору")

    def require_employee_unit_access(self, user: dict, unit_id: str) -> None:
        if user.get("role") != "employee" or unit_id not in self.employee_module_ids(user["id"]):
            raise HTTPException(status_code=403, detail="Нет доступа сотрудника к подразделению")

    def require_economist_unit_access(self, user: dict, unit_id: str) -> None:
        if user.get("role") != "economist" or unit_id not in self.economist_editable_module_ids(user["id"]):
            raise HTTPException(status_code=403, detail="Нет доступа экономиста к подразделению")

    def _step_unit_ids(self, step_id: str, *, approved_children_only: bool = False) -> set[str]:
        if hasattr(self.repo, "descendant_step_unit_ids"):
            return self.repo.descendant_step_unit_ids(
                step_id,
                approved_children_only=approved_children_only,
            )
        steps = {item["id"]: item for item in self.repo.load_all("steps")}
        children: dict[str, set[str]] = {}
        for edge in self.repo.load_all("step_edges"):
            children.setdefault(edge["parent_step_id"], set()).add(edge["child_step_id"])
        result: set[str] = set()
        if approved_children_only and not steps.get(step_id, {}).get("unit_id"):
            stack = [
                child_id
                for child_id in children.get(step_id, set())
                if steps.get(child_id, {}).get("status") == "approved"
            ]
        else:
            stack = [step_id]
        seen: set[str] = set()
        while stack:
            current = stack.pop()
            if current in seen:
                continue
            seen.add(current)
            step = steps.get(current)
            if step and step.get("unit_id"):
                result.add(step["unit_id"])
            stack.extend(children.get(current, set()))
        return result

    def require_step_assignee(self, user: dict, step: dict) -> None:
        if step.get("user_id") != user.get("id"):
            raise HTTPException(status_code=403, detail="Шаг назначен другому пользователю")

    def require_approver_step_access(self, user: dict, step: dict) -> None:
        if user.get("role") != "approver":
            raise HTTPException(status_code=403, detail="Шаг доступен только согласующему")
        self.require_step_assignee(user, step)
        if step.get("unit_id") is not None:
            raise HTTPException(status_code=403, detail="Согласующему недоступен листовой шаг")

    def require_zgd_root_step_access(self, user: dict, step: dict) -> None:
        if user.get("role") != "zgd":
            raise HTTPException(status_code=403, detail="Финальный шаг доступен только ЗГД")
        self.require_step_assignee(user, step)
        if any(edge.get("child_step_id") == step.get("id") for edge in self.repo.load_all("step_edges")):
            raise HTTPException(status_code=403, detail="ЗГД может работать только с корневым шагом")

    def require_step_log_access(self, user: dict, step: dict) -> None:
        if user.get("role") == "admin":
            return
        self.require_step_assignee(user, step)
        if user.get("role") not in {"economist", "approver", "zgd"}:
            raise HTTPException(status_code=403, detail="Нет доступа к истории шага")

    def require_request_line_edit(self, user: dict, request: dict, *, review_fields: bool) -> None:
        if review_fields:
            self.require_economist_review_request(user, request)
        else:
            self.require_employee_edit_request(user, request)

    def require_request_review(self, user: dict, request: dict) -> None:
        self.require_economist_review_request(user, request)

    def require_chat_access(self, user: dict, request: dict, *, write: bool) -> None:
        if user.get("role") == "admin":
            if write:
                raise HTTPException(status_code=403, detail="Администратор не может писать в чат")
            return
        if user.get("role") == "employee":
            self.require_employee_unit_access(user, request["unit_id"])
            return
        if user.get("role") == "economist":
            self.require_economist_unit_access(user, request["unit_id"])
            return
        raise HTTPException(status_code=403, detail="Рабочий чат доступен только сотруднику и экономисту")

    def visible_request_ids(self, user: dict) -> set[str] | None:
        if user["role"] == "admin":
            return None
        if user["role"] == "employee":
            module_ids = self.employee_module_ids(user["id"])
            return {request["id"] for request in self.repo.load_all("requests") if request.get("unit_id") in module_ids}

        if user["role"] in {"approver", "zgd"}:
            step_ids = {
                step["id"]
                for step in self.repo.load_all("steps")
                if step.get("user_id") == user["id"]
            }
            module_ids: set[str] = set()
            for step_id in step_ids:
                module_ids.update(self._step_unit_ids(step_id, approved_children_only=False))
            return {
                request["id"]
                for request in self.repo.load_all("requests")
                if request.get("unit_id") in module_ids
                and request.get("status") not in {RequestStatus.draft, RequestStatus.cancelled}
            }
        if user["role"] != "economist":
            return set()
        module_ids = self.economist_visible_module_ids(user["id"])
        return {
            request["id"]
            for request in self.repo.load_all("requests")
            if request.get("status") != RequestStatus.draft and request.get("unit_id") in module_ids
        }

    def can_view_request(self, user: dict, request: dict) -> bool:
        if user["role"] == "admin":
            return True
        if user["role"] == "employee":
            return request.get("unit_id") in self.employee_module_ids(user["id"])
        if user["role"] == "economist":
            return request.get("status") != RequestStatus.draft and request.get("unit_id") in self.economist_visible_module_ids(user["id"])
        if user["role"] in {"approver", "zgd"}:
            visible = self.visible_request_ids(user)
            return request.get("id") in (visible or set())
        return False

    def require_view_request(self, user: dict, request: dict) -> None:
        if not self.can_view_request(user, request):
            raise HTTPException(status_code=403, detail="Нет доступа к заявке")

    @staticmethod
    def require_request_unfrozen(request: dict) -> None:
        if request.get("fixed"):
            raise HTTPException(status_code=400, detail="Заявка окончательно зафиксирована ЗГД")
        if request.get("frozen"):
            raise HTTPException(status_code=400, detail="Заявка заморожена экономистом")

    def require_employee_edit_request(self, user: dict, request: dict) -> None:
        self.require_request_unfrozen(request)
        if user["role"] != "employee" or request.get("unit_id") not in self.employee_module_ids(user["id"]):
            raise HTTPException(status_code=403, detail="Изменять заявку может только ответственный сотрудник")
        if request.get("status") != RequestStatus.draft:
            raise HTTPException(status_code=400, detail="Заявка недоступна для редактирования")

    def require_request_delete_request(self, user: dict, request: dict) -> None:
        self.require_request_unfrozen(request)
        if request.get("status") != RequestStatus.draft:
            raise HTTPException(status_code=400, detail="Заявку можно удалить только в статусе черновика")
        if user["role"] != "employee" or request.get("unit_id") not in self.employee_module_ids(user["id"]):
            raise HTTPException(status_code=403, detail="Удалить заявку может только ответственный сотрудник")

    def require_employee_cancel_request(self, user: dict, request: dict) -> None:
        self.require_request_unfrozen(request)
        if user["role"] != "employee" or request.get("unit_id") not in self.employee_module_ids(user["id"]):
            raise HTTPException(status_code=403, detail="Отменить заявку может только ответственный сотрудник")
        if request.get("status") != RequestStatus.draft:
            raise HTTPException(status_code=400, detail="Заявку можно отменить только в черновике")

    def require_employee_withdraw_request(self, user: dict, request: dict) -> None:
        raise HTTPException(
            status_code=400,
            detail="Отзыв заявки не используется: отмена доступна только в черновике, возврат выполняется по маршруту",
        )

    def require_employee_upload_file(self, user: dict, request: dict) -> None:
        self.require_request_unfrozen(request)
        if user["role"] != "employee" or request.get("unit_id") not in self.employee_module_ids(user["id"]):
            raise HTTPException(status_code=403, detail="Загружать файлы может только ответственный сотрудник")
        if request.get("status") != RequestStatus.draft:
            raise HTTPException(status_code=400, detail="Файлы можно загружать только в черновик заявки")

    def require_economist_edit_request(self, user: dict, request: dict) -> None:
        self.require_request_unfrozen(request)
        self.require_economist_review_request(user, request)

    def require_budget_control_access(self, user: dict, request: dict) -> None:
        self.require_economist_review_request(user, request)

    def require_economist_review_request(self, user: dict, request: dict) -> None:
        if user["role"] != "economist":
            raise HTTPException(status_code=403, detail="Рассматривать заявку может только экономист")
        if request.get("unit_id") not in self.economist_editable_module_ids(user["id"]):
            raise HTTPException(status_code=403, detail="Рассматривать заявку может только назначенный экономист")

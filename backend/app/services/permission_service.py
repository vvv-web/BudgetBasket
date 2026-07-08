from fastapi import HTTPException

from app.repositories.json_repository import JsonRepository


class PermissionService:
    def __init__(self, repo: JsonRepository):
        self.repo = repo

    def employee_module_ids(self, user_id: str) -> set[str]:
        return {
            item["unit_id"]
            for item in self.repo.load_all("units_responsibles")
            if item.get("user_id") == user_id and item.get("is_active")
        }

    def economist_module_ids(self, user_id: str) -> set[str]:
        return {request["unit_id"] for request in self.repo.load_all("requests") if request.get("economist_id") == user_id}

    def visible_request_ids(self, user: dict) -> set[str] | None:
        if user["role"] == "admin":
            return None
        if user["role"] == "employee":
            module_ids = self.employee_module_ids(user["id"])
        else:
            module_ids = self.economist_module_ids(user["id"])
        return {request["id"] for request in self.repo.load_all("requests") if request.get("unit_id") in module_ids}

    def can_view_request(self, user: dict, request: dict) -> bool:
        if user["role"] == "admin":
            return True
        if user["role"] == "employee":
            return request.get("unit_id") in self.employee_module_ids(user["id"])
        if user["role"] == "economist":
            return request.get("unit_id") in self.economist_module_ids(user["id"])
        return False

    def require_view_request(self, user: dict, request: dict) -> None:
        if not self.can_view_request(user, request):
            raise HTTPException(status_code=403, detail="Нет доступа к заявке")

    def require_employee_edit_request(self, user: dict, request: dict) -> None:
        if user["role"] != "employee" or request.get("unit_id") not in self.employee_module_ids(user["id"]):
            raise HTTPException(status_code=403, detail="Редактировать заявку может только ответственный сотрудник модуля")
        if request.get("status") not in {"draft", "unfrozen"}:
            raise HTTPException(status_code=400, detail="Заявка недоступна для редактирования")

    def require_economist_review_request(self, user: dict, request: dict) -> None:
        if user["role"] != "economist" or request.get("unit_id") not in self.economist_module_ids(user["id"]):
            raise HTTPException(status_code=403, detail="Проверять заявку может только закрепленный экономист")

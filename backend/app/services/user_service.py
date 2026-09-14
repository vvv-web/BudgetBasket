from fastapi import HTTPException

from app.models import validate_email, validate_phone, validate_required_text
from app.repositories.base import Repository
from app.security import hash_password
from app.services.common import public_user, require_role


EMPTY_PROFILE = {"name": "", "second_name": "", "last_name": "", "phone": "", "email": "", "max_link": ""}
PROFILE_FIELDS = ("name", "second_name", "last_name", "phone", "email", "max_link")
USER_FIELDS = ("login", "role")


class UserService:
    def __init__(self, repo: Repository):
        self.repo = repo

    def list_users(self, user: dict) -> list[dict]:
        require_role(user, "admin")
        profiles = {profile["user_id"]: profile for profile in self.repo.load_all("profiles")}
        unit_parents = {unit["id"]: unit.get("parent_id") for unit in self.repo.load_all("units")}
        unit_ids_by_user: dict[str, set[str]] = {}
        for assignment in self.repo.load_all("units_responsibles"):
            if not assignment.get("is_active"):
                continue
            unit_id = assignment["unit_id"]
            user_units = unit_ids_by_user.setdefault(assignment["user_id"], set())
            while unit_id and unit_id not in user_units:
                user_units.add(unit_id)
                unit_id = unit_parents.get(unit_id)
        return [
            {
                **public_user(item),
                "profile": profiles.get(item["id"]),
                "unit_ids": sorted(unit_ids_by_user.get(item["id"], set())),
            }
            for item in self.repo.load_all("users")
        ]

    def create_user(self, current_user: dict, payload: dict) -> dict:
        require_role(current_user, "admin")
        profile_data = {key: (payload.get(key) or "").strip() for key in PROFILE_FIELDS}
        try:
            profile_data["name"] = validate_required_text(profile_data["name"])
            profile_data["last_name"] = validate_required_text(profile_data["last_name"])
            profile_data["email"] = validate_email(profile_data["email"])
            profile_data["phone"] = validate_phone(profile_data["phone"])
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
        user_payload = {key: payload[key] for key in ("login", "role")}
        user_payload["password"] = hash_password(payload["password"])
        with self.repo.transaction() as repo:
            if any(item["login"] == payload["login"] for item in repo.load_all("users")):
                raise HTTPException(status_code=400, detail="Логин уже используется")
            user = repo.create("users", user_payload)
            profile = {"user_id": user["id"], **EMPTY_PROFILE, **profile_data}
            repo.insert("profiles", profile)
        return {**public_user(user), "profile": profile}

    def update_user(self, current_user: dict, user_id: str, patch: dict) -> dict:
        require_role(current_user, "admin")
        users = self.repo.load_all("users")
        target = next((item for item in users if item["id"] == user_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="Запись не найдена")

        user_patch = {key: patch[key] for key in USER_FIELDS if key in patch}
        if "login" in user_patch and any(item["login"] == user_patch["login"] and item["id"] != user_id for item in users):
            raise HTTPException(status_code=400, detail="Логин уже используется")
        if "password" in patch:
            user_patch["password"] = hash_password(patch["password"])

        updated_user = self.repo.update("users", user_id, user_patch) if user_patch else target

        profile_patch = {key: (patch[key] or "").strip() for key in PROFILE_FIELDS if key in patch}
        profiles = self.repo.load_all("profiles")
        profile = next((item for item in profiles if item["user_id"] == user_id), None)
        if profile_patch:
            if profile:
                self.repo.update_where("profiles", {"user_id": user_id}, profile_patch)
                profile = {**profile, **profile_patch}
            else:
                profile = {"user_id": user_id, **EMPTY_PROFILE, **profile_patch}
                self.repo.insert("profiles", profile)
        return {**public_user(updated_user), "profile": profile}

    def delete_user(self, current_user: dict, user_id: str) -> None:
        require_role(current_user, "admin")
        if current_user["id"] == user_id:
            raise HTTPException(status_code=400, detail="Нельзя удалить текущего пользователя")
        user = self.repo.get_by_id("users", user_id)
        if not user:
            raise HTTPException(status_code=404, detail="Запись не найдена")
        assigned_units = {
            item["unit_id"]
            for item in self.repo.load_all("units_responsibles")
            if item.get("user_id") == user_id and item.get("is_active")
        }
        position_ids = {
            item["id"] for item in self.repo.load_all("cfo_positions")
            if item.get("cfo_unit_id") in assigned_units
        }
        dependencies: list[str] = []
        if any(step.get("user_id") == user_id for step in self.repo.load_all("steps")):
            dependencies.append("назначен в шагах согласования")
        if assigned_units:
            dependencies.append("назначен ответственным за подразделение")
        if any(
            item.get("cfo_position_id") in position_ids
            and (item.get("frozen") or item.get("fixed"))
            for item in self.repo.load_all("req_items")
        ):
            dependencies.append("имеет замороженные или зафиксированные позиции ЦФО")
        if dependencies:
            raise HTTPException(status_code=409, detail=f"Нельзя удалить: пользователь {', '.join(dependencies)}")
        self.repo.delete_where("profiles", {"user_id": user_id})
        self.repo.delete_where("units_responsibles", {"user_id": user_id})
        self.repo.delete("users", user_id)

    def get_profile(self, current_user: dict, user_id: str) -> dict:
        if current_user["role"] != "admin" and current_user["id"] != user_id:
            raise HTTPException(status_code=403, detail="Нет доступа к профилю")
        profile = next((item for item in self.repo.load_all("profiles") if item["user_id"] == user_id), None)
        if not profile:
            raise HTTPException(status_code=404, detail="Профиль не найден")
        return profile

    def update_profile(self, current_user: dict, user_id: str, patch: dict) -> dict:
        if current_user["role"] != "admin" and current_user["id"] != user_id:
            raise HTTPException(status_code=403, detail="Нет доступа к профилю")
        profiles = self.repo.load_all("profiles")
        for profile in profiles:
            if profile["user_id"] == user_id:
                self.repo.update_where("profiles", {"user_id": user_id}, patch)
                return {**profile, **patch}
        profile = {"user_id": user_id, **EMPTY_PROFILE, **patch}
        return self.repo.insert("profiles", profile)

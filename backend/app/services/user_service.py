from fastapi import HTTPException

from app.repositories.json_repository import JsonRepository
from app.services.common import public_user, require_role


EMPTY_PROFILE = {"name": "", "second_name": "", "last_name": "", "phone": "", "email": "", "max_link": ""}


class UserService:
    def __init__(self, repo: JsonRepository):
        self.repo = repo

    def list_users(self, user: dict) -> list[dict]:
        require_role(user, "admin")
        profiles = {profile["user_id"]: profile for profile in self.repo.load_all("profiles")}
        return [{**public_user(item), "profile": profiles.get(item["id"])} for item in self.repo.load_all("users")]

    def create_user(self, current_user: dict, payload: dict) -> dict:
        require_role(current_user, "admin")
        if any(item["login"] == payload["login"] for item in self.repo.load_all("users")):
            raise HTTPException(status_code=400, detail="Логин уже используется")
        profile_fields = ("name", "second_name", "last_name", "phone", "email", "max_link")
        profile_data = {key: (payload.get(key) or "").strip() for key in profile_fields}
        user_payload = {key: payload[key] for key in ("login", "password", "role")}
        user = self.repo.create("users", user_payload)
        profile = {"user_id": user["id"], **EMPTY_PROFILE, **profile_data}
        self.repo.save_all("profiles", [*self.repo.load_all("profiles"), profile])
        return {**public_user(user), "profile": profile}

    def update_user(self, current_user: dict, user_id: str, patch: dict) -> dict:
        require_role(current_user, "admin")
        return public_user(self.repo.update("users", user_id, patch))

    def get_profile(self, current_user: dict, user_id: str) -> dict:
        if current_user["role"] != "admin" and current_user["id"] != user_id:
            raise HTTPException(status_code=403, detail="Нет доступа к профилю")
        profile = next((item for item in self.repo.load_all("profiles") if item["user_id"] == user_id), None)
        if not profile:
            raise HTTPException(status_code=404, detail="Профиль не найден")
        return profile

    def update_profile(self, current_user: dict, user_id: str, patch: dict) -> dict:
        require_role(current_user, "admin")
        profiles = self.repo.load_all("profiles")
        for index, profile in enumerate(profiles):
            if profile["user_id"] == user_id:
                profiles[index] = {**profile, **patch}
                self.repo.save_all("profiles", profiles)
                return profiles[index]
        profile = {"user_id": user_id, **EMPTY_PROFILE, **patch}
        profiles.append(profile)
        self.repo.save_all("profiles", profiles)
        return profile

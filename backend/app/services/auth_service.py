from uuid import uuid4

from fastapi import HTTPException

from app.repositories.base import Repository
from app.repositories.queries import find_rows, find_one
from app.security import hash_password, needs_rehash, verify_password
from app.services.common import public_user


class AuthService:
    def __init__(self, repo: Repository):
        self.repo = repo
        self.tokens: dict[str, str] = {}

    def _direct_unit_ids(self, user_id: str) -> list[str]:
        return sorted(
            {
                item["unit_id"]
                for item in find_rows(self.repo, "units_responsibles", filters={"user_id": user_id, "is_active": True})
                if item.get("user_id") == user_id and item.get("is_active")
            }
        )

    def _session_user(self, user: dict) -> dict:
        profile = find_one(self.repo, "profiles", user_id=user["id"])
        return {
            **public_user(user),
            "unit_ids": self._direct_unit_ids(user["id"]),
            "profile": profile,
        }

    def login(self, login: str, password: str) -> dict:
        user = find_one(self.repo, "users", login=login)
        if not user or not verify_password(password, user.get("password", "")):
            raise HTTPException(status_code=401, detail="Неверный логин или пароль")
        if needs_rehash(user.get("password", "")):
            self.repo.update("users", user["id"], {"password": hash_password(password)})
        token = f"mock-{uuid4()}"
        self.tokens[token] = user["id"]
        return {"access_token": token, "user": self._session_user(user)}

    def me(self, token: str | None) -> dict:
        if not token or token not in self.tokens:
            raise HTTPException(status_code=401, detail="Требуется авторизация")
        user = self.repo.get_by_id("users", self.tokens[token])
        if not user:
            raise HTTPException(status_code=401, detail="Пользователь не найден")
        return self._session_user(user)

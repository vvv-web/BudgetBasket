from uuid import uuid4

from fastapi import HTTPException

from app.repositories.json_repository import JsonRepository
from app.services.common import public_user


class AuthService:
    def __init__(self, repo: JsonRepository):
        self.repo = repo
        self.tokens: dict[str, str] = {}

    def login(self, login: str, password: str) -> dict:
        # TODO: заменить хранение пароля открытым текстом на hash.
        user = next((item for item in self.repo.load_all("users") if item["login"] == login), None)
        if not user or user.get("password") != password:
            raise HTTPException(status_code=401, detail="Неверный логин или пароль")
        token = f"mock-{uuid4()}"
        self.tokens[token] = user["id"]
        return {"access_token": token, "user": public_user(user)}

    def me(self, token: str | None) -> dict:
        if not token or token not in self.tokens:
            raise HTTPException(status_code=401, detail="Требуется авторизация")
        user = self.repo.get_by_id("users", self.tokens[token])
        if not user:
            raise HTTPException(status_code=401, detail="Пользователь не найден")
        return public_user(user)

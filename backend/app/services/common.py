from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from app.repositories.base import Repository


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def require_role(user: dict[str, Any], *roles: str) -> None:
    if user.get("role") not in roles:
        raise HTTPException(status_code=403, detail="Недостаточно прав")


def get_required(repo: Repository, collection: str, item_id: str) -> dict[str, Any]:
    item = repo.get_by_id(collection, item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Запись не найдена")
    return item


def public_user(user: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in user.items() if key != "password"}

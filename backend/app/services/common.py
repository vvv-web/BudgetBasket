from datetime import datetime, timezone
import re
from typing import Any

from fastapi import HTTPException

from app.repositories.base import Repository


_CORRUPTED_ITEM_SUFFIX = re.compile(r"[MМ]-\d+,\s+\?{3,}\s*\d+")


def clean_request_item_name(name: Any) -> Any:
    if not isinstance(name, str):
        return name
    prefix, separator, suffix = name.rpartition(" — ")
    if separator and _CORRUPTED_ITEM_SUFFIX.fullmatch(suffix):
        return prefix
    return name


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
    return {key: value for key, value in user.items() if key not in {"password", "id_role"}}

from __future__ import annotations

from datetime import datetime, timezone

from fastapi import HTTPException

from app.repositories.base import Repository
from app.repositories.queries import find_rows
from app.repositories.pagination import cursor_page


class NotificationService:
    def __init__(self, repo: Repository):
        self.repo = repo

    def create(
        self,
        user_id: str,
        notification_type: str,
        payload: dict,
        *,
        repo: Repository | None = None,
    ) -> dict:
        return (repo or self.repo).create(
            "notifications",
            {
                "user_id": user_id,
                "type": notification_type,
                "payload": payload,
                "read_at": None,
            },
        )

    def list_for_user(self, user: dict, *, unread_only: bool = False, page_size: int | None = None, before: str | None = None) -> list[dict] | dict:
        if page_size is not None:
            return cursor_page(self.repo, "notifications", filters={"user_id": user["id"], **({"read_at": None} if unread_only else {})}, page_size=page_size, before=before)
        items = [
            item
            for item in find_rows(self.repo, "notifications", filters={"user_id": user["id"], **({"read_at": None} if unread_only else {})})
            if item.get("user_id") == user["id"]
            and (not unread_only or not item.get("read_at"))
        ]
        return sorted(items, key=lambda item: str(item.get("created_at") or ""), reverse=True)

    def mark(self, user: dict, notification_id: str, *, read: bool) -> dict:
        notification = self.repo.get_by_id("notifications", notification_id)
        if not notification or notification.get("user_id") != user["id"]:
            raise HTTPException(status_code=404, detail="Уведомление не найдено")
        return self.repo.update(
            "notifications",
            notification_id,
            {
                "read_at": datetime.now(timezone.utc).isoformat() if read else None,
            },
        )

    def mark_all_read(self, user: dict) -> dict:
        now = datetime.now(timezone.utc).isoformat()
        count = self.repo.update_where("notifications", {"user_id": user["id"], "read_at": None}, {"read_at": now})
        return {"updated": count}

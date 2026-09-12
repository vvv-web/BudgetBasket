from datetime import datetime, timezone
import re
from typing import Any

from fastapi import HTTPException

from app.models import APPROVED_ITEM_STATUSES, ItemStatus, RequestStatus
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


def request_author_id(repo: Repository, request_id: str) -> str | None:
    """Return the creator recorded in the immutable request audit log."""
    created = [
        row
        for row in repo.load_all("req_logs")
        if row.get("req_id") == request_id
        and (row.get("log") or {}).get("action") == "request_created"
    ]
    if not created:
        return None
    return min(
        created,
        key=lambda row: (str(row.get("created_at") or ""), str(row.get("id") or "")),
    ).get("user_id")


def cfo_position_current_step_id(repo: Repository, position: dict[str, Any]) -> str | None:
    """Return the active approval step stored on a CFO position."""
    return position.get("current_step_id")


def request_cfo_review_completed(repo: Repository, request_id: str) -> bool:
    """Whether the latest CFO-review cycle was completed and not returned again."""
    relevant = []
    for row in repo.load_all("req_logs"):
        if row.get("req_id") != request_id:
            continue
        action = (row.get("log") or {}).get("action")
        if action in {
            "cfo_request_review_completed",
            "cfo_items_returned_for_revision",
            "request_revision_resubmitted_to_cfo",
            "request_restored",
        }:
            relevant.append(row)
    if not relevant:
        return False
    latest = max(
        relevant,
        key=lambda row: (str(row.get("created_at") or ""), int(row.get("id") or 0)),
    )
    return (latest.get("log") or {}).get("action") == "cfo_request_review_completed"


def request_returned_item_ids(repo: Repository, request_id: str) -> set[str]:
    """Return lines currently handed back by the CFO to the module author."""
    relevant = []
    for row in repo.load_all("req_logs"):
        if row.get("req_id") != request_id:
            continue
        action = (row.get("log") or {}).get("action")
        if action in {
            "cfo_items_returned_for_revision",
            "request_revision_resubmitted_to_cfo",
            "request_restored",
        }:
            relevant.append(row)
    if not relevant:
        return set()
    latest = max(
        relevant,
        key=lambda row: (str(row.get("created_at") or ""), int(row.get("id") or 0)),
    )
    log = latest.get("log") or {}
    if log.get("action") != "cfo_items_returned_for_revision":
        return set()
    return {str(item_id) for item_id in log.get("item_ids") or []}


def derived_request_status(items: list[dict[str, Any]]) -> RequestStatus:
    """Derive the safe request state from active lines and final route flags.

    A mixed accepted/rejected final package is intentionally left ``on_review``:
    the normative document marks that outcome as A-02 and does not define a
    final request status for it.
    """
    active = [row for row in items if row.get("status") != ItemStatus.deleted]
    if active and all(row.get("status") == ItemStatus.rejected for row in active):
        return RequestStatus.rejected
    if active and all(
        row.get("status") in APPROVED_ITEM_STATUSES
        and bool(row.get("frozen"))
        and bool(row.get("fixed"))
        for row in active
    ):
        return RequestStatus.approved
    return RequestStatus.on_review

from __future__ import annotations

import base64
import json

from fastapi import HTTPException

from app.repositories.queries import find_rows


def decode_cursor(value: str | None):
    if value is None:
        return None
    try:
        if len(value) > 512:
            raise ValueError
        result = json.loads(base64.urlsafe_b64decode(value.encode("ascii")))
        if not isinstance(result, list) or len(result) != 2 or not all(isinstance(part, str) for part in result):
            raise ValueError
        return result
    except (ValueError, TypeError, UnicodeError) as exc:
        raise HTTPException(status_code=422, detail="Некорректный курсор страницы") from exc


def encode_cursor(row):
    return base64.urlsafe_b64encode(json.dumps([str(row["created_at"]), str(row["id"])]).encode()).decode()


def cursor_page(repo, collection, *, filters=None, in_filters=None, page_size=50, before=None):
    cursor = decode_cursor(before)
    if hasattr(repo, "cursor_rows"):
        rows = repo.cursor_rows(collection, filters=filters, in_filters=in_filters, limit=page_size + 1, before=cursor)
    else:
        rows = find_rows(repo, collection, filters=filters, in_filters=in_filters)
        rows.sort(key=lambda row: (str(row["created_at"]), row["id"]), reverse=True)
        if cursor:
            rows = [row for row in rows if (str(row["created_at"]), str(row["id"])) < tuple(cursor)]
        rows = rows[:page_size + 1]
    page = rows[:page_size]
    return {"items": page, "next_cursor": encode_cursor(page[-1]) if len(rows) > page_size else None}


def numbered_page(repo, collection, *, filters=None, in_filters=None, excluded=None, page=1, page_size=50):
    if hasattr(repo, "page_rows"):
        return repo.page_rows(collection, filters=filters, in_filters=in_filters, excluded=excluded, page=page, page_size=page_size)
    rows = find_rows(repo, collection, filters=filters, in_filters=in_filters, order_by=(("id", False),))
    rows = [row for row in rows if all(row.get(key) != value for key, value in (excluded or {}).items())]
    pages = max(1, (len(rows) + page_size - 1) // page_size)
    page = min(page, pages)
    return {"items": rows[(page - 1) * page_size:page * page_size], "pagination": {"page": page, "page_size": page_size, "total_items": len(rows), "total_pages": pages, "has_next": page < pages, "has_previous": page > 1}}

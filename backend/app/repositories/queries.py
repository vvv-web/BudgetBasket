"""Small query helpers shared by SQL services and deterministic test repositories."""
from __future__ import annotations

from functools import wraps
from inspect import signature


def find_rows(repo, collection: str, *, filters=None, in_filters=None, order_by=(), limit=None, offset=0):
    if hasattr(repo, "find_rows"):
        return repo.find_rows(collection, filters=filters, in_filters=in_filters, order_by=order_by, limit=limit, offset=offset)
    rows = [row for row in repo.load_all(collection)
            if all(row.get(key) == value for key, value in (filters or {}).items())
            and all(row.get(key) in values for key, values in (in_filters or {}).items())]
    for key, descending in reversed(order_by):
        rows.sort(key=lambda row: (row.get(key) is not None, row.get(key)), reverse=descending)
    return rows[offset:] if limit is None else rows[offset:offset + limit]


def find_one(repo, collection: str, **filters):
    return next(iter(find_rows(repo, collection, filters=filters, limit=1)), None)


def scoped_register_read(function):
    parameters = signature(function)

    @wraps(function)
    def wrapped(self, user, *args, **kwargs):
        if not hasattr(self.repo, "register_snapshot"):
            return function(self, user, *args, **kwargs)
        filters = dict(parameters.bind(self, user, *args, **kwargs).arguments)
        filters.pop("self", None)
        filters.pop("user", None)
        visible = self.permissions.visible_request_ids(user)
        restricting_keys = {
            "budget_year", "cfo_id", "category_id", "article_id", "module_id",
            "request_id", "status", "request_status", "frozen", "search",
            "mine_only", "analytics_1", "analytics_2", "analytics_3",
            "analytics_4", "analytics_5", "item_ids", "is_income",
            "positioned_only", "fixed_only", "module_ids",
        }
        # A global administrator read already matches the legacy full snapshots.
        # Avoid issuing a candidate query and then selecting the same tables again.
        if visible is None and not any(filters.get(key) is not None and filters.get(key) is not False for key in restricting_keys):
            return function(self, user, *args, **kwargs)
        snapshot = self.repo.register_snapshot(visible, filters, self.repo.load_all("units"))
        with self.repo.read_snapshot(snapshot):
            return function(self, user, *args, **kwargs)
    return wrapped

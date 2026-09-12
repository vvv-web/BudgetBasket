from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import BigInteger, Integer, String, cast, literal, union_all, delete, insert, select, text, update, func, or_, and_, tuple_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.database import TABLES, to_public_value


_request_read_cache: ContextVar[dict[str, list[dict[str, Any]]] | None] = ContextVar(
    "budgetbasket_request_read_cache",
    default=None,
)


class SqlRepository:
    is_sql = True

    def __init__(self, session_factory: sessionmaker, session=None):
        self.session_factory = session_factory
        self.session = session

    @staticmethod
    def _row_to_dict(row) -> dict[str, Any]:
        return {key: to_public_value(value) for key, value in row._mapping.items()}

    def _table(self, collection_name: str):
        table_name = collection_name.removesuffix(".json")
        if table_name not in TABLES:
            raise HTTPException(status_code=500, detail=f"Unknown SQL collection {table_name}")
        return TABLES[table_name]

    @staticmethod
    def _coerce_value(column, value):
        if value is None:
            return None
        if getattr(column.type, "as_uuid", False) and isinstance(value, str):
            try:
                return UUID(value)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail="Некорректный идентификатор") from exc
        if isinstance(column.type, (BigInteger, Integer)) and isinstance(value, str) and value.isdigit():
            return int(value)
        return value

    def _coerce_payload(self, table, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            key: self._coerce_value(table.c[key], value)
            for key, value in payload.items()
            if key in table.c
        }

    @staticmethod
    def _raise_integrity_error(exc: IntegrityError) -> None:
        constraint_name = getattr(getattr(exc.orig, "diag", None), "constraint_name", None)
        if constraint_name == "ux_requests_active_unit_budget_year":
            raise HTTPException(
                status_code=409,
                detail="Для модуля уже существует активная заявка этого года",
            ) from exc
        raise HTTPException(status_code=400, detail="Database constraint violation") from exc

    def _user_payload(self, session, payload: dict[str, Any]) -> dict[str, Any]:
        normalized = dict(payload)
        role_name = normalized.pop("role", None)
        if role_name is not None:
            role_id = session.execute(
                select(TABLES["roles"].c.id).where(TABLES["roles"].c.name == str(role_name))
            ).scalar_one_or_none()
            if role_id is None:
                raise HTTPException(status_code=400, detail="Неизвестная роль пользователя")
            normalized["id_role"] = role_id
        return self._coerce_payload(TABLES["users"], normalized)

    def _where_clause(self, table, filters: dict[str, Any]):
        if not filters:
            raise HTTPException(status_code=400, detail="Filters are required for bulk operation")
        clauses = []
        for key, value in filters.items():
            if key not in table.c:
                raise HTTPException(status_code=500, detail=f"Unknown SQL field {key} for {table.name}")
            clauses.append(table.c[key] == self._coerce_value(table.c[key], value))
        return clauses

    @contextmanager
    def _session_scope(self, *, write: bool = False):
        if self.session is not None:
            yield self.session
            return
        with self.session_factory() as session:
            try:
                yield session
                if write:
                    session.commit()
            except Exception:
                if write:
                    session.rollback()
                raise

    def _select_for_collection(self, collection_name: str):
        table = self._table(collection_name)
        if table.name != "users":
            return select(table)
        roles = TABLES["roles"]
        return select(*table.c, roles.c.name.label("role")).select_from(
            table.join(roles, table.c.id_role == roles.c.id)
        )

    def load_all(self, collection_name: str) -> list[dict[str, Any]]:
        cache = _request_read_cache.get()
        if cache is not None and collection_name in cache:
            return cache[collection_name]
        with self._session_scope() as session:
            rows = session.execute(self._select_for_collection(collection_name)).all()
            result = [self._row_to_dict(row) for row in rows]
            if cache is not None:
                cache[collection_name] = result
            return result

    def find_rows(self, collection_name: str, *, filters=None, in_filters=None,
                  order_by=(), limit=None, offset=0) -> list[dict[str, Any]]:
        cache = _request_read_cache.get()
        if cache is not None and collection_name in cache:
            rows = [
                row
                for row in cache[collection_name]
                if all(row.get(key) == value for key, value in (filters or {}).items())
                and all(row.get(key) in values for key, values in (in_filters or {}).items())
            ]
            for key, descending in reversed(order_by):
                rows.sort(
                    key=lambda row: (row.get(key) is not None, row.get(key)),
                    reverse=descending,
                )
            return rows[offset:] if limit is None else rows[offset:offset + limit]
        table = self._table(collection_name)
        query = self._select_for_collection(collection_name)
        for key, value in (filters or {}).items():
            query = query.where(table.c[key] == self._coerce_value(table.c[key], value))
        for key, values in (in_filters or {}).items():
            values = list(values)
            if not values:
                return []
            query = query.where(table.c[key].in_([self._coerce_value(table.c[key], value) for value in values]))
        for key, descending in order_by:
            column = table.c[key]
            query = query.order_by(column.desc() if descending else column.asc())
        if limit is not None:
            query = query.limit(limit)
        if offset:
            query = query.offset(offset)
        with self._session_scope() as session:
            return [self._row_to_dict(row) for row in session.execute(query)]

    def count_rows(self, collection_name: str, *, filters=None) -> int:
        table = self._table(collection_name)
        query = select(func.count()).select_from(table)
        for key, value in (filters or {}).items():
            query = query.where(table.c[key] == self._coerce_value(table.c[key], value))
        with self._session_scope() as session:
            return session.execute(query).scalar_one()

    def cursor_rows(self, collection_name, *, filters=None, in_filters=None, limit=51, before=None):
        table = self._table(collection_name)
        query = self._select_for_collection(collection_name)
        for key, value in (filters or {}).items():
            query = query.where(table.c[key] == self._coerce_value(table.c[key], value))
        for key, values in (in_filters or {}).items():
            query = query.where(table.c[key].in_([self._coerce_value(table.c[key], value) for value in values]))
        if before:
            try:
                stamp = datetime.fromisoformat(before[0])
                identity = self._coerce_value(table.c.id, before[1])
                if isinstance(table.c.id.type, (BigInteger, Integer)):
                    identity = int(identity)
            except ValueError as exc:
                raise HTTPException(status_code=422, detail="Некорректный курсор страницы") from exc
            query = query.where(tuple_(table.c.created_at, table.c.id) < tuple_(stamp, identity))
        query = query.order_by(table.c.created_at.desc(), table.c.id.desc()).limit(limit)
        with self._session_scope() as session:
            return [self._row_to_dict(row) for row in session.execute(query)]

    def page_rows(self, collection_name, *, filters=None, in_filters=None, excluded=None, page=1, page_size=50, nonempty_positions=False):
        table = self._table(collection_name)
        clauses = [table.c[key] == self._coerce_value(table.c[key], value) for key, value in (filters or {}).items()]
        clauses += [table.c[key].in_([self._coerce_value(table.c[key], value) for value in values]) for key, values in (in_filters or {}).items()]
        clauses += [table.c[key] != value for key, value in (excluded or {}).items()]
        if nonempty_positions:
            items = TABLES["req_items"]
            requests = TABLES["requests"]
            clauses.append(select(items.c.id).join(requests, requests.c.id == items.c.request_id).where(items.c.cfo_position_id == table.c.id, items.c.status != "deleted", requests.c.status != "cancelled").exists())
        with self._session_scope() as session:
            total = session.execute(select(func.count()).select_from(table).where(*clauses)).scalar_one()
            pages = max(1, (total + page_size - 1) // page_size)
            page = min(page, pages)
            query = self._select_for_collection(collection_name).where(*clauses).order_by(table.c.id).offset((page - 1) * page_size).limit(page_size)
            return {"items": [self._row_to_dict(row) for row in session.execute(query)], "pagination": {"page": page, "page_size": page_size, "total_items": total, "total_pages": pages, "has_next": page < pages, "has_previous": page > 1}}

    def history_rows(self, request_ids, *, limit=None, before=None):
        items, requests = TABLES["req_items"], TABLES["requests"]
        visible = select(requests.c.id)
        if request_ids is not None:
            visible = visible.where(requests.c.id.in_([UUID(value) for value in request_ids]))
        visible_items = select(items.c.id).where(items.c.request_id.in_(visible))
        visible_positions = select(items.c.cfo_position_id).where(items.c.request_id.in_(visible))
        request_logs, position_logs = TABLES["req_logs"], TABLES["cfo_position_logs"]
        predicates = [request_logs.c.req_id.in_(visible), or_(
            position_logs.c.cfo_position_id.in_(visible_positions),
            position_logs.c.log["request_id"].astext.in_(select(cast(visible.subquery().c.id, String))),
            position_logs.c.log["req_item_id"].astext.in_(select(cast(visible_items.subquery().c.id, String))),
        )]
        parts = []
        for table, source, predicate in zip((request_logs, position_logs), ("request", "cfo_position"), predicates):
            key = func.concat(source + ":", func.lpad(cast(table.c.id, String), 20, "0"))
            query = select(table.c.id, table.c.created_at, literal(source).label("source"), key.label("cursor_id")).where(predicate)
            if before:
                try:
                    stamp = datetime.fromisoformat(before[0])
                except ValueError as exc:
                    raise HTTPException(status_code=422, detail="Invalid history cursor") from exc
                query = query.where(tuple_(table.c.created_at, key) < tuple_(stamp, before[1]))
            parts.append(query)
        history = union_all(*parts).subquery()
        query = select(history).order_by(history.c.created_at.desc(), history.c.cursor_id.desc())
        if limit is not None:
            query = query.limit(limit)
        with self._session_scope() as session:
            keys = session.execute(query).all()
        by_key = {}
        for source, collection in (("request", "req_logs"), ("cfo_position", "cfo_position_logs")):
            for row in self.find_rows(collection, in_filters={"id": {entry.id for entry in keys if entry.source == source}}):
                by_key[(source, row["id"])] = {**row, "source": source}
        return [by_key[(entry.source, entry.id)] for entry in keys]

    def _register_candidates(self, request_ids: set[str] | None, filters: dict, units: list[dict]):
        """Fetch a scope and its complete request/position workflow context in batches."""
        requests, items = TABLES["requests"], TABLES["req_items"]
        query = select(items.c.request_id, items.c.cfo_position_id).join(requests, requests.c.id == items.c.request_id)
        query = query.where(requests.c.status != "cancelled", items.c.status != "deleted")
        if request_ids is not None:
            query = query.where(requests.c.id.in_([UUID(value) for value in request_ids]))
        for key, column in (("budget_year", requests.c.budget_year), ("request_id", requests.c.id), ("module_id", requests.c.unit_id)):
            if filters.get(key):
                query = query.where(column == self._coerce_value(column, filters[key]))
        if filters.get("module_ids") is not None:
            query = query.where(requests.c.unit_id.in_([UUID(value) for value in filters["module_ids"]]))
        if filters.get("cfo_id") and filters["cfo_id"] != "unassigned":
            by_id = {row["id"]: row for row in units}
            def belongs(unit_id):
                seen = set()
                while unit_id and unit_id not in seen:
                    if unit_id == filters["cfo_id"]:
                        return True
                    seen.add(unit_id)
                    unit_id = by_id.get(unit_id, {}).get("parent_id")
                return False
            query = query.where(requests.c.unit_id.in_([UUID(key) for key in by_id if belongs(key)]))
        if filters.get("item_ids") is not None:
            query = query.where(items.c.id.in_([UUID(value) for value in filters["item_ids"]]))
        # Raw filters can narrow the candidate set, but never the sibling context.
        for key in ("status", "is_income"):
            if filters.get(key) is not None:
                query = query.where(items.c[key] == filters[key])
        if filters.get("category_id") and filters["category_id"] != "uncategorized":
            value = self._coerce_value(items.c.dds_id, filters["category_id"])
            query = query.where(or_(items.c.dds_id == value, items.c.invest_id == value))
        if filters.get("article_id") and filters["article_id"] != "uncategorized":
            value = self._coerce_value(items.c.dds_id, filters["article_id"])
            dds, invests = TABLES["dds_catalog"], TABLES["invests_catalog"]
            query = query.where(or_(items.c.dds_id.in_(select(dds.c.id).where(or_(dds.c.parent_id == value, dds.c.id == value))), items.c.invest_id.in_(select(invests.c.id).where(or_(invests.c.parent_id == value, invests.c.id == value)))))
        return query

    def register_page_ids(self, request_ids, filters, units, *, page, page_size, sort=None):
        items, requests = TABLES["req_items"], TABLES["requests"]
        query = self._register_candidates(request_ids, filters, units).with_only_columns(items.c.id, maintain_column_froms=True)
        for field in ("analytics_1", "analytics_2", "analytics_3", "analytics_4", "analytics_5"):
            if filters.get(field) is not None:
                value = "" if filters[field] == "__empty__" else str(filters[field]).strip()
                query = query.where(func.btrim(items.c[field]) == value)
        if filters.get("request_status"):
            query = query.where(requests.c.status.in_([value.strip() for value in filters["request_status"].split(",")]))
        if filters.get("frozen") in {"frozen", "fixed"}:
            query = query.where(items.c[filters["frozen"]].is_(True))
        if filters.get("positioned_only"):
            query = query.where(items.c.cfo_position_id.is_not(None), items.c.status != "rejected")
        order = [requests.c.updated_at.desc(), items.c.id.desc()]
        if sort:
            value = items.c.sum_plan if sort.column == "requested" else items.c.sum_fact - items.c.sum_plan
            order.insert(0, value.desc() if sort.direction == "desc" else value.asc())
        with self._session_scope() as session:
            total = session.execute(select(func.count()).select_from(query.subquery())).scalar_one()
            pages = max(1, (total + page_size - 1) // page_size)
            page = min(page, pages)
            ids = session.execute(query.order_by(*order).offset((page - 1) * page_size).limit(page_size)).scalars().all()
        return [str(value) for value in ids], {"page": page, "page_size": page_size, "total_items": total, "total_pages": pages, "has_next": page < pages, "has_previous": page > 1}

    def register_item_ids(self, request_ids, filters, units) -> list[str]:
        """Return the complete filtered line scope without building workflow DTOs."""
        items, requests = TABLES["req_items"], TABLES["requests"]
        query = self._register_candidates(request_ids, filters, units).with_only_columns(
            items.c.id, maintain_column_froms=True
        )
        for field in ("analytics_1", "analytics_2", "analytics_3", "analytics_4", "analytics_5"):
            if filters.get(field) is not None:
                value = "" if filters[field] == "__empty__" else str(filters[field]).strip()
                query = query.where(func.btrim(func.coalesce(items.c[field], "")) == value)
        if filters.get("request_status"):
            statuses = [value.strip() for value in filters["request_status"].split(",") if value.strip()]
            query = query.where(requests.c.status.in_(statuses))
        if filters.get("frozen") in {"frozen", "fixed"}:
            query = query.where(items.c[filters["frozen"]].is_(True))
        if filters.get("positioned_only"):
            query = query.where(items.c.cfo_position_id.is_not(None), items.c.status != "rejected")
        with self._session_scope() as session:
            return [str(value) for value in session.execute(query.distinct()).scalars()]

    def register_analytics_filters(self, request_ids, filters, units) -> dict[str, list[str]]:
        """Load analytics filter values directly from the visible SQL scope."""
        items, requests = TABLES["req_items"], TABLES["requests"]
        candidate = self._register_candidates(request_ids, filters, units)
        if filters.get("request_status"):
            statuses = [value.strip() for value in filters["request_status"].split(",") if value.strip()]
            candidate = candidate.where(requests.c.status.in_(statuses))
        if filters.get("frozen") in {"frozen", "fixed"}:
            candidate = candidate.where(items.c[filters["frozen"]].is_(True))
        if filters.get("positioned_only"):
            candidate = candidate.where(items.c.cfo_position_id.is_not(None), items.c.status != "rejected")
        result: dict[str, list[str]] = {}
        with self._session_scope() as session:
            for field in ("analytics_1", "analytics_2", "analytics_3", "analytics_4", "analytics_5"):
                value = func.btrim(items.c[field]).label("value")
                query = candidate.with_only_columns(value, maintain_column_froms=True).where(
                    items.c[field].is_not(None), value != ""
                ).distinct()
                values = sorted(
                    (str(row) for row in session.execute(query).scalars()),
                    key=str.casefold,
                )
                if values:
                    result[field] = values
        return result

    def register_snapshot(self, request_ids: set[str] | None, filters: dict, units: list[dict]) -> dict:
        items = TABLES["req_items"]
        query = self._register_candidates(request_ids, filters, units)
        with self._session_scope() as session:
            matches = session.execute(query.distinct()).all()
            matched_requests = {row.request_id for row in matches}
            matched_positions = {row.cfo_position_id for row in matches if row.cfo_position_id}
            context_items = [self._row_to_dict(row) for row in session.execute(select(items).where(or_(items.c.request_id.in_(matched_requests), items.c.cfo_position_id.in_(matched_positions))))]
        related_requests = {row["request_id"] for row in context_items}
        related_positions = {row["cfo_position_id"] for row in context_items if row.get("cfo_position_id")}
        return {
            "req_items": context_items,
            "requests": self.find_rows("requests", in_filters={"id": related_requests}),
            "cfo_positions": self.find_rows("cfo_positions", in_filters={"id": related_positions}),
            "req_logs": self.find_rows("req_logs", in_filters={"req_id": related_requests}),
            "cfo_position_logs": self.find_rows("cfo_position_logs", in_filters={"cfo_position_id": related_positions}),
            "req_item_files": self.find_rows("req_item_files", in_filters={"req_item_id": {row["id"] for row in context_items}}),
        }

    def chat_overviews(self, chat_ids: set[str], user_id: str, *, admin: bool = False) -> dict:
        if not chat_ids:
            return {}
        chats, messages, participants = TABLES["chats"], TABLES["chat_messages"], TABLES["chats_participants"]
        read = messages.alias("last_read")
        latest = select(messages.c.id).where(messages.c.chat_id == chats.c.id).order_by(messages.c.created_at.desc(), messages.c.id.desc()).limit(1).correlate(chats).scalar_subquery()
        unread = select(func.count()).select_from(messages).where(messages.c.chat_id == chats.c.id, messages.c.sender_id.is_distinct_from(UUID(user_id)), or_(read.c.id.is_(None), tuple_(messages.c.created_at, messages.c.id) > tuple_(read.c.created_at, read.c.id))).correlate(chats, read).scalar_subquery()
        query = select(chats.c.id, latest.label("last_message_id"), unread.label("unread_count")).select_from(chats.outerjoin(participants, and_(participants.c.chat_id == chats.c.id, participants.c.user_id == UUID(user_id))).outerjoin(read, and_(read.c.id == participants.c.last_read_message_id, read.c.chat_id == chats.c.id))).where(chats.c.id.in_([UUID(value) for value in chat_ids]))
        with self._session_scope() as session:
            return {str(row.id): {"last_message_id": str(row.last_message_id) if row.last_message_id else None, "unread_count": 0 if admin else row.unread_count} for row in session.execute(query)}

    def visible_position_ids(self, user: dict, permissions) -> set[str] | None:
        if user.get("role") == "admin":
            return None
        positions, items, requests = TABLES["cfo_positions"], TABLES["req_items"], TABLES["requests"]
        query = select(positions.c.id)
        if user.get("role") == "economist":
            query = query.where(positions.c.cfo_unit_id.in_([UUID(value) for value in permissions.economist_cfo_ids(user["id"])]))
        elif user.get("role") == "employee":
            modules = [UUID(value) for value in permissions.employee_module_ids(user["id"])]
            own = select(items.c.cfo_position_id).join(requests, requests.c.id == items.c.request_id).where(requests.c.unit_id.in_(modules))
            query = query.where(or_(positions.c.cfo_unit_id.in_([UUID(value) for value in permissions.employee_cfo_ids(user["id"])]), positions.c.id.in_(own)))
        elif user.get("role") in {"approver", "zgd"}:
            steps, logs = TABLES["steps"], TABLES["cfo_position_logs"]
            assigned = select(steps.c.id).where(steps.c.user_id == UUID(user["id"]))
            history = select(logs.c.id).where(logs.c.cfo_position_id == positions.c.id, logs.c.step_id.in_(assigned)).exists()
            query = query.where(or_(positions.c.current_step_id.in_(assigned), history))
        else:
            return set()
        with self._session_scope() as session:
            return {str(value) for value in session.execute(query).scalars()}

    def visible_request_ids(self, user: dict, permissions) -> set[str] | None:
        if user.get("role") == "admin":
            return None
        requests, items = TABLES["requests"], TABLES["req_items"]
        query = select(requests.c.id)
        if user.get("role") == "employee":
            modules = [UUID(value) for value in permissions.employee_module_ids(user["id"])]
            cfo_modules = [UUID(value) for value in permissions.modules_for_cfos(permissions.employee_cfo_ids(user["id"]))]
            query = query.where(or_(requests.c.unit_id.in_(modules), and_(requests.c.unit_id.in_(cfo_modules), requests.c.status != "draft")))
        elif user.get("role") == "economist":
            modules = [UUID(value) for value in permissions.modules_for_cfos(permissions.economist_cfo_ids(user["id"]))]
            query = query.where(requests.c.unit_id.in_(modules), requests.c.status != "draft")
        else:
            positions = self.visible_position_ids(user, permissions) or set()
            query = select(items.c.request_id).where(items.c.cfo_position_id.in_([UUID(value) for value in positions])).distinct()
        with self._session_scope() as session:
            return {str(value) for value in session.execute(query).scalars()}

    def request_summaries(self, request_ids):
        items = TABLES["req_items"]
        active = items.c.status != "deleted"
        accepted = items.c.status.in_(["approved", "approved_with_changes"])
        expense = items.c.is_income.is_(False)
        def amount(column, condition, name):
            return func.coalesce(func.sum(column).filter(and_(active, condition)), 0).label(name)
        query = select(items.c.request_id,
            amount(items.c.sum_plan, expense, "planned_sum"),
            amount(items.c.sum_fact, and_(expense, accepted), "approved_sum"),
            amount(items.c.sum_plan, ~expense, "income_planned_sum"),
            amount(items.c.sum_fact, and_(~expense, accepted), "income_approved_sum"),
            func.count().filter(active).label("items_count"),
            func.count().filter(and_(active, accepted)).label("accepted_count"),
            func.count().filter(items.c.status == "rejected").label("rejected_count"),
            func.count().filter(items.c.status == "on_review").label("in_review_count"),
            func.count().filter(items.c.status == "deleted").label("deleted_count"),
            func.bool_and(items.c.frozen).filter(active).label("frozen"),
            func.bool_and(items.c.fixed).filter(active).label("fixed"),
        ).where(items.c.request_id.in_([UUID(value) for value in request_ids])).group_by(items.c.request_id)
        with self._session_scope() as session:
            result = {str(row.request_id): self._row_to_dict(row) for row in session.execute(query)}
        for identity in request_ids:
            result.setdefault(identity, {"request_id": identity, **dict.fromkeys(("planned_sum", "approved_sum", "income_planned_sum", "income_approved_sum", "items_count", "accepted_count", "rejected_count", "in_review_count", "deleted_count"), 0), "frozen": False, "fixed": False})
        return result

    def request_page(self, visible, filters, *, page, page_size, created_from=None, created_to=None):
        table = TABLES["requests"]
        clauses = [table.c[key] == self._coerce_value(table.c[key], value) for key, value in filters.items()]
        if visible is not None:
            clauses.append(table.c.id.in_([UUID(value) for value in visible]))
        if created_from:
            clauses.append(table.c.created_at >= created_from)
        if created_to:
            clauses.append(table.c.created_at <= created_to)
        with self._session_scope() as session:
            count = session.execute(select(func.count()).select_from(table).where(*clauses)).scalar_one()
            page = min(page, max(1, (count + page_size - 1) // page_size))
            query = select(table).where(*clauses).order_by(table.c.created_at.desc(), table.c.id.desc()).offset((page - 1) * page_size).limit(page_size)
            return [self._row_to_dict(row) for row in session.execute(query)], count, page

    @contextmanager
    def read_snapshot(self, rows: dict[str, list[dict]]):
        """Local read context; never publish a partial table to the outer cache."""
        token = _request_read_cache.set({**(_request_read_cache.get() or {}), **rows})
        try:
            yield
        finally:
            _request_read_cache.reset(token)

    @contextmanager
    def request_cache(self):
        """Reuse immutable table snapshots only within the current request."""
        token = _request_read_cache.set({})
        try:
            yield
        finally:
            _request_read_cache.reset(token)

    @staticmethod
    def _invalidate_cached_collection(collection_name: str) -> None:
        cache = _request_read_cache.get()
        if cache is not None:
            cache.pop(collection_name, None)

    def save_all(self, collection_name: str, data: list[dict[str, Any]]) -> None:
        table = self._table(collection_name)
        with self._session_scope(write=True) as session:
            try:
                session.execute(delete(table))
                for item in data:
                    payload = (
                        self._user_payload(session, item)
                        if table.name == "users"
                        else self._coerce_payload(table, item)
                    )
                    session.execute(insert(table).values(**payload))
            except IntegrityError as exc:
                self._raise_integrity_error(exc)
        self._invalidate_cached_collection(collection_name)

    def get_by_id(self, collection_name: str, item_id: str | int) -> dict[str, Any] | None:
        table = self._table(collection_name)
        if "id" not in table.c:
            return None
        cache = _request_read_cache.get()
        if cache is not None and collection_name in cache:
            normalized_id = str(item_id)
            return next(
                (row for row in cache[collection_name] if str(row.get("id")) == normalized_id),
                None,
            )
        with self._session_scope() as session:
            row = session.execute(
                self._select_for_collection(collection_name).where(
                    table.c.id == self._coerce_value(table.c.id, item_id)
                )
            ).first()
            return self._row_to_dict(row) if row else None

    def lock_by_id(self, collection_name: str, item_id: str | int) -> dict[str, Any] | None:
        table = self._table(collection_name)
        if "id" not in table.c:
            return None
        with self._session_scope() as session:
            row = session.execute(
                self._select_for_collection(collection_name)
                .where(table.c.id == self._coerce_value(table.c.id, item_id))
                .with_for_update()
            ).first()
            return self._row_to_dict(row) if row else None

    def create(self, collection_name: str, item: dict[str, Any]) -> dict[str, Any]:
        table = self._table(collection_name)
        with self._session_scope(write=True) as session:
            try:
                payload = (
                    self._user_payload(session, item)
                    if table.name == "users"
                    else self._coerce_payload(table, item)
                )
                row = session.execute(insert(table).values(**payload).returning(table)).first()
            except IntegrityError as exc:
                self._raise_integrity_error(exc)
            created = self._row_to_dict(row)
            if table.name == "users":
                created["role"] = session.execute(
                    select(TABLES["roles"].c.name).where(TABLES["roles"].c.id == created["id_role"])
                ).scalar_one()
            self._invalidate_cached_collection(collection_name)
            return created

    def insert(self, collection_name: str, item: dict[str, Any]) -> dict[str, Any]:
        return self.create(collection_name, item)

    def update(self, collection_name: str, item_id: str | int, patch: dict[str, Any]) -> dict[str, Any]:
        table = self._table(collection_name)
        with self._session_scope(write=True) as session:
            try:
                payload = (
                    self._user_payload(session, patch)
                    if table.name == "users"
                    else self._coerce_payload(table, patch)
                )
                if not payload:
                    row = session.execute(
                        self._select_for_collection(collection_name).where(
                            table.c.id == self._coerce_value(table.c.id, item_id)
                        )
                    ).first()
                    if not row:
                        raise HTTPException(status_code=404, detail="Запись не найдена")
                    return self._row_to_dict(row)
                row = session.execute(
                    update(table)
                    .where(table.c.id == self._coerce_value(table.c.id, item_id))
                    .values(**payload)
                    .returning(table)
                ).first()
                if not row:
                    raise HTTPException(status_code=404, detail="Запись не найдена")
            except IntegrityError as exc:
                self._raise_integrity_error(exc)
            updated = self._row_to_dict(row)
            if table.name == "users":
                updated["role"] = session.execute(
                    select(TABLES["roles"].c.name).where(TABLES["roles"].c.id == updated["id_role"])
                ).scalar_one()
            self._invalidate_cached_collection(collection_name)
            return updated

    def delete(self, collection_name: str, item_id: str | int) -> None:
        table = self._table(collection_name)
        with self._session_scope(write=True) as session:
            result = session.execute(
                delete(table).where(table.c.id == self._coerce_value(table.c.id, item_id))
            )
            if result.rowcount == 0:
                raise HTTPException(status_code=404, detail="Запись не найдена")
        self._invalidate_cached_collection(collection_name)

    def update_where(self, collection_name: str, filters: dict[str, Any], patch: dict[str, Any]) -> int:
        table = self._table(collection_name)
        with self._session_scope(write=True) as session:
            try:
                payload = (
                    self._user_payload(session, patch)
                    if table.name == "users"
                    else self._coerce_payload(table, patch)
                )
                if not payload:
                    return 0
                result = session.execute(
                    update(table).where(*self._where_clause(table, filters)).values(**payload)
                )
            except IntegrityError as exc:
                self._raise_integrity_error(exc)
        if result.rowcount:
            self._invalidate_cached_collection(collection_name)
        return result.rowcount or 0

    def delete_where(self, collection_name: str, filters: dict[str, Any]) -> int:
        table = self._table(collection_name)
        with self._session_scope(write=True) as session:
            result = session.execute(delete(table).where(*self._where_clause(table, filters)))
        if result.rowcount:
            self._invalidate_cached_collection(collection_name)
        return result.rowcount or 0

    def check_connection(self) -> None:
        with self._session_scope() as session:
            session.execute(text("SELECT 1"))

    @contextmanager
    def transaction(self):
        if self.session is not None:
            yield self
            return
        with self.session_factory() as session:
            transactional_repo = SqlRepository(self.session_factory, session=session)
            try:
                yield transactional_repo
                session.commit()
            except Exception:
                session.rollback()
                raise

    def descendant_step_unit_ids(self, step_id: str, *, approved_children_only: bool) -> set[str]:
        step_uuid = UUID(step_id)
        approved_clause = "AND child.status = 'approved'" if approved_children_only else ""
        query = text(
            f"""
            WITH RECURSIVE scoped_steps(id, unit_id) AS (
                SELECT root.id, root.unit_id
                FROM steps root
                WHERE root.id = :step_id AND root.unit_id IS NOT NULL
                UNION
                SELECT child.id, child.unit_id
                FROM step_edges edge
                JOIN steps child ON child.id = edge.child_step_id
                WHERE edge.parent_step_id = :step_id {approved_clause}
                UNION
                SELECT child.id, child.unit_id
                FROM scoped_steps parent
                JOIN step_edges edge ON edge.parent_step_id = parent.id
                JOIN steps child ON child.id = edge.child_step_id
            )
            SELECT DISTINCT unit_id FROM scoped_steps WHERE unit_id IS NOT NULL
            """
        )
        with self._session_scope() as session:
            return {
                str(value)
                for value in session.execute(query, {"step_id": step_uuid}).scalars().all()
                if value is not None
            }

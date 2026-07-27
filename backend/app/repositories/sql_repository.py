from __future__ import annotations

from contextlib import contextmanager
from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import BigInteger, Integer, delete, insert, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.database import TABLES, to_public_value


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
            return UUID(value)
        if isinstance(column.type, (BigInteger, Integer)) and isinstance(value, str) and value.isdigit():
            return int(value)
        return value

    def _coerce_payload(self, table, payload: dict[str, Any]) -> dict[str, Any]:
        return {
            key: self._coerce_value(table.c[key], value)
            for key, value in payload.items()
            if key in table.c
        }

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
        with self._session_scope() as session:
            rows = session.execute(self._select_for_collection(collection_name)).all()
            return [self._row_to_dict(row) for row in rows]

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
                raise HTTPException(status_code=400, detail="Database constraint violation") from exc

    def get_by_id(self, collection_name: str, item_id: str | int) -> dict[str, Any] | None:
        table = self._table(collection_name)
        if "id" not in table.c:
            return None
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
                raise HTTPException(status_code=400, detail="Database constraint violation") from exc
            created = self._row_to_dict(row)
            if table.name == "users":
                created["role"] = session.execute(
                    select(TABLES["roles"].c.name).where(TABLES["roles"].c.id == created["id_role"])
                ).scalar_one()
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
                raise HTTPException(status_code=400, detail="Database constraint violation") from exc
            updated = self._row_to_dict(row)
            if table.name == "users":
                updated["role"] = session.execute(
                    select(TABLES["roles"].c.name).where(TABLES["roles"].c.id == updated["id_role"])
                ).scalar_one()
            return updated

    def delete(self, collection_name: str, item_id: str | int) -> None:
        table = self._table(collection_name)
        with self._session_scope(write=True) as session:
            result = session.execute(
                delete(table).where(table.c.id == self._coerce_value(table.c.id, item_id))
            )
            if result.rowcount == 0:
                raise HTTPException(status_code=404, detail="Запись не найдена")

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
                raise HTTPException(status_code=400, detail="Database constraint violation") from exc
        return result.rowcount or 0

    def delete_where(self, collection_name: str, filters: dict[str, Any]) -> int:
        table = self._table(collection_name)
        with self._session_scope(write=True) as session:
            result = session.execute(delete(table).where(*self._where_clause(table, filters)))
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

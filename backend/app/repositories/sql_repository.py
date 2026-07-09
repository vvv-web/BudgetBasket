from __future__ import annotations

from typing import Any
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import BigInteger, Integer, delete, insert, select, text, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.database import TABLES, to_public_value


class SqlRepository:
    is_sql = True

    def __init__(self, session_factory: sessionmaker):
        self.session_factory = session_factory

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
        return {key: self._coerce_value(table.c[key], value) for key, value in payload.items() if key in table.c}

    def _where_clause(self, table, filters: dict[str, Any]):
        if not filters:
            raise HTTPException(status_code=400, detail="Filters are required for bulk operation")
        clauses = []
        for key, value in filters.items():
            if key not in table.c:
                raise HTTPException(status_code=500, detail=f"Unknown SQL field {key} for {table.name}")
            clauses.append(table.c[key] == self._coerce_value(table.c[key], value))
        return clauses

    def load_all(self, collection_name: str) -> list[dict[str, Any]]:
        table = self._table(collection_name)
        with self.session_factory() as session:
            rows = session.execute(select(table)).all()
            return [self._row_to_dict(row) for row in rows]

    def save_all(self, collection_name: str, data: list[dict[str, Any]]) -> None:
        table = self._table(collection_name)
        with self.session_factory() as session:
            try:
                session.execute(delete(table))
                for item in data:
                    session.execute(insert(table).values(**self._coerce_payload(table, item)))
                session.commit()
            except IntegrityError as exc:
                session.rollback()
                raise HTTPException(status_code=400, detail="Database constraint violation") from exc

    def get_by_id(self, collection_name: str, item_id: str | int) -> dict[str, Any] | None:
        table = self._table(collection_name)
        if "id" not in table.c:
            return None
        with self.session_factory() as session:
            row = session.execute(select(table).where(table.c.id == self._coerce_value(table.c.id, item_id))).first()
            return self._row_to_dict(row) if row else None

    def create(self, collection_name: str, item: dict[str, Any]) -> dict[str, Any]:
        table = self._table(collection_name)
        payload = self._coerce_payload(table, item)
        with self.session_factory() as session:
            try:
                row = session.execute(insert(table).values(**payload).returning(table)).first()
                session.commit()
            except IntegrityError as exc:
                session.rollback()
                raise HTTPException(status_code=400, detail="Database constraint violation") from exc
            return self._row_to_dict(row)

    def insert(self, collection_name: str, item: dict[str, Any]) -> dict[str, Any]:
        return self.create(collection_name, item)

    def update(self, collection_name: str, item_id: str | int, patch: dict[str, Any]) -> dict[str, Any]:
        table = self._table(collection_name)
        payload = self._coerce_payload(table, patch)
        with self.session_factory() as session:
            try:
                row = session.execute(update(table).where(table.c.id == self._coerce_value(table.c.id, item_id)).values(**payload).returning(table)).first()
                if not row:
                    raise HTTPException(status_code=404, detail="Запись не найдена")
                session.commit()
            except IntegrityError as exc:
                session.rollback()
                raise HTTPException(status_code=400, detail="Database constraint violation") from exc
            return self._row_to_dict(row)

    def delete(self, collection_name: str, item_id: str | int) -> None:
        table = self._table(collection_name)
        with self.session_factory() as session:
            result = session.execute(delete(table).where(table.c.id == self._coerce_value(table.c.id, item_id)))
            if result.rowcount == 0:
                raise HTTPException(status_code=404, detail="Запись не найдена")
            session.commit()

    def update_where(self, collection_name: str, filters: dict[str, Any], patch: dict[str, Any]) -> int:
        table = self._table(collection_name)
        payload = self._coerce_payload(table, patch)
        with self.session_factory() as session:
            try:
                result = session.execute(update(table).where(*self._where_clause(table, filters)).values(**payload))
                session.commit()
            except IntegrityError as exc:
                session.rollback()
                raise HTTPException(status_code=400, detail="Database constraint violation") from exc
        return result.rowcount or 0

    def delete_where(self, collection_name: str, filters: dict[str, Any]) -> int:
        table = self._table(collection_name)
        with self.session_factory() as session:
            result = session.execute(delete(table).where(*self._where_clause(table, filters)))
            session.commit()
        return result.rowcount or 0

    def check_connection(self) -> None:
        with self.session_factory() as session:
            session.execute(text("SELECT 1"))

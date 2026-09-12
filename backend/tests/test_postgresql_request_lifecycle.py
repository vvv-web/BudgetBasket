import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError

from app.database import sqlalchemy_url


@pytest.mark.skipif(not os.getenv("DATABASE_URL"), reason="PostgreSQL integration test requires DATABASE_URL")
def test_postgresql_allows_cancelled_duplicates_but_rejects_two_active_requests():
    engine = create_engine(sqlalchemy_url(os.environ["DATABASE_URL"]))
    unit_id = uuid4()
    with engine.connect() as connection:
        transaction = connection.begin()
        try:
            indexes = {
                row.indexname: row.indexdef
                for row in connection.execute(
                    text(
                        "SELECT indexname, indexdef FROM pg_indexes "
                        "WHERE schemaname = current_schema() AND tablename = 'requests'"
                    )
                )
            }
            assert "ux_requests_unit_budget_year" not in indexes
            assert "ux_requests_active_unit_budget_year" in indexes
            assert "WHERE (status <> 'cancelled'::text)" in indexes["ux_requests_active_unit_budget_year"]

            connection.execute(
                text(
                    "INSERT INTO units (id, name, is_active, uses_invest_projects, annual_budget) "
                    "VALUES (:id, :name, true, false, 0)"
                ),
                {"id": unit_id, "name": f"Lifecycle integration {unit_id}"},
            )
            for _ in range(2):
                connection.execute(
                    text(
                        "INSERT INTO requests (unit_id, budget_year, status) "
                        "VALUES (:unit_id, 2199, 'cancelled')"
                    ),
                    {"unit_id": unit_id},
                )
            connection.execute(
                text(
                    "INSERT INTO requests (unit_id, budget_year, status) "
                    "VALUES (:unit_id, 2199, 'draft')"
                ),
                {"unit_id": unit_id},
            )
            savepoint = connection.begin_nested()
            with pytest.raises(IntegrityError):
                connection.execute(
                    text(
                        "INSERT INTO requests (unit_id, budget_year, status) "
                        "VALUES (:unit_id, 2199, 'on_review')"
                    ),
                    {"unit_id": unit_id},
                )
            savepoint.rollback()
        finally:
            transaction.rollback()
            engine.dispose()


@pytest.mark.skipif(not os.getenv("DATABASE_URL"), reason="PostgreSQL integration test requires DATABASE_URL")
def test_postgresql_serializes_concurrent_create_and_restore_conflicts():
    engine = create_engine(sqlalchemy_url(os.environ["DATABASE_URL"]))
    unit_id = uuid4()
    year = 2198

    def race(*statements: tuple[str, dict]) -> list[str]:
        barrier = Barrier(len(statements))

        def execute(statement: tuple[str, dict]) -> str:
            try:
                with engine.begin() as connection:
                    barrier.wait(timeout=10)
                    connection.execute(text(statement[0]), statement[1])
                return "success"
            except IntegrityError:
                return "conflict"

        with ThreadPoolExecutor(max_workers=len(statements)) as executor:
            return list(executor.map(execute, statements))

    try:
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO units (id, name, is_active, uses_invest_projects, annual_budget) "
                    "VALUES (:id, :name, true, false, 0)"
                ),
                {"id": unit_id, "name": f"Concurrent lifecycle {unit_id}"},
            )

        create_sql = (
            "INSERT INTO requests (unit_id, budget_year, status) "
            "VALUES (:unit_id, :year, 'draft')"
        )
        create_results = race(
            (create_sql, {"unit_id": unit_id, "year": year}),
            (create_sql, {"unit_id": unit_id, "year": year}),
        )
        assert sorted(create_results) == ["conflict", "success"]

        with engine.begin() as connection:
            connection.execute(
                text("DELETE FROM requests WHERE unit_id = :unit_id AND budget_year = :year"),
                {"unit_id": unit_id, "year": year},
            )
            cancelled_id = connection.execute(
                text(
                    "INSERT INTO requests (unit_id, budget_year, status) "
                    "VALUES (:unit_id, :year, 'cancelled') RETURNING id"
                ),
                {"unit_id": unit_id, "year": year},
            ).scalar_one()

        restore_sql = "UPDATE requests SET status = 'draft' WHERE id = :request_id"
        restore_results = race(
            (create_sql, {"unit_id": unit_id, "year": year}),
            (restore_sql, {"request_id": cancelled_id}),
        )
        assert sorted(restore_results) == ["conflict", "success"]

        with engine.connect() as connection:
            active_count = connection.execute(
                text(
                    "SELECT count(*) FROM requests "
                    "WHERE unit_id = :unit_id AND budget_year = :year AND status <> 'cancelled'"
                ),
                {"unit_id": unit_id, "year": year},
            ).scalar_one()
        assert active_count == 1
    finally:
        with engine.begin() as connection:
            connection.execute(text("DELETE FROM requests WHERE unit_id = :unit_id"), {"unit_id": unit_id})
            connection.execute(text("DELETE FROM units WHERE id = :unit_id"), {"unit_id": unit_id})
        engine.dispose()

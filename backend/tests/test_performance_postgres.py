"""Run only against an explicitly selected, isolated performance database."""
import os
from uuid import uuid4

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.database import create_session_factory, sqlalchemy_url
from app.repositories.sql_repository import SqlRepository
from app.seed import ADMIN_ID, CFO_ID, DDS_LICENSE_ID
from app.services.permission_service import PermissionService
from app.services.request_service import RequestService
from app.services.approval_service import ApprovalService
from app.services.register_query_service import RegisterQuery, RegisterQueryService


@pytest.fixture
def sql_scope():
    url = os.environ.get("PERFORMANCE_DATABASE_URL")
    if not url:
        pytest.skip("PERFORMANCE_DATABASE_URL must point to an isolated audit database")
    assert make_url(url).database.startswith("budgetbasket_perf_")
    engine = create_engine(sqlalchemy_url(url))
    with engine.connect() as connection:
        transaction = connection.begin()
        session = Session(bind=connection)
        repo = SqlRepository(create_session_factory(engine), session=session)
        permissions = PermissionService(repo)
        requests = RequestService(repo, permissions)
        requests.approval_service = ApprovalService(repo, permissions)
        def create_scope(count):
            unit = repo.create("units", {"id": str(uuid4()), "name": "Performance test module", "parent_id": CFO_ID})
            request = repo.create("requests", {"unit_id": unit["id"], "budget_year": 2027, "status": "draft"})
            for index in range(count):
                item = repo.create("req_items", {"request_id": request["id"], "dds_id": DDS_LICENSE_ID, "name": f"Scope {index}", "sum_plan": 100})
                repo.create("req_logs", {"req_id": request["id"], "user_id": ADMIN_ID, "log": {"action": "item_updated", "entity": "req_item", "entity_id": item["id"]}})
            return request
        try:
            yield engine, repo, requests, create_scope
        finally:
            session.close()
            transaction.rollback()
    engine.dispose()


def test_scoped_register_does_not_fetch_unrelated_items_or_logs(sql_scope):
    engine, repo, requests, create_scope = sql_scope
    request = create_scope(121)
    user = repo.get_by_id("users", ADMIN_ID)
    measurements = []
    def record(_conn, cursor, statement, _params, _context, _many):
        if statement.lstrip().upper().startswith("SELECT"):
            measurements.append((statement, max(cursor.rowcount, 0)))
    event.listen(engine, "after_cursor_execute", record)
    service = RegisterQueryService(requests)
    def run(page_size):
        measurements.clear()
        with repo.request_cache():
            result = service.query(user, RegisterQuery(mode="rows", filters={"request_id": request["id"]}, page_size=page_size))
        return result, (len(measurements), sum(rows for _, rows in measurements))
    first, initial = run(50)
    create_scope(300)
    after, isolated = run(50)
    assert after == first
    # The new unit dictionary adds one row; growing item/log tables adds none.
    assert isolated[0] == initial[0]
    assert isolated[1] <= initial[1] + 2
    larger, larger_cost = run(100)
    assert len(larger["items"]) == 100
    assert larger_cost[0] == initial[0]
    assert len(first["items"]) == 50
    with repo.request_cache():
        fast = service.query(user, RegisterQuery(mode="rows", filters={"request_id": request["id"]}, include_aggregates=False))
    assert fast["items"] == first["items"]
    assert fast["pagination"] == first["pagination"]
    event.remove(engine, "after_cursor_execute", record)


def test_postgres_history_and_empty_request_summaries(sql_scope):
    _, repo, requests, create_scope = sql_scope
    request = create_scope(0)
    user = repo.get_by_id("users", ADMIN_ID)
    summaries = repo.request_summaries({request["id"]})
    assert summaries[request["id"]]["items_count"] == 0
    assert not summaries[request["id"]]["fixed"]
    for index in range(12):
        repo.create("req_logs", {"req_id": request["id"], "user_id": ADMIN_ID, "created_at": "2026-01-01T00:00:00+00:00", "log": {"action": "item_updated", "index": index}})
    service = requests.approval_service
    cursor, ids = None, []
    while True:
        page = service.request_history(user, request["id"], page_size=5, before=cursor)
        ids.extend(row["id"] for row in page["items"])
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert len(ids) == len(set(ids)) == 12
    assert ids == sorted(ids, reverse=True)

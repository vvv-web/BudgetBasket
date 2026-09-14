"""Isolated, repeatable HTTP benchmark. Never seeds the application database.

Run inside the backend container: python -m scripts.performance_audit --label before.
Results go to stdout as JSON lines; progress goes to stderr.
"""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
from contextvars import ContextVar
from datetime import datetime, timezone
import gzip
import json
import os
from pathlib import Path
import resource
import statistics
import subprocess
import sys
import time
from uuid import UUID

import httpx
from sqlalchemy import create_engine, event, insert, select, text
from sqlalchemy.engine import make_url

from app.database import TABLES, sqlalchemy_url
from app.seed import ADMIN_ID, CFO_ID, DDS_LICENSE_ID, DDS_OPER_ID, EMPLOYEE_ID, MODULE_ALPHA_ID

metrics = ContextVar("audit_metrics", default=None)


def create_browser_audit_app():
    source = make_url(sqlalchemy_url(os.environ["DATABASE_URL"]))
    os.environ["DATABASE_URL"] = source.set(database="budgetbasket_perf_20000").render_as_string(hide_password=False)
    os.environ["S3_BUCKET"] = "budgetbasket-performance"
    return create_audit_app()


def create_audit_app():
    from app.factory import create_app
    from app.database import create_session_factory
    from app.repositories.sql_repository import SqlRepository
    engine = create_engine(sqlalchemy_url(os.environ["DATABASE_URL"]), pool_pre_ping=True)
    # Fixture routes are already deterministic. Do not run the installation's
    # startup route repair as part of read-endpoint latency measurements.
    app = create_app(repository=SqlRepository(create_session_factory(engine)))

    @event.listens_for(engine, "before_cursor_execute")
    def before(_conn, _cursor, _statement, _parameters, context, _many):
        context.audit_started = time.perf_counter()

    @event.listens_for(engine, "after_cursor_execute")
    def after(_conn, cursor, _statement, _parameters, context, _many):
        current = metrics.get()
        if current is not None:
            current["sql_count"] += 1
            current["db_ms"] += (time.perf_counter() - context.audit_started) * 1000
            current["rows"] += max(0, cursor.rowcount)

    from starlette.responses import JSONResponse
    original_render = JSONResponse.render
    def measured_render(response, content):
        start = time.perf_counter()
        try:
            return original_render(response, content)
        finally:
            current = metrics.get()
            if current is not None:
                current["serialization_ms"] += (time.perf_counter() - start) * 1000
    JSONResponse.render = measured_render
    original_checkout = engine.pool._do_get
    def measured_checkout():
        start = time.perf_counter()
        try:
            return original_checkout()
        finally:
            current = metrics.get()
            if current is not None:
                current["pool_checkout_ms"] += (time.perf_counter() - start) * 1000
    engine.pool._do_get = measured_checkout
    @event.listens_for(engine, "begin")
    def transaction_begin(conn):
        conn.info["audit_transaction_start"] = time.perf_counter()
    @event.listens_for(engine, "commit")
    @event.listens_for(engine, "rollback")
    def transaction_end(conn):
        start = conn.info.pop("audit_transaction_start", None)
        current = metrics.get()
        if start is not None and current is not None:
            current["transaction_ms"] += (time.perf_counter() - start) * 1000

    @app.middleware("http")
    async def audit(_request, call_next):
        values = {"sql_count": 0, "db_ms": 0.0, "rows": 0, "serialization_ms": 0.0, "pool_checkout_ms": 0.0, "transaction_ms": 0.0}
        token = metrics.set(values)
        try:
            response = await call_next(_request)
            response.headers["X-Audit"] = json.dumps(values)
            response.headers["X-Audit-Rss-Kb"] = str(resource.getrusage(resource.RUSAGE_SELF).ru_maxrss)
            return response
        finally:
            metrics.reset(token)
    return app


def prepare(size: int):
    source = make_url(sqlalchemy_url(os.environ["DATABASE_URL"]))
    name = f"budgetbasket_perf_{size}"
    if source.database == name:
        raise RuntimeError("The audit must be launched from the application database")
    admin = create_engine(source.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        exists = conn.execute(text("SELECT 1 FROM pg_database WHERE datname=:name"), {"name": name}).scalar()
        if not exists:
            conn.execute(text(f'CREATE DATABASE "{name}"'))
    admin.dispose()
    url = source.set(database=name).render_as_string(hide_password=False)
    env = {**os.environ, "DATABASE_URL": url, "S3_BUCKET": "budgetbasket-performance"}
    subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], env=env, check=True, stdout=sys.stderr)
    engine = create_engine(url)
    from app.database import create_session_factory
    from app.repositories.sql_repository import SqlRepository
    from app.seed import seed_data
    seed_data(SqlRepository(create_session_factory(engine)))
    with engine.begin() as conn:
        if not conn.execute(select(TABLES["req_items"].c.id).limit(1)).first():
            stamp = datetime(2026, 1, 1, tzinfo=timezone.utc)
            for batch in range((size + 99) // 100):
                req_id = UUID(int=0xA0000000000000000000000000000000 + batch)
                year = 2000 + batch
                conn.execute(insert(TABLES["requests"]), {"id": req_id, "unit_id": UUID(MODULE_ALPHA_ID), "budget_year": year, "status": "on_review", "created_at": stamp, "updated_at": stamp})
                conn.execute(insert(TABLES["req_logs"]), {"req_id": req_id, "user_id": UUID(EMPLOYEE_ID), "created_at": stamp, "log": {"action": "created"}})
                position_id = UUID(int=0xB0000000000000000000000000000000 + batch)
                conn.execute(insert(TABLES["cfo_positions"]), {"id": position_id, "budget_year": year, "cfo_unit_id": UUID(CFO_ID), "dds_id": UUID(DDS_OPER_ID), "status": "waiting"})
                items = [{"id": UUID(int=0xC0000000000000000000000000000000 + i), "request_id": req_id, "cfo_position_id": position_id, "dds_id": UUID(DDS_LICENSE_ID), "name": f"Audit line {i}", "sum_plan": 1200, "sum_fact": 0, "status": "on_review", "is_income": i % 5 == 0, "analytics_1": f"group {i % 10}"} for i in range(batch * 100, min(size, (batch + 1) * 100))]
                conn.execute(insert(TABLES["req_items"]), items)
                conn.execute(insert(TABLES["req_item_month_plans"]), [{"req_item_id": item["id"], "month": month, "sum_plan": 100} for item in items for month in range(1, 13)])
                conn.execute(insert(TABLES["req_logs"]), [{"req_id": req_id, "user_id": UUID(ADMIN_ID), "created_at": stamp, "log": {"action": "item_updated", "entity": "req_item", "entity_id": str(item["id"]), "comment": "audit comment"}} for item in items])
    with engine.connect() as conn:
        conn.execute(text("ANALYZE"))
    engine.dispose()
    return env


def percentile(values, fraction):
    return sorted(values)[min(len(values) - 1, int((len(values) - 1) * fraction))]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--label", required=True)
    parser.add_argument("--sizes", default="100,1000,20000")
    parser.add_argument("--repeats", type=int, default=30)
    parser.add_argument("--concurrency", default="1,10")
    parser.add_argument("--new-api", action="store_true")
    parser.add_argument("--cases", default="")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    output = args.output.open("w", encoding="utf-8", newline="\n") if args.output else None

    def emit(report: dict):
        line = json.dumps(report, ensure_ascii=False)
        if output:
            output.write(line + "\n")
            output.flush()
        else:
            print(line, flush=True)

    try:
        for size in map(int, args.sizes.split(",")):
            if size not in {100, 1000, 20000}:
                raise ValueError("Supported fixture sizes: 100, 1000, 20000")
            env = prepare(size)
            process = subprocess.Popen([sys.executable, "-m", "uvicorn", "scripts.performance_audit:create_audit_app", "--factory", "--host", "127.0.0.1", "--port", "18001", "--no-access-log"], env=env, stdout=sys.stderr, stderr=sys.stderr)
            try:
                with httpx.Client(base_url="http://127.0.0.1:18001", timeout=180) as client:
                    for _ in range(120):
                        if process.poll() is not None:
                            raise RuntimeError("Audit server exited")
                        try:
                            if client.get("/health").status_code == 200:
                                break
                        except httpx.TransportError:
                            pass
                        time.sleep(.5)
                    login = client.post("/auth/login", json={"login": "admin", "password": "admin"})
                    login.raise_for_status()
                    client.headers["Authorization"] = "Bearer " + login.json()["access_token"]
                    cases = {"register": "/approval-register", "rows": f"/approval-register/rows?request_id={UUID(int=0xA0000000000000000000000000000000)}&page_size=50", "requests": "/requests", "dashboard": "/dashboard", "auth": "/auth/me", "chats": "/chats", "notifications": "/notifications"}
                    if args.new_api:
                        cases.update({"summary": {"mode": "summary"}, "scoped_rows": {"mode": "rows", "include_aggregates": False, "filters": {"request_id": str(UUID(int=0xA0000000000000000000000000000000))}}, "global_rows": {"mode": "rows", "include_aggregates": False}, "filtered_summary": {"mode": "summary", "columns": {"analytics_1": ["group 1"]}}, "requests_page": "/requests?page_size=50", "history_page": "/approval-register/history?page_size=50"})
                    if args.cases:
                        cases = {name: path for name, path in cases.items() if name in args.cases.split(",")}
                    for name, path in cases.items():
                        def run(_):
                            start = time.perf_counter()
                            response = client.post("/approval-register/query", json=path) if isinstance(path, dict) else client.get(path)
                            response.raise_for_status()
                            elapsed = (time.perf_counter() - start) * 1000
                            values = json.loads(response.headers.get("X-Audit", "{}"))
                            return {**values, "http_ms": elapsed, "json_bytes": len(response.content), "gzip_bytes": len(gzip.compress(response.content)), "rss_kb": int(response.headers.get("X-Audit-Rss-Kb", "0"))}
                        run(0)
                        for concurrency in map(int, args.concurrency.split(",")):
                            print(f"{args.label}: {size} {name} concurrency={concurrency}", file=sys.stderr, flush=True)
                            with ThreadPoolExecutor(max_workers=concurrency) as pool:
                                results = list(pool.map(run, range(args.repeats)))
                            report = {"label": args.label, "size": size, "scenario": name, "concurrency": concurrency, "samples": len(results)}
                            for key in results[0]:
                                values = [row[key] for row in results]
                                report[key + "_p50"] = round(statistics.median(values), 2)
                                report[key + "_p95"] = round(percentile(values, .95), 2)
                            emit(report)
            finally:
                process.terminate()
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
    finally:
        if output:
            output.close()


if __name__ == "__main__":
    main()

"""Read-only EXPLAIN ANALYZE on the dedicated 20,000-line fixture."""
import json
import os

from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from app.database import sqlalchemy_url


def main():
    url = make_url(sqlalchemy_url(os.environ["DATABASE_URL"])).set(database="budgetbasket_perf_20000")
    engine = create_engine(url, connect_args={"options": "-c default_transaction_read_only=on"})
    queries = {
        "legacy_items": "SELECT * FROM req_items",
        "scoped_items": "SELECT * FROM req_items WHERE request_id = :request_id",
        "workflow_context": "SELECT * FROM req_items WHERE request_id = :request_id OR cfo_position_id = :position_id",
        "legacy_logs": "SELECT * FROM req_logs",
        "scoped_logs": "SELECT * FROM req_logs WHERE req_id = :request_id",
        "month_plans": "SELECT * FROM req_item_month_plans WHERE req_item_id = ANY(ARRAY(SELECT id FROM req_items WHERE request_id = :request_id ORDER BY id LIMIT 50))",
        "history_page": "SELECT * FROM req_logs WHERE req_id = :request_id ORDER BY created_at DESC, id DESC LIMIT 51",
    }
    with engine.connect() as connection:
        for name, query in queries.items():
            plan = connection.execute(text("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) " + query), {"request_id": "a0000000-0000-0000-0000-000000000000", "position_id": "b0000000-0000-0000-0000-000000000000"}).scalar_one()
            print(json.dumps({"query": name, "sql": query, "plan": plan}), flush=True)
        indexes = connection.execute(text("SELECT indexrelname, pg_relation_size(indexrelid) AS bytes FROM pg_stat_user_indexes WHERE relname IN ('req_items','req_logs','req_item_month_plans','chat_messages','cfo_position_logs') ORDER BY indexrelname")).mappings().all()
        print(json.dumps({"existing_indexes": [dict(row) for row in indexes]}))
    engine.dispose()


if __name__ == "__main__":
    main()

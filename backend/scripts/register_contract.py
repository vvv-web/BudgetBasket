"""Read-only legacy register contract fingerprints on an unchanged database."""
import hashlib
import json
import os
import argparse
import importlib.util

from fastapi.encoders import jsonable_encoder
from sqlalchemy import create_engine

from app.database import create_session_factory, sqlalchemy_url
from app.repositories.sql_repository import SqlRepository
from app.services.permission_service import PermissionService
from app.services.request_service import RequestService
from app.services.approval_service import ApprovalService
from app.services.register_query_service import RegisterQuery, RegisterQueryService


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--legacy-source")
    args = parser.parse_args()
    engine = create_engine(sqlalchemy_url(os.environ["DATABASE_URL"]), connect_args={"options": "-c default_transaction_read_only=on"})
    repo = SqlRepository(create_session_factory(engine))
    permissions = PermissionService(repo)
    requests = RequestService(repo, permissions)
    requests.approval_service = ApprovalService(repo, permissions)
    legacy = None
    if args.legacy_source:
        spec = importlib.util.spec_from_file_location("app.services.legacy_request_service", args.legacy_source)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        legacy = module.RequestService(repo, permissions)
        legacy.approval_service = ApprovalService(repo, permissions)
    users = repo.load_all("users")
    request_rows = repo.load_all("requests")
    cases = [{}, {"is_income": True}, {"status": "approved"}, {"frozen": "fixed"}]
    cases += [{"request_id": row["id"]} for row in request_rows[:3]]
    for role in ("admin", "employee", "economist", "approver", "zgd"):
        for user in [row for row in users if row["role"] == role][:2]:
            for filters in cases:
                with repo.request_cache():
                    payload = requests.approval_register(user, **filters)
                    encoded = json.dumps(jsonable_encoder(payload), ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
                if legacy:
                    with repo.request_cache():
                        original = legacy.approval_register(user, **filters)
                    assert original == payload, (role, filters, "legacy response")
                    with repo.request_cache():
                        service = RegisterQueryService(requests)
                        summary = service.query(user, RegisterQuery(filters=filters))
                    assert summary["aggregates"] == original["aggregates"], (role, filters, "summary")
                    for page in (1, 999):
                        with repo.request_cache():
                            rows = service.query(user, RegisterQuery(mode="rows", filters=filters, page=page, include_aggregates=False))
                        pagination = requests._register_pagination(len(original["summary_items"]), page, 50)
                        expected = requests._slice_register_page(original["summary_items"], pagination["page"], 50)
                        assert rows["items"] == expected, (role, filters, page, "page")
                print(json.dumps({"role": role, "user_id": user["id"], "filters": filters, "rows": payload["aggregates"]["total_rows"], "sha256": hashlib.sha256(encoded).hexdigest()}), flush=True)
    engine.dispose()


if __name__ == "__main__":
    main()

import os
import time
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import create_engine_from_url, create_session_factory
from app.repositories.json_repository import JsonRepository
from app.repositories.sql_repository import SqlRepository
from app.routers import router
from app.seed import seed_data
from app.services import (
    AuthService,
    BudgetItemService,
    CatalogService,
    ExcelService,
    FileService,
    PermissionService,
    RequestService,
    UnitService,
    UserService,
)


def create_app() -> FastAPI:
    app = FastAPI(title="BudgetBasket API", version="0.1.0")
    settings = get_settings()
    data_root = Path(os.getenv("BUDGET_DATA_ROOT", Path(__file__).resolve().parents[1] / "data"))
    current_dir = Path(os.getenv("BUDGET_DATA_DIR", data_root / "current"))
    storage_root = Path(os.getenv("BUDGET_STORAGE_DIR", Path(__file__).resolve().parents[2] / "storage"))
    upload_dir = Path(os.getenv("BUDGET_UPLOAD_DIR", storage_root / "uploads"))
    export_dir = Path(os.getenv("BUDGET_EXPORT_DIR", storage_root / "exports"))

    engine = None
    if settings.use_database:
        engine = create_engine_from_url(settings.database_url)
        repo = SqlRepository(create_session_factory(engine))
    else:
        repo = JsonRepository(current_dir)
    seed_data(repo)

    permissions = PermissionService(repo)
    request_service = RequestService(repo, permissions)

    app.state.repo = repo
    app.state.settings = settings
    app.state.db_engine = engine
    app.state.auth_service = AuthService(repo)
    app.state.user_service = UserService(repo)
    app.state.unit_service = UnitService(repo)
    app.state.catalog_service = CatalogService(repo)
    app.state.request_service = request_service
    app.state.budget_item_service = BudgetItemService(repo, permissions, request_service)
    app.state.file_service = FileService(repo, permissions, upload_dir, settings)
    app.state.excel_service = ExcelService(repo, permissions, request_service, export_dir)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)

    @app.on_event("startup")
    def startup() -> None:
        if getattr(app.state.repo, "is_sql", False):
            app.state.repo.check_connection()
        attempts = 10 if settings.use_s3 else 1
        for attempt in range(attempts):
            try:
                app.state.file_service.ensure_bucket()
                break
            except Exception:
                if attempt == attempts - 1:
                    raise
                time.sleep(2)

    @app.on_event("shutdown")
    def shutdown() -> None:
        if app.state.db_engine is not None:
            app.state.db_engine.dispose()

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/health/db")
    def db_health() -> dict:
        if not getattr(app.state.repo, "is_sql", False):
            return {"status": "ok", "storage": "json"}
        app.state.repo.check_connection()
        return {"status": "ok", "storage": "postgresql"}

    return app


app = create_app()

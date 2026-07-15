import os
import time
from pathlib import Path

from fastapi import FastAPI
from fastapi.openapi.docs import get_swagger_ui_html
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from swagger_ui_bundle import swagger_ui_path

from app.config import Settings, get_settings
from app.database import create_engine_from_url, create_session_factory
from app.repositories.base import Repository
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
from app.services.file_guard_client import FileGuardClient


def create_app(*, repository: Repository | None = None, settings: Settings | None = None) -> FastAPI:
    app = FastAPI(title="BudgetBasket API", version="0.1.0", docs_url=None)
    # swagger-ui-bundle поставляет локальный Swagger UI с поддержкой OpenAPI 3.0.
    # Явно фиксируем версию схемы, чтобы /docs работал без внешнего CDN.
    app.openapi_version = "3.0.3"
    settings = settings or get_settings()
    storage_root = Path(os.getenv("BUDGET_STORAGE_DIR", Path(__file__).resolve().parents[2] / "storage"))
    upload_dir = Path(os.getenv("BUDGET_UPLOAD_DIR", storage_root / "uploads"))
    export_dir = Path(os.getenv("BUDGET_EXPORT_DIR", storage_root / "exports"))

    engine = None
    if repository is None:
        if not settings.database_url:
            raise RuntimeError("DATABASE_URL is required; BudgetBasket uses PostgreSQL only")
        engine = create_engine_from_url(settings.database_url)
        repository = SqlRepository(create_session_factory(engine))
    seed_data(repository)

    permissions = PermissionService(repository)
    request_service = RequestService(repository, permissions)
    file_guard = FileGuardClient(settings)

    app.state.repo = repository
    app.state.settings = settings
    app.state.db_engine = engine
    app.state.auth_service = AuthService(repository)
    app.state.user_service = UserService(repository)
    app.state.unit_service = UnitService(repository)
    app.state.catalog_service = CatalogService(repository)
    app.state.request_service = request_service
    app.state.budget_item_service = BudgetItemService(repository, permissions, request_service)
    app.state.file_guard_client = file_guard
    app.state.file_service = FileService(repository, permissions, upload_dir, settings, file_guard)
    app.state.excel_service = ExcelService(repository, permissions, request_service, app.state.file_service, export_dir, file_guard)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)
    app.mount("/docs-assets", StaticFiles(directory=swagger_ui_path), name="swagger-ui")

    @app.get("/docs", include_in_schema=False)
    def swagger_ui():
        return get_swagger_ui_html(
            openapi_url=app.openapi_url,
            title=f"{app.title} - Swagger UI",
            swagger_js_url="/docs-assets/swagger-ui-bundle.js",
            swagger_css_url="/docs-assets/swagger-ui.css",
            swagger_favicon_url="/docs-assets/favicon-32x32.png",
        )

    @app.on_event("startup")
    def startup() -> None:
        if hasattr(repository, "check_connection"):
            repository.check_connection()
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
        if engine is not None:
            engine.dispose()

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    @app.get("/health/db")
    def db_health() -> dict:
        if hasattr(repository, "check_connection"):
            repository.check_connection()
        return {"status": "ok", "storage": "postgresql"}

    return app

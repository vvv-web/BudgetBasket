import os
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.repositories.json_repository import JsonRepository
from app.routers import router
from app.seed import seed_data
from app.services import (
    ArchiveService,
    AuthService,
    BudgetItemService,
    CatalogService,
    FileService,
    PermissionService,
    RequestService,
    UnitService,
    UserService,
)


def create_app() -> FastAPI:
    app = FastAPI(title="BudgetBasket API", version="0.1.0")
    data_root = Path(os.getenv("BUDGET_DATA_ROOT", Path(__file__).resolve().parents[1] / "data"))
    current_dir = Path(os.getenv("BUDGET_DATA_DIR", data_root / "current"))
    upload_dir = Path(os.getenv("BUDGET_UPLOAD_DIR", Path(__file__).resolve().parents[1] / "uploads"))
    repo = JsonRepository(current_dir)
    seed_data(repo)

    permissions = PermissionService(repo)
    request_service = RequestService(repo, permissions)

    app.state.repo = repo
    app.state.auth_service = AuthService(repo)
    app.state.user_service = UserService(repo)
    app.state.unit_service = UnitService(repo)
    app.state.catalog_service = CatalogService(repo)
    app.state.request_service = request_service
    app.state.budget_item_service = BudgetItemService(repo, permissions, request_service)
    app.state.file_service = FileService(repo, permissions, upload_dir)
    app.state.archive_service = ArchiveService(repo, data_root)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(router)

    @app.get("/health")
    def health() -> dict:
        return {"status": "ok"}

    return app


app = create_app()

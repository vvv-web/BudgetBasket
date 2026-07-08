from typing import Annotated

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import FileResponse

from app.dependencies import current_user
from app.models import (
    AssignmentCreate,
    CatalogCreate,
    CatalogPatch,
    FileLink,
    ItemCreate,
    ItemPatch,
    LoginIn,
    MappingCreate,
    MappingPatch,
    ProfilePatch,
    RequestCreate,
    RequestPatch,
    ResponsibleIn,
    UnitCreate,
    UnitPatch,
    UserCreate,
    UserPatch,
    clean_patch,
)

router = APIRouter()
User = Annotated[dict, Depends(current_user)]


@router.post("/auth/login")
def login(request: Request, payload: LoginIn):
    return request.app.state.auth_service.login(payload.login, payload.password)


@router.get("/auth/me")
def me(user: User):
    return user


@router.get("/users")
def list_users(request: Request, user: User):
    return request.app.state.user_service.list_users(user)


@router.post("/users")
def create_user(request: Request, payload: UserCreate, user: User):
    return request.app.state.user_service.create_user(user, payload.model_dump())


@router.patch("/users/{user_id}")
def update_user(request: Request, user_id: str, payload: UserPatch, user: User):
    return request.app.state.user_service.update_user(user, user_id, clean_patch(payload))


@router.get("/profiles/{user_id}")
def get_profile(request: Request, user_id: str, user: User):
    return request.app.state.user_service.get_profile(user, user_id)


@router.patch("/profiles/{user_id}")
def update_profile(request: Request, user_id: str, payload: ProfilePatch, user: User):
    return request.app.state.user_service.update_profile(user, user_id, clean_patch(payload))


@router.get("/units")
def list_units(request: Request, user: User):
    return request.app.state.unit_service.list_units()


@router.post("/units")
def create_unit(request: Request, payload: UnitCreate, user: User):
    return request.app.state.unit_service.create_unit(user, payload.model_dump())


@router.patch("/units/{unit_id}")
def update_unit(request: Request, unit_id: str, payload: UnitPatch, user: User):
    return request.app.state.unit_service.update_unit(user, unit_id, clean_patch(payload))


@router.get("/units/tree")
def units_tree(request: Request, user: User):
    return request.app.state.unit_service.tree()


@router.post("/units/{unit_id}/responsible")
def set_responsible(request: Request, unit_id: str, payload: ResponsibleIn, user: User):
    return request.app.state.unit_service.set_responsible(user, unit_id, payload.user_id)


@router.get("/units/{unit_id}/responsible")
def get_responsible(request: Request, unit_id: str, user: User):
    return request.app.state.unit_service.get_responsible(unit_id)


@router.get("/economist-assignments")
def list_assignments(request: Request, user: User):
    return request.app.state.unit_service.list_assignments(user)


@router.post("/economist-assignments")
def create_assignment(request: Request, payload: AssignmentCreate, user: User):
    return request.app.state.unit_service.create_assignment(user, payload.model_dump())


@router.patch("/economist-assignments/{assignment_id}")
def deactivate_assignment(request: Request, assignment_id: str, user: User):
    return request.app.state.unit_service.deactivate_assignment(user, assignment_id)


@router.get("/catalog/dds")
def dds_catalog(request: Request, user: User):
    return request.app.state.catalog_service.list_catalog("dds_catalog")


@router.post("/catalog/dds")
def create_dds(request: Request, payload: CatalogCreate, user: User):
    return request.app.state.catalog_service.create_catalog(user, "dds_catalog", payload.model_dump())


@router.patch("/catalog/dds/{item_id}")
def update_dds(request: Request, item_id: str, payload: CatalogPatch, user: User):
    return request.app.state.catalog_service.update_catalog(user, "dds_catalog", item_id, clean_patch(payload))


@router.get("/catalog/invests")
def invest_catalog(request: Request, user: User):
    return request.app.state.catalog_service.list_catalog("invests_catalog")


@router.post("/catalog/invests")
def create_invest(request: Request, payload: CatalogCreate, user: User):
    return request.app.state.catalog_service.create_catalog(user, "invests_catalog", payload.model_dump())


@router.patch("/catalog/invests/{item_id}")
def update_invest(request: Request, item_id: str, payload: CatalogPatch, user: User):
    return request.app.state.catalog_service.update_catalog(user, "invests_catalog", item_id, clean_patch(payload))


@router.get("/catalog/unit-dds-mappings")
def list_dds_mappings(request: Request, user: User):
    return request.app.state.catalog_service.list_mappings("unit_dds_mappings")


@router.post("/catalog/unit-dds-mappings")
def create_dds_mapping(request: Request, payload: MappingCreate, user: User):
    return request.app.state.catalog_service.create_mapping(user, "unit_dds_mappings", payload.model_dump())


@router.patch("/catalog/unit-dds-mappings/{item_id}")
def update_dds_mapping(request: Request, item_id: str, payload: MappingPatch, user: User):
    return request.app.state.catalog_service.update_mapping(user, "unit_dds_mappings", item_id, clean_patch(payload))


@router.get("/catalog/unit-invest-mappings")
def list_invest_mappings(request: Request, user: User):
    return request.app.state.catalog_service.list_mappings("unit_invest_mappings")


@router.post("/catalog/unit-invest-mappings")
def create_invest_mapping(request: Request, payload: MappingCreate, user: User):
    return request.app.state.catalog_service.create_mapping(user, "unit_invest_mappings", payload.model_dump())


@router.patch("/catalog/unit-invest-mappings/{item_id}")
def update_invest_mapping(request: Request, item_id: str, payload: MappingPatch, user: User):
    return request.app.state.catalog_service.update_mapping(user, "unit_invest_mappings", item_id, clean_patch(payload))


@router.get("/requests")
def list_requests(request: Request, user: User, budget_year: int | None = None, status: str | None = None, unit_id: str | None = None):
    return request.app.state.request_service.list_requests(user, budget_year, status, unit_id)


@router.get("/requests/{request_id}")
def get_request(request: Request, request_id: str, user: User):
    return request.app.state.request_service.get_request(user, request_id)


@router.post("/requests")
def create_request(request: Request, payload: RequestCreate, user: User):
    return request.app.state.request_service.create_request(user, payload.model_dump())


@router.patch("/requests/{request_id}")
def patch_request(request: Request, request_id: str, payload: RequestPatch, user: User):
    return request.app.state.request_service.patch_request(user, request_id, clean_patch(payload))


@router.post("/requests/{request_id}/submit")
def submit_request(request: Request, request_id: str, user: User):
    return request.app.state.request_service.submit(user, request_id)


@router.post("/requests/{request_id}/start-review")
def start_review(request: Request, request_id: str, user: User):
    return request.app.state.request_service.start_review(user, request_id)


@router.post("/requests/{request_id}/fix")
def fix_request(request: Request, request_id: str, user: User):
    return request.app.state.request_service.fix(user, request_id)


@router.post("/requests/{request_id}/unfreeze")
def unfreeze_request(request: Request, request_id: str, user: User):
    return request.app.state.request_service.unfreeze(user, request_id)


@router.get("/requests/{request_id}/summary")
def request_summary(request: Request, request_id: str, user: User):
    request.app.state.request_service.get_request(user, request_id)
    return request.app.state.request_service.summary(request_id)


@router.get("/requests/{request_id}/dds-items")
def list_dds_items(request: Request, request_id: str, user: User):
    return request.app.state.budget_item_service.list_items(user, request_id, "dds")


@router.post("/requests/{request_id}/dds-items")
def create_dds_item(request: Request, request_id: str, payload: ItemCreate, user: User):
    return request.app.state.budget_item_service.create_item(user, request_id, "dds", payload.model_dump())


@router.patch("/dds-items/{item_id}")
def patch_dds_item(request: Request, item_id: str, payload: ItemPatch, user: User):
    return request.app.state.budget_item_service.patch_item(user, item_id, clean_patch(payload))


@router.delete("/dds-items/{item_id}")
def delete_dds_item(request: Request, item_id: str, user: User):
    request.app.state.budget_item_service.delete_item(user, item_id)
    return {"ok": True}


@router.get("/requests/{request_id}/invest-items")
def list_invest_items(request: Request, request_id: str, user: User):
    return request.app.state.budget_item_service.list_items(user, request_id, "invest")


@router.post("/requests/{request_id}/invest-items")
def create_invest_item(request: Request, request_id: str, payload: ItemCreate, user: User):
    return request.app.state.budget_item_service.create_item(user, request_id, "invest", payload.model_dump())


@router.patch("/invest-items/{item_id}")
def patch_invest_item(request: Request, item_id: str, payload: ItemPatch, user: User):
    return request.app.state.budget_item_service.patch_item(user, item_id, clean_patch(payload))


@router.delete("/invest-items/{item_id}")
def delete_invest_item(request: Request, item_id: str, user: User):
    request.app.state.budget_item_service.delete_item(user, item_id)
    return {"ok": True}


@router.post("/files/upload")
async def upload_file(request: Request, user: User, file: UploadFile = File(...)):
    return await request.app.state.file_service.upload(file)


@router.post("/dds-items/{item_id}/files")
def link_dds_file(request: Request, item_id: str, payload: FileLink, user: User):
    return request.app.state.file_service.link(user, "dds", item_id, payload.file_id)


@router.post("/invest-items/{item_id}/files")
def link_invest_file(request: Request, item_id: str, payload: FileLink, user: User):
    return request.app.state.file_service.link(user, "invest", item_id, payload.file_id)


@router.get("/dds-items/{item_id}/files")
def dds_item_files(request: Request, item_id: str, user: User):
    return request.app.state.file_service.files_for_item("dds", item_id)


@router.get("/invest-items/{item_id}/files")
def invest_item_files(request: Request, item_id: str, user: User):
    return request.app.state.file_service.files_for_item("invest", item_id)


@router.get("/files/{file_id}/download")
def download_file(request: Request, file_id: str, user: User):
    path, file = request.app.state.file_service.download_path(user, file_id)
    return FileResponse(path, filename=file["original_name"])


@router.post("/admin/archive-year/{year}")
def archive_year(request: Request, year: int, user: User):
    return request.app.state.archive_service.archive_year(user, year)


@router.get("/archive/{year}/requests")
def archive_requests(request: Request, year: int, user: User):
    return request.app.state.archive_service.list_archive_requests(user, year)


@router.get("/archive/{year}/requests/{request_id}")
def archive_request(request: Request, year: int, request_id: str, user: User):
    return request.app.state.archive_service.get_archive_request(user, year, request_id)

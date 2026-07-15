from typing import Annotated

from io import BytesIO
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Request, UploadFile
from fastapi.responses import FileResponse, StreamingResponse

from app.dependencies import current_user
from app.models import (
    AssignmentCreate,
    CatalogCreate,
    CatalogPatch,
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


@router.delete("/users/{user_id}")
def delete_user(request: Request, user_id: str, user: User):
    request.app.state.user_service.delete_user(user, user_id)
    return {"ok": True}


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


@router.delete("/units/{unit_id}")
def delete_unit(request: Request, unit_id: str, user: User):
    request.app.state.unit_service.delete_unit(user, unit_id)
    return {"ok": True}


@router.get("/units/tree")
def units_tree(request: Request, user: User):
    return request.app.state.unit_service.tree()


@router.post("/units/{unit_id}/responsible")
def set_responsible(request: Request, unit_id: str, payload: ResponsibleIn, user: User):
    return request.app.state.unit_service.set_responsible(user, unit_id, payload.user_id)


@router.get("/units/{unit_id}/responsible")
def get_responsible(request: Request, unit_id: str, user: User):
    return request.app.state.unit_service.get_responsible(unit_id)


@router.delete("/units/{unit_id}/responsible")
def clear_responsible(request: Request, unit_id: str, user: User):
    return request.app.state.unit_service.clear_responsible(user, unit_id)


@router.get("/economist-assignments")
def list_assignments(request: Request, user: User):
    return request.app.state.unit_service.list_assignments(user)


@router.post("/economist-assignments")
def create_assignment(request: Request, payload: AssignmentCreate, user: User):
    return request.app.state.unit_service.create_assignment(user, payload.model_dump())


@router.patch("/economist-assignments/{assignment_id}")
def deactivate_assignment(request: Request, assignment_id: str, user: User):
    return request.app.state.unit_service.deactivate_assignment(user, assignment_id)


def _catalog_filters(
    unit_id: str | None = None,
    module_id: str | None = None,
    q: str | None = None,
    active_only: bool = False,
) -> dict:
    return {"unit_id": unit_id, "module_id": module_id, "query": q, "active_only": active_only}


@router.get("/catalog/dds")
def dds_catalog(
    request: Request,
    user: User,
    unit_id: str | None = None,
    module_id: str | None = None,
    q: str | None = None,
    active_only: bool = False,
):
    return request.app.state.catalog_service.list_catalog("dds_catalog", **_catalog_filters(unit_id, module_id, q, active_only))


@router.post("/catalog/dds")
def create_dds(request: Request, payload: CatalogCreate, user: User):
    return request.app.state.catalog_service.create_catalog(user, "dds_catalog", payload.model_dump())


@router.patch("/catalog/dds/{item_id}")
def update_dds(request: Request, item_id: str, payload: CatalogPatch, user: User):
    return request.app.state.catalog_service.update_catalog(user, "dds_catalog", item_id, clean_patch(payload))


@router.delete("/catalog/dds/{item_id}")
def delete_dds(request: Request, item_id: str, user: User):
    request.app.state.catalog_service.delete_catalog(user, "dds_catalog", item_id)
    return {"ok": True}


@router.get("/catalog/invests")
def invest_catalog(
    request: Request,
    user: User,
    unit_id: str | None = None,
    module_id: str | None = None,
    q: str | None = None,
    active_only: bool = False,
):
    return request.app.state.catalog_service.list_catalog("invests_catalog", **_catalog_filters(unit_id, module_id, q, active_only))


@router.post("/catalog/invests")
def create_invest(request: Request, payload: CatalogCreate, user: User):
    return request.app.state.catalog_service.create_catalog(user, "invests_catalog", payload.model_dump())


@router.patch("/catalog/invests/{item_id}")
def update_invest(request: Request, item_id: str, payload: CatalogPatch, user: User):
    return request.app.state.catalog_service.update_catalog(user, "invests_catalog", item_id, clean_patch(payload))


@router.delete("/catalog/invests/{item_id}")
def delete_invest(request: Request, item_id: str, user: User):
    request.app.state.catalog_service.delete_catalog(user, "invests_catalog", item_id)
    return {"ok": True}


@router.get("/catalog/{kind}/import-template")
def catalog_import_template(request: Request, kind: str, user: User):
    buffer: BytesIO = request.app.state.excel_service.build_import_template(kind)
    filename = f"nsi_{kind}_template.xlsx"
    buffer.seek(0)
    return StreamingResponse(
        buffer,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/catalog/{kind}/import")
async def catalog_import(request: Request, kind: str, user: User, file: UploadFile = File(...), preview: bool = False):
    collection = request.app.state.catalog_service.collection_name(kind)
    return await request.app.state.excel_service.import_catalog(user, collection, file, preview=preview)


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
def list_requests(
    request: Request,
    user: User,
    status: str | None = None,
    unit_id: str | None = None,
    created_from: str | None = None,
    created_to: str | None = None,
):
    return request.app.state.request_service.list_requests(user, status, unit_id, created_from, created_to)


@router.get("/dashboard")
def dashboard(request: Request, user: User, unit_id: str | None = None):
    return request.app.state.request_service.dashboard(user, unit_id)


@router.get("/requests/export/closed")
@router.get("/requests/export/fixed")
def export_closed_requests(
    request: Request,
    user: User,
    unit_id: str | None = None,
    statuses: str | None = None,
    include_files: bool = False,
):
    selected_statuses = {status.strip() for status in statuses.split(",") if status.strip()} if statuses else None
    path = request.app.state.excel_service.export_closed_requests(user, unit_id, selected_statuses, include_files)
    media_type = "application/zip" if path.suffix == ".zip" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return FileResponse(path, filename=path.name, media_type=media_type)


@router.get("/requests/{request_id}")
def get_request(request: Request, request_id: str, user: User):
    return request.app.state.request_service.get_request(user, request_id)


@router.get("/requests/{request_id}/counterparty-contact")
def counterparty_contact(request: Request, request_id: str, user: User):
    return request.app.state.request_service.counterparty_contact(user, request_id)


@router.post("/requests")
def create_request(request: Request, payload: RequestCreate, user: User):
    return request.app.state.request_service.create_request(user, payload.model_dump())


@router.delete("/requests/{request_id}")
def delete_request(request: Request, request_id: str, user: User):
    request.app.state.request_service.delete_request(user, request_id)
    return {"ok": True}


@router.patch("/requests/{request_id}")
def patch_request(request: Request, request_id: str, payload: RequestPatch, user: User):
    return request.app.state.request_service.patch_request(user, request_id, clean_patch(payload))


@router.post("/requests/{request_id}/submit")
def submit_request(request: Request, request_id: str, user: User):
    return request.app.state.request_service.submit(user, request_id)


@router.post("/requests/{request_id}/freeze-budget")
def freeze_request_budget(request: Request, request_id: str, user: User):
    return request.app.state.request_service.freeze_budget(user, request_id)


@router.post("/requests/{request_id}/unfreeze-budget")
def unfreeze_request_budget(request: Request, request_id: str, user: User):
    return request.app.state.request_service.unfreeze_budget(user, request_id)


@router.post("/requests/{request_id}/withdraw")
def withdraw_request(request: Request, request_id: str, user: User):
    return request.app.state.request_service.withdraw(user, request_id)


@router.post("/requests/{request_id}/cancel")
def cancel_request(request: Request, request_id: str, user: User):
    return request.app.state.request_service.cancel(user, request_id)


@router.post("/requests/{request_id}/start-review")
def start_review(request: Request, request_id: str, user: User):
    return request.app.state.request_service.start_review(user, request_id)


@router.post("/requests/{request_id}/finalize")
@router.post("/requests/{request_id}/fix")
def finalize_request(request: Request, request_id: str, user: User):
    return request.app.state.request_service.finalize(user, request_id)


@router.post("/requests/{request_id}/approve-all-items")
def approve_all_request_items(request: Request, request_id: str, user: User):
    return request.app.state.request_service.approve_all_items(user, request_id)


@router.post("/requests/{request_id}/reopen")
@router.post("/requests/{request_id}/unfreeze")
def reopen_request(request: Request, request_id: str, user: User):
    return request.app.state.request_service.reopen(user, request_id)


@router.get("/requests/{request_id}/export")
def export_request(request: Request, request_id: str, user: User):
    path = request.app.state.excel_service.export_closed_request(user, request_id)
    return FileResponse(path, filename=path.name, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


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


@router.post("/dds-items/{item_id}/files")
async def upload_dds_file(
    request: Request,
    item_id: str,
    user: User,
    file: UploadFile = File(...),
):
    return await request.app.state.file_service.upload_for_item(user, "dds", item_id, file)


@router.post("/invest-items/{item_id}/files")
async def upload_invest_file(
    request: Request,
    item_id: str,
    user: User,
    file: UploadFile = File(...),
):
    return await request.app.state.file_service.upload_for_item(user, "invest", item_id, file)


@router.get("/dds-items/{item_id}/files")
def dds_item_files(request: Request, item_id: str, user: User):
    return request.app.state.file_service.files_for_item(user, "dds", item_id)


@router.get("/invest-items/{item_id}/files")
def invest_item_files(request: Request, item_id: str, user: User):
    return request.app.state.file_service.files_for_item(user, "invest", item_id)


@router.delete("/dds-items/{item_id}/files/{file_id}")
def delete_dds_item_file(request: Request, item_id: str, file_id: str, user: User):
    request.app.state.file_service.delete_link(user, "dds", item_id, file_id)
    return {"ok": True}


@router.delete("/invest-items/{item_id}/files/{file_id}")
def delete_invest_item_file(request: Request, item_id: str, file_id: str, user: User):
    request.app.state.file_service.delete_link(user, "invest", item_id, file_id)
    return {"ok": True}


@router.get("/files/{file_id}/download")
def download_file(request: Request, file_id: str, user: User):
    body, file, _storage, size, content_type = request.app.state.file_service.download(user, file_id)
    original_name = file["original_name"]
    ascii_name = "".join(char if ord(char) < 128 else "_" for char in original_name).strip() or "download"
    headers = {
        "Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(original_name)}"
    }
    if size is not None:
        headers["Content-Length"] = str(size)
    return StreamingResponse(body, media_type=content_type or "application/octet-stream", headers=headers)

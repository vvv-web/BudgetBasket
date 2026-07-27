from typing import Annotated

from io import BytesIO
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, WebSocket, WebSocketDisconnect, status
from fastapi.responses import FileResponse, StreamingResponse

from app.dependencies import current_user
from app.services.common import clean_request_item_name
from app.models import (
    AssignmentCreate,
    CatalogCreate,
    CatalogPatch,
    ChatMessageCreate,
    ChatReadPatch,
    ItemCreate,
    ItemPatch,
    LoginIn,
    ProfilePatch,
    RequestCreate,
    RequestPatch,
    ResponsibleIn,
    StepCreate,
    StepApproveIn,
    StepEdgeIn,
    StepPatch,
    StepReturnIn,
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


@router.get("/steps")
def list_steps(request: Request, user: User):
    return request.app.state.approval_service.list_steps(user)


@router.post("/steps")
def create_step(request: Request, payload: StepCreate, user: User):
    return request.app.state.approval_service.create_step(user, payload.model_dump())


@router.get("/steps/my")
def my_steps(request: Request, user: User):
    return request.app.state.approval_service.my_steps(user)


@router.get("/requests/{request_id}/approval-step")
def request_approval_step(request: Request, request_id: str, user: User):
    return request.app.state.approval_service.request_approval_step(user, request_id)


@router.get("/requests/{request_id}/approval-route")
def request_approval_route(request: Request, request_id: str, user: User):
    return request.app.state.approval_service.request_approval_route(user, request_id)


@router.post("/steps/validate")
def validate_steps(request: Request, user: User):
    return request.app.state.approval_service.validate_graph(user)


@router.post("/steps/bootstrap-reviewed")
def bootstrap_reviewed_steps(request: Request, user: User):
    return request.app.state.approval_service.bootstrap_reviewed_leaf_steps(user)


@router.get("/step-logs")
def all_step_logs(
    request: Request,
    user: User,
    step_id: str | None = None,
    user_id: str | None = None,
    action: str | None = None,
    date_from: str | None = None,
    date_to: str | None = None,
):
    return request.app.state.approval_service.all_step_logs(
        user,
        step_id=step_id,
        user_id=user_id,
        action=action,
        date_from=date_from,
        date_to=date_to,
    )


@router.post("/step-edges")
def create_step_edge(request: Request, payload: StepEdgeIn, user: User):
    return request.app.state.approval_service.create_edge(user, payload.model_dump())


@router.post("/step-edges/preview-delete")
def preview_delete_step_edge(request: Request, payload: StepEdgeIn, user: User):
    return request.app.state.approval_service.preview_delete_edge(user, payload.model_dump())


@router.delete("/step-edges")
def delete_step_edge(request: Request, payload: StepEdgeIn, user: User):
    request.app.state.approval_service.delete_edge(user, payload.model_dump())
    return {"ok": True}


@router.get("/steps/{step_id}")
def get_step(request: Request, step_id: str, user: User):
    return request.app.state.approval_service.get_step(user, step_id)


@router.patch("/steps/{step_id}")
def update_step(request: Request, step_id: str, payload: StepPatch, user: User):
    return request.app.state.approval_service.update_step(
        user,
        step_id,
        clean_patch(payload),
    )


@router.delete("/steps/{step_id}")
def delete_step(request: Request, step_id: str, user: User):
    request.app.state.approval_service.delete_step(user, step_id)
    return {"ok": True}


@router.get("/steps/{step_id}/requests")
def step_requests(request: Request, step_id: str, user: User):
    return request.app.state.approval_service.list_step_requests(user, step_id)


@router.get("/steps/{step_id}/dashboard")
def step_dashboard(request: Request, step_id: str, user: User):
    return request.app.state.approval_service.step_dashboard(user, step_id)


@router.post("/steps/{step_id}/approve")
def approve_step(request: Request, step_id: str, user: User, payload: StepApproveIn | None = None):
    return request.app.state.approval_service.approve_step(user, step_id, payload.request_ids if payload else [])


@router.post("/steps/{step_id}/requests/{request_id}/approve")
def approve_request_at_step(request: Request, step_id: str, request_id: str, user: User):
    return request.app.state.approval_service.approve_request_at_step(
        user,
        step_id,
        request_id,
    )


@router.post("/steps/{step_id}/return")
def return_step_requests(request: Request, step_id: str, payload: StepReturnIn, user: User):
    return request.app.state.approval_service.return_requests(
        user,
        step_id,
        payload.model_dump(),
    )


@router.get("/steps/{step_id}/logs")
def step_logs(request: Request, step_id: str, user: User):
    return request.app.state.approval_service.step_logs(user, step_id=step_id)


@router.get("/steps/{step_id}/export")
def export_step_requests(request: Request, step_id: str, user: User):
    request_ids = {
        item["id"]
        for item in request.app.state.approval_service.list_step_requests(user, step_id)
    }
    path = request.app.state.excel_service.export_closed_requests(
        user,
        statuses=request.app.state.excel_service.CLOSED_STATUSES,
        request_ids=request_ids,
    )
    return FileResponse(
        path,
        filename=path.name,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


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


@router.get("/dashboard/income")
def income_dashboard(request: Request, user: User, unit_id: str | None = None):
    return request.app.state.request_service.dashboard(user, unit_id, is_income=True)


@router.get("/dashboard/article-cfo")
def dashboard_article_cfo(request: Request, user: User, article_key: str, unit_id: str | None = None, is_income: bool = False):
    return request.app.state.request_service.dashboard_article_cfo(user, article_key, unit_id, is_income=is_income)


@router.get("/dashboard/articles-cfo")
def dashboard_articles_cfo(request: Request, user: User, unit_id: str | None = None, is_income: bool = False):
    return request.app.state.request_service.dashboard_articles_cfo(user, unit_id, is_income=is_income)


@router.get("/dashboard/table")
def dashboard_table(request: Request, user: User, unit_id: str | None = None, is_income: bool = False):
    return request.app.state.request_service.dashboard_table(user, unit_id, is_income=is_income)


@router.get("/requests/export/closed")
@router.get("/requests/export/fixed")
def export_closed_requests(
    request: Request,
    user: User,
    unit_id: str | None = None,
    department_id: str | None = None,
    department_ids: str | None = None,
    module_ids: str | None = None,
    statuses: str | None = None,
    include_files: bool = False,
    fixed_only: bool = False,
    export_kind: str = "all",
):
    selected_statuses = {status.strip() for status in statuses.split(",") if status.strip()} if statuses else None
    selected_department_ids = {department_id.strip() for department_id in department_ids.split(",") if department_id.strip()} if department_ids else None
    selected_module_ids = {module_id.strip() for module_id in module_ids.split(",") if module_id.strip()} if module_ids else None
    path = request.app.state.excel_service.export_closed_requests(
        user,
        unit_id,
        selected_statuses,
        include_files,
        department_id=department_id,
        department_ids=selected_department_ids,
        module_ids=selected_module_ids,
        fixed_only=fixed_only,
        export_kind=export_kind,
    )
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


@router.post("/requests/{request_id}/revoke-final-approval")
def revoke_final_approval(request: Request, request_id: str, user: User):
    return request.app.state.approval_service.revoke_final_approval(user, request_id)


@router.post("/requests/{request_id}/resume-economist-review")
def resume_economist_review(request: Request, request_id: str, user: User):
    return request.app.state.approval_service.resume_economist_review(user, request_id)


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


@router.get("/requests/{request_id}/items")
def list_request_items(request: Request, request_id: str, user: User, include_deleted: bool = True):
    return request.app.state.budget_item_service.list_items(user, request_id, include_deleted=include_deleted)


@router.post("/requests/{request_id}/items")
def create_request_item(request: Request, request_id: str, payload: ItemCreate, user: User):
    return request.app.state.budget_item_service.create_item(user, request_id, payload.model_dump())


@router.patch("/items/{item_id}")
def patch_request_item(request: Request, item_id: str, payload: ItemPatch, user: User):
    return request.app.state.budget_item_service.patch_item(user, item_id, clean_patch(payload))


@router.delete("/items/{item_id}")
def delete_request_item(request: Request, item_id: str, user: User):
    return request.app.state.budget_item_service.delete_item(user, item_id)




@router.post("/items/{item_id}/files")
async def upload_request_item_file(request: Request, item_id: str, user: User, file: UploadFile = File(...)):
    return await request.app.state.file_service.upload_for_item(user, item_id, file)


@router.get("/items/{item_id}/files")
def request_item_files(request: Request, item_id: str, user: User):
    return request.app.state.file_service.files_for_item(user, item_id)


@router.delete("/items/{item_id}/files/{file_id}")
def delete_request_item_file(request: Request, item_id: str, file_id: str, user: User):
    request.app.state.file_service.delete_link(user, item_id, file_id)
    return {"ok": True}


@router.get("/requests/{request_id}/logs")
def request_logs(request: Request, request_id: str, user: User):
    budget_request = request.app.state.request_service.get_request(user, request_id)
    logs = [item for item in request.app.state.repo.load_all("req_logs") if item.get("req_id") == budget_request["id"]]
    users = {item["id"]: item for item in request.app.state.repo.load_all("users")}
    profiles = {item["user_id"]: item for item in request.app.state.repo.load_all("profiles")}
    request_items = {item["id"]: item for item in request.app.state.repo.load_all("req_items") if item.get("request_id") == budget_request["id"]}
    catalogs = {
        "dds_id": {item["id"]: item for item in request.app.state.repo.load_all("dds_catalog")},
        "invest_id": {item["id"]: item for item in request.app.state.repo.load_all("invests_catalog")},
    }

    def catalog_name(field: str, item_id: str | None) -> str | None:
        if item_id is None:
            return None
        return catalogs[field].get(item_id, {}).get("name", item_id)

    def request_line_context(log: dict) -> dict | None:
        changes = log.get("changes") or {}
        item_id = log.get("entity_id") if log.get("entity") == "req_item" else None
        if not item_id:
            item_change = changes.get("item_id") or {}
            item_id = item_change.get("to") or item_change.get("from")
        item = request_items.get(item_id) if item_id else None
        if not item:
            return None
        article_field = "dds_id" if item.get("dds_id") else "invest_id"
        article = catalogs[article_field].get(item.get(article_field), {})
        category = catalogs[article_field].get(article.get("parent_id"), {})
        return {
            "type": "request_line",
            "name": clean_request_item_name(item.get("name")) or changes.get("name", {}).get("to") or changes.get("name", {}).get("from"),
            "article": article.get("name"),
            "category": category.get("name"),
        }

    result = []
    for item in logs:
        actor = users.get(item.get("user_id"))
        log = item.get("log") or {}
        changes = {field: dict(change) for field, change in (log.get("changes") or {}).items()}
        for field in ("dds_id", "invest_id"):
            if field in changes:
                changes[field]["from"] = catalog_name(field, changes[field].get("from"))
                changes[field]["to"] = catalog_name(field, changes[field].get("to"))
        public_log = {**log, "changes": changes}
        result.append(
            {
                **item,
                "log": public_log,
                "subject": request_line_context(public_log),
                "user": (
                    {
                        "id": actor["id"],
                        "login": actor["login"],
                        "role": actor["role"],
                        "profile": profiles.get(actor["id"]),
                    }
                    if actor
                    else None
                ),
            }
        )
    return sorted(result, key=lambda item: str(item.get("created_at") or ""), reverse=True)


@router.get("/requests/{request_id}/chat")
def request_chat(request: Request, request_id: str, user: User):
    return request.app.state.chat_service.get_chat(user, request_id)


@router.get("/chats")
def list_chats(request: Request, user: User):
    return request.app.state.chat_service.list_chats(user)


@router.post("/requests/{request_id}/chat/messages")
async def send_chat_message(request: Request, request_id: str, payload: ChatMessageCreate, user: User):
    message = request.app.state.chat_service.send(user, request_id, payload.model_dump())
    await request.app.state.chat_connections.broadcast(
        request_id,
        {"type": "chat.message.created", "message_id": message["id"]},
    )
    event = {"type": "chat.message.created", "request_id": request_id, "message_id": message["id"], "text": message["text"]}
    for user_id in request.app.state.chat_service.notification_recipient_ids(request_id, user["id"]):
        await request.app.state.chat_connections.broadcast_user(user_id, event)
    return message


@router.patch("/requests/{request_id}/chat/read")
def mark_chat_read(request: Request, request_id: str, payload: ChatReadPatch, user: User):
    return request.app.state.chat_service.mark_read(user, request_id, payload.last_read_message_id)


@router.websocket("/ws/requests/{request_id}/chat")
async def request_chat_websocket(websocket: WebSocket, request_id: str):
    token = websocket.query_params.get("token")
    try:
        user = websocket.app.state.auth_service.me(token)
        websocket.app.state.chat_service.get_chat(user, request_id)
    except HTTPException:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.app.state.chat_connections.connect(request_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        websocket.app.state.chat_connections.disconnect(request_id, websocket)


@router.websocket("/ws/chat-notifications")
async def chat_notifications_websocket(websocket: WebSocket):
    token = websocket.query_params.get("token")
    try:
        user = websocket.app.state.auth_service.me(token)
    except HTTPException:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.app.state.chat_connections.connect_user(user["id"], websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        websocket.app.state.chat_connections.disconnect_user(user["id"], websocket)


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

from typing import Annotated

from io import BytesIO
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect, status
from fastapi.responses import FileResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool
from starlette.background import BackgroundTask

from app.dependencies import current_user
from app.repositories.queries import find_rows
from app.services.common import clean_request_item_name
from app.services.register_query_service import FilteredGroupDecision, FilteredGroupWorkflowAction, RegisterExport, RegisterQuery, RegisterQueryService
from app.models import (
    AssignmentCreate,
    CatalogCreate,
    CatalogPatch,
    ChatMessageCreate,
    ChatReadPatch,
    BulkItemDecisionIn,
    BulkPositionLineApprovalIn,
    CfoPositionActionIn,
    CfoPositionCommentIn,
    CfoPositionReturnIn,
    CfoPositionRevisionIn,
    CfoRevisionSelectionIn,
    ItemCreate,
    ItemDecisionIn,
    ItemPatch,
    AnalyticsFieldsPatch,
    LoginIn,
    ProfilePatch,
    RegisterGroupDecisionIn,
    RegisterGroupCfoRevisionIn,
    RegisterGroupWorkflowActionIn,
    RequestCreate,
    RequestPatch,
    ResponsibleIn,
    StepCreate,
    StepApproveIn,
    StepEdgeIn,
    StepPatch,
    NotificationReadIn,
    UnitCreate,
    UnitPatch,
    UserCreate,
    UserPatch,
    clean_patch,
)

router = APIRouter()
User = Annotated[dict, Depends(current_user)]


@router.post("/approval-register/query")
def query_register(request: Request, user: User, payload: RegisterQuery):
    return RegisterQueryService(request.app.state.request_service).query(user, payload)


def _filtered_action_scope(request: Request, user: dict, query: RegisterQuery | None):
    if query is None:
        return {}
    selected = RegisterQueryService(request.app.state.request_service).query(user, query.model_copy(update={"mode": "selection"}))
    return {"item_ids": set(selected["item_ids"])}


@router.post("/approval-register/export")
def export_register_query(request: Request, user: User, payload: RegisterExport):
    query = payload.query.model_copy(update={"mode": "selection"})
    if payload.export_kind != "all":
        query.filters = query.filters.model_copy(update={"is_income": payload.export_kind == "income"})
    selection = RegisterQueryService(request.app.state.request_service).query(user, query)
    filters = query.filters.model_dump(exclude_none=True, exclude={"frozen"})
    path = request.app.state.excel_service.export_approval_register(
        user, view=query.view, group_by=query.group_by, **filters,
        item_ids=set(selection["item_ids"]), include_files=payload.include_files,
        export_kind=payload.export_kind, fixed_only=payload.fixed_only,
        department_ids=set(payload.department_ids) if payload.department_ids else None,
        module_ids=set(payload.module_ids) if payload.module_ids else None,
    )
    media_type = "application/zip" if path.suffix == ".zip" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return FileResponse(path, filename=path.name, media_type=media_type)


async def _broadcast_notifications(request: Request, result: dict, event_type: str) -> dict:
    for user_id in result.get("notification_user_ids", []):
        await request.app.state.chat_connections.broadcast_user(
            user_id,
            {"type": event_type, "reload_required": True},
        )
    return result


async def _broadcast_workflow_result(request: Request, result: dict, event_type: str, sender_id: str) -> dict:
    await _broadcast_notifications(request, result, event_type)
    for message in result.get("chat_messages", []):
        await _broadcast_chat_message(request, message["chat_id"], message, sender_id)
    return result


@router.post("/auth/login")
def login(request: Request, payload: LoginIn):
    return request.app.state.auth_service.login(payload.login, payload.password)


@router.get("/auth/me")
def me(user: User):
    return user


@router.get("/steps")
def list_steps(request: Request, user: User):
    return request.app.state.approval_service.list_steps(user)


@router.get("/approval-route")
def cfo_route(request: Request, user: User, request_id: str | None = None):
    return request.app.state.approval_service.approval_route(user, request_id=request_id)


@router.post("/steps")
def create_step(request: Request, payload: StepCreate, user: User):
    return request.app.state.approval_service.create_step(user, payload.model_dump())


@router.get("/steps/my")
def my_steps(request: Request, user: User):
    return request.app.state.approval_service.my_steps(user)


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


@router.get("/steps/{step_id}/positions")
def step_positions(request: Request, step_id: str, user: User):
    return request.app.state.approval_service.list_step_positions(user, step_id)


@router.get("/steps/{step_id}/dashboard")
def step_dashboard(request: Request, step_id: str, user: User):
    return request.app.state.approval_service.step_dashboard(user, step_id)


@router.post("/steps/{step_id}/approve")
async def approve_step(request: Request, step_id: str, user: User, payload: StepApproveIn | None = None):
    result = await run_in_threadpool(request.app.state.approval_service.approve_step, user, step_id, payload.position_ids if payload else [])
    for position in result["positions"]:
        await _broadcast_notifications(request, position, "cfo_position.assigned")
    return result


@router.post("/steps/{step_id}/positions/{position_id}/approve")
async def approve_position_at_step(
    request: Request, step_id: str, position_id: str,
    payload: CfoPositionActionIn, user: User,
):
    result = await run_in_threadpool(request.app.state.approval_service.approve_position_at_step, user, step_id, position_id, payload.comment, payload.item_ids, event_id=payload.event_id)
    return await _broadcast_notifications(request, result, "cfo_position.updated")


@router.post("/approval-position-lines/approve/bulk")
async def approve_position_lines_bulk(
    request: Request, payload: BulkPositionLineApprovalIn, user: User,
):
    result = await run_in_threadpool(
        request.app.state.approval_service.approve_position_lines_bulk,
        user,
        [item.model_dump() for item in payload.positions],
        payload.comment,
        payload.event_id,
    )
    return await _broadcast_notifications(request, result, "cfo_position.updated")


@router.post("/steps/{step_id}/positions/{position_id}/return")
async def return_position_at_step(
    request: Request, step_id: str, position_id: str,
    payload: CfoPositionReturnIn, user: User,
):
    result = await run_in_threadpool(request.app.state.approval_service.return_position, user, step_id, position_id, payload.target_step_id or "", payload.comment, payload.item_ids)
    return await _broadcast_notifications(request, result, "cfo_position.returned")


@router.get("/steps/{step_id}/logs")
def step_logs(request: Request, step_id: str, user: User):
    return request.app.state.approval_service.step_logs(user, step_id=step_id)


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


@router.get("/unit-responsibles")
def list_unit_responsibles(request: Request, user: User):
    return request.app.state.unit_service.list_responsibles(user)


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


@router.post("/catalog/dds/{item_id}/default-category")
def ensure_dds_default_category(request: Request, item_id: str, user: User):
    return request.app.state.catalog_service.ensure_default_category(user, "dds_catalog", item_id)


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


@router.post("/catalog/invests/{item_id}/default-category")
def ensure_invest_default_category(request: Request, item_id: str, user: User):
    return request.app.state.catalog_service.ensure_default_category(user, "invests_catalog", item_id)


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
    collection = await run_in_threadpool(request.app.state.catalog_service.collection_name, kind)
    return await request.app.state.excel_service.import_catalog(user, collection, file, preview=preview)


@router.get("/requests")
def list_requests(
    request: Request,
    user: User,
    status: str | None = None,
    unit_id: str | None = None,
    created_from: str | None = None,
    created_to: str | None = None,
    budget_year: int | None = None,
    page: int = Query(default=1, ge=1),
    page_size: int | None = Query(default=None, ge=1, le=200),
):
    return request.app.state.request_service.list_requests(
        user, status, unit_id, created_from, created_to, budget_year, page=page, page_size=page_size
    )


@router.get("/cfo/incoming-requests")
def list_cfo_incoming_requests(request: Request, user: User):
    return request.app.state.request_service.list_cfo_incoming(user)


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


@router.get("/approval-register/analytics-filters")
def approval_register_analytics_filters(
    request: Request,
    user: User,
    budget_year: int | None = None,
    cfo_id: str | None = None,
    category_id: str | None = None,
    article_id: str | None = None,
    module_id: str | None = None,
    request_id: str | None = None,
    status: str | None = None,
    request_status: str | None = None,
    frozen: str | None = None,
    search: str | None = None,
    mine_only: bool = False,
    is_income: bool | None = None,
    positioned_only: bool = False,
    analytics_1: str | None = None,
    analytics_2: str | None = None,
    analytics_3: str | None = None,
    analytics_4: str | None = None,
    analytics_5: str | None = None,
):
    return request.app.state.request_service.approval_register_analytics_filters(
        user,
        budget_year=budget_year,
        cfo_id=cfo_id,
        category_id=category_id,
        article_id=article_id,
        module_id=module_id,
        request_id=request_id,
        status=status,
        request_status=request_status,
        frozen=frozen,
        search=search,
        mine_only=mine_only,
        is_income=is_income,
        positioned_only=positioned_only,
        analytics_1=analytics_1,
        analytics_2=analytics_2,
        analytics_3=analytics_3,
        analytics_4=analytics_4,
        analytics_5=analytics_5,
    )


@router.get("/approval-register")
def approval_register(
    request: Request,
    user: User,
    view: str = "cfo",
    budget_year: int | None = None,
    cfo_id: str | None = None,
    category_id: str | None = None,
    article_id: str | None = None,
    module_id: str | None = None,
    request_id: str | None = None,
    status: str | None = None,
    request_status: str | None = None,
    frozen: str | None = None,
    search: str | None = None,
    mine_only: bool = False,
    is_income: bool | None = None,
    positioned_only: bool = False,
    analytics_1: str | None = None,
    analytics_2: str | None = None,
    analytics_3: str | None = None,
    analytics_4: str | None = None,
    analytics_5: str | None = None,
    group_by: Annotated[list[str] | None, Query(alias="group_by[]")] = None,
):
    return request.app.state.request_service.approval_register(
        user, view, budget_year=budget_year, cfo_id=cfo_id,
        category_id=category_id, article_id=article_id, module_id=module_id, request_id=request_id,
        status=status, request_status=request_status, search=search,
        frozen=frozen,
        mine_only=mine_only, is_income=is_income,
        positioned_only=positioned_only,
        analytics_1=analytics_1,
        analytics_2=analytics_2,
        analytics_3=analytics_3,
        analytics_4=analytics_4,
        analytics_5=analytics_5,
        group_by=group_by,
    )


@router.get("/approval-register/export")
def export_approval_register(
    request: Request,
    user: User,
    view: str = "cfo",
    budget_year: int | None = None,
    cfo_id: str | None = None,
    category_id: str | None = None,
    article_id: str | None = None,
    module_id: str | None = None,
    request_id: str | None = None,
    status: str | None = None,
    request_status: str | None = None,
    search: str | None = None,
    mine_only: bool = False,
    is_income: bool | None = None,
    analytics_1: str | None = None,
    analytics_2: str | None = None,
    analytics_3: str | None = None,
    analytics_4: str | None = None,
    analytics_5: str | None = None,
    item_ids: str | None = None,
    include_files: bool = True,
    export_kind: str = "all",
    fixed_only: bool = False,
    positioned_only: bool = False,
    department_ids: str | None = None,
    module_ids: str | None = None,
    group_by: Annotated[list[str] | None, Query(alias="group_by[]")] = None,
):
    selected_item_ids = (
        {item_id.strip() for item_id in item_ids.split(",") if item_id.strip()}
        if item_ids is not None
        else None
    )
    selected_department_ids = (
        {department_id.strip() for department_id in department_ids.split(",") if department_id.strip()}
        if department_ids
        else None
    )
    selected_module_ids = (
        {module_id.strip() for module_id in module_ids.split(",") if module_id.strip()}
        if module_ids
        else None
    )
    path = request.app.state.excel_service.export_approval_register(
        user,
        view=view,
        budget_year=budget_year,
        cfo_id=cfo_id,
        category_id=category_id,
        article_id=article_id,
        module_id=module_id,
        request_id=request_id,
        status=status,
        request_status=request_status,
        search=search,
        mine_only=mine_only,
        is_income=is_income,
        analytics_1=analytics_1,
        analytics_2=analytics_2,
        analytics_3=analytics_3,
        analytics_4=analytics_4,
        analytics_5=analytics_5,
        group_by=group_by,
        item_ids=selected_item_ids,
        include_files=include_files,
        export_kind=export_kind,
        fixed_only=fixed_only,
        positioned_only=positioned_only,
        department_ids=selected_department_ids,
        module_ids=selected_module_ids,
    )
    media_type = "application/zip" if path.suffix == ".zip" else "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    return FileResponse(path, filename=path.name, media_type=media_type)


@router.get("/approval-register/rows")
def approval_register_rows(
    request: Request,
    user: User,
    module_id: str | None = None,
    request_id: str | None = None,
    page: int = 1,
    page_size: int = 50,
    budget_year: int | None = None,
    cfo_id: str | None = None,
    category_id: str | None = None,
    article_id: str | None = None,
    status: str | None = None,
    request_status: str | None = None,
    frozen: str | None = None,
    search: str | None = None,
    mine_only: bool = False,
    is_income: bool | None = None,
    positioned_only: bool = False,
    analytics_1: str | None = None,
    analytics_2: str | None = None,
    analytics_3: str | None = None,
    analytics_4: str | None = None,
    analytics_5: str | None = None,
):
    if page < 1:
        raise HTTPException(status_code=422, detail="Номер страницы должен быть не меньше 1")
    if not any([module_id, article_id, category_id, cfo_id, request_id, analytics_1, analytics_2, analytics_3, analytics_4, analytics_5]):
        raise HTTPException(
            status_code=422,
            detail="Укажите область строк: module_id, article_id, category_id, cfo_id или request_id",
        )
    return request.app.state.request_service.approval_register_rows(
        user, page, page_size, request_id=request_id, budget_year=budget_year, cfo_id=cfo_id,
        category_id=category_id, article_id=article_id, module_id=module_id, status=status,
        request_status=request_status, search=search, mine_only=mine_only,
        frozen=frozen,
        is_income=is_income,
        positioned_only=positioned_only,
        analytics_1=analytics_1,
        analytics_2=analytics_2,
        analytics_3=analytics_3,
        analytics_4=analytics_4,
        analytics_5=analytics_5,
    )


@router.post("/approval-register/groups/{group_type}/{group_id}/cfo-decision")
def decide_approval_register_group_cfo(
    request: Request,
    group_type: str,
    group_id: str,
    payload: FilteredGroupDecision,
    user: User,
    request_id: str | None = None,
):
    item_ids = request.app.state.request_service.approval_register_group_item_ids(
        user, group_type, group_id, request_id=request_id, **_filtered_action_scope(request, user, payload.register_query),
    )
    return request.app.state.budget_item_service.bulk_decide_cfo(
        user,
        {"item_ids": item_ids, "decision": payload.decision, "comment": payload.comment},
    )


@router.patch("/approval-register/groups/{group_type}/{group_id}/analytics")
def apply_approval_register_group_analytics(
    request: Request,
    group_type: str,
    group_id: str,
    payload: AnalyticsFieldsPatch,
    user: User,
    request_id: str | None = None,
    status: str | None = None,
    budget_year: int | None = None,
    search: str | None = None,
    analytics_1: str | None = None,
    analytics_2: str | None = None,
    analytics_3: str | None = None,
    analytics_4: str | None = None,
    analytics_5: str | None = None,
):
    patch = clean_patch(payload)
    if not patch:
        raise HTTPException(status_code=400, detail="Укажите поля аналитики")
    filters = {
        "request_id": request_id,
        "status": status,
        "budget_year": budget_year,
        "search": search,
        "analytics_1": analytics_1,
        "analytics_2": analytics_2,
        "analytics_3": analytics_3,
        "analytics_4": analytics_4,
        "analytics_5": analytics_5,
    }
    item_ids = request.app.state.request_service.approval_register_group_analytics_item_ids(
        user, group_type, group_id, **filters,
    )
    return request.app.state.budget_item_service.apply_analytics_bulk(user, item_ids, patch)


@router.get("/approval-register/groups/{group_type}/{group_id}/actionable-rows")
def approval_register_actionable_rows(
    request: Request,
    group_type: str,
    group_id: str,
    user: User,
    request_id: str | None = None,
    status: str | None = None,
    budget_year: int | None = None,
    search: str | None = None,
):
    return request.app.state.request_service.approval_register_group_actionable_rows(
        user,
        group_type,
        group_id,
        request_id=request_id,
        status=status,
        budget_year=budget_year,
        search=search,
    )


@router.get("/approval-register/groups/{group_type}/{group_id}/revision-lines")
def approval_register_revision_lines(
    request: Request,
    group_type: str,
    group_id: str,
    user: User,
    mode: str | None = None,
    request_id: str | None = None,
):
    return request.app.state.request_service.approval_register_group_revision_lines(
        user, group_type, group_id, mode=mode, request_id=request_id,
    )


@router.post("/approval-register/groups/{group_type}/{group_id}/cfo-revision")
async def cfo_revision_approval_register_group(
    request: Request,
    group_type: str,
    group_id: str,
    payload: RegisterGroupCfoRevisionIn,
    user: User,
    request_id: str | None = None,
):
    result = await run_in_threadpool(request.app.state.budget_item_service.cfo_revision_from_register, user, group_type, group_id, payload.model_dump(), request_id=request_id)
    for message in result.get("chat_messages", []):
        await _broadcast_chat_message(request, message["chat_id"], message, user["id"])
    return result


@router.get("/requests/export/closed")
@router.get("/requests/export/fixed")
def export_closed_requests(
    request: Request,
    user: User,
    unit_id: str | None = None,
    department_id: str | None = None,
    department_ids: str | None = None,
    module_ids: str | None = None,
    request_ids: str | None = None,
    statuses: str | None = None,
    include_files: bool = False,
    fixed_only: bool = False,
    export_kind: str = "all",
):
    selected_statuses = {status.strip() for status in statuses.split(",") if status.strip()} if statuses else None
    selected_department_ids = {department_id.strip() for department_id in department_ids.split(",") if department_id.strip()} if department_ids else None
    selected_module_ids = {module_id.strip() for module_id in module_ids.split(",") if module_id.strip()} if module_ids else None
    selected_request_ids = (
        {request_id.strip() for request_id in request_ids.split(",") if request_id.strip()}
        if request_ids is not None
        else None
    )
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
        request_ids=selected_request_ids,
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
async def submit_request(request: Request, request_id: str, user: User):
    result = await run_in_threadpool(request.app.state.request_service.submit, user, request_id)
    return await _broadcast_notifications(request, result, "request.submitted_to_cfo")


@router.post("/requests/{request_id}/cancel")
def cancel_request(request: Request, request_id: str, user: User):
    return request.app.state.request_service.cancel(user, request_id)


@router.post("/requests/{request_id}/restore")
def restore_request(request: Request, request_id: str, user: User):
    return request.app.state.request_service.restore(user, request_id)


@router.post("/requests/{request_id}/complete-cfo-review")
async def complete_cfo_review(request: Request, request_id: str, user: User):
    result = await run_in_threadpool(request.app.state.request_service.complete_cfo_review, user, request_id)
    return await _broadcast_notifications(request, result, "request.cfo_review_completed")


@router.get("/requests/{request_id}/export")
def export_request(request: Request, request_id: str, user: User):
    path = request.app.state.excel_service.export_closed_request(user, request_id)
    return FileResponse(path, filename=path.name, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@router.get("/requests/{request_id}/summary")
def request_summary(request: Request, request_id: str, user: User):
    request.app.state.request_service.get_request(user, request_id)
    return request.app.state.request_service.summary(request_id)


@router.get("/requests/{request_id}/items")
def list_request_items(request: Request, request_id: str, user: User, include_deleted: bool = True, page: Annotated[int, Query(ge=1)] = 1, page_size: Annotated[int | None, Query(ge=1, le=200)] = None):
    return request.app.state.budget_item_service.list_items(user, request_id, include_deleted=include_deleted, page=page, page_size=page_size)


@router.post("/requests/{request_id}/items")
def create_request_item(request: Request, request_id: str, payload: ItemCreate, user: User):
    return request.app.state.budget_item_service.create_item(user, request_id, payload.model_dump(exclude_unset=True))


@router.patch("/items/{item_id}")
def patch_request_item(request: Request, item_id: str, payload: ItemPatch, user: User):
    return request.app.state.budget_item_service.patch_item(user, item_id, clean_patch(payload))


@router.post("/items/{item_id}/cfo-decision")
async def decide_request_item_cfo(
    request: Request, item_id: str, payload: ItemDecisionIn, user: User
):
    result = await run_in_threadpool(request.app.state.budget_item_service.decide_cfo, user, item_id, payload.model_dump(exclude_unset=True))
    for message in result.get("chat_messages", []):
        await _broadcast_chat_message(request, message["chat_id"], message, user["id"])
    return result


@router.post("/items/{item_id}/cfo-revision-selection")
def select_request_item_cfo_revision(
    request: Request, item_id: str, payload: CfoRevisionSelectionIn, user: User
):
    """Store a table-level revision choice; the dialog performs the handoff."""
    return request.app.state.budget_item_service.select_cfo_revision(
        user, item_id, payload.model_dump()
    )


@router.post("/approval-register/groups/{group_type}/{group_id}/workflow-action")
async def act_on_approval_register_group(
    request: Request,
    group_type: str,
    group_id: str,
    payload: FilteredGroupWorkflowAction,
    user: User,
    request_id: str | None = None,
):
    scope = await run_in_threadpool(_filtered_action_scope, request, user, payload.register_query)
    position_ids = await run_in_threadpool(request.app.state.request_service.approval_register_group_position_ids, user, group_type, group_id, action=payload.action, request_id=request_id, **scope)
    if payload.action == "submit":
        result = await run_in_threadpool(request.app.state.approval_service.submit_positions_from_register, user, position_ids, payload.comment)
        return await _broadcast_notifications(request, result, "cfo_position.assigned")
    if payload.action == "approve":
        result = await run_in_threadpool(request.app.state.approval_service.approve_positions_from_register, user, position_ids, payload.comment)
        return await _broadcast_notifications(request, result, "cfo_position.updated")
    if payload.action == "fix":
        result = await run_in_threadpool(request.app.state.approval_service.fix_positions_from_register, user, position_ids, payload.comment)
        return await _broadcast_notifications(request, result, "cfo_position.updated")
    if payload.action == "unfix":
        result = await run_in_threadpool(request.app.state.approval_service.unfix_positions_from_register, user, position_ids, payload.comment)
        return await _broadcast_notifications(request, result, "cfo_position.updated")
    result = await run_in_threadpool(request.app.state.approval_service.return_positions_from_register, user, position_ids, payload.target_step_id or "", payload.comment, [item.model_dump() for item in payload.items] if payload.items else None)
    return await _broadcast_workflow_result(request, result, "cfo_position.returned", user["id"])


@router.post("/items/cfo-decision/bulk")
def bulk_decide_request_items_cfo(
    request: Request, payload: BulkItemDecisionIn, user: User
):
    return request.app.state.budget_item_service.bulk_decide_cfo(
        user, payload.model_dump()
    )


@router.delete("/items/{item_id}")
def delete_request_item(request: Request, item_id: str, user: User):
    return request.app.state.budget_item_service.delete_item(user, item_id)




@router.post("/items/{item_id}/files")
async def upload_request_item_file(request: Request, item_id: str, user: User, file: UploadFile = File(...)):
    return await request.app.state.file_service.upload_for_item(user, item_id, file)


@router.get("/items/{item_id}/files")
def request_item_files(request: Request, item_id: str, user: User, page: Annotated[int, Query(ge=1)] = 1, page_size: Annotated[int | None, Query(ge=1, le=200)] = None):
    return request.app.state.file_service.files_for_item(user, item_id, page=page, page_size=page_size)


@router.delete("/items/{item_id}/files/{file_id}")
def delete_request_item_file(request: Request, item_id: str, file_id: str, user: User):
    request.app.state.file_service.delete_link(user, item_id, file_id)
    return {"ok": True}


@router.get("/requests/{request_id}/logs")
def request_logs(request: Request, request_id: str, user: User, page_size: Annotated[int | None, Query(ge=1, le=200)] = None, before: str | None = None):
    budget_request = request.app.state.request_service.get_request(user, request_id)
    logs = request.app.state.approval_service.request_history(user, budget_request["id"], page_size=page_size, before=before)
    paged = logs if page_size else None
    logs = logs["items"] if paged else logs
    users = {item["id"]: item for item in find_rows(request.app.state.repo, "users", in_filters={"id": {row.get("user_id") for row in logs}})}
    profiles = {item["user_id"]: item for item in find_rows(request.app.state.repo, "profiles", in_filters={"user_id": set(users)})}
    request_items = {item["id"]: item for item in find_rows(request.app.state.repo, "req_items", filters={"request_id": budget_request["id"]}) if item.get("request_id") == budget_request["id"]}
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
        category = catalogs[article_field].get(item.get(article_field), {})
        article = catalogs[article_field].get(category.get("parent_id"), {})
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
    return {**paged, "items": result} if paged else sorted(result, key=lambda item: str(item.get("created_at") or ""), reverse=True)


@router.get("/approval-register/history")
def approval_register_history(request: Request, user: User, page_size: Annotated[int | None, Query(ge=1, le=200)] = None, before: str | None = None):
    """A combined, permission-scoped audit trail for the register."""
    logs = request.app.state.approval_service.register_history(user, page_size=page_size, before=before)
    paged = logs if page_size else None
    logs = logs["items"] if paged else logs
    users = {item["id"]: item for item in find_rows(request.app.state.repo, "users", in_filters={"id": {row.get("user_id") for row in logs}})}
    profiles = {item["user_id"]: item for item in find_rows(request.app.state.repo, "profiles", in_filters={"user_id": set(users)})}
    request_ids = {row.get("req_id") for row in logs if row.get("req_id")}
    position_ids = {row.get("cfo_position_id") for row in logs if row.get("cfo_position_id")}
    for row in logs:
        log = row.get("log") or {}
        if log.get("request_id"):
            request_ids.add(log["request_id"])
    related_items = find_rows(request.app.state.repo, "req_items", in_filters={"request_id": request_ids})
    related_items += find_rows(request.app.state.repo, "req_items", in_filters={"cfo_position_id": position_ids})
    request_items = {item["id"]: item for item in related_items}
    request_ids.update(item["request_id"] for item in related_items)
    requests = {item["id"]: item for item in find_rows(request.app.state.repo, "requests", in_filters={"id": request_ids})}
    units = {item["id"]: item for item in request.app.state.repo.load_all("units")}
    position_items: dict[str, list[dict]] = {}
    for request_item in request_items.values():
        position_id = request_item.get("cfo_position_id")
        if position_id:
            position_items.setdefault(position_id, []).append(request_item)
    catalogs = {
        "dds_id": {item["id"]: item for item in request.app.state.repo.load_all("dds_catalog")},
        "invest_id": {item["id"]: item for item in request.app.state.repo.load_all("invests_catalog")},
    }

    def line_context(log: dict) -> dict | None:
        changes = log.get("changes") or {}
        item_id = log.get("entity_id") if log.get("entity") == "req_item" else None
        if not item_id:
            item_change = changes.get("item_id") or {}
            item_id = item_change.get("to") or item_change.get("from") or log.get("req_item_id")
        # Older reviewer decisions were saved against the CFO position while
        # retaining the selected item in item_ids. Recover the line context
        # for single-line events without mutating the audit record.
        if not item_id:
            item_ids = log.get("item_ids") or []
            if len(item_ids) == 1:
                item_id = item_ids[0]
        item = request_items.get(item_id) if item_id else None
        if not item:
            return None
        article_field = "dds_id" if item.get("dds_id") else "invest_id"
        category = catalogs[article_field].get(item.get(article_field), {})
        article = catalogs[article_field].get(category.get("parent_id"), {})
        return {
            "type": "request_line",
            "name": clean_request_item_name(item.get("name")) or changes.get("name", {}).get("to") or changes.get("name", {}).get("from"),
            "article": article.get("name"),
            "category": category.get("name"),
        }

    result = []
    for item in logs:
        log = item.get("log") or {}
        changes = {field: dict(change) for field, change in (log.get("changes") or {}).items()}
        for field in ("dds_id", "invest_id"):
            if field in changes:
                catalog = catalogs[field]
                changes[field]["from"] = catalog.get(changes[field].get("from"), {}).get("name", changes[field].get("from"))
                changes[field]["to"] = catalog.get(changes[field].get("to"), {}).get("name", changes[field].get("to"))
        public_log = {**log, "changes": changes}
        if public_log.get("item_ids"):
            contexts = []
            for item_id in public_log["item_ids"]:
                linked_item = request_items.get(item_id)
                if not linked_item:
                    continue
                linked_request = requests.get(linked_item.get("request_id"), {})
                contexts.append({
                    "id": item_id,
                    "name": clean_request_item_name(linked_item.get("name")),
                    "request_id": linked_item.get("request_id"),
                    "request_unit_name": units.get(linked_request.get("unit_id"), {}).get("name"),
                })
            public_log["item_contexts"] = contexts
            public_log["request_ids"] = sorted({row["request_id"] for row in contexts if row.get("request_id")})
        request_id = public_log.get("request_id")
        if not request_id:
            item_id = public_log.get("req_item_id") or public_log.get("entity_id")
            request_id = request_items.get(item_id, {}).get("request_id")
        if not request_id and item.get("cfo_position_id"):
            position_lines = position_items.get(item["cfo_position_id"], [])
            request_id = next((line.get("request_id") for line in position_lines if line.get("request_id")), None)
        budget_request = requests.get(request_id, {})
        actor = users.get(item.get("user_id"))
        result.append({
            **item,
            "log": public_log,
            "subject": line_context(public_log),
            "request_id": request_id,
            "request_unit_name": units.get(budget_request.get("unit_id"), {}).get("name"),
            "user": {
                "id": actor["id"], "login": actor["login"], "role": actor["role"],
                "profile": profiles.get(actor["id"]),
            } if actor else None,
        })
    return {**paged, "items": result} if paged else sorted(result, key=lambda item: str(item.get("created_at") or ""), reverse=True)


@router.get("/cfo-positions")
def list_cfo_positions(
    request: Request,
    user: User,
    budget_year: int | None = None,
    cfo_unit_id: str | None = None,
    status: str | None = None,
    page: Annotated[int, Query(ge=1)] = 1,
    page_size: Annotated[int | None, Query(ge=1, le=200)] = None,
):
    return request.app.state.approval_service.list_positions(
        user, budget_year=budget_year, cfo_unit_id=cfo_unit_id, status=status, page=page, page_size=page_size
    )


@router.get("/cfo-positions/{position_id}")
def get_cfo_position(request: Request, position_id: str, user: User):
    return request.app.state.approval_service.get_position(user, position_id)


@router.get("/cfo-positions/{position_id}/logs")
def cfo_position_logs(request: Request, position_id: str, user: User, page_size: Annotated[int | None, Query(ge=1, le=200)] = None, before: str | None = None):
    return request.app.state.approval_service.position_logs(user, position_id, page_size=page_size, before=before)


@router.get("/cfo-positions/{position_id}/comments")
def cfo_position_comments(request: Request, position_id: str, user: User):
    return request.app.state.approval_service.position_comments(user, position_id)


@router.post("/cfo-positions/{position_id}/comments")
def add_cfo_position_comment(
    request: Request, position_id: str, payload: CfoPositionCommentIn, user: User
):
    return request.app.state.approval_service.add_position_comment(
        user, position_id, payload.comment
    )


@router.post("/cfo-positions/{position_id}/submit-to-economist")
async def submit_position_to_economist(
    request: Request, position_id: str, payload: CfoPositionActionIn, user: User
):
    result = await run_in_threadpool(request.app.state.approval_service.submit_to_economist, user, position_id, payload.comment)
    return await _broadcast_notifications(request, result, "cfo_position.assigned")


@router.post("/cfo-positions/{position_id}/items/{item_id}/decision")
def decide_position_item(
    request: Request, position_id: str, item_id: str,
    payload: ItemDecisionIn, user: User,
):
    return request.app.state.approval_service.decide_item_economist(
        user, position_id, item_id, payload.model_dump(exclude_unset=True)
    )


@router.post("/cfo-positions/{position_id}/items/decision/bulk")
def bulk_decide_position_items(
    request: Request, position_id: str, payload: BulkItemDecisionIn, user: User
):
    return request.app.state.approval_service.bulk_decide_economist(
        user, position_id, payload.model_dump()
    )


@router.post("/cfo-positions/{position_id}/complete-review")
def complete_position_review(
    request: Request, position_id: str, payload: CfoPositionActionIn, user: User
):
    return request.app.state.approval_service.complete_economist_review(
        user, position_id, payload.comment
    )


@router.post("/cfo-positions/{position_id}/freeze")
async def freeze_cfo_position(
    request: Request, position_id: str, payload: CfoPositionActionIn, user: User
):
    result = await run_in_threadpool(request.app.state.approval_service.freeze_position, user, position_id, payload.comment, payload.item_ids)
    return await _broadcast_notifications(request, result, "cfo_position.assigned")


@router.post("/cfo-positions/{position_id}/unfreeze")
def unfreeze_cfo_position(
    request: Request, position_id: str, payload: CfoPositionActionIn, user: User
):
    return request.app.state.approval_service.unfreeze_position(
        user, position_id, payload.comment, payload.item_ids
    )


@router.post("/cfo-positions/{position_id}/fix")
async def fix_cfo_position(
    request: Request, position_id: str, payload: CfoPositionActionIn, user: User
):
    result = await run_in_threadpool(request.app.state.approval_service.fix_position, user, position_id, payload.comment)
    return await _broadcast_notifications(request, result, "cfo_position.updated")


@router.post("/cfo-positions/{position_id}/unfix")
async def unfix_cfo_position(
    request: Request, position_id: str, payload: CfoPositionRevisionIn, user: User
):
    result = await run_in_threadpool(request.app.state.approval_service.unfix_position, user, position_id, payload.comment)
    return await _broadcast_notifications(request, result, "cfo_position.updated")


@router.post("/cfo-positions/{position_id}/reopen-fixed")
async def reopen_fixed_cfo_position_items(
    request: Request, position_id: str, payload: CfoPositionRevisionIn, user: User
):
    result = await run_in_threadpool(request.app.state.approval_service.reopen_fixed_items, user, position_id, payload.target_step_id, payload.comment, [item.item_id for item in payload.items])
    return await _broadcast_workflow_result(request, result, "cfo_position.returned", user["id"])


@router.post("/cfo-positions/{position_id}/return-for-revision")
async def return_cfo_position_for_revision(
    request: Request, position_id: str, payload: CfoPositionRevisionIn, user: User
):
    result = await run_in_threadpool(request.app.state.approval_service.return_for_revision, user, position_id, payload.model_dump())
    return await _broadcast_workflow_result(request, result, "cfo_position.returned", user["id"])


@router.get("/notifications")
def list_notifications(request: Request, user: User, unread_only: bool = False, page_size: Annotated[int | None, Query(ge=1, le=200)] = None, before: str | None = None):
    return request.app.state.notification_service.list_for_user(
        user, unread_only=unread_only, page_size=page_size, before=before
    )


@router.patch("/notifications/{notification_id}")
def mark_notification(
    request: Request, notification_id: str, payload: NotificationReadIn, user: User
):
    return request.app.state.notification_service.mark(
        user, notification_id, read=payload.read
    )


@router.post("/notifications/read-all")
def mark_all_notifications_read(request: Request, user: User):
    return request.app.state.notification_service.mark_all_read(user)


@router.get("/requests/{request_id}/chat")
def request_chat(request: Request, request_id: str, user: User, page_size: int | None = Query(default=None, ge=1, le=200), before: str | None = None):
    return request.app.state.chat_service.get_request_chat(user, request_id, page_size=page_size, before=before)


@router.get("/cfo-positions/{position_id}/chat")
def cfo_position_chat(request: Request, position_id: str, user: User, page_size: int | None = Query(default=None, ge=1, le=200), before: str | None = None):
    return request.app.state.chat_service.get_position_chat(user, position_id, page_size=page_size, before=before)


@router.get("/chats")
def list_chats(request: Request, user: User):
    return request.app.state.chat_service.list_chats(user)


@router.get("/chats/unread-count")
def unread_chat_count(request: Request, user: User):
    return request.app.state.chat_service.unread_count(user)


async def _broadcast_chat_message(request: Request, chat_id: str, message: dict, sender_id: str) -> None:
    await request.app.state.chat_connections.broadcast(
        chat_id,
        {"type": "chat.message.created", "message_id": message["id"]},
    )
    chat = await run_in_threadpool(request.app.state.repo.get_by_id, "chats", chat_id)
    event = {"type": "chat.message.created", "chat_id": chat_id, "message_id": message["id"], "kind": chat["kind"], "text": message["text"]}
    for user_id in await run_in_threadpool(request.app.state.chat_service.notification_recipient_ids, chat_id, sender_id):
        await request.app.state.chat_connections.broadcast_user(user_id, event)


@router.get("/chats/{chat_id}")
def get_chat(request: Request, chat_id: str, user: User, page_size: int | None = Query(default=None, ge=1, le=200), before: str | None = None):
    return request.app.state.chat_service.get_chat(user, chat_id, page_size=page_size, before=before)


@router.post("/chats/{chat_id}/messages")
async def send_chat_message(request: Request, chat_id: str, payload: ChatMessageCreate, user: User):
    message = await run_in_threadpool(request.app.state.chat_service.send, user, chat_id, payload.model_dump())
    await _broadcast_chat_message(request, chat_id, message, user["id"])
    return message


@router.post("/chats/{chat_id}/messages/images")
async def send_chat_message_with_images(
    request: Request,
    chat_id: str,
    user: User,
    images: list[UploadFile] = File(...),
    text: str = Form(""),
    reply_to: str | None = Form(None),
):
    if not images:
        raise HTTPException(status_code=400, detail="Добавьте хотя бы одно изображение")
    await request.app.state.file_service.validate_chat_images(images)
    message = await run_in_threadpool(request.app.state.chat_service.send, user, chat_id, {"text": text, "reply_to": reply_to}, allow_empty=True)
    files = [
        await request.app.state.file_service.upload_for_chat_message(user, chat_id, message["id"], image)
        for image in images
    ]
    message["files"] = files
    await _broadcast_chat_message(request, chat_id, message, user["id"])
    return message


@router.patch("/chats/{chat_id}/read")
def mark_chat_read(request: Request, chat_id: str, payload: ChatReadPatch, user: User):
    return request.app.state.chat_service.mark_read(user, chat_id, payload.last_read_message_id)


@router.websocket("/ws/chats/{chat_id}")
async def chat_websocket(websocket: WebSocket, chat_id: str):
    token = websocket.query_params.get("token")
    try:
        user = await run_in_threadpool(websocket.app.state.auth_service.me, token)
        await run_in_threadpool(websocket.app.state.chat_service.get_chat, user, chat_id)
    except HTTPException:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.app.state.chat_connections.connect(chat_id, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        websocket.app.state.chat_connections.disconnect(chat_id, websocket)


@router.websocket("/ws/chat-notifications")
@router.websocket("/ws/notifications")
async def chat_notifications_websocket(websocket: WebSocket):
    token = websocket.query_params.get("token")
    try:
        user = await run_in_threadpool(websocket.app.state.auth_service.me, token)
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
    stored_name = file.get("stored_name") or file["original_name"]
    ascii_name = "".join(char if ord(char) < 128 else "_" for char in stored_name).strip() or "download"
    headers = {
        "Content-Disposition": f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(stored_name)}"
    }
    if size is not None:
        headers["Content-Length"] = str(size)
    def chunks():
        try:
            while chunk := body.read(64 * 1024):
                yield chunk
        finally:
            body.close()
    return StreamingResponse(chunks(), media_type=content_type or "application/octet-stream", headers=headers, background=BackgroundTask(body.close))

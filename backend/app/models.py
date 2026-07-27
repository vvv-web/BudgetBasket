from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Role(StrEnum):
    admin = "admin"
    economist = "economist"
    employee = "employee"
    approver = "approver"
    zgd = "zgd"


class StepStatus(StrEnum):
    waiting = "waiting"
    on_approval = "on_approval"
    on_revision = "on_revision"
    approved = "approved"
    closed = "closed"


class UnitType(StrEnum):
    department = "department"
    module = "module"


class RequestStatus(StrEnum):
    draft = "draft"
    on_review = "on_review"
    approved = "approved"
    approved_with_changes = "approved_with_changes"
    partially_approved = "partially_approved"
    rejected = "rejected"
    cancelled = "cancelled"


class ItemStatus(StrEnum):
    on_review = "on_review"
    rejected = "rejected"
    approved_with_changes = "approved_with_changes"
    approved = "approved"
    deleted = "deleted"


CLOSED_REQUEST_STATUSES = {
    RequestStatus.approved,
    RequestStatus.approved_with_changes,
    RequestStatus.partially_approved,
    RequestStatus.rejected,
    RequestStatus.cancelled,
}
EXPORTABLE_REQUEST_STATUSES = {
    RequestStatus.approved,
    RequestStatus.approved_with_changes,
    RequestStatus.partially_approved,
}
EDITABLE_REQUEST_STATUSES = {RequestStatus.draft}
APPROVED_ITEM_STATUSES = {ItemStatus.approved, ItemStatus.approved_with_changes}


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LoginIn(StrictModel):
    login: str
    password: str


class UserCreate(StrictModel):
    login: str
    password: str
    role: Role
    name: str | None = None
    second_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    email: str | None = None
    max_link: str | None = None


class UserPatch(StrictModel):
    login: str | None = None
    password: str | None = None
    role: Role | None = None
    name: str | None = None
    second_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    email: str | None = None
    max_link: str | None = None


class ProfilePatch(StrictModel):
    name: str | None = None
    second_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    email: str | None = None
    max_link: str | None = None


class UnitCreate(StrictModel):
    parent_id: str | None = None
    name: str
    type: UnitType
    is_active: bool = True
    uses_invest_projects: bool = False


class UnitPatch(StrictModel):
    parent_id: str | None = None
    name: str | None = None
    type: UnitType | None = None
    is_active: bool | None = None
    uses_invest_projects: bool | None = None


class ResponsibleIn(StrictModel):
    user_id: str


class AssignmentCreate(StrictModel):
    economist_id: str
    unit_id: str
    assignment_type: UnitType
    is_active: bool = True


class CatalogCreate(StrictModel):
    parent_id: str | None = None
    unit_id: str | None = None
    name: str
    is_active: bool = True


class CatalogPatch(StrictModel):
    parent_id: str | None = None
    unit_id: str | None = None
    name: str | None = None
    is_active: bool | None = None


class RequestCreate(StrictModel):
    unit_id: str
    economist_id: str | None = None


class RequestPatch(StrictModel):
    status: RequestStatus | None = None


class ItemCreate(StrictModel):
    dds_id: str | None = None
    invest_id: str | None = None
    is_income: bool = False
    sum_plan: float = Field(ge=0)
    name: str = ""
    justification: str = ""


class ItemPatch(StrictModel):
    dds_id: str | None = None
    invest_id: str | None = None
    sum_plan: float | None = Field(default=None, ge=0)
    sum_fact: float | None = Field(default=None, ge=0)
    status: ItemStatus | None = None
    comment: str | None = None
    name: str | None = Field(default=None, min_length=1)
    justification: str | None = None


class ChatMessageCreate(StrictModel):
    text: str = Field(min_length=1)
    reply_to: str | None = None


class ChatReadPatch(StrictModel):
    last_read_message_id: str | None = None


class StepCreate(StrictModel):
    user_id: str
    unit_id: str | None = None
    status: StepStatus = StepStatus.waiting
    child_step_id: str | None = None


class StepPatch(StrictModel):
    user_id: str | None = None
    unit_id: str | None = None
    status: StepStatus | None = None


class StepEdgeIn(StrictModel):
    parent_step_id: str
    child_step_id: str


class StepReturnTarget(StrictModel):
    child_step_id: str
    request_ids: list[str] = Field(min_length=1)


class StepReturnIn(StrictModel):
    targets: list[StepReturnTarget] = Field(default_factory=list)
    request_ids: list[str] = Field(default_factory=list)
    comment: str = Field(min_length=1)


class StepApproveIn(StrictModel):
    """The exact independent package a reviewer is forwarding."""
    request_ids: list[str] = Field(default_factory=list)


def clean_patch(model: BaseModel) -> dict[str, Any]:
    return model.model_dump(exclude_unset=True)

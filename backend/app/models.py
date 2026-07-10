from enum import StrEnum
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class Role(StrEnum):
    admin = "admin"
    economist = "economist"
    employee = "employee"


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


class UnitPatch(StrictModel):
    parent_id: str | None = None
    name: str | None = None
    type: UnitType | None = None
    is_active: bool | None = None


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


class MappingCreate(StrictModel):
    unit_id: str
    local_name: str
    local_code: str | None = None
    is_active: bool = True
    dds_id: str | None = None
    invest_id: str | None = None


class MappingPatch(StrictModel):
    local_name: str | None = None
    local_code: str | None = None
    is_active: bool | None = None


class RequestCreate(StrictModel):
    unit_id: str
    economist_id: str | None = None


class RequestPatch(StrictModel):
    status: RequestStatus | None = None


class ItemCreate(StrictModel):
    dds_id: str | None = None
    invest_id: str | None = None
    sum_plan: float = Field(ge=0)


class ItemPatch(StrictModel):
    dds_id: str | None = None
    invest_id: str | None = None
    sum_plan: float | None = Field(default=None, ge=0)
    sum_fact: float | None = Field(default=None, ge=0)
    status: ItemStatus | None = None
    comment: str | None = None


class FileLink(StrictModel):
    file_id: str | int


def clean_patch(model: BaseModel) -> dict[str, Any]:
    return model.model_dump(exclude_unset=True)

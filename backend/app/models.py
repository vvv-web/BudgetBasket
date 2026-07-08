from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class Role(StrEnum):
    admin = "admin"
    economist = "economist"
    employee = "employee"


class UnitType(StrEnum):
    department = "department"
    module = "module"


class RequestStatus(StrEnum):
    draft = "draft"
    submitted = "submitted"
    in_review = "in_review"
    fixed = "fixed"
    unfrozen = "unfrozen"
    cancelled = "cancelled"


class ItemStatus(StrEnum):
    in_review = "in_review"
    rejected = "rejected"
    accepted_adjusted = "accepted_adjusted"
    accepted = "accepted"


class LoginIn(BaseModel):
    login: str
    password: str


class UserCreate(BaseModel):
    login: str
    password: str
    role: Role
    is_active: bool = True


class UserPatch(BaseModel):
    password: str | None = None
    role: Role | None = None
    is_active: bool | None = None


class ProfilePatch(BaseModel):
    name: str | None = None
    second_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    email: str | None = None
    max_link: str | None = None


class UnitCreate(BaseModel):
    parent_id: str | None = None
    name: str
    type: UnitType
    is_active: bool = True


class UnitPatch(BaseModel):
    parent_id: str | None = None
    name: str | None = None
    type: UnitType | None = None
    is_active: bool | None = None


class ResponsibleIn(BaseModel):
    user_id: str


class AssignmentCreate(BaseModel):
    economist_id: str
    unit_id: str
    assignment_type: UnitType
    is_active: bool = True


class CatalogCreate(BaseModel):
    parent_id: str | None = None
    name: str
    code: str | None = None
    is_active: bool = True


class CatalogPatch(BaseModel):
    parent_id: str | None = None
    name: str | None = None
    code: str | None = None
    is_active: bool | None = None


class MappingCreate(BaseModel):
    unit_id: str
    local_name: str
    local_code: str | None = None
    is_active: bool = True
    dds_id: str | None = None
    invest_id: str | None = None


class MappingPatch(BaseModel):
    local_name: str | None = None
    local_code: str | None = None
    is_active: bool | None = None


class RequestCreate(BaseModel):
    unit_id: str
    budget_year: int | None = Field(default=None, ge=2000, le=2100)


class RequestPatch(BaseModel):
    budget_year: int | None = Field(default=None, ge=2000, le=2100)
    status: RequestStatus | None = None


class ItemCreate(BaseModel):
    dds_id: str | None = None
    invest_id: str | None = None
    category_id: str | None = None
    sum_plan: float = Field(ge=0)


class ItemPatch(BaseModel):
    dds_id: str | None = None
    invest_id: str | None = None
    category_id: str | None = None
    sum_plan: float | None = Field(default=None, ge=0)
    sum_fact: float | None = Field(default=None, ge=0)
    status: ItemStatus | None = None
    comment: str | None = None


class FileLink(BaseModel):
    file_id: str | int


def clean_patch(model: BaseModel) -> dict[str, Any]:
    return model.model_dump(exclude_unset=True)

from decimal import Decimal
import re
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


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
    cfo = "cfo"
    module = "module"


class RequestStatus(StrEnum):
    draft = "draft"
    on_review = "on_review"
    approved = "approved"
    rejected = "rejected"
    cancelled = "cancelled"


class ItemStatus(StrEnum):
    on_review = "on_review"
    rejected = "rejected"
    approved_with_changes = "approved_with_changes"
    approved = "approved"
    deleted = "deleted"


class CfoPositionStatus(StrEnum):
    waiting = "waiting"
    on_review = "on_review"
    on_approval = "on_approval"
    approved = "approved"
    on_revision = "on_revision"


CLOSED_REQUEST_STATUSES = {
    RequestStatus.approved,
    RequestStatus.rejected,
    RequestStatus.cancelled,
}
EXPORTABLE_REQUEST_STATUSES = {
    RequestStatus.approved,
}
EDITABLE_REQUEST_STATUSES = {RequestStatus.draft}
APPROVED_ITEM_STATUSES = {ItemStatus.approved, ItemStatus.approved_with_changes}


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class LoginIn(StrictModel):
    login: str
    password: str


PHONE_RE = r"^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$"
EMAIL_RE = r"^[^\s@]+@[^\s@]+\.[^\s@]+$"


def validate_required_text(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("Поле обязательно для заполнения")
    return value


def validate_email(value: str) -> str:
    value = validate_required_text(value)
    if not re.fullmatch(EMAIL_RE, value):
        raise ValueError("Укажите email в формате name@example.ru")
    return value


def validate_phone(value: str) -> str:
    value = validate_required_text(value)
    if not re.fullmatch(PHONE_RE, value):
        raise ValueError("Укажите телефон в формате +7 (000) 000-00-00")
    return value


class UserCreate(StrictModel):
    login: str
    password: str
    role: Role
    name: str
    second_name: str | None = None
    last_name: str
    phone: str
    email: str
    max_link: str | None = None

    @field_validator("name", "last_name")
    @classmethod
    def required_profile_text(cls, value: str) -> str:
        return validate_required_text(value)

    @field_validator("email")
    @classmethod
    def profile_email(cls, value: str) -> str:
        return validate_email(value)

    @field_validator("phone")
    @classmethod
    def profile_phone(cls, value: str) -> str:
        return validate_phone(value)


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

    @field_validator("name", "last_name")
    @classmethod
    def non_empty_profile_text(cls, value: str | None) -> str | None:
        return validate_required_text(value) if value is not None else value

    @field_validator("email")
    @classmethod
    def valid_profile_email(cls, value: str | None) -> str | None:
        return validate_email(value) if value is not None else value

    @field_validator("phone")
    @classmethod
    def valid_profile_phone(cls, value: str | None) -> str | None:
        return validate_phone(value) if value is not None else value


class ProfilePatch(StrictModel):
    name: str | None = None
    second_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    email: str | None = None
    max_link: str | None = None

    @field_validator("name", "last_name")
    @classmethod
    def non_empty_profile_text(cls, value: str | None) -> str | None:
        return validate_required_text(value) if value is not None else value

    @field_validator("email")
    @classmethod
    def valid_profile_email(cls, value: str | None) -> str | None:
        return validate_email(value) if value is not None else value

    @field_validator("phone")
    @classmethod
    def valid_profile_phone(cls, value: str | None) -> str | None:
        return validate_phone(value) if value is not None else value


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
    # Explicit-category flows disable this fallback to avoid A -> A beside A -> B.
    create_default_category: bool = True


class CatalogPatch(StrictModel):
    parent_id: str | None = None
    unit_id: str | None = None
    name: str | None = None
    is_active: bool | None = None


class RequestCreate(StrictModel):
    unit_id: str


class RequestPatch(StrictModel):
    """Requests have no freely patchable workflow fields."""


class ItemMonthPlan(StrictModel):
    month: int = Field(ge=1, le=12)
    sum_plan: Decimal = Field(ge=0, max_digits=14, decimal_places=2)


class ItemCreate(StrictModel):
    dds_id: str | None = None
    invest_id: str | None = None
    is_income: bool = False
    sum_plan: Decimal = Field(default=Decimal("0"), ge=0, max_digits=14, decimal_places=2)
    name: str = ""
    justification: str = ""
    analytics_1: str = ""
    analytics_2: str = ""
    analytics_3: str = ""
    analytics_4: str = ""
    analytics_5: str = ""
    month_plans: list[ItemMonthPlan] = Field(default_factory=list)


class ItemPatch(StrictModel):
    dds_id: str | None = None
    invest_id: str | None = None
    is_income: bool | None = None
    sum_plan: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    sum_fact: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    status: ItemStatus | None = None
    comment: str | None = None
    name: str | None = Field(default=None, min_length=1)
    justification: str | None = None
    analytics_1: str | None = None
    analytics_2: str | None = None
    analytics_3: str | None = None
    analytics_4: str | None = None
    analytics_5: str | None = None
    month_plans: list[ItemMonthPlan] | None = None
    clear_month_plans: bool = False


class ChatMessageCreate(StrictModel):
    text: str = Field(min_length=1)
    reply_to: str | None = None


class ChatReadPatch(StrictModel):
    last_read_message_id: str | None = None


class StepCreate(StrictModel):
    user_id: str | None = None
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
    position_ids: list[str] = Field(default_factory=list)


class PositionLineApprovalIn(StrictModel):
    step_id: str
    position_id: str
    item_ids: list[str] = Field(min_length=1)


class BulkPositionLineApprovalIn(StrictModel):
    positions: list[PositionLineApprovalIn] = Field(min_length=1)
    comment: str = ""
    event_id: str | None = None


class ItemDecisionIn(StrictModel):
    # ``on_revision`` is a saved workflow choice.  Unlike an item status it
    # leaves the budget line in ``on_review`` until the reviewer explicitly
    # sends the selected position back to the preceding route step.
    decision: ItemStatus | Literal["on_revision"]
    comment: str = ""
    sum_plan: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    sum_fact: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)
    name: str | None = Field(default=None, min_length=1)
    justification: str | None = None
    month_plans: list[ItemMonthPlan] | None = None


class BulkItemDecisionIn(StrictModel):
    item_ids: list[str] = Field(min_length=1)
    decision: ItemStatus | Literal["on_revision"]
    comment: str = ""


class RegisterGroupDecisionIn(StrictModel):
    decision: ItemStatus
    comment: str = ""


class RegisterGroupWorkflowActionIn(StrictModel):
    """Action over all actionable CFO positions in an article or CFO group."""

    action: Literal["submit", "approve", "return_for_revision", "fix", "unfix"]
    comment: str = ""
    target_step_id: str | None = None
    items: list["RevisionItemIn"] | None = None


class RegisterGroupCfoRevisionIn(StrictModel):
    """Partial CFO review return for a register article/CFO group."""

    comment: str = ""
    items: list["RevisionItemIn"] = Field(min_length=1)


class CfoRevisionSelectionIn(StrictModel):
    """Save a CFO revision choice without handing the package to the module."""

    comment: str = ""


class AnalyticsFieldsPatch(StrictModel):
    analytics_1: str | None = None
    analytics_2: str | None = None
    analytics_3: str | None = None
    analytics_4: str | None = None
    analytics_5: str | None = None


class CfoPositionActionIn(StrictModel):
    comment: str = ""
    item_ids: list[str] = Field(default_factory=list)
    event_id: str | None = None


class CfoPositionCommentIn(StrictModel):
    comment: str = Field(min_length=1, max_length=4000)


class CfoPositionReturnIn(StrictModel):
    target_step_id: str | None = None
    comment: str = Field(min_length=1)
    item_ids: list[str] = Field(default_factory=list)


class RevisionItemIn(StrictModel):
    item_id: str
    comment: str = ""
    suggested_sum_fact: Decimal | None = Field(default=None, ge=0, max_digits=14, decimal_places=2)


class CfoPositionRevisionIn(StrictModel):
    target_step_id: str | None = None
    comment: str = ""
    items: list[RevisionItemIn] = Field(min_length=1)


class NotificationReadIn(StrictModel):
    read: bool = True


def clean_patch(model: BaseModel) -> dict[str, Any]:
    return model.model_dump(exclude_unset=True)

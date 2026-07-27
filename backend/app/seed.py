from __future__ import annotations

from app.repositories.base import Repository
from app.security import hash_password


ADMIN_ID = "00000000-0000-0000-0000-000000000001"
ECONOMIST_ID = "00000000-0000-0000-0000-000000000002"
EMPLOYEE_ID = "00000000-0000-0000-0000-000000000003"
APPROVER_ID = "00000000-0000-0000-0000-000000000004"
ZGD_ID = "00000000-0000-0000-0000-000000000005"
DEPARTMENT_ID = "10000000-0000-0000-0000-000000000001"
CFO_ID = "10000000-0000-0000-0000-000000000010"
MODULE_ALPHA_ID = "10000000-0000-0000-0000-000000000002"
MODULE_BETA_ID = "10000000-0000-0000-0000-000000000003"
DDS_OPER_ID = "20000000-0000-0000-0000-000000000001"
DDS_LICENSE_ID = "20000000-0000-0000-0000-000000000002"
INVEST_DEV_ID = "30000000-0000-0000-0000-000000000010"
INVEST_PLATFORM_ID = "30000000-0000-0000-0000-000000000001"
INVEST_INFRA_ID = "30000000-0000-0000-0000-000000000002"
REQUEST_ID = "40000000-0000-0000-0000-000000000001"
LEAF_STEP_ID = "50000000-0000-0000-0000-000000000001"
APPROVER_STEP_ID = "50000000-0000-0000-0000-000000000002"
ROOT_STEP_ID = "50000000-0000-0000-0000-000000000003"


COLLECTIONS = (
    "roles",
    "users",
    "profiles",
    "units",
    "units_responsibles",
    "requests",
    "req_items",
    "dds_catalog",
    "invests_catalog",
    "storage_objects",
    "files",
    "req_item_files",
    "req_chats",
    "chat_messages",
    "chats_participants",
    "req_logs",
    "steps",
    "step_edges",
    "request_step_states",
    "step_logs",
)


def seed_data(repo: Repository) -> None:
    for collection in COLLECTIONS:
        repo.load_all(collection)

    roles = {item["name"]: item["id"] for item in repo.load_all("roles")}
    for role_name in ("admin", "employee", "economist", "approver", "zgd"):
        if role_name not in roles:
            role = repo.create("roles", {"name": role_name})
            roles[role_name] = role["id"]
    if repo.load_all("users"):
        return

    repo.save_all(
        "users",
        [
            {"id": ADMIN_ID, "login": "admin", "password": hash_password("admin"), "id_role": roles["admin"]},
            {"id": ECONOMIST_ID, "login": "economist", "password": hash_password("economist"), "id_role": roles["economist"]},
            {"id": EMPLOYEE_ID, "login": "employee", "password": hash_password("employee"), "id_role": roles["employee"]},
            {"id": APPROVER_ID, "login": "approver", "password": hash_password("approver"), "id_role": roles["approver"]},
            {"id": ZGD_ID, "login": "zgd", "password": hash_password("zgd"), "id_role": roles["zgd"]},
        ],
    )
    repo.save_all(
        "profiles",
        [
            {"user_id": ADMIN_ID, "name": "Анна", "second_name": "Игоревна", "last_name": "Администратор", "phone": "+7 900 000-00-01", "email": "admin@example.local", "max_link": ""},
            {"user_id": ECONOMIST_ID, "name": "Елена", "second_name": "Сергеевна", "last_name": "Экономист", "phone": "+7 900 000-00-02", "email": "economist@example.local", "max_link": ""},
            {"user_id": EMPLOYEE_ID, "name": "Иван", "second_name": "Петрович", "last_name": "Сотрудник", "phone": "+7 900 000-00-03", "email": "employee@example.local", "max_link": ""},
            {"user_id": APPROVER_ID, "name": "Алексей", "second_name": "", "last_name": "Согласующий", "phone": "", "email": "approver@example.local", "max_link": ""},
            {"user_id": ZGD_ID, "name": "Мария", "second_name": "", "last_name": "ЗГД", "phone": "", "email": "zgd@example.local", "max_link": ""},
        ],
    )
    repo.save_all(
        "units",
        [
            {"id": DEPARTMENT_ID, "parent_id": None, "name": "Департамент цифровых продуктов", "is_active": True, "uses_invest_projects": False, "annual_budget": 0},
            {"id": CFO_ID, "parent_id": DEPARTMENT_ID, "name": "ЦФО цифровых продуктов", "is_active": True, "uses_invest_projects": False, "annual_budget": 0},
            {"id": MODULE_ALPHA_ID, "parent_id": CFO_ID, "name": "Модуль клиентского кабинета", "is_active": True, "uses_invest_projects": False, "annual_budget": 0},
            {"id": MODULE_BETA_ID, "parent_id": CFO_ID, "name": "Модуль аналитики", "is_active": True, "uses_invest_projects": True, "annual_budget": 0},
        ],
    )
    repo.save_all(
        "units_responsibles",
        [
            {"unit_id": MODULE_ALPHA_ID, "user_id": EMPLOYEE_ID, "is_active": True},
            {"unit_id": MODULE_ALPHA_ID, "user_id": ECONOMIST_ID, "is_active": True},
            {"unit_id": MODULE_BETA_ID, "user_id": ECONOMIST_ID, "is_active": True},
        ],
    )
    repo.save_all(
        "dds_catalog",
        [
            {"id": DDS_OPER_ID, "parent_id": None, "unit_id": DEPARTMENT_ID, "name": "Операционные расходы", "is_active": True},
            {"id": DDS_LICENSE_ID, "parent_id": DDS_OPER_ID, "unit_id": DEPARTMENT_ID, "name": "Лицензии и подписки", "is_active": True},
        ],
    )
    repo.save_all(
        "invests_catalog",
        [
            {"id": INVEST_DEV_ID, "parent_id": None, "unit_id": DEPARTMENT_ID, "name": "Развитие и инфраструктура", "is_active": True},
            {"id": INVEST_PLATFORM_ID, "parent_id": INVEST_DEV_ID, "unit_id": DEPARTMENT_ID, "name": "Развитие платформы", "is_active": True},
            {"id": INVEST_INFRA_ID, "parent_id": INVEST_DEV_ID, "unit_id": DEPARTMENT_ID, "name": "Инфраструктура", "is_active": True},
        ],
    )
    repo.save_all(
        "steps",
        [
            {"id": LEAF_STEP_ID, "user_id": ECONOMIST_ID, "unit_id": MODULE_ALPHA_ID, "status": "waiting"},
            {"id": APPROVER_STEP_ID, "user_id": APPROVER_ID, "unit_id": None, "status": "waiting"},
            {"id": ROOT_STEP_ID, "user_id": ZGD_ID, "unit_id": None, "status": "waiting"},
        ],
    )
    repo.save_all(
        "step_edges",
        [
            {"parent_step_id": APPROVER_STEP_ID, "child_step_id": LEAF_STEP_ID},
            {"parent_step_id": ROOT_STEP_ID, "child_step_id": APPROVER_STEP_ID},
        ],
    )

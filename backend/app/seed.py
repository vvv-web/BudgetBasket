from __future__ import annotations

from datetime import datetime, timezone

from app.repositories.json_repository import JsonRepository

ADMIN_ID = "00000000-0000-0000-0000-000000000001"
ECONOMIST_ID = "00000000-0000-0000-0000-000000000002"
EMPLOYEE_ID = "00000000-0000-0000-0000-000000000003"
DEPARTMENT_ID = "10000000-0000-0000-0000-000000000001"
MODULE_ALPHA_ID = "10000000-0000-0000-0000-000000000002"
MODULE_BETA_ID = "10000000-0000-0000-0000-000000000003"
DDS_OPER_ID = "20000000-0000-0000-0000-000000000001"
DDS_LICENSE_ID = "20000000-0000-0000-0000-000000000002"
INVEST_PLATFORM_ID = "30000000-0000-0000-0000-000000000001"
INVEST_INFRA_ID = "30000000-0000-0000-0000-000000000002"
REQUEST_ID = "40000000-0000-0000-0000-000000000001"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def seed_data(repo: JsonRepository) -> None:
    collections = [
        "users",
        "profiles",
        "units",
        "units_responsibles",
        "requests",
        "dds_items",
        "invest_items",
        "dds_catalog",
        "invests_catalog",
        "files",
        "storage_objects",
        "dds_item_files",
        "invest_item_files",
    ]
    for collection in collections:
        repo.load_all(collection)

    if repo.load_all("users"):
        return

    timestamp = now_iso()
    repo.save_all(
        "users",
        [
            {"id": ADMIN_ID, "login": "admin", "password": "admin", "role": "admin", "is_active": True},
            {"id": ECONOMIST_ID, "login": "economist", "password": "economist", "role": "economist", "is_active": True},
            {"id": EMPLOYEE_ID, "login": "employee", "password": "employee", "role": "employee", "is_active": True},
        ],
    )
    repo.save_all(
        "profiles",
        [
            {"user_id": ADMIN_ID, "name": "Анна", "second_name": "Игоревна", "last_name": "Администратор", "phone": "+7 900 000-00-01", "email": "admin@example.local", "max_link": ""},
            {"user_id": ECONOMIST_ID, "name": "Елена", "second_name": "Сергеевна", "last_name": "Экономист", "phone": "+7 900 000-00-02", "email": "economist@example.local", "max_link": ""},
            {"user_id": EMPLOYEE_ID, "name": "Иван", "second_name": "Петрович", "last_name": "Сотрудник", "phone": "+7 900 000-00-03", "email": "employee@example.local", "max_link": ""},
        ],
    )
    repo.save_all(
        "units",
        [
            {"id": DEPARTMENT_ID, "parent_id": None, "name": "Департамент цифровых продуктов", "is_active": True},
            {"id": MODULE_ALPHA_ID, "parent_id": DEPARTMENT_ID, "name": "Модуль клиентского кабинета", "is_active": True},
            {"id": MODULE_BETA_ID, "parent_id": DEPARTMENT_ID, "name": "Модуль аналитики", "is_active": True},
        ],
    )
    repo.save_all("units_responsibles", [{"unit_id": MODULE_ALPHA_ID, "user_id": EMPLOYEE_ID, "is_active": True}])
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
            {"id": INVEST_PLATFORM_ID, "parent_id": None, "unit_id": DEPARTMENT_ID, "name": "Развитие платформы", "is_active": True},
            {"id": INVEST_INFRA_ID, "parent_id": None, "unit_id": DEPARTMENT_ID, "name": "Инфраструктура", "is_active": True},
        ],
    )
    repo.save_all(
        "requests",
        [{"id": REQUEST_ID, "economist_id": ECONOMIST_ID, "unit_id": MODULE_ALPHA_ID, "sum": 0, "status": "submitted"}],
    )
    repo.save_all(
        "dds_items",
        [{"id": "80000000-0000-0000-0000-000000000001", "request_id": REQUEST_ID, "dds_id": DDS_LICENSE_ID, "category_id": None, "sum_plan": 120000, "sum_fact": None, "status": "in_review", "comment": None}],
    )
    repo.save_all(
        "invest_items",
        [{"id": "90000000-0000-0000-0000-000000000001", "request_id": REQUEST_ID, "invest_id": INVEST_PLATFORM_ID, "category_id": None, "sum_plan": 350000, "sum_fact": None, "status": "in_review", "comment": None}],
    )

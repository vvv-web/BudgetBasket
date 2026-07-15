from __future__ import annotations

from app.repositories.base import Repository
from app.security import hash_password

ADMIN_ID = "00000000-0000-0000-0000-000000000001"
ECONOMIST_ID = "00000000-0000-0000-0000-000000000002"
EMPLOYEE_ID = "00000000-0000-0000-0000-000000000003"
DEPARTMENT_ID = "10000000-0000-0000-0000-000000000001"
MODULE_ALPHA_ID = "10000000-0000-0000-0000-000000000002"
MODULE_BETA_ID = "10000000-0000-0000-0000-000000000003"
DDS_OPER_ID = "20000000-0000-0000-0000-000000000001"
DDS_LICENSE_ID = "20000000-0000-0000-0000-000000000002"
INVEST_DEV_ID = "30000000-0000-0000-0000-000000000010"
INVEST_PLATFORM_ID = "30000000-0000-0000-0000-000000000001"
INVEST_INFRA_ID = "30000000-0000-0000-0000-000000000002"
REQUEST_ID = "40000000-0000-0000-0000-000000000001"

def seed_data(repo: Repository) -> None:
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
        "unit_dds_mappings",
        "unit_invest_mappings",
    ]
    for collection in collections:
        repo.load_all(collection)

    invests = repo.load_all("invests_catalog")
    if invests and not any(item.get("id") == INVEST_DEV_ID for item in invests):
        for item in invests:
            if item.get("id") in {INVEST_PLATFORM_ID, INVEST_INFRA_ID} and not item.get("parent_id"):
                repo.update("invests_catalog", item["id"], {"parent_id": INVEST_DEV_ID})
        repo.create(
            "invests_catalog",
            {
                "id": INVEST_DEV_ID,
                "parent_id": None,
                "unit_id": DEPARTMENT_ID,
                "name": "Развитие и инфраструктура",
                "is_active": True,
            }
        )

    if repo.load_all("users"):
        return

    repo.save_all(
        "users",
        [
            {"id": ADMIN_ID, "login": "admin", "password": hash_password("admin"), "role": "admin"},
            {"id": ECONOMIST_ID, "login": "economist", "password": hash_password("economist"), "role": "economist"},
            {"id": EMPLOYEE_ID, "login": "employee", "password": hash_password("employee"), "role": "employee"},
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
    repo.save_all(
        "units_responsibles",
        [
            {"unit_id": MODULE_ALPHA_ID, "user_id": EMPLOYEE_ID, "is_active": True},
            {"unit_id": MODULE_ALPHA_ID, "user_id": ECONOMIST_ID, "is_active": True},
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
        "requests",
        [{"id": REQUEST_ID, "economist_id": ECONOMIST_ID, "unit_id": MODULE_ALPHA_ID, "sum": 0, "status": "on_review"}],
    )
    repo.save_all(
        "dds_items",
        [
            {
                "id": "80000000-0000-0000-0000-000000000001",
                "request_id": REQUEST_ID,
                "dds_id": DDS_LICENSE_ID,
                "category_id": DDS_OPER_ID,
                "sum_plan": 120000,
                "sum_fact": None,
                "status": "on_review",
                "comment": None,
            }
        ],
    )
    repo.save_all(
        "invest_items",
        [
            {
                "id": "90000000-0000-0000-0000-000000000001",
                "request_id": REQUEST_ID,
                "invest_id": INVEST_PLATFORM_ID,
                "category_id": INVEST_DEV_ID,
                "sum_plan": 350000,
                "sum_fact": None,
                "status": "on_review",
                "comment": None,
            }
        ],
    )

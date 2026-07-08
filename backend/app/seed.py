from __future__ import annotations

from app.repositories.json_repository import JsonRepository

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

REQUEST_STATUS_MAP = {
    "submitted": "on_review",
    "in_review": "on_review",
    "fixed": "approved",
    "unfrozen": "draft",
}

ITEM_STATUS_MAP = {
    "in_review": "on_review",
    "accepted": "approved",
    "accepted_adjusted": "approved_with_changes",
}


def _migrate_statuses(repo: JsonRepository) -> None:
    requests = repo.load_all("requests")
    changed = False
    for item in requests:
        old = item.get("status")
        if old in REQUEST_STATUS_MAP:
            item["status"] = REQUEST_STATUS_MAP[old]
            changed = True
        item.pop("budget_year", None)
    if changed:
        repo.save_all("requests", requests)

    for collection in ("dds_items", "invest_items"):
        items = repo.load_all(collection)
        touched = False
        for item in items:
            old = item.get("status")
            if old in ITEM_STATUS_MAP:
                item["status"] = ITEM_STATUS_MAP[old]
                touched = True
            catalog = "dds_catalog" if collection == "dds_items" else "invests_catalog"
            article_field = "dds_id" if collection == "dds_items" else "invest_id"
            article_id = item.get(article_field)
            if article_id and not item.get("category_id"):
                article = repo.get_by_id(catalog, article_id)
                if article and article.get("parent_id"):
                    item["category_id"] = article["parent_id"]
                    touched = True
        if touched:
            repo.save_all(collection, items)

    users = repo.load_all("users")
    if any("is_active" in user for user in users):
        for user in users:
            user.pop("is_active", None)
        repo.save_all("users", users)

    for collection in ("dds_catalog", "invests_catalog"):
        items = repo.load_all(collection)
        if any("code" in item for item in items):
            for item in items:
                item.pop("code", None)
            repo.save_all(collection, items)


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
        "unit_dds_mappings",
        "unit_invest_mappings",
    ]
    for collection in collections:
        repo.load_all(collection)

    _migrate_statuses(repo)

    invests = repo.load_all("invests_catalog")
    if invests and not any(item.get("id") == INVEST_DEV_ID for item in invests):
        for item in invests:
            if item.get("id") in {INVEST_PLATFORM_ID, INVEST_INFRA_ID} and not item.get("parent_id"):
                item["parent_id"] = INVEST_DEV_ID
        invests.append(
            {
                "id": INVEST_DEV_ID,
                "parent_id": None,
                "unit_id": DEPARTMENT_ID,
                "name": "Развитие и инфраструктура",
                "is_active": True,
            }
        )
        repo.save_all("invests_catalog", invests)

    if repo.load_all("users"):
        return

    repo.save_all(
        "users",
        [
            {"id": ADMIN_ID, "login": "admin", "password": "admin", "role": "admin"},
            {"id": ECONOMIST_ID, "login": "economist", "password": "economist", "role": "economist"},
            {"id": EMPLOYEE_ID, "login": "employee", "password": "employee", "role": "employee"},
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

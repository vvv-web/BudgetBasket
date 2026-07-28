import io
import zipfile
from types import SimpleNamespace

from fastapi.testclient import TestClient

from app.config import Settings
from app.factory import create_app
from app.seed import DDS_LICENSE_ID, MODULE_ALPHA_ID
from tests.in_memory_repository import InMemoryRepository


class AllowingFileGuard:
    async def validate(self, upload):
        return SimpleNamespace(
            valid=True,
            detected_mime_type=upload.content_type or "application/octet-stream",
            size_bytes=0,
            reason_code=None,
            message=None,
            warnings=[],
        )


def make_client(tmp_path) -> TestClient:
    app = create_app(repository=InMemoryRepository(), settings=Settings(database_url=None, s3_endpoint=None))
    app.state.file_service.object_storage.root = tmp_path / "storage" / "uploads"
    guard = AllowingFileGuard()
    app.state.file_guard_client = guard
    app.state.file_service.file_guard = guard
    app.state.excel_service.file_guard = guard
    return TestClient(app)


def auth(client: TestClient, login: str, password: str) -> dict[str, str]:
    response = client.post("/auth/login", json={"login": login, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_login_all_roles(tmp_path):
    client = make_client(tmp_path)
    assert client.post("/auth/login", json={"login": "admin", "password": "admin"}).json()["user"]["role"] == "admin"
    assert client.post("/auth/login", json={"login": "economist", "password": "economist"}).json()["user"]["role"] == "economist"
    assert client.post("/auth/login", json={"login": "employee", "password": "employee"}).json()["user"]["role"] == "employee"


def test_employee_can_attach_and_download_zip_archive(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    item = client.post(
        f"/requests/{request['id']}/items",
        json={"dds_id": DDS_LICENSE_ID, "name": "Archive", "sum_plan": 100, "justification": ""},
        headers=employee,
    ).json()
    payload = io.BytesIO()
    with zipfile.ZipFile(payload, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("readme.txt", "Attachment archive")

    uploaded = client.post(
        f"/items/{item['id']}/files",
        files={"file": ("attachments.zip", payload.getvalue(), "application/zip")},
        headers=employee,
    )

    assert uploaded.status_code == 200
    downloaded = client.get(f"/files/{uploaded.json()['id']}/download", headers=employee)
    assert downloaded.status_code == 200
    assert downloaded.headers["content-type"] == "application/zip"
    assert downloaded.content == payload.getvalue()


def test_expense_and_income_dashboards_are_separate(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    admin = auth(client, "admin", "admin")
    initial_expense_total = client.get("/dashboard", headers=admin).json()["totals"]["planned"]
    initial_income_total = client.get("/dashboard/income", headers=admin).json()["totals"]["planned"]
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()

    expense = client.post(
        f"/requests/{request['id']}/items",
        json={"dds_id": DDS_LICENSE_ID, "name": "Expense", "sum_plan": 100, "justification": "Plan"},
        headers=employee,
    )
    income = client.post(
        f"/requests/{request['id']}/items",
        json={"dds_id": DDS_LICENSE_ID, "is_income": True, "name": "Income", "sum_plan": 250, "justification": "Plan"},
        headers=employee,
    )
    assert expense.status_code == 200
    assert income.status_code == 200
    assert client.post(f"/requests/{request['id']}/submit", headers=employee).status_code == 200

    expenses = client.get("/dashboard", headers=admin).json()
    incomes = client.get("/dashboard/income", headers=admin).json()
    assert expenses["totals"]["planned"] == initial_expense_total + 100
    assert incomes["totals"]["planned"] == initial_income_total + 250


def test_dashboard_table_returns_hierarchical_request_rows(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    admin = auth(client, "admin", "admin")
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    assert client.post(
        f"/requests/{request['id']}/items",
        json={"dds_id": DDS_LICENSE_ID, "name": "License", "sum_plan": 100, "justification": "Plan"},
        headers=employee,
    ).status_code == 200
    assert client.post(f"/requests/{request['id']}/submit", headers=employee).status_code == 200

    rows = client.get("/dashboard/table", headers=admin).json()
    row = next(item for item in rows if item["request_id"] == request["id"])
    assert row["organization"]
    assert row["cfo"]
    assert row["unit"]
    assert row["article"] == "Лицензии и подписки"
    assert row["planned"] == 100


def test_dashboard_article_cfo_returns_selected_article_breakdown(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    admin = auth(client, "admin", "admin")
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    assert client.post(
        f"/requests/{request['id']}/items",
        json={"dds_id": DDS_LICENSE_ID, "name": "License", "sum_plan": 100, "justification": "Plan"},
        headers=employee,
    ).status_code == 200
    assert client.post(f"/requests/{request['id']}/submit", headers=employee).status_code == 200

    rows = client.get("/dashboard/article-cfo", params={"article_key": f"dds:{DDS_LICENSE_ID}"}, headers=admin).json()
    assert rows
    assert rows[0]["name"] == "ЦФО цифровых продуктов"
    assert rows[0]["planned"] >= 100


def test_dashboard_articles_cfo_returns_all_articles(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    admin = auth(client, "admin", "admin")
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    assert client.post(
        f"/requests/{request['id']}/items",
        json={"dds_id": DDS_LICENSE_ID, "name": "License", "sum_plan": 100, "justification": "Plan"},
        headers=employee,
    ).status_code == 200
    assert client.post(f"/requests/{request['id']}/submit", headers=employee).status_code == 200

    articles = client.get("/dashboard/articles-cfo", headers=admin).json()
    article = next(item for item in articles if item["id"] == f"dds:{DDS_LICENSE_ID}")
    assert article["planned"] >= 100
    assert article["cfo"][0]["name"] == "ЦФО цифровых продуктов"


def test_draft_request_shows_module_economist_contact(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    client.app.state.repo.create(
        "requests",
        {
            "id": "draft-with-module-economist",
            "economist_id": None,
            "unit_id": MODULE_ALPHA_ID,
            "status": "draft",
            "frozen": False,
        },
    )

    response = client.get("/requests/draft-with-module-economist/counterparty-contact", headers=employee)

    assert response.status_code == 200
    assert response.json()["role"] == "economist"
    assert response.json()["login"] == "economist"


def test_request_history_hides_corrupted_import_suffix(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    item = client.post(
        f"/requests/{request['id']}/items",
        json={
            "dds_id": DDS_LICENSE_ID,
            "name": "Юридические услуги (списание) — M-1, ????? 1",
            "sum_plan": 100,
            "justification": "Проверка",
        },
        headers=employee,
    )
    assert item.status_code == 200

    logs = client.get(f"/requests/{request['id']}/logs", headers=employee)
    assert logs.status_code == 200
    line_log = next(entry for entry in logs.json() if entry["subject"])
    assert line_log["subject"]["name"] == "Юридические услуги (списание)"
    items = client.get(f"/requests/{request['id']}/items", headers=employee)
    assert items.status_code == 200
    assert items.json()[0]["name"] == "Юридические услуги (списание)"

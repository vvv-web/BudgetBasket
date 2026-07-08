import os

from fastapi.testclient import TestClient

from app.seed import DDS_LICENSE_ID, MODULE_ALPHA_ID, REQUEST_ID


def make_client(tmp_path):
    data_root = tmp_path / "data"
    storage_root = tmp_path / "storage"
    os.environ["BUDGET_DATA_ROOT"] = str(data_root)
    os.environ["BUDGET_DATA_DIR"] = str(data_root / "current")
    os.environ["BUDGET_STORAGE_DIR"] = str(storage_root)
    os.environ["BUDGET_UPLOAD_DIR"] = str(storage_root / "uploads")
    os.environ["BUDGET_EXPORT_DIR"] = str(storage_root / "exports")
    from app.main import create_app

    return TestClient(create_app())


def auth(client: TestClient, login: str, password: str) -> dict[str, str]:
    response = client.post("/auth/login", json={"login": login, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_login_all_roles(tmp_path):
    client = make_client(tmp_path)
    assert client.post("/auth/login", json={"login": "admin", "password": "admin"}).json()["user"]["role"] == "admin"
    assert client.post("/auth/login", json={"login": "economist", "password": "economist"}).json()["user"]["role"] == "economist"
    assert client.post("/auth/login", json={"login": "employee", "password": "employee"}).json()["user"]["role"] == "employee"


def test_employee_creates_adds_and_submits_request(tmp_path):
    client = make_client(tmp_path)
    headers = auth(client, "employee", "employee")
    created = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=headers)
    assert created.status_code == 200
    request_id = created.json()["id"]
    item = client.post(f"/requests/{request_id}/dds-items", json={"dds_id": DDS_LICENSE_ID, "sum_plan": 1000}, headers=headers)
    assert item.status_code == 200
    assert item.json()["category_id"] == "20000000-0000-0000-0000-000000000001"
    assert item.json()["status"] == "on_review"
    submitted = client.post(f"/requests/{request_id}/submit", headers=headers)
    assert submitted.status_code == 200
    assert submitted.json()["status"] == "on_review"


def test_economist_reviews_finalizes_and_employee_cannot_edit_closed(tmp_path):
    client = make_client(tmp_path)
    economist = auth(client, "economist", "economist")
    employee = auth(client, "employee", "employee")
    assert client.post(f"/requests/{REQUEST_ID}/start-review", headers=economist).status_code == 200
    dds_item = client.get(f"/requests/{REQUEST_ID}/dds-items", headers=economist).json()[0]
    invest_item = client.get(f"/requests/{REQUEST_ID}/invest-items", headers=economist).json()[0]
    assert client.patch(f"/dds-items/{dds_item['id']}", json={"status": "approved"}, headers=economist).status_code == 200
    assert client.patch(f"/invest-items/{invest_item['id']}", json={"status": "rejected", "sum_fact": 0, "comment": "Не подтверждено"}, headers=economist).status_code == 200
    finalized = client.post(f"/requests/{REQUEST_ID}/finalize", headers=economist)
    assert finalized.status_code == 200
    assert finalized.json()["status"] == "partially_approved"
    denied = client.patch(f"/dds-items/{dds_item['id']}", json={"sum_plan": 1}, headers=employee)
    assert denied.status_code == 400


def test_reopen_allows_employee_edit_again(tmp_path):
    client = make_client(tmp_path)
    economist = auth(client, "economist", "economist")
    employee = auth(client, "employee", "employee")
    dds_item = client.get(f"/requests/{REQUEST_ID}/dds-items", headers=economist).json()[0]
    invest_item = client.get(f"/requests/{REQUEST_ID}/invest-items", headers=economist).json()[0]
    client.patch(f"/dds-items/{dds_item['id']}", json={"status": "approved"}, headers=economist)
    client.patch(f"/invest-items/{invest_item['id']}", json={"status": "rejected", "sum_fact": 0, "comment": "Не подтверждено"}, headers=economist)
    client.post(f"/requests/{REQUEST_ID}/finalize", headers=economist)
    reopened = client.post(f"/requests/{REQUEST_ID}/reopen", headers=economist)
    assert reopened.status_code == 200
    assert reopened.json()["status"] == "draft"
    edited = client.patch(f"/dds-items/{dds_item['id']}", json={"sum_plan": 121000}, headers=employee)
    assert edited.status_code == 200


def test_file_upload_and_archive(tmp_path):
    client = make_client(tmp_path)
    admin = auth(client, "admin", "admin")
    employee = auth(client, "employee", "employee")
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    dds_item = client.post(f"/requests/{request['id']}/dds-items", json={"dds_id": DDS_LICENSE_ID, "sum_plan": 1000}, headers=employee).json()
    upload = client.post(
        "/files/upload",
        headers=employee,
        files={"file": ("kp.pdf", b"demo pdf content", "application/pdf")},
    )
    assert upload.status_code == 200
    linked = client.post(f"/dds-items/{dds_item['id']}/files", json={"file_id": upload.json()["id"]}, headers=employee)
    assert linked.status_code == 200
    archived = client.post("/admin/archive-year/2026", headers=admin)
    assert archived.status_code == 200
    archive = client.get("/archive/2026/requests", headers=admin)
    assert len(archive.json()) >= 1


def test_catalog_scoped_by_module_and_excel_import_export(tmp_path):
    from io import BytesIO

    from openpyxl import Workbook

    client = make_client(tmp_path)
    admin = auth(client, "admin", "admin")
    economist = auth(client, "economist", "economist")

    scoped = client.get("/catalog/dds", params={"module_id": MODULE_ALPHA_ID, "active_only": True}, headers=admin)
    assert scoped.status_code == 200
    assert all(item["unit_id"] == "10000000-0000-0000-0000-000000000001" for item in scoped.json())

    wb = Workbook()
    ws = wb.active
    ws.append(["Название", "Категория", "Подразделение", "Активен"])
    ws.append(["Командировки", "Операционные расходы", "Департамент цифровых продуктов", "да"])
    buffer = BytesIO()
    wb.save(buffer)
    imported = client.post(
        "/catalog/dds/import",
        headers=admin,
        files={"file": ("nsi.xlsx", buffer.getvalue(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
    )
    assert imported.status_code == 200
    assert imported.json()["created"] == 1

    dds_item = client.get(f"/requests/{REQUEST_ID}/dds-items", headers=economist).json()[0]
    invest_item = client.get(f"/requests/{REQUEST_ID}/invest-items", headers=economist).json()[0]
    client.patch(f"/dds-items/{dds_item['id']}", json={"status": "approved"}, headers=economist)
    client.patch(f"/invest-items/{invest_item['id']}", json={"status": "rejected", "sum_fact": 0, "comment": "Нет"}, headers=economist)
    finalized = client.post(f"/requests/{REQUEST_ID}/finalize", headers=economist)
    assert finalized.status_code == 200

    exported = client.get(f"/requests/{REQUEST_ID}/export", headers=economist)
    assert exported.status_code == 200
    assert exported.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    from openpyxl import load_workbook as load_exported

    book = load_exported(BytesIO(exported.content))
    assert book.sheetnames[0] == "Состав"
    assert book["Состав"].max_row >= 3
    headers_row = [cell.value for cell in book["Состав"][1]]
    assert "Статья / проект" in headers_row
    assert "Категория" in headers_row
    batch = client.get("/requests/export/closed", headers=admin)
    assert batch.status_code == 200
    batch_book = load_exported(BytesIO(batch.content))
    assert batch_book.sheetnames[0] == "Состав"
    assert batch_book["Состав"].max_row >= 3

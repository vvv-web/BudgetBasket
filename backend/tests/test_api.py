import os

from fastapi.testclient import TestClient

from app.seed import DDS_LICENSE_ID, INVEST_PLATFORM_ID, MODULE_ALPHA_ID, REQUEST_ID


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


def test_employee_can_delete_draft_request_only(tmp_path):
    client = make_client(tmp_path)
    admin = auth(client, "admin", "admin")
    headers = auth(client, "employee", "employee")
    created = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=headers)
    assert created.status_code == 200
    request_id = created.json()["id"]

    denied_admin = client.delete(f"/requests/{request_id}", headers=admin)
    assert denied_admin.status_code == 403

    deleted = client.delete(f"/requests/{request_id}", headers=headers)
    assert deleted.status_code == 200
    assert client.get(f"/requests/{request_id}", headers=headers).status_code == 404

    recreated = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=headers)
    assert recreated.status_code == 200
    request_id = recreated.json()["id"]
    assert client.post(f"/requests/{request_id}/dds-items", json={"dds_id": DDS_LICENSE_ID, "sum_plan": 1000}, headers=headers).status_code == 200
    submitted = client.post(f"/requests/{request_id}/submit", headers=headers)
    assert submitted.status_code == 200
    denied = client.delete(f"/requests/{request_id}", headers=headers)
    assert denied.status_code == 400


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


def test_economist_sees_only_requests_sent_for_review(tmp_path):
    client = make_client(tmp_path)
    economist = auth(client, "economist", "economist")
    employee = auth(client, "employee", "employee")

    draft_request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    submitted_request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    assert client.post(
        f"/requests/{submitted_request['id']}/dds-items",
        json={"dds_id": DDS_LICENSE_ID, "sum_plan": 1000},
        headers=employee,
    ).status_code == 200
    assert client.post(f"/requests/{submitted_request['id']}/submit", headers=employee).status_code == 200

    requests_list = client.get("/requests", headers=economist)
    assert requests_list.status_code == 200
    assert all(item["id"] != draft_request["id"] for item in requests_list.json())
    assert any(item["id"] == submitted_request["id"] for item in requests_list.json())
    assert client.get(f"/requests/{draft_request['id']}", headers=economist).status_code == 403
    assert client.get(f"/requests/{submitted_request['id']}", headers=economist).status_code == 200


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


def test_direct_upload_download_for_dds_and_invest_items(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    dds_item = client.post(f"/requests/{request['id']}/dds-items", json={"dds_id": DDS_LICENSE_ID, "sum_plan": 1000}, headers=employee).json()
    invest_item = client.post(
        f"/requests/{request['id']}/invest-items",
        json={"invest_id": INVEST_PLATFORM_ID, "sum_plan": 2000},
        headers=employee,
    ).json()

    dds_upload = client.post(
        f"/dds-items/{dds_item['id']}/files",
        headers=employee,
        files={"file": ("kp.pdf", b"demo pdf content", "application/pdf")},
    )
    assert dds_upload.status_code == 200
    downloaded = client.get(f"/files/{dds_upload.json()['id']}/download", headers=employee)
    assert downloaded.status_code == 200
    assert downloaded.content == b"demo pdf content"

    invest_upload = client.post(
        f"/invest-items/{invest_item['id']}/files",
        headers=employee,
        files={"file": ("plan.png", b"not really png", "image/png")},
    )
    assert invest_upload.status_code == 200
    files = client.get(f"/invest-items/{invest_item['id']}/files", headers=employee)
    assert files.status_code == 200
    assert files.json()[0]["id"] == invest_upload.json()["id"]


def test_unicode_filename_download(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    dds_item = client.post(f"/requests/{request['id']}/dds-items", json={"dds_id": DDS_LICENSE_ID, "sum_plan": 1000}, headers=employee).json()

    upload = client.post(
        f"/dds-items/{dds_item['id']}/files",
        headers=employee,
        files={"file": ("договор.pdf", b"unicode filename", "application/pdf")},
    )
    assert upload.status_code == 200
    downloaded = client.get(f"/files/{upload.json()['id']}/download", headers=employee)
    assert downloaded.status_code == 200
    assert downloaded.content == b"unicode filename"
    assert "filename*=" in downloaded.headers["content-disposition"]


def test_employee_can_delete_item_file_attachment(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    dds_item = client.post(f"/requests/{request['id']}/dds-items", json={"dds_id": DDS_LICENSE_ID, "sum_plan": 1000}, headers=employee).json()

    upload = client.post(
        f"/dds-items/{dds_item['id']}/files",
        headers=employee,
        files={"file": ("kp.pdf", b"demo pdf content", "application/pdf")},
    )
    assert upload.status_code == 200
    file_id = upload.json()["id"]

    deleted = client.delete(f"/dds-items/{dds_item['id']}/files/{file_id}", headers=employee)
    assert deleted.status_code == 200
    files = client.get(f"/dds-items/{dds_item['id']}/files", headers=employee)
    assert files.status_code == 200
    assert files.json() == []
    assert client.get(f"/files/{file_id}/download", headers=employee).status_code == 404


def test_foreign_request_and_role_field_restrictions(tmp_path):
    client = make_client(tmp_path)
    admin = auth(client, "admin", "admin")
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")

    created_user = client.post(
        "/users",
        json={"login": "other", "password": "other", "role": "employee", "name": "Other", "last_name": "Employee"},
        headers=admin,
    )
    assert created_user.status_code == 200
    unit = client.post(
        "/units",
        json={"parent_id": None, "name": "Other unit", "type": "department", "is_active": True},
        headers=admin,
    )
    assert unit.status_code == 200
    assert client.post(f"/units/{unit.json()['id']}/responsible", json={"user_id": created_user.json()["id"]}, headers=admin).status_code == 200
    other = auth(client, "other", "other")
    foreign = client.post("/requests", json={"unit_id": unit.json()["id"]}, headers=other)
    assert foreign.status_code == 200
    denied = client.get(f"/requests/{foreign.json()['id']}", headers=employee)
    assert denied.status_code == 403

    dds_item = client.get(f"/requests/{REQUEST_ID}/dds-items", headers=economist).json()[0]
    economist_patch = client.patch(f"/dds-items/{dds_item['id']}", json={"sum_plan": 1}, headers=economist)
    assert economist_patch.status_code == 403

    employee_request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    item = client.post(f"/requests/{employee_request['id']}/dds-items", json={"dds_id": DDS_LICENSE_ID, "sum_plan": 1000}, headers=employee).json()
    assert client.post(f"/requests/{employee_request['id']}/submit", headers=employee).status_code == 200
    employee_patch = client.patch(f"/dds-items/{item['id']}", json={"sum_fact": 1, "status": "approved"}, headers=employee)
    assert employee_patch.status_code == 400


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

    exported = client.get(f"/requests/{REQUEST_ID}/export", headers=admin)
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

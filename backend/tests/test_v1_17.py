from tests.test_api import auth, make_client
from app.seed import DDS_LICENSE_ID, INVEST_PLATFORM_ID, MODULE_ALPHA_ID


def test_request_lines_chat_logs_and_budget_mode(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")

    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    line = client.post(
        f"/requests/{request['id']}/items",
        json={"dds_id": DDS_LICENSE_ID, "name": "Продление лицензии", "sum_plan": 1000, "justification": "Для непрерывной работы"},
        headers=employee,
    )
    assert line.status_code == 200
    assert line.json()["name"] == "Продление лицензии"
    assert line.json()["justification"] == "Для непрерывной работы"

    wrong_kind = client.post(
        f"/requests/{request['id']}/items",
        json={"invest_id": INVEST_PLATFORM_ID, "name": "Неверная строка", "sum_plan": 1, "justification": ""},
        headers=employee,
    )
    assert wrong_kind.status_code == 400

    deleted = client.delete(f"/items/{line.json()['id']}", headers=employee)
    assert deleted.status_code == 200
    assert deleted.json()["status"] == "deleted"
    assert deleted.json()["sum_plan"] == 0
    assert deleted.json()["sum_fact"] == 0
    assert client.get(f"/requests/{request['id']}/summary", headers=employee).json()["planned_sum"] == 0
    assert client.get(f"/requests/{request['id']}/items", headers=employee).json()[0]["status"] == "deleted"
    delete_history = client.get(f"/requests/{request['id']}/logs", headers=employee).json()
    assert any(entry["log"]["action"] == "line_deleted" for entry in delete_history)

    line = client.post(
        f"/requests/{request['id']}/items",
        json={"dds_id": DDS_LICENSE_ID, "name": "Продление лицензии", "sum_plan": 1000, "justification": "Для непрерывной работы"},
        headers=employee,
    )
    assert line.status_code == 200
    assert client.post(f"/requests/{request['id']}/submit", headers=employee).status_code == 200
    noop = client.patch(f"/items/{line.json()['id']}", json={"status": "on_review"}, headers=economist)
    assert noop.status_code == 403

    rejected_by_cfo = client.post(
        f"/items/{line.json()['id']}/cfo-decision",
        json={"decision": "rejected", "comment": "Не входит в бюджет"},
        headers=employee,
    )
    assert rejected_by_cfo.status_code == 200
    assert rejected_by_cfo.json()["status"] == "rejected"
    assert rejected_by_cfo.json()["sum_fact"] == 0

    chat = client.get(f"/requests/{request['id']}/chat", headers=employee).json()
    sent = client.post(f"/chats/{chat['id']}/messages", json={"text": "Нужна консультация"}, headers=employee)
    assert sent.status_code == 200
    chat = client.get(f"/requests/{request['id']}/chat", headers=employee)
    assert chat.status_code == 200, chat.json()
    assert chat.json()["messages"][-1]["text"] == "Нужна консультация"
    logs = client.get(f"/requests/{request['id']}/logs", headers=employee)
    assert {entry["log"]["action"] for entry in logs.json()} >= {"request_created", "line_created"}
    assert {entry["user"]["login"] for entry in logs.json()} == {"employee"}
    assert any(entry["log"]["action"] == "cfo_item_decided" for entry in logs.json())
    line_log = next(entry for entry in logs.json() if entry["log"]["action"] == "line_created")
    assert line_log["subject"] == {
        "type": "request_line",
        "name": line.json()["name"],
        "article": "Операционные расходы",
        "category": "Лицензии и подписки",
    }

def test_unit_mode_cannot_change_while_active_lines_exist(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    admin = auth(client, "admin", "admin")
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    created = client.post(
        f"/requests/{request['id']}/items",
        json={"dds_id": DDS_LICENSE_ID, "name": "Line", "sum_plan": 1, "justification": "Test"},
        headers=employee,
    )
    assert created.status_code == 200
    assert client.post(f"/requests/{request['id']}/submit", headers=employee).status_code == 200
    changed = client.patch(
        f"/units/{MODULE_ALPHA_ID}",
        json={"uses_invest_projects": True},
        headers=admin,
    )
    assert changed.status_code == 409
    assert "уже создана заявка" in changed.json()["detail"]


def test_request_line_cannot_use_catalog_entry_from_another_department(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    admin = auth(client, "admin", "admin")
    other_unit = client.post(
        "/units",
        json={"name": "Other department", "type": "department", "parent_id": None, "is_active": True},
        headers=admin,
    )
    assert other_unit.status_code == 200
    foreign_article = client.post(
        "/catalog/dds",
        json={"unit_id": other_unit.json()["id"], "parent_id": None, "name": "Foreign article", "is_active": True},
        headers=admin,
    )
    assert foreign_article.status_code == 200
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    response = client.post(
        f"/requests/{request['id']}/items",
        json={"dds_id": foreign_article.json()["id"], "name": "Line", "sum_plan": 1, "justification": "Test"},
        headers=employee,
    )
    assert response.status_code == 400

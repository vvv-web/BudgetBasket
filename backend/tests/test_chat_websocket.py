import pytest

from fastapi import HTTPException

from app.seed import CFO_ID, DDS_LICENSE_ID, MODULE_ALPHA_ID
from app.security import hash_password
from tests.test_api import auth, make_client


def add_cfo_responsible(client):
    repo = client.app.state.repo
    role_id = next(row["id"] for row in repo.load_all("roles") if row["name"] == "employee")
    user_id = "90000000-0000-0000-0000-000000000001"
    repo.insert("users", {"id": user_id, "login": "cfo", "password": hash_password("cfo"), "id_role": role_id})
    repo.update_where("units_responsibles", {"unit_id": CFO_ID, "user_id": "00000000-0000-0000-0000-000000000003"}, {"is_active": False})
    repo.insert("units_responsibles", {"unit_id": CFO_ID, "user_id": user_id, "is_active": True})
    return auth(client, "cfo", "cfo")


def submitted_request(client, employee):
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    assert client.post(
        f"/requests/{request['id']}/items",
        json={"dds_id": DDS_LICENSE_ID, "name": "Лицензия", "sum_plan": 1, "justification": ""}, headers=employee,
    ).status_code == 200
    assert client.post(f"/requests/{request['id']}/submit", headers=employee).status_code == 200
    return request


def request_chat(client, request, headers):
    response = client.get(f"/requests/{request['id']}/chat", headers=headers)
    assert response.status_code == 200
    return response.json()


def cfo_position(client, *, year=2026):
    return client.app.state.repo.insert("cfo_positions", {
        "budget_year": year, "cfo_unit_id": CFO_ID, "dds_id": DDS_LICENSE_ID,
        "invest_id": None, "status": "waiting", "current_step_id": None, "frozen": False, "fixed": False,
    })


def test_draft_request_has_no_chat(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    assert client.get(f"/requests/{request['id']}/chat", headers=employee).status_code == 400


def test_module_chat_is_reused_and_separated_by_year(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    cfo = add_cfo_responsible(client)
    request = submitted_request(client, employee)
    first = request_chat(client, request, employee)
    assert first["kind"] == "module_cfo"
    assert request_chat(client, request, cfo)["id"] == first["id"]
    next_year = client.app.state.chat_service._get_or_create("module_cfo", MODULE_ALPHA_ID, int(first["budget_year"]) + 1, repo=client.app.state.repo)
    assert next_year["id"] != first["id"]


def test_chat_kinds_are_separate_and_validate_unit_type(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    cfo = add_cfo_responsible(client)
    position = cfo_position(client)
    response = client.get(f"/cfo-positions/{position['id']}/chat", headers=cfo)
    assert response.status_code == 200
    assert response.json()["kind"] == "cfo_economist"
    same_context_position = cfo_position(client)
    assert client.get(f"/cfo-positions/{same_context_position['id']}/chat", headers=cfo).json()["id"] == response.json()["id"]
    service = client.app.state.chat_service
    with pytest.raises(HTTPException) as invalid_module:
        service._get_or_create("module_cfo", CFO_ID, 2026, repo=client.app.state.repo)
    assert invalid_module.value.status_code == 409
    with pytest.raises(HTTPException) as invalid_cfo:
        service._get_or_create("cfo_economist", MODULE_ALPHA_ID, 2026, repo=client.app.state.repo)
    assert invalid_cfo.value.status_code == 409


def test_module_and_economist_access_boundaries(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    cfo = add_cfo_responsible(client)
    request = submitted_request(client, employee)
    module_chat = request_chat(client, request, employee)
    position = cfo_position(client)
    cfo_chat = client.get(f"/cfo-positions/{position['id']}/chat", headers=cfo).json()
    assert client.get(f"/chats/{module_chat['id']}", headers=cfo).status_code == 200
    assert client.get(f"/chats/{module_chat['id']}", headers=economist).status_code == 403
    assert client.get(f"/chats/{cfo_chat['id']}", headers=employee).status_code == 403
    assert client.get(f"/chats/{cfo_chat['id']}", headers=cfo).status_code == 200
    assert client.get("/chats", headers=economist).json()[0]["id"] == cfo_chat["id"]


def test_another_cfo_is_forbidden(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    cfo = add_cfo_responsible(client)
    request = submitted_request(client, employee)
    chat = request_chat(client, request, cfo)
    repo = client.app.state.repo
    role_id = next(row["id"] for row in repo.load_all("roles") if row["name"] == "employee")
    repo.insert("users", {"id": "90000000-0000-0000-0000-000000000002", "login": "other", "password": hash_password("other"), "id_role": role_id})
    other = auth(client, "other", "other")
    assert client.get(f"/chats/{chat['id']}", headers=other).status_code == 403


def test_admin_reads_but_cannot_write(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    admin = auth(client, "admin", "admin")
    add_cfo_responsible(client)
    chat = request_chat(client, submitted_request(client, employee), employee)
    assert client.get(f"/chats/{chat['id']}", headers=admin).status_code == 200
    assert client.post(f"/chats/{chat['id']}/messages", json={"text": "Нельзя"}, headers=admin).status_code == 403


def test_unread_and_websocket_use_chat_id(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    cfo = add_cfo_responsible(client)
    chat = request_chat(client, submitted_request(client, employee), employee)
    token = cfo["Authorization"].removeprefix("Bearer ")
    with client.websocket_connect(f"/ws/chats/{chat['id']}?token={token}") as websocket:
        response = client.post(f"/chats/{chat['id']}/messages", json={"text": "Проверьте сумму"}, headers=employee)
        assert response.status_code == 200
        assert websocket.receive_json() == {"type": "chat.message.created", "message_id": response.json()["id"]}
    listed = client.get("/chats", headers=cfo).json()
    assert listed[0]["unread_count"] == 2  # submission system message + user message


def test_notification_contains_chat_context(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    cfo = add_cfo_responsible(client)
    chat = request_chat(client, submitted_request(client, employee), employee)
    token = cfo["Authorization"].removeprefix("Bearer ")
    with client.websocket_connect(f"/ws/chat-notifications?token={token}") as websocket:
        response = client.post(f"/chats/{chat['id']}/messages", json={"text": "Сообщение"}, headers=employee)
        assert websocket.receive_json() == {"type": "chat.message.created", "chat_id": chat["id"], "message_id": response.json()["id"], "kind": "module_cfo", "text": "Сообщение"}


def test_images_attach_to_new_chat(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    cfo = add_cfo_responsible(client)
    chat = request_chat(client, submitted_request(client, employee), employee)
    response = client.post(f"/chats/{chat['id']}/messages/images", data={"text": "Схема"}, files=[("images", ("diagram.png", b"image", "image/png"))], headers=employee)
    assert response.status_code == 200
    attached = response.json()["files"][0]
    assert client.get(f"/files/{attached['id']}/download", headers=cfo).status_code == 200


def test_system_messages_go_to_matching_kind(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    cfo = add_cfo_responsible(client)
    request = submitted_request(client, employee)
    module_chat = request_chat(client, request, cfo)
    assert any(message["is_system"] for message in module_chat["messages"])
    position = cfo_position(client)
    cfo_chat = client.get(f"/cfo-positions/{position['id']}/chat", headers=cfo).json()
    client.app.state.chat_service.system_message_for_position(position, "Позиция передана экономисту.")
    assert any(message["is_system"] for message in client.get(f"/chats/{cfo_chat['id']}", headers=cfo).json()["messages"])


def test_responsible_change_refreshes_existing_chat_participants(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    old_cfo = add_cfo_responsible(client)
    chat = request_chat(client, submitted_request(client, employee), employee)
    repo = client.app.state.repo
    role_id = next(row["id"] for row in repo.load_all("roles") if row["name"] == "employee")
    new_cfo_id = "90000000-0000-0000-0000-000000000003"
    repo.insert("users", {"id": new_cfo_id, "login": "new-cfo", "password": hash_password("new-cfo"), "id_role": role_id})
    admin = auth(client, "admin", "admin")
    assert client.post(f"/units/{CFO_ID}/responsible", json={"user_id": new_cfo_id}, headers=admin).status_code == 200
    new_cfo = auth(client, "new-cfo", "new-cfo")
    assert client.get(f"/chats/{chat['id']}", headers=old_cfo).status_code == 403
    assert client.get(f"/chats/{chat['id']}", headers=new_cfo).status_code == 200

from app.seed import DDS_LICENSE_ID, MODULE_ALPHA_ID
from tests.test_api import auth, make_client


def submitted_request(client, employee):
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    line = client.post(
        f"/requests/{request['id']}/items",
        json={"dds_id": DDS_LICENSE_ID, "name": "Лицензия", "sum_plan": 1, "justification": ""},
        headers=employee,
    )
    assert line.status_code == 200
    assert client.post(f"/requests/{request['id']}/submit", headers=employee).status_code == 200
    return request


def test_draft_request_has_no_chat(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()

    response = client.get(f"/requests/{request['id']}/chat", headers=employee)
    assert response.status_code == 400
    assert client.post(f"/requests/{request['id']}/chat/messages", json={"text": "Черновик"}, headers=employee).status_code == 400


def test_chat_websocket_notifies_request_participants(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    request = submitted_request(client, employee)
    economist_token = economist["Authorization"].removeprefix("Bearer ")

    with client.websocket_connect(f"/ws/requests/{request['id']}/chat?token={economist_token}") as websocket:
        response = client.post(
            f"/requests/{request['id']}/chat/messages",
            json={"text": "Нужно согласование"},
            headers=employee,
        )
        assert response.status_code == 200
        assert websocket.receive_json() == {
            "type": "chat.message.created",
            "message_id": response.json()["id"],
        }


def test_chat_notification_and_list_include_unread_message(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    request = submitted_request(client, employee)
    economist_token = economist["Authorization"].removeprefix("Bearer ")

    with client.websocket_connect(f"/ws/chat-notifications?token={economist_token}") as websocket:
        response = client.post(
            f"/requests/{request['id']}/chat/messages",
            json={"text": "Проверьте, пожалуйста, сумму"},
            headers=employee,
        )
        assert response.status_code == 200
        assert websocket.receive_json() == {
            "type": "chat.message.created",
            "request_id": request["id"],
            "message_id": response.json()["id"],
            "text": "Проверьте, пожалуйста, сумму",
        }

    chats = client.get("/chats", headers=economist)
    assert chats.status_code == 200
    assert chats.json()[0]["request_id"] == request["id"]
    assert chats.json()[0]["unread_count"] == 1
    assert chats.json()[0]["last_message"]["text"] == "Проверьте, пожалуйста, сумму"

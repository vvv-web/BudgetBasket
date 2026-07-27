from app.seed import APPROVER_STEP_ID, DDS_LICENSE_ID, LEAF_STEP_ID, MODULE_ALPHA_ID, ROOT_STEP_ID
from tests.test_api import auth, make_client


def create_submitted_request(client, employee):
    created = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee)
    assert created.status_code == 200
    request_id = created.json()["id"]
    item = client.post(
        f"/requests/{request_id}/items",
        json={"dds_id": DDS_LICENSE_ID, "name": "Лицензия", "sum_plan": 100, "justification": "Для работы"},
        headers=employee,
    )
    assert item.status_code == 200
    assert client.post(f"/requests/{request_id}/submit", headers=employee).status_code == 200
    return request_id, item.json()["id"]


def finalize_by_economist(client, request_id, item_id, economist):
    assert client.patch(f"/items/{item_id}", json={"status": "approved"}, headers=economist).status_code == 200
    finalized = client.post(f"/requests/{request_id}/finalize", headers=economist)
    assert finalized.status_code == 200
    assert finalized.json()["frozen"] is True
    return finalized.json()


def test_draft_request_is_on_revision_at_economist_step_until_submission(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    admin = auth(client, "admin", "admin")
    draft = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee)
    assert draft.status_code == 200

    route = client.get(f"/requests/{draft.json()['id']}/approval-route", headers=employee).json()
    assert [item["step"]["request_status"] for item in route] == ["on_revision", "waiting", "waiting"]
    graph_steps = client.get("/steps", headers=admin).json()
    assert next(step for step in graph_steps if step["id"] == LEAF_STEP_ID)["status"] == "on_revision"


def test_submission_creates_independent_step_states_and_economist_task(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    request_id, _ = create_submitted_request(client, employee)

    route = client.get(f"/requests/{request_id}/approval-route", headers=employee).json()
    assert [(item["step"]["id"], item["step"]["request_status"]) for item in route] == [
        (LEAF_STEP_ID, "on_approval"),
        (APPROVER_STEP_ID, "waiting"),
        (ROOT_STEP_ID, "waiting"),
    ]
    tasks = client.get("/steps/my", headers=economist).json()
    assert [(step["id"], step["active_requests_count"]) for step in tasks] == [(LEAF_STEP_ID, 1)]


def test_zgd_step_cannot_have_following_nodes(tmp_path):
    client = make_client(tmp_path)
    admin = auth(client, "admin", "admin")
    response = client.post(
        "/step-edges",
        json={"parent_step_id": ROOT_STEP_ID, "child_step_id": LEAF_STEP_ID},
        headers=admin,
    )
    assert response.status_code == 400


def test_economist_freezes_and_sends_request_to_next_step(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")
    request_id, item_id = create_submitted_request(client, employee)

    finalized = finalize_by_economist(client, request_id, item_id, economist)
    assert finalized["status"] == "approved"
    assert finalized["fixed"] is False
    assert client.get(f"/requests/{request_id}/approval-step", headers=approver).json()["can_approve"] is True
    route = client.get(f"/requests/{request_id}/approval-route", headers=employee).json()
    assert [item["step"]["request_status"] for item in route] == ["approved", "on_approval", "waiting"]


def test_return_reaches_economist_then_employee_for_revision(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")
    request_id, item_id = create_submitted_request(client, employee)
    finalize_by_economist(client, request_id, item_id, economist)

    returned = client.post(
        f"/steps/{APPROVER_STEP_ID}/return",
        json={"targets": [{"child_step_id": LEAF_STEP_ID, "request_ids": [request_id]}], "comment": "Уточнить обоснование"},
        headers=approver,
    )
    assert returned.status_code == 200
    route = client.get(f"/requests/{request_id}/approval-route", headers=employee).json()
    return_log = next(
        log
        for route_step in route
        for log in route_step["logs"]
        if log["log"].get("comment") == "Уточнить обоснование"
    )
    assert return_log["step_id"] == APPROVER_STEP_ID
    request = client.get(f"/requests/{request_id}", headers=employee).json()
    assert request["frozen"] is True
    assert client.get(f"/requests/{request_id}/approval-step", headers=economist).json()["request_status"] == "on_revision"

    resumed = client.post(f"/requests/{request_id}/resume-economist-review", headers=economist)
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "on_review"
    assert resumed.json()["frozen"] is False
    assert client.get(f"/requests/{request_id}/approval-step", headers=economist).json()["request_status"] == "on_approval"

    assert client.post(
        f"/steps/{LEAF_STEP_ID}/return",
        json={"request_ids": [request_id], "comment": "Вернуть сотруднику"},
        headers=economist,
    ).status_code == 200
    chat = client.get(f"/requests/{request_id}/chat", headers=employee)
    assert chat.status_code == 200
    assert any("Комментарий: Вернуть сотруднику" in item["text"] for item in chat.json()["messages"])
    request = client.get(f"/requests/{request_id}", headers=employee).json()
    assert request["status"] == "draft"
    assert request["frozen"] is False
    assert client.post(f"/requests/{request_id}/cancel", headers=employee).status_code == 200


def test_zgd_is_the_only_actor_that_sets_fixed_and_closes_final_step(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")
    zgd = auth(client, "zgd", "zgd")
    request_id, item_id = create_submitted_request(client, employee)
    finalize_by_economist(client, request_id, item_id, economist)

    assert client.post(f"/steps/{APPROVER_STEP_ID}/requests/{request_id}/approve", headers=approver).status_code == 200
    assert client.post(f"/steps/{APPROVER_STEP_ID}/approve", headers=approver).status_code == 200
    fixed = client.post(f"/steps/{ROOT_STEP_ID}/requests/{request_id}/approve", headers=zgd)
    assert fixed.status_code == 200
    request = client.get(f"/requests/{request_id}", headers=employee).json()
    assert request["fixed"] is True
    route = client.get(f"/requests/{request_id}/approval-route", headers=employee).json()
    assert [item["step"]["request_status"] for item in route] == ["closed", "closed", "closed"]
    assert client.post(f"/steps/{ROOT_STEP_ID}/requests/{request_id}/approve", headers=zgd).status_code == 409


def test_reviewer_forwards_only_requests_that_reached_the_step(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")

    first_request_id, first_item_id = create_submitted_request(client, employee)
    second_request_id, second_item_id = create_submitted_request(client, employee)
    finalize_by_economist(client, first_request_id, first_item_id, economist)

    assert client.post(
        f"/steps/{APPROVER_STEP_ID}/requests/{first_request_id}/approve",
        headers=approver,
    ).status_code == 200
    forwarded = client.post(f"/steps/{APPROVER_STEP_ID}/approve", headers=approver)
    assert forwarded.status_code == 200

    route = client.get(f"/requests/{first_request_id}/approval-route", headers=employee).json()
    assert [item["step"]["request_status"] for item in route] == ["approved", "approved", "on_approval"]

    finalize_by_economist(client, second_request_id, second_item_id, economist)
    assert client.post(
        f"/steps/{APPROVER_STEP_ID}/requests/{second_request_id}/approve",
        headers=approver,
    ).status_code == 200
    assert client.post(f"/steps/{APPROVER_STEP_ID}/approve", headers=approver).status_code == 200

    for request_id in (first_request_id, second_request_id):
        route = client.get(f"/requests/{request_id}/approval-route", headers=employee).json()
        assert [item["step"]["request_status"] for item in route] == ["approved", "approved", "on_approval"]


def test_cancel_is_available_only_for_a_draft(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request_id, _ = create_submitted_request(client, employee)
    assert client.post(f"/requests/{request_id}/cancel", headers=employee).status_code == 400
    draft = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    assert client.post(f"/requests/{draft['id']}/cancel", headers=employee).status_code == 200


def test_edge_delete_preview_warns_about_approved_past(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    admin = auth(client, "admin", "admin")
    request_id, item_id = create_submitted_request(client, employee)
    finalize_by_economist(client, request_id, item_id, economist)

    preview = client.post(
        "/step-edges/preview-delete",
        json={"parent_step_id": APPROVER_STEP_ID, "child_step_id": LEAF_STEP_ID},
        headers=admin,
    )
    assert preview.status_code == 200
    body = preview.json()
    assert body["has_approved_past"] is True
    assert body["approved_past_count"] >= 1
    assert body["before_graph"]["nodes"]
    assert body["before_graph"]["edges"]
    assert body["removed_edge"] == {
        "parent_step_id": APPROVER_STEP_ID,
        "child_step_id": LEAF_STEP_ID,
    }
    assert len(body["after_graph"]["edges"]) < len(body["before_graph"]["edges"])


def test_empty_reviewer_step_can_be_created_linked_and_deleted(tmp_path):
    client = make_client(tmp_path)
    admin = auth(client, "admin", "admin")
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    users = client.get("/users", headers=admin).json()
    approver = next(user for user in users if user["login"] == "approver")

    created = client.post(
        "/steps",
        json={"user_id": approver["id"], "child_step_id": LEAF_STEP_ID},
        headers=admin,
    )
    assert created.status_code == 200
    step = created.json()
    assert LEAF_STEP_ID in step["child_step_ids"]
    assert client.delete(f"/steps/{step['id']}", headers=admin).status_code == 200

    request_id, item_id = create_submitted_request(client, employee)
    finalize_by_economist(client, request_id, item_id, economist)
    blocked = client.delete(f"/steps/{APPROVER_STEP_ID}", headers=admin)
    assert blocked.status_code == 400
    assert "поступали заявки" in blocked.json()["detail"]

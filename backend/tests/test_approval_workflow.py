import pytest

from app.seed import (
    APPROVER_STEP_ID,
    APPROVER_ID,
    CFO_ID,
    DEPARTMENT_ID,
    DDS_OPER_ID,
    DDS_LICENSE_ID,
    ECONOMIST_ID,
    ECONOMIST_STEP_ID,
    LEAF_STEP_ID,
    MODULE_ALPHA_ID,
    ROOT_STEP_ID,
)
from tests.test_api import auth, make_client, user_payload


def test_cfo_responsible_can_view_its_read_only_route(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")

    response = client.get("/approval-route", headers=employee)

    assert response.status_code == 200
    assert {step["id"] for step in response.json()} >= {
        LEAF_STEP_ID,
        ECONOMIST_STEP_ID,
        APPROVER_STEP_ID,
        ROOT_STEP_ID,
    }
    for login, expected_step_id in (
        ("economist", ECONOMIST_STEP_ID),
        ("approver", APPROVER_STEP_ID),
        ("zgd", ROOT_STEP_ID),
    ):
        branch = client.get("/approval-route", headers=auth(client, login, login))
        assert branch.status_code == 200
        assert expected_step_id in {step["id"] for step in branch.json()}

    approver_route = client.get("/approval-route", headers=auth(client, "approver", "approver")).json()
    approver_ids = [step["id"] for step in approver_route]
    assert set(approver_ids) >= {LEAF_STEP_ID, ECONOMIST_STEP_ID, APPROVER_STEP_ID, ROOT_STEP_ID}
    assert approver_ids.index(LEAF_STEP_ID) < approver_ids.index(ECONOMIST_STEP_ID) < approver_ids.index(APPROVER_STEP_ID) < approver_ids.index(ROOT_STEP_ID)

    zgd_route = client.get("/approval-route", headers=auth(client, "zgd", "zgd")).json()
    zgd_ids = [step["id"] for step in zgd_route]
    assert set(zgd_ids) >= {LEAF_STEP_ID, ECONOMIST_STEP_ID, APPROVER_STEP_ID, ROOT_STEP_ID}
    assert zgd_ids.index(LEAF_STEP_ID) < zgd_ids.index(ECONOMIST_STEP_ID) < zgd_ids.index(APPROVER_STEP_ID) < zgd_ids.index(ROOT_STEP_ID)


def test_module_responsible_sees_only_its_route_branch(tmp_path):
    client = make_client(tmp_path)
    admin = auth(client, "admin", "admin")
    module_user = client.post(
        "/users",
        json=user_payload("module-branch-user"),
        headers=admin,
    ).json()
    assert client.post(
        f"/units/{MODULE_ALPHA_ID}/responsible",
        json={"user_id": module_user["id"]},
        headers=admin,
    ).status_code == 200

    branch = client.get(
        "/approval-route",
        headers=auth(client, "module-branch-user", "password"),
    )

    assert branch.status_code == 200
    modules = [module["id"] for step in branch.json() for module in step.get("modules", [])]
    assert modules == [MODULE_ALPHA_ID]


def test_module_responsible_has_no_approval_actions(tmp_path):
    client = make_client(tmp_path)
    admin = auth(client, "admin", "admin")
    module_user = client.post(
        "/users",
        json=user_payload("module-actions-user"),
        headers=admin,
    ).json()
    assert client.post(
        f"/units/{MODULE_ALPHA_ID}/responsible",
        json={"user_id": module_user["id"]},
        headers=admin,
    ).status_code == 200
    module_employee = auth(client, "module-actions-user", "password")

    request = client.post(
        "/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=module_employee
    ).json()
    item = client.post(
        f"/requests/{request['id']}/items",
        json={
            "dds_id": DDS_LICENSE_ID,
            "name": "Строка без согласования модулем",
            "sum_plan": 100,
        },
        headers=module_employee,
    ).json()
    assert client.post(
        f"/requests/{request['id']}/submit", headers=module_employee
    ).status_code == 200

    rows = client.get(
        "/approval-register/rows",
        params={"request_id": request["id"], "page_size": 25},
        headers=module_employee,
    )
    assert rows.status_code == 200, rows.text
    row = next(entry for entry in rows.json()["items"] if entry["id"] == item["id"])
    assert row["is_cfo_review_actionable"] is False
    assert row["is_approval_actionable"] is False
    assert row["is_position_actionable"] is False
    assert row["status_context"]["editability"]["can_decide"] is False

    forbidden = client.post(
        f"/items/{item['id']}/cfo-decision",
        json={"decision": "approved", "comment": ""},
        headers=module_employee,
    )
    assert forbidden.status_code == 403


def test_route_does_not_include_sibling_branch_after_shared_step(tmp_path):
    client = make_client(tmp_path)
    admin = auth(client, "admin", "admin")
    employee = auth(client, "employee", "employee")

    sibling_cfo = client.post(
        "/units",
        json={"name": "ЦФО другой ветки", "type": "cfo", "parent_id": DEPARTMENT_ID},
        headers=admin,
    ).json()
    assignment = client.post(
        "/economist-assignments",
        json={"economist_id": ECONOMIST_ID, "unit_id": sibling_cfo["id"], "assignment_type": "cfo"},
        headers=admin,
    )
    assert assignment.status_code == 200

    route = client.get("/approval-route", headers=employee)

    assert route.status_code == 200
    assert sibling_cfo["id"] not in {step.get("unit_id") for step in route.json()}


def create_submitted_request(client, employee, *, item_count=1):
    request = client.post(
        "/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee
    )
    assert request.status_code == 200
    items = []
    for index in range(item_count):
        item = client.post(
            f"/requests/{request.json()['id']}/items",
            json={
                "dds_id": DDS_LICENSE_ID,
                "name": f"Строка {index + 1}",
                "sum_plan": 100 * (index + 1),
                "justification": "План",
            },
            headers=employee,
        )
        assert item.status_code == 200
        items.append(item.json())
    assert client.post(
        f"/requests/{request.json()['id']}/submit", headers=employee
    ).status_code == 200
    return request.json(), items


def complete_cfo(client, employee, request_id, decisions):
    for item_id, decision in decisions:
        response = client.post(
            f"/items/{item_id}/cfo-decision",
            json={
                "decision": decision,
                "comment": "Причина" if decision == "rejected" else "",
            },
            headers=employee,
        )
        assert response.status_code == 200
    completed = client.post(
        f"/requests/{request_id}/complete-cfo-review", headers=employee
    )
    assert completed.status_code == 200, completed.text
    return completed.json()


def send_and_review_by_economist(client, employee, economist, position_id, item_ids):
    sent = client.post(
        f"/cfo-positions/{position_id}/submit-to-economist",
        json={"comment": "Передано"},
        headers=employee,
    )
    assert sent.status_code == 200, sent.text
    for item_id in item_ids:
        decided = client.post(
            f"/cfo-positions/{position_id}/items/{item_id}/decision",
            json={"decision": "approved", "comment": ""},
            headers=economist,
        )
        assert decided.status_code == 200, decided.text
    completed = client.post(
        f"/cfo-positions/{position_id}/complete-review",
        json={"comment": "Проверено"},
        headers=economist,
    )
    assert completed.status_code == 200, completed.text
    return completed.json()


def test_partial_cfo_review_keeps_request_open_and_consolidates_all_lines(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request, items = create_submitted_request(client, employee, item_count=2)

    completed = complete_cfo(
        client,
        employee,
        request["id"],
        [(items[0]["id"], "approved"), (items[1]["id"], "rejected")],
    )

    assert completed["status"] == "on_review"
    assert len(completed["affected_cfo_position_ids"]) == 1
    current = client.get(
        f"/requests/{request['id']}/items", headers=employee
    ).json()
    assert current[0]["cfo_position_id"] is not None
    assert current[1]["cfo_position_id"] == current[0]["cfo_position_id"]
    assert current[0]["status"] == "on_review"
    assert current[1]["sum_fact"] == 0


def test_zgd_approval_is_reversible_until_the_budget_is_locked(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    zgd = auth(client, "zgd", "zgd")
    request, items = create_submitted_request(client, employee, item_count=2)
    position_id = complete_cfo(
        client,
        employee,
        request["id"],
        [(item["id"], "approved") for item in items],
    )["affected_cfo_position_ids"][0]
    send_and_review_by_economist(client, employee, economist, position_id, [item["id"] for item in items])
    assert client.post(
        f"/cfo-positions/{position_id}/freeze",
        json={"comment": "Freeze after economist review"},
        headers=economist,
    ).status_code == 200
    approver = auth(client, "approver", "approver")
    assert client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Approved by reviewer"},
        headers=approver,
    ).status_code == 200
    register = client.get(
        "/approval-register/rows",
        params={"module_id": MODULE_ALPHA_ID, "request_id": request["id"]},
        headers=zgd,
    )
    assert register.status_code == 200
    assert all(row["is_final_approval_actionable"] for row in register.json()["items"])

    first = client.post(
        f"/steps/{ROOT_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Approve first line", "item_ids": [items[0]["id"]]},
        headers=zgd,
    )
    assert first.status_code == 200, first.text
    assert first.json()["all_items_fixed"] is False
    assert first.json()["current_step_id"] == ROOT_STEP_ID

    refreshed = client.get(
        "/approval-register/rows",
        params={"module_id": MODULE_ALPHA_ID, "request_id": request["id"]},
        headers=zgd,
    )
    by_id = {row["id"]: row for row in refreshed.json()["items"]}
    assert by_id[items[0]["id"]]["fixed"] is False
    assert by_id[items[1]["id"]]["is_final_approval_actionable"] is True

    repeated = client.post(
        f"/steps/{ROOT_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Repeat approved line", "item_ids": [items[0]["id"]]},
        headers=zgd,
    )
    assert repeated.status_code == 200
    assert client.post(
        f"/steps/{ROOT_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Unknown line", "item_ids": ["foreign-item"]},
        headers=zgd,
    ).status_code == 422

    second = client.post(
        f"/steps/{ROOT_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Approve second line", "item_ids": [items[1]["id"]]},
        headers=zgd,
    )
    assert second.status_code == 200, second.text
    assert second.json()["all_items_fixed"] is False
    locked = client.post(
        f"/approval-register/groups/article/{DDS_OPER_ID}/workflow-action",
        json={"action": "fix", "comment": "Lock reviewed budget"},
        headers=zgd,
    )
    assert locked.status_code == 200, locked.text
    position = client.get(f"/cfo-positions/{position_id}", headers=zgd).json()
    assert position["all_items_fixed"] is True
    assert position["current_step_id"] is None
    unlocked = client.post(
        f"/approval-register/groups/article/{DDS_OPER_ID}/workflow-action",
        json={"action": "unfix", "comment": "Unlock for revision"},
        headers=zgd,
    )
    assert unlocked.status_code == 200, unlocked.text
    position = client.get(f"/cfo-positions/{position_id}", headers=zgd).json()
    assert position["all_items_fixed"] is False
    assert position["current_step_id"] == ROOT_STEP_ID


def test_zgd_can_record_multiple_line_decisions_in_one_request(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")
    zgd = auth(client, "zgd", "zgd")
    request, items = create_submitted_request(client, employee, item_count=2)
    position_id = complete_cfo(
        client,
        employee,
        request["id"],
        [(item["id"], "approved") for item in items],
    )["affected_cfo_position_ids"][0]
    send_and_review_by_economist(
        client, employee, economist, position_id, [item["id"] for item in items]
    )
    assert client.post(
        f"/cfo-positions/{position_id}/freeze",
        json={"comment": "Ready for route"},
        headers=economist,
    ).status_code == 200
    assert client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Reviewer approved"},
        headers=approver,
    ).status_code == 200

    event_id = "ec4a9350-046f-4677-bd36-6e749b5087a0"
    approved = client.post(
        "/approval-position-lines/approve/bulk",
        json={
            "positions": [{
                "step_id": ROOT_STEP_ID,
                "position_id": position_id,
                "item_ids": [item["id"] for item in items],
            }],
            "comment": "Approved together",
            "event_id": event_id,
        },
        headers=zgd,
    )
    assert approved.status_code == 200, approved.text
    assert len(approved.json()["positions"]) == 1
    rows = client.get(
        "/approval-register/rows",
        params={"request_id": request["id"], "module_id": MODULE_ALPHA_ID},
        headers=zgd,
    ).json()["items"]
    assert all(not row["is_final_approval_actionable"] for row in rows)
    assert all(row["is_decision_editable"] for row in rows)
    logs = client.get(f"/steps/{ROOT_STEP_ID}/logs", headers=zgd).json()
    assert any(
        (row.get("log") or {}).get("event_id") == event_id
        and set((row.get("log") or {}).get("item_ids") or []) == {item["id"] for item in items}
        for row in logs
    )


def test_zgd_can_fix_remaining_lines_after_partial_position_lock(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")
    zgd = auth(client, "zgd", "zgd")
    request, items = create_submitted_request(client, employee, item_count=2)
    position_id = complete_cfo(
        client,
        employee,
        request["id"],
        [(item["id"], "approved") for item in items],
    )["affected_cfo_position_ids"][0]
    send_and_review_by_economist(
        client, employee, economist, position_id, [item["id"] for item in items]
    )
    assert client.post(
        f"/cfo-positions/{position_id}/freeze",
        json={"comment": ""},
        headers=economist,
    ).status_code == 200
    assert client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
        json={"comment": ""},
        headers=approver,
    ).status_code == 200
    assert client.post(
        f"/steps/{ROOT_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "", "item_ids": [item["id"] for item in items]},
        headers=zgd,
    ).status_code == 200

    # Simulate a position created by the previous final-approval flow, where
    # one line could already be fixed before the remaining lines were fixed.
    repo = client.app.state.repo
    repo.update("req_items", items[0]["id"], {"fixed": True, "frozen": True})

    locked = client.post(
        f"/approval-register/groups/article/{DDS_OPER_ID}/workflow-action",
        json={"action": "fix", "comment": ""},
        headers=zgd,
    )
    assert locked.status_code == 200, locked.text
    position = client.get(f"/cfo-positions/{position_id}", headers=zgd).json()
    assert position["all_items_fixed"] is True
    assert position["current_step_id"] is None


def test_request_cancel_is_blocked_after_economist_forwards_to_general_route(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    request, items = create_submitted_request(client, employee)
    position_id = complete_cfo(
        client,
        employee,
        request["id"],
        [(items[0]["id"], "approved")],
    )["affected_cfo_position_ids"][0]

    assert "cancel" not in client.get(f"/requests/{request['id']}", headers=employee).json()["available_actions"]
    assert client.post(f"/requests/{request['id']}/cancel", headers=employee).status_code == 409
    send_and_review_by_economist(client, employee, economist, position_id, [item["id"] for item in items])
    assert "cancel" not in client.get(f"/requests/{request['id']}", headers=employee).json()["available_actions"]
    assert client.post(
        f"/cfo-positions/{position_id}/freeze",
        json={"comment": "Forward to common route"},
        headers=economist,
    ).status_code == 200

    request_after_forward = client.get(f"/requests/{request['id']}", headers=employee).json()
    assert "cancel" not in request_after_forward["available_actions"]
    assert client.post(f"/requests/{request['id']}/cancel", headers=employee).status_code == 409


def test_zgd_group_status_does_not_keep_fixed_module_actionable_for_shared_position(tmp_path):
    client = make_client(tmp_path)
    admin = auth(client, "admin", "admin")
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")
    zgd = auth(client, "zgd", "zgd")

    shared_module = client.post(
        "/units",
        json={"name": "Shared workflow module", "parent_id": CFO_ID, "type": "module", "uses_invest_projects": False},
        headers=admin,
    ).json()
    # The production UI prevents one person from owning both a CFO and its
    # module.  The fixture deliberately creates that visibility scope directly
    # so this test can exercise one shared CFO position across two modules.
    client.app.state.repo.create(
        "units_responsibles",
        {"unit_id": shared_module["id"], "user_id": "00000000-0000-0000-0000-000000000003", "is_active": True},
    )
    first, first_items = create_submitted_request(client, employee)
    second = client.post("/requests", json={"unit_id": shared_module["id"]}, headers=employee).json()
    second_item = client.post(
        f"/requests/{second['id']}/items",
        json={"dds_id": DDS_LICENSE_ID, "name": "Shared position sibling", "sum_plan": 200},
        headers=employee,
    ).json()
    assert client.post(f"/requests/{second['id']}/submit", headers=employee).status_code == 200

    first_position = complete_cfo(client, employee, first["id"], [(first_items[0]["id"], "approved")])["affected_cfo_position_ids"][0]
    second_position = complete_cfo(client, employee, second["id"], [(second_item["id"], "approved")])["affected_cfo_position_ids"][0]
    assert first_position == second_position
    send_and_review_by_economist(
        client,
        employee,
        economist,
        first_position,
        [first_items[0]["id"], second_item["id"]],
    )
    assert client.post(
        f"/cfo-positions/{first_position}/freeze",
        json={"comment": "Freeze shared position"},
        headers=economist,
    ).status_code == 200
    assert client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{first_position}/approve",
        json={"comment": "Approve shared position"},
        headers=approver,
    ).status_code == 200
    assert client.post(
        f"/steps/{ROOT_STEP_ID}/positions/{first_position}/approve",
        json={"comment": "Fix first module line", "item_ids": [first_items[0]["id"]]},
        headers=zgd,
    ).status_code == 200

    rows = client.get(
        "/approval-register/rows",
        params={"module_id": MODULE_ALPHA_ID, "request_id": first["id"], "page_size": 25},
        headers=zgd,
    ).json()
    assert rows["group"]["aggregates"]["aggregate_status"] == "approved"
    # An approval is not a lock: the remaining shared-position line is still
    # available to ZGD until the explicit budget lock is activated.
    assert rows["group"]["aggregates"]["actionable_positions"] == 1


def test_cfo_return_is_revision_and_module_can_resubmit(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request, items = create_submitted_request(client, employee)
    assert client.post(
        f"/items/{items[0]['id']}/cfo-decision",
        json={"decision": "approved", "comment": ""},
        headers=employee,
    ).status_code == 200

    returned = client.post(
        f"/approval-register/groups/request/{request['id']}/cfo-revision",
        json={
            "comment": "Уточните расчёт",
            "items": [{"item_id": items[0]["id"], "comment": ""}],
        },
        headers=employee,
    )
    assert returned.status_code == 200, returned.text
    assert returned.json()["affected_item_ids"] == [items[0]["id"]]
    returned_item = client.app.state.repo.get_by_id("req_items", items[0]["id"])
    assert returned_item["comment"] == ""
    request_chat = client.get(f"/requests/{request['id']}/chat", headers=employee)
    assert request_chat.status_code == 200
    assert any(
        message.get("is_system")
        and "Уточните расчёт" in message["text"]
        and items[0]["name"] in message["text"]
        for message in request_chat.json()["messages"]
    )
    assert client.app.state.repo.get_by_id("steps", LEAF_STEP_ID)["status"] == "on_revision"
    assert client.post(f"/requests/{request['id']}/complete-cfo-review", headers=employee).status_code == 409
    request_chat = client.get(f"/requests/{request['id']}/chat", headers=employee)
    assert any(
        message.get("is_system")
        and "передал строки ответственному за модуль" in message["text"]
        and "Группировка:" in message["text"]
        for message in request_chat.json()["messages"]
    )
    assert client.app.state.repo.get_by_id("steps", LEAF_STEP_ID)["status"] == "on_revision"

    row = next(
        item
        for item in client.get(
            "/approval-register/rows",
            params={"module_id": MODULE_ALPHA_ID, "page_size": 25},
            headers=employee,
        ).json()["items"]
        if item["id"] == items[0]["id"]
    )
    assert row["status"] == "on_review"
    assert row["is_revision"] is True
    assert row["is_revision_actionable"] is True
    assert "submit" in client.get(f"/requests/{request['id']}", headers=employee).json()["available_actions"]

    patched = client.patch(
        f"/items/{items[0]['id']}",
        json={"sum_plan": 125, "analytics_1": "Исправлено"},
        headers=employee,
    )
    assert patched.status_code == 200, patched.text
    assert client.post(
        f"/items/{items[0]['id']}/cfo-decision",
        json={"decision": "approved", "comment": ""},
        headers=employee,
    ).status_code == 409

    resubmitted = client.post(f"/requests/{request['id']}/submit", headers=employee)
    assert resubmitted.status_code == 200, resubmitted.text
    resubmitted_row = next(
        row
        for row in client.get(
            "/approval-register/rows",
            params={"request_id": request["id"], "page_size": 25},
            headers=employee,
        ).json()["items"]
        if row["id"] == items[0]["id"]
    )
    assert resubmitted_row["is_cfo_review_actionable"] is True
    assert resubmitted_row["is_cfo_revision_pending"] is False
    assert resubmitted_row["is_decision_editable"] is True
    assert resubmitted_row["status_context"]["editability"]["can_decide"] is True
    completed = complete_cfo(
        client, employee, request["id"], [(items[0]["id"], "approved")]
    )
    assert completed["status"] == "on_review"


def test_only_returned_cfo_revision_lines_are_editable_by_module(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request, items = create_submitted_request(client, employee, item_count=2)

    returned = client.post(
        f"/approval-register/groups/article/{DDS_OPER_ID}/cfo-revision",
        json={
            "comment": "Уточните расчёт",
            "items": [{"item_id": items[0]["id"], "comment": "Исправьте сумму"}],
        },
        headers=employee,
    )
    assert returned.status_code == 200, returned.text

    # Confirming the revision dialog immediately sends its selected package.
    assert "edit_revision" in client.get(f"/requests/{request['id']}", headers=employee).json()["available_actions"]
    assert client.post(f"/requests/{request['id']}/complete-cfo-review", headers=employee).status_code == 409

    rows = client.get(
        "/approval-register/rows",
        params={"module_id": MODULE_ALPHA_ID, "page_size": 25},
        headers=employee,
    ).json()["items"]
    rows_by_id = {row["id"]: row for row in rows}
    assert rows_by_id[items[0]["id"]]["is_revision_actionable"] is True
    assert rows_by_id[items[1]["id"]]["is_revision_actionable"] is False

    assert client.patch(
        f"/items/{items[0]['id']}", json={"sum_plan": 125}, headers=employee
    ).status_code == 200
    deleted = client.delete(f"/items/{items[0]['id']}", headers=employee)
    assert deleted.status_code == 200, deleted.text
    assert deleted.json()["status"] == "deleted"
    assert client.patch(
        f"/items/{items[1]['id']}", json={"sum_plan": 125}, headers=employee
    ).status_code == 409


def test_single_revision_line_can_use_its_line_comment_without_block_comment(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request, items = create_submitted_request(client, employee, item_count=2)

    group_revision_without_message = client.post(
        f"/approval-register/groups/request/{request['id']}/cfo-revision",
        json={
            "comment": "",
            "items": [
                {"item_id": item["id"], "comment": f"Уточнить строку {index}"}
                for index, item in enumerate(items, start=1)
            ],
        },
        headers=employee,
    )
    assert group_revision_without_message.status_code == 422

    single_revision = client.post(
        f"/approval-register/groups/request/{request['id']}/cfo-revision",
        json={
            "comment": "",
            "items": [{"item_id": items[0]["id"], "comment": "Уточнить сумму"}],
        },
        headers=employee,
    )
    assert single_revision.status_code == 200, single_revision.text


def test_cfo_can_review_only_lines_resubmitted_by_module(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request, items = create_submitted_request(client, employee, item_count=2)

    assert client.post(
        f"/items/{items[1]['id']}/cfo-decision",
        json={"decision": "approved", "comment": ""},
        headers=employee,
    ).status_code == 200
    assert client.post(
        f"/approval-register/groups/request/{request['id']}/cfo-revision",
        json={
            "comment": "Исправьте первую строку",
            "items": [{"item_id": items[0]["id"], "comment": "Уточнить сумму"}],
        },
        headers=employee,
    ).status_code == 200
    assert client.post(
        f"/requests/{request['id']}/complete-cfo-review", headers=employee,
    ).status_code == 409

    assert client.patch(
        f"/items/{items[0]['id']}",
        json={"justification": "Исправлено"},
        headers=employee,
    ).status_code == 200
    assert client.post(f"/requests/{request['id']}/submit", headers=employee).status_code == 200

    rows = {
        row["id"]: row
        for row in client.get(
            "/approval-register/rows",
            params={"request_id": request["id"], "page_size": 25},
            headers=employee,
        ).json()["items"]
    }
    assert rows[items[0]["id"]]["is_cfo_review_actionable"] is True
    assert rows[items[1]["id"]]["is_cfo_review_actionable"] is False
    assert rows[items[1]["id"]]["is_decision_editable"] is True
    assert rows[items[1]["id"]]["status_context"]["editability"]["can_decide"] is True

    # An older decision remains editable and can be explicitly marked for
    # revision again; it is only excluded from an implicit package handoff.
    marked_again = client.post(
        f"/approval-register/groups/article/{DDS_OPER_ID}/cfo-revision",
        json={
            "comment": "РџРѕРІС‚РѕСЂРЅР°СЏ РґРѕСЂР°Р±РѕС‚РєР°",
            "items": [{"item_id": items[1]["id"], "comment": "РџСЂРѕРІРµСЂРёС‚СЊ РµС‰С‘ СЂР°Р·"}],
        },
        headers=employee,
    )
    assert marked_again.status_code == 200, marked_again.text

    edited_decision = client.post(
        f"/items/{items[1]['id']}/cfo-decision",
        json={"decision": "rejected", "comment": "Повторно проверено"},
        headers=employee,
    )
    assert edited_decision.status_code == 409, edited_decision.text
    assert client.patch(
        f"/items/{items[1]['id']}",
        json={"analytics_1": "Обновлено повторно"},
        headers=employee,
    ).status_code == 200

    assert client.post(
        f"/items/{items[0]['id']}/cfo-decision",
        json={"decision": "approved", "comment": "Повторно проверено"},
        headers=employee,
    ).status_code == 409
    assert client.post(
        f"/requests/{request['id']}/complete-cfo-review", headers=employee,
    ).status_code == 409
    locked_rows = {
        row["id"]: row
        for row in client.get(
            "/approval-register/rows",
            params={"request_id": request["id"], "page_size": 25},
            headers=employee,
        ).json()["items"]
    }
    assert locked_rows[items[1]["id"]]["is_decision_editable"] is False
    assert client.post(
        f"/items/{items[1]['id']}/cfo-decision",
        json={"decision": "approved", "comment": "after handoff"},
        headers=employee,
    ).status_code == 409


def test_cfo_revision_dialog_sends_package_to_module(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request, items = create_submitted_request(client, employee, item_count=3)
    admin = auth(client, "admin", "admin")
    module_user = client.post("/users", json=user_payload("revision-author"), headers=admin).json()
    assert client.post(
        f"/units/{MODULE_ALPHA_ID}/responsible", json={"user_id": module_user["id"]}, headers=admin,
    ).status_code == 200
    author = auth(client, "revision-author", "password")

    # A table action only saves the revision choice. Other CFO lines remain
    # actionable and the module cannot edit anything before explicit handoff.
    assert client.post(
        f"/items/{items[0]['id']}/cfo-revision-selection",
        json={"comment": "Check the calculation"},
        headers=employee,
    ).status_code == 200
    rows_before_handoff = {
        row["id"]: row
        for row in client.get(
            "/approval-register/rows",
            params={"request_id": request["id"], "page_size": 25},
            headers=employee,
        ).json()["items"]
    }
    assert rows_before_handoff[items[0]["id"]]["is_cfo_revision_pending"] is True
    assert rows_before_handoff[items[1]["id"]]["is_cfo_review_actionable"] is True
    assert client.patch(
        f"/items/{items[0]['id']}", json={"justification": "Too early"}, headers=author,
    ).status_code in {403, 409}
    for item in items[1:]:
        assert client.post(
            f"/items/{item['id']}/cfo-decision",
            json={"decision": "approved", "comment": ""},
            headers=employee,
        ).status_code == 200
    assert client.post(
        f"/requests/{request['id']}/complete-cfo-review", headers=employee,
    ).status_code == 409
    sent = client.post(
        f"/approval-register/groups/article/{DDS_OPER_ID}/cfo-revision",
        json={
            "comment": "Check the calculation",
            "items": [{"item_id": items[0]["id"], "comment": "Specify the amount"}],
        },
        headers=employee,
    )
    assert sent.status_code == 200, sent.text
    assert client.patch(
        f"/items/{items[0]['id']}", json={"justification": "Corrected"}, headers=author,
    ).status_code == 200
    assert client.patch(
        f"/items/{items[1]['id']}", json={"justification": "Not returned"}, headers=author,
    ).status_code == 409
    assert client.post(
        f"/requests/{request['id']}/complete-cfo-review", headers=employee,
    ).status_code == 409

def test_position_waits_until_all_existing_modules_finish_cfo_review(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    repo = client.app.state.repo
    employee_id = client.app.state.auth_service.login("employee", "employee")["user"]["id"]
    second_module = repo.create(
        "units",
        {
            "parent_id": CFO_ID,
            "name": "Модуль с незавершённой заявкой",
            "is_active": True,
            "uses_invest_projects": False,
            "annual_budget": 0,
        },
    )
    repo.insert(
        "units_responsibles",
        {"unit_id": second_module["id"], "user_id": employee_id, "is_active": True},
    )
    second_request = client.post(
        "/requests", json={"unit_id": second_module["id"]}, headers=employee
    ).json()
    second_item = client.post(
        f"/requests/{second_request['id']}/items",
        json={"dds_id": DDS_LICENSE_ID, "name": "Вторая строка", "sum_plan": 50},
        headers=employee,
    ).json()

    first_request, first_items = create_submitted_request(client, employee)
    position_id = complete_cfo(
        client, employee, first_request["id"], [(first_items[0]["id"], "approved")]
    )["affected_cfo_position_ids"][0]
    blocked = client.post(
        f"/cfo-positions/{position_id}/submit-to-economist",
        json={"comment": "Слишком рано"},
        headers=employee,
    )
    assert blocked.status_code == 409

    assert client.post(
        f"/requests/{second_request['id']}/submit", headers=employee
    ).status_code == 200
    second_completed = complete_cfo(
        client, employee, second_request["id"], [(second_item["id"], "approved")]
    )
    assert second_completed["affected_cfo_position_ids"] == [position_id]
    allowed = client.post(
        f"/cfo-positions/{position_id}/submit-to-economist",
        json={"comment": "Все модули проверены"},
        headers=employee,
    )
    assert allowed.status_code == 200, allowed.text


def test_cfo_step_waits_for_draft_application_before_opening_review(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    repo = client.app.state.repo
    employee_id = client.app.state.auth_service.login("employee", "employee")["user"]["id"]
    second_module = repo.create(
        "units",
        {
            "parent_id": CFO_ID,
            "name": "Модуль, который ещё готовит заявку",
            "is_active": True,
            "uses_invest_projects": False,
            "annual_budget": 0,
        },
    )
    repo.insert(
        "units_responsibles",
        {"unit_id": second_module["id"], "user_id": employee_id, "is_active": True},
    )
    second_request = client.post(
        "/requests", json={"unit_id": second_module["id"]}, headers=employee
    )
    assert second_request.status_code == 200, second_request.text
    second_item = client.post(
        f"/requests/{second_request.json()['id']}/items",
        json={"dds_id": DDS_LICENSE_ID, "name": "Вторая заявка", "sum_plan": 50},
        headers=employee,
    )
    assert second_item.status_code == 200, second_item.text

    create_submitted_request(client, employee)
    route = client.get("/approval-route", headers=employee)
    assert route.status_code == 200, route.text
    cfo_step = next(step for step in route.json() if step.get("unit_id") == CFO_ID)
    assert cfo_step["status"] == "waiting"
    assert cfo_step["request_status"] == "waiting"

    submitted = client.post(
        f"/requests/{second_request.json()['id']}/submit", headers=employee
    )
    assert submitted.status_code == 200, submitted.text
    route = client.get("/approval-route", headers=employee)
    cfo_step = next(step for step in route.json() if step.get("unit_id") == CFO_ID)
    assert cfo_step["status"] == "on_approval"
    assert cfo_step["request_status"] == "on_approval"


def test_approval_route_step_runtime_status_after_submit_to_economist(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request, items = create_submitted_request(client, employee, item_count=1)
    position_id = complete_cfo(
        client,
        employee,
        request["id"],
        [(items[0]["id"], "approved")],
    )["affected_cfo_position_ids"][0]

    route_before = client.get("/approval-route", headers=employee).json()
    cfo_step = next(step for step in route_before if step.get("unit_id") == CFO_ID)
    economist_step = next(step for step in route_before if step.get("is_economist_step"))
    assert cfo_step["request_status"] == "on_approval"
    assert economist_step["request_status"] == "waiting"

    submitted = client.post(
        f"/cfo-positions/{position_id}/submit-to-economist",
        json={"comment": "Передано"},
        headers=employee,
    )
    assert submitted.status_code == 200, submitted.text

    route_after = client.get("/approval-route", headers=employee).json()
    cfo_step = next(step for step in route_after if step.get("unit_id") == CFO_ID)
    economist_step = next(step for step in route_after if step.get("is_economist_step"))
    assert cfo_step["request_status"] == "approved"
    assert cfo_step["status"] == "approved"
    assert economist_step["request_status"] == "on_approval"
    assert economist_step["status"] == "on_approval"
    assert economist_step["active_positions_count"] == 1
    assert economist_step["revision_positions_count"] == 0
    assert economist_step["readiness"] == {
        "needs_line_decisions": 1,
        "awaiting_return_confirmation": 0,
        "needs_revision": 0,
        "ready_for_next_action": 0,
    }

    scoped_route = client.get(
        "/approval-route", params={"request_id": request["id"]}, headers=employee
    )
    assert scoped_route.status_code == 200, scoped_route.text
    scoped_cfo = next(step for step in scoped_route.json() if step.get("unit_id") == CFO_ID)
    scoped_economist = next(step for step in scoped_route.json() if step.get("is_economist_step"))
    assert scoped_cfo["request_status"] == "approved"
    assert scoped_economist["request_status"] == "on_approval"


def test_approval_register_marks_economist_lines_actionable_after_submit(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    request, items = create_submitted_request(client, employee, item_count=1)
    position_id = complete_cfo(
        client,
        employee,
        request["id"],
        [(items[0]["id"], "approved")],
    )["affected_cfo_position_ids"][0]
    submitted = client.post(
        f"/cfo-positions/{position_id}/submit-to-economist",
        json={"comment": "Передано"},
        headers=employee,
    )
    assert submitted.status_code == 200, submitted.text

    register = client.get("/approval-register", params={"view": "cfo"}, headers=economist)
    assert register.status_code == 200, register.text
    body = register.json()
    assert body["aggregates"]["in_approval_positions"] >= 1
    assert body["aggregates"]["actionable_positions"] >= 1

    rows = client.get(
        "/approval-register/rows",
        params={"module_id": MODULE_ALPHA_ID, "page_size": 25},
        headers=economist,
    )
    assert rows.status_code == 200, rows.text
    item = next(row for row in rows.json()["items"] if row["id"] == items[0]["id"])
    assert item["status"] == "on_review"
    assert item["is_approval_actionable"] is True
    assert item["approval_stage"] == "Проверка экономистом ЦФО"
    assert item["status_context"]["editability"]["can_decide"] is True
    assert item["status_context"]["editability"]["can_edit_amount"] is True

    assert client.post(
        f"/cfo-positions/{position_id}/items/{items[0]['id']}/decision",
        json={"decision": "approved", "comment": ""},
        headers=economist,
    ).status_code == 200
    completed_rows = client.get(
        "/approval-register/rows",
        params={"module_id": MODULE_ALPHA_ID, "page_size": 25},
        headers=economist,
    ).json()["items"]
    completed_item = next(row for row in completed_rows if row["id"] == items[0]["id"])
    assert completed_item["is_economist_completion_actionable"] is True
    assert completed_item["is_approval_actionable"] is False
    assert completed_item["is_decision_editable"] is True
    assert completed_item["decision_editable_stage"] == "economist"
    assert completed_item["status_context"]["editability"]["can_decide"] is True
    revised = client.post(
        f"/cfo-positions/{position_id}/items/{items[0]['id']}/decision",
        json={"decision": "approved_with_changes", "sum_fact": 80, "comment": "Уточнено"},
        headers=economist,
    )
    assert revised.status_code == 200, revised.text
    assert float(revised.json()["sum_fact"]) == 80
    completed_register = client.get(
        "/approval-register", params={"view": "cfo"}, headers=economist,
    ).json()
    assert completed_register["aggregates"]["economist_completion_positions"] >= 1


def test_economist_can_approve_all_open_lines_in_cfo_group(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    request, items = create_submitted_request(client, employee, item_count=2)
    position_id = complete_cfo(
        client,
        employee,
        request["id"],
        [(item["id"], "approved") for item in items],
    )["affected_cfo_position_ids"][0]
    assert client.post(
        f"/cfo-positions/{position_id}/submit-to-economist",
        json={"comment": "Передано"},
        headers=employee,
    ).status_code == 200

    pending = client.post(
        f"/approval-register/groups/cfo/{CFO_ID}/workflow-action",
        json={"action": "approve", "comment": "Согласовать всё"},
        headers=economist,
    )
    assert pending.status_code == 409

    decisions = client.post(
        f"/cfo-positions/{position_id}/items/decision/bulk",
        json={
            "item_ids": [item["id"] for item in items],
            "decision": "approved",
            "comment": "Все строки проверены",
        },
        headers=economist,
    )
    assert decisions.status_code == 200, decisions.text
    approved = client.post(
        f"/approval-register/groups/cfo/{CFO_ID}/workflow-action",
        json={"action": "approve", "comment": "Согласовать всё"},
        headers=economist,
    )
    assert approved.status_code == 200, approved.text
    position = client.get(f"/cfo-positions/{position_id}", headers=economist).json()
    assert position["current_step_id"] == APPROVER_STEP_ID
    assert all(item["frozen"] for item in position["contributions"])


def test_economist_can_reject_group_lines_before_handoff(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    request, items = create_submitted_request(client, employee, item_count=2)
    position_id = complete_cfo(
        client,
        employee,
        request["id"],
        [(item["id"], "approved") for item in items],
    )["affected_cfo_position_ids"][0]
    assert client.post(
        f"/cfo-positions/{position_id}/submit-to-economist",
        json={"comment": "Передано"},
        headers=employee,
    ).status_code == 200

    first_decision = client.post(
        f"/cfo-positions/{position_id}/items/{items[0]['id']}/decision",
        json={"decision": "approved", "comment": "Проверено"},
        headers=economist,
    )
    assert first_decision.status_code == 200, first_decision.text
    actionable = client.get(
        f"/approval-register/groups/cfo/{CFO_ID}/actionable-rows",
        headers=economist,
    )
    assert actionable.status_code == 200, actionable.text
    actionable_ids = {row["id"] for row in actionable.json()["lines"]}
    assert set(item["id"] for item in items).issubset(actionable_ids)

    rejected = client.post(
        f"/cfo-positions/{position_id}/items/decision/bulk",
        json={
            "item_ids": [item["id"] for item in items],
            "decision": "rejected",
            "comment": "Отклонено в группе",
        },
        headers=economist,
    )
    assert rejected.status_code == 200, rejected.text
    position = client.get(f"/cfo-positions/{position_id}", headers=economist).json()
    assert {item["status"] for item in position["contributions"]} == {"rejected"}


def test_economist_can_mark_line_for_revision_before_returning_position(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    request, items = create_submitted_request(client, employee, item_count=2)
    position_id = complete_cfo(
        client, employee, request["id"], [(item["id"], "approved") for item in items]
    )["affected_cfo_position_ids"][0]
    assert client.post(
        f"/cfo-positions/{position_id}/submit-to-economist",
        json={"comment": "Передано"},
        headers=employee,
    ).status_code == 200

    edited_comment = client.patch(
        f"/items/{items[0]['id']}",
        json={"comment": "Нужна проверка договора"},
        headers=economist,
    )
    assert edited_comment.status_code == 200, edited_comment.text
    assert edited_comment.json()["comment"] == "Нужна проверка договора"

    marked = client.post(
        f"/cfo-positions/{position_id}/items/{items[0]['id']}/decision",
        json={"decision": "on_revision", "comment": "Уточнить обоснование"},
        headers=economist,
    )
    assert marked.status_code == 200, marked.text
    assert marked.json()["status"] == "on_review"

    approved = client.post(
        f"/cfo-positions/{position_id}/items/{items[1]['id']}/decision",
        json={"decision": "approved", "comment": "Проверено"},
        headers=economist,
    )
    assert approved.status_code == 200, approved.text

    rows = client.get(
        "/approval-register/rows",
        params={"module_id": MODULE_ALPHA_ID, "page_size": 25},
        headers=economist,
    ).json()["items"]
    marked_row = next(row for row in rows if row["id"] == items[0]["id"])
    assert marked_row["is_workflow_revision_marked"] is True
    assert marked_row["is_workflow_revision_actionable"] is True
    assert any(
        comment["comment"] == "Уточнить обоснование"
        for comment in marked_row["comment_history"]
    )

    route_before_return = client.get("/approval-route", headers=economist).json()
    economist_step = next(step for step in route_before_return if step["id"] == ECONOMIST_STEP_ID)
    assert economist_step["readiness"]["awaiting_return_confirmation"] == 1
    assert economist_step["readiness"]["needs_line_decisions"] == 0

    returned = client.post(
        f"/cfo-positions/{position_id}/return-for-revision",
        json={
            "comment": "Вернуть отмеченную строку",
            "items": [{"item_id": items[0]["id"]}],
        },
        headers=economist,
    )
    assert returned.status_code == 200, returned.text
    assert returned.json()["current_step_id"] == LEAF_STEP_ID
    route_after_return = client.get("/approval-route", headers=economist).json()
    economist_step = next(step for step in route_after_return if step["id"] == ECONOMIST_STEP_ID)
    cfo_step = next(step for step in route_after_return if step["id"] == LEAF_STEP_ID)
    assert economist_step["readiness"]["awaiting_return_confirmation"] == 0
    assert cfo_step["readiness"]["needs_revision"] == 1


def test_approver_can_review_position_lines_one_by_one(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")
    request, items = create_submitted_request(client, employee, item_count=2)
    position_id = complete_cfo(
        client,
        employee,
        request["id"],
        [(item["id"], "approved") for item in items],
    )["affected_cfo_position_ids"][0]
    send_and_review_by_economist(client, employee, economist, position_id, [item["id"] for item in items])
    client.post(
        f"/cfo-positions/{position_id}/freeze",
        json={"comment": "В маршрут"},
        headers=economist,
    )

    rows = client.get(
        "/approval-register/rows",
        params={"module_id": MODULE_ALPHA_ID, "page_size": 25},
        headers=approver,
    )
    assert rows.status_code == 200, rows.text
    by_id = {row["id"]: row for row in rows.json()["items"]}
    assert all(row["is_approval_actionable"] for row in by_id.values())
    assert all(row["is_final_approval_actionable"] for row in by_id.values())
    assert all(row["status_context"]["editability"]["can_decide"] for row in by_id.values())

    first = client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Согласована первая строка", "item_ids": [items[0]["id"]]},
        headers=approver,
    )
    assert first.status_code == 200, first.text
    assert first.json()["current_step_id"] == APPROVER_STEP_ID
    assert client.app.state.repo.get_by_id("req_items", items[0]["id"])["fixed"] is False

    history = client.get("/approval-register/history", headers=approver)
    assert history.status_code == 200, history.text
    reviewer_decision = next(
        entry for entry in history.json()
        if entry["log"]["action"] == "position_items_approved_at_step"
        and entry["log"].get("req_item_id") == items[0]["id"]
    )
    assert reviewer_decision["log"]["changes"] == {
        "reviewer_decision": {"from": "pending", "to": "approved"},
    }
    assert reviewer_decision["subject"]["name"] == items[0]["name"]

    refreshed = client.get(
        "/approval-register/rows",
        params={"module_id": MODULE_ALPHA_ID, "page_size": 25},
        headers=approver,
    )
    refreshed_by_id = {row["id"]: row for row in refreshed.json()["items"]}
    assert refreshed_by_id[items[0]["id"]]["is_approval_actionable"] is False
    assert refreshed_by_id[items[0]["id"]]["is_decision_editable"] is True
    assert refreshed_by_id[items[0]["id"]]["decision_editable_stage"] == "approver"
    assert refreshed_by_id[items[0]["id"]]["status_context"]["editability"]["can_decide"] is True
    assert refreshed_by_id[items[1]["id"]]["is_approval_actionable"] is True

    revised = client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Решение изменено", "item_ids": [items[0]["id"]]},
        headers=approver,
    )
    assert revised.status_code == 200, revised.text
    assert revised.json()["current_step_id"] == APPROVER_STEP_ID

    second_decision = client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Решение по второй строке", "item_ids": [items[1]["id"]]},
        headers=approver,
    )
    assert second_decision.status_code == 200, second_decision.text
    assert second_decision.json()["current_step_id"] == APPROVER_STEP_ID

    returned = client.post(
        f"/cfo-positions/{position_id}/return-for-revision",
        json={
            "comment": "Доработать вторую строку",
            "items": [{"item_id": items[1]["id"], "comment": "Нужна детализация"}],
        },
        headers=approver,
    )
    assert returned.status_code == 200, returned.text
    assert returned.json()["current_step_id"] == ECONOMIST_STEP_ID
    assert client.app.state.repo.get_by_id("req_items", items[1]["id"])["frozen"] is False

    economist_rows = client.get(
        "/approval-register/rows",
        params={"module_id": MODULE_ALPHA_ID, "page_size": 25},
        headers=economist,
    ).json()["items"]
    economist_by_id = {row["id"]: row for row in economist_rows}
    returned_line = economist_by_id[items[1]["id"]]
    assert returned_line["is_revision"] is True
    assert returned_line["is_approval_actionable"] is True
    assert returned_line["status_context"]["editability"]["can_decide"] is True
    assert economist_by_id[items[0]["id"]]["is_approval_actionable"] is False

    assert client.post(
        f"/cfo-positions/{position_id}/items/{items[1]['id']}/decision",
        json={"decision": "approved", "comment": "Исправлено"},
        headers=economist,
    ).status_code == 200
    assert client.post(
        f"/cfo-positions/{position_id}/complete-review",
        json={"comment": "Повторная проверка"},
        headers=economist,
    ).status_code == 200
    assert client.post(
        f"/cfo-positions/{position_id}/freeze",
        json={"comment": "Снова в маршрут"},
        headers=economist,
    ).status_code == 200

    approver_after_resubmit = client.get(
        "/approval-register/rows",
        params={"module_id": MODULE_ALPHA_ID, "page_size": 25},
        headers=approver,
    ).json()["items"]
    resubmitted = next(row for row in approver_after_resubmit if row["id"] == items[1]["id"])
    assert resubmitted["is_approval_actionable"] is True
    assert resubmitted["is_final_approval_actionable"] is True
    assert resubmitted["status_context"]["editability"]["can_decide"] is True

    register = client.get("/approval-register", params={"view": "cfo"}, headers=approver)
    assert register.status_code == 200, register.text


def test_approver_can_return_selected_group_lines_without_prior_line_approval(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")
    request, items = create_submitted_request(client, employee, item_count=2)
    position_id = complete_cfo(
        client,
        employee,
        request["id"],
        [(item["id"], "approved") for item in items],
    )["affected_cfo_position_ids"][0]
    send_and_review_by_economist(client, employee, economist, position_id, [item["id"] for item in items])
    assert client.post(
        f"/cfo-positions/{position_id}/freeze",
        json={"comment": "В маршрут"},
        headers=economist,
    ).status_code == 200

    register = client.get("/approval-register", headers=approver)
    assert register.status_code == 200, register.text
    assert register.json()["aggregates"]["workflow_return_positions"] == 1

    returned = client.post(
        f"/approval-register/groups/article/{DDS_OPER_ID}/workflow-action",
        json={
            "action": "return_for_revision",
            "comment": "Нужна детализация",
            "items": [{"item_id": items[1]["id"]}],
        },
        headers=approver,
    )
    assert returned.status_code == 200, returned.text
    assert returned.json()["positions"][0]["current_step_id"] == ECONOMIST_STEP_ID
    assert client.app.state.repo.get_by_id("req_items", items[1]["id"])["frozen"] is False


def test_route_bootstrap_creates_cfo_and_zgd_anchors_without_duplicates(tmp_path):
    client = make_client(tmp_path)
    admin = auth(client, "admin", "admin")
    repo = client.app.state.repo
    repo.save_all("step_logs", [])
    repo.save_all("step_edges", [])
    repo.save_all("steps", [])

    first = client.post("/steps/bootstrap-reviewed", headers=admin)
    assert first.status_code == 200, first.text
    assert {item["kind"] for item in first.json()["created"]} == {"cfo", "economist", "zgd"}

    steps = client.get("/steps", headers=admin)
    assert steps.status_code == 200
    cfo_step = next(item for item in steps.json() if item["unit_id"] == CFO_ID)
    economist_step = next(item for item in steps.json() if item["is_economist_step"])
    zgd_step = next(item for item in steps.json() if item["user"] and item["user"]["role"] == "zgd")
    assert cfo_step["responsible"]["role"] == "employee"
    assert cfo_step["user"] is None
    assert cfo_step["modules"]
    assert all("request_statuses" in module for module in cfo_step["modules"])
    assert economist_step["user"]["role"] == "economist"
    assert economist_step["cfo_unit_id"] == CFO_ID
    assert cfo_step["id"] in economist_step["child_step_ids"]
    assert client.delete(f"/steps/{cfo_step['id']}", headers=admin).status_code == 403
    assert client.delete(f"/steps/{economist_step['id']}", headers=admin).status_code == 403
    assert client.delete(f"/steps/{zgd_step['id']}", headers=admin).status_code == 403

    second = client.post("/steps/bootstrap-reviewed", headers=admin)
    assert second.status_code == 200
    assert second.json()["created"] == []


def test_edge_delete_preview_is_complete_and_removes_cfo_economist_assignment(tmp_path):
    client = make_client(tmp_path)
    admin = auth(client, "admin", "admin")
    edge = {"parent_step_id": ECONOMIST_STEP_ID, "child_step_id": LEAF_STEP_ID}

    preview = client.post("/step-edges/preview-delete", json=edge, headers=admin)
    assert preview.status_code == 200
    data = preview.json()
    assert data["removes_economist_assignment"] is True
    assert data["before_graph"]["nodes"]
    assert data["before_graph"]["edges"]
    assert data["after_graph"]["edges"] != data["before_graph"]["edges"]

    deleted = client.request("DELETE", "/step-edges", json=edge, headers=admin)
    assert deleted.status_code == 200
    assignment = next(
        item for item in client.app.state.repo.load_all("units_responsibles")
        if item["unit_id"] == CFO_ID and item["user_id"] == ECONOMIST_ID
    )
    assert assignment["is_active"] is False


def test_route_can_be_connected_while_other_branches_are_not_configured(tmp_path):
    client = make_client(tmp_path)
    admin = auth(client, "admin", "admin")
    repo = client.app.state.repo
    connected = repo.create("steps", {"user_id": APPROVER_ID, "unit_id": None, "status": "waiting"})
    repo.create("steps", {"user_id": APPROVER_ID, "unit_id": None, "status": "waiting"})

    response = client.post(
        "/step-edges",
        json={"parent_step_id": ROOT_STEP_ID, "child_step_id": connected["id"]},
        headers=admin,
    )
    assert response.status_code == 200, response.text


def test_cfo_completion_rejects_pending_and_ignores_deleted_lines(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request, items = create_submitted_request(client, employee, item_count=2)

    assert client.post(
        f"/items/{items[0]['id']}/cfo-decision",
        json={"decision": "approved", "comment": ""},
        headers=employee,
    ).status_code == 200
    pending = client.post(
        f"/requests/{request['id']}/complete-cfo-review", headers=employee
    )
    assert pending.status_code == 409

    # Deleted lines are excluded from the active decision set.
    client.app.state.repo.update(
        "req_items", items[1]["id"], {"status": "deleted", "sum_plan": 0, "sum_fact": 0}
    )
    completed = client.post(
        f"/requests/{request['id']}/complete-cfo-review", headers=employee
    )
    assert completed.status_code == 200


def test_all_rejected_lines_reject_request_and_do_not_enter_route(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request, items = create_submitted_request(client, employee)
    completed = complete_cfo(
        client, employee, request["id"], [(items[0]["id"], "rejected")]
    )
    assert completed["status"] == "rejected"
    assert len(completed["affected_cfo_position_ids"]) == 1
    position_id = completed["affected_cfo_position_ids"][0]
    blocked = client.post(
        f"/cfo-positions/{position_id}/submit-to-economist",
        json={"comment": ""},
        headers=employee,
    )
    assert blocked.status_code == 409


def test_full_position_route_freezes_and_zgd_fixes(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")
    zgd = auth(client, "zgd", "zgd")
    request, items = create_submitted_request(client, employee)
    completed = complete_cfo(
        client, employee, request["id"], [(items[0]["id"], "approved")]
    )
    position_id = completed["affected_cfo_position_ids"][0]
    send_and_review_by_economist(
        client, employee, economist, position_id, [items[0]["id"]]
    )

    frozen = client.post(
        f"/cfo-positions/{position_id}/freeze",
        json={"comment": "В маршрут"},
        headers=economist,
    )
    assert frozen.status_code == 200
    assert frozen.json()["all_items_frozen"] is True
    assert frozen.json()["current_step_id"] == APPROVER_STEP_ID
    assert client.patch(
        f"/items/{items[0]['id']}",
        json={"analytics_1": "Недопустимое изменение"},
        headers=employee,
    ).status_code == 409
    assert client.patch(
        f"/approval-register/groups/article/{DDS_OPER_ID}/analytics",
        json={"analytics_1": "Недопустимое групповое изменение"},
        headers=approver,
    ).status_code == 409
    approval_register = client.get("/approval-register", headers=approver)
    assert approval_register.status_code == 200
    assert approval_register.json()["aggregates"]["actionable_positions"] >= 1
    cfo_register_rows = client.get(
        "/approval-register/rows",
        params={"module_id": MODULE_ALPHA_ID},
        headers=employee,
    )
    assert cfo_register_rows.status_code == 200
    assert any(
        item["approval_stage"] == "Согласование проверяющим"
        for item in cfo_register_rows.json()["items"]
    )
    assert client.post(
        f"/cfo-positions/{position_id}/comments",
        json={"comment": "Комментарий согласующего к статье"},
        headers=approver,
    ).status_code == 200
    assert client.post(
        f"/cfo-positions/{position_id}/comments",
        json={"comment": "Не должен быть добавлен"},
        headers=employee,
    ).status_code == 403

    approved = client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Согласовано"},
        headers=approver,
    )
    assert approved.status_code == 200
    assert approved.json()["current_step_id"] == ROOT_STEP_ID
    assert client.post(
        f"/cfo-positions/{position_id}/comments",
        json={"comment": "Комментарий ЗГД к статье"},
        headers=zgd,
    ).status_code == 200
    comments = client.get(f"/cfo-positions/{position_id}/comments", headers=zgd).json()
    assert {item["comment"] for item in comments} == {
        "Комментарий согласующего к статье", "Комментарий ЗГД к статье",
    }
    assert {item["user"]["role"] for item in comments} == {"approver", "zgd"}

    fixed = client.post(
        f"/steps/{ROOT_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Зафиксировано"},
        headers=zgd,
    )
    assert fixed.status_code == 200
    fixed = client.post(
        f"/cfo-positions/{position_id}/fix",
        json={"comment": "Зафиксировано"},
        headers=zgd,
    )
    assert fixed.status_code == 200
    assert fixed.json()["all_items_fixed"] is True
    assert fixed.json()["current_step_id"] is None
    assert client.patch(
        f"/items/{items[0]['id']}",
        json={"analytics_1": "Изменение после фиксации"},
        headers=zgd,
    ).status_code == 409
    request_body = client.get(f"/requests/{request['id']}", headers=employee).json()
    assert request_body["status"] == "approved"
    assert request_body["frozen"] is True
    assert request_body["fixed"] is True
    route = client.get("/approval-route", headers=employee).json()
    assert all(step["status"] == "closed" for step in route)
    scoped_route = client.get(
        "/approval-route", params={"request_id": request["id"]}, headers=employee
    ).json()
    assert all(step["request_status"] == "closed" for step in scoped_route)


def test_reviewer_return_requires_reason_and_economist_unfreezes(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")
    request, items = create_submitted_request(client, employee)
    position_id = complete_cfo(
        client, employee, request["id"], [(items[0]["id"], "approved")]
    )["affected_cfo_position_ids"][0]
    send_and_review_by_economist(
        client, employee, economist, position_id, [items[0]["id"]]
    )
    client.post(
        f"/cfo-positions/{position_id}/freeze",
        json={"comment": ""},
        headers=economist,
    )

    no_reason = client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/return",
        json={"target_step_id": ECONOMIST_STEP_ID, "comment": ""},
        headers=approver,
    )
    assert no_reason.status_code == 422
    decided = client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Решение перед возвратом", "item_ids": [items[0]["id"]]},
        headers=approver,
    )
    assert decided.status_code == 200, decided.text
    returned = client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/return",
        json={"target_step_id": ECONOMIST_STEP_ID, "comment": "Уточнить сумму"},
        headers=approver,
    )
    assert returned.status_code == 200
    assert returned.json()["status"] == "on_revision"
    assert returned.json()["frozen_items_count"] == 0
    route = client.get("/approval-route", headers=economist).json()
    economist_step = next(step for step in route if step["id"] == ECONOMIST_STEP_ID)
    assert economist_step["revision_positions_count"] == 1
    unfrozen = client.post(
        f"/cfo-positions/{position_id}/unfreeze",
        json={"comment": "Принято"},
        headers=economist,
    )
    assert unfrozen.status_code == 200
    assert unfrozen.json()["open_items_count"] >= 1


def test_economist_return_to_cfo_makes_selected_items_editable(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    request, items = create_submitted_request(client, employee)
    position_id = complete_cfo(
        client, employee, request["id"], [(items[0]["id"], "approved")]
    )["affected_cfo_position_ids"][0]
    send_and_review_by_economist(client, employee, economist, position_id, [items[0]["id"]])

    returned = client.post(
        f"/steps/{ECONOMIST_STEP_ID}/positions/{position_id}/return",
        json={
            "target_step_id": LEAF_STEP_ID,
            "comment": "Уточните обоснование",
            "item_ids": [items[0]["id"]],
        },
        headers=economist,
    )
    assert returned.status_code == 200, returned.text

    cfo_group = client.get(
        "/approval-register", params={"view": "cfo"}, headers=employee
    ).json()["groups"][0]
    article_group = next(group for group in cfo_group["children"] if group["type"] == "article")
    assert article_group["aggregates"]["cfo_revision_rows"] == 1

    rows = client.get(
        "/approval-register/rows",
        params={"request_id": request["id"], "page_size": 25},
        headers=employee,
    ).json()["items"]
    row = next(row for row in rows if row["id"] == items[0]["id"])
    assert row["status_context"]["editability"]["can_edit_amount"] is True
    assert row["status_context"]["editability"]["can_edit_analytics"] is False
    updated = client.patch(
        f"/items/{items[0]['id']}",
        json={"sum_fact": 80},
        headers=employee,
    )
    assert updated.status_code == 200, updated.text


def test_auto_return_follows_position_source_step(tmp_path):
    client = make_client(tmp_path)
    admin = auth(client, "admin", "admin")
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")
    zgd = auth(client, "zgd", "zgd")
    sibling = client.post(
        "/users", json=user_payload("other-approver", "approver"), headers=admin,
    ).json()
    sibling_step = client.post("/steps", json={"user_id": sibling["id"]}, headers=admin)
    assert sibling_step.status_code == 200, sibling_step.text
    assert client.post(
        "/step-edges",
        json={"parent_step_id": ROOT_STEP_ID, "child_step_id": sibling_step.json()["id"]},
        headers=admin,
    ).status_code == 200
    request, items = create_submitted_request(client, employee)
    position_id = complete_cfo(
        client, employee, request["id"], [(items[0]["id"], "approved")]
    )["affected_cfo_position_ids"][0]
    send_and_review_by_economist(client, employee, economist, position_id, [items[0]["id"]])
    assert client.post(
        f"/cfo-positions/{position_id}/freeze", json={"comment": ""}, headers=economist
    ).status_code == 200
    assert client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Approved"},
        headers=approver,
    ).status_code == 200

    returned = client.post(
        f"/cfo-positions/{position_id}/return-for-revision",
        json={"comment": "Return", "items": [{"item_id": items[0]["id"]}]},
        headers=zgd,
    )

    assert returned.status_code == 200, returned.text
    assert returned.json()["current_step_id"] == APPROVER_STEP_ID


def test_revision_returns_one_step_back_along_the_route(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")
    zgd = auth(client, "zgd", "zgd")
    request, items = create_submitted_request(client, employee)
    position_id = complete_cfo(
        client, employee, request["id"], [(items[0]["id"], "approved")]
    )["affected_cfo_position_ids"][0]
    send_and_review_by_economist(client, employee, economist, position_id, [items[0]["id"]])
    assert client.post(
        f"/cfo-positions/{position_id}/freeze", json={"comment": ""}, headers=economist
    ).status_code == 200
    assert client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Approved"},
        headers=approver,
    ).status_code == 200

    from_zgd = client.post(
        f"/approval-register/groups/article/{DDS_OPER_ID}/workflow-action",
        json={
            "action": "return_for_revision",
            "comment": "Вернуть с финального этапа",
            "items": [{"item_id": items[0]["id"]}],
        },
        headers=zgd,
    )
    assert from_zgd.status_code == 200, from_zgd.text
    assert from_zgd.json()["positions"][0]["current_step_id"] == APPROVER_STEP_ID

    approver_decision = client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Решение перед возвратом", "item_ids": [items[0]["id"]]},
        headers=approver,
    )
    assert approver_decision.status_code == 200, approver_decision.text
    assert approver_decision.json()["current_step_id"] == APPROVER_STEP_ID

    from_approver = client.post(
        f"/cfo-positions/{position_id}/return-for-revision",
        json={"comment": "Вернуть экономисту", "items": [{"item_id": items[0]["id"]}]},
        headers=approver,
    )
    assert from_approver.status_code == 200, from_approver.text
    assert from_approver.json()["current_step_id"] == ECONOMIST_STEP_ID

    economist_decision = client.post(
        f"/cfo-positions/{position_id}/items/{items[0]['id']}/decision",
        json={"decision": "approved", "comment": "Решение экономиста перед возвратом"},
        headers=economist,
    )
    assert economist_decision.status_code == 200, economist_decision.text

    from_economist = client.post(
        f"/cfo-positions/{position_id}/return-for-revision",
        json={"comment": "Вернуть в ЦФО", "items": [{"item_id": items[0]["id"]}]},
        headers=economist,
    )
    assert from_economist.status_code == 200, from_economist.text
    assert from_economist.json()["current_step_id"] == LEAF_STEP_ID

    send_and_review_by_economist(client, employee, economist, position_id, [items[0]["id"]])
    assert client.post(
        f"/cfo-positions/{position_id}/freeze", json={"comment": ""}, headers=economist
    ).status_code == 200
    assert client.get(f"/cfo-positions/{position_id}", headers=approver).json()["current_step_id"] == APPROVER_STEP_ID
    assert client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Повторно"},
        headers=approver,
    ).status_code == 200
    assert client.get(f"/cfo-positions/{position_id}", headers=zgd).json()["current_step_id"] == ROOT_STEP_ID


def test_zgd_return_to_approver_keeps_budget_frozen_and_repeats_route(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")
    zgd = auth(client, "zgd", "zgd")
    request, items = create_submitted_request(client, employee)
    position_id = complete_cfo(
        client, employee, request["id"], [(items[0]["id"], "approved")]
    )["affected_cfo_position_ids"][0]
    send_and_review_by_economist(
        client, employee, economist, position_id, [items[0]["id"]]
    )
    assert client.post(
        f"/cfo-positions/{position_id}/freeze", json={"comment": ""}, headers=economist
    ).status_code == 200
    assert client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Первое согласование"},
        headers=approver,
    ).status_code == 200

    returned = client.post(
        f"/steps/{ROOT_STEP_ID}/positions/{position_id}/return",
        json={"target_step_id": APPROVER_STEP_ID, "comment": "Повторно проверить"},
        headers=zgd,
    )
    assert returned.status_code == 200, returned.text
    assert returned.json()["current_step_id"] == APPROVER_STEP_ID
    assert returned.json()["status"] == "on_revision"
    assert returned.json()["all_items_frozen"] is False
    assert returned.json()["all_items_fixed"] is False

    approver_rows = client.get(
        "/approval-register/rows",
        params={"module_id": MODULE_ALPHA_ID, "page_size": 25},
        headers=approver,
    ).json()["items"]
    approver_line = next(row for row in approver_rows if row["id"] == items[0]["id"])
    assert approver_line["is_revision"] is True
    assert approver_line["is_current_step_owner"] is True
    assert approver_line["is_approval_actionable"] is True
    assert approver_line["is_final_approval_actionable"] is True
    assert approver_line["status_context"]["editability"]["can_decide"] is True
    assert client.app.state.repo.get_by_id("req_items", items[0]["id"])["frozen"] is False

    decided = client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Решение перед возвратом", "item_ids": [items[0]["id"]]},
        headers=approver,
    )
    assert decided.status_code == 200, decided.text
    returned_by_approver = client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/return",
        json={"target_step_id": ECONOMIST_STEP_ID, "comment": "Передано экономисту"},
        headers=approver,
    )
    assert returned_by_approver.status_code == 200, returned_by_approver.text
    assert returned_by_approver.json()["current_step_id"] == ECONOMIST_STEP_ID
    assert client.post(
        f"/cfo-positions/{position_id}/items/{items[0]['id']}/decision",
        json={"decision": "approved", "comment": "Исправлено"},
        headers=economist,
    ).status_code == 200
    assert client.post(
        f"/cfo-positions/{position_id}/complete-review",
        json={"comment": "Повторная проверка"},
        headers=economist,
    ).status_code == 200
    repeated = client.post(
        f"/cfo-positions/{position_id}/freeze",
        json={"comment": "Повторно заморожено"},
        headers=economist,
    )
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["current_step_id"] == APPROVER_STEP_ID
    repeated = client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Повторно согласовано"},
        headers=approver,
    )
    assert repeated.status_code == 200, repeated.text
    assert repeated.json()["current_step_id"] == ROOT_STEP_ID
    fixed = client.post(
        f"/steps/{ROOT_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Финально"},
        headers=zgd,
    )
    assert fixed.status_code == 200, fixed.text
    fixed = client.post(
        f"/cfo-positions/{position_id}/fix",
        json={"comment": ""},
        headers=zgd,
    )
    assert fixed.status_code == 200, fixed.text
    assert fixed.json()["all_items_fixed"] is True
    assert client.get(f"/requests/{request['id']}", headers=employee).json()["status"] == "approved"


def test_approver_can_reapprove_unfrozen_lines_after_return(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")
    zgd = auth(client, "zgd", "zgd")
    request, items = create_submitted_request(client, employee)
    position_id = complete_cfo(
        client, employee, request["id"], [(items[0]["id"], "approved")]
    )["affected_cfo_position_ids"][0]
    send_and_review_by_economist(client, employee, economist, position_id, [items[0]["id"]])
    assert client.post(
        f"/cfo-positions/{position_id}/freeze", json={"comment": ""}, headers=economist
    ).status_code == 200
    assert client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Первое согласование"},
        headers=approver,
    ).status_code == 200

    returned = client.post(
        f"/steps/{ROOT_STEP_ID}/positions/{position_id}/return",
        json={"target_step_id": APPROVER_STEP_ID, "comment": "Повторно проверить"},
        headers=zgd,
    )
    assert returned.status_code == 200, returned.text
    assert returned.json()["all_items_frozen"] is False

    reapproved = client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Повторно согласовано", "item_ids": [items[0]["id"]]},
        headers=approver,
    )
    assert reapproved.status_code == 200, reapproved.text
    assert reapproved.json()["current_step_id"] == APPROVER_STEP_ID
    assert client.app.state.repo.get_by_id("req_items", items[0]["id"])["frozen"] is True

    forwarded = client.post(
        f"/approval-register/groups/article/{DDS_OPER_ID}/workflow-action",
        json={"action": "approve", "comment": "Пакет согласован повторно"},
        headers=approver,
    )
    assert forwarded.status_code == 200, forwarded.text
    assert forwarded.json()["positions"][0]["current_step_id"] == ROOT_STEP_ID

    assert client.post(
        f"/steps/{ROOT_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Финально"},
        headers=zgd,
    ).status_code == 200


def test_register_group_actions_work_for_article_and_cfo(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")
    request, items = create_submitted_request(client, employee)
    position_id = complete_cfo(
        client, employee, request["id"], [(items[0]["id"], "approved")]
    )["affected_cfo_position_ids"][0]

    # The CFO owner can send a whole article, not only one position card.
    submitted = client.post(
        f"/approval-register/groups/article/{DDS_OPER_ID}/workflow-action",
        json={"action": "submit"}, headers=employee,
    )
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["positions"][0]["current_step_id"] == ECONOMIST_STEP_ID
    position_chat = client.get(f"/cfo-positions/{position_id}/chat", headers=employee)
    assert position_chat.status_code == 200, position_chat.text
    assert any(
        message["text"] == "Позиция «Операционные расходы» ЦФО «ЦФО цифровых продуктов» передана экономисту на проверку."
        for message in position_chat.json()["messages"]
        if message.get("is_system")
    )

    assert client.post(
        f"/cfo-positions/{position_id}/items/{items[0]['id']}/decision",
        json={"decision": "approved", "comment": ""}, headers=economist,
    ).status_code == 200
    approved_article = client.post(
        f"/approval-register/groups/article/{DDS_OPER_ID}/workflow-action",
        json={"action": "approve", "comment": "Группа проверена"}, headers=economist,
    )
    assert approved_article.status_code == 200, approved_article.text
    assert approved_article.json()["positions"][0]["current_step_id"] == APPROVER_STEP_ID

    pending = client.post(
        f"/approval-register/groups/cfo/{CFO_ID}/workflow-action",
        json={"action": "approve", "comment": "Рано передавать"}, headers=approver,
    )
    assert pending.status_code == 409
    assert client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Решение согласующего", "item_ids": [items[0]["id"]]},
        headers=approver,
    ).status_code == 200

    # The same action at the CFO level moves every actionable article of the CFO.
    approved_cfo = client.post(
        f"/approval-register/groups/cfo/{CFO_ID}/workflow-action",
        json={"action": "approve", "comment": "Согласовано по ЦФО"}, headers=approver,
    )
    assert approved_cfo.status_code == 200, approved_cfo.text
    assert approved_cfo.json()["positions"][0]["current_step_id"] == ROOT_STEP_ID


def test_group_workflow_rolls_back_every_position_when_second_write_fails(tmp_path, monkeypatch):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")
    zgd = auth(client, "zgd", "zgd")
    repo = client.app.state.repo
    second_article = repo.create(
        "dds_catalog",
        {
            "parent_id": None,
            "unit_id": DEPARTMENT_ID,
            "name": "Вторая статья для атомарной группы",
            "is_active": True,
        },
    )
    second_category = repo.create(
        "dds_catalog",
        {
            "parent_id": second_article["id"],
            "unit_id": DEPARTMENT_ID,
            "name": "Категория второй статьи",
            "is_active": True,
        },
    )
    request = client.post(
        "/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee
    ).json()
    item_ids = []
    for dds_id, name in (
        (DDS_LICENSE_ID, "Первая атомарная строка"),
        (second_category["id"], "Вторая атомарная строка"),
    ):
        created = client.post(
            f"/requests/{request['id']}/items",
            json={"dds_id": dds_id, "name": name, "sum_plan": 100},
            headers=employee,
        )
        assert created.status_code == 200
        item_ids.append(created.json()["id"])
    assert client.post(f"/requests/{request['id']}/submit", headers=employee).status_code == 200
    completed = complete_cfo(
        client,
        employee,
        request["id"],
        [(item_id, "approved") for item_id in item_ids],
    )
    position_ids = sorted(completed["affected_cfo_position_ids"])
    assert len(position_ids) == 2
    fail_position_id = position_ids[-1]
    original_update = repo.update

    def fail_second_position(collection_name, item_id, patch):
        if (
            collection_name == "cfo_positions"
            and item_id == fail_position_id
            and patch.get("current_step_id") == ECONOMIST_STEP_ID
        ):
            raise RuntimeError("injected second-position write failure")
        return original_update(collection_name, item_id, patch)

    monkeypatch.setattr(repo, "update", fail_second_position)
    with pytest.raises(RuntimeError, match="injected second-position"):
        client.post(
            f"/approval-register/groups/cfo/{CFO_ID}/workflow-action",
            json={"action": "submit", "comment": "Атомарная отправка"},
            headers=employee,
        )

    for position_id in position_ids:
        position = repo.get_by_id("cfo_positions", position_id)
        assert position["status"] == "on_review"
        assert position["current_step_id"] == LEAF_STEP_ID
    assert not any(
        row.get("cfo_position_id") in position_ids
        and (row.get("log") or {}).get("action") == "position_sent_to_economist"
        for row in repo.load_all("cfo_position_logs")
    )

    # The same outer transaction is used by economist and higher-step group
    # approval.  Move both positions forward, then fail the second approver write.
    monkeypatch.setattr(repo, "update", original_update)
    assert client.post(
        f"/approval-register/groups/cfo/{CFO_ID}/workflow-action",
        json={"action": "submit", "comment": "Повторная отправка"},
        headers=employee,
    ).status_code == 200
    sent_logs = [
        row for row in repo.load_all("cfo_position_logs")
        if row.get("cfo_position_id") in position_ids
        and (row.get("log") or {}).get("action") == "position_sent_to_economist"
    ]
    assert len(sent_logs) == len(position_ids)
    assert len({row["log"].get("event_id") for row in sent_logs}) == 1
    for position_id in position_ids:
        position = client.get(f"/cfo-positions/{position_id}", headers=economist).json()
        for item in position["contributions"]:
            assert client.post(
                f"/cfo-positions/{position_id}/items/{item['id']}/decision",
                json={"decision": "approved", "comment": ""},
                headers=economist,
            ).status_code == 200
    assert client.post(
        f"/approval-register/groups/cfo/{CFO_ID}/workflow-action",
        json={"action": "approve", "comment": "Проверено экономистом"},
        headers=economist,
    ).status_code == 200

    for position_id in position_ids:
        position = client.get(f"/cfo-positions/{position_id}", headers=approver).json()
        for item in position["contributions"]:
            assert client.post(
                f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
                json={"comment": "Решение согласующего", "item_ids": [item["id"]]},
                headers=approver,
            ).status_code == 200

    def fail_second_approval(collection_name, item_id, patch):
        if (
            collection_name == "cfo_positions"
            and item_id == fail_position_id
            and patch.get("current_step_id") == ROOT_STEP_ID
        ):
            raise RuntimeError("injected second-position approval failure")
        return original_update(collection_name, item_id, patch)

    monkeypatch.setattr(repo, "update", fail_second_approval)
    with pytest.raises(RuntimeError, match="second-position approval"):
        client.post(
            f"/approval-register/groups/cfo/{CFO_ID}/workflow-action",
            json={"action": "approve", "comment": "Групповое согласование"},
            headers=approver,
        )
    for position_id in position_ids:
        position = repo.get_by_id("cfo_positions", position_id)
        assert position["status"] == "on_approval"
        assert position["current_step_id"] == APPROVER_STEP_ID
    assert not any(
        row.get("cfo_position_id") in position_ids
        and (row.get("log") or {}).get("action") == "position_approved_at_step"
        for row in repo.load_all("cfo_position_logs")
    )

    # Return is atomic as well: a failure on the second ZGD return restores
    # positions, frozen flags, logs and notifications for the whole group.
    monkeypatch.setattr(repo, "update", original_update)
    assert client.post(
        f"/approval-register/groups/cfo/{CFO_ID}/workflow-action",
        json={"action": "approve", "comment": "Согласовано"},
        headers=approver,
    ).status_code == 200
    return_logs_before = sum(
        (row.get("log") or {}).get("action") == "position_returned"
        for row in repo.load_all("cfo_position_logs")
        if row.get("cfo_position_id") in position_ids
    )

    def fail_second_return(collection_name, item_id, patch):
        if (
            collection_name == "cfo_positions"
            and item_id == fail_position_id
            and patch.get("current_step_id") == APPROVER_STEP_ID
            and patch.get("status") == "on_revision"
        ):
            raise RuntimeError("injected second-position return failure")
        return original_update(collection_name, item_id, patch)

    monkeypatch.setattr(repo, "update", fail_second_return)
    with pytest.raises(RuntimeError, match="second-position return"):
        client.post(
            f"/approval-register/groups/cfo/{CFO_ID}/workflow-action",
            json={
                "action": "return_for_revision",
                "target_step_id": APPROVER_STEP_ID,
                "comment": "Повторно проверить группу",
            },
            headers=zgd,
        )
    for position_id in position_ids:
        position = repo.get_by_id("cfo_positions", position_id)
        assert position["status"] == "on_approval"
        assert position["current_step_id"] == ROOT_STEP_ID
        assert all(item["frozen"] for item in client.get(
            f"/cfo-positions/{position_id}", headers=zgd
        ).json()["contributions"])
    assert sum(
        (row.get("log") or {}).get("action") == "position_returned"
        for row in repo.load_all("cfo_position_logs")
        if row.get("cfo_position_id") in position_ids
    ) == return_logs_before


def test_economist_return_reopens_cfo_step_without_returning_request_to_module(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    request, items = create_submitted_request(client, employee)
    position_id = complete_cfo(
        client, employee, request["id"], [(items[0]["id"], "approved")]
    )["affected_cfo_position_ids"][0]
    submitted = client.post(
        f"/cfo-positions/{position_id}/submit-to-economist",
        json={"comment": "Передано"},
        headers=employee,
    )
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["current_step_id"] == ECONOMIST_STEP_ID

    decided = client.post(
        f"/cfo-positions/{position_id}/items/{items[0]['id']}/decision",
        json={"decision": "approved", "comment": "Решение экономиста"},
        headers=economist,
    )
    assert decided.status_code == 200, decided.text
    returned = client.post(
        f"/cfo-positions/{position_id}/return-for-revision",
        json={
            "comment": "Скорректировать сумму",
            "items": [{"item_id": items[0]["id"], "comment": "Меньше", "suggested_sum_fact": 75}],
        },
        headers=economist,
    )
    assert returned.status_code == 200, returned.text
    position = returned.json()
    position_chat = client.get(f"/cfo-positions/{position_id}/chat", headers=employee)
    assert any(
        message.get("is_system")
        and "Скорректировать сумму" in message["text"]
        and "Меньше" in message["text"]
        and items[0]["name"] in message["text"]
        for message in position_chat.json()["messages"]
    )
    assert position["current_step_id"] == LEAF_STEP_ID
    by_id = {item["id"]: item for item in position["contributions"]}
    assert by_id[items[0]["id"]]["sum_fact"] == 75
    revised_request = client.get(f"/requests/{request['id']}", headers=employee).json()
    assert "edit_revision" not in revised_request["available_actions"]
    revision_row = next(
        row for row in client.get(
            "/approval-register/rows",
            params={"request_id": request["id"], "page_size": 25},
            headers=employee,
        ).json()["items"]
        if row["id"] == items[0]["id"]
    )
    assert revision_row["is_revision"] is True
    assert revision_row["is_revision_actionable"] is False
    patched_fact = client.patch(
        f"/items/{items[0]['id']}", json={"sum_fact": 80}, headers=employee,
    )
    assert patched_fact.status_code == 200, patched_fact.text
    assert patched_fact.json()["sum_fact"] == 80
    assert client.patch(
        f"/items/{items[0]['id']}", json={"sum_plan": 125}, headers=employee,
    ).status_code == 409
    assert client.patch(
        f"/items/{items[0]['id']}", json={"justification": "Исправленное обоснование"}, headers=employee,
    ).status_code == 409
    assert not any(
        row["log"]["action"] == "cfo_items_returned_for_revision"
        for row in client.get(f"/requests/{request['id']}/logs", headers=employee).json()
    )

    returned_to_module = client.post(
        f"/approval-register/groups/article/{DDS_OPER_ID}/cfo-revision",
        json={
            "comment": "Нужны данные от модуля",
            "items": [{"item_id": items[0]["id"], "comment": "Уточните обоснование"}],
        },
        headers=employee,
    )
    assert returned_to_module.status_code == 200, returned_to_module.text
    # The explicit revision dialog hands the selected row directly to the
    # module. "Submit to economist" must not silently replace that route.
    assert client.post(
        f"/cfo-positions/{position_id}/submit-to-economist", json={"comment": ""}, headers=employee,
    ).status_code == 409
    revised_request = client.get(f"/requests/{request['id']}", headers=employee).json()
    assert "edit_revision" in revised_request["available_actions"]
    assert client.patch(
        f"/items/{items[0]['id']}", json={"justification": "Исправленное обоснование"}, headers=employee,
    ).status_code == 200
    module_revision_row = next(
        row for row in client.get(
            "/approval-register/rows",
            params={"request_id": request["id"], "page_size": 25},
            headers=employee,
        ).json()["items"]
        if row["id"] == items[0]["id"]
    )
    assert module_revision_row["is_module_revision"] is True
    assert module_revision_row["is_position_submission_actionable"] is False


def test_cfo_revision_has_the_same_decision_and_handoff_actions_as_first_review(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    request, items = create_submitted_request(client, employee, item_count=2)
    position_id = complete_cfo(
        client,
        employee,
        request["id"],
        [(item["id"], "approved") for item in items],
    )["affected_cfo_position_ids"][0]
    assert client.post(
        f"/cfo-positions/{position_id}/submit-to-economist",
        json={"comment": "В маршрут"},
        headers=employee,
    ).status_code == 200
    for item in items:
        decided = client.post(
            f"/cfo-positions/{position_id}/items/{item['id']}/decision",
            json={"decision": "approved", "comment": "Решение экономиста"},
            headers=economist,
        )
        assert decided.status_code == 200, decided.text
    returned = client.post(
        f"/cfo-positions/{position_id}/return-for-revision",
        json={
            "comment": "Уточнить первую строку",
            "items": [{"item_id": items[0]["id"], "comment": "Проверьте сумму"}],
        },
        headers=economist,
    )
    assert returned.status_code == 200, returned.text

    rows = client.get(
        "/approval-register/rows",
        params={"module_id": MODULE_ALPHA_ID, "page_size": 25},
        headers=employee,
    ).json()["items"]
    by_id = {row["id"]: row for row in rows}
    assert by_id[items[0]["id"]]["is_cfo_review_actionable"] is True
    assert by_id[items[1]["id"]]["is_cfo_review_actionable"] is False
    assert by_id[items[0]["id"]]["status_context"]["editability"]["can_decide"] is True

    group_decision = client.post(
        f"/approval-register/groups/article/{DDS_OPER_ID}/cfo-decision",
        json={"decision": "approved", "comment": "Повторно проверено"},
        headers=employee,
    )
    assert group_decision.status_code == 200, group_decision.text
    rows_after_decision = client.get(
        "/approval-register/rows",
        params={"module_id": MODULE_ALPHA_ID, "page_size": 25},
        headers=employee,
    ).json()["items"]
    after_by_id = {row["id"]: row for row in rows_after_decision}
    assert after_by_id[items[0]["id"]]["is_cfo_review_actionable"] is False
    assert after_by_id[items[0]["id"]]["is_position_submission_actionable"] is True

    submitted = client.post(
        f"/approval-register/groups/article/{DDS_OPER_ID}/workflow-action",
        json={"action": "submit"},
        headers=employee,
    )
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["positions"][0]["current_step_id"] == ECONOMIST_STEP_ID


def test_workflow_group_approval_after_partial_return_uses_only_returned_lines(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")
    zgd = auth(client, "zgd", "zgd")
    request, items = create_submitted_request(client, employee, item_count=2)
    position_id = complete_cfo(
        client,
        employee,
        request["id"],
        [(item["id"], "approved") for item in items],
    )["affected_cfo_position_ids"][0]
    send_and_review_by_economist(
        client,
        employee,
        economist,
        position_id,
        [item["id"] for item in items],
    )
    assert client.post(
        f"/cfo-positions/{position_id}/freeze",
        json={"comment": "В маршрут"},
        headers=economist,
    ).status_code == 200
    assert client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Первое согласование"},
        headers=approver,
    ).status_code == 200
    returned = client.post(
        f"/steps/{ROOT_STEP_ID}/positions/{position_id}/return",
        json={
            "target_step_id": APPROVER_STEP_ID,
            "comment": "Доработать первую строку",
            "item_ids": [items[0]["id"]],
        },
        headers=zgd,
    )
    assert returned.status_code == 200, returned.text

    rows = client.get(
        "/approval-register/rows",
        params={"module_id": MODULE_ALPHA_ID, "page_size": 25},
        headers=approver,
    ).json()["items"]
    by_id = {row["id"]: row for row in rows}
    assert by_id[items[0]["id"]]["is_approval_actionable"] is True
    assert by_id[items[1]["id"]]["is_approval_actionable"] is False

    approver_decision = client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Проверено повторно", "item_ids": [items[0]["id"]]},
        headers=approver,
    )
    assert approver_decision.status_code == 200, approver_decision.text
    assert approver_decision.json()["current_step_id"] == APPROVER_STEP_ID

    approved = client.post(
        f"/approval-register/groups/article/{DDS_OPER_ID}/workflow-action",
        json={"action": "approve", "comment": "Повторно согласовано"},
        headers=approver,
    )
    assert approved.status_code == 200, approved.text
    position = client.get(f"/cfo-positions/{position_id}", headers=approver).json()
    assert position["current_step_id"] == ROOT_STEP_ID
    contributions = {item["id"]: item for item in position["contributions"]}
    assert contributions[items[0]["id"]]["frozen"] is True
    assert contributions[items[1]["id"]]["frozen"] is True

    assert client.post(
        f"/steps/{ROOT_STEP_ID}/positions/{position_id}/approve",
        json={"comment": "Финально согласовано"},
        headers=zgd,
    ).status_code == 200
    finalized = client.post(
        f"/cfo-positions/{position_id}/fix",
        json={"comment": "Финально согласовано"},
        headers=zgd,
    )
    assert finalized.status_code == 200, finalized.text
    position = client.get(f"/cfo-positions/{position_id}", headers=zgd).json()
    assert position["all_items_fixed"] is True


def test_cfo_revision_selection_waits_for_explicit_module_handoff(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    request, items = create_submitted_request(client, employee, item_count=2)
    position_id = complete_cfo(
        client, employee, request["id"], [(item["id"], "approved") for item in items]
    )["affected_cfo_position_ids"][0]
    assert client.post(
        f"/cfo-positions/{position_id}/submit-to-economist",
        json={"comment": "????????"}, headers=employee,
    ).status_code == 200
    for item in items:
        assert client.post(
            f"/cfo-positions/{position_id}/items/{item['id']}/decision",
            json={"decision": "approved", "comment": "??????? ??????????"},
            headers=economist,
        ).status_code == 200
    assert client.post(
        f"/cfo-positions/{position_id}/return-for-revision",
        json={
            "comment": "????????? ??????",
            "items": [
                {"item_id": items[0]["id"], "comment": "??????"},
                {"item_id": items[1]["id"], "comment": "??????"},
            ],
        },
        headers=economist,
    ).status_code == 200

    # Row actions only preserve CFO choices. They do not hand anything to the
    # module and do not lock the remaining returned row.
    for selected_item, comment in ((items[0], "??????? ??????"), (items[1], "????? ??????")):
        response = client.post(
            f"/items/{selected_item['id']}/cfo-revision-selection",
            json={"comment": comment},
            headers=employee,
        )
        assert response.status_code == 200, response.text

    rows = {
        row["id"]: row
        for row in client.get(
            "/approval-register/rows",
            params={"request_id": request["id"], "page_size": 25},
            headers=employee,
        ).json()["items"]
    }
    assert all(not rows[item["id"]]["is_module_revision"] for item in items)

    # Only the explicit revision dialog sends the selected package to the module.
    sent = client.post(
        f"/approval-register/groups/article/{DDS_OPER_ID}/cfo-revision",
        json={
            "comment": "???????? ??????",
            "items": [{"item_id": item["id"], "comment": ""} for item in items],
        },
        headers=employee,
    )
    assert sent.status_code == 200, sent.text
    assert client.post(
        f"/cfo-positions/{position_id}/submit-to-economist", json={"comment": ""}, headers=employee,
    ).status_code == 409
    request_after_send = client.get(f"/requests/{request['id']}", headers=employee).json()
    assert "edit_revision" in request_after_send["available_actions"]


def test_partial_revision_unfreezes_only_selected_lines_and_creates_block(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")
    request, items = create_submitted_request(client, employee, item_count=2)
    position_id = complete_cfo(
        client, employee, request["id"], [(item["id"], "approved") for item in items]
    )["affected_cfo_position_ids"][0]
    send_and_review_by_economist(client, employee, economist, position_id, [item["id"] for item in items])
    assert client.post(
        f"/cfo-positions/{position_id}/freeze", json={"comment": "", "item_ids": [item["id"] for item in items]}, headers=economist,
    ).status_code == 200
    for item in items:
        decided = client.post(
            f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
            json={"comment": "Решение согласующего", "item_ids": [item["id"]]},
            headers=approver,
        )
        assert decided.status_code == 200, decided.text

    returned = client.post(
        f"/cfo-positions/{position_id}/return-for-revision",
        json={
            "target_step_id": ECONOMIST_STEP_ID,
            "comment": "Проверьте первую строку",
            "items": [{"item_id": items[0]["id"], "comment": "Уточнить сумму"}],
        },
        headers=approver,
    )
    assert returned.status_code == 200, returned.text
    position = returned.json()
    by_id = {item["id"]: item for item in position["contributions"]}
    assert by_id[items[0]["id"]]["frozen"] is False
    assert by_id[items[1]["id"]]["frozen"] is True
    assert by_id[items[0]["id"]]["sum_fact"] == 100
    return_actions = [
        (row.get("log") or {}).get("action")
        for row in client.app.state.repo.load_all("cfo_position_logs")
        if row.get("cfo_position_id") == position_id
    ]
    assert return_actions.count("position_returned") == 1
    assert return_actions.count("item_returned_for_revision") == 0


def test_approver_can_select_frozen_lines_for_revision_from_register(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")
    request, items = create_submitted_request(client, employee, item_count=2)
    position_id = complete_cfo(
        client, employee, request["id"], [(item["id"], "approved") for item in items]
    )["affected_cfo_position_ids"][0]
    send_and_review_by_economist(
        client, employee, economist, position_id, [item["id"] for item in items]
    )
    assert client.post(
        f"/cfo-positions/{position_id}/freeze",
        json={"comment": "Forwarded"},
        headers=economist,
    ).status_code == 200

    lines = client.get(
        f"/approval-register/groups/article/{DDS_OPER_ID}/revision-lines",
        params={"mode": "workflow"},
        headers=approver,
    )
    assert lines.status_code == 200, lines.text
    assert {line["id"] for line in lines.json()["lines"]} == {item["id"] for item in items}
    for item in items:
        decided = client.post(
            f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
            json={"comment": "Решение согласующего", "item_ids": [item["id"]]},
            headers=approver,
        )
        assert decided.status_code == 200, decided.text

    returned = client.post(
        f"/approval-register/groups/article/{DDS_OPER_ID}/workflow-action",
        json={
            "action": "return_for_revision",
            "target_step_id": ECONOMIST_STEP_ID,
            "comment": "Please revise one line",
            "items": [{"item_id": items[0]["id"]}],
        },
        headers=approver,
    )
    assert returned.status_code == 200, returned.text
    position = client.get(f"/cfo-positions/{position_id}", headers=approver).json()
    by_id = {item["id"]: item for item in position["contributions"]}
    assert by_id[items[0]["id"]]["frozen"] is False
    assert by_id[items[1]["id"]]["frozen"] is True


def test_zgd_can_unlock_a_fixed_budget(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")
    zgd = auth(client, "zgd", "zgd")
    request, items = create_submitted_request(client, employee)
    position_id = complete_cfo(client, employee, request["id"], [(items[0]["id"], "approved")])["affected_cfo_position_ids"][0]
    send_and_review_by_economist(client, employee, economist, position_id, [items[0]["id"]])
    client.post(f"/cfo-positions/{position_id}/freeze", json={"comment": ""}, headers=economist)
    client.post(f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve", json={"comment": ""}, headers=approver)
    assert client.post(f"/steps/{ROOT_STEP_ID}/positions/{position_id}/approve", json={"comment": ""}, headers=zgd).status_code == 200
    assert client.post(f"/cfo-positions/{position_id}/fix", json={"comment": ""}, headers=zgd).status_code == 200
    reopened = client.post(
        f"/cfo-positions/{position_id}/unfix",
        json={"target_step_id": APPROVER_STEP_ID, "comment": "Нужна доработка", "items": [{"item_id": items[0]["id"]}]},
        headers=zgd,
    )
    assert reopened.status_code == 200
    position = client.get(f"/cfo-positions/{position_id}", headers=zgd).json()
    assert position["contributions"][0]["fixed"] is False
    assert position["contributions"][0]["frozen"] is True
    assert client.get(f"/requests/{request['id']}", headers=zgd).json()["status"] == "on_review"


def test_late_module_submission_cannot_enter_position_already_above_cfo(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    repo = client.app.state.repo

    first, first_items = create_submitted_request(client, employee)
    position_id = complete_cfo(
        client, employee, first["id"], [(first_items[0]["id"], "approved")]
    )["affected_cfo_position_ids"][0]
    assert client.post(
        f"/cfo-positions/{position_id}/submit-to-economist",
        json={"comment": ""},
        headers=employee,
    ).status_code == 200
    assert client.post(
        f"/cfo-positions/{position_id}/items/{first_items[0]['id']}/decision",
        json={"decision": "approved", "comment": ""},
        headers=economist,
    ).status_code == 200
    assert client.post(
        f"/cfo-positions/{position_id}/complete-review",
        json={"comment": "Первичная проверка завершена"},
        headers=economist,
    ).status_code == 200

    second_module = repo.create(
        "units",
        {
            "parent_id": CFO_ID,
            "name": "Второй модуль",
            "is_active": True,
            "uses_invest_projects": False,
            "annual_budget": 0,
        },
    )
    repo.insert(
        "units_responsibles",
        {
            "unit_id": second_module["id"],
            "user_id": client.app.state.auth_service.login("employee", "employee")["user"]["id"],
            "is_active": True,
        },
    )
    second = client.post(
        "/requests", json={"unit_id": second_module["id"]}, headers=employee
    ).json()
    late = client.post(
        f"/requests/{second['id']}/items",
        json={
            "dds_id": DDS_LICENSE_ID,
            "name": "Поздняя строка",
            "sum_plan": 50,
            "justification": "",
        },
        headers=employee,
    ).json()
    late_submit = client.post(f"/requests/{second['id']}/submit", headers=employee)
    assert late_submit.status_code == 409
    late_decision = client.post(
        f"/items/{late['id']}/cfo-decision",
        json={"decision": "approved", "comment": ""},
        headers=employee,
    )
    assert late_decision.status_code == 409
    unchanged = client.get(f"/cfo-positions/{position_id}", headers=economist).json()
    assert unchanged["status"] == "approved"
    assert unchanged["current_step_id"] == ECONOMIST_STEP_ID


def test_frozen_position_rejects_late_contribution(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    request, items = create_submitted_request(client, employee)
    position_id = complete_cfo(
        client, employee, request["id"], [(items[0]["id"], "approved")]
    )["affected_cfo_position_ids"][0]
    send_and_review_by_economist(
        client, employee, economist, position_id, [items[0]["id"]]
    )
    client.post(
        f"/cfo-positions/{position_id}/freeze",
        json={"comment": ""},
        headers=economist,
    )
    assert client.app.state.repo.get_by_id("req_items", items[0]["id"])["frozen"] is True


def test_position_logs_contain_old_new_values_and_request_history_is_merged(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    request, items = create_submitted_request(client, employee)
    position_id = complete_cfo(
        client, employee, request["id"], [(items[0]["id"], "approved")]
    )["affected_cfo_position_ids"][0]
    client.post(
        f"/cfo-positions/{position_id}/submit-to-economist",
        json={"comment": ""},
        headers=employee,
    )
    client.post(
        f"/cfo-positions/{position_id}/items/{items[0]['id']}/decision",
        json={
            "decision": "approved_with_changes",
            "sum_fact": 80,
            "comment": "Снижено",
        },
        headers=economist,
    )

    logs = client.get(f"/cfo-positions/{position_id}/logs", headers=economist).json()
    decision = next(
        row for row in logs if row["log"]["action"] == "economist_item_decided"
    )
    assert decision["log"]["changes"]["sum_fact"] == {"from": 100, "to": 80}
    history = client.get(
        f"/requests/{request['id']}/logs", headers=employee
    ).json()
    assert {row["source"] for row in history} == {"request", "cfo_position"}
    register_history = client.get("/approval-register/history", headers=employee)
    assert register_history.status_code == 200, register_history.text
    assert {row["source"] for row in register_history.json()} >= {"request", "cfo_position"}
    assert {row["request_id"] for row in register_history.json()} == {request["id"]}

    # Position-level actions (including ZGD actions) do not carry a line id;
    # history must still include them through the position's request items.
    repo = client.app.state.repo
    zgd = next(row for row in repo.load_all("users") if row.get("login") == "zgd")
    position = repo.get_by_id("cfo_positions", position_id)
    repo.create(
        "cfo_position_logs",
        {
            "cfo_position_id": position_id,
            "user_id": zgd["id"],
            "step_id": position.get("current_step_id"),
            "log": {"action": "position_fixed", "stage": "cfo_position", "entity": "cfo_position", "entity_id": position_id, "changes": {}},
        },
    )
    history_with_position_action = client.get(
        f"/requests/{request['id']}/logs", headers=employee
    ).json()
    assert any(
        row["log"]["action"] == "position_fixed" and row["user"]["login"] == "zgd"
        for row in history_with_position_action
    )


def test_second_completion_is_rejected_and_does_not_duplicate_position(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request, items = create_submitted_request(client, employee)
    complete_cfo(
        client, employee, request["id"], [(items[0]["id"], "approved")]
    )
    second = client.post(
        f"/requests/{request['id']}/complete-cfo-review", headers=employee
    )
    assert second.status_code == 409
    assert len(client.get("/cfo-positions", headers=employee).json()) == 1


def test_cfo_responsible_cannot_review_another_cfo(tmp_path):
    client = make_client(tmp_path)
    admin = auth(client, "admin", "admin")
    seeded_employee = auth(client, "employee", "employee")
    other_user = client.post(
        "/users",
        json=user_payload("other-employee"),
        headers=admin,
    ).json()
    other_cfo_user = client.post(
        "/users",
        json=user_payload("other-cfo-employee"),
        headers=admin,
    ).json()
    other_economist = client.post(
        "/users",
        json=user_payload("other-economist", "economist"),
        headers=admin,
    ).json()
    other_employee = auth(client, "other-employee", "password")
    department = client.post(
        "/units",
        json={"name": "Другая организация", "type": "department", "parent_id": None},
        headers=admin,
    ).json()
    cfo = client.post(
        "/units",
        json={"name": "Другой ЦФО", "type": "cfo", "parent_id": department["id"]},
        headers=admin,
    ).json()
    module = client.post(
        "/units",
        json={"name": "Другой модуль", "type": "module", "parent_id": cfo["id"]},
        headers=admin,
    ).json()
    client.post(
        f"/units/{module['id']}/responsible",
        json={"user_id": other_user["id"]},
        headers=admin,
    )
    client.post(
        f"/units/{cfo['id']}/responsible",
        json={"user_id": other_cfo_user["id"]},
        headers=admin,
    )
    client.post(
        "/economist-assignments",
        json={
            "economist_id": other_economist["id"],
            "unit_id": cfo["id"],
            "assignment_type": "cfo",
        },
        headers=admin,
    )
    category = client.post(
        "/catalog/dds",
        json={"name": "Категория", "unit_id": department["id"], "parent_id": None},
        headers=admin,
    ).json()
    article = client.post(
        "/catalog/dds",
        json={
            "name": "Статья",
            "unit_id": department["id"],
            "parent_id": category["id"],
        },
        headers=admin,
    ).json()
    request = client.post(
        "/requests", json={"unit_id": module["id"]}, headers=other_employee
    ).json()
    item = client.post(
        f"/requests/{request['id']}/items",
        json={"dds_id": article["id"], "name": "Чужая строка", "sum_plan": 10},
        headers=other_employee,
    ).json()
    client.post(f"/requests/{request['id']}/submit", headers=other_employee)

    forbidden = client.post(
        f"/items/{item['id']}/cfo-decision",
        json={"decision": "approved", "comment": ""},
        headers=seeded_employee,
    )
    assert forbidden.status_code == 403
    assert client.post(
        f"/items/{item['id']}/cfo-decision",
        json={"decision": "approved", "comment": ""},
        headers=auth(client, "other-cfo-employee", "password"),
    ).status_code == 200

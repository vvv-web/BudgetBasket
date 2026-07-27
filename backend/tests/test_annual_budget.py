from app.seed import APPROVER_STEP_ID, DEPARTMENT_ID, DDS_LICENSE_ID, LEAF_STEP_ID, MODULE_ALPHA_ID
from tests.test_api import auth, make_client


def test_annual_budget_is_formed_from_approved_closed_request_lines(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")

    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    line = client.post(
        f"/requests/{request['id']}/items",
        json={"dds_id": DDS_LICENSE_ID, "name": "Support", "sum_plan": 1_000, "justification": "Required"},
        headers=employee,
    )
    assert line.status_code == 200
    assert client.post(f"/requests/{request['id']}/submit", headers=employee).status_code == 200

    item_id = line.json()["id"]
    assert client.patch(
        f"/items/{item_id}",
        json={"status": "approved_with_changes", "sum_fact": 750},
        headers=economist,
    ).status_code == 200
    approved = client.patch(f"/items/{item_id}", json={"status": "approved"}, headers=economist)
    assert approved.status_code == 200
    assert approved.json()["sum_fact"] == approved.json()["sum_plan"]
    back_to_review = client.patch(f"/items/{item_id}", json={"status": "on_review"}, headers=economist)
    assert back_to_review.status_code == 200
    assert back_to_review.json()["sum_fact"] == 0
    assert client.patch(f"/items/{item_id}", json={"status": "approved_with_changes", "sum_fact": 750}, headers=economist).status_code == 200
    assert client.post(f"/requests/{request['id']}/finalize", headers=economist).status_code == 200

    units = {unit["id"]: unit for unit in client.get("/units", headers=employee).json()}
    assert units[MODULE_ALPHA_ID]["annual_budget"] == 750
    assert units[DEPARTMENT_ID]["annual_budget"] == 750

    assert client.post(
        f"/steps/{APPROVER_STEP_ID}/return",
        json={
            "targets": [{"child_step_id": LEAF_STEP_ID, "request_ids": [request["id"]]}],
            "comment": "Нужна доработка",
        },
        headers=approver,
    ).status_code == 200
    assert client.post(
        f"/steps/{LEAF_STEP_ID}/return",
        json={"request_ids": [request["id"]], "comment": "Возвращаю сотруднику"},
        headers=economist,
    ).status_code == 200
    units = {unit["id"]: unit for unit in client.get("/units", headers=employee).json()}
    assert units[MODULE_ALPHA_ID]["annual_budget"] == 0
    assert units[DEPARTMENT_ID]["annual_budget"] == 0


def test_annual_budget_does_not_limit_draft_or_submitted_request_lines(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")

    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    line = client.post(
        f"/requests/{request['id']}/items",
        json={"dds_id": DDS_LICENSE_ID, "name": "Large request", "sum_plan": 9_999_999, "justification": "Required"},
        headers=employee,
    )
    assert line.status_code == 200
    assert client.post(f"/requests/{request['id']}/submit", headers=employee).status_code == 200


def test_income_lines_are_marked_and_do_not_reserve_annual_budget(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")

    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    income = client.post(
        f"/requests/{request['id']}/items",
        json={
            "dds_id": DDS_LICENSE_ID,
            "is_income": True,
            "name": "Subscription revenue",
            "sum_plan": 1_000,
            "justification": "Annual plan",
        },
        headers=employee,
    )
    assert income.status_code == 200
    assert income.json()["is_income"] is True
    assert client.post(f"/requests/{request['id']}/submit", headers=employee).status_code == 200
    assert client.patch(f"/items/{income.json()['id']}", json={"status": "approved"}, headers=economist).status_code == 200
    assert client.post(f"/requests/{request['id']}/finalize", headers=economist).status_code == 200

    saved_request = client.get(f"/requests/{request['id']}", headers=employee).json()
    assert saved_request["sum_plan"] == 0
    assert saved_request["sum_fact"] == 0
    assert saved_request["summary"]["income_planned_sum"] == 1_000
    assert saved_request["summary"]["income_approved_sum"] == 1_000
    units = {unit["id"]: unit for unit in client.get("/units", headers=employee).json()}
    assert units[MODULE_ALPHA_ID]["annual_budget"] == 0

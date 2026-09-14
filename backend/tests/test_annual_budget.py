from app.seed import (
    APPROVER_STEP_ID,
    DDS_LICENSE_ID,
    MODULE_ALPHA_ID,
    ROOT_STEP_ID,
)
from tests.test_api import auth, make_client


def test_annual_budget_is_formed_only_after_position_is_fixed(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    approver = auth(client, "approver", "approver")
    zgd = auth(client, "zgd", "zgd")
    request = client.post(
        "/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee
    ).json()
    item = client.post(
        f"/requests/{request['id']}/items",
        json={
            "dds_id": DDS_LICENSE_ID,
            "name": "Support",
            "sum_plan": 1_000,
            "justification": "Required",
        },
        headers=employee,
    ).json()
    client.post(f"/requests/{request['id']}/submit", headers=employee)
    client.post(
        f"/items/{item['id']}/cfo-decision",
        json={"decision": "approved", "comment": ""},
        headers=employee,
    )
    reviewed = client.post(
        f"/requests/{request['id']}/complete-cfo-review", headers=employee
    ).json()
    position_id = reviewed["affected_cfo_position_ids"][0]

    assert client.app.state.repo.get_by_id("units", MODULE_ALPHA_ID)["annual_budget"] == 0
    client.post(
        f"/cfo-positions/{position_id}/submit-to-economist",
        json={"comment": ""},
        headers=employee,
    )
    client.post(
        f"/cfo-positions/{position_id}/items/{item['id']}/decision",
        json={
            "decision": "approved_with_changes",
            "sum_fact": 750,
            "comment": "Снижено",
        },
        headers=economist,
    )
    client.post(
        f"/cfo-positions/{position_id}/complete-review",
        json={"comment": ""},
        headers=economist,
    )
    client.post(
        f"/cfo-positions/{position_id}/freeze",
        json={"comment": ""},
        headers=economist,
    )
    client.post(
        f"/steps/{APPROVER_STEP_ID}/positions/{position_id}/approve",
        json={"comment": ""},
        headers=approver,
    )
    approved = client.post(
        f"/steps/{ROOT_STEP_ID}/positions/{position_id}/approve",
        json={"comment": ""},
        headers=zgd,
    )
    assert approved.status_code == 200
    fixed = client.post(
        f"/cfo-positions/{position_id}/fix",
        json={"comment": ""},
        headers=zgd,
    )
    assert fixed.status_code == 200
    assert client.app.state.repo.get_by_id("units", MODULE_ALPHA_ID)["annual_budget"] == 750


def test_fixed_income_position_does_not_reserve_expense_budget(tmp_path):
    client = make_client(tmp_path)
    repo = client.app.state.repo
    request = repo.create(
        "requests",
        {
            "unit_id": MODULE_ALPHA_ID,
            "created_by_id": "00000000-0000-0000-0000-000000000003",
            "budget_year": 2026,
            "sum_plan": 0,
            "sum_fact": 0,
            "status": "approved",
        },
    )
    position = repo.create(
        "cfo_positions",
        {
            "budget_year": 2026,
            "cfo_unit_id": "10000000-0000-0000-0000-000000000010",
            "dds_id": DDS_LICENSE_ID,
            "invest_id": None,
            "is_income": True,
            "status": "approved",
            "current_step_id": None,
            "frozen": True,
            "fixed": True,
        },
    )
    repo.create(
        "req_items",
        {
            "request_id": request["id"],
            "cfo_position_id": position["id"],
            "dds_id": DDS_LICENSE_ID,
            "invest_id": None,
            "is_income": True,
            "name": "Доход",
            "sum_plan": 500,
            "sum_fact": 500,
            "justification": "",
            "status": "approved",
            "comment": "",
        },
    )
    from app.services.budget_totals import sync_annual_budgets

    sync_annual_budgets(repo)
    assert repo.get_by_id("units", MODULE_ALPHA_ID)["annual_budget"] == 0

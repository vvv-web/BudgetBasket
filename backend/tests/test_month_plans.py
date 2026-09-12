from decimal import Decimal

from tests.test_api import auth, make_client
from app.seed import DDS_LICENSE_ID, MODULE_ALPHA_ID


def _income_payload(month_plans, sum_plan=None):
    return {
        "dds_id": DDS_LICENSE_ID,
        "is_income": True,
        "name": "Доход от услуг",
        **({"sum_plan": sum_plan} if sum_plan is not None else {}),
        "justification": "План поступлений",
        "month_plans": month_plans,
    }


def test_income_month_plans_are_saved_and_totalled(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    plans = [{"month": month, "sum_plan": f"{month}.25"} for month in range(1, 13)]

    response = client.post(f"/requests/{request['id']}/items", json=_income_payload(plans), headers=employee)

    assert response.status_code == 200
    item = response.json()
    assert len(item["month_plans"]) == 12
    assert [plan["month"] for plan in item["month_plans"]] == list(range(1, 13))
    assert Decimal(str(item["sum_plan"])) == Decimal("81.00")
    listed = client.get(f"/requests/{request['id']}/items", headers=employee).json()[0]
    assert listed["month_plans"][0]["sum_plan"] == 1.25


def test_rejects_conflicting_annual_and_monthly_plan_totals(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()

    response = client.post(
        f"/requests/{request['id']}/items",
        json=_income_payload([{"month": 1, "sum_plan": "100.00"}], sum_plan="99.99"),
        headers=employee,
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "Годовая сумма должна совпадать с суммой помесячного плана"


def test_month_plan_validation_and_expense_default_distribution(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()

    for invalid_plans in (
        [{"month": 0, "sum_plan": "1.00"}],
        [{"month": 13, "sum_plan": "1.00"}],
        [{"month": 1, "sum_plan": "1.00"}, {"month": 1, "sum_plan": "2.00"}],
        [{"month": 1, "sum_plan": "-1.00"}],
    ):
        assert client.post(f"/requests/{request['id']}/items", json=_income_payload(invalid_plans), headers=employee).status_code == 422

    expense = client.post(
        f"/requests/{request['id']}/items",
        json={"dds_id": DDS_LICENSE_ID, "name": "Расход", "sum_plan": "500.00", "month_plans": []},
        headers=employee,
    )
    assert expense.status_code == 200
    expense_body = expense.json()
    assert len(expense_body["month_plans"]) == 12
    assert Decimal(str(expense_body["sum_plan"])) == Decimal("500.00")
    assert Decimal(str(expense_body["month_plans"][0]["sum_plan"])) == Decimal("41.67")
    assert Decimal(str(expense_body["month_plans"][-1]["sum_plan"])) == Decimal("41.66")

    adjusted = client.patch(
        f"/items/{expense_body['id']}",
        json={"month_plans": [{"month": 1, "sum_plan": "200.00"}]},
        headers=employee,
    )
    assert adjusted.status_code == 200
    assert Decimal(str(adjusted.json()["sum_plan"])) == Decimal("200.00")
    assert Decimal(str(adjusted.json()["month_plans"][0]["sum_plan"])) == Decimal("200.00")
    assert Decimal(str(adjusted.json()["month_plans"][1]["sum_plan"])) == Decimal("0.00")

    conflicting_update = client.patch(
        f"/items/{expense_body['id']}",
        json={"sum_plan": "201.00", "month_plans": [{"month": 1, "sum_plan": "200.00"}]},
        headers=employee,
    )
    assert conflicting_update.status_code == 422
    reloaded = client.get(f"/requests/{request['id']}/items", headers=employee).json()
    saved = next(row for row in reloaded if row["id"] == expense_body["id"])
    assert Decimal(str(saved["sum_plan"])) == Decimal("200.00")
    assert Decimal(str(saved["month_plans"][0]["sum_plan"])) == Decimal("200.00")


def test_month_plans_update_and_type_change_keeps_distribution(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    item = client.post(
        f"/requests/{request['id']}/items",
        json=_income_payload([{"month": 1, "sum_plan": "100.00"}]),
        headers=employee,
    ).json()

    updated = client.patch(
        f"/items/{item['id']}",
        json={"month_plans": [{"month": 2, "sum_plan": "200.00"}]},
        headers=employee,
    )
    assert updated.status_code == 200
    assert Decimal(str(updated.json()["sum_plan"])) == Decimal("200.00")
    assert updated.json()["month_plans"][0]["sum_plan"] == 0
    assert updated.json()["month_plans"][1]["sum_plan"] == 200

    expense = client.patch(
        f"/items/{item['id']}",
        json={"is_income": False, "sum_plan": "50.00"},
        headers=employee,
    )
    assert expense.status_code == 200
    assert len(expense.json()["month_plans"]) == 12
    assert Decimal(str(expense.json()["sum_plan"])) == Decimal("50.00")
    assert sum(Decimal(str(plan["sum_plan"])) for plan in expense.json()["month_plans"]) == Decimal("50.00")

    cents = client.patch(
        f"/items/{item['id']}",
        json={"sum_plan": "0.01"},
        headers=employee,
    )
    assert cents.status_code == 200
    assert [Decimal(str(plan["sum_plan"])) for plan in cents.json()["month_plans"]] == [
        Decimal("0.01"), *[Decimal("0.00")] * 11,
    ]

    reloaded = client.get(f"/requests/{request['id']}/items", headers=employee).json()
    saved = next(row for row in reloaded if row["id"] == item["id"])
    assert saved["month_plans"] == cents.json()["month_plans"]


def test_cfo_responsible_can_adjust_expense_month_plans_during_review(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    item = client.post(
        f"/requests/{request['id']}/items",
        json={"dds_id": DDS_LICENSE_ID, "name": "Расход", "sum_plan": "120.00"},
        headers=employee,
    ).json()
    assert client.post(f"/requests/{request['id']}/submit", headers=employee).status_code == 200

    annually_adjusted = client.patch(
        f"/items/{item['id']}",
        json={"sum_plan": "0.01"},
        headers=employee,
    )
    assert annually_adjusted.status_code == 200
    assert [Decimal(str(plan["sum_plan"])) for plan in annually_adjusted.json()["month_plans"]] == [
        Decimal("0.01"), *[Decimal("0.00")] * 11,
    ]

    adjusted = client.patch(
        f"/items/{item['id']}",
        json={"sum_plan": "120.00", "month_plans": [{"month": 1, "sum_plan": "120.00"}]},
        headers=employee,
    )

    assert adjusted.status_code == 200
    assert Decimal(str(adjusted.json()["sum_plan"])) == Decimal("120.00")
    assert Decimal(str(adjusted.json()["month_plans"][0]["sum_plan"])) == Decimal("120.00")
    assert Decimal(str(adjusted.json()["month_plans"][1]["sum_plan"])) == Decimal("0.00")


def test_economist_changes_fact_without_changing_monthly_plan(tmp_path):
    client = make_client(tmp_path)
    employee = auth(client, "employee", "employee")
    economist = auth(client, "economist", "economist")
    request = client.post("/requests", json={"unit_id": MODULE_ALPHA_ID}, headers=employee).json()
    item = client.post(
        f"/requests/{request['id']}/items",
        json=_income_payload([{"month": 1, "sum_plan": "100.00"}, {"month": 2, "sum_plan": "200.00"}]),
        headers=employee,
    ).json()
    assert client.post(f"/requests/{request['id']}/submit", headers=employee).status_code == 200
    assert client.post(
        f"/items/{item['id']}/cfo-decision",
        json={"decision": "approved", "comment": ""},
        headers=employee,
    ).status_code == 200
    reviewed = client.post(
        f"/requests/{request['id']}/complete-cfo-review", headers=employee
    ).json()
    position_id = reviewed["affected_cfo_position_ids"][0]
    assert client.post(
        f"/cfo-positions/{position_id}/submit-to-economist",
        json={"comment": ""},
        headers=employee,
    ).status_code == 200

    approved = client.post(
        f"/cfo-positions/{position_id}/items/{item['id']}/decision",
        json={"decision": "approved_with_changes", "sum_fact": "150.00", "comment": "Снижено"},
        headers=economist,
    )

    assert approved.status_code == 200
    approved_body = approved.json()
    assert Decimal(str(approved_body["sum_plan"])) == Decimal("300.00")
    assert Decimal(str(approved_body["sum_fact"])) == Decimal("150.00")

    rejected_plan_edit = client.post(
        f"/cfo-positions/{position_id}/items/{item['id']}/decision",
        json={"decision": "approved_with_changes", "comment": "Снижено", "month_plans": [{"month": 1, "sum_plan": "50.00"}, {"month": 2, "sum_plan": "100.00"}]},
        headers=economist,
    )
    assert rejected_plan_edit.status_code == 422

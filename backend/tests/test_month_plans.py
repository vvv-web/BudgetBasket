from decimal import Decimal

from tests.test_api import auth, make_client
from app.seed import DDS_LICENSE_ID, MODULE_ALPHA_ID


def _income_payload(month_plans):
    return {
        "dds_id": DDS_LICENSE_ID,
        "is_income": True,
        "name": "Доход от услуг",
        "sum_plan": "999.99",
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


def test_income_month_plan_validation_and_expense_compatibility(tmp_path):
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
    assert expense.json()["month_plans"] == []


def test_income_month_plans_update_and_type_change_requires_confirmation(tmp_path):
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

    assert client.patch(f"/items/{item['id']}", json={"is_income": False, "sum_plan": "50.00"}, headers=employee).status_code == 422
    expense = client.patch(
        f"/items/{item['id']}",
        json={"is_income": False, "sum_plan": "50.00", "month_plans": [], "clear_month_plans": True},
        headers=employee,
    )
    assert expense.status_code == 200
    assert expense.json()["month_plans"] == []
    assert Decimal(str(expense.json()["sum_plan"])) == Decimal("50.00")


def test_economist_month_plan_changes_adjust_approved_amount(tmp_path):
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

    approved = client.patch(
        f"/items/{item['id']}",
        json={"status": "approved_with_changes", "sum_fact": "150.00"},
        headers=economist,
    )

    assert approved.status_code == 422

    adjusted = client.patch(
        f"/items/{item['id']}",
        json={"status": "approved_with_changes", "month_plans": [{"month": 1, "sum_plan": "50.00"}, {"month": 2, "sum_plan": "100.00"}]},
        headers=economist,
    )
    assert adjusted.status_code == 200
    adjusted_body = adjusted.json()
    assert Decimal(str(adjusted_body["sum_plan"])) == Decimal("300.00")
    assert Decimal(str(adjusted_body["sum_fact"])) == Decimal("150.00")

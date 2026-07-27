from app.seed import (
    CFO_ID,
    DEPARTMENT_ID,
    EMPLOYEE_ID,
    INVEST_PLATFORM_ID,
    MODULE_BETA_ID,
)
from tests.test_api import auth, make_client


def test_module_economist_can_review_assigned_requests(tmp_path):
    client = make_client(tmp_path)
    admin = auth(client, "admin", "admin")
    employee = auth(client, "employee", "employee")

    created = client.post(
        "/users",
        json={"login": "department-viewer", "password": "password", "role": "economist"},
        headers=admin,
    )
    assert created.status_code == 200
    viewer_id = created.json()["id"]
    viewer = auth(client, "department-viewer", "password")

    assignment = client.post(
        "/economist-assignments",
        json={"economist_id": viewer_id, "unit_id": DEPARTMENT_ID, "assignment_type": "department"},
        headers=admin,
    )
    assert assignment.status_code == 400
    cfo_assignment = client.post(
        "/economist-assignments",
        json={"economist_id": viewer_id, "unit_id": CFO_ID, "assignment_type": "module"},
        headers=admin,
    )
    assert cfo_assignment.status_code == 400
    module_assignment = client.post(
        "/economist-assignments",
        json={"economist_id": viewer_id, "unit_id": MODULE_BETA_ID, "assignment_type": "module"},
        headers=admin,
    )
    assert module_assignment.status_code == 200
    assignments = client.get("/economist-assignments", headers=admin).json()
    assert any(item["economist_id"] == viewer_id and item["unit_id"] == MODULE_BETA_ID and item["assignment_type"] == "module" for item in assignments)

    assert client.post(
        f"/units/{MODULE_BETA_ID}/responsible",
        json={"user_id": EMPLOYEE_ID},
        headers=admin,
    ).status_code == 200
    budget_request = client.post("/requests", json={"unit_id": MODULE_BETA_ID}, headers=employee)
    assert budget_request.status_code == 200
    request_id = budget_request.json()["id"]
    item = client.post(
        f"/requests/{request_id}/items",
        json={"invest_id": INVEST_PLATFORM_ID, "name": "Read-only scope", "sum_plan": 100, "justification": "Test"},
        headers=employee,
    )
    assert item.status_code == 200
    assert client.post(f"/requests/{request_id}/submit", headers=employee).status_code == 200

    assert client.get(f"/requests/{request_id}", headers=viewer).status_code == 200
    assert request_id in {item["id"] for item in client.get("/requests", headers=viewer).json()}
    dashboard = client.get("/dashboard", headers=viewer).json()
    assert dashboard["totals"]["planned"] >= 100
    assert {item["id"] for item in dashboard["scope"]["available_units"]} == {DEPARTMENT_ID}
    assert client.patch(f"/items/{item.json()['id']}", json={"status": "approved"}, headers=viewer).status_code == 200
    assert client.post(f"/requests/{request_id}/freeze-budget", headers=viewer).status_code == 400


def test_employee_cannot_be_assigned_to_department(tmp_path):
    client = make_client(tmp_path)
    admin = auth(client, "admin", "admin")

    response = client.post(
        f"/units/{DEPARTMENT_ID}/responsible",
        json={"user_id": EMPLOYEE_ID},
        headers=admin,
    )

    assert response.status_code == 400

    cfo_response = client.post(
        f"/units/{CFO_ID}/responsible",
        json={"user_id": EMPLOYEE_ID},
        headers=admin,
    )

    assert cfo_response.status_code == 400

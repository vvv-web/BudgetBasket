from app.seed import (
    CFO_ID,
    DEPARTMENT_ID,
    EMPLOYEE_ID,
    INVEST_PLATFORM_ID,
    MODULE_BETA_ID,
)
from tests.test_api import auth, make_client, user_payload


def test_economist_is_assigned_once_at_cfo_and_can_serve_its_positions(tmp_path):
    client = make_client(tmp_path)
    admin = auth(client, "admin", "admin")
    employee = auth(client, "employee", "employee")
    created = client.post(
        "/users",
        json=user_payload("cfo-economist", "economist"),
        headers=admin,
    )
    viewer_id = created.json()["id"]
    viewer = auth(client, "cfo-economist", "password")

    assert client.post(
        "/economist-assignments",
        json={
            "economist_id": viewer_id,
            "unit_id": DEPARTMENT_ID,
            "assignment_type": "cfo",
        },
        headers=admin,
    ).status_code == 400
    assert client.post(
        "/economist-assignments",
        json={
            "economist_id": viewer_id,
            "unit_id": MODULE_BETA_ID,
            "assignment_type": "cfo",
        },
        headers=admin,
    ).status_code == 400
    assigned = client.post(
        "/economist-assignments",
        json={
            "economist_id": viewer_id,
            "unit_id": CFO_ID,
            "assignment_type": "cfo",
        },
        headers=admin,
    )
    assert assigned.status_code == 200
    assignments = client.get("/economist-assignments", headers=admin).json()
    assert assignments == [
        {
            "id": f"{viewer_id}:{CFO_ID}",
            "economist_id": viewer_id,
            "unit_id": CFO_ID,
            "assignment_type": "cfo",
            "is_active": True,
        }
    ]

    module_user = client.post(
        "/users",
        json=user_payload("beta-module-employee"),
        headers=admin,
    ).json()
    module_employee = auth(client, "beta-module-employee", "password")
    assert client.post(
        f"/units/{MODULE_BETA_ID}/responsible",
        json={"user_id": module_user["id"]},
        headers=admin,
    ).status_code == 200
    request = client.post(
        "/requests", json={"unit_id": MODULE_BETA_ID}, headers=module_employee
    ).json()
    item = client.post(
        f"/requests/{request['id']}/items",
        json={
            "invest_id": INVEST_PLATFORM_ID,
            "name": "Позиция",
            "sum_plan": 100,
            "justification": "",
        },
        headers=module_employee,
    ).json()
    client.post(f"/requests/{request['id']}/submit", headers=module_employee)
    client.post(
        f"/items/{item['id']}/cfo-decision",
        json={"decision": "approved", "comment": ""},
        headers=employee,
    )
    reviewed = client.post(
        f"/requests/{request['id']}/complete-cfo-review", headers=employee
    ).json()
    position_id = reviewed["affected_cfo_position_ids"][0]
    client.post(
        f"/cfo-positions/{position_id}/submit-to-economist",
        json={"comment": ""},
        headers=employee,
    )

    assert client.get(f"/cfo-positions/{position_id}", headers=viewer).status_code == 200
    assert client.post(
        f"/cfo-positions/{position_id}/items/{item['id']}/decision",
        json={"decision": "approved", "comment": ""},
        headers=viewer,
    ).status_code == 200


def test_employee_responsibles_are_allowed_on_cfo_and_module_only(tmp_path):
    client = make_client(tmp_path)
    admin = auth(client, "admin", "admin")
    cfo_user = client.post(
        "/users",
        json=user_payload("cfo-responsible"),
        headers=admin,
    ).json()
    assert client.post(
        f"/units/{DEPARTMENT_ID}/responsible",
        json={"user_id": EMPLOYEE_ID},
        headers=admin,
    ).status_code == 400
    assert client.post(
        f"/units/{CFO_ID}/responsible",
        json={"user_id": cfo_user["id"]},
        headers=admin,
    ).status_code == 200
    assert client.post(
        f"/units/{MODULE_BETA_ID}/responsible",
        json={"user_id": cfo_user["id"]},
        headers=admin,
    ).status_code == 409
    module_user = client.post(
        "/users",
        json=user_payload("module-responsible"),
        headers=admin,
    ).json()
    assert client.post(
        f"/units/{MODULE_BETA_ID}/responsible",
        json={"user_id": module_user["id"]},
        headers=admin,
    ).status_code == 200

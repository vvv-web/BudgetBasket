from app.database import cfo_positions, req_items, requests


def test_budget_tables_keep_only_the_agreed_columns():
    assert list(requests.c.keys()) == [
        "id",
        "unit_id",
        "budget_year",
        "status",
        "created_at",
        "updated_at",
    ]
    assert list(cfo_positions.c.keys()) == [
        "id",
        "budget_year",
        "cfo_unit_id",
        "dds_id",
        "invest_id",
        "status",
        "current_step_id",
        "created_at",
        "updated_at",
    ]
    assert list(req_items.c.keys()) == [
        "id",
        "request_id",
        "cfo_position_id",
        "dds_id",
        "invest_id",
        "is_income",
        "name",
        "sum_plan",
        "sum_fact",
        "justification",
        "status",
        "comment",
        "analytics_1",
        "analytics_2",
        "analytics_3",
        "analytics_4",
        "analytics_5",
        "frozen",
        "fixed",
    ]

from app.models import APPROVED_ITEM_STATUSES, EXPORTABLE_REQUEST_STATUSES
from app.repositories.base import Repository


def annual_budgets_by_unit(repo: Repository) -> dict[str, float]:
    """Return budgets formed by approved lines in closed requests.

    A module includes its own requests. A department also includes the budgets
    of all modules below it, so its total stays equal to the organisational
    roll-up shown to users.
    """
    units = {unit["id"]: unit for unit in repo.load_all("units")}
    totals = {unit_id: 0.0 for unit_id in units}
    closed_requests = {
        request["id"]: request
        for request in repo.load_all("requests")
        if request.get("status") in EXPORTABLE_REQUEST_STATUSES
    }

    for item in repo.load_all("req_items"):
        request = closed_requests.get(item.get("request_id"))
        if not request or item.get("is_income", False) or item.get("status") not in APPROVED_ITEM_STATUSES:
            continue
        amount = float(item.get("sum_fact") or 0)
        unit_id = request.get("unit_id")
        seen: set[str] = set()
        while unit_id and unit_id not in seen:
            seen.add(unit_id)
            if unit_id not in units:
                break
            totals[unit_id] = totals.get(unit_id, 0.0) + amount
            unit_id = units[unit_id].get("parent_id")

    return totals


def sync_annual_budgets(repo: Repository) -> dict[str, float]:
    """Persist the calculated budget totals for reporting and statistics."""
    totals = annual_budgets_by_unit(repo)
    for unit_id, annual_budget in totals.items():
        repo.update("units", unit_id, {"annual_budget": annual_budget})
    return totals

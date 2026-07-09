from fastapi import HTTPException

from app.repositories.base import Repository
from app.services.common import require_role


class UnitService:
    def __init__(self, repo: Repository):
        self.repo = repo

    @staticmethod
    def enrich_unit(unit: dict) -> dict:
        return {**unit, "type": "module" if unit.get("parent_id") else "department"}

    def list_units(self) -> list[dict]:
        return [self.enrich_unit(item) for item in self.repo.load_all("units")]

    def create_unit(self, user: dict, payload: dict) -> dict:
        require_role(user, "admin")
        payload = {key: value for key, value in payload.items() if key != "type"}
        return self.enrich_unit(self.repo.create("units", payload))

    def update_unit(self, user: dict, unit_id: str, patch: dict) -> dict:
        require_role(user, "admin")
        patch = {key: value for key, value in patch.items() if key != "type"}
        return self.enrich_unit(self.repo.update("units", unit_id, patch))

    def delete_unit(self, user: dict, unit_id: str) -> None:
        require_role(user, "admin")
        target = self.repo.get_by_id("units", unit_id)
        if not target:
            raise HTTPException(status_code=404, detail="Запись не найдена")
        if any(request.get("unit_id") == unit_id for request in self.repo.load_all("requests")):
            raise HTTPException(status_code=400, detail="Нельзя удалить подразделение, пока есть связанные заявки")
        if any(item.get("unit_id") == unit_id for item in self.repo.load_all("dds_catalog")):
            raise HTTPException(status_code=400, detail="Нельзя удалить подразделение, пока в нем есть статьи ДДС")
        if any(item.get("unit_id") == unit_id for item in self.repo.load_all("invests_catalog")):
            raise HTTPException(status_code=400, detail="Нельзя удалить подразделение, пока в нем есть инвест-проекты")

        for item in self.repo.load_all("units"):
            if item.get("parent_id") == unit_id:
                self.repo.update("units", item["id"], {"parent_id": None})
        self.repo.delete_where("units_responsibles", {"unit_id": unit_id})
        self.repo.delete_where("unit_dds_mappings", {"unit_id": unit_id})
        self.repo.delete_where("unit_invest_mappings", {"unit_id": unit_id})
        self.repo.delete("units", unit_id)

    def tree(self) -> list[dict]:
        units = [dict(self.enrich_unit(item), children=[]) for item in self.repo.load_all("units")]
        by_id = {item["id"]: item for item in units}
        roots = []
        for item in units:
            parent_id = item.get("parent_id")
            if parent_id and parent_id in by_id:
                by_id[parent_id]["children"].append(item)
            else:
                roots.append(item)
        return roots

    def set_responsible(self, user: dict, unit_id: str, employee_id: str) -> dict:
        require_role(user, "admin")
        target = self.repo.get_by_id("users", employee_id)
        if not target or target.get("role") != "employee":
            raise HTTPException(status_code=400, detail="Ответственным может быть только сотрудник")
        items = self.repo.load_all("units_responsibles")
        existing = next((item for item in items if item["unit_id"] == unit_id and item["user_id"] == employee_id and item.get("is_active")), None)
        if existing:
            return existing
        self.repo.update_where("units_responsibles", {"unit_id": unit_id}, {"is_active": False})
        inactive = next((item for item in items if item["unit_id"] == unit_id and item["user_id"] == employee_id), None)
        if inactive:
            self.repo.update_where("units_responsibles", {"unit_id": unit_id, "user_id": employee_id}, {"is_active": True})
            return {"unit_id": unit_id, "user_id": employee_id, "is_active": True}
        return self.repo.insert("units_responsibles", {"unit_id": unit_id, "user_id": employee_id, "is_active": True})

    def get_responsible(self, unit_id: str) -> dict | None:
        return next((item for item in self.repo.load_all("units_responsibles") if item["unit_id"] == unit_id and item.get("is_active")), None)

    def list_assignments(self, user: dict) -> list[dict]:
        require_role(user, "admin")
        seen: set[tuple[str, str]] = set()
        assignments = []
        users = {item["id"]: item for item in self.repo.load_all("users")}
        for item in self.repo.load_all("units_responsibles"):
            target = users.get(item.get("user_id"))
            if not target or target.get("role") != "economist" or not item.get("is_active"):
                continue
            key = (item["user_id"], item["unit_id"])
            seen.add(key)
            assignments.append(
                {
                    "id": f"{item['user_id']}:{item['unit_id']}",
                    "economist_id": item["user_id"],
                    "unit_id": item["unit_id"],
                    "assignment_type": "module",
                    "is_active": True,
                }
            )
        for request in self.repo.load_all("requests"):
            economist_id = request.get("economist_id")
            if not economist_id:
                continue
            key = (economist_id, request["unit_id"])
            if key in seen:
                continue
            seen.add(key)
            assignments.append(
                {
                    "id": f"{economist_id}:{request['unit_id']}",
                    "economist_id": economist_id,
                    "unit_id": request["unit_id"],
                    "assignment_type": "module",
                    "is_active": True,
                }
            )
        return assignments

    def create_assignment(self, user: dict, payload: dict) -> dict:
        require_role(user, "admin")
        target = self.repo.get_by_id("users", payload["economist_id"])
        if not target or target.get("role") != "economist":
            raise HTTPException(status_code=400, detail="Закрепить можно только экономиста")
        unit_ids = [payload["unit_id"]]
        if payload.get("assignment_type") == "department":
            unit_ids = [unit["id"] for unit in self.repo.load_all("units") if unit.get("parent_id") == payload["unit_id"]]
        for request in self.repo.load_all("requests"):
            if request.get("unit_id") in unit_ids:
                self.repo.update("requests", request["id"], {"economist_id": payload["economist_id"]})
        responsibles = {(item["unit_id"], item["user_id"]): item for item in self.repo.load_all("units_responsibles")}
        for unit_id in unit_ids:
            existing = responsibles.get((unit_id, payload["economist_id"]))
            if existing:
                if not existing.get("is_active"):
                    self.repo.update_where("units_responsibles", {"unit_id": unit_id, "user_id": payload["economist_id"]}, {"is_active": True})
                continue
            self.repo.insert("units_responsibles", {"unit_id": unit_id, "user_id": payload["economist_id"], "is_active": True})
        return {
            "id": f"{payload['economist_id']}:{payload['unit_id']}",
            "economist_id": payload["economist_id"],
            "unit_id": payload["unit_id"],
            "assignment_type": payload["assignment_type"],
            "is_active": True,
        }

    def deactivate_assignment(self, user: dict, assignment_id: str) -> dict:
        require_role(user, "admin")
        return {"id": assignment_id, "is_active": False}

from __future__ import annotations

import re
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill

from app.repositories.json_repository import JsonRepository
from app.services.common import get_required, require_role
from app.services.permission_service import PermissionService
from app.services.request_service import RequestService


HEADER_FILL = PatternFill("solid", fgColor="1E3A5F")
HEADER_FONT = Font(color="FFFFFF", bold=True)
MONEY_FORMAT = '#,##0.00'

REQUEST_STATUS_LABELS = {
    "draft": "Черновик",
    "on_review": "На проверке",
    "approved": "Утверждена",
    "partially_approved": "Частично утверждена",
    "rejected": "Отклонена",
    "cancelled": "Отменена",
}

ITEM_STATUS_LABELS = {
    "on_review": "На рассмотрении",
    "rejected": "Отказано",
    "approved_with_changes": "Утверждено с изменениями",
    "approved": "Утверждено",
}


class ExcelService:
    def __init__(
        self,
        repo: JsonRepository,
        permissions: PermissionService,
        requests: RequestService,
        export_dir: Path,
    ):
        self.repo = repo
        self.permissions = permissions
        self.requests = requests
        self.export_dir = export_dir
        self.export_dir.mkdir(parents=True, exist_ok=True)

    def department_id_for_unit(self, unit_id: str | None) -> str | None:
        if not unit_id:
            return None
        unit = self.repo.get_by_id("units", unit_id)
        if not unit:
            return None
        if unit.get("parent_id"):
            return unit["parent_id"]
        return unit["id"]

    def resolve_unit_id(self, *, unit_id: str | None = None, module_id: str | None = None) -> str | None:
        if module_id:
            return self.department_id_for_unit(module_id)
        if unit_id:
            return self.department_id_for_unit(unit_id)
        return None

    def filter_catalog(
        self,
        collection: str,
        *,
        unit_id: str | None = None,
        module_id: str | None = None,
        active_only: bool = False,
        query: str | None = None,
    ) -> list[dict]:
        department_id = self.resolve_unit_id(unit_id=unit_id, module_id=module_id)
        items = self.repo.load_all(collection)
        result = []
        needle = (query or "").strip().lower()
        for item in items:
            if department_id and item.get("unit_id") not in {department_id, None}:
                # Allow global items (unit_id null) for admins browsing everything;
                # for scoped lookups require matching department.
                if unit_id or module_id:
                    if item.get("unit_id") != department_id:
                        continue
            if active_only and not item.get("is_active", True):
                continue
            if needle:
                haystack = str(item.get("name", "")).lower()
                if needle not in haystack:
                    continue
            result.append(item)
        return result

    @staticmethod
    def _style_header(ws, columns: list[str]) -> None:
        for index, title in enumerate(columns, start=1):
            cell = ws.cell(1, index, title)
            cell.fill = HEADER_FILL
            cell.font = HEADER_FONT
            cell.alignment = Alignment(horizontal="center", vertical="center")

    @staticmethod
    def _autosize(ws) -> None:
        for column in ws.columns:
            width = 12
            letter = column[0].column_letter
            for cell in column:
                value = "" if cell.value is None else str(cell.value)
                width = max(width, min(len(value) + 2, 48))
            ws.column_dimensions[letter].width = width

    def build_import_template(self, kind: str) -> BytesIO:
        titles = {
            "dds": "Шаблон импорта статей ДДС",
            "invests": "Шаблон импорта инвест-проектов",
        }
        if kind not in titles:
            raise HTTPException(status_code=400, detail="Неизвестный тип справочника")
        leaf_label = "Статья ДДС" if kind == "dds" else "Инвест-проект"
        wb = Workbook()
        ws = wb.active
        ws.title = "НСИ"
        columns = ["Категория", "Название", "Подразделение", "Активен"]
        self._style_header(ws, columns)
        ws.append(["Операционные расходы", f"Пример: {leaf_label}", "Департамент цифровых продуктов", "да"])
        ws.append(["Операционные расходы", "Ещё одна подкатегория", "Департамент цифровых продуктов", "да"])
        ws.append(["Капитальные затраты", "Подкатегория другой категории", "Департамент цифровых продуктов", "да"])
        note = wb.create_sheet("Инструкция")
        note["A1"] = titles[kind]
        note["A2"] = "Структура НСИ: категория → подкатегория (статья ДДС или инвест-проект)."
        note["A3"] = "Обязательные поля: Категория, Название. Рекомендуется Подразделение."
        note["A4"] = "Одинаковая Категория в нескольких строках создаёт одну категорию и несколько подкатегорий."
        note["A5"] = "Подразделение должно совпадать с названием подразделения (корневого unit)."
        note["A6"] = "Активен: да/нет, true/false, 1/0."
        self._autosize(ws)
        buffer = BytesIO()
        wb.save(buffer)
        buffer.seek(0)
        return buffer

    def _find_unit(self, unit_name: str | None, unit_id: str | None) -> str | None:
        if unit_id:
            unit = self.repo.get_by_id("units", str(unit_id))
            if not unit:
                raise HTTPException(status_code=400, detail=f"Подразделение {unit_id} не найдено")
            return unit["id"] if not unit.get("parent_id") else unit["parent_id"]
        if unit_name:
            name = str(unit_name).strip().lower()
            units = self.repo.load_all("units")
            match = next((unit for unit in units if not unit.get("parent_id") and unit.get("name", "").strip().lower() == name), None)
            if not match:
                match = next((unit for unit in units if unit.get("name", "").strip().lower() == name), None)
            if not match:
                raise HTTPException(status_code=400, detail=f"Подразделение «{unit_name}» не найдено")
            return match["id"] if not match.get("parent_id") else match["parent_id"]
        department = next((unit for unit in self.repo.load_all("units") if unit.get("parent_id") is None), None)
        return department["id"] if department else None

    @staticmethod
    def _as_bool(value: Any, default: bool = True) -> bool:
        if value is None or value == "":
            return default
        if isinstance(value, bool):
            return value
        text = str(value).strip().lower()
        if text in {"1", "true", "yes", "y", "да", "истина", "активен"}:
            return True
        if text in {"0", "false", "no", "n", "нет", "ложь", "неактивен"}:
            return False
        return default

    @staticmethod
    def _normalize_header(value: Any) -> str:
        text = str(value or "").strip().lower().replace(" ", "_")
        mapping = {
            "название": "name",
            "наименование": "name",
            "имя": "name",
            "подкатегория": "name",
            "статья": "name",
            "проект": "name",
            "категория": "category",
            "category": "category",
            "category_name": "category",
            "родитель": "category",
            "parent": "category",
            "подразделение": "unit_name",
            "департамент": "unit_name",
            "unit": "unit_name",
            "unit_id": "unit_id",
            "активен": "is_active",
            "is_active": "is_active",
            "name": "name",
            "unit_name": "unit_name",
        }
        return mapping.get(text, text)

    def _ensure_category(
        self,
        collection: str,
        *,
        category_name: str,
        unit_id: str | None,
        is_active: bool,
    ) -> dict:
        name_key = category_name.strip()
        match = next(
            (
                item
                for item in self.repo.load_all(collection)
                if not item.get("parent_id")
                and item.get("name", "").strip().lower() == name_key.lower()
                and item.get("unit_id") == unit_id
            ),
            None,
        )
        if match:
            return match
        return self.repo.create(
            collection,
            {
                "parent_id": None,
                "name": name_key,
                "unit_id": unit_id,
                "is_active": is_active,
            },
        )

    def _find_leaf(self, collection: str, *, name: str, parent_id: str | None, unit_id: str | None) -> dict | None:
        return next(
            (
                item
                for item in self.repo.load_all(collection)
                if item.get("name", "").strip().lower() == name.strip().lower()
                and item.get("parent_id") == parent_id
                and item.get("unit_id") == unit_id
            ),
            None,
        )

    async def import_catalog(self, user: dict, collection: str, upload: UploadFile) -> dict:
        require_role(user, "admin")
        filename = (upload.filename or "").lower()
        if not filename.endswith((".xlsx", ".xlsm")):
            raise HTTPException(status_code=400, detail="Ожидается файл Excel (.xlsx)")
        raw = await upload.read()
        if not raw:
            raise HTTPException(status_code=400, detail="Пустой файл")
        try:
            wb = load_workbook(BytesIO(raw), data_only=True)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=400, detail="Не удалось прочитать Excel-файл") from exc
        ws = wb.active
        rows = list(ws.iter_rows(values_only=True))
        if not rows:
            raise HTTPException(status_code=400, detail="В файле нет строк")
        headers = [self._normalize_header(value) for value in rows[0]]
        if "name" not in headers:
            raise HTTPException(status_code=400, detail="В первой строке должен быть столбец name / Название / Подкатегория")

        created = 0
        updated = 0
        errors: list[str] = []

        for row_index, values in enumerate(rows[1:], start=2):
            if not values or all(cell is None or str(cell).strip() == "" for cell in values):
                continue
            row = {headers[i]: values[i] for i in range(min(len(headers), len(values)))}
            name = str(row.get("name") or "").strip()
            if not name:
                errors.append(f"Строка {row_index}: пустое название подкатегории")
                continue
            category_name = str(row.get("category") or "").strip() or None
            try:
                unit_id = self._find_unit(
                    str(row.get("unit_name")).strip() if row.get("unit_name") not in (None, "") else None,
                    str(row.get("unit_id")).strip() if row.get("unit_id") not in (None, "") else None,
                )
            except HTTPException as exc:
                errors.append(f"Строка {row_index}: {exc.detail}")
                continue

            is_active = self._as_bool(row.get("is_active"), True)
            parent = None
            if category_name:
                parent = self._ensure_category(
                    collection,
                    category_name=category_name,
                    unit_id=unit_id,
                    is_active=True,
                )

            payload = {
                "name": name,
                "parent_id": parent["id"] if parent else None,
                "unit_id": unit_id,
                "is_active": is_active,
            }
            existing = self._find_leaf(collection, name=name, parent_id=payload["parent_id"], unit_id=unit_id)
            if existing:
                self.repo.update(collection, existing["id"], payload)
                updated += 1
            else:
                self.repo.create(collection, payload)
                created += 1

        return {"created": created, "updated": updated, "errors": errors, "collection": collection}

    def _unit_name(self, unit_id: str | None) -> str:
        if not unit_id:
            return ""
        unit = self.repo.get_by_id("units", unit_id)
        return unit.get("name", unit_id) if unit else unit_id

    def _catalog_name(self, collection: str, item_id: str | None) -> str:
        if not item_id:
            return ""
        item = self.repo.get_by_id(collection, item_id)
        if not item:
            return item_id
        return item["name"]

    def _category_name(self, collection: str, item_id: str | None, category_id: str | None = None) -> str:
        if category_id:
            return self._catalog_name(collection, category_id)
        if not item_id:
            return ""
        item = self.repo.get_by_id(collection, item_id)
        if not item:
            return ""
        parent_id = item.get("parent_id")
        if not parent_id:
            return ""
        return self._catalog_name(collection, parent_id)

    def _request_items(self, request_id: str) -> list[dict]:
        rows: list[dict] = []
        for kind, collection, catalog, field in (
            ("ДДС", "dds_items", "dds_catalog", "dds_id"),
            ("Инвест", "invest_items", "invests_catalog", "invest_id"),
        ):
            for item in self.repo.load_all(collection):
                if item.get("request_id") != request_id:
                    continue
                rows.append(
                    {
                        "kind": kind,
                        "article": self._catalog_name(catalog, item.get(field)),
                        "category": self._category_name(catalog, item.get(field), item.get("category_id")),
                        "sum_plan": float(item.get("sum_plan") or 0),
                        "sum_fact": item.get("sum_fact"),
                        "status": ITEM_STATUS_LABELS.get(item.get("status"), item.get("status") or ""),
                        "comment": item.get("comment") or "",
                    }
                )
        return rows

    CLOSED_STATUSES = {"approved", "partially_approved", "rejected"}

    def export_closed_request(self, user: dict, request_id: str) -> Path:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_view_request(user, request)
        if request.get("status") not in self.CLOSED_STATUSES:
            raise HTTPException(status_code=400, detail="Экспорт доступен только для закрытых заявок")
        return self._write_request_workbook([request], f"request_{request_id[:8]}.xlsx")

    def export_closed_requests(self, user: dict, unit_id: str | None = None) -> Path:
        requests = [
            item
            for status in self.CLOSED_STATUSES
            for item in self.requests.list_requests(user, status=status, unit_id=unit_id)
        ]
        if not requests:
            raise HTTPException(status_code=404, detail="Нет закрытых заявок для экспорта")
        suffix = re.sub(r"[^a-zA-Z0-9_-]+", "", unit_id or "all")[:24] or "all"
        return self._write_request_workbook(requests, f"closed_requests_{suffix}.xlsx")

    # Compat aliases
    def export_fixed_request(self, user: dict, request_id: str) -> Path:
        return self.export_closed_request(user, request_id)

    def export_fixed_requests(self, user: dict, unit_id: str | None = None) -> Path:
        return self.export_closed_requests(user, unit_id)

    def _write_request_workbook(self, requests: list[dict], filename: str) -> Path:
        wb = Workbook()

        composition = wb.active
        composition.title = "Состав"
        self._style_header(
            composition,
            [
                "ID заявки",
                "Модуль",
                "Статус заявки",
                "Тип",
                "Категория",
                "Статья / проект",
                "План",
                "Факт",
                "Статус строки",
                "Комментарий",
            ],
        )
        for request in requests:
            module_name = self._unit_name(request.get("unit_id"))
            request_status = REQUEST_STATUS_LABELS.get(request.get("status"), request.get("status") or "")
            items = self._request_items(request["id"])
            if not items:
                composition.append(
                    [
                        request["id"],
                        module_name,
                        request_status,
                        "",
                        "",
                        "Строки отсутствуют",
                        0,
                        None,
                        "",
                        "",
                    ]
                )
                continue
            for item in items:
                composition.append(
                    [
                        request["id"],
                        module_name,
                        request_status,
                        item["kind"],
                        item["category"],
                        item["article"],
                        item["sum_plan"],
                        item["sum_fact"],
                        item["status"],
                        item["comment"],
                    ]
                )
        for col in (7, 8):
            for row in range(2, composition.max_row + 1):
                composition.cell(row, col).number_format = MONEY_FORMAT
        self._autosize(composition)

        summary = wb.create_sheet("Сводка")
        self._style_header(
            summary,
            ["ID заявки", "Модуль", "Статус", "План", "Утверждено", "Строк", "Принято", "Отказано"],
        )
        for request in requests:
            stats = request.get("summary") or self.requests.summary(request["id"])
            summary.append(
                [
                    request["id"],
                    self._unit_name(request.get("unit_id")),
                    REQUEST_STATUS_LABELS.get(request.get("status"), request.get("status") or ""),
                    stats.get("planned_sum", 0),
                    stats.get("approved_sum", request.get("sum", 0)),
                    stats.get("items_count", 0),
                    stats.get("accepted_count", 0),
                    stats.get("rejected_count", 0),
                ]
            )
        for col in (4, 5):
            for row in range(2, summary.max_row + 1):
                summary.cell(row, col).number_format = MONEY_FORMAT
        self._autosize(summary)

        target = self.export_dir / filename
        wb.save(target)
        return target

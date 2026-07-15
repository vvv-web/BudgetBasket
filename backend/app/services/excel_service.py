from __future__ import annotations

import re
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Any

from fastapi import HTTPException, UploadFile
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill

from app.models import EXPORTABLE_REQUEST_STATUSES
from app.repositories.base import Repository
from app.services.common import get_required, require_role
from app.services.file_service import FileService
from app.services.file_guard_client import FileGuardClient, require_valid_file
from app.services.permission_service import PermissionService
from app.services.request_service import RequestService


HEADER_FILL = PatternFill("solid", fgColor="1E3A5F")
HEADER_FONT = Font(color="FFFFFF", bold=True)
MONEY_FORMAT = '#,##0.00'

REQUEST_STATUS_LABELS = {
    "draft": "Черновик",
    "on_review": "На проверке",
    "approved": "Утверждена",
    "approved_with_changes": "Утверждена с изменениями",
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
        repo: Repository,
        permissions: PermissionService,
        requests: RequestService,
        files: FileService,
        export_dir: Path,
        file_guard: FileGuardClient,
    ):
        self.repo = repo
        self.permissions = permissions
        self.requests = requests
        self.files = files
        self.export_dir = export_dir
        self.file_guard = file_guard
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

    async def import_catalog(self, user: dict, collection: str, upload: UploadFile, *, preview: bool = False) -> dict:
        require_role(user, "admin")
        filename = (upload.filename or "").lower()
        if not filename.endswith(".xlsx"):
            raise HTTPException(status_code=400, detail="Ожидается файл Excel (.xlsx)")
        await require_valid_file(self.file_guard, upload)
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

        prepared: list[dict] = []
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

            prepared.append(
                {
                    "row": row_index,
                    "name": name,
                    "category": category_name,
                    "unit_id": unit_id,
                    "unit_name": str(row.get("unit_name") or "").strip(),
                    "is_active": self._as_bool(row.get("is_active"), True),
                }
            )

        # Импорт применяется только целиком: ошибки в любой строке не должны оставлять
        # в справочнике частично загруженные данные.
        if errors:
            return {
                "preview": preview,
                "created": 0,
                "updated": 0,
                "errors": errors,
                "rows": prepared,
                "collection": collection,
            }

        if preview:
            preview_rows = []
            created = 0
            updated = 0
            catalog = self.repo.load_all(collection)
            for item in prepared:
                parent = next(
                    (
                        entry
                        for entry in catalog
                        if item["category"]
                        and not entry.get("parent_id")
                        and entry.get("unit_id") == item["unit_id"]
                        and entry.get("name", "").strip().casefold() == item["category"].casefold()
                    ),
                    None,
                )
                existing = self._find_leaf(
                    collection,
                    name=item["name"],
                    parent_id=parent["id"] if parent else None,
                    unit_id=item["unit_id"],
                )
                action = "update" if existing else "create"
                updated += int(bool(existing))
                created += int(not existing)
                preview_rows.append({**item, "action": action})
            return {
                "preview": True,
                "created": created,
                "updated": updated,
                "errors": [],
                "rows": preview_rows,
                "collection": collection,
            }

        created = 0
        updated = 0
        for item in prepared:
            parent = None
            if item["category"]:
                parent = self._ensure_category(
                    collection,
                    category_name=item["category"],
                    unit_id=item["unit_id"],
                    is_active=True,
                )
            payload = {
                "name": item["name"],
                "parent_id": parent["id"] if parent else None,
                "unit_id": item["unit_id"],
                "is_active": item["is_active"],
            }
            existing = self._find_leaf(
                collection,
                name=item["name"],
                parent_id=payload["parent_id"],
                unit_id=item["unit_id"],
            )
            if existing:
                self.repo.update(collection, existing["id"], payload)
                updated += 1
            else:
                self.repo.create(collection, payload)
                created += 1

        return {
            "preview": False,
            "created": created,
            "updated": updated,
            "errors": [],
            "rows": prepared,
            "collection": collection,
        }

    def _unit_name(self, unit_id: str | None) -> str:
        if not unit_id:
            return ""
        unit = self.repo.get_by_id("units", unit_id)
        return unit.get("name", unit_id) if unit else unit_id

    def _department_name(self, unit_id: str | None) -> str:
        current_id = unit_id
        visited: set[str] = set()
        while current_id and current_id not in visited:
            visited.add(current_id)
            unit = self.repo.get_by_id("units", current_id)
            if not unit:
                return current_id
            if not unit.get("parent_id"):
                return unit.get("name", current_id)
            current_id = unit["parent_id"]
        return ""

    def _catalog_name(self, collection: str, item_id: str | None) -> str:
        if not item_id:
            return ""
        item = self.repo.get_by_id(collection, item_id)
        if not item:
            return item_id
        return item["name"]

    def _category_name(self, collection: str, item_id: str | None, category_id: str | None = None) -> str:
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
                        "item_id": item["id"],
                        "article": self._catalog_name(catalog, item.get(field)),
                        "category": self._category_name(catalog, item.get(field)),
                        "sum_plan": float(item.get("sum_plan") or 0),
                        "sum_fact": item.get("sum_fact"),
                        "status": ITEM_STATUS_LABELS.get(item.get("status"), item.get("status") or ""),
                        "comment": item.get("comment") or "",
                    }
                )
        return rows

    CLOSED_STATUSES = {status.value for status in EXPORTABLE_REQUEST_STATUSES} | {"rejected"}
    DEFAULT_EXPORT_STATUSES = {status.value for status in EXPORTABLE_REQUEST_STATUSES}

    def export_closed_request(self, user: dict, request_id: str) -> Path:
        request = get_required(self.repo, "requests", request_id)
        self.permissions.require_view_request(user, request)
        if request.get("status") not in self.CLOSED_STATUSES:
            raise HTTPException(status_code=400, detail="Экспорт доступен только для закрытых заявок")
        return self._write_request_workbook([request], f"request_{request_id[:8]}.xlsx")

    def export_closed_requests(
        self,
        user: dict,
        unit_id: str | None = None,
        statuses: set[str] | None = None,
        include_files: bool = False,
    ) -> Path:
        selected_statuses = self.DEFAULT_EXPORT_STATUSES if statuses is None else statuses
        if not selected_statuses or not selected_statuses.issubset(self.CLOSED_STATUSES):
            raise HTTPException(status_code=400, detail="Выберите допустимые статусы для экспорта")
        requests = [
            item
            for status in selected_statuses
            for item in self.requests.list_requests(user, status=status, unit_id=unit_id)
        ]
        if not requests:
            raise HTTPException(status_code=404, detail="Нет закрытых заявок для экспорта")
        suffix = re.sub(r"[^a-zA-Z0-9_-]+", "", unit_id or "all")[:24] or "all"
        attachments = self._collect_export_attachments(requests) if include_files else []
        workbook = self._write_request_workbook(requests, "Утверждение_бюджета.xlsx", attachments)
        if not include_files:
            return workbook
        return self._write_export_archive(user, workbook, attachments)

    # Compat aliases
    def export_fixed_request(self, user: dict, request_id: str) -> Path:
        return self.export_closed_request(user, request_id)

    def export_fixed_requests(self, user: dict, unit_id: str | None = None) -> Path:
        return self.export_closed_requests(user, unit_id)

    def _collect_export_attachments(self, requests: list[dict]) -> list[dict]:
        request_ids = {item["id"] for item in requests}
        requests_by_id = {item["id"]: item for item in requests}
        items = {
            "dds": {item["id"]: item for item in self.repo.load_all("dds_items") if item.get("request_id") in request_ids},
            "invest": {item["id"]: item for item in self.repo.load_all("invest_items") if item.get("request_id") in request_ids},
        }
        links = {
            "dds": self.repo.load_all("dds_item_files"),
            "invest": self.repo.load_all("invest_item_files"),
        }
        files = {item["id"]: item for item in self.repo.load_all("files")}
        catalogs = {
            "dds": {item["id"]: item for item in self.repo.load_all("dds_catalog")},
            "invest": {item["id"]: item for item in self.repo.load_all("invests_catalog")},
        }
        attachments = []
        written: set[str] = set()
        for kind, item_map in items.items():
            item_key = "dds_item_id" if kind == "dds" else "invest_item_id"
            article_key = "dds_id" if kind == "dds" else "invest_id"
            for link in links[kind]:
                item = item_map.get(link.get(item_key))
                file = files.get(link.get("file_id"))
                if not item or not file:
                    continue
                request = requests_by_id[item["request_id"]]
                module_name = self._archive_name(self._unit_name(request.get("unit_id")), "Модуль")
                article = catalogs[kind].get(item.get(article_key), {})
                article_name = self._archive_name(article.get("name"), "Статья")
                original_name = self._archive_name(file["original_name"], "Файл")
                archive_path = f"Приложения/{module_name}/{article_name}/{original_name}"
                duplicate_index = 2
                base_path = archive_path
                while archive_path in written:
                    archive_path = f"{base_path}_{duplicate_index}"
                    duplicate_index += 1
                written.add(archive_path)
                attachments.append(
                    {
                        "file_id": file["id"],
                        "item_id": item["id"],
                        "module_name": module_name,
                        "article_name": article_name,
                        "original_name": original_name,
                        "archive_path": archive_path,
                    }
                )
        return attachments

    def _write_export_archive(self, user: dict, workbook: Path, attachments: list[dict]) -> Path:
        archive = self.export_dir / "Утверждение_бюджета.zip"

        with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
            bundle.write(workbook, arcname="Утверждение_бюджета.xlsx")
            for attachment in attachments:
                body, _file, _storage, _size, _content_type = self.files.download(user, attachment["file_id"])
                try:
                    content = body.read()
                finally:
                    close = getattr(body, "close", None)
                    if callable(close):
                        close()
                bundle.writestr(attachment["archive_path"], content)
        return archive

    @staticmethod
    def _archive_name(value: Any, fallback: str) -> str:
        name = re.sub(r'[\\/:*?"<>|\x00-\x1f]+', "_", str(value or "").strip()).strip(". ")
        return name or fallback

    def _write_request_workbook(self, requests: list[dict], filename: str, attachments: list[dict] | None = None) -> Path:
        wb = Workbook()
        attachments_by_item: dict[str, list[dict]] = {}
        for attachment in attachments or []:
            attachments_by_item.setdefault(attachment["item_id"], []).append(attachment)
        max_attachments = max((len(items) for items in attachments_by_item.values()), default=0)
        attachment_headers = [f"Приложение {index}" for index in range(1, max_attachments + 1)]

        composition = wb.active
        composition.title = "Состав"
        self._style_header(
            composition,
            [
                "Подразделение",
                "Модуль",
                "Статус заявки",
                "Тип",
                "Категория",
                "Статья / проект",
                "ID заявки",
                "План",
                "Факт",
                "Статус строки",
                "Комментарий",
                *attachment_headers,
            ],
        )
        for request in requests:
            module_name = self._unit_name(request.get("unit_id"))
            department_name = self._department_name(request.get("unit_id"))
            request_status = REQUEST_STATUS_LABELS.get(request.get("status"), request.get("status") or "")
            items = self._request_items(request["id"])
            if not items:
                composition.append(
                    [
                        department_name,
                        module_name,
                        request_status,
                        "",
                        "",
                        "Строки отсутствуют",
                        request["id"],
                        0,
                        None,
                        "",
                        "",
                        *([""] * max_attachments),
                    ]
                )
                continue
            for item in items:
                row_attachments = attachments_by_item.get(item["item_id"], [])
                composition.append(
                    [
                        department_name,
                        module_name,
                        request_status,
                        item["kind"],
                        item["category"],
                        item["article"],
                        request["id"],
                        item["sum_plan"],
                        item["sum_fact"],
                        item["status"],
                        item["comment"],
                        *[attachment["original_name"] for attachment in row_attachments],
                        *([""] * (max_attachments - len(row_attachments))),
                    ]
                )
                for index, attachment in enumerate(row_attachments, start=12):
                    file_cell = composition.cell(composition.max_row, index)
                    file_cell.hyperlink = attachment["archive_path"]
                    file_cell.style = "Hyperlink"
        for col in (8, 9):
            for row in range(2, composition.max_row + 1):
                composition.cell(row, col).number_format = MONEY_FORMAT
        self._autosize(composition)
        composition.auto_filter.ref = f"A1:F{composition.max_row}"
        composition.freeze_panes = "A2"

        target = self.export_dir / filename
        wb.save(target)
        return target

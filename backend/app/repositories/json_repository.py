import json
import os
import tempfile
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import HTTPException


class JsonRepository:
    def __init__(self, base_dir: str | Path):
        self.base_dir = Path(base_dir)
        self.base_dir.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def new_id() -> str:
        return str(uuid4())

    def collection_path(self, collection_name: str) -> Path:
        safe = collection_name.removesuffix(".json")
        return self.base_dir / f"{safe}.json"

    def load_all(self, collection_name: str) -> list[dict[str, Any]]:
        path = self.collection_path(collection_name)
        if not path.exists():
            self.save_all(collection_name, [])
            return []
        try:
            with path.open("r", encoding="utf-8") as source:
                data = json.load(source)
        except json.JSONDecodeError as exc:
            raise HTTPException(status_code=500, detail=f"Поврежден JSON-файл {path.name}") from exc
        if not isinstance(data, list):
            raise HTTPException(status_code=500, detail=f"JSON-файл {path.name} должен содержать массив")
        return data

    def save_all(self, collection_name: str, data: list[dict[str, Any]]) -> None:
        path = self.collection_path(collection_name)
        path.parent.mkdir(parents=True, exist_ok=True)
        fd, temp_name = tempfile.mkstemp(prefix=f".{path.stem}.", suffix=".tmp", dir=str(path.parent))
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as target:
                json.dump(data, target, ensure_ascii=False, indent=2)
                target.write("\n")
            os.replace(temp_name, path)
        finally:
            if os.path.exists(temp_name):
                os.remove(temp_name)

    def get_by_id(self, collection_name: str, item_id: str) -> dict[str, Any] | None:
        return next((item for item in self.load_all(collection_name) if str(item.get("id")) == str(item_id)), None)

    def create(self, collection_name: str, item: dict[str, Any]) -> dict[str, Any]:
        items = self.load_all(collection_name)
        item = {**item}
        item.setdefault("id", self.new_id())
        items.append(item)
        self.save_all(collection_name, items)
        return item

    def update(self, collection_name: str, item_id: str, patch: dict[str, Any]) -> dict[str, Any]:
        items = self.load_all(collection_name)
        for index, item in enumerate(items):
            if str(item.get("id")) == str(item_id):
                updated = {**item, **patch}
                items[index] = updated
                self.save_all(collection_name, items)
                return updated
        raise HTTPException(status_code=404, detail="Запись не найдена")

    def delete(self, collection_name: str, item_id: str) -> None:
        items = self.load_all(collection_name)
        kept = [item for item in items if str(item.get("id")) != str(item_id)]
        if len(kept) == len(items):
            raise HTTPException(status_code=404, detail="Запись не найдена")
        self.save_all(collection_name, kept)

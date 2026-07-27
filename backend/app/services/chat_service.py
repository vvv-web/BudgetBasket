from fastapi import HTTPException

from app.models import RequestStatus
from app.repositories.base import Repository
from app.services.common import get_required
from app.services.permission_service import PermissionService
from app.services.request_service import RequestService


class ChatService:
    def __init__(self, repo: Repository, permissions: PermissionService, requests: RequestService):
        self.repo = repo
        self.permissions = permissions
        self.requests = requests

    def _participant_ids(self, request: dict, *, repo: Repository | None = None) -> set[str]:
        storage = repo or self.repo
        users = {item["id"]: item for item in storage.load_all("users")}
        employee_ids = {
            item["user_id"] for item in storage.load_all("units_responsibles")
            if item.get("unit_id") == request["unit_id"] and item.get("is_active") and users.get(item.get("user_id"), {}).get("role") == "employee"
        }
        return employee_ids | ({request["economist_id"]} if request.get("economist_id") else set())

    def notification_recipient_ids(self, request_id: str, sender_id: str) -> set[str]:
        request = get_required(self.repo, "requests", request_id)
        self._require_chat_available(request)
        return self._participant_ids(request) - {sender_id}

    def _require_chat_available(self, request: dict) -> None:
        if request.get("status") == RequestStatus.draft and not any(
            chat.get("req_id") == request["id"] for chat in self.repo.load_all("req_chats")
        ):
            raise HTTPException(status_code=400, detail="Чат становится доступен после отправки заявки на рассмотрение")

    def _chat(self, request: dict, *, repo: Repository | None = None) -> dict:
        storage = repo or self.repo
        chat = next((item for item in storage.load_all("req_chats") if item.get("req_id") == request["id"]), None)
        if chat:
            return chat
        chat = storage.create("req_chats", {"req_id": request["id"]})
        for user_id in self._participant_ids(request, repo=storage):
            storage.insert("chats_participants", {"chat_id": chat["id"], "user_id": user_id})
        return chat

    def _require_participant(self, user: dict, request: dict, chat: dict) -> None:
        if user["role"] == "admin":
            return
        if not any(row.get("chat_id") == chat["id"] and row.get("user_id") == user["id"] for row in self.repo.load_all("chats_participants")):
            raise HTTPException(status_code=403, detail="Чатом могут пользоваться только сотрудник и назначенный экономист")

    def get_chat(self, user: dict, request_id: str) -> dict:
        request = get_required(self.repo, "requests", request_id)
        self._require_chat_available(request)
        if user["role"] != "admin" and user["id"] not in self._participant_ids(request):
            raise HTTPException(status_code=403, detail="Нет доступа к чату этой заявки")
        chat = self._chat(request)
        self._require_participant(user, request, chat)
        users = {item["id"]: item for item in self.repo.load_all("users")}
        profiles = {item["user_id"]: item for item in self.repo.load_all("profiles")}
        messages = []
        for message in self.repo.load_all("chat_messages"):
            if message.get("chat_id") != chat["id"]:
                continue
            sender_id = message.get("sender_id")
            sender = users.get(sender_id, {})
            messages.append({
                **message,
                "sender": (
                    {"id": sender.get("id"), "login": sender.get("login"), "role": sender.get("role"), "profile": profiles.get(sender_id)}
                    if sender_id else None
                ),
            })
        messages.sort(key=lambda item: str(item.get("created_at") or ""))
        participants = [row for row in self.repo.load_all("chats_participants") if row.get("chat_id") == chat["id"]]
        return {"id": chat["id"], "request_id": request_id, "participants": participants, "messages": messages}

    def list_chats(self, user: dict) -> list[dict]:
        requests = {item["id"]: item for item in self.repo.load_all("requests")}
        chats_by_request = {item["req_id"]: item for item in self.repo.load_all("req_chats")}
        users = {item["id"]: item for item in self.repo.load_all("users")}
        profiles = {item["user_id"]: item for item in self.repo.load_all("profiles")}
        units = {item["id"]: item for item in self.repo.load_all("units")}
        participants_by_chat: dict[str, list[dict]] = {}
        for participant in self.repo.load_all("chats_participants"):
            participants_by_chat.setdefault(participant["chat_id"], []).append(participant)
        messages_by_chat: dict[str, list[dict]] = {}
        for message in self.repo.load_all("chat_messages"):
            messages_by_chat.setdefault(message["chat_id"], []).append(message)

        result = []
        for request_id, request in requests.items():
            if request.get("status") == RequestStatus.draft and request_id not in chats_by_request:
                continue
            if user["role"] != "admin" and user["id"] not in self._participant_ids(request):
                continue
            chat = chats_by_request.get(request_id)
            if not chat:
                continue
            messages = sorted(messages_by_chat.get(chat["id"], []), key=lambda item: str(item.get("created_at") or ""))
            participant = next((item for item in participants_by_chat.get(chat["id"], []) if item.get("user_id") == user["id"]), None)
            last_read_id = participant.get("last_read_message_id") if participant else None
            last_read_index = next((index for index, item in enumerate(messages) if item["id"] == last_read_id), -1)
            unread_count = sum(1 for item in messages[last_read_index + 1 :] if item.get("sender_id") != user["id"])
            last_message = messages[-1] if messages else None
            result.append(
                {
                    "id": chat["id"],
                    "request_id": request_id,
                    "request_status": request.get("status"),
                    "unit_name": units.get(request.get("unit_id"), {}).get("name", "Подразделение не указано"),
                    "unread_count": unread_count,
                    "last_message": (
                        {
                            **last_message,
                            "sender": (
                                {
                                    "id": users.get(last_message["sender_id"], {}).get("id"),
                                    "login": users.get(last_message["sender_id"], {}).get("login"),
                                    "role": users.get(last_message["sender_id"], {}).get("role"),
                                    "profile": profiles.get(last_message["sender_id"]),
                                }
                                if last_message.get("sender_id") else None
                            ),
                        }
                        if last_message
                        else None
                    ),
                }
            )
        return sorted(result, key=lambda item: str((item["last_message"] or {}).get("created_at") or ""), reverse=True)

    def send(self, user: dict, request_id: str, payload: dict) -> dict:
        request = get_required(self.repo, "requests", request_id)
        self._require_chat_available(request)
        chat = self._chat(request)
        self._require_participant(user, request, chat)
        if user["role"] == "admin":
            raise HTTPException(status_code=403, detail="Администратор не может писать в чате заявки")
        text = payload["text"].strip()
        if not text:
            raise HTTPException(status_code=400, detail="Сообщение не может быть пустым")
        reply_to = payload.get("reply_to")
        if reply_to:
            reply = get_required(self.repo, "chat_messages", reply_to)
            if reply.get("chat_id") != chat["id"]:
                raise HTTPException(status_code=400, detail="Сообщение для ответа относится к другому чату")
        message = self.repo.create("chat_messages", {"chat_id": chat["id"], "reply_to": reply_to, "sender_id": user["id"], "text": text})
        self.repo.update_where("chats_participants", {"chat_id": chat["id"], "user_id": user["id"]}, {"last_read_message_id": message["id"]})
        self.requests.log(user, request_id, "chat_message_sent", entity="chat_message", entity_id=message["id"], after={"text": text})
        return message

    def send_return_to_employee_system_message(self, user: dict, request_id: str, comment: str, *, repo: Repository | None = None) -> dict:
        """Persist the economist's return comment as an automatic chat notification."""
        storage = repo or self.repo
        request = get_required(storage, "requests", request_id)
        chat = self._chat(request, repo=storage)
        message = storage.create(
            "chat_messages",
            {
                "chat_id": chat["id"],
                "reply_to": None,
                "sender_id": None,
                "text": f"Экономист вернул заявку на доработку.\nКомментарий: {comment}",
                "is_system": True,
            },
        )
        storage.update_where(
            "chats_participants",
            {"chat_id": chat["id"], "user_id": user["id"]},
            {"last_read_message_id": message["id"]},
        )
        self.requests.log(
            user,
            request_id,
            "system_message_sent",
            entity="chat_message",
            entity_id=message["id"],
            after={"text": message["text"]},
            repo=storage,
        )
        return message

    def mark_read(self, user: dict, request_id: str, message_id: str | None) -> dict:
        request = get_required(self.repo, "requests", request_id)
        self._require_chat_available(request)
        chat = self._chat(request)
        self._require_participant(user, request, chat)
        if message_id:
            message = get_required(self.repo, "chat_messages", message_id)
            if message.get("chat_id") != chat["id"]:
                raise HTTPException(status_code=400, detail="Сообщение относится к другому чату")
        self.repo.update_where("chats_participants", {"chat_id": chat["id"], "user_id": user["id"]}, {"last_read_message_id": message_id})
        return {"ok": True}

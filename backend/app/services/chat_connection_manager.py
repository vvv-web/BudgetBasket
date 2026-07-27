import asyncio

from fastapi import WebSocket


class ChatConnectionManager:
    def __init__(self) -> None:
        self._request_connections: dict[str, set[WebSocket]] = {}
        self._user_connections: dict[str, set[WebSocket]] = {}

    async def connect(self, request_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._request_connections.setdefault(request_id, set()).add(websocket)

    async def connect_user(self, user_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._user_connections.setdefault(user_id, set()).add(websocket)

    def disconnect(self, request_id: str, websocket: WebSocket) -> None:
        self._disconnect(self._request_connections, request_id, websocket)

    def disconnect_user(self, user_id: str, websocket: WebSocket) -> None:
        self._disconnect(self._user_connections, user_id, websocket)

    @staticmethod
    def _disconnect(connections_by_key: dict[str, set[WebSocket]], key: str, websocket: WebSocket) -> None:
        connections = connections_by_key.get(key)
        if not connections:
            return
        connections.discard(websocket)
        if not connections:
            connections_by_key.pop(key, None)

    async def broadcast(self, request_id: str, event: dict) -> None:
        await self._broadcast(self._request_connections, request_id, event)

    async def broadcast_user(self, user_id: str, event: dict) -> None:
        await self._broadcast(self._user_connections, user_id, event)

    async def _broadcast(self, connections_by_key: dict[str, set[WebSocket]], key: str, event: dict) -> None:
        connections = tuple(connections_by_key.get(key, set()))
        if not connections:
            return
        results = await asyncio.gather(*(websocket.send_json(event) for websocket in connections), return_exceptions=True)
        for websocket, result in zip(connections, results, strict=True):
            if isinstance(result, Exception):
                self._disconnect(connections_by_key, key, websocket)

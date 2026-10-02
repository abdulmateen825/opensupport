import asyncio
from collections import defaultdict

from fastapi import WebSocket


class ConnectionManager:
    """Single-process WebSocket fanout; move coordination to Redis for multiple workers."""

    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._agents: dict[str, set[WebSocket]] = defaultdict(set)
        self._socket_agents: dict[WebSocket, str] = {}
        self._lock = asyncio.Lock()

    async def connect(self, key: str, websocket: WebSocket, agent_name: str | None = None) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[key].add(websocket)
            if agent_name:
                self._agents[agent_name].add(websocket)
                self._socket_agents[websocket] = agent_name

    async def disconnect(self, key: str, websocket: WebSocket, agent_name: str | None = None) -> None:
        async with self._lock:
            self._connections[key].discard(websocket)
            if not self._connections[key]:
                self._connections.pop(key, None)
            stored_agent = self._socket_agents.pop(websocket, None)
            agent_name = agent_name or stored_agent
            if agent_name:
                self._agents[agent_name].discard(websocket)
                if not self._agents[agent_name]:
                    self._agents.pop(agent_name, None)

    async def broadcast(self, key: str, event: dict) -> None:
        async with self._lock:
            sockets = list(self._connections.get(key, set()))
        stale: list[WebSocket] = []
        for socket in sockets:
            try:
                await socket.send_json(event)
            except Exception:
                stale.append(socket)
        for socket in stale:
            await self.disconnect(key, socket, self._socket_agents.get(socket))

    async def online_agents(self, organization_id: str | None = None) -> list[str]:
        async with self._lock:
            keys = list(self._agents)
        if organization_id:
            prefix = f"{organization_id}:"
            keys = [key for key in keys if key.startswith(prefix)]
            return sorted(key.split(":", 2)[2] for key in keys)
        return sorted(keys)


hub = ConnectionManager()


async def publish_conversation(conversation_id: str, event: dict) -> None:
    envelope = {"conversation_id": conversation_id, **event}
    await hub.broadcast(f"conversation:{conversation_id}", envelope)
    if event.get("type") == "conversation.escalated" and event.get("organization_id"):
        await hub.broadcast(f"agents:{event['organization_id']}", envelope)

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi import WebSocket, WebSocketDisconnect

from backend.app.api.routes import router
from backend.app.core.config import settings
from backend.app.db.session import engine
from backend.app.models import Base
from backend.app.websocket.manager import hub, publish_conversation


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Convenient for this local MVP; use Alembic migrations for deployed environments.
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        # Additive, idempotent local migration for databases created by the previous MVP slice.
        await connection.exec_driver_sql(
            "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assigned_agent VARCHAR(120), "
            "ADD COLUMN IF NOT EXISTS escalation_reason VARCHAR(240), "
            "ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ, "
            "ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ"
        )
        await connection.exec_driver_sql(
            "ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_name VARCHAR(120)"
        )
    yield
    await engine.dispose()


app = FastAPI(title="OpenSupport API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.websocket("/ws/conversations/{conversation_id}")
async def conversation_socket(websocket: WebSocket, conversation_id: str):
    key = f"conversation:{conversation_id}"
    await hub.connect(key, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await hub.disconnect(key, websocket)


@app.websocket("/ws/agents")
async def agent_socket(websocket: WebSocket, agent_name: str = "Support Agent"):
    agent_name = agent_name.strip()[:120] or "Support Agent"
    await hub.connect("agents", websocket, agent_name)
    await hub.broadcast("agents", {"type": "agent.presence", "agent_name": agent_name, "online": True})
    try:
        await websocket.send_json({"type": "agent.presence", "online_agents": await hub.online_agents()})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await hub.disconnect("agents", websocket, agent_name)
        if agent_name in await hub.online_agents():
            return
        await hub.broadcast("agents", {"type": "agent.presence", "agent_name": agent_name, "online": False})

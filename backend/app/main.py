from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi import WebSocket, WebSocketDisconnect
from uuid import UUID
from redis.asyncio import Redis
from sqlalchemy import text

from backend.app.api.auth import org_router, router as auth_router
from backend.app.api.routes import _verify_widget_origin, router
from backend.app.core.config import settings
from backend.app.core.security import decode_token
from backend.app.db.session import engine, SessionLocal
from backend.app.models import Base, Conversation, Project, User
from backend.app.websocket.manager import hub
from backend.app.middleware.rate_limit import TenantRateLimitMiddleware, rate_limit_redis
from backend.app.middleware.cors import WidgetAwareCORSMiddleware


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.app_env.lower() not in {"production", "prod"}:
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.create_all)
            legacy_org = "00000000-0000-0000-0000-000000000001"
            await connection.exec_driver_sql(
                "ALTER TABLE projects ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE, "
                "ADD COLUMN IF NOT EXISTS allowed_domains JSONB NOT NULL DEFAULT '[]'::jsonb"
            )
            await connection.exec_driver_sql(
                "INSERT INTO organizations (id, name, retention_days, created_at) "
                f"SELECT '{legacy_org}', 'Legacy workspace', 365, now() "
                "WHERE EXISTS (SELECT 1 FROM projects WHERE organization_id IS NULL) "
                "ON CONFLICT (id) DO NOTHING"
            )
            await connection.exec_driver_sql(
                f"UPDATE projects SET organization_id = '{legacy_org}' WHERE organization_id IS NULL"
            )
            await connection.exec_driver_sql("ALTER TABLE projects ALTER COLUMN organization_id SET NOT NULL")
            # Local additive upgrade path for databases from earlier project slices.
            await connection.exec_driver_sql(
                "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS assigned_agent VARCHAR(120), "
                "ADD COLUMN IF NOT EXISTS escalation_reason VARCHAR(240), "
                "ADD COLUMN IF NOT EXISTS escalated_at TIMESTAMPTZ, "
                "ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ"
            )
            await connection.exec_driver_sql("ALTER TABLE messages ADD COLUMN IF NOT EXISTS sender_name VARCHAR(120)")
            await connection.exec_driver_sql("ALTER TABLE knowledge_sources ADD COLUMN IF NOT EXISTS last_indexed_at TIMESTAMPTZ")
            await connection.exec_driver_sql(
                "ALTER TABLE conversations ADD COLUMN IF NOT EXISTS visitor_id VARCHAR(160), "
                "ADD COLUMN IF NOT EXISTS visitor_verified BOOLEAN NOT NULL DEFAULT FALSE"
            )
    yield
    await rate_limit_redis.aclose()
    await engine.dispose()


app = FastAPI(title="OpenSupport API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    WidgetAwareCORSMiddleware,
    admin_origins=settings.allowed_origins,
)
app.add_middleware(TenantRateLimitMiddleware)
app.include_router(router)
app.include_router(auth_router)
app.include_router(org_router)


@app.get("/health")
async def health():
    async with engine.connect() as connection:
        await connection.execute(text("SELECT 1"))
    redis = Redis.from_url(settings.redis_url)
    try:
        await redis.ping()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Redis is unavailable") from exc
    finally:
        await redis.aclose()
    return {"status": "ok", "database": "ok", "redis": "ok"}


@app.websocket("/ws/conversations/{conversation_id}")
async def conversation_socket(websocket: WebSocket, conversation_id: str, access_token: str | None = None):
    try:
        conversation_uuid = UUID(conversation_id)
    except ValueError:
        await websocket.close(code=1008)
        return
    async with SessionLocal() as session:
        conversation = await session.get(Conversation, conversation_uuid)
        if conversation is None:
            await websocket.close(code=1008)
            return
        project = await session.get(Project, conversation.project_id)
        if access_token:
            try:
                claims = decode_token(access_token, "access")
                user = await session.get(User, UUID(claims["sub"]))
                if user is None or not user.is_active or user.token_version != claims.get("ver") or user.organization_id != project.organization_id:
                    await websocket.close(code=1008)
                    return
            except HTTPException:
                await websocket.close(code=1008)
                return
        else:
            try:
                _verify_widget_origin(project, origin_value=websocket.headers.get("origin"))
            except HTTPException:
                await websocket.close(code=1008)
                return
    key = f"conversation:{conversation_id}"
    await hub.connect(key, websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await hub.disconnect(key, websocket)


@app.websocket("/ws/agents")
async def agent_socket(websocket: WebSocket, access_token: str | None = None):
    if not access_token:
        await websocket.close(code=1008)
        return
    try:
        claims = decode_token(access_token, "access")
        async with SessionLocal() as session:
            user = await session.get(User, UUID(claims["sub"]))
            if user is None or not user.is_active or user.token_version != claims.get("ver"):
                await websocket.close(code=1008)
                return
            organization_id = str(user.organization_id)
            user_id = str(user.id)
            display_name = user.display_name
    except (HTTPException, ValueError, KeyError):
        await websocket.close(code=1008)
        return
    agent_key = f"{organization_id}:{user_id}:{display_name}"
    channel = f"agents:{organization_id}"
    await hub.connect(channel, websocket, agent_key)
    await hub.broadcast(channel, {"type": "agent.presence", "agent_name": display_name, "online": True})
    try:
        await websocket.send_json({"type": "agent.presence", "online_agents": await hub.online_agents(organization_id)})
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await hub.disconnect(channel, websocket, agent_key)
        if display_name in await hub.online_agents(organization_id):
            return
        await hub.broadcast(channel, {"type": "agent.presence", "agent_name": display_name, "online": False})

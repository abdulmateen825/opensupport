from datetime import datetime, timedelta, timezone
import hashlib
import secrets
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import settings
from backend.app.core.security import decode_token, encode_token, get_current_user, hash_password, require_roles, verify_password
from backend.app.db.session import get_session
from backend.app.models import (
    APIKey, AnalyticsEvent, AuditEvent, Conversation, KnowledgeEntry, KnowledgeSource,
    Message, Organization, Project, User,
)
from backend.app.schemas import (
    APIKeyCreate, APIKeyCreated, APIKeyOut, LoginRequest, MemberCreate, RefreshRequest,
    RegisterRequest, RetentionOut, RetentionUpdate, TokenResponse, UserOut,
)

router = APIRouter(prefix="/api/auth", tags=["authentication"])
org_router = APIRouter(prefix="/api/organization", tags=["organization"])
LEGACY_ORGANIZATION_ID = UUID("00000000-0000-0000-0000-000000000001")


def _tokens(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=encode_token(user, "access", settings.access_token_minutes * 60),
        refresh_token=encode_token(user, "refresh", settings.refresh_token_days * 86400),
        expires_in=settings.access_token_minutes * 60,
        user=UserOut.model_validate(user),
    )


@router.post("/register", response_model=TokenResponse, status_code=201)
async def register(body: RegisterRequest, session: AsyncSession = Depends(get_session)):
    email = body.email.strip().lower()
    exists = await session.scalar(select(User.id).where(func.lower(User.email) == email))
    if exists:
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    organization = Organization(name=body.organization_name.strip())
    user = User(
        organization=organization,
        email=email,
        display_name=body.display_name.strip(),
        password_hash=hash_password(body.password),
        role="owner",
    )
    session.add_all([organization, user])
    await session.flush()
    # Projects from the single-tenant starter version are claimed by the first
    # registered organization so existing local data stays available.
    legacy = await session.get(Organization, LEGACY_ORGANIZATION_ID)
    if legacy:
        await session.execute(
            Project.__table__.update().where(Project.organization_id == LEGACY_ORGANIZATION_ID)
            .values(organization_id=organization.id)
        )
        await session.delete(legacy)
    session.add(AuditEvent(
        organization_id=organization.id, actor_id=user.id, action="organization.registered",
        target_type="organization", target_id=str(organization.id), details={},
    ))
    await session.commit()
    await session.refresh(user)
    return _tokens(user)


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, session: AsyncSession = Depends(get_session)):
    user = await session.scalar(select(User).where(func.lower(User.email) == body.email.strip().lower()))
    if user is None or not user.is_active or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Email or password is incorrect")
    return _tokens(user)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest, session: AsyncSession = Depends(get_session)):
    claims = decode_token(body.refresh_token, "refresh")
    user = await session.get(User, UUID(claims["sub"]))
    if user is None or not user.is_active or user.token_version != claims.get("ver"):
        raise HTTPException(status_code=401, detail="Refresh token has been revoked")
    return _tokens(user)


@router.post("/logout", status_code=204)
async def logout(user: User = Depends(get_current_user), session: AsyncSession = Depends(get_session)):
    user.token_version += 1
    await session.commit()


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(get_current_user)):
    return user


@org_router.get("/members", response_model=list[UserOut])
async def list_members(
    user: User = Depends(require_roles("owner", "admin")),
    session: AsyncSession = Depends(get_session),
):
    return list((await session.scalars(
        select(User).where(User.organization_id == user.organization_id).order_by(User.created_at)
    )).all())


@org_router.post("/members", response_model=UserOut, status_code=201)
async def create_member(
    body: MemberCreate,
    user: User = Depends(require_roles("owner", "admin")),
    session: AsyncSession = Depends(get_session),
):
    email = body.email.strip().lower()
    if await session.scalar(select(User.id).where(func.lower(User.email) == email)):
        raise HTTPException(status_code=409, detail="An account with this email already exists")
    member = User(
        organization_id=user.organization_id, email=email, display_name=body.display_name.strip(),
        password_hash=hash_password(body.password), role=body.role,
    )
    session.add(member)
    await session.flush()
    session.add(AuditEvent(
        organization_id=user.organization_id, actor_id=user.id, action="member.created",
        target_type="user", target_id=str(member.id), details={"role": member.role},
    ))
    await session.commit()
    await session.refresh(member)
    return member


@org_router.post("/api-keys", response_model=APIKeyCreated, status_code=201)
async def create_api_key(
    body: APIKeyCreate,
    user: User = Depends(require_roles("owner", "admin")),
    session: AsyncSession = Depends(get_session),
):
    secret = "osk_live_" + secrets.token_urlsafe(36)
    expires_at = datetime.now(timezone.utc) + timedelta(days=body.expires_in_days) if body.expires_in_days else None
    key = APIKey(
        organization_id=user.organization_id,
        created_by_id=user.id,
        name=body.name.strip(),
        key_prefix=secret[:18],
        key_hash=hashlib.sha256(secret.encode()).hexdigest(),
        expires_at=expires_at,
    )
    session.add(key)
    await session.flush()
    session.add(AuditEvent(
        organization_id=user.organization_id, actor_id=user.id, action="api_key.created",
        target_type="api_key", target_id=str(key.id), details={"name": key.name},
    ))
    await session.commit()
    await session.refresh(key)
    return APIKeyCreated(
        id=key.id, name=key.name, key_prefix=key.key_prefix, expires_at=key.expires_at,
        last_used_at=key.last_used_at, revoked_at=key.revoked_at, created_at=key.created_at,
        secret=secret,
    )


@org_router.get("/api-keys", response_model=list[APIKeyOut])
async def list_api_keys(
    user: User = Depends(require_roles("owner", "admin")), session: AsyncSession = Depends(get_session),
):
    return list((await session.scalars(select(APIKey).where(
        APIKey.organization_id == user.organization_id,
    ).order_by(APIKey.created_at.desc()))).all())


@org_router.delete("/api-keys/{key_id}", status_code=204)
async def revoke_api_key(
    key_id: UUID,
    user: User = Depends(require_roles("owner", "admin")), session: AsyncSession = Depends(get_session),
):
    key = await session.scalar(select(APIKey).where(
        APIKey.id == key_id, APIKey.organization_id == user.organization_id,
    ))
    if key is None:
        raise HTTPException(status_code=404, detail="API key not found")
    key.revoked_at = datetime.now(timezone.utc)
    session.add(AuditEvent(
        organization_id=user.organization_id, actor_id=user.id, action="api_key.revoked",
        target_type="api_key", target_id=str(key.id), details={},
    ))
    await session.commit()


@org_router.post("/retention/prune", status_code=200)
async def prune_retained_data(
    user: User = Depends(require_roles("owner")),
    session: AsyncSession = Depends(get_session),
):
    organization = await session.get(Organization, user.organization_id)
    cutoff_at = datetime.now(timezone.utc) - timedelta(days=organization.retention_days)
    project_ids = select(Project.id).where(Project.organization_id == user.organization_id)
    result = await session.execute(
        Conversation.__table__.delete().where(
            Conversation.project_id.in_(project_ids), Conversation.created_at < cutoff_at,
        )
    )
    await session.execute(
        AnalyticsEvent.__table__.delete().where(
            AnalyticsEvent.project_id.in_(project_ids), AnalyticsEvent.created_at < cutoff_at,
        )
    )
    session.add(AuditEvent(
        organization_id=user.organization_id, actor_id=user.id, action="retention.pruned",
        target_type="organization", target_id=str(user.organization_id), details={"conversations_deleted": result.rowcount or 0},
    ))
    await session.commit()
    return {"conversations_deleted": result.rowcount or 0, "older_than": cutoff_at.isoformat()}


@org_router.get("/retention", response_model=RetentionOut)
async def get_retention(
    user: User = Depends(require_roles("owner", "admin")), session: AsyncSession = Depends(get_session),
):
    organization = await session.get(Organization, user.organization_id)
    return RetentionOut(retention_days=organization.retention_days)


@org_router.patch("/retention", status_code=204)
async def set_retention(
    body: RetentionUpdate,
    user: User = Depends(require_roles("owner", "admin")),
    session: AsyncSession = Depends(get_session),
):
    organization = await session.get(Organization, user.organization_id)
    organization.retention_days = body.retention_days
    session.add(AuditEvent(
        organization_id=user.organization_id, actor_id=user.id, action="retention.updated",
        target_type="organization", target_id=str(user.organization_id), details={"retention_days": body.retention_days},
    ))
    await session.commit()


@org_router.get("/export")
async def export_organization(
    user: User = Depends(require_roles("owner")), session: AsyncSession = Depends(get_session),
):
    project_rows = list((await session.scalars(select(Project).where(
        Project.organization_id == user.organization_id,
    ))).all())
    project_ids = [project.id for project in project_rows]
    conversation_rows = list((await session.scalars(select(Conversation).where(
        Conversation.project_id.in_(project_ids),
    ))).all()) if project_ids else []
    conversation_ids = [conversation.id for conversation in conversation_rows]
    message_rows = list((await session.scalars(select(Message).where(
        Message.conversation_id.in_(conversation_ids),
    ))).all()) if conversation_ids else []
    knowledge_rows = list((await session.scalars(select(KnowledgeEntry).where(
        KnowledgeEntry.project_id.in_(project_ids),
    ))).all()) if project_ids else []
    source_rows = list((await session.scalars(select(KnowledgeSource).where(
        KnowledgeSource.project_id.in_(project_ids),
    ))).all()) if project_ids else []
    return {
        "organization": {"id": str(user.organization_id)},
        "projects": [{"id": str(p.id), "name": p.name, "allowed_domains": p.allowed_domains} for p in project_rows],
        "knowledge": [{"id": str(k.id), "project_id": str(k.project_id), "title": k.title, "content": k.content} for k in knowledge_rows],
        "sources": [{"id": str(s.id), "project_id": str(s.project_id), "kind": s.kind, "title": s.title, "source_url": s.source_url, "status": s.status} for s in source_rows],
        "conversations": [{"id": str(c.id), "project_id": str(c.project_id), "status": c.status, "created_at": c.created_at.isoformat()} for c in conversation_rows],
        "messages": [{"id": str(m.id), "conversation_id": str(m.conversation_id), "sender_type": m.sender_type, "content": m.content, "created_at": m.created_at.isoformat()} for m in message_rows],
    }

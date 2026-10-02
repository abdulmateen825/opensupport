import asyncio
import logging
import httpx
import re
import secrets
from datetime import datetime, timezone
from urllib.parse import quote, urlparse
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, File, HTTPException, Request, UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.db.session import get_session
from backend.app.core.config import settings
from backend.app.core.security import require_roles, verify_widget_identity
from backend.app.models import (
    AnalyticsEvent, AuditEvent, Conversation, Integration, KnowledgeEntry,
    KnowledgeSource, Message, Project, User, WebhookDelivery, WebhookEndpoint,
)
from backend.app.schemas import (
    ConversationOut,
    ConversationStatusUpdate,
    AgentMessageCreate,
    KnowledgeCreate,
    KnowledgeOut,
    MessageCreate,
    MessageOut,
    ProjectCreate,
    ProjectOut,
    ProjectUpdate,
    WidgetSessionCreate,
    OrderStatusRequest,
    AnalyticsOut,
    KnowledgeURLCreate,
    KnowledgeSourceOut,
    IntegrationCreate,
    IntegrationOut,
    WebhookCreate,
    WebhookCreated,
    WebhookOut,
)
from backend.app.services.assistant import answer_question
from backend.app.services.notifications import send_escalation_notification
from backend.app.services.encryption import decrypt_secret, encrypt_secret
from backend.app.services.ingestion import validate_public_url
from backend.app.services.storage import delete_object, put_object
from backend.app.services.vector_store import remove_source_vectors
from backend.app.services.webhooks import emit_webhook_event
from backend.app.workers.tasks import deliver_webhook
from backend.app.workers.tasks import process_knowledge_source
from backend.app.websocket.manager import hub, publish_conversation

router = APIRouter(prefix="/api")
logger = logging.getLogger(__name__)
ADMIN_ROLES = ("owner", "admin")
AGENT_ROLES = ("owner", "admin", "agent")
WEBHOOK_EVENTS = {"conversation.created", "conversation.escalated", "message.created", "conversation.resolved"}


def _message_event(message: Message) -> dict:
    return {"type": "message.created", "message": MessageOut.model_validate(message).model_dump(mode="json")}


def _escalation_reason(question: str) -> str | None:
    text = question.lower()
    if re.search(r"\b(human|person|real agent|support agent|representative|someone|live agent)\b", text) or re.search(
        r"\b(talk|speak|connect|transfer).{0,20}\b(agent|person|human|someone)\b", text
    ):
        return "customer_requested_human"
    if re.search(r"\b(my (?:order|account|payment|subscription|address|email|password)|track my|where is my|refund my)\b", text):
        return "account_specific_request"
    if re.search(r"\b(not helpful|didn't help|did not help|still not|that didn't answer|that did not answer|isn't helping|is not helping)\b", text):
        return "repeated_unsuccessful_attempts"
    return None


def _verify_widget_origin(project: Project, request: Request | None = None, origin_value: str | None = None) -> None:
    origin = origin_value or (request.headers.get("origin") if request else None)
    parsed = urlparse(origin or "")
    host = parsed.netloc.lower()
    local_http = parsed.scheme == "http" and host.split(":", 1)[0] in {"localhost", "127.0.0.1"}
    if not origin or (parsed.scheme != "https" and not local_http) or host not in project.allowed_domains:
        raise HTTPException(status_code=403, detail="This website is not allowed to use the widget")


async def _org_conversation(session: AsyncSession, conversation_id: UUID, organization_id: UUID) -> Conversation:
    conversation = await session.scalar(
        select(Conversation).join(Project).where(
            Conversation.id == conversation_id, Project.organization_id == organization_id,
        )
    )
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


def _audit(session: AsyncSession, user: User, action: str, target_type: str, target_id: str | None, details: dict | None = None) -> None:
    session.add(AuditEvent(
        organization_id=user.organization_id,
        actor_id=user.id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        details=details or {},
    ))


async def _enqueue_source(source_id: UUID) -> None:
    await asyncio.to_thread(process_knowledge_source.delay, str(source_id))


async def _emit_webhook_safely(
    session: AsyncSession, organization_id: UUID, project_id: UUID, event_type: str, payload: dict,
) -> None:
    try:
        await emit_webhook_event(session, organization_id, project_id, event_type, payload)
    except Exception:
        logger.exception("Could not persist webhook event %s for project %s", event_type, project_id)


@router.post("/projects", response_model=ProjectOut, status_code=201)
async def create_project(
    body: ProjectCreate,
    user: User = Depends(require_roles(*ADMIN_ROLES)),
    session: AsyncSession = Depends(get_session),
):
    project = Project(
        organization_id=user.organization_id,
        name=body.name.strip(),
        allowed_domains=body.allowed_domains,
    )
    session.add(project)
    await session.flush()
    _audit(session, user, "project.created", "project", str(project.id), {"name": project.name})
    await session.commit()
    await session.refresh(project)
    return project


@router.get("/projects", response_model=list[ProjectOut])
async def list_projects(
    user: User = Depends(require_roles(*AGENT_ROLES)), session: AsyncSession = Depends(get_session),
):
    return list((await session.scalars(
        select(Project).where(Project.organization_id == user.organization_id).order_by(Project.created_at.desc())
    )).all())


@router.patch("/projects/{project_id}", response_model=ProjectOut)
async def update_project(
    project_id: UUID,
    body: ProjectUpdate,
    user: User = Depends(require_roles(*ADMIN_ROLES)),
    session: AsyncSession = Depends(get_session),
):
    project = await session.scalar(select(Project).where(
        Project.id == project_id, Project.organization_id == user.organization_id,
    ))
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if body.name is not None:
        project.name = body.name.strip()
    if body.allowed_domains is not None:
        project.allowed_domains = body.allowed_domains
    _audit(session, user, "project.updated", "project", str(project.id), {
        "allowed_domains": project.allowed_domains,
    })
    await session.commit()
    await session.refresh(project)
    return project


@router.post("/projects/{project_id}/knowledge", response_model=KnowledgeOut, status_code=201)
async def add_knowledge(
    project_id: UUID, body: KnowledgeCreate,
    user: User = Depends(require_roles(*ADMIN_ROLES)), session: AsyncSession = Depends(get_session),
):
    project = await session.scalar(select(Project).where(
        Project.id == project_id, Project.organization_id == user.organization_id,
    ))
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    entry = KnowledgeEntry(project_id=project.id, title=body.title, content=body.content)
    session.add(entry)
    await session.flush()
    source = KnowledgeSource(
        project_id=project.id, kind="text", title=entry.title, knowledge_entry_id=entry.id, status="pending",
    )
    session.add(source)
    _audit(session, user, "knowledge.created", "knowledge_entry", str(entry.id), {"title": entry.title})
    await session.commit()
    await session.refresh(entry)
    try:
        await _enqueue_source(source.id)
    except Exception:
        source.status = "failed"
        source.error = "Background worker queue is unavailable"
        await session.commit()
    return entry


@router.get("/projects/{project_id}/knowledge", response_model=list[KnowledgeOut])
async def list_knowledge(
    project_id: UUID, user: User = Depends(require_roles(*AGENT_ROLES)), session: AsyncSession = Depends(get_session),
):
    if await session.scalar(select(Project.id).where(
        Project.id == project_id, Project.organization_id == user.organization_id,
    )) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return list((await session.scalars(
        select(KnowledgeEntry).where(KnowledgeEntry.project_id == project_id)
    )).all())


@router.post("/projects/{project_id}/sources/url", response_model=KnowledgeSourceOut, status_code=202)
async def create_url_source(
    project_id: UUID, body: KnowledgeURLCreate,
    user: User = Depends(require_roles(*ADMIN_ROLES)), session: AsyncSession = Depends(get_session),
):
    project = await session.scalar(select(Project).where(
        Project.id == project_id, Project.organization_id == user.organization_id,
    ))
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    try:
        await validate_public_url(body.url)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    source = KnowledgeSource(project_id=project.id, kind="url", title=body.title, source_url=body.url, status="pending")
    session.add(source)
    await session.flush()
    _audit(session, user, "knowledge.source_created", "knowledge_source", str(source.id), {"kind": "url"})
    await session.commit()
    try:
        await _enqueue_source(source.id)
    except Exception as exc:
        source.status = "failed"
        source.error = "Background worker queue is unavailable"
        await session.commit()
        raise HTTPException(status_code=503, detail="The ingestion queue is unavailable") from exc
    await session.refresh(source)
    return source


@router.post("/projects/{project_id}/sources/pdf", response_model=KnowledgeSourceOut, status_code=202)
async def upload_pdf_source(
    project_id: UUID, request: Request, file: UploadFile = File(...),
    user: User = Depends(require_roles(*ADMIN_ROLES)), session: AsyncSession = Depends(get_session),
):
    project = await session.scalar(select(Project).where(
        Project.id == project_id, Project.organization_id == user.organization_id,
    ))
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    if file.content_type != "application/pdf" or not (file.filename or "").lower().endswith(".pdf"):
        raise HTTPException(status_code=415, detail="Upload a PDF file")
    data = await file.read(settings.ingestion_max_bytes + 1)
    if len(data) > settings.ingestion_max_bytes:
        raise HTTPException(status_code=413, detail="The file exceeds the configured upload limit")
    if not data.startswith(b"%PDF-"):
        raise HTTPException(status_code=415, detail="The uploaded file is not a valid PDF")
    source = KnowledgeSource(project_id=project.id, kind="pdf", title=(file.filename or "document.pdf")[:240], status="pending")
    session.add(source)
    await session.flush()
    key = f"organizations/{user.organization_id}/projects/{project.id}/sources/{source.id}.pdf"
    try:
        await put_object(key, data, "application/pdf")
    except Exception as exc:
        await session.rollback()
        raise HTTPException(status_code=503, detail="Object storage is unavailable") from exc
    source.storage_key = key
    _audit(session, user, "knowledge.source_created", "knowledge_source", str(source.id), {"kind": "pdf"})
    await session.commit()
    try:
        await _enqueue_source(source.id)
    except Exception as exc:
        source.status = "failed"
        source.error = "Background worker queue is unavailable"
        await session.commit()
        raise HTTPException(status_code=503, detail="The ingestion queue is unavailable") from exc
    await session.refresh(source)
    return source


@router.get("/projects/{project_id}/sources", response_model=list[KnowledgeSourceOut])
async def list_sources(
    project_id: UUID,
    user: User = Depends(require_roles(*AGENT_ROLES)), session: AsyncSession = Depends(get_session),
):
    if await session.scalar(select(Project.id).where(
        Project.id == project_id, Project.organization_id == user.organization_id,
    )) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return list((await session.scalars(select(KnowledgeSource).where(
        KnowledgeSource.project_id == project_id,
    ).order_by(KnowledgeSource.created_at.desc()))).all())


@router.delete("/projects/{project_id}/sources/{source_id}", status_code=204)
async def delete_source(
    project_id: UUID, source_id: UUID,
    user: User = Depends(require_roles(*ADMIN_ROLES)), session: AsyncSession = Depends(get_session),
):
    source = await session.scalar(select(KnowledgeSource).join(Project).where(
        KnowledgeSource.id == source_id, KnowledgeSource.project_id == project_id,
        Project.organization_id == user.organization_id,
    ))
    if source is None:
        raise HTTPException(status_code=404, detail="Knowledge source not found")
    try:
        await remove_source_vectors(project_id, user.organization_id, source_id)
    except Exception:
        # PostgreSQL is canonical; orphan vectors are filtered out after source deletion.
        pass
    if source.storage_key:
        try:
            await delete_object(source.storage_key)
        except Exception:
            pass
    if source.knowledge_entry_id:
        entry = await session.get(KnowledgeEntry, source.knowledge_entry_id)
        if entry:
            await session.delete(entry)
    _audit(session, user, "knowledge.source_deleted", "knowledge_source", str(source.id))
    await session.delete(source)
    await session.commit()


@router.post("/projects/{project_id}/sources/{source_id}/refresh", response_model=KnowledgeSourceOut, status_code=202)
async def refresh_source(
    project_id: UUID, source_id: UUID,
    user: User = Depends(require_roles(*ADMIN_ROLES)), session: AsyncSession = Depends(get_session),
):
    source = await session.scalar(select(KnowledgeSource).join(Project).where(
        KnowledgeSource.id == source_id, KnowledgeSource.project_id == project_id,
        Project.organization_id == user.organization_id,
    ))
    if source is None:
        raise HTTPException(status_code=404, detail="Knowledge source not found")
    if source.kind == "url":
        try:
            await validate_public_url(source.source_url or "")
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    source.status = "pending"
    source.error = None
    await session.commit()
    try:
        await _enqueue_source(source.id)
    except Exception as exc:
        source.status = "failed"
        source.error = "Background worker queue is unavailable"
        await session.commit()
        raise HTTPException(status_code=503, detail="The ingestion queue is unavailable") from exc
    await session.refresh(source)
    return source


@router.post("/projects/{project_id}/integrations", response_model=IntegrationOut, status_code=201)
async def save_integration(
    project_id: UUID, body: IntegrationCreate,
    user: User = Depends(require_roles(*ADMIN_ROLES)), session: AsyncSession = Depends(get_session),
):
    project = await session.scalar(select(Project).where(
        Project.id == project_id, Project.organization_id == user.organization_id,
    ))
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    parsed = urlparse(body.base_url)
    is_local_http = parsed.scheme == "http" and parsed.hostname in {"localhost", "127.0.0.1"} and settings.app_env == "development"
    if (parsed.scheme != "https" and not is_local_http) or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise HTTPException(status_code=422, detail="Use an https API base URL without credentials, query, or fragment")
    if not is_local_http:
        try:
            await validate_public_url(body.base_url)
        except ValueError as exc:
            raise HTTPException(status_code=422, detail=str(exc)) from exc
    normalized_url = body.base_url.rstrip("/")
    integration = await session.scalar(select(Integration).where(
        Integration.project_id == project.id, Integration.kind == body.kind,
    ))
    if integration is None:
        integration = Integration(project_id=project.id, kind=body.kind, base_url=normalized_url, encrypted_token=encrypt_secret(body.token))
        session.add(integration)
    else:
        integration.base_url = normalized_url
        integration.encrypted_token = encrypt_secret(body.token)
        integration.enabled = True
    await session.flush()
    _audit(session, user, "integration.configured", "integration", str(integration.id), {"kind": integration.kind})
    await session.commit()
    await session.refresh(integration)
    return integration


@router.get("/projects/{project_id}/integrations", response_model=list[IntegrationOut])
async def list_integrations(
    project_id: UUID, user: User = Depends(require_roles(*ADMIN_ROLES)), session: AsyncSession = Depends(get_session),
):
    if await session.scalar(select(Project.id).where(
        Project.id == project_id, Project.organization_id == user.organization_id,
    )) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return list((await session.scalars(select(Integration).where(Integration.project_id == project_id))).all())


@router.delete("/projects/{project_id}/integrations/{integration_id}", status_code=204)
async def delete_integration(
    project_id: UUID, integration_id: UUID,
    user: User = Depends(require_roles(*ADMIN_ROLES)), session: AsyncSession = Depends(get_session),
):
    integration = await session.scalar(select(Integration).join(Project).where(
        Integration.id == integration_id, Integration.project_id == project_id,
        Project.organization_id == user.organization_id,
    ))
    if integration is None:
        raise HTTPException(status_code=404, detail="Integration not found")
    _audit(session, user, "integration.deleted", "integration", str(integration.id), {"kind": integration.kind})
    await session.delete(integration)
    await session.commit()


@router.post("/webhooks", response_model=WebhookCreated, status_code=201)
async def create_webhook(
    body: WebhookCreate,
    user: User = Depends(require_roles(*ADMIN_ROLES)),
    session: AsyncSession = Depends(get_session),
):
    parsed = urlparse(body.url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise HTTPException(status_code=422, detail="Webhooks require an https URL without credentials or fragments")
    try:
        await validate_public_url(body.url)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if set(body.events) - WEBHOOK_EVENTS:
        raise HTTPException(status_code=422, detail="One or more webhook event types are unsupported")
    if body.project_id and await session.scalar(select(Project.id).where(
        Project.id == body.project_id, Project.organization_id == user.organization_id,
    )) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    signing_secret = "whsec_" + secrets.token_urlsafe(32)
    endpoint = WebhookEndpoint(
        organization_id=user.organization_id, project_id=body.project_id, created_by_id=user.id,
        url=body.url, encrypted_secret=encrypt_secret(signing_secret), events=list(dict.fromkeys(body.events)),
    )
    session.add(endpoint)
    await session.flush()
    _audit(session, user, "webhook.created", "webhook", str(endpoint.id), {"events": endpoint.events})
    await session.commit()
    await session.refresh(endpoint)
    return WebhookCreated(
        id=endpoint.id, project_id=endpoint.project_id, url=endpoint.url, events=endpoint.events,
        enabled=endpoint.enabled, created_at=endpoint.created_at, signing_secret=signing_secret,
    )


@router.get("/webhooks", response_model=list[WebhookOut])
async def list_webhooks(
    user: User = Depends(require_roles(*ADMIN_ROLES)), session: AsyncSession = Depends(get_session),
):
    return list((await session.scalars(select(WebhookEndpoint).where(
        WebhookEndpoint.organization_id == user.organization_id,
    ).order_by(WebhookEndpoint.created_at.desc()))).all())


@router.delete("/webhooks/{webhook_id}", status_code=204)
async def delete_webhook(
    webhook_id: UUID, user: User = Depends(require_roles(*ADMIN_ROLES)),
    session: AsyncSession = Depends(get_session),
):
    endpoint = await session.scalar(select(WebhookEndpoint).where(
        WebhookEndpoint.id == webhook_id, WebhookEndpoint.organization_id == user.organization_id,
    ))
    if endpoint is None:
        raise HTTPException(status_code=404, detail="Webhook not found")
    _audit(session, user, "webhook.deleted", "webhook", str(endpoint.id), {})
    await session.delete(endpoint)
    await session.commit()


@router.get("/webhooks/{webhook_id}/deliveries")
async def list_webhook_deliveries(
    webhook_id: UUID, user: User = Depends(require_roles(*ADMIN_ROLES)),
    session: AsyncSession = Depends(get_session),
):
    endpoint = await session.scalar(select(WebhookEndpoint).where(
        WebhookEndpoint.id == webhook_id, WebhookEndpoint.organization_id == user.organization_id,
    ))
    if endpoint is None:
        raise HTTPException(status_code=404, detail="Webhook not found")
    deliveries = (await session.scalars(select(WebhookDelivery).where(
        WebhookDelivery.endpoint_id == endpoint.id,
    ).order_by(WebhookDelivery.created_at.desc()).limit(100))).all()
    return [{
        "id": str(item.id), "event_type": item.event_type, "status": item.status,
        "attempts": item.attempts, "response_code": item.response_code,
        "last_error": item.last_error, "created_at": item.created_at.isoformat(),
        "delivered_at": item.delivered_at.isoformat() if item.delivered_at else None,
    } for item in deliveries]


@router.post("/webhooks/{webhook_id}/deliveries/{delivery_id}/retry", status_code=202)
async def retry_webhook_delivery(
    webhook_id: UUID, delivery_id: UUID, user: User = Depends(require_roles(*ADMIN_ROLES)),
    session: AsyncSession = Depends(get_session),
):
    delivery = await session.scalar(select(WebhookDelivery).join(WebhookEndpoint).where(
        WebhookDelivery.id == delivery_id, WebhookEndpoint.id == webhook_id,
        WebhookEndpoint.organization_id == user.organization_id, WebhookEndpoint.enabled.is_(True),
    ).with_for_update())
    if delivery is None:
        raise HTTPException(status_code=404, detail="Webhook delivery not found")
    if delivery.status == "delivered":
        raise HTTPException(status_code=409, detail="This delivery has already succeeded")
    delivery.status = "queued"
    delivery.attempts = 0
    delivery.response_code = None
    delivery.next_attempt_at = None
    delivery.last_error = None
    await session.commit()
    try:
        await asyncio.to_thread(deliver_webhook.delay, str(delivery.id))
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Webhook queue is unavailable") from exc
    return {"status": "queued"}


@router.post("/widget/conversations/{conversation_id}/tools/order-status")
async def get_order_status(
    conversation_id: UUID, body: OrderStatusRequest, request: Request,
    session: AsyncSession = Depends(get_session),
):
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    project = await session.get(Project, conversation.project_id)
    _verify_widget_origin(project, request)
    if not conversation.visitor_verified or not conversation.visitor_id:
        raise HTTPException(status_code=403, detail="Verified customer identity is required for order lookup")
    integration = await session.scalar(select(Integration).where(
        Integration.project_id == project.id, Integration.kind == "order_status", Integration.enabled.is_(True),
    ))
    if integration is None:
        raise HTTPException(status_code=404, detail="Order-status integration is not configured")
    url = f"{integration.base_url}/orders/{quote(body.order_id, safe='')}"
    try:
        async with httpx.AsyncClient(timeout=8, follow_redirects=False) as client:
            response = await client.get(url, headers={
                "Authorization": f"Bearer {decrypt_secret(integration.encrypted_token)}",
                "X-Verified-Customer-ID": conversation.visitor_id,
            })
            response.raise_for_status()
            data = response.json()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="The company order service is unavailable") from exc
    # Return a small allowlisted result only; never proxy arbitrary company API data.
    safe_result = {key: data[key] for key in ("status", "updated_at", "estimated_delivery", "total", "currency") if key in data}
    return {"order_id": body.order_id, **safe_result}


@router.get("/analytics/overview", response_model=AnalyticsOut)
async def analytics_overview(
    user: User = Depends(require_roles(*AGENT_ROLES)), session: AsyncSession = Depends(get_session),
):
    scoped_projects = select(Project.id).where(Project.organization_id == user.organization_id)
    scoped_conversations = select(Conversation.id).where(Conversation.project_id.in_(scoped_projects))
    total = await session.scalar(select(func.count(Conversation.id)).where(Conversation.id.in_(scoped_conversations))) or 0
    opened = await session.scalar(select(func.count(Conversation.id)).where(
        Conversation.id.in_(scoped_conversations), Conversation.status == "open",
    )) or 0
    escalated = await session.scalar(select(func.count(Conversation.id)).where(
        Conversation.id.in_(scoped_conversations), Conversation.status == "escalated",
    )) or 0
    resolved = await session.scalar(select(func.count(Conversation.id)).where(
        Conversation.id.in_(scoped_conversations), Conversation.status == "resolved",
    )) or 0
    messages = await session.scalar(select(func.count(Message.id)).where(
        Message.conversation_id.in_(scoped_conversations),
    )) or 0
    ai_resolved = await session.scalar(select(func.count(Conversation.id)).where(
        Conversation.id.in_(scoped_conversations), Conversation.status == "resolved",
        Conversation.assigned_agent.is_(None),
    )) or 0
    return AnalyticsOut(
        conversations_total=total, open_conversations=opened, escalated_conversations=escalated,
        resolved_conversations=resolved, messages_total=messages, ai_resolved=ai_resolved,
    )


@router.get("/audit/events")
async def list_audit_events(
    user: User = Depends(require_roles(*ADMIN_ROLES)), session: AsyncSession = Depends(get_session),
):
    events = (await session.scalars(select(AuditEvent).where(
        AuditEvent.organization_id == user.organization_id,
    ).order_by(AuditEvent.created_at.desc()).limit(200))).all()
    return [{
        "id": str(event.id), "actor_id": str(event.actor_id) if event.actor_id else None,
        "action": event.action, "target_type": event.target_type, "target_id": event.target_id,
        "details": event.details, "created_at": event.created_at.isoformat(),
    } for event in events]


@router.post("/widget/{project_id}/conversations", response_model=ConversationOut, status_code=201)
async def create_conversation(
    project_id: UUID,
    request: Request,
    body: WidgetSessionCreate | None = None,
    session: AsyncSession = Depends(get_session),
):
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    _verify_widget_origin(project, request)
    visitor_id = None
    verified = False
    if body and body.identity_token:
        try:
            visitor_id = verify_widget_identity(body.identity_token, project.id)
            verified = True
        except (ValueError, KeyError, TypeError):
            raise HTTPException(status_code=401, detail="Invalid signed visitor identity")
    conversation = Conversation(project_id=project.id, visitor_id=visitor_id, visitor_verified=verified)
    session.add(conversation)
    session.add(AnalyticsEvent(project_id=project.id, event_type="conversation.created", dimensions={}))
    await session.commit()
    await session.refresh(conversation)
    await _emit_webhook_safely(session, project.organization_id, project.id, "conversation.created", {
        "conversation_id": str(conversation.id), "project_id": str(project.id),
        "status": conversation.status, "created_at": conversation.created_at.isoformat(),
    })
    return conversation


@router.get("/widget/conversations/{conversation_id}/messages", response_model=list[MessageOut])
async def get_messages(conversation_id: UUID, request: Request, session: AsyncSession = Depends(get_session)):
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    project = await session.get(Project, conversation.project_id)
    _verify_widget_origin(project, request)
    return list((await session.scalars(
        select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at)
    )).all())


@router.get("/widget/conversations/{conversation_id}", response_model=ConversationOut)
async def get_widget_conversation(conversation_id: UUID, request: Request, session: AsyncSession = Depends(get_session)):
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    project = await session.get(Project, conversation.project_id)
    _verify_widget_origin(project, request)
    return conversation


@router.post("/widget/conversations/{conversation_id}/messages", response_model=list[MessageOut], status_code=201)
async def send_message(
    conversation_id: UUID, body: MessageCreate, request: Request, background_tasks: BackgroundTasks,
    session: AsyncSession = Depends(get_session),
):
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    project = await session.get(Project, conversation.project_id)
    _verify_widget_origin(project, request)
    if conversation.status == "resolved":
        raise HTTPException(status_code=409, detail="This conversation is resolved")
    customer_message = Message(conversation_id=conversation.id, sender_type="customer", content=body.content)
    session.add(customer_message)
    await session.flush()
    if conversation.status in {"escalated", "assigned"}:
        await session.commit()
        await session.refresh(customer_message)
        await publish_conversation(str(conversation.id), _message_event(customer_message))
        await _emit_webhook_safely(session, project.organization_id, project.id, "message.created", {
            "conversation_id": str(conversation.id), "message": MessageOut.model_validate(customer_message).model_dump(mode="json"),
        })
        return [customer_message]
    reason = _escalation_reason(body.content)
    try:
        if reason:
            reply, source = "I’m bringing a support agent into this conversation. They’ll reply here as soon as possible.", None
        else:
            reply, source = await answer_question(session, conversation, body.content)
    except httpx.HTTPError:
        reason = "ai_provider_unavailable"
        reply, source = "The assistant is temporarily unavailable. I’m bringing a support agent into this conversation.", None
    if source is None:
        reason = reason or "no_relevant_knowledge"
        conversation.status = "escalated"
        conversation.escalation_reason = reason
        conversation.escalated_at = datetime.now(timezone.utc)
        assistant_message = Message(conversation_id=conversation.id, sender_type="system", content=reply)
    else:
        assistant_message = Message(
            conversation_id=conversation.id,
            sender_type="assistant",
            content=reply,
            source_title=source,
        )
    session.add(assistant_message)
    await session.commit()
    await session.refresh(customer_message)
    await session.refresh(assistant_message)
    await publish_conversation(str(conversation.id), _message_event(customer_message))
    await publish_conversation(str(conversation.id), _message_event(assistant_message))
    await _emit_webhook_safely(session, project.organization_id, project.id, "message.created", {
        "conversation_id": str(conversation.id), "message": MessageOut.model_validate(customer_message).model_dump(mode="json"),
    })
    await _emit_webhook_safely(session, project.organization_id, project.id, "message.created", {
        "conversation_id": str(conversation.id), "message": MessageOut.model_validate(assistant_message).model_dump(mode="json"),
    })
    if conversation.status == "escalated":
        await publish_conversation(str(conversation.id), {
            "type": "conversation.escalated",
            "status": conversation.status,
            "reason": conversation.escalation_reason,
            "organization_id": str(project.organization_id),
        })
        await _emit_webhook_safely(session, project.organization_id, project.id, "conversation.escalated", {
            "conversation_id": str(conversation.id), "project_id": str(project.id),
            "reason": conversation.escalation_reason, "status": conversation.status,
        })
        background_tasks.add_task(
            send_escalation_notification,
            str(conversation.id),
            conversation.escalation_reason or "needs_support",
        )
    return [customer_message, assistant_message]


@router.get("/agents/presence")
async def list_agent_presence(user: User = Depends(require_roles(*AGENT_ROLES))):
    return {"online_agents": await hub.online_agents(str(user.organization_id))}


@router.get("/agents/conversations", response_model=list[ConversationOut])
async def list_agent_conversations(
    status: str | None = None,
    q: str | None = None,
    project_id: UUID | None = None,
    assigned_to_me: bool = False,
    user: User = Depends(require_roles(*AGENT_ROLES)),
    session: AsyncSession = Depends(get_session),
):
    query = select(Conversation).join(Project).where(Project.organization_id == user.organization_id).order_by(
        Conversation.escalated_at.desc().nullslast(), Conversation.created_at.desc()
    )
    if status:
        if status not in {"open", "assigned", "escalated", "resolved"}:
            raise HTTPException(status_code=422, detail="Unsupported conversation status")
        query = query.where(Conversation.status == status)
    else:
        query = query.where(Conversation.status.in_(["open", "escalated", "assigned"]))
    if project_id:
        query = query.where(Conversation.project_id == project_id)
    if assigned_to_me:
        query = query.where(Conversation.assigned_agent == user.display_name)
    if q and q.strip():
        query = query.where(Conversation.id.in_(select(Message.conversation_id).where(
            Message.content.ilike(f"%{q.strip()[:120]}%"),
        )))
    return list((await session.scalars(query)).all())


@router.get("/agents/conversations/{conversation_id}/messages", response_model=list[MessageOut])
async def get_agent_messages(
    conversation_id: UUID,
    user: User = Depends(require_roles(*AGENT_ROLES)),
    session: AsyncSession = Depends(get_session),
):
    await _org_conversation(session, conversation_id, user.organization_id)
    return list((await session.scalars(
        select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at)
    )).all())


@router.post("/agents/conversations/{conversation_id}/assign", response_model=ConversationOut)
async def assign_conversation(
    conversation_id: UUID, body: ConversationStatusUpdate,
    user: User = Depends(require_roles(*AGENT_ROLES)), session: AsyncSession = Depends(get_session),
):
    conversation = await _org_conversation(session, conversation_id, user.organization_id)
    if conversation.status == "resolved":
        raise HTTPException(status_code=409, detail="Reopen this conversation before assigning it")
    conversation.assigned_agent = user.display_name
    conversation.status = "assigned"
    _audit(session, user, "conversation.assigned", "conversation", str(conversation.id), {"agent": user.display_name})
    await session.commit()
    await session.refresh(conversation)
    await publish_conversation(str(conversation.id), {
        "type": "conversation.assigned", "agent_name": conversation.assigned_agent, "status": conversation.status,
    })
    return conversation


@router.post("/agents/conversations/{conversation_id}/resolve", response_model=ConversationOut)
async def resolve_conversation(
    conversation_id: UUID, body: ConversationStatusUpdate,
    user: User = Depends(require_roles(*AGENT_ROLES)), session: AsyncSession = Depends(get_session),
):
    conversation = await _org_conversation(session, conversation_id, user.organization_id)
    conversation.status = "resolved"
    conversation.resolved_at = datetime.now(timezone.utc)
    _audit(session, user, "conversation.resolved", "conversation", str(conversation.id))
    await session.commit()
    await session.refresh(conversation)
    await publish_conversation(str(conversation.id), {
        "type": "conversation.resolved", "agent_name": user.display_name, "status": conversation.status,
    })
    project_id = conversation.project_id
    await _emit_webhook_safely(session, user.organization_id, project_id, "conversation.resolved", {
        "conversation_id": str(conversation.id), "status": conversation.status,
        "resolved_at": conversation.resolved_at.isoformat() if conversation.resolved_at else None,
    })
    return conversation


@router.post("/agents/conversations/{conversation_id}/reopen", response_model=ConversationOut)
async def reopen_conversation(
    conversation_id: UUID, body: ConversationStatusUpdate,
    user: User = Depends(require_roles(*AGENT_ROLES)), session: AsyncSession = Depends(get_session),
):
    conversation = await _org_conversation(session, conversation_id, user.organization_id)
    conversation.status = "assigned" if conversation.assigned_agent else "open"
    conversation.resolved_at = None
    _audit(session, user, "conversation.reopened", "conversation", str(conversation.id))
    await session.commit()
    await session.refresh(conversation)
    await publish_conversation(str(conversation.id), {
        "type": "conversation.reopened", "agent_name": user.display_name, "status": conversation.status,
    })
    return conversation


@router.post("/agents/conversations/{conversation_id}/messages", response_model=MessageOut, status_code=201)
async def send_agent_message(
    conversation_id: UUID, body: AgentMessageCreate,
    user: User = Depends(require_roles(*AGENT_ROLES)), session: AsyncSession = Depends(get_session),
):
    conversation = await _org_conversation(session, conversation_id, user.organization_id)
    if conversation.status == "resolved":
        raise HTTPException(status_code=409, detail="Reopen this conversation before replying")
    if conversation.assigned_agent is None:
        conversation.assigned_agent = user.display_name
    conversation.status = "assigned"
    message = Message(
        conversation_id=conversation.id,
        sender_type="agent",
        sender_name=user.display_name,
        content=body.content,
    )
    session.add(message)
    await session.flush()
    _audit(session, user, "conversation.message_sent", "conversation", str(conversation.id))
    await session.commit()
    await session.refresh(message)
    await publish_conversation(str(conversation.id), _message_event(message))
    project_id = conversation.project_id
    await _emit_webhook_safely(session, user.organization_id, project_id, "message.created", {
        "conversation_id": str(conversation.id), "message": MessageOut.model_validate(message).model_dump(mode="json"),
    })
    return message

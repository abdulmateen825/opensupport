import httpx
from uuid import UUID
from fastapi import BackgroundTasks

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.db.session import get_session
from backend.app.models import Conversation, KnowledgeEntry, Message, Project
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
)
from backend.app.services.assistant import answer_question
from backend.app.services.notifications import send_escalation_notification
from backend.app.websocket.manager import hub, publish_conversation
from datetime import datetime, timezone
import re

router = APIRouter(prefix="/api")


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


@router.post("/projects", response_model=ProjectOut, status_code=201)
async def create_project(body: ProjectCreate, session: AsyncSession = Depends(get_session)):
    project = Project(name=body.name)
    session.add(project)
    await session.commit()
    await session.refresh(project)
    return project


@router.get("/projects", response_model=list[ProjectOut])
async def list_projects(session: AsyncSession = Depends(get_session)):
    return list((await session.scalars(select(Project).order_by(Project.created_at.desc()))).all())


@router.post("/projects/{project_id}/knowledge", response_model=KnowledgeOut, status_code=201)
async def add_knowledge(project_id: UUID, body: KnowledgeCreate, session: AsyncSession = Depends(get_session)):
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    entry = KnowledgeEntry(project_id=project.id, title=body.title, content=body.content)
    session.add(entry)
    await session.commit()
    await session.refresh(entry)
    return entry


@router.get("/projects/{project_id}/knowledge", response_model=list[KnowledgeOut])
async def list_knowledge(project_id: UUID, session: AsyncSession = Depends(get_session)):
    if await session.get(Project, project_id) is None:
        raise HTTPException(status_code=404, detail="Project not found")
    return list((await session.scalars(
        select(KnowledgeEntry).where(KnowledgeEntry.project_id == project_id)
    )).all())


@router.post("/widget/{project_id}/conversations", response_model=ConversationOut, status_code=201)
async def create_conversation(project_id: UUID, session: AsyncSession = Depends(get_session)):
    project = await session.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=404, detail="Project not found")
    conversation = Conversation(project_id=project.id)
    session.add(conversation)
    await session.commit()
    await session.refresh(conversation)
    return conversation


@router.get("/widget/conversations/{conversation_id}/messages", response_model=list[MessageOut])
async def get_messages(conversation_id: UUID, session: AsyncSession = Depends(get_session)):
    if await session.get(Conversation, conversation_id) is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return list((await session.scalars(
        select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at)
    )).all())


@router.get("/widget/conversations/{conversation_id}", response_model=ConversationOut)
async def get_widget_conversation(conversation_id: UUID, session: AsyncSession = Depends(get_session)):
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return conversation


@router.post("/widget/conversations/{conversation_id}/messages", response_model=list[MessageOut], status_code=201)
async def send_message(conversation_id: UUID, body: MessageCreate, background_tasks: BackgroundTasks, session: AsyncSession = Depends(get_session)):
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation.status == "resolved":
        raise HTTPException(status_code=409, detail="This conversation is resolved")
    customer_message = Message(conversation_id=conversation.id, sender_type="customer", content=body.content)
    session.add(customer_message)
    await session.flush()
    if conversation.status in {"escalated", "assigned"}:
        await session.commit()
        await session.refresh(customer_message)
        await publish_conversation(str(conversation.id), _message_event(customer_message))
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
    if conversation.status == "escalated":
        await publish_conversation(str(conversation.id), {
            "type": "conversation.escalated",
            "status": conversation.status,
            "reason": conversation.escalation_reason,
        })
        background_tasks.add_task(
            send_escalation_notification,
            str(conversation.id),
            conversation.escalation_reason or "needs_support",
        )
    return [customer_message, assistant_message]


@router.get("/agents/presence")
async def list_agent_presence():
    return {"online_agents": await hub.online_agents()}


@router.get("/agents/conversations", response_model=list[ConversationOut])
async def list_agent_conversations(status: str | None = None, session: AsyncSession = Depends(get_session)):
    query = select(Conversation).order_by(Conversation.escalated_at.desc().nullslast(), Conversation.created_at.desc())
    if status:
        query = query.where(Conversation.status == status)
    else:
        query = query.where(Conversation.status.in_(["open", "escalated", "assigned"]))
    return list((await session.scalars(query)).all())


@router.get("/agents/conversations/{conversation_id}/messages", response_model=list[MessageOut])
async def get_agent_messages(conversation_id: UUID, session: AsyncSession = Depends(get_session)):
    if await session.get(Conversation, conversation_id) is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return list((await session.scalars(
        select(Message).where(Message.conversation_id == conversation_id).order_by(Message.created_at)
    )).all())


@router.post("/agents/conversations/{conversation_id}/assign", response_model=ConversationOut)
async def assign_conversation(conversation_id: UUID, body: ConversationStatusUpdate, session: AsyncSession = Depends(get_session)):
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation.status == "resolved":
        raise HTTPException(status_code=409, detail="Reopen this conversation before assigning it")
    conversation.assigned_agent = body.agent_name.strip()
    conversation.status = "assigned"
    await session.commit()
    await session.refresh(conversation)
    await publish_conversation(str(conversation.id), {
        "type": "conversation.assigned", "agent_name": conversation.assigned_agent, "status": conversation.status,
    })
    return conversation


@router.post("/agents/conversations/{conversation_id}/resolve", response_model=ConversationOut)
async def resolve_conversation(conversation_id: UUID, body: ConversationStatusUpdate, session: AsyncSession = Depends(get_session)):
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conversation.status = "resolved"
    conversation.resolved_at = datetime.now(timezone.utc)
    await session.commit()
    await session.refresh(conversation)
    await publish_conversation(str(conversation.id), {
        "type": "conversation.resolved", "agent_name": body.agent_name, "status": conversation.status,
    })
    return conversation


@router.post("/agents/conversations/{conversation_id}/reopen", response_model=ConversationOut)
async def reopen_conversation(conversation_id: UUID, body: ConversationStatusUpdate, session: AsyncSession = Depends(get_session)):
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    conversation.status = "assigned" if conversation.assigned_agent else "open"
    conversation.resolved_at = None
    await session.commit()
    await session.refresh(conversation)
    await publish_conversation(str(conversation.id), {
        "type": "conversation.reopened", "agent_name": body.agent_name, "status": conversation.status,
    })
    return conversation


@router.post("/agents/conversations/{conversation_id}/messages", response_model=MessageOut, status_code=201)
async def send_agent_message(conversation_id: UUID, body: AgentMessageCreate, session: AsyncSession = Depends(get_session)):
    conversation = await session.get(Conversation, conversation_id)
    if conversation is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conversation.status == "resolved":
        raise HTTPException(status_code=409, detail="Reopen this conversation before replying")
    if conversation.assigned_agent is None:
        conversation.assigned_agent = body.agent_name.strip()
    conversation.status = "assigned"
    message = Message(
        conversation_id=conversation.id,
        sender_type="agent",
        sender_name=body.agent_name.strip(),
        content=body.content,
    )
    session.add(message)
    await session.commit()
    await session.refresh(message)
    await publish_conversation(str(conversation.id), _message_event(message))
    return message

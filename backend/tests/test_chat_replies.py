from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import httpx
import pytest
from fastapi import BackgroundTasks, Request
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api import routes
from backend.app.models import Conversation, KnowledgeEntry, Project
from backend.app.schemas import MessageCreate
from backend.app.services import assistant


@pytest.mark.asyncio
@pytest.mark.parametrize("greeting", ["hi", "Hello!", "good morning", "thanks"])
async def test_small_talk_replies_without_retrieval(greeting):
    session = MagicMock(spec=AsyncSession)
    reply, source = await assistant.answer_question(session, Conversation(), greeting)
    assert reply
    assert source is None
    session.scalars.assert_not_called()


@pytest.mark.asyncio
async def test_rate_limit_returns_saved_policy(monkeypatch):
    session = MagicMock(spec=AsyncSession)
    session.scalars.return_value = MagicMock()
    session.scalars.return_value.all.return_value = [KnowledgeEntry(
        title="Returns", content="Items may be returned within 30 days of delivery."
    )]
    session.scalar.return_value = uuid4()
    monkeypatch.setattr(assistant, "search_chunks", AsyncMock(return_value=[]))
    provider = MagicMock()
    request = httpx.Request("POST", "https://api.groq.com/openai/v1/chat/completions")
    provider.complete = AsyncMock(side_effect=httpx.HTTPStatusError(
        "rate limited", request=request, response=httpx.Response(429, request=request)
    ))
    monkeypatch.setattr(assistant, "get_chat_provider", lambda: provider)

    reply, source = await assistant.answer_question(session, Conversation(project_id=uuid4()), "What is your return policy?")

    assert "30 days" in reply
    assert source == "Returns"
    provider.complete.assert_awaited_once()


@pytest.mark.asyncio
async def test_common_question_words_do_not_match_unrelated_faq(monkeypatch):
    session = MagicMock(spec=AsyncSession)
    session.scalars.return_value = MagicMock()
    session.scalars.return_value.all.return_value = [KnowledgeEntry(title="Shipping", content="Your parcel is sent by courier.")]
    session.scalar.return_value = uuid4()
    monkeypatch.setattr(assistant, "search_chunks", AsyncMock(return_value=[]))
    provider_factory = MagicMock()
    monkeypatch.setattr(assistant, "get_chat_provider", provider_factory)

    reply, source = await assistant.answer_question(session, Conversation(project_id=uuid4()), "What is your warranty?")

    assert "more detail" in reply
    assert source is None
    provider_factory.assert_not_called()


def chat_session(monkeypatch, status="open", reason=None, assigned_agent=None):
    project = Project(id=uuid4(), organization_id=uuid4(), allowed_domains=["localhost:5173"])
    conversation = Conversation(id=uuid4(), project_id=project.id, status=status,
                                escalation_reason=reason, assigned_agent=assigned_agent)
    session = MagicMock(spec=AsyncSession)
    session.get.side_effect = [conversation, project]
    added = []
    session.add.side_effect = added.append

    async def save():
        for item in added:
            if item.id is None:
                item.id = uuid4()
                item.created_at = datetime.now(timezone.utc)

    session.flush.side_effect = save
    session.commit.side_effect = save
    monkeypatch.setattr(routes, "publish_conversation", AsyncMock())
    monkeypatch.setattr(routes, "_emit_webhook_safely", AsyncMock())
    monkeypatch.setattr(routes, "answer_question", AsyncMock(return_value=("How can I help?", None)))
    return session, conversation


async def send(session, conversation, content="hi"):
    request = Request({"type": "http", "headers": [(b"origin", b"http://localhost:5173")]})
    return await routes.send_message(conversation.id, MessageCreate(content=content), request, BackgroundTasks(), session)


@pytest.mark.asyncio
async def test_reply_without_citation_stays_open(monkeypatch):
    session, conversation = chat_session(monkeypatch)
    messages = await send(session, conversation)
    assert [message.sender_type for message in messages] == ["customer", "assistant"]
    assert conversation.status == "open"


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", ["no_relevant_knowledge", "ai_provider_unavailable"])
async def test_legacy_automatic_handoff_resumes_assistant(monkeypatch, reason):
    session, conversation = chat_session(monkeypatch, "escalated", reason)
    messages = await send(session, conversation)
    assert len(messages) == 2
    assert conversation.status == "open"
    assert conversation.escalation_reason is None
    assert any(call.args[1]["type"] == "conversation.reopened" for call in routes.publish_conversation.call_args_list)


@pytest.mark.asyncio
@pytest.mark.parametrize("status, reason, agent", [
    ("escalated", "customer_requested_human", None),
    ("assigned", "no_relevant_knowledge", "Agent"),
    ("escalated", "ai_provider_unavailable", "Agent"),
])
async def test_human_conversations_are_not_taken_over(monkeypatch, status, reason, agent):
    session, conversation = chat_session(monkeypatch, status, reason, agent)
    messages = await send(session, conversation)
    assert [message.sender_type for message in messages] == ["customer"]
    assert conversation.status == status
    routes.answer_question.assert_not_awaited()


@pytest.mark.asyncio
async def test_explicit_human_request_still_escalates(monkeypatch):
    session, conversation = chat_session(monkeypatch)
    messages = await send(session, conversation, "I want to speak to a human")
    assert [message.sender_type for message in messages] == ["customer", "system"]
    assert conversation.status == "escalated"
    assert conversation.escalation_reason == "customer_requested_human"
    routes.answer_question.assert_not_awaited()


@pytest.mark.asyncio
async def test_retrieval_outage_replies_instead_of_stranding_chat(monkeypatch):
    session, conversation = chat_session(monkeypatch)
    routes.answer_question.side_effect = httpx.ConnectError("retrieval unavailable")
    messages = await send(session, conversation, "What is your return policy?")
    assert messages[-1].sender_type == "assistant"
    assert "try again" in messages[-1].content
    assert conversation.status == "open"

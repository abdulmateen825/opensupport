from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import pytest
from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api import routes
from backend.app.models import KnowledgeEntry, KnowledgeSource, User
from backend.app.schemas import KnowledgeCreate


def fixture(status="ready"):
    user = User(id=uuid4(), organization_id=uuid4(), role="owner")
    entry = KnowledgeEntry(id=uuid4(), project_id=uuid4(), title="Old policy", content="Old shipping policy")
    source = KnowledgeSource(id=uuid4(), project_id=entry.project_id, knowledge_entry_id=entry.id,
                             kind="text", title=entry.title, status=status)
    session = MagicMock(spec=AsyncSession)
    session.scalar.return_value = entry
    session.scalars.return_value = MagicMock()
    session.scalars.return_value.all.return_value = [source]
    return session, user, entry, source


@pytest.mark.asyncio
async def test_edit_invalidates_old_chunks_and_requeues(monkeypatch):
    session, user, entry, source = fixture()
    enqueue = AsyncMock()
    monkeypatch.setattr(routes, "_enqueue_source", enqueue)
    result = await routes.update_knowledge(entry.project_id, entry.id,
                                          KnowledgeCreate(title="New policy", content="Delivery takes five business days."), user, session)
    assert result.content == "Delivery takes five business days."
    assert source.title == "New policy"
    assert source.status == "pending"
    session.execute.assert_awaited_once()
    assert "DELETE FROM knowledge_chunks" in str(session.execute.call_args.args[0])
    enqueue.assert_awaited_once_with(source.id)


@pytest.mark.asyncio
async def test_edit_queue_failure_is_visible(monkeypatch):
    session, user, entry, source = fixture()
    monkeypatch.setattr(routes, "_enqueue_source", AsyncMock(side_effect=RuntimeError("offline")))
    await routes.update_knowledge(entry.project_id, entry.id,
                                 KnowledgeCreate(title="Policy", content="Delivery takes five business days."), user, session)
    assert source.status == "failed"
    assert "queue" in source.error


@pytest.mark.asyncio
@pytest.mark.parametrize("action", ["edit", "delete"])
async def test_cannot_modify_an_answer_being_indexed(action):
    session, user, entry, source = fixture("processing")
    with pytest.raises(HTTPException) as error:
        if action == "edit":
            await routes.update_knowledge(entry.project_id, entry.id,
                                          KnowledgeCreate(title="Policy", content="Updated policy content."), user, session)
        else:
            await routes.delete_knowledge(entry.project_id, entry.id, user, session)
    assert error.value.status_code == 409
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_removes_sources_and_entry_even_if_vector_service_is_down(monkeypatch):
    session, user, entry, source = fixture()
    monkeypatch.setattr(routes, "remove_source_vectors", AsyncMock(side_effect=RuntimeError("offline")))
    await routes.delete_knowledge(entry.project_id, entry.id, user, session)
    session.delete.assert_any_await(source)
    session.delete.assert_any_await(entry)
    session.commit.assert_awaited_once()


@pytest.mark.asyncio
async def test_tenant_lookup_rejects_missing_entry():
    session, user, entry, source = fixture()
    session.scalar.return_value = None
    with pytest.raises(HTTPException) as error:
        await routes.delete_knowledge(entry.project_id, entry.id, user, session)
    assert error.value.status_code == 404
    statement = str(session.scalar.call_args.args[0])
    assert "projects.organization_id" in statement
    session.delete.assert_not_awaited()

import re

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models import Conversation, KnowledgeChunk, KnowledgeEntry, KnowledgeSource, Project
from backend.app.services.providers import get_chat_provider
from backend.app.services.vector_store import search_chunks


def _terms(value: str) -> set[str]:
    return set(re.findall(r"[a-z0-9]{2,}", value.lower()))


async def answer_question(session: AsyncSession, conversation: Conversation, question: str) -> tuple[str, str | None]:
    entries = (await session.scalars(
        select(KnowledgeEntry).where(KnowledgeEntry.project_id == conversation.project_id)
    )).all()
    terms = _terms(question)
    ranked = sorted(
        ((len(terms & _terms(f"{entry.title} {entry.content}")), entry) for entry in entries),
        key=lambda item: item[0], reverse=True,
    )
    best_entry = ranked[0][1] if ranked and ranked[0][0] else None
    organization_id = await session.scalar(select(Project.organization_id).where(Project.id == conversation.project_id))
    chunks = await search_chunks(session, conversation.project_id, organization_id, question)
    chunk_terms = _terms(question)
    relevant_chunks = [chunk for chunk in chunks if chunk_terms & _terms(chunk.content)]
    if best_entry is None and not relevant_chunks:
        return "I couldn't find that information in this project's help content. Please contact the support team.", None

    source_title = best_entry.title if best_entry else await session.scalar(
        select(KnowledgeSource.title).join(KnowledgeChunk).where(KnowledgeChunk.id == relevant_chunks[0].id)
    )
    context_parts = []
    if best_entry:
        context_parts.append(f"{best_entry.title}: {best_entry.content}")
    for chunk in relevant_chunks[:4]:
        context_parts.append(chunk.content)
    context = "\n\n".join(dict.fromkeys(context_parts))

    provider = get_chat_provider()
    if provider:
        answer = await provider.complete(
            "Answer only from supplied support content. If it does not answer the question, say so. Keep replies concise.",
            f"Support content ({source_title}):\n{context}\n\nCustomer question: {question}",
        )
        return answer, source_title

    # Local deterministic fallback demonstrates retrieval without claiming to be an LLM.
    return f"From {source_title}: {context}", source_title

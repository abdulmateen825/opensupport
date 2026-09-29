import re

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import settings
from backend.app.models import Conversation, KnowledgeEntry


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
    best = ranked[0][1] if ranked and ranked[0][0] else None
    if best is None:
        return "I couldn't find that information in this project's help content. Please contact the support team.", None

    if settings.llm_api_key and settings.llm_model:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                settings.llm_base_url.rstrip("/") + "/chat/completions",
                json={"model": settings.llm_model, "temperature": 0.2, "messages": [
                    {"role": "system", "content": "Answer only from supplied support content. If it does not answer the question, say so. Keep replies concise."},
                    {"role": "user", "content": f"Support content ({best.title}):\n{best.content}\n\nCustomer question: {question}"},
                ]},
                headers={"Authorization": f"Bearer {settings.llm_api_key}"},
            )
            response.raise_for_status()
            return response.json()["choices"][0]["message"]["content"].strip(), best.title

    # Local deterministic fallback demonstrates retrieval without claiming to be an LLM.
    return f"From {best.title}: {best.content}", best.title

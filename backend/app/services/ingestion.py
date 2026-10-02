import asyncio
import ipaddress
import socket
from datetime import datetime, timezone
from html.parser import HTMLParser
from io import BytesIO
from urllib.parse import urlparse
from uuid import UUID

import httpx
from pypdf import PdfReader
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.app.core.config import settings
from backend.app.models import KnowledgeChunk, KnowledgeEntry, KnowledgeSource, Project
from backend.app.services.storage import get_object
from backend.app.services.vector_store import index_chunks, remove_chunk_vectors


class _TextExtractor(HTMLParser):
    def __init__(self):
        super().__init__()
        self.parts: list[str] = []
        self.skip_depth = 0

    def handle_starttag(self, tag: str, attrs):
        if tag in {"script", "style", "noscript", "svg"}:
            self.skip_depth += 1

    def handle_endtag(self, tag: str):
        if tag in {"script", "style", "noscript", "svg"} and self.skip_depth:
            self.skip_depth -= 1

    def handle_data(self, data: str):
        if not self.skip_depth and data.strip():
            self.parts.append(data.strip())


async def validate_public_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Use an http or https URL without embedded credentials")
    try:
        answers = await asyncio.to_thread(socket.getaddrinfo, parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
    except OSError as exc:
        raise ValueError("The website host could not be resolved") from exc
    for answer in answers:
        address = ipaddress.ip_address(answer[4][0])
        if not address.is_global:
            raise ValueError("Private and local network addresses cannot be ingested")


async def _fetch_webpage(url: str) -> str:
    await validate_public_url(url)
    async with httpx.AsyncClient(timeout=20, follow_redirects=False) as client:
        async with client.stream("GET", url, headers={"User-Agent": "OpenSupportKnowledgeBot/1.0"}) as response:
            response.raise_for_status()
            if "text/html" not in response.headers.get("content-type", "").lower():
                raise ValueError("The URL must return an HTML page")
            size = 0
            body = bytearray()
            async for part in response.aiter_bytes():
                size += len(part)
                if size > settings.ingestion_max_bytes:
                    raise ValueError("The webpage exceeds the configured ingestion size limit")
                body.extend(part)
    parser = _TextExtractor()
    parser.feed(bytes(body).decode("utf-8", errors="replace"))
    return "\n".join(parser.parts)


def _chunks(text: str, max_chars: int = 1400, overlap: int = 180) -> list[str]:
    cleaned = " ".join(text.split())
    result = []
    start = 0
    while start < len(cleaned):
        end = min(start + max_chars, len(cleaned))
        if end < len(cleaned):
            boundary = cleaned.rfind(" ", start + max_chars // 2, end)
            if boundary > start:
                end = boundary
        chunk = cleaned[start:end].strip()
        if chunk:
            result.append(chunk)
        if end >= len(cleaned):
            break
        start = max(end - overlap, start + 1)
    return result


async def _extract(source: KnowledgeSource, session) -> str:
    if source.kind == "url" and source.source_url:
        return await _fetch_webpage(source.source_url)
    if source.kind == "pdf" and source.storage_key:
        data = await get_object(source.storage_key)
        reader = PdfReader(BytesIO(data))
        return "\n".join(page.extract_text() or "" for page in reader.pages)
    if source.kind == "text" and source.knowledge_entry_id:
        entry = await session.get(KnowledgeEntry, source.knowledge_entry_id)
        return f"{entry.title}\n{entry.content}" if entry else ""
    raise ValueError("Unsupported or incomplete knowledge source")


async def _process_source(source_id: UUID) -> dict:
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as session:
            source = await session.get(KnowledgeSource, source_id)
            if source is None:
                return {"status": "missing"}
            project = await session.get(Project, source.project_id)
            if project is None:
                raise ValueError("The source project no longer exists")
            source.status = "processing"
            source.error = None
            await session.commit()
            try:
                content = await _extract(source, session)
                pieces = _chunks(content)
                if not pieces:
                    raise ValueError("No readable text was found in the source")
                old_chunks = list((await session.scalars(select(KnowledgeChunk).where(
                    KnowledgeChunk.source_id == source.id,
                ))).all())
                chunks = [KnowledgeChunk(
                    source_id=source.id, project_id=project.id, organization_id=project.organization_id,
                    chunk_index=index, content=piece,
                ) for index, piece in enumerate(pieces)]
                session.add_all(chunks)
                await session.flush()
                await index_chunks(chunks)
                try:
                    await remove_chunk_vectors([str(chunk.id) for chunk in old_chunks])
                except Exception:
                    # Old points are ignored because search validates IDs against PostgreSQL.
                    pass
                for old_chunk in old_chunks:
                    await session.delete(old_chunk)
                source.status = "ready"
                source.last_indexed_at = datetime.now(timezone.utc)
                await session.commit()
                return {"status": "ready", "chunks": len(chunks)}
            except Exception as exc:
                await session.rollback()
                failed = await session.get(KnowledgeSource, source_id)
                if failed:
                    failed.status = "failed"
                    failed.error = str(exc)[:1000]
                    await session.commit()
                raise
    finally:
        await engine.dispose()


def process_source(source_id: str) -> dict:
    return asyncio.run(_process_source(UUID(source_id)))

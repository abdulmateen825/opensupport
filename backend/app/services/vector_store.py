import logging

import httpx
from qdrant_client import AsyncQdrantClient, models
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import settings
from backend.app.models import KnowledgeChunk

logger = logging.getLogger(__name__)
COLLECTION = "opensupport_chunks_v1"


async def embed_texts(values: list[str]) -> list[list[float]] | None:
    if not settings.embedding_model or not settings.llm_api_key:
        return None
    vectors: list[list[float]] = []
    async with httpx.AsyncClient(timeout=45) as client:
        for start in range(0, len(values), 48):
            batch = values[start:start + 48]
            response = await client.post(
                settings.llm_base_url.rstrip("/") + "/embeddings",
                headers={"Authorization": f"Bearer {settings.llm_api_key}"},
                json={"model": settings.embedding_model, "input": batch},
            )
            response.raise_for_status()
            vectors.extend(item["embedding"] for item in sorted(response.json()["data"], key=lambda row: row["index"]))
    return vectors


async def index_chunks(chunks: list[KnowledgeChunk]) -> bool:
    if not chunks:
        return True
    client = AsyncQdrantClient(url=settings.qdrant_url)
    try:
        first_vectors = await embed_texts([chunk.content for chunk in chunks[:48]])
        if not first_vectors:
            return False
        if not await client.collection_exists(COLLECTION):
            await client.create_collection(
                collection_name=COLLECTION,
                vectors_config=models.VectorParams(size=len(first_vectors[0]), distance=models.Distance.COSINE),
            )
        else:
            info = await client.get_collection(COLLECTION)
            configured = info.config.params.vectors
            if isinstance(configured, models.VectorParams) and configured.size != len(first_vectors[0]):
                raise ValueError("The configured embedding model dimension differs from the existing Qdrant collection")
        for start in range(0, len(chunks), 48):
            batch = chunks[start:start + 48]
            vectors = first_vectors if start == 0 else await embed_texts([chunk.content for chunk in batch])
            if not vectors:
                raise RuntimeError("Embedding provider returned no vectors for a chunk batch")
            await client.upsert(
                collection_name=COLLECTION,
                points=[models.PointStruct(
                    id=str(chunk.id), vector=vector,
                    payload={
                        "chunk_id": str(chunk.id), "source_id": str(chunk.source_id),
                        "project_id": str(chunk.project_id), "organization_id": str(chunk.organization_id),
                    },
                ) for chunk, vector in zip(batch, vectors, strict=True)],
            )
        return True
    finally:
        await client.close()


async def search_chunks(session: AsyncSession, project_id, organization_id, query: str, limit: int = 4) -> list[KnowledgeChunk]:
    vectors = await embed_texts([query])
    if vectors:
        client = AsyncQdrantClient(url=settings.qdrant_url)
        try:
            result = await client.query_points(
                collection_name=COLLECTION,
                query=vectors[0],
                query_filter=models.Filter(must=[
                    models.FieldCondition(key="project_id", match=models.MatchValue(value=str(project_id))),
                    models.FieldCondition(key="organization_id", match=models.MatchValue(value=str(organization_id))),
                ]),
                limit=limit,
                score_threshold=0.32,
                with_payload=True,
            )
            ids = [str(point.payload["chunk_id"]) for point in result.points if point.payload and point.payload.get("chunk_id")]
            if ids:
                found = (await session.scalars(select(KnowledgeChunk).where(
                    KnowledgeChunk.id.in_(ids),
                    KnowledgeChunk.project_id == project_id,
                    KnowledgeChunk.organization_id == organization_id,
                ))).all()
                by_id = {str(chunk.id): chunk for chunk in found}
                return [by_id[item] for item in ids if item in by_id]
        except Exception:
            logger.exception("Vector search failed; using tenant-scoped lexical search")
        finally:
            await client.close()

    terms = {term for term in query.lower().split() if len(term) > 2}
    if not terms:
        return []
    candidates = (await session.scalars(select(KnowledgeChunk).where(
        KnowledgeChunk.project_id == project_id,
        KnowledgeChunk.organization_id == organization_id,
    ))).all()
    ranked = sorted(
        candidates,
        key=lambda chunk: sum(term in chunk.content.lower() for term in terms),
        reverse=True,
    )
    return [chunk for chunk in ranked if any(term in chunk.content.lower() for term in terms)][:limit]


async def remove_source_vectors(project_id, organization_id, source_id) -> None:
    client = AsyncQdrantClient(url=settings.qdrant_url)
    try:
        if await client.collection_exists(COLLECTION):
            await client.delete(
                collection_name=COLLECTION,
                points_selector=models.FilterSelector(filter=models.Filter(must=[
                    models.FieldCondition(key="project_id", match=models.MatchValue(value=str(project_id))),
                    models.FieldCondition(key="organization_id", match=models.MatchValue(value=str(organization_id))),
                    models.FieldCondition(key="source_id", match=models.MatchValue(value=str(source_id))),
                ])),
            )
    finally:
        await client.close()


async def remove_chunk_vectors(chunk_ids: list[str]) -> None:
    if not chunk_ids:
        return
    client = AsyncQdrantClient(url=settings.qdrant_url)
    try:
        if await client.collection_exists(COLLECTION):
            await client.delete(collection_name=COLLECTION, points_selector=chunk_ids)
    finally:
        await client.close()

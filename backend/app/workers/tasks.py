import asyncio
from datetime import datetime, timezone

import httpx
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.app.core.config import settings
from backend.app.models import WebhookDelivery
from backend.app.services.ingestion import process_source
from backend.app.services.webhook_delivery import deliver_webhook as _deliver_webhook
from backend.app.workers.celery_app import celery_app


@celery_app.task(
    name="opensupport.process_knowledge_source",
    autoretry_for=(httpx.HTTPError, ConnectionError, TimeoutError),
    retry_backoff=True,
    retry_kwargs={"max_retries": 3},
)
def process_knowledge_source(source_id: str):
    return process_source(source_id)


@celery_app.task(
    name="opensupport.deliver_webhook",
    autoretry_for=(httpx.HTTPError, ConnectionError, TimeoutError),
    retry_backoff=True,
    retry_kwargs={"max_retries": 7},
)
def deliver_webhook(delivery_id: str):
    return _deliver_webhook(delivery_id)


async def _sweep_webhook_deliveries() -> int:
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as session:
            now = datetime.now(timezone.utc)
            due = (await session.scalars(select(WebhookDelivery).where(
                or_(
                    WebhookDelivery.status == "queued",
                    (WebhookDelivery.status == "pending") & (
                        WebhookDelivery.next_attempt_at.is_(None) | (WebhookDelivery.next_attempt_at <= now)
                    ),
                    (WebhookDelivery.status == "sending") & (WebhookDelivery.next_attempt_at <= now),
                )
            ).order_by(WebhookDelivery.created_at).limit(100).with_for_update(skip_locked=True))).all()
            ids = [str(item.id) for item in due]
            for item in due:
                item.status = "queued"
            await session.commit()
        for delivery_id in ids:
            deliver_webhook.delay(delivery_id)
        return len(ids)
    finally:
        await engine.dispose()


@celery_app.task(name="opensupport.sweep_webhook_deliveries")
def sweep_webhook_deliveries():
    return asyncio.run(_sweep_webhook_deliveries())

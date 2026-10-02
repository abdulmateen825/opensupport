import asyncio
import logging
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.models import WebhookDelivery, WebhookEndpoint

logger = logging.getLogger(__name__)


async def emit_webhook_event(
    session: AsyncSession, organization_id: UUID, project_id: UUID, event_type: str, payload: dict,
) -> None:
    """Persist matching deliveries before queueing them for async dispatch."""
    endpoints = (await session.scalars(select(WebhookEndpoint).where(
        WebhookEndpoint.organization_id == organization_id,
        WebhookEndpoint.enabled.is_(True),
        or_(WebhookEndpoint.project_id.is_(None), WebhookEndpoint.project_id == project_id),
        WebhookEndpoint.events.contains([event_type]),
    ))).all()
    if not endpoints:
        return
    deliveries = [WebhookDelivery(
        endpoint_id=endpoint.id, event_type=event_type, payload=payload, status="queued",
    ) for endpoint in endpoints]
    session.add_all(deliveries)
    await session.commit()
    from backend.app.workers.tasks import deliver_webhook
    for delivery in deliveries:
        try:
            await asyncio.to_thread(deliver_webhook.delay, str(delivery.id))
        except Exception:
            logger.exception("Webhook delivery %s is persisted but could not be queued", delivery.id)

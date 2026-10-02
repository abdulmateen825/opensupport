import asyncio
import hashlib
import hmac
import json
from datetime import datetime, timedelta, timezone
from uuid import UUID

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.app.core.config import settings
from backend.app.models import WebhookDelivery, WebhookEndpoint
from backend.app.services.encryption import decrypt_secret
from backend.app.services.ingestion import validate_public_url


async def _deliver(delivery_id: UUID) -> dict:
    engine = create_async_engine(settings.database_url, pool_pre_ping=True)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as session:
            delivery = await session.scalar(select(WebhookDelivery).where(
                WebhookDelivery.id == delivery_id,
            ).with_for_update())
            now = datetime.now(timezone.utc)
            if delivery is None or delivery.status in {"delivered", "cancelled", "failed"}:
                return {"status": "missing_or_delivered"}
            if delivery.status in {"pending", "sending"} and delivery.next_attempt_at and delivery.next_attempt_at > now:
                return {"status": "waiting_for_retry_window"}
            endpoint = await session.get(WebhookEndpoint, delivery.endpoint_id)
            if endpoint is None or not endpoint.enabled:
                delivery.status = "cancelled"
                await session.commit()
                return {"status": "cancelled"}
            try:
                if not endpoint.url.startswith("https://"):
                    raise ValueError("Webhook delivery requires HTTPS")
                await validate_public_url(endpoint.url)
            except ValueError as exc:
                delivery.status = "failed"
                delivery.last_error = str(exc)[:1000]
                await session.commit()
                raise
            delivery.attempts += 1
            delivery.status = "sending"
            delivery.next_attempt_at = now + timedelta(seconds=min(3600, 30 * (2 ** min(delivery.attempts - 1, 7))))
            await session.commit()
            body = json.dumps({
                "id": str(delivery.id), "type": delivery.event_type,
                "created_at": delivery.created_at.isoformat(), "data": delivery.payload,
            }, separators=(",", ":"), sort_keys=True).encode()
            secret = decrypt_secret(endpoint.encrypted_secret)
            signature = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
            try:
                async with httpx.AsyncClient(timeout=10, follow_redirects=False) as client:
                    async with client.stream("POST", endpoint.url, content=body, headers={
                        "Content-Type": "application/json",
                        "User-Agent": "OpenSupport-Webhooks/1.0",
                        "X-OpenSupport-Event": delivery.event_type,
                        "X-OpenSupport-Delivery": str(delivery.id),
                        "X-OpenSupport-Signature": f"sha256={signature}",
                    }) as response:
                        response_code = response.status_code
                        response.raise_for_status()
            except Exception as exc:
                delivery.status = "pending" if delivery.attempts < 8 else "failed"
                delivery.response_code = getattr(getattr(exc, "response", None), "status_code", None)
                delivery.last_error = str(exc)[:1000]
                await session.commit()
                raise
            delivery.status = "delivered"
            delivery.response_code = response_code
            delivery.last_error = None
            delivery.delivered_at = datetime.now(timezone.utc)
            delivery.next_attempt_at = None
            await session.commit()
            return {"status": "delivered", "response_code": response_code}
    finally:
        await engine.dispose()


def deliver_webhook(delivery_id: str) -> dict:
    return asyncio.run(_deliver(UUID(delivery_id)))

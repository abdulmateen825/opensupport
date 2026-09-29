import logging

import httpx

from backend.app.core.config import settings

logger = logging.getLogger(__name__)


async def send_escalation_notification(conversation_id: str, reason: str) -> None:
    """Send optional Resend email; no configured email service leaves escalation in the inbox."""
    if not (settings.resend_api_key and settings.escalation_notification_email):
        return
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(
                "https://api.resend.com/emails",
                headers={"Authorization": f"Bearer {settings.resend_api_key}"},
                json={
                    "from": settings.resend_from_email,
                    "to": [settings.escalation_notification_email],
                    "subject": "OpenSupport conversation needs a reply",
                    "text": f"Conversation {conversation_id} was escalated. Reason: {reason.replace('_', ' ')}.",
                },
            )
            response.raise_for_status()
    except httpx.HTTPError:
        logger.exception("Could not send escalation notification for conversation %s", conversation_id)

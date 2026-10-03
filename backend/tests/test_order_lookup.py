from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api import routes
from backend.app.models import Conversation, Integration, Project
from backend.app.schemas import OrderStatusRequest


def context(monkeypatch, payload=None, status=200, verified=True):
    project = Project(id=uuid4(), organization_id=uuid4(), allowed_domains=["localhost:3002"])
    conversation = Conversation(id=uuid4(), project_id=project.id, visitor_id="customer-1", visitor_verified=verified)
    integration = Integration(base_url="https://orders.example.com", encrypted_token="encrypted")
    session = MagicMock(spec=AsyncSession)
    session.get.side_effect = [conversation, project]
    session.scalar.return_value = integration
    client = AsyncMock()
    client.get.return_value = httpx.Response(status, json=payload, request=httpx.Request("GET", "https://orders.example.com"))
    client.__aenter__.return_value = client
    monkeypatch.setattr(routes.httpx, "AsyncClient", lambda **kwargs: client)
    monkeypatch.setattr(routes, "decrypt_secret", lambda value: "test-token")
    request = Request({"type": "http", "headers": [(b"origin", b"http://localhost:3002")]})
    return conversation, session, request, client


@pytest.mark.asyncio
async def test_lookup_only_returns_safe_fields_and_passes_verified_customer(monkeypatch):
    conversation, session, request, client = context(monkeypatch, {"status": "shipped", "total": 48, "email": "private@example.com"})
    result = await routes.get_order_status(conversation.id, OrderStatusRequest(order_id="NS-1002"), request, session)
    assert result == {"order_id": "NS-1002", "status": "shipped", "total": 48}
    assert client.get.call_args.kwargs["headers"]["X-Verified-Customer-ID"] == "customer-1"


@pytest.mark.asyncio
@pytest.mark.parametrize("status,payload,expected", [(404, {}, 404), (500, {}, 502), (200, [], 502), (200, {"total": 10}, 502)])
async def test_lookup_handles_missing_and_invalid_upstream_orders(monkeypatch, status, payload, expected):
    conversation, session, request, client = context(monkeypatch, payload, status)
    with pytest.raises(HTTPException) as error:
        await routes.get_order_status(conversation.id, OrderStatusRequest(order_id="missing"), request, session)
    assert error.value.status_code == expected


@pytest.mark.asyncio
async def test_unverified_customer_cannot_call_order_service(monkeypatch):
    conversation, session, request, client = context(monkeypatch, {"status": "shipped"}, verified=False)
    with pytest.raises(HTTPException) as error:
        await routes.get_order_status(conversation.id, OrderStatusRequest(order_id="NS-1002"), request, session)
    assert error.value.status_code == 403
    client.get.assert_not_awaited()


@pytest.mark.asyncio
async def test_lookup_normalizes_decimal_totals_and_ignores_nested_fields(monkeypatch):
    conversation, session, request, client = context(monkeypatch, {
        "status": "shipped", "total": "48.00", "currency": "USD", "estimated_delivery": {"private": "data"},
    })
    result = await routes.get_order_status(conversation.id, OrderStatusRequest(order_id="NS-1002"), request, session)
    assert result == {"order_id": "NS-1002", "status": "shipped", "total": 48.0, "currency": "USD"}

import json
from unittest.mock import AsyncMock, MagicMock
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException, Request
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.api import routes
from backend.app.models import Project
from backend.app.services import shopping
from backend.app.services.shopping import ShoppingIntent, ShoppingIntentRequest, interpret_shopping, keyword_intent


def test_budget_parsing_and_intent_validation():
    assert keyword_intent("Find a bottle under $40").max_price == 40
    intent = keyword_intent("A gift between $20 and $50")
    assert (intent.min_price, intent.max_price) == (20, 50)
    for payload in [{"product_ids": ["invented"]}, {"max_price": "40"}, {"max_price": -1},
                    {"min_price": 50, "max_price": 10}, {"attributes": ["x" * 81]}]:
        with pytest.raises(ValidationError):
            ShoppingIntent.model_validate(payload)
    with pytest.raises(ValidationError):
        ShoppingIntentRequest(query=" ")


@pytest.mark.asyncio
async def test_no_provider_is_explicit_keyword_fallback(monkeypatch):
    monkeypatch.setattr(shopping, "get_chat_provider", lambda: None)
    result = await interpret_shopping(ShoppingIntentRequest(query="Find me a bottle under $40"))
    assert result["mode"] == "keyword"
    assert result["intent"]["max_price"] == 40


@pytest.mark.asyncio
async def test_model_intent_is_validated_and_cannot_widen_explicit_budget(monkeypatch):
    provider = MagicMock()
    provider.complete = AsyncMock(return_value=json.dumps({"search_text": "bottle", "category": "drinkware", "max_price": 100}))
    monkeypatch.setattr(shopping, "get_chat_provider", lambda: provider)
    result = await interpret_shopping(ShoppingIntentRequest(query="Find a bottle under $40", categories=["drinkware", "bags"]))
    assert result["mode"] == "ai"
    assert result["intent"]["max_price"] == 40
    assert provider.complete.call_args.args[1] == "Find a bottle under $40"


@pytest.mark.asyncio
@pytest.mark.parametrize("output", ["not json", "[]", '{"product_ids":["hallucinated"]}',
                                      '{"category":"unknown"}', '{"max_price":-1}', '{"max_price":"cheap"}'])
async def test_invalid_model_output_falls_back_without_exposing_invented_products(monkeypatch, output):
    provider = MagicMock()
    provider.complete = AsyncMock(return_value=output)
    monkeypatch.setattr(shopping, "get_chat_provider", lambda: provider)
    result = await interpret_shopping(ShoppingIntentRequest(query="Find a bottle under $40", categories=["drinkware"]))
    assert result["mode"] == "keyword"
    assert result["intent"]["max_price"] == 40
    assert "product_ids" not in result["intent"]


@pytest.mark.asyncio
async def test_provider_outage_falls_back(monkeypatch):
    provider = MagicMock()
    provider.complete = AsyncMock(side_effect=httpx.ConnectError("offline"))
    monkeypatch.setattr(shopping, "get_chat_provider", lambda: provider)
    result = await interpret_shopping(ShoppingIntentRequest(query="Find a gift under $50"))
    assert result["mode"] == "keyword"
    assert result["intent"]["max_price"] == 50


@pytest.mark.asyncio
async def test_project_endpoint_rejects_unknown_project_and_wrong_origin(monkeypatch):
    interpret = AsyncMock()
    monkeypatch.setattr(routes, "interpret_shopping", interpret)
    session = MagicMock(spec=AsyncSession)
    project_id = uuid4()
    request = Request({"type": "http", "headers": [(b"origin", b"https://other.example")]})
    body = ShoppingIntentRequest(query="Find a bottle")
    session.get.return_value = None
    with pytest.raises(HTTPException) as missing:
        await routes.get_shopping_intent(project_id, body, request, session)
    assert missing.value.status_code == 404
    session.get.return_value = Project(id=project_id, organization_id=uuid4(), allowed_domains=["shop.example"])
    with pytest.raises(HTTPException) as forbidden:
        await routes.get_shopping_intent(project_id, body, request, session)
    assert forbidden.value.status_code == 403
    interpret.assert_not_awaited()


@pytest.mark.asyncio
async def test_project_endpoint_uses_only_requested_project(monkeypatch):
    project_id = uuid4()
    session = MagicMock(spec=AsyncSession)
    session.get.return_value = Project(id=project_id, organization_id=uuid4(), allowed_domains=["shop.example"])
    interpret = AsyncMock(return_value={"mode": "keyword", "intent": {}})
    monkeypatch.setattr(routes, "interpret_shopping", interpret)
    request = Request({"type": "http", "headers": [(b"origin", b"https://shop.example")]})
    await routes.get_shopping_intent(project_id, ShoppingIntentRequest(query="Find a bottle"), request, session)
    session.get.assert_awaited_once_with(Project, project_id)
    interpret.assert_awaited_once()

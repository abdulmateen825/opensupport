from types import SimpleNamespace
import base64
import json
import time
from uuid import uuid4

import pytest
from fastapi import HTTPException

from backend.app.core.security import (
    create_widget_identity,
    decode_token,
    encode_token,
    hash_password,
    verify_password,
    verify_widget_identity,
)


def test_password_hash_verifies_only_the_original_password():
    hashed = hash_password("correct horse battery staple")

    assert hashed != "correct horse battery staple"
    assert verify_password("correct horse battery staple", hashed)
    assert not verify_password("wrong password", hashed)


def test_access_token_round_trip_and_rejects_wrong_type():
    user_id = uuid4()
    user = SimpleNamespace(id=user_id, token_version=2)
    token = encode_token(user, "access", 60)

    claims = decode_token(token, "access")
    assert claims["sub"] == str(user_id)
    assert claims["ver"] == 2
    with pytest.raises(HTTPException) as error:
        decode_token(token, "refresh")
    assert error.value.status_code == 401


def test_widget_identity_is_bound_to_a_project():
    project_id = uuid4()
    token = create_widget_identity(project_id, "customer-123")

    assert verify_widget_identity(token, project_id) == "customer-123"
    with pytest.raises(ValueError):
        verify_widget_identity(token, uuid4())


def test_widget_identity_uses_configured_default_lifetime(monkeypatch):
    from backend.app.core.security import settings
    monkeypatch.setattr(settings, "identity_token_minutes", 2)
    before = int(time.time())
    payload = create_widget_identity(uuid4(), "customer").split(".")[1]
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    assert before + 120 <= claims["exp"] <= int(time.time()) + 120


def test_tampered_access_token_is_rejected():
    user = SimpleNamespace(id=uuid4(), token_version=0)
    token = encode_token(user, "access", 60)
    header, claims, signature = token.split(".")
    # Change significant bits; the last base64 character can differ only in padding bits.
    altered_signature = ("A" if signature[0] != "A" else "B") + signature[1:]
    altered = f"{header}.{claims}.{altered_signature}"

    with pytest.raises(HTTPException) as error:
        decode_token(altered, "access")
    assert error.value.status_code == 401

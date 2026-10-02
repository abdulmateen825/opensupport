from types import SimpleNamespace
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


def test_tampered_access_token_is_rejected():
    user = SimpleNamespace(id=uuid4(), token_version=0)
    token = encode_token(user, "access", 60)
    altered = token[:-1] + ("A" if token[-1] != "A" else "B")

    with pytest.raises(HTTPException) as error:
        decode_token(altered, "access")
    assert error.value.status_code == 401

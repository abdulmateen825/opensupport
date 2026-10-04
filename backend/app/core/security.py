import base64
import hashlib
import hmac
import json
import secrets
import time
from collections.abc import Callable
from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.app.core.config import settings
from backend.app.db.session import get_session
from backend.app.models import APIKey, User

_bearer = HTTPBearer(auto_error=False)
_ITERATIONS = 310_000


def _b64encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).rstrip(b"=").decode("ascii")


def _b64decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, _ITERATIONS)
    return f"pbkdf2_sha256${_ITERATIONS}${_b64encode(salt)}${_b64encode(hashed)}"


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, iterations, salt, expected = stored.split("$", 3)
        if scheme != "pbkdf2_sha256":
            return False
        candidate = hashlib.pbkdf2_hmac("sha256", password.encode(), _b64decode(salt), int(iterations))
        return hmac.compare_digest(candidate, _b64decode(expected))
    except (ValueError, TypeError):
        return False


def encode_token(user: User, token_type: str, lifetime_seconds: int) -> str:
    now = int(time.time())
    header = _b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    claims = _b64encode(json.dumps({
        "sub": str(user.id), "ver": user.token_version, "typ": token_type,
        "iat": now, "exp": now + lifetime_seconds,
    }, separators=(",", ":")).encode())
    signing_input = f"{header}.{claims}".encode()
    signature = hmac.new(settings.app_secret_key.encode(), signing_input, hashlib.sha256).digest()
    return f"{header}.{claims}.{_b64encode(signature)}"


def create_widget_identity(project_id: UUID, visitor_id: str, lifetime_seconds: int | None = None) -> str:
    """Sign visitor identity on the trusted company backend, never in browser JavaScript."""
    now = int(time.time())
    if lifetime_seconds is None:
        lifetime_seconds = settings.identity_token_minutes * 60
    header = _b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}, separators=(",", ":")).encode())
    claims = _b64encode(json.dumps({
        "project_id": str(project_id), "visitor_id": visitor_id[:160], "typ": "widget_identity",
        "iat": now, "exp": now + lifetime_seconds,
    }, separators=(",", ":")).encode())
    signed = f"{header}.{claims}".encode()
    secret = settings.widget_identity_secret or settings.app_secret_key
    signature = hmac.new(secret.encode(), signed, hashlib.sha256).digest()
    return f"{header}.{claims}.{_b64encode(signature)}"


def verify_widget_identity(token: str, project_id: UUID) -> str:
    header, payload, signature = token.split(".", 2)
    signed = f"{header}.{payload}".encode()
    secret = settings.widget_identity_secret or settings.app_secret_key
    expected = hmac.new(secret.encode(), signed, hashlib.sha256).digest()
    if not hmac.compare_digest(expected, _b64decode(signature)):
        raise ValueError("Invalid identity signature")
    claims = json.loads(_b64decode(payload))
    if claims.get("typ") != "widget_identity" or claims.get("project_id") != str(project_id):
        raise ValueError("Identity token has the wrong purpose or project")
    if int(claims.get("exp", 0)) <= int(time.time()) or not claims.get("visitor_id"):
        raise ValueError("Identity token expired or lacks a visitor id")
    return str(claims["visitor_id"])[:160]


def decode_token(token: str, expected_type: str) -> dict:
    try:
        header, payload, signature = token.split(".", 2)
        signed = f"{header}.{payload}".encode()
        expected = hmac.new(settings.app_secret_key.encode(), signed, hashlib.sha256).digest()
        if not hmac.compare_digest(expected, _b64decode(signature)):
            raise ValueError("bad signature")
        if json.loads(_b64decode(header)).get("alg") != "HS256":
            raise ValueError("bad algorithm")
        claims = json.loads(_b64decode(payload))
        if claims.get("typ") != expected_type or int(claims.get("exp", 0)) <= int(time.time()):
            raise ValueError("expired or wrong token type")
        UUID(claims["sub"])
        return claims
    except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token") from exc


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    session: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    if credentials is None:
        raise HTTPException(status_code=401, detail="Authentication required", headers={"WWW-Authenticate": "Bearer"})
    token = credentials.credentials
    if token.startswith("osk_live_"):
        key_hash = hashlib.sha256(token.encode()).hexdigest()
        api_key = await session.scalar(select(APIKey).where(
            APIKey.key_hash == key_hash, APIKey.revoked_at.is_(None),
        ))
        if api_key is None or (api_key.expires_at and api_key.expires_at <= datetime.now(timezone.utc)):
            raise HTTPException(status_code=401, detail="Invalid or expired API key")
        user = await session.get(User, api_key.created_by_id) if api_key.created_by_id else None
        if user is None or not user.is_active or user.organization_id != api_key.organization_id:
            raise HTTPException(status_code=401, detail="API key owner is inactive")
        api_key.last_used_at = datetime.now(timezone.utc)
        await session.commit()
        return user
    claims = decode_token(token, "access")
    user = await session.get(User, UUID(claims["sub"]))
    if user is None or not user.is_active or user.token_version != claims.get("ver"):
        raise HTTPException(status_code=401, detail="Invalid or revoked account")
    return user


def require_roles(*roles: str) -> Callable:
    async def dependency(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="You do not have permission for this action")
        return user
    return dependency

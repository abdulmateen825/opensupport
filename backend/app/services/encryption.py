import hashlib
import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from backend.app.core.config import settings


def _key() -> bytes:
    raw = settings.encryption_key or settings.app_secret_key
    return hashlib.sha256(raw.encode("utf-8")).digest()


def encrypt_secret(value: str) -> bytes:
    nonce = secrets.token_bytes(12)
    return nonce + AESGCM(_key()).encrypt(nonce, value.encode("utf-8"), b"opensupport-integration-v1")


def decrypt_secret(value: bytes) -> str:
    return AESGCM(_key()).decrypt(value[:12], value[12:], b"opensupport-integration-v1").decode("utf-8")

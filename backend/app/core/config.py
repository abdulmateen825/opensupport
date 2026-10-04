from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from urllib.parse import urlparse


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", hide_input_in_errors=True)
    app_env: str = "development"
    app_secret_key: str = "change-me"
    database_url: str = "postgresql+asyncpg://opensupport:opensupport@localhost:5432/opensupport"
    cors_origins: str = "http://localhost:3000,http://localhost:3001,http://localhost:5173"
    llm_api_key: str = ""
    llm_provider: str = "openai-compatible"
    llm_model: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    resend_api_key: str = ""
    escalation_notification_email: str = ""
    resend_from_email: str = "OpenSupport <onboarding@resend.dev>"
    access_token_minutes: int = 20
    refresh_token_days: int = 14
    identity_token_minutes: int = 5
    encryption_key: str = ""
    widget_identity_secret: str = ""
    redis_url: str = "redis://localhost:6379/0"
    qdrant_url: str = "http://localhost:6333"
    s3_endpoint_url: str = "http://localhost:9000"
    s3_access_key_id: str = "opensupport"
    s3_secret_access_key: str = "change-me"
    s3_bucket: str = "opensupport"
    embedding_model: str = ""
    ingestion_max_bytes: int = 10_000_000
    public_rate_limit: int = 90
    auth_rate_limit: int = 12

    @model_validator(mode="after")
    def validate_production_secrets(self):
        if self.app_env.lower() in {"production", "prod"}:
            if self.app_secret_key.startswith("change-me") or len(self.app_secret_key) < 32:
                raise ValueError("APP_SECRET_KEY must be a unique secret of at least 32 characters in production")
            if self.encryption_key.startswith("change-me") or len(self.encryption_key) < 32:
                raise ValueError("ENCRYPTION_KEY must be a unique secret of at least 32 characters in production")
            if self.widget_identity_secret.startswith("change-me") or len(self.widget_identity_secret) < 32:
                raise ValueError("WIDGET_IDENTITY_SECRET must be a unique secret of at least 32 characters in production")
            if len({self.app_secret_key, self.encryption_key, self.widget_identity_secret}) != 3:
                raise ValueError("Production signing and encryption secrets must be distinct")
            if not self.allowed_origins or any(
                urlparse(origin).scheme != "https" or not urlparse(origin).hostname
                or urlparse(origin).path not in {"", "/"} or "*" in origin
                for origin in self.allowed_origins
            ):
                raise ValueError("CORS_ORIGINS must contain explicit HTTPS dashboard origins in production")
        return self

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()

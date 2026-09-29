from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    app_env: str = "development"
    app_secret_key: str = "change-me"
    database_url: str = "postgresql+asyncpg://opensupport:opensupport@localhost:5432/opensupport"
    cors_origins: str = "http://localhost:3000,http://localhost:3001"
    llm_api_key: str = ""
    llm_model: str = ""
    llm_base_url: str = "https://api.openai.com/v1"
    resend_api_key: str = ""
    escalation_notification_email: str = ""
    resend_from_email: str = "OpenSupport <onboarding@resend.dev>"

    @property
    def allowed_origins(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


settings = Settings()

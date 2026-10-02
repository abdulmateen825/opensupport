from __future__ import annotations

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field
from pydantic import field_validator
from urllib.parse import urlparse


def _normalize_domains(values: list[str]) -> list[str]:
    normalized = []
    for value in values:
        candidate = value.strip().lower()
        if not candidate:
            continue
        parsed = urlparse(candidate if "://" in candidate else "//" + candidate)
        if not parsed.netloc or parsed.path not in ("", "/"):
            raise ValueError("Domains must be host names with optional ports, not paths")
        normalized.append(parsed.netloc)
    return list(dict.fromkeys(normalized))


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    allowed_domains: list[str] = Field(default_factory=list, max_length=25)

    @field_validator("allowed_domains")
    @classmethod
    def normalize_domains(cls, values: list[str]) -> list[str]:
        return _normalize_domains(values)


class ProjectUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    allowed_domains: list[str] | None = Field(default=None, max_length=25)

    @field_validator("allowed_domains")
    @classmethod
    def normalize_domains(cls, values: list[str] | None) -> list[str] | None:
        if values is None:
            return None
        return _normalize_domains(values)


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    organization_id: UUID
    allowed_domains: list[str]
    created_at: datetime


class RegisterRequest(BaseModel):
    email: str = Field(min_length=5, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=12, max_length=128)
    organization_name: str = Field(min_length=1, max_length=160)
    display_name: str = Field(min_length=1, max_length=120)


class LoginRequest(BaseModel):
    email: str = Field(min_length=5, max_length=320)
    password: str = Field(min_length=1, max_length=128)


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int
    user: "UserOut"


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    email: str
    display_name: str
    role: str
    organization_id: UUID


class MemberCreate(BaseModel):
    email: str = Field(min_length=5, max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    password: str = Field(min_length=12, max_length=128)
    display_name: str = Field(min_length=1, max_length=120)
    role: str = Field(pattern=r"^(admin|agent)$")


class APIKeyCreate(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    expires_in_days: int | None = Field(default=None, ge=1, le=3650)


class APIKeyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    key_prefix: str
    expires_at: datetime | None
    last_used_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime


class APIKeyCreated(APIKeyOut):
    secret: str


class WebhookCreate(BaseModel):
    url: str = Field(min_length=12, max_length=2000)
    project_id: UUID | None = None
    events: list[str] = Field(min_length=1, max_length=20)


class WebhookOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    project_id: UUID | None
    url: str
    events: list[str]
    enabled: bool
    created_at: datetime


class WebhookCreated(WebhookOut):
    signing_secret: str


class KnowledgeCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=10, max_length=50000)


class KnowledgeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    title: str
    content: str
    created_at: datetime


class KnowledgeSourceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    project_id: UUID
    kind: str
    title: str
    source_url: str | None
    status: str
    error: str | None
    last_indexed_at: datetime | None
    created_at: datetime


class KnowledgeURLCreate(BaseModel):
    url: str = Field(min_length=10, max_length=2000)
    title: str = Field(min_length=1, max_length=240)


class IntegrationCreate(BaseModel):
    kind: str = Field(pattern=r"^order_status$")
    base_url: str = Field(min_length=10, max_length=500)
    token: str = Field(min_length=8, max_length=1000)


class IntegrationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    project_id: UUID
    kind: str
    base_url: str
    enabled: bool
    created_at: datetime


class WidgetSessionCreate(BaseModel):
    identity_token: str | None = Field(default=None, max_length=4000)


class OrderStatusRequest(BaseModel):
    order_id: str = Field(min_length=1, max_length=120)


class RetentionOut(BaseModel):
    retention_days: int


class AnalyticsOut(BaseModel):
    conversations_total: int
    open_conversations: int
    escalated_conversations: int
    resolved_conversations: int
    messages_total: int
    ai_resolved: int


class RetentionUpdate(BaseModel):
    retention_days: int = Field(ge=7, le=3650)


class ConversationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    project_id: UUID
    status: str
    assigned_agent: str | None = None
    escalation_reason: str | None = None
    escalated_at: datetime | None = None
    resolved_at: datetime | None = None
    created_at: datetime


class AgentMessageCreate(BaseModel):
    agent_name: str = Field(min_length=1, max_length=120)
    content: str = Field(min_length=1, max_length=8000)


class ConversationStatusUpdate(BaseModel):
    agent_name: str = Field(min_length=1, max_length=120)


class MessageCreate(BaseModel):
    content: str = Field(min_length=1, max_length=8000)


class MessageOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    sender_type: str
    sender_name: str | None = None
    content: str
    source_title: str | None
    created_at: datetime

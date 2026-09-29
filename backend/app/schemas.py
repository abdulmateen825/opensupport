from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class ProjectCreate(BaseModel):
    name: str = Field(min_length=1, max_length=160)


class ProjectOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    name: str
    created_at: datetime


class KnowledgeCreate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content: str = Field(min_length=10, max_length=50000)


class KnowledgeOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: UUID
    title: str
    content: str
    created_at: datetime


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

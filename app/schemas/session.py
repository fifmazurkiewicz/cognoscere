from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class SomaticMappingItem(BaseModel):
    body_region: str
    sensation: str = Field(..., max_length=200)
    intensity: int = Field(..., ge=1, le=10)


class CreateSessionRequest(BaseModel):
    trigger_text: str = Field(..., min_length=5, max_length=2000)
    wellbeing_before: int = Field(..., ge=1, le=10)


class SomaticSubmitRequest(BaseModel):
    mappings: list[SomaticMappingItem]


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)


class CloseSessionRequest(BaseModel):
    wellbeing_after: int = Field(..., ge=1, le=10)


class MessageOut(BaseModel):
    id: UUID
    role: str
    content: str
    stage: str
    created_at: datetime


class SomaticMappingOut(BaseModel):
    id: UUID
    body_region: str
    sensation: str
    intensity: int


class SessionResponse(BaseModel):
    id: UUID
    status: str
    current_stage: str
    trigger_text: str
    wellbeing_before: int
    wellbeing_after: int | None
    ai_summary: str | None
    crisis_flag: bool
    created_at: datetime
    completed_at: datetime | None
    somatic_mappings: list[SomaticMappingOut]
    messages: list[MessageOut]


class ChatResponse(BaseModel):
    assistant_message: dict
    session_stage: str
    advance_stage: bool
    crisis: bool


class SessionListItem(BaseModel):
    id: UUID
    status: str
    current_stage: str
    trigger_text: str
    wellbeing_before: int
    wellbeing_after: int | None
    created_at: datetime
    completed_at: datetime | None

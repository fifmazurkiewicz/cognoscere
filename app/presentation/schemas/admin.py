from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from app.application.auth_tokens import validate_password_for_bcrypt
from app.domain.user_role import UserRole


class AdminStatsResponse(BaseModel):
    total_users: int
    total_therapists: int
    total_patients: int
    total_admins: int
    total_emotion_sessions: int
    llm_tokens_input_total: int
    llm_tokens_output_total: int


class AdminUserRow(BaseModel):
    id: UUID
    email: str
    role: UserRole
    first_name: str
    display_name: str | None
    llm_token_limit: int
    llm_tokens_input_total: int
    llm_tokens_output_total: int
    emotion_session_count: int
    created_at: datetime
    last_login: datetime | None

    model_config = {"from_attributes": True}


class AdminTokenLimitPatch(BaseModel):
    llm_token_limit: int = Field(..., ge=0, le=2_000_000_000)


class AdminResetPasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=8)

    @field_validator("new_password")
    @classmethod
    def new_password_policy(cls, v: str) -> str:
        return validate_password_for_bcrypt(v)


class AdminRolePatch(BaseModel):
    role: UserRole

    @field_validator("role")
    @classmethod
    def only_clinical_roles(cls, v: UserRole) -> UserRole:
        if v == UserRole.admin:
            raise ValueError("Nie można nadać roli administratora przez ten endpoint")
        return v

from uuid import UUID

from pydantic import BaseModel, EmailStr, Field, field_validator

from app.application.auth_tokens import validate_password_for_bcrypt
from app.domain.user_role import UserRole


class RegisterTherapistRequest(BaseModel):
    email: EmailStr
    password: str
    first_name: str
    professional_title: str | None = None
    gdpr_consent: bool

    @field_validator("professional_title", mode="before")
    @classmethod
    def empty_professional_title(cls, v: object) -> str | None:
        if v is None:
            return None
        if isinstance(v, str):
            s = v.strip()
            return s if s else None
        return None

    @field_validator("password")
    @classmethod
    def password_policy(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Hasło musi mieć co najmniej 8 znaków")
        return validate_password_for_bcrypt(v)

    @field_validator("gdpr_consent")
    @classmethod
    def must_consent(cls, v: bool) -> bool:
        if not v:
            raise ValueError("Wymagana jest zgoda na przetwarzanie danych")
        return v


class RegisterPatientRequest(BaseModel):
    token: str
    email: EmailStr
    password: str
    display_name: str
    gdpr_consent: bool

    @field_validator("password")
    @classmethod
    def password_policy(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Hasło musi mieć co najmniej 8 znaków")
        return validate_password_for_bcrypt(v)

    @field_validator("gdpr_consent")
    @classmethod
    def must_consent(cls, v: bool) -> bool:
        if not v:
            raise ValueError("Wymagana jest zgoda na przetwarzanie danych")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str

    @field_validator("password")
    @classmethod
    def password_bcrypt_limit(cls, v: str) -> str:
        return validate_password_for_bcrypt(v)


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


class UserResponse(BaseModel):
    id: UUID
    email: str
    role: UserRole
    first_name: str
    display_name: str | None
    professional_title: str | None

    model_config = {"from_attributes": True}


class CreateInvitationRequest(BaseModel):
    patient_name_hint: str | None = None


class InvitationResponse(BaseModel):
    token: str
    expires_at: str
    patient_name_hint: str | None
    invite_url: str


class InvitationValidateResponse(BaseModel):
    valid: bool
    therapist_first_name: str
    patient_name_hint: str | None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(..., min_length=8)

    @field_validator("new_password")
    @classmethod
    def new_password_policy(cls, v: str) -> str:
        return validate_password_for_bcrypt(v)


class DeleteAccountRequest(BaseModel):
    password: str

    @field_validator("password")
    @classmethod
    def password_bcrypt_limit(cls, v: str) -> str:
        return validate_password_for_bcrypt(v)

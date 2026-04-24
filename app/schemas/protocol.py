from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

from ..models.protocol import ChallengeIntensity, FOCUS_AREA_OPTIONS, TherapyApproach


class ProtocolUpsertRequest(BaseModel):
    approach: TherapyApproach = TherapyApproach.cbt
    focus_areas: list[str] = Field(default_factory=list)
    patient_context: str = Field(default="", max_length=500)
    ai_instructions: str = Field(default="", max_length=1000)
    challenge_intensity: ChallengeIntensity = ChallengeIntensity.moderate
    somatic_focus: bool = True
    max_session_length: int = Field(default=30, ge=15, le=90)
    crisis_protocol: str = Field(default="", max_length=1000)

    @field_validator("focus_areas")
    @classmethod
    def validate_focus_areas(cls, v: list[str]) -> list[str]:
        for area in v:
            if area not in FOCUS_AREA_OPTIONS:
                raise ValueError(f"Nieznany obszar focus: {area}")
        return v


class ProtocolResponse(BaseModel):
    id: UUID
    patient_id: UUID
    therapist_id: UUID
    approach: TherapyApproach
    focus_areas: list[str]
    patient_context: str
    ai_instructions: str
    challenge_intensity: ChallengeIntensity
    somatic_focus: bool
    max_session_length: int
    crisis_protocol: str
    version: int
    updated_at: datetime

    model_config = {"from_attributes": True}


class PatientSummary(BaseModel):
    id: UUID
    display_name: str | None
    first_name: str
    email: str
    has_protocol: bool

    model_config = {"from_attributes": True}

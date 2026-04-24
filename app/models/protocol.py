import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum as SQLEnum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class TherapyApproach(str, enum.Enum):
    cbt = "cbt"
    act = "act"
    dbt = "dbt"
    psychodynamic = "psychodynamic"
    mixed = "mixed"


class ChallengeIntensity(str, enum.Enum):
    gentle = "gentle"
    moderate = "moderate"
    confrontational = "confrontational"


FOCUS_AREA_OPTIONS = [
    "social_anxiety",
    "depression",
    "anger",
    "trauma",
    "self_esteem",
    "relationships",
    "work_stress",
    "grief",
    "perfectionism",
    "boundaries",
]


class TreatmentProtocol(Base):
    __tablename__ = "treatment_protocols"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    therapist_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"))

    approach: Mapped[TherapyApproach] = mapped_column(
        SQLEnum(TherapyApproach, name="therapyapproach"),
        default=TherapyApproach.cbt,
    )
    focus_areas: Mapped[list] = mapped_column(JSONB, default=list)
    patient_context: Mapped[str] = mapped_column(String(500), default="")
    ai_instructions: Mapped[str] = mapped_column(String(1000), default="")
    challenge_intensity: Mapped[ChallengeIntensity] = mapped_column(
        SQLEnum(ChallengeIntensity, name="challengeintensity"),
        default=ChallengeIntensity.moderate,
    )
    somatic_focus: Mapped[bool] = mapped_column(Boolean, default=True)
    max_session_length: Mapped[int] = mapped_column(Integer, default=30)
    crisis_protocol: Mapped[str] = mapped_column(
        Text,
        default=(
            "Słyszę, że jest Ci teraz bardzo ciężko. "
            "Proszę, zadzwoń na Telefon Zaufania: 116 123 (czynny całą dobę) "
            "lub napisz do swojego terapeuty."
        ),
    )
    version: Mapped[int] = mapped_column(Integer, default=1)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )

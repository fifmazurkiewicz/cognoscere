import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum as SQLEnum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class SessionStatus(str, enum.Enum):
    in_progress = "in_progress"
    completed = "completed"
    crisis = "crisis"


class SessionStage(str, enum.Enum):
    somatic = "somatic"
    emotion_id = "emotion_id"
    thought_excavation = "thought_excavation"
    chain_challenging = "chain_challenging"
    closing = "closing"
    completed = "completed"


STAGE_ORDER = [
    SessionStage.somatic,
    SessionStage.emotion_id,
    SessionStage.thought_excavation,
    SessionStage.chain_challenging,
    SessionStage.closing,
    SessionStage.completed,
]

CHAT_STAGES = {
    SessionStage.emotion_id,
    SessionStage.thought_excavation,
    SessionStage.chain_challenging,
}


class EmotionSession(Base):
    __tablename__ = "emotion_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), index=True)
    status: Mapped[SessionStatus] = mapped_column(
        SQLEnum(SessionStatus, name="sessionstatus"),
        default=SessionStatus.in_progress,
    )
    current_stage: Mapped[SessionStage] = mapped_column(
        SQLEnum(SessionStage, name="sessionstage"),
        default=SessionStage.somatic,
    )
    trigger_text: Mapped[str] = mapped_column(Text)
    wellbeing_before: Mapped[int] = mapped_column(Integer)
    wellbeing_after: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ai_summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    patient_facing_analysis: Mapped[str | None] = mapped_column(Text, nullable=True)
    crisis_flag: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    completed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )


class SomaticMapping(Base):
    __tablename__ = "somatic_mappings"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("emotion_sessions.id"), index=True
    )
    body_region: Mapped[str] = mapped_column(String(50))
    sensation: Mapped[str] = mapped_column(String(200))
    intensity: Mapped[int] = mapped_column(Integer)


class SessionMessage(Base):
    __tablename__ = "session_messages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("emotion_sessions.id"), index=True
    )
    role: Mapped[str] = mapped_column(String(10))
    content: Mapped[str] = mapped_column(Text)
    stage: Mapped[str] = mapped_column(String(30))
    extracted_data: Mapped[dict] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )

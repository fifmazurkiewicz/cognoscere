import enum
import uuid
from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum as SQLEnum, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from ..database import Base


class DailyCheckinSessionStatus(str, enum.Enum):
    in_progress = "in_progress"
    completed = "completed"


class PatientDailyQuestions(Base):
    """Sztywna lista pytań „Daily” ustalona przez terapeutę dla danego pacjenta."""

    __tablename__ = "patient_daily_questions"
    __table_args__ = (UniqueConstraint("patient_id", name="uq_patient_daily_questions_patient"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    therapist_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False)
    questions: Mapped[list] = mapped_column(JSONB, nullable=False)  # list[str]
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=lambda: datetime.now(timezone.utc),
        onupdate=lambda: datetime.now(timezone.utc),
    )


class DailyCheckinSession(Base):
    __tablename__ = "daily_checkin_sessions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    patient_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id"), nullable=False, index=True)
    questions_snapshot: Mapped[list] = mapped_column(JSONB, nullable=False)
    answers: Mapped[list] = mapped_column(JSONB, nullable=False)
    status: Mapped[DailyCheckinSessionStatus] = mapped_column(
        SQLEnum(DailyCheckinSessionStatus, name="dailycheckinsessionstatus"),
        default=DailyCheckinSessionStatus.in_progress,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc)
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

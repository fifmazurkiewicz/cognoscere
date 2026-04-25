from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class DailyQuestionsUpsertRequest(BaseModel):
    questions: list[str] = Field(..., min_length=1, max_length=30)

    @field_validator("questions")
    @classmethod
    def non_empty_strings(cls, v: list[str]) -> list[str]:
        out = [q.strip() for q in v if q and q.strip()]
        if len(out) < 1:
            raise ValueError("Potrzebne jest co najmniej jedno pytanie")
        for q in out:
            if len(q) > 1_000:
                raise ValueError("Każde pytanie może mieć co najwyżej 1000 znaków")
        return out


class DailyQuestionsResponse(BaseModel):
    patient_id: UUID
    questions: list[str]
    is_custom: bool  # False gdy zwracamy wyłącznie domyślny zestaw (brak zapisu u terapeuty)
    # Tylko sensowne przy GET /daily-checkin/questions (pacjent); dla terapeuty — wartości domyślne.
    daily_done_today: bool = False
    has_in_progress_today: bool = False
    in_progress_session_id: UUID | None = None

    model_config = {"from_attributes": True}


class DailyCheckinSessionCreateResponse(BaseModel):
    id: UUID
    questions: list[str]
    current_index: int
    status: str


class DailyCheckinSessionDetail(BaseModel):
    id: UUID
    questions: list[str]
    answers: list[str]
    current_index: int
    status: str
    created_at: datetime
    completed_at: datetime | None


class DailyCheckinSessionListItem(BaseModel):
    id: UUID
    status: str
    question_count: int
    answered_count: int
    created_at: datetime
    completed_at: datetime | None


class DailyAnswerRequest(BaseModel):
    answer: str = Field(..., min_length=1, max_length=8_000)

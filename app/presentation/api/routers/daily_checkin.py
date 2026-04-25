import uuid
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.domain.daily_defaults import DEFAULT_DAILY_QUESTIONS
from app.infrastructure.database import get_db
from app.infrastructure.persistence.daily_checkin import (
    DailyCheckinSession,
    DailyCheckinSessionStatus,
    PatientDailyQuestions,
)
from app.infrastructure.persistence.user import User
from app.presentation.api.deps import require_self_therapy_user, require_therapist
from app.presentation.api.routers.protocols import _get_patient_of_therapist
from app.presentation.schemas.daily_checkin import (
    DailyAnswerRequest,
    DailyCheckinSessionCreateResponse,
    DailyCheckinSessionDetail,
    DailyCheckinSessionListItem,
    DailyQuestionsResponse,
    DailyQuestionsUpsertRequest,
)

router = APIRouter()


def _utc_day_bounds(now: datetime | None = None) -> tuple[datetime, datetime]:
    """Początek bieżącego dnia UTC i początek następnego (do porównań created_at)."""
    anchor = now if now is not None else datetime.now(timezone.utc)
    if anchor.tzinfo is None:
        anchor = anchor.replace(tzinfo=timezone.utc)
    start = anchor.replace(hour=0, minute=0, second=0, microsecond=0)
    return start, start + timedelta(days=1)


async def _close_stale_in_progress_daily_sessions(
    db: AsyncSession,
    patient_id: uuid.UUID,
) -> None:
    """Zamyka sesje „w toku” rozpoczęte przed dzisiejszym dniem UTC (nie blokują nowego Daily)."""
    today_start, _ = _utc_day_bounds()
    stale = list(
        await db.scalars(
            select(DailyCheckinSession).where(
                DailyCheckinSession.patient_id == patient_id,
                DailyCheckinSession.status == DailyCheckinSessionStatus.in_progress,
                DailyCheckinSession.created_at < today_start,
            )
        )
    )
    if not stale:
        return
    now = datetime.now(timezone.utc)
    for s in stale:
        s.status = DailyCheckinSessionStatus.completed
        s.completed_at = now
    await db.commit()


async def _resolve_questions_for_patient(
    db: AsyncSession,
    patient_id: uuid.UUID,
) -> tuple[list[str], bool]:
    row = await db.scalar(
        select(PatientDailyQuestions).where(PatientDailyQuestions.patient_id == patient_id)
    )
    if row is not None and isinstance(row.questions, list) and len(row.questions) > 0:
        qs = [str(q).strip() for q in row.questions if str(q).strip()]
        if qs:
            return qs, True
    return list(DEFAULT_DAILY_QUESTIONS), False


@router.get(
    "/patients/{patient_id}/daily-questions",
    response_model=DailyQuestionsResponse,
)
async def therapist_get_daily_questions(
    patient_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    therapist: User = Depends(require_therapist),
) -> DailyQuestionsResponse:
    await _get_patient_of_therapist(patient_id, therapist, db)
    questions, is_custom = await _resolve_questions_for_patient(db, patient_id)
    return DailyQuestionsResponse(
        patient_id=patient_id,
        questions=questions,
        is_custom=is_custom,
    )


@router.put(
    "/patients/{patient_id}/daily-questions",
    response_model=DailyQuestionsResponse,
)
async def therapist_upsert_daily_questions(
    patient_id: uuid.UUID,
    body: DailyQuestionsUpsertRequest,
    db: AsyncSession = Depends(get_db),
    therapist: User = Depends(require_therapist),
) -> DailyQuestionsResponse:
    await _get_patient_of_therapist(patient_id, therapist, db)

    row = await db.scalar(
        select(PatientDailyQuestions).where(PatientDailyQuestions.patient_id == patient_id)
    )
    if row is None:
        row = PatientDailyQuestions(
            patient_id=patient_id,
            therapist_id=therapist.id,
            questions=list(body.questions),
        )
        db.add(row)
    else:
        row.questions = list(body.questions)
        row.therapist_id = therapist.id
        row.updated_at = datetime.now(timezone.utc)
    await db.commit()
    return DailyQuestionsResponse(
        patient_id=patient_id,
        questions=list(body.questions),
        is_custom=True,
    )


@router.get(
    "/patients/{patient_id}/daily-checkin-sessions",
    response_model=list[DailyCheckinSessionListItem],
)
async def therapist_list_patient_daily_sessions(
    patient_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    therapist: User = Depends(require_therapist),
) -> list[DailyCheckinSessionListItem]:
    await _get_patient_of_therapist(patient_id, therapist, db)
    rows = await db.scalars(
        select(DailyCheckinSession)
        .where(DailyCheckinSession.patient_id == patient_id)
        .order_by(DailyCheckinSession.created_at.desc())
    )
    out: list[DailyCheckinSessionListItem] = []
    for s in rows:
        qs = s.questions_snapshot if isinstance(s.questions_snapshot, list) else []
        ans = s.answers if isinstance(s.answers, list) else []
        out.append(
            DailyCheckinSessionListItem(
                id=s.id,
                status=s.status.value,
                question_count=len(qs),
                answered_count=len(ans),
                created_at=s.created_at,
                completed_at=s.completed_at,
            )
        )
    return out


@router.get(
    "/patients/{patient_id}/daily-checkin-sessions/{session_id}",
    response_model=DailyCheckinSessionDetail,
)
async def therapist_get_patient_daily_session(
    patient_id: uuid.UUID,
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    therapist: User = Depends(require_therapist),
) -> DailyCheckinSessionDetail:
    await _get_patient_of_therapist(patient_id, therapist, db)
    s = await db.get(DailyCheckinSession, session_id)
    if s is None or s.patient_id != patient_id:
        raise HTTPException(status_code=404, detail="Sesja nie znaleziona")
    qs = s.questions_snapshot if isinstance(s.questions_snapshot, list) else []
    ans = [str(a) for a in (s.answers if isinstance(s.answers, list) else [])]
    return DailyCheckinSessionDetail(
        id=s.id,
        questions=[str(q) for q in qs],
        answers=ans,
        current_index=len(ans) if s.status == DailyCheckinSessionStatus.in_progress else len(qs),
        status=s.status.value,
        created_at=s.created_at,
        completed_at=s.completed_at,
    )


@router.get("/daily-checkin/questions", response_model=DailyQuestionsResponse)
async def patient_preview_daily_questions(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_self_therapy_user),
) -> DailyQuestionsResponse:
    await _close_stale_in_progress_daily_sessions(db, user.id)
    questions, is_custom = await _resolve_questions_for_patient(db, user.id)
    today_start, tomorrow_start = _utc_day_bounds()
    today_rows = list(
        await db.scalars(
            select(DailyCheckinSession)
            .where(
                DailyCheckinSession.patient_id == user.id,
                DailyCheckinSession.created_at >= today_start,
                DailyCheckinSession.created_at < tomorrow_start,
            )
            .order_by(DailyCheckinSession.created_at.desc())
        )
    )
    in_prog = next(
        (s for s in today_rows if s.status == DailyCheckinSessionStatus.in_progress),
        None,
    )
    has_completed_today = any(s.status == DailyCheckinSessionStatus.completed for s in today_rows)
    return DailyQuestionsResponse(
        patient_id=user.id,
        questions=questions,
        is_custom=is_custom,
        daily_done_today=has_completed_today and in_prog is None,
        has_in_progress_today=in_prog is not None,
        in_progress_session_id=in_prog.id if in_prog else None,
    )


@router.post(
    "/daily-checkin/sessions",
    response_model=DailyCheckinSessionCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def patient_start_or_resume_daily_session(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_self_therapy_user),
) -> DailyCheckinSessionCreateResponse:
    await _close_stale_in_progress_daily_sessions(db, user.id)
    today_start, tomorrow_start = _utc_day_bounds()

    existing_today_in_progress = await db.scalar(
        select(DailyCheckinSession).where(
            DailyCheckinSession.patient_id == user.id,
            DailyCheckinSession.status == DailyCheckinSessionStatus.in_progress,
            DailyCheckinSession.created_at >= today_start,
            DailyCheckinSession.created_at < tomorrow_start,
        )
    )
    if existing_today_in_progress is not None:
        ex = existing_today_in_progress
        qs = ex.questions_snapshot if isinstance(ex.questions_snapshot, list) else []
        ans = ex.answers if isinstance(ex.answers, list) else []
        return DailyCheckinSessionCreateResponse(
            id=ex.id,
            questions=[str(q) for q in qs],
            current_index=len(ans),
            status=ex.status.value,
        )

    has_any_session_today = await db.scalar(
        select(DailyCheckinSession.id)
        .where(
            DailyCheckinSession.patient_id == user.id,
            DailyCheckinSession.created_at >= today_start,
            DailyCheckinSession.created_at < tomorrow_start,
        )
        .limit(1)
    )
    if has_any_session_today is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dzisiejszy Daily jest już zakończony. Kolejny check-in będzie możliwy od jutra (dzień liczony w UTC).",
        )

    questions, _ = await _resolve_questions_for_patient(db, user.id)
    session = DailyCheckinSession(
        patient_id=user.id,
        questions_snapshot=list(questions),
        answers=[],
        status=DailyCheckinSessionStatus.in_progress,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return DailyCheckinSessionCreateResponse(
        id=session.id,
        questions=list(questions),
        current_index=0,
        status=session.status.value,
    )


@router.get("/daily-checkin/sessions", response_model=list[DailyCheckinSessionListItem])
async def patient_list_daily_sessions(
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_self_therapy_user),
) -> list[DailyCheckinSessionListItem]:
    await _close_stale_in_progress_daily_sessions(db, user.id)
    rows = await db.scalars(
        select(DailyCheckinSession)
        .where(DailyCheckinSession.patient_id == user.id)
        .order_by(DailyCheckinSession.created_at.desc())
    )
    out: list[DailyCheckinSessionListItem] = []
    for s in rows:
        qs = s.questions_snapshot if isinstance(s.questions_snapshot, list) else []
        ans = s.answers if isinstance(s.answers, list) else []
        out.append(
            DailyCheckinSessionListItem(
                id=s.id,
                status=s.status.value,
                question_count=len(qs),
                answered_count=len(ans),
                created_at=s.created_at,
                completed_at=s.completed_at,
            )
        )
    return out


@router.get("/daily-checkin/sessions/{session_id}", response_model=DailyCheckinSessionDetail)
async def patient_get_daily_session(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_self_therapy_user),
) -> DailyCheckinSessionDetail:
    s = await db.get(DailyCheckinSession, session_id)
    if s is None or s.patient_id != user.id:
        raise HTTPException(status_code=404, detail="Sesja nie znaleziona")
    qs = s.questions_snapshot if isinstance(s.questions_snapshot, list) else []
    ans = [str(a) for a in (s.answers if isinstance(s.answers, list) else [])]
    return DailyCheckinSessionDetail(
        id=s.id,
        questions=[str(q) for q in qs],
        answers=ans,
        current_index=len(ans) if s.status == DailyCheckinSessionStatus.in_progress else len(qs),
        status=s.status.value,
        created_at=s.created_at,
        completed_at=s.completed_at,
    )


@router.post("/daily-checkin/sessions/{session_id}/answer", response_model=DailyCheckinSessionDetail)
async def patient_submit_daily_answer(
    session_id: uuid.UUID,
    body: DailyAnswerRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_self_therapy_user),
) -> DailyCheckinSessionDetail:
    s = await db.get(DailyCheckinSession, session_id)
    if s is None or s.patient_id != user.id:
        raise HTTPException(status_code=404, detail="Sesja nie znaleziona")
    if s.status != DailyCheckinSessionStatus.in_progress:
        raise HTTPException(status_code=400, detail="Sesja jest już zakończona")

    qs = s.questions_snapshot if isinstance(s.questions_snapshot, list) else []
    answers = list(s.answers) if isinstance(s.answers, list) else []

    if len(answers) >= len(qs):
        raise HTTPException(status_code=400, detail="Wszystkie pytania mają już odpowiedzi")

    text = body.answer.strip()
    answers.append(text)
    s.answers = answers

    if len(answers) >= len(qs):
        s.status = DailyCheckinSessionStatus.completed
        s.completed_at = datetime.now(timezone.utc)

    await db.commit()
    await db.refresh(s)

    ans = [str(a) for a in (s.answers if isinstance(s.answers, list) else [])]
    return DailyCheckinSessionDetail(
        id=s.id,
        questions=[str(q) for q in qs],
        answers=ans,
        current_index=len(ans) if s.status == DailyCheckinSessionStatus.in_progress else len(qs),
        status=s.status.value,
        created_at=s.created_at,
        completed_at=s.completed_at,
    )


@router.post("/daily-checkin/sessions/{session_id}/abandon", response_model=DailyCheckinSessionDetail)
async def patient_abandon_daily_session(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_self_therapy_user),
) -> DailyCheckinSessionDetail:
    """Kończy sesję jako ukończoną (np. częściowe odpowiedzi), żeby móc rozpocząć nową."""
    s = await db.get(DailyCheckinSession, session_id)
    if s is None or s.patient_id != user.id:
        raise HTTPException(status_code=404, detail="Sesja nie znaleziona")
    if s.status != DailyCheckinSessionStatus.in_progress:
        raise HTTPException(status_code=400, detail="Sesja nie jest w toku")

    s.status = DailyCheckinSessionStatus.completed
    s.completed_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(s)

    qs = s.questions_snapshot if isinstance(s.questions_snapshot, list) else []
    ans = [str(a) for a in (s.answers if isinstance(s.answers, list) else [])]
    return DailyCheckinSessionDetail(
        id=s.id,
        questions=[str(q) for q in qs],
        answers=ans,
        current_index=len(qs),
        status=s.status.value,
        created_at=s.created_at,
        completed_at=s.completed_at,
    )

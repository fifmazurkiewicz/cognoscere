import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models.protocol import TreatmentProtocol
from ..models.session import (
    CHAT_STAGES,
    STAGE_ORDER,
    EmotionSession,
    SessionMessage,
    SessionStage,
    SessionStatus,
    SomaticMapping,
)
from ..models.user import User
from ..schemas.session import (
    ChatRequest,
    ChatResponse,
    CloseSessionRequest,
    CreateSessionRequest,
    MessageOut,
    SessionListItem,
    SessionResponse,
    SomaticMappingOut,
    SomaticSubmitRequest,
)
from ..services.claude_service import get_claude_response
from .deps import get_current_user, require_patient, require_therapist

router = APIRouter()


# ── helpers ────────────────────────────────────────────────────────────────────

def _to_session_response(
    session: EmotionSession,
    mappings: list[SomaticMapping],
    messages: list[SessionMessage],
) -> SessionResponse:
    return SessionResponse(
        id=session.id,
        status=session.status.value,
        current_stage=session.current_stage.value,
        trigger_text=session.trigger_text,
        wellbeing_before=session.wellbeing_before,
        wellbeing_after=session.wellbeing_after,
        ai_summary=session.ai_summary,
        crisis_flag=session.crisis_flag,
        created_at=session.created_at,
        completed_at=session.completed_at,
        somatic_mappings=[
            SomaticMappingOut(id=m.id, body_region=m.body_region, sensation=m.sensation, intensity=m.intensity)
            for m in mappings
        ],
        messages=[
            MessageOut(id=m.id, role=m.role, content=m.content, stage=m.stage, created_at=m.created_at)
            for m in messages
        ],
    )


def _msg_dict(msg: SessionMessage) -> dict:
    return {
        "id": str(msg.id),
        "role": msg.role,
        "content": msg.content,
        "stage": msg.stage,
        "created_at": msg.created_at.isoformat(),
    }


async def _get_own_session(session_id: uuid.UUID, patient: User, db: AsyncSession) -> EmotionSession:
    session = await db.scalar(
        select(EmotionSession).where(
            EmotionSession.id == session_id,
            EmotionSession.patient_id == patient.id,
        )
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Sesja nie znaleziona")
    return session


async def _load_context(session: EmotionSession, db: AsyncSession):
    protocol = await db.scalar(
        select(TreatmentProtocol).where(
            TreatmentProtocol.patient_id == session.patient_id,
            TreatmentProtocol.is_active.is_(True),
        )
    )
    messages = list(
        await db.scalars(
            select(SessionMessage)
            .where(SessionMessage.session_id == session.id)
            .order_by(SessionMessage.created_at)
        )
    )
    somatic = list(
        await db.scalars(
            select(SomaticMapping).where(SomaticMapping.session_id == session.id)
        )
    )
    accumulated: dict = {}
    for m in messages:
        if m.role == "assistant" and m.extracted_data:
            accumulated.update(m.extracted_data)
    return protocol, messages, somatic, accumulated


# ── patient endpoints ───────────────────────────────────────────────────────────

@router.post("/sessions", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(
    body: CreateSessionRequest,
    db: AsyncSession = Depends(get_db),
    patient: User = Depends(require_patient),
) -> SessionResponse:
    session = EmotionSession(
        patient_id=patient.id,
        trigger_text=body.trigger_text,
        wellbeing_before=body.wellbeing_before,
    )
    db.add(session)
    await db.commit()
    await db.refresh(session)
    return _to_session_response(session, [], [])


@router.get("/sessions", response_model=list[SessionListItem])
async def list_sessions(
    db: AsyncSession = Depends(get_db),
    patient: User = Depends(require_patient),
) -> list[SessionListItem]:
    sessions = list(
        await db.scalars(
            select(EmotionSession)
            .where(EmotionSession.patient_id == patient.id)
            .order_by(EmotionSession.created_at.desc())
        )
    )
    return [
        SessionListItem(
            id=s.id,
            status=s.status.value,
            current_stage=s.current_stage.value,
            trigger_text=s.trigger_text[:80] + "…" if len(s.trigger_text) > 80 else s.trigger_text,
            wellbeing_before=s.wellbeing_before,
            wellbeing_after=s.wellbeing_after,
            created_at=s.created_at,
            completed_at=s.completed_at,
        )
        for s in sessions
    ]


@router.get("/sessions/{session_id}", response_model=SessionResponse)
async def get_session(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    patient: User = Depends(require_patient),
) -> SessionResponse:
    session = await _get_own_session(session_id, patient, db)
    _, messages, somatic, _ = await _load_context(session, db)
    return _to_session_response(session, somatic, messages)


@router.post("/sessions/{session_id}/somatic", response_model=ChatResponse)
async def submit_somatic(
    session_id: uuid.UUID,
    body: SomaticSubmitRequest,
    db: AsyncSession = Depends(get_db),
    patient: User = Depends(require_patient),
) -> ChatResponse:
    session = await _get_own_session(session_id, patient, db)

    if session.current_stage != SessionStage.somatic:
        raise HTTPException(status_code=400, detail="Sesja nie jest w etapie somatycznym")

    for m in body.mappings:
        db.add(SomaticMapping(
            session_id=session.id,
            body_region=m.body_region,
            sensation=m.sensation,
            intensity=m.intensity,
        ))

    session.current_stage = SessionStage.emotion_id
    await db.flush()

    protocol, _, somatic, accumulated = await _load_context(session, db)

    claude = await get_claude_response(
        session=session,
        messages=[],
        somatic_mappings=somatic,
        protocol=protocol,
        accumulated=accumulated,
    )

    if claude.crisis:
        session.status = SessionStatus.crisis
        session.crisis_flag = True

    msg = SessionMessage(
        session_id=session.id,
        role="assistant",
        content=claude.message,
        stage=SessionStage.emotion_id.value,
        extracted_data=claude.extracted_data,
    )
    db.add(msg)
    await db.commit()

    return ChatResponse(
        assistant_message=_msg_dict(msg),
        session_stage=session.current_stage.value,
        advance_stage=False,
        crisis=claude.crisis,
    )


@router.post("/sessions/{session_id}/chat", response_model=ChatResponse)
async def chat(
    session_id: uuid.UUID,
    body: ChatRequest,
    db: AsyncSession = Depends(get_db),
    patient: User = Depends(require_patient),
) -> ChatResponse:
    session = await _get_own_session(session_id, patient, db)

    if session.status != SessionStatus.in_progress:
        raise HTTPException(status_code=400, detail="Sesja jest już zakończona")
    if session.current_stage not in CHAT_STAGES:
        raise HTTPException(status_code=400, detail="Sesja nie jest w etapie dialogu")

    user_msg = SessionMessage(
        session_id=session.id,
        role="user",
        content=body.message,
        stage=session.current_stage.value,
        extracted_data={},
    )
    db.add(user_msg)
    await db.flush()

    protocol, prior_messages, somatic, accumulated = await _load_context(session, db)
    prior_messages = [m for m in prior_messages if m.id != user_msg.id]

    claude = await get_claude_response(
        session=session,
        messages=prior_messages,
        somatic_mappings=somatic,
        protocol=protocol,
        accumulated=accumulated,
        user_message=body.message,
    )

    if claude.crisis:
        session.status = SessionStatus.crisis
        session.crisis_flag = True
        crisis_text = (
            (protocol.crisis_protocol if protocol else None)
            or "Słyszę, że jest Ci teraz bardzo ciężko. Zadzwoń na Telefon Zaufania: 116 123 (czynny całą dobę)."
        )
        assist_msg = SessionMessage(
            session_id=session.id,
            role="assistant",
            content=crisis_text,
            stage=session.current_stage.value,
            extracted_data={"crisis": True},
        )
        db.add(assist_msg)
        await db.commit()
        return ChatResponse(
            assistant_message=_msg_dict(assist_msg),
            session_stage=session.current_stage.value,
            advance_stage=False,
            crisis=True,
        )

    assist_msg = SessionMessage(
        session_id=session.id,
        role="assistant",
        content=claude.message,
        stage=session.current_stage.value,
        extracted_data=claude.extracted_data,
    )
    db.add(assist_msg)

    advanced = False
    if claude.advance_stage:
        idx = STAGE_ORDER.index(session.current_stage)
        if idx < len(STAGE_ORDER) - 1:
            session.current_stage = STAGE_ORDER[idx + 1]
            advanced = True
            if "summary" in claude.extracted_data:
                session.ai_summary = claude.extracted_data["summary"]

    await db.commit()
    return ChatResponse(
        assistant_message=_msg_dict(assist_msg),
        session_stage=session.current_stage.value,
        advance_stage=advanced,
        crisis=False,
    )


@router.post("/sessions/{session_id}/close", response_model=SessionResponse)
async def close_session(
    session_id: uuid.UUID,
    body: CloseSessionRequest,
    db: AsyncSession = Depends(get_db),
    patient: User = Depends(require_patient),
) -> SessionResponse:
    session = await _get_own_session(session_id, patient, db)

    if session.status not in (SessionStatus.in_progress,):
        raise HTTPException(status_code=400, detail="Sesja jest już zakończona")

    session.wellbeing_after = body.wellbeing_after
    session.status = SessionStatus.completed
    session.current_stage = SessionStage.completed
    session.completed_at = datetime.now(timezone.utc)
    await db.commit()

    _, messages, somatic, _ = await _load_context(session, db)
    return _to_session_response(session, somatic, messages)


# ── therapist endpoints ─────────────────────────────────────────────────────────

@router.get("/therapist/patients/{patient_id}/sessions", response_model=list[SessionListItem])
async def therapist_list_patient_sessions(
    patient_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    therapist: User = Depends(require_therapist),
) -> list[SessionListItem]:
    from ..models.invitation import Invitation

    patient = await db.scalar(
        select(User)
        .join(Invitation, Invitation.created_patient_id == User.id)
        .where(Invitation.therapist_id == therapist.id, User.id == patient_id)
    )
    if patient is None:
        raise HTTPException(status_code=404, detail="Pacjent nie znaleziony")

    sessions = list(
        await db.scalars(
            select(EmotionSession)
            .where(EmotionSession.patient_id == patient_id)
            .order_by(EmotionSession.created_at.desc())
        )
    )
    return [
        SessionListItem(
            id=s.id,
            status=s.status.value,
            current_stage=s.current_stage.value,
            trigger_text=s.trigger_text[:80] + "…" if len(s.trigger_text) > 80 else s.trigger_text,
            wellbeing_before=s.wellbeing_before,
            wellbeing_after=s.wellbeing_after,
            created_at=s.created_at,
            completed_at=s.completed_at,
        )
        for s in sessions
    ]


@router.get("/therapist/sessions/{session_id}", response_model=SessionResponse)
async def therapist_get_session(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    therapist: User = Depends(require_therapist),
) -> SessionResponse:
    from ..models.invitation import Invitation

    session = await db.scalar(select(EmotionSession).where(EmotionSession.id == session_id))
    if session is None:
        raise HTTPException(status_code=404, detail="Sesja nie znaleziona")

    patient = await db.scalar(
        select(User)
        .join(Invitation, Invitation.created_patient_id == User.id)
        .where(Invitation.therapist_id == therapist.id, User.id == session.patient_id)
    )
    if patient is None:
        raise HTTPException(status_code=403, detail="Brak dostępu do tej sesji")

    _, messages, somatic, _ = await _load_context(session, db)
    return _to_session_response(session, somatic, messages)

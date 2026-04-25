import unicodedata
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.config import llm_configured
from app.infrastructure.database import get_db
from app.infrastructure.llm.llm_service import generate_patient_session_analysis, get_session_assistant_turn
from app.infrastructure.persistence.invitation import Invitation
from app.infrastructure.persistence.protocol import TreatmentProtocol
from app.infrastructure.persistence.session import (
    CHAT_STAGES,
    STAGE_ORDER,
    EmotionSession,
    SessionMessage,
    SessionStage,
    SessionStatus,
    SomaticMapping,
)
from app.infrastructure.persistence.user import User
from app.presentation.api.deps import require_self_therapy_user, require_therapist
from app.presentation.schemas.session import (
    ChatRequest,
    ChatResponse,
    CloseSessionRequest,
    CreateSessionRequest,
    MessageOut,
    SessionAnalysisResponse,
    SessionListItem,
    SessionResponse,
    SomaticMappingOut,
    SomaticSubmitRequest,
)

router = APIRouter()


def _fold_ascii_command(text: str) -> str:
    """Lowercase + usuń znaki diakrytyczne (dopasowanie poleceń po polsku)."""
    normalized = unicodedata.normalize("NFKD", text.strip())
    return "".join(c for c in normalized if not unicodedata.combining(c)).casefold()


def _user_requests_manual_stage_advance(text: str) -> bool:
    """Pacjent może napisać np. „Przejdź dalej”, by pominąć etap bez LLM (awaria modelu / utknięcie)."""
    t = _fold_ascii_command(text)
    needles = (
        "przejdz dalej",
        "przejdz do kolejnego",
        "kolejny etap",
        "nastepny etap",
        "idz dalej",
        "isc dalej",
        "pomin etap",
        "pominmy ten etap",
        "zakoncz ten etap",
        "chce isc dalej",
        "chce przejsc dalej",
    )
    return any(n in t for n in needles)


def _manual_advance_assistant_reply(left: SessionStage) -> str:
    if left == SessionStage.emotion_id:
        return (
            "Przechodzimy dalej. Skupmy się teraz na myślach, które pojawiają się przy tych emocjach — "
            "co pierwsze przychodzi Ci do głowy, gdy wracasz myślami do tamtej sytuacji?"
        )
    if left == SessionStage.thought_excavation:
        return (
            "Idziemy krok dalej: spróbujemy spojrzeć na te myśli i przekonania z większym dystansem. "
            "Jakie masz dowody, że ta myśl jest w pełni prawdziwa — i jakie, że może nie do końca?"
        )
    if left == SessionStage.chain_challenging:
        return (
            "Dziękuję za tę część rozmowy. Przechodzimy do zamknięcia — poniżej ustaw proszę swoje samopoczucie "
            "w skali 1–10. Jak oceniasz się teraz w porównaniu do początku rozmowy?"
        )
    return "Przechodzimy do kolejnego etapu. Co jest dla Ciebie teraz najważniejsze, żeby o tym powiedzieć?"


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
        patient_facing_analysis=session.patient_facing_analysis,
        crisis_flag=session.crisis_flag,
        created_at=session.created_at,
        completed_at=session.completed_at,
        somatic_mappings=[
            SomaticMappingOut(id=m.id, body_region=m.body_region, sensation=m.sensation, intensity=m.intensity)
            for m in mappings
        ],
        messages=[
            MessageOut(
                id=m.id,
                role=m.role,
                content=m.content,
                stage=m.stage,
                created_at=m.created_at,
                extracted_data=m.extracted_data or {},
            )
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


async def _require_patient_llm_headroom(patient_id: uuid.UUID, db: AsyncSession) -> User:
    user = await db.get(User, patient_id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Użytkownik nie znaleziony")
    used = user.llm_tokens_input_total + user.llm_tokens_output_total
    if used >= user.llm_token_limit:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Osiągnięto limit tokenów LLM. Skontaktuj się z administratorem.",
        )
    return user


async def _apply_llm_usage(
    db: AsyncSession,
    patient_id: uuid.UUID,
    input_tokens: int,
    output_tokens: int,
) -> None:
    user = await db.get(User, patient_id)
    if user is None:
        return
    user.llm_tokens_input_total += input_tokens
    user.llm_tokens_output_total += output_tokens


async def _get_own_session(session_id: uuid.UUID, user: User, db: AsyncSession) -> EmotionSession:
    session = await db.scalar(
        select(EmotionSession).where(
            EmotionSession.id == session_id,
            EmotionSession.patient_id == user.id,
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


@router.post("/sessions", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
async def create_session(
    body: CreateSessionRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_self_therapy_user),
) -> SessionResponse:
    session = EmotionSession(
        patient_id=user.id,
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
    user: User = Depends(require_self_therapy_user),
) -> list[SessionListItem]:
    sessions = list(
        await db.scalars(
            select(EmotionSession)
            .where(EmotionSession.patient_id == user.id)
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
    user: User = Depends(require_self_therapy_user),
) -> SessionResponse:
    session = await _get_own_session(session_id, user, db)
    _, messages, somatic, _ = await _load_context(session, db)
    return _to_session_response(session, somatic, messages)


@router.post("/sessions/{session_id}/analyze", response_model=SessionAnalysisResponse)
async def analyze_session_for_patient(
    session_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_self_therapy_user),
) -> SessionAnalysisResponse:
    session = await _get_own_session(session_id, user, db)

    if session.patient_facing_analysis:
        return SessionAnalysisResponse(
            analysis=session.patient_facing_analysis,
            from_cache=True,
        )

    _, messages, somatic, accumulated = await _load_context(session, db)
    has_dialog = any(m.role == "assistant" for m in messages)
    if not has_dialog and not (session.ai_summary and session.ai_summary.strip()):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Za mało treści w sesji, by przygotować analizę.",
        )

    in_tok = out_tok = 0
    if llm_configured():
        await _require_patient_llm_headroom(session.patient_id, db)

    text, in_tok, out_tok = await generate_patient_session_analysis(
        session=session,
        messages=messages,
        somatic_mappings=somatic,
        accumulated=accumulated,
    )

    if llm_configured() and (in_tok or out_tok):
        await _apply_llm_usage(db, session.patient_id, in_tok, out_tok)

    session.patient_facing_analysis = text
    await db.commit()
    await db.refresh(session)

    return SessionAnalysisResponse(analysis=text, from_cache=False)


@router.post("/sessions/{session_id}/somatic", response_model=ChatResponse)
async def submit_somatic(
    session_id: uuid.UUID,
    body: SomaticSubmitRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_self_therapy_user),
) -> ChatResponse:
    session = await _get_own_session(session_id, user, db)

    if session.current_stage != SessionStage.somatic:
        raise HTTPException(status_code=400, detail="Sesja nie jest w etapie somatycznym")

    await _require_patient_llm_headroom(session.patient_id, db)

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

    turn = await get_session_assistant_turn(
        session=session,
        messages=[],
        somatic_mappings=somatic,
        protocol=protocol,
        accumulated=accumulated,
    )
    out = turn.payload
    await _apply_llm_usage(db, session.patient_id, turn.input_tokens, turn.output_tokens)

    if out.crisis:
        session.status = SessionStatus.crisis
        session.crisis_flag = True

    msg = SessionMessage(
        session_id=session.id,
        role="assistant",
        content=out.message,
        stage=SessionStage.emotion_id.value,
        extracted_data=out.extracted_data,
    )
    db.add(msg)
    await db.commit()

    return ChatResponse(
        assistant_message=_msg_dict(msg),
        session_stage=session.current_stage.value,
        advance_stage=False,
        crisis=out.crisis,
    )


@router.post("/sessions/{session_id}/chat", response_model=ChatResponse)
async def chat(
    session_id: uuid.UUID,
    body: ChatRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_self_therapy_user),
) -> ChatResponse:
    session = await _get_own_session(session_id, user, db)

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

    if _user_requests_manual_stage_advance(body.message):
        left = session.current_stage
        idx = STAGE_ORDER.index(left)
        if idx < len(STAGE_ORDER) - 1:
            session.current_stage = STAGE_ORDER[idx + 1]
            assist_msg = SessionMessage(
                session_id=session.id,
                role="assistant",
                content=_manual_advance_assistant_reply(left),
                stage=session.current_stage.value,
                extracted_data={"manual_stage_advance": True},
            )
            db.add(assist_msg)
            await db.commit()
            return ChatResponse(
                assistant_message=_msg_dict(assist_msg),
                session_stage=session.current_stage.value,
                advance_stage=True,
                crisis=False,
            )

    await _require_patient_llm_headroom(session.patient_id, db)

    protocol, prior_messages, somatic, accumulated = await _load_context(session, db)
    prior_messages = [m for m in prior_messages if m.id != user_msg.id]

    turn = await get_session_assistant_turn(
        session=session,
        messages=prior_messages,
        somatic_mappings=somatic,
        protocol=protocol,
        accumulated=accumulated,
        user_message=body.message,
    )
    out = turn.payload
    await _apply_llm_usage(db, session.patient_id, turn.input_tokens, turn.output_tokens)

    if out.crisis:
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
        content=out.message,
        stage=session.current_stage.value,
        extracted_data=out.extracted_data,
    )
    db.add(assist_msg)

    advanced = False
    if out.advance_stage:
        idx = STAGE_ORDER.index(session.current_stage)
        if idx < len(STAGE_ORDER) - 1:
            session.current_stage = STAGE_ORDER[idx + 1]
            advanced = True
            if "summary" in out.extracted_data:
                session.ai_summary = out.extracted_data["summary"]

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
    user: User = Depends(require_self_therapy_user),
) -> SessionResponse:
    session = await _get_own_session(session_id, user, db)

    if session.status not in (SessionStatus.in_progress,):
        raise HTTPException(status_code=400, detail="Sesja jest już zakończona")

    session.wellbeing_after = body.wellbeing_after
    session.status = SessionStatus.completed
    session.current_stage = SessionStage.completed
    session.completed_at = datetime.now(timezone.utc)
    await db.commit()

    _, messages, somatic, _ = await _load_context(session, db)
    return _to_session_response(session, somatic, messages)


@router.get("/therapist/patients/{patient_id}/sessions", response_model=list[SessionListItem])
async def therapist_list_patient_sessions(
    patient_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    therapist: User = Depends(require_therapist),
) -> list[SessionListItem]:
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

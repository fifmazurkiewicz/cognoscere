import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..models.invitation import Invitation
from ..models.protocol import TreatmentProtocol
from ..models.session import EmotionSession, SessionMessage, SessionStatus
from ..models.user import User
from ..schemas.protocol import PatientSummary, ProtocolResponse, ProtocolUpsertRequest
from .deps import require_therapist


# ── analytics schemas ──────────────────────────────────────────────────────────

class WellbeingPoint(BaseModel):
    session_id: str
    date: str
    before: int
    after: int | None


class EmotionFrequency(BaseModel):
    emotion: str
    count: int
    avg_intensity: float


class DistortionFrequency(BaseModel):
    type: str
    count: int


class PatientAnalytics(BaseModel):
    wellbeing_over_time: list[WellbeingPoint]
    emotion_frequency: list[EmotionFrequency]
    cognitive_distortions: list[DistortionFrequency]
    session_count: int
    completed_session_count: int
    avg_wellbeing_delta: float | None

router = APIRouter()


async def _get_patient_of_therapist(
    patient_id: uuid.UUID,
    therapist: User,
    db: AsyncSession,
) -> User:
    patient = await db.scalar(
        select(User)
        .join(Invitation, Invitation.created_patient_id == User.id)
        .where(
            Invitation.therapist_id == therapist.id,
            User.id == patient_id,
            User.deleted_at.is_(None),
        )
    )
    if patient is None:
        raise HTTPException(status_code=404, detail="Pacjent nie znaleziony")
    return patient


@router.get("/patients", response_model=list[PatientSummary])
async def list_patients(
    db: AsyncSession = Depends(get_db),
    therapist: User = Depends(require_therapist),
) -> list[PatientSummary]:
    patients = await db.scalars(
        select(User)
        .join(Invitation, Invitation.created_patient_id == User.id)
        .where(
            Invitation.therapist_id == therapist.id,
            User.deleted_at.is_(None),
        )
    )

    result = []
    for patient in patients:
        protocol = await db.scalar(
            select(TreatmentProtocol).where(
                TreatmentProtocol.patient_id == patient.id,
                TreatmentProtocol.is_active.is_(True),
            )
        )
        result.append(
            PatientSummary(
                id=patient.id,
                display_name=patient.display_name,
                first_name=patient.first_name,
                email=patient.email,
                has_protocol=protocol is not None,
            )
        )
    return result


@router.get("/patients/{patient_id}/protocol", response_model=ProtocolResponse)
async def get_protocol(
    patient_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    therapist: User = Depends(require_therapist),
) -> TreatmentProtocol:
    await _get_patient_of_therapist(patient_id, therapist, db)

    protocol = await db.scalar(
        select(TreatmentProtocol).where(
            TreatmentProtocol.patient_id == patient_id,
            TreatmentProtocol.is_active.is_(True),
        )
    )
    if protocol is None:
        raise HTTPException(status_code=404, detail="Protokół nie istnieje")
    return protocol


@router.put(
    "/patients/{patient_id}/protocol",
    response_model=ProtocolResponse,
    status_code=status.HTTP_200_OK,
)
async def upsert_protocol(
    patient_id: uuid.UUID,
    body: ProtocolUpsertRequest,
    db: AsyncSession = Depends(get_db),
    therapist: User = Depends(require_therapist),
) -> TreatmentProtocol:
    await _get_patient_of_therapist(patient_id, therapist, db)

    existing = await db.scalar(
        select(TreatmentProtocol).where(
            TreatmentProtocol.patient_id == patient_id,
            TreatmentProtocol.is_active.is_(True),
        )
    )

    if existing:
        existing.approach = body.approach
        existing.focus_areas = body.focus_areas
        existing.patient_context = body.patient_context
        existing.ai_instructions = body.ai_instructions
        existing.challenge_intensity = body.challenge_intensity
        existing.somatic_focus = body.somatic_focus
        existing.max_session_length = body.max_session_length
        existing.crisis_protocol = body.crisis_protocol
        existing.version += 1
        existing.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(existing)
        return existing

    protocol = TreatmentProtocol(
        patient_id=patient_id,
        therapist_id=therapist.id,
        **body.model_dump(),
    )
    db.add(protocol)
    await db.commit()
    await db.refresh(protocol)
    return protocol


@router.get("/patients/{patient_id}/analytics", response_model=PatientAnalytics)
async def patient_analytics(
    patient_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    therapist: User = Depends(require_therapist),
) -> PatientAnalytics:
    await _get_patient_of_therapist(patient_id, therapist, db)

    sessions = list(await db.scalars(
        select(EmotionSession)
        .where(EmotionSession.patient_id == patient_id)
        .order_by(EmotionSession.created_at)
    ))

    if not sessions:
        return PatientAnalytics(
            wellbeing_over_time=[],
            emotion_frequency=[],
            cognitive_distortions=[],
            session_count=0,
            completed_session_count=0,
            avg_wellbeing_delta=None,
        )

    session_ids = [s.id for s in sessions]
    all_messages = list(await db.scalars(
        select(SessionMessage).where(SessionMessage.session_id.in_(session_ids))
    ))

    emotion_map: dict[str, dict] = {}
    distortion_map: dict[str, int] = {}

    for msg in all_messages:
        if msg.role != "assistant" or not msg.extracted_data:
            continue
        for e in msg.extracted_data.get("identified_emotions", []):
            t = e.get("type", "")
            if not t:
                continue
            if t not in emotion_map:
                emotion_map[t] = {"count": 0, "total": 0}
            emotion_map[t]["count"] += 1
            emotion_map[t]["total"] += e.get("intensity", 0)
        if d := msg.extracted_data.get("cognitive_distortion"):
            distortion_map[d] = distortion_map.get(d, 0) + 1

    wellbeing_over_time = [
        WellbeingPoint(
            session_id=str(s.id),
            date=s.created_at.strftime("%d.%m"),
            before=s.wellbeing_before,
            after=s.wellbeing_after,
        )
        for s in sessions
    ]

    deltas = [
        s.wellbeing_after - s.wellbeing_before
        for s in sessions
        if s.wellbeing_after is not None
    ]
    avg_delta = round(sum(deltas) / len(deltas), 1) if deltas else None

    return PatientAnalytics(
        wellbeing_over_time=wellbeing_over_time,
        emotion_frequency=sorted(
            [
                EmotionFrequency(
                    emotion=k,
                    count=v["count"],
                    avg_intensity=round(v["total"] / v["count"], 1),
                )
                for k, v in emotion_map.items()
            ],
            key=lambda x: -x.count,
        ),
        cognitive_distortions=sorted(
            [DistortionFrequency(type=k, count=v) for k, v in distortion_map.items()],
            key=lambda x: -x.count,
        ),
        session_count=len(sessions),
        completed_session_count=sum(1 for s in sessions if s.status == SessionStatus.completed),
        avg_wellbeing_delta=avg_delta,
    )

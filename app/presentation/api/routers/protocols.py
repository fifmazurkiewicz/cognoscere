import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.infrastructure.database import get_db
from app.infrastructure.persistence.invitation import Invitation
from app.infrastructure.persistence.protocol import TreatmentProtocol
from app.infrastructure.persistence.user import User
from app.presentation.api.deps import require_therapist
from app.presentation.schemas.protocol import PatientSummary, ProtocolResponse, ProtocolUpsertRequest

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

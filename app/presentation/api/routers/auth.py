import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.auth_tokens import (
    create_access_token,
    create_refresh_token,
    decode_token,
    hash_password,
    verify_password,
)
from app.domain.user_role import UserRole
from app.infrastructure.config import settings
from app.infrastructure.database import get_db
from app.infrastructure.persistence.invitation import Invitation
from app.infrastructure.persistence.user import User
from app.presentation.api.deps import get_current_user, require_therapist
from app.presentation.schemas.auth import (
    ChangePasswordRequest,
    CreateInvitationRequest,
    DeleteAccountRequest,
    InvitationResponse,
    InvitationValidateResponse,
    LoginRequest,
    RefreshRequest,
    RegisterPatientRequest,
    RegisterTherapistRequest,
    TokenResponse,
    UserResponse,
)

router = APIRouter()


@router.post(
    "/register/therapist",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_therapist(
    body: RegisterTherapistRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    existing = await db.scalar(select(User).where(User.email == body.email))
    if existing:
        raise HTTPException(status_code=400, detail="Konto z tym emailem już istnieje")

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        role=UserRole.therapist,
        first_name=body.first_name,
        professional_title=body.professional_title,
        gdpr_consent_at=datetime.now(timezone.utc),
        is_verified=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)

    return TokenResponse(
        access_token=create_access_token(str(user.id), user.role.value),
        refresh_token=create_refresh_token(str(user.id)),
    )


@router.post("/login", response_model=TokenResponse)
async def login(
    body: LoginRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    user = await db.scalar(select(User).where(User.email == body.email))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Nieprawidłowy email lub hasło")
    if user.deleted_at is not None:
        raise HTTPException(status_code=401, detail="Konto zostało usunięte")

    user.last_login = datetime.now(timezone.utc)
    await db.commit()

    return TokenResponse(
        access_token=create_access_token(str(user.id), user.role.value),
        refresh_token=create_refresh_token(str(user.id)),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh_token(
    body: RefreshRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    try:
        payload = decode_token(body.refresh_token)
    except ValueError:
        raise HTTPException(status_code=401, detail="Nieprawidłowy refresh token")

    if payload.get("type") != "refresh":
        raise HTTPException(status_code=401, detail="Nieprawidłowy typ tokenu")

    user = await db.get(User, uuid.UUID(payload["sub"]))
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=401, detail="Użytkownik nie istnieje")

    return TokenResponse(
        access_token=create_access_token(str(user.id), user.role.value),
        refresh_token=create_refresh_token(str(user.id)),
    )


@router.get("/me", response_model=UserResponse)
async def me(current_user: User = Depends(get_current_user)) -> User:
    return current_user


@router.post("/change-password", status_code=status.HTTP_204_NO_CONTENT)
async def change_password(
    body: ChangePasswordRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nieprawidłowe obecne hasło",
        )
    if verify_password(body.new_password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nowe hasło musi różnić się od obecnego",
        )
    user.password_hash = hash_password(body.new_password)
    await db.commit()


@router.post("/delete-account", status_code=status.HTTP_204_NO_CONTENT)
async def delete_account(
    body: DeleteAccountRequest,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(get_current_user),
) -> None:
    if not verify_password(body.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Nieprawidłowe hasło",
        )
    user.deleted_at = datetime.now(timezone.utc)
    await db.commit()


@router.post("/invite", response_model=InvitationResponse)
async def create_invitation(
    body: CreateInvitationRequest,
    db: AsyncSession = Depends(get_db),
    therapist: User = Depends(require_therapist),
) -> InvitationResponse:
    invitation = Invitation(
        therapist_id=therapist.id,
        patient_name_hint=body.patient_name_hint,
    )
    db.add(invitation)
    await db.commit()
    await db.refresh(invitation)

    invite_url = f"{settings.frontend_url}/register?token={invitation.token}"

    return InvitationResponse(
        token=invitation.token,
        expires_at=invitation.expires_at.isoformat(),
        patient_name_hint=invitation.patient_name_hint,
        invite_url=invite_url,
    )


@router.get("/invite/{token}", response_model=InvitationValidateResponse)
async def validate_invitation(
    token: str,
    db: AsyncSession = Depends(get_db),
) -> InvitationValidateResponse:
    invitation = await db.scalar(select(Invitation).where(Invitation.token == token))

    if invitation is None or invitation.used_at is not None:
        return InvitationValidateResponse(
            valid=False, therapist_first_name="", patient_name_hint=None
        )

    if invitation.expires_at < datetime.now(timezone.utc):
        return InvitationValidateResponse(
            valid=False, therapist_first_name="", patient_name_hint=None
        )

    therapist = await db.get(User, invitation.therapist_id)

    return InvitationValidateResponse(
        valid=True,
        therapist_first_name=therapist.first_name if therapist else "",
        patient_name_hint=invitation.patient_name_hint,
    )


@router.post(
    "/register/patient",
    response_model=TokenResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_patient(
    body: RegisterPatientRequest,
    db: AsyncSession = Depends(get_db),
) -> TokenResponse:
    invitation = await db.scalar(
        select(Invitation).where(Invitation.token == body.token)
    )

    if invitation is None or invitation.used_at is not None:
        raise HTTPException(
            status_code=400, detail="Nieprawidłowy lub wykorzystany link zaproszenia"
        )

    if invitation.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=400, detail="Link zaproszenia wygasł (72h)")

    existing = await db.scalar(select(User).where(User.email == body.email))
    if existing:
        raise HTTPException(status_code=400, detail="Konto z tym emailem już istnieje")

    user = User(
        email=body.email,
        password_hash=hash_password(body.password),
        role=UserRole.patient,
        first_name=body.display_name,
        display_name=body.display_name,
        gdpr_consent_at=datetime.now(timezone.utc),
        is_verified=True,
    )
    db.add(user)
    await db.flush()

    invitation.used_at = datetime.now(timezone.utc)
    invitation.created_patient_id = user.id
    await db.commit()
    await db.refresh(user)

    return TokenResponse(
        access_token=create_access_token(str(user.id), user.role.value),
        refresh_token=create_refresh_token(str(user.id)),
    )

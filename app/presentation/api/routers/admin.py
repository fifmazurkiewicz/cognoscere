import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.auth_tokens import hash_password
from app.domain.user_role import UserRole
from app.infrastructure.database import get_db
from app.infrastructure.persistence.session import EmotionSession
from app.infrastructure.persistence.user import User
from app.presentation.api.deps import require_admin
from app.presentation.schemas.admin import (
    AdminResetPasswordRequest,
    AdminRolePatch,
    AdminStatsResponse,
    AdminTokenLimitPatch,
    AdminUserRow,
)

router = APIRouter()


@router.get("/stats", response_model=AdminStatsResponse)
async def admin_stats(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> AdminStatsResponse:
    total_users = int(
        await db.scalar(select(func.count()).select_from(User).where(User.deleted_at.is_(None))) or 0
    )
    total_therapists = int(
        await db.scalar(
            select(func.count()).select_from(User).where(
                User.deleted_at.is_(None),
                User.role == UserRole.therapist,
            )
        )
        or 0
    )
    total_patients = int(
        await db.scalar(
            select(func.count()).select_from(User).where(
                User.deleted_at.is_(None),
                User.role == UserRole.patient,
            )
        )
        or 0
    )
    total_admins = int(
        await db.scalar(
            select(func.count()).select_from(User).where(
                User.deleted_at.is_(None),
                User.role == UserRole.admin,
            )
        )
        or 0
    )
    total_emotion_sessions = int(await db.scalar(select(func.count()).select_from(EmotionSession)) or 0)

    token_row = await db.execute(
        select(
            func.coalesce(func.sum(User.llm_tokens_input_total), 0),
            func.coalesce(func.sum(User.llm_tokens_output_total), 0),
        ).where(User.deleted_at.is_(None))
    )
    in_sum, out_sum = token_row.one()

    return AdminStatsResponse(
        total_users=total_users,
        total_therapists=total_therapists,
        total_patients=total_patients,
        total_admins=total_admins,
        total_emotion_sessions=total_emotion_sessions,
        llm_tokens_input_total=int(in_sum),
        llm_tokens_output_total=int(out_sum),
    )


@router.get("/users", response_model=list[AdminUserRow])
async def admin_list_users(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[AdminUserRow]:
    users = list(
        await db.scalars(
            select(User).where(User.deleted_at.is_(None)).order_by(User.created_at.desc())
        )
    )
    rows: list[AdminUserRow] = []
    for u in users:
        sess_count = int(
            await db.scalar(
                select(func.count()).select_from(EmotionSession).where(
                    EmotionSession.patient_id == u.id
                )
            )
            or 0
        )
        rows.append(
            AdminUserRow(
                id=u.id,
                email=u.email,
                role=u.role,
                first_name=u.first_name,
                display_name=u.display_name,
                llm_token_limit=u.llm_token_limit,
                llm_tokens_input_total=u.llm_tokens_input_total,
                llm_tokens_output_total=u.llm_tokens_output_total,
                emotion_session_count=sess_count,
                created_at=u.created_at,
                last_login=u.last_login,
            )
        )
    return rows


@router.patch("/users/{user_id}/llm-token-limit", response_model=AdminUserRow)
async def admin_patch_token_limit(
    user_id: uuid.UUID,
    body: AdminTokenLimitPatch,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> AdminUserRow:
    user = await db.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Użytkownik nie znaleziony")
    user.llm_token_limit = body.llm_token_limit
    await db.commit()
    await db.refresh(user)
    sess_count = int(
        await db.scalar(
            select(func.count()).select_from(EmotionSession).where(
                EmotionSession.patient_id == user.id
            )
        )
        or 0
    )
    return AdminUserRow(
        id=user.id,
        email=user.email,
        role=user.role,
        first_name=user.first_name,
        display_name=user.display_name,
        llm_token_limit=user.llm_token_limit,
        llm_tokens_input_total=user.llm_tokens_input_total,
        llm_tokens_output_total=user.llm_tokens_output_total,
        emotion_session_count=sess_count,
        created_at=user.created_at,
        last_login=user.last_login,
    )


@router.post("/users/{user_id}/reset-password", status_code=status.HTTP_204_NO_CONTENT)
async def admin_reset_password(
    user_id: uuid.UUID,
    body: AdminResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> None:
    user = await db.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Użytkownik nie znaleziony")
    user.password_hash = hash_password(body.new_password)
    await db.commit()


@router.patch("/users/{user_id}/role", response_model=AdminUserRow)
async def admin_patch_role(
    user_id: uuid.UUID,
    body: AdminRolePatch,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_admin),
) -> AdminUserRow:
    user = await db.get(User, user_id)
    if user is None or user.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Użytkownik nie znaleziony")

    if user.role == UserRole.admin and body.role != UserRole.admin:
        admin_count = int(
            await db.scalar(
                select(func.count()).select_from(User).where(
                    User.deleted_at.is_(None),
                    User.role == UserRole.admin,
                )
            )
            or 0
        )
        if admin_count <= 1:
            raise HTTPException(
                status_code=400,
                detail="Nie można zmienić roli jedynego administratora",
            )

    user.role = body.role
    await db.commit()
    await db.refresh(user)

    sess_count = int(
        await db.scalar(
            select(func.count()).select_from(EmotionSession).where(
                EmotionSession.patient_id == user.id
            )
        )
        or 0
    )
    return AdminUserRow(
        id=user.id,
        email=user.email,
        role=user.role,
        first_name=user.first_name,
        display_name=user.display_name,
        llm_token_limit=user.llm_token_limit,
        llm_tokens_input_total=user.llm_tokens_input_total,
        llm_tokens_output_total=user.llm_tokens_output_total,
        emotion_session_count=sess_count,
        created_at=user.created_at,
        last_login=user.last_login,
    )

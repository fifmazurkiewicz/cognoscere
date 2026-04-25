from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.application.auth_tokens import hash_password
from app.domain.user_role import UserRole
from app.infrastructure.config import settings
from app.infrastructure.persistence.user import User


async def ensure_bootstrap_admin_user(db: AsyncSession) -> None:
    email = (settings.bootstrap_admin_email or "").strip().lower()
    password = settings.bootstrap_admin_password or ""
    if not email or not password:
        return

    existing = await db.scalar(select(User).where(User.email == email))
    if existing is not None:
        return

    user = User(
        email=email,
        password_hash=hash_password(password),
        role=UserRole.admin,
        first_name="Admin",
        display_name="Administrator",
        professional_title=None,
        gdpr_consent_at=None,
        is_verified=True,
    )
    db.add(user)
    await db.commit()

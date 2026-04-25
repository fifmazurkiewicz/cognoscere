from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from app.infrastructure.config import settings

# bcrypt 4.1+ zgłasza błąd powyżej 72 B UTF-8; passlib 1.7.4 przy starcie wywołuje kod
# niekompatybilny z bcrypt 5.x (detect_wrap_bug) — używamy wyłącznie biblioteki bcrypt.
BCRYPT_MAX_PASSWORD_BYTES = 72


def validate_password_for_bcrypt(password: str) -> str:
    if len(password.encode("utf-8")) > BCRYPT_MAX_PASSWORD_BYTES:
        raise ValueError(
            f"Hasło może mieć co najwyżej {BCRYPT_MAX_PASSWORD_BYTES} bajtów w UTF-8 "
            "(ograniczenie algorytmu bcrypt). Skróć hasło."
        )
    return password


def hash_password(password: str) -> str:
    validate_password_for_bcrypt(password)
    digest = bcrypt.hashpw(
        password.encode("utf-8"),
        bcrypt.gensalt(rounds=12),
    )
    return digest.decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    validate_password_for_bcrypt(plain)
    return bcrypt.checkpw(
        plain.encode("utf-8"),
        hashed.encode("utf-8"),
    )


def create_access_token(user_id: str, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.access_token_expire_minutes
    )
    return jwt.encode(
        {"sub": user_id, "role": role, "exp": expire, "type": "access"},
        settings.secret_key,
        algorithm=settings.algorithm,
    )


def create_refresh_token(user_id: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        days=settings.refresh_token_expire_days
    )
    return jwt.encode(
        {"sub": user_id, "type": "refresh", "exp": expire},
        settings.secret_key,
        algorithm=settings.algorithm,
    )


def decode_token(token: str) -> dict:  # type: ignore[type-arg]
    try:
        return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
    except JWTError as e:
        raise ValueError("Nieprawidłowy token") from e

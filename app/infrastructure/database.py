import ssl
from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import settings

def db_connect_args() -> dict:
    if not settings.database_ssl:
        return {}
    # Google Cloud SQL wymaga TLS, ale certyfikat serwera nie jest w domyślnego magazynu CA
    # — samo ssl=True daje SSLCertVerificationError. Kanał i tak jest szyfrowany (TLS);
    # weryfikacja hosta: obejmuje to authorized networks w GCP.
    # Pełna weryfikacja: pobierz server-ca.pem (konsola Cloud SQL) i użyj SSLContext z load_verify_locations.
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return {"ssl": ctx}


_engine_kw: dict = {"echo": settings.sqlalchemy_echo}
if settings.database_ssl:
    _engine_kw["connect_args"] = db_connect_args()

engine = create_async_engine(settings.database_url, **_engine_kw)

AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session

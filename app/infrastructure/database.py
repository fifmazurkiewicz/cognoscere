from collections.abc import AsyncGenerator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from .config import settings

def db_connect_args() -> dict:
    if settings.database_ssl:
        # asyncpg: szyfrowane połączenie (np. Google Cloud SQL z public IP)
        return {"ssl": True}
    return {}


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

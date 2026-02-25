"""Database configuration and session factory for WoOdoo (SQLAlchemy 2.0 async)"""



from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

from sqlalchemy.orm import declarative_base

from typing import AsyncGenerator



from backend.core.config import settings



# SQLAlchemy ORM base for all models

Base = declarative_base()




# Create async engine

engine = create_async_engine(

    settings.database_url,

    echo=True,  # Set to False in production

    future=True,

)



# Create async session factory

AsyncSessionLocal = async_sessionmaker(

    engine,

    class_=AsyncSession,

    expire_on_commit=False,

    autoflush=False,

)





async def get_db() -> AsyncGenerator[AsyncSession, None]:

    """Dependency injection for database sessions"""

    async with AsyncSessionLocal() as session:

        try:

            yield session

        finally:

            await session.close()


# Store engine and session factory globally for initialization
_engine = None
_async_session_factory = None


async def init_db(database_url: str):
    """Initialize database engine and session factory"""
    global _engine, _async_session_factory
    _engine = create_async_engine(database_url, echo=False, future=True)
    _async_session_factory = async_sessionmaker(_engine, class_=AsyncSession, expire_on_commit=False)


async def create_tables():
    """Create all tables"""
    if _engine is None:
        raise RuntimeError("Database not initialized")
    # Import orm models to register them with Base
    from backend.models import orm  # noqa: F401
    async with _engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

# Re-export Settings for backward compatibility with auth/service.py
from backend.models.orm import Settings  # noqa: F401, E402

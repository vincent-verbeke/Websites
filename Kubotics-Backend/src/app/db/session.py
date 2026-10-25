from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy.orm import declarative_base
from sqlalchemy import MetaData
from app.core.config import settings

# Explicitly bind metadata to target schema (e.g. "crm")
metadata = MetaData(schema=settings.POSTGRES_SCHEMA)
Base = declarative_base(metadata=metadata)

engine = create_async_engine(
    settings.SQLALCHEMY_DATABASE_URI,
    echo=settings.DEBUG,
    future=True,
    pool_size=10,
    max_overflow=20,
    connect_args={"server_settings": {"search_path": f"{settings.POSTGRES_SCHEMA},public"}},
)

AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

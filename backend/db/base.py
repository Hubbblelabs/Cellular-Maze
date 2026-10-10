import re

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase

from backend.core.config import settings
from backend.core.logging import logger


def _redact(uri: str) -> str:
    """Hide the password in a connection string before it reaches the logs."""
    return re.sub(r"//([^:/@]+):.*@", r"//\1:***@", uri)


class MongoClient:
    """Async MongoDB client singleton using Motor."""

    _client: AsyncIOMotorClient | None = None
    _db: AsyncIOMotorDatabase | None = None

    @classmethod
    async def connect(cls) -> None:
        if cls._client is not None:
            return
        logger.info(f"Connecting to MongoDB at {_redact(settings.MONGO_URI)}")
        cls._client = AsyncIOMotorClient(
            settings.MONGO_URI,
            maxPoolSize=20,
            minPoolSize=2,
            serverSelectionTimeoutMS=5000,
        )
        cls._db = cls._client[settings.DB_NAME]
        try:
            await cls._client.admin.command("ping")
            await cls._ensure_indexes()
        except Exception:
            # Leave the app usable without a database (in-memory fallbacks)
            cls._client.close()
            cls._client = None
            cls._db = None
            raise
        logger.info(f"Connected to database '{settings.DB_NAME}'")

    @classmethod
    async def _ensure_indexes(cls) -> None:
        db = cls.get_db()
        await db["rl_profiles"].create_index("user_id", unique=True)
        await db["users"].create_index("user_id", unique=True)
        await db["users"].create_index("username", unique=True)

    @classmethod
    def is_connected(cls) -> bool:
        return cls._db is not None

    @classmethod
    def get_db(cls) -> AsyncIOMotorDatabase:
        if cls._db is None:
            raise RuntimeError("Database not connected. Call MongoClient.connect() first.")
        return cls._db

    @classmethod
    async def disconnect(cls) -> None:
        if cls._client is not None:
            cls._client.close()
            cls._client = None
            cls._db = None
            logger.info("Disconnected from MongoDB")

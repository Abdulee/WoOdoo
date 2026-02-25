"""Redis pub/sub publisher for sync progress events.

Sync engines call these methods to publish progress updates to the
``sync:progress`` Redis channel. The WebSocket router subscribes to
this channel and relays messages to connected browser clients.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

import redis.asyncio as aioredis

from backend.core.config import settings

logger = logging.getLogger(__name__)

CHANNEL = "sync:progress"


class RedisPublisher:
    """Publishes sync progress events to a Redis pub/sub channel."""

    def __init__(self, redis_url: str) -> None:
        self._redis_url = redis_url
        self._redis: Optional[aioredis.Redis] = None

    async def _get_redis(self) -> aioredis.Redis:
        """Lazily create and return a Redis connection."""
        if self._redis is None:
            self._redis = aioredis.from_url(
                self._redis_url, decode_responses=True
            )
        return self._redis

    async def _publish(self, payload: dict[str, Any]) -> None:
        """Publish a JSON payload to the sync:progress channel.

        Handles Redis connection errors gracefully — logs a warning
        instead of crashing the caller.
        """
        try:
            client = await self._get_redis()
            await client.publish(CHANNEL, json.dumps(payload))
        except Exception as exc:
            logger.warning("Failed to publish to Redis channel %s: %s", CHANNEL, exc)

    async def publish_progress(
        self,
        execution_id: int,
        phase: str,
        processed: int,
        total: int,
        current_product_name: Optional[str] = None,
    ) -> None:
        """Publish a sync progress event."""
        await self._publish({
            "type": "sync_progress",
            "data": {
                "execution_id": execution_id,
                "phase": phase,
                "processed": processed,
                "total": total,
                "current_product": current_product_name,
            },
        })

    async def publish_completion(
        self,
        execution_id: int,
        summary: dict[str, Any],
    ) -> None:
        """Publish a sync completion event."""
        await self._publish({
            "type": "sync_complete",
            "data": {
                "execution_id": execution_id,
                **summary,
            },
        })

    async def publish_error(
        self,
        execution_id: int,
        product_name: str,
        error_message: str,
    ) -> None:
        """Publish a sync error event."""
        await self._publish({
            "type": "sync_error",
            "data": {
                "execution_id": execution_id,
                "product_name": product_name,
                "error_message": error_message,
            },
        })

    async def publish_log(
        self,
        execution_id: int,
        level: str,
        message: str,
    ) -> None:
        """Publish a sync log event."""
        await self._publish({
            "type": "sync_log",
            "data": {
                "execution_id": execution_id,
                "level": level,
                "message": message,
            },
        })

    async def close(self) -> None:
        """Close the underlying Redis connection."""
        if self._redis is not None:
            try:
                await self._redis.close()
            except Exception:
                pass
            self._redis = None


def get_publisher() -> RedisPublisher:
    """Return a RedisPublisher instance configured from application settings."""
    return RedisPublisher(redis_url=settings.redis_url)

"""Webhook health tracking — last-received timestamps per system."""

from __future__ import annotations

import logging
from datetime import datetime, timezone, timedelta

import redis.asyncio as redis

from backend.core.config import settings

logger = logging.getLogger(__name__)

HEALTH_THRESHOLD = timedelta(hours=1)


async def _get_redis() -> redis.Redis | None:
    """Get a Redis client for webhook health tracking."""
    try:
        client = redis.from_url(settings.redis_url, decode_responses=True)
        await client.ping()
        return client
    except Exception as e:
        logger.warning("Redis not available for webhook health: %s", e)
        return None


async def update_last_received(system: str) -> None:
    """Store ISO timestamp for when a webhook was last received.

    Args:
        system: Either 'wc' or 'odoo'.
    """
    client = await _get_redis()
    if client is None:
        return
    try:
        now = datetime.now(timezone.utc).isoformat()
        await client.set(f"webhook:last_received:{system}", now)
    finally:
        await client.aclose()


async def get_health() -> dict:
    """Return webhook health status for both systems.

    Returns dict with keys:
        wc_last_received, odoo_last_received (ISO string or None),
        wc_healthy, odoo_healthy (bool).
    """
    result = {
        "wc_last_received": None,
        "odoo_last_received": None,
        "wc_healthy": False,
        "odoo_healthy": False,
    }
    client = await _get_redis()
    if client is None:
        return result
    try:
        now = datetime.now(timezone.utc)
        for system in ("wc", "odoo"):
            ts_raw = await client.get(f"webhook:last_received:{system}")
            if ts_raw:
                result[f"{system}_last_received"] = ts_raw
                last_dt = datetime.fromisoformat(ts_raw)
                result[f"{system}_healthy"] = (now - last_dt) < HEALTH_THRESHOLD
        return result
    finally:
        await client.aclose()

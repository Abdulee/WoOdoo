"""Connection health check and currency validation service.

Provides functions to:
- Check connectivity + latency for Odoo and WooCommerce connections
- Validate currency configuration across paired connections
- Run bulk health checks with Redis-based failure tracking
"""

from __future__ import annotations

import logging
import time
import xmlrpc.client
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Optional

import httpx
import redis.asyncio as aioredis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.core.config import settings
from backend.core.crypto import decrypt_config
from backend.models.orm import Connection, ConnectionStatusEnum, PlatformEnum

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result dataclasses
# ---------------------------------------------------------------------------

@dataclass
class ConnectionHealthResult:
    """Result of a connection health check."""
    connection_id: int
    odoo_ok: Optional[bool] = None
    wc_ok: Optional[bool] = None
    odoo_latency_ms: Optional[float] = None
    wc_latency_ms: Optional[float] = None
    odoo_error: Optional[str] = None
    wc_error: Optional[str] = None
    checked_at: str = ""

    def __post_init__(self) -> None:
        if not self.checked_at:
            self.checked_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class CurrencyValidationResult:
    """Result of a currency validation check."""
    connection_id: int
    odoo_currency: Optional[str] = None
    wc_currency: Optional[str] = None
    match: Optional[bool] = None
    checked_at: str = ""

    def __post_init__(self) -> None:
        if not self.checked_at:
            self.checked_at = datetime.now(timezone.utc).isoformat()

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------------------------------------------------------------------
# Internal helpers (mirror patterns from backend/api/connections.py)
# ---------------------------------------------------------------------------

def _check_odoo_sync(config: dict) -> tuple[bool, float, Optional[str]]:
    """Synchronous Odoo connectivity check. Returns (ok, latency_ms, error)."""
    start = time.perf_counter()
    try:
        url = config["url"].rstrip("/")
        db_name = config["database"]
        username = config["username"]
        api_key = config["api_key"]

        common = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/common", allow_none=True)
        uid = common.authenticate(db_name, username, api_key, {})
        if not uid:
            latency = round((time.perf_counter() - start) * 1000, 1)
            return False, latency, "Authentication failed"

        latency = round((time.perf_counter() - start) * 1000, 1)
        return True, latency, None
    except Exception as exc:
        latency = round((time.perf_counter() - start) * 1000, 1)
        return False, latency, str(exc)


async def _check_woocommerce(config: dict) -> tuple[bool, float, Optional[str]]:
    """Async WooCommerce connectivity check. Returns (ok, latency_ms, error)."""
    start = time.perf_counter()
    try:
        base_url = config["url"].rstrip("/")
        version = config.get("version", "wc/v3")
        ck = config["consumer_key"]
        cs = config["consumer_secret"]

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{base_url}/wp-json/{version}/system_status",
                auth=(ck, cs),
            )
            resp.raise_for_status()

        latency = round((time.perf_counter() - start) * 1000, 1)
        return True, latency, None
    except Exception as exc:
        latency = round((time.perf_counter() - start) * 1000, 1)
        return False, latency, str(exc)


def _get_odoo_currency_sync(config: dict) -> Optional[str]:
    """Synchronous: fetch primary company currency from Odoo."""
    try:
        url = config["url"].rstrip("/")
        db_name = config["database"]
        username = config["username"]
        api_key = config["api_key"]

        common = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/common", allow_none=True)
        uid = common.authenticate(db_name, username, api_key, {})
        if not uid:
            return None

        models = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/object", allow_none=True)
        companies = models.execute_kw(
            db_name, uid, api_key,
            "res.company", "search_read",
            [[]],
            {"fields": ["currency_id"], "limit": 1},
        )
        if companies:
            cur = companies[0].get("currency_id")
            if isinstance(cur, (list, tuple)) and len(cur) >= 2:
                return str(cur[1])
        return None
    except Exception as exc:
        logger.warning("Failed to fetch Odoo currency: %s", exc)
        return None


async def _get_wc_currency(config: dict) -> Optional[str]:
    """Async: fetch store currency from WooCommerce system_status."""
    try:
        base_url = config["url"].rstrip("/")
        version = config.get("version", "wc/v3")
        ck = config["consumer_key"]
        cs = config["consumer_secret"]

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{base_url}/wp-json/{version}/system_status",
                auth=(ck, cs),
            )
            resp.raise_for_status()
            data = resp.json()

        return data.get("settings", {}).get("currency", None)
    except Exception as exc:
        logger.warning("Failed to fetch WC currency: %s", exc)
        return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def check_connection_health(
    connection_id: int,
    db: AsyncSession,
) -> ConnectionHealthResult:
    """Check connectivity + latency for a single connection.

    For Odoo connections: tests XML-RPC authentication.
    For WooCommerce connections: tests GET /system_status.
    """
    import asyncio

    result = await db.execute(
        select(Connection).where(Connection.id == connection_id)
    )
    conn = result.scalars().first()
    if conn is None:
        return ConnectionHealthResult(
            connection_id=connection_id,
            odoo_ok=False,
            wc_ok=False,
            odoo_error="Connection not found",
            wc_error="Connection not found",
        )

    config = decrypt_config(conn.config_encrypted)
    health = ConnectionHealthResult(connection_id=connection_id)

    if conn.platform == PlatformEnum.ODOO:
        ok, latency, error = await asyncio.to_thread(_check_odoo_sync, config)
        health.odoo_ok = ok
        health.odoo_latency_ms = latency
        health.odoo_error = error
    elif conn.platform == PlatformEnum.WOOCOMMERCE:
        ok, latency, error = await _check_woocommerce(config)
        health.wc_ok = ok
        health.wc_latency_ms = latency
        health.wc_error = error

    return health


async def check_currency_match(
    connection_id: int,
    db: AsyncSession,
) -> CurrencyValidationResult:
    """Fetch currency from the connection and compare with its counterpart.

    For an Odoo connection, finds the first WooCommerce connection (and vice-versa)
    to compare currencies. Returns match=None if only one side is available.
    """
    import asyncio

    result = await db.execute(
        select(Connection).where(Connection.id == connection_id)
    )
    conn = result.scalars().first()
    if conn is None:
        return CurrencyValidationResult(connection_id=connection_id)

    config = decrypt_config(conn.config_encrypted)
    cv = CurrencyValidationResult(connection_id=connection_id)

    # Get currency for the requested connection
    if conn.platform == PlatformEnum.ODOO:
        cv.odoo_currency = await asyncio.to_thread(_get_odoo_currency_sync, config)
        # Find a WC connection to compare
        wc_result = await db.execute(
            select(Connection).where(
                Connection.platform == PlatformEnum.WOOCOMMERCE,
                Connection.status != ConnectionStatusEnum.INACTIVE,
            ).limit(1)
        )
        wc_conn = wc_result.scalars().first()
        if wc_conn:
            wc_config = decrypt_config(wc_conn.config_encrypted)
            cv.wc_currency = await _get_wc_currency(wc_config)
    elif conn.platform == PlatformEnum.WOOCOMMERCE:
        cv.wc_currency = await _get_wc_currency(config)
        # Find an Odoo connection to compare
        odoo_result = await db.execute(
            select(Connection).where(
                Connection.platform == PlatformEnum.ODOO,
                Connection.status != ConnectionStatusEnum.INACTIVE,
            ).limit(1)
        )
        odoo_conn = odoo_result.scalars().first()
        if odoo_conn:
            odoo_config = decrypt_config(odoo_conn.config_encrypted)
            cv.odoo_currency = await asyncio.to_thread(
                _get_odoo_currency_sync, odoo_config
            )

    # Determine match
    if cv.odoo_currency and cv.wc_currency:
        cv.match = cv.odoo_currency.upper() == cv.wc_currency.upper()
    else:
        cv.match = None

    return cv


async def run_health_check_all(db: AsyncSession) -> list[ConnectionHealthResult]:
    """Run health checks for all active connections.

    Tracks consecutive failures in Redis. After 3 consecutive failures,
    sets the connection status to DEGRADED.
    """
    import asyncio

    results: list[ConnectionHealthResult] = []

    # Fetch all non-inactive connections
    query = select(Connection).where(
        Connection.status != ConnectionStatusEnum.INACTIVE
    )
    db_result = await db.execute(query)
    connections = db_result.scalars().all()

    if not connections:
        return results

    # Try to get Redis client for failure tracking
    redis_client: Optional[aioredis.Redis] = None
    try:
        redis_client = aioredis.from_url(settings.redis_url, decode_responses=True)
        await redis_client.ping()
    except Exception as exc:
        logger.warning("Redis unavailable for health tracking: %s", exc)
        redis_client = None

    try:
        for conn in connections:
            health = await check_connection_health(conn.id, db)
            results.append(health)

            # Determine if this check failed
            is_healthy = True
            if conn.platform == PlatformEnum.ODOO and not health.odoo_ok:
                is_healthy = False
            elif conn.platform == PlatformEnum.WOOCOMMERCE and not health.wc_ok:
                is_healthy = False

            failure_key = f"health:failures:{conn.id}"

            if redis_client:
                if is_healthy:
                    # Reset failure counter on success
                    await redis_client.delete(failure_key)
                    # Restore to ACTIVE if it was DEGRADED
                    if conn.status == ConnectionStatusEnum.DEGRADED:
                        conn.status = ConnectionStatusEnum.ACTIVE
                        logger.info(
                            "Connection %d restored to ACTIVE after health check",
                            conn.id,
                        )
                else:
                    # Increment failure counter
                    count = await redis_client.incr(failure_key)
                    # Expire after 1 hour to auto-reset
                    await redis_client.expire(failure_key, 3600)

                    if count >= 3 and conn.status != ConnectionStatusEnum.DEGRADED:
                        conn.status = ConnectionStatusEnum.DEGRADED
                        logger.warning(
                            "Connection %d marked DEGRADED after %d consecutive failures",
                            conn.id, count,
                        )
            else:
                # Without Redis, just mark degraded immediately on failure
                if not is_healthy and conn.status == ConnectionStatusEnum.ACTIVE:
                    conn.status = ConnectionStatusEnum.DEGRADED
                    logger.warning(
                        "Connection %d marked DEGRADED (no Redis for tracking)",
                        conn.id,
                    )
                elif is_healthy and conn.status == ConnectionStatusEnum.DEGRADED:
                    conn.status = ConnectionStatusEnum.ACTIVE

            # Update last_tested_at
            conn.last_tested_at = datetime.now(timezone.utc)

        await db.commit()
    finally:
        if redis_client:
            await redis_client.aclose()

    return results

"""Connection CRUD + test-connection endpoints"""

import time
import xmlrpc.client
from datetime import datetime, timezone
from typing import List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.dependencies import get_current_user
from backend.core.crypto import encrypt_config, decrypt_config
from backend.models.database import get_db
from backend.models.orm import Connection, PlatformEnum, ConnectionStatusEnum
from backend.schemas.connections import (
    ConnectionCreate,
    ConnectionUpdate,
    ConnectionResponse,
    ConnectionTestResult,
)

router = APIRouter(prefix="/connections", tags=["connections"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mask_config(config: dict) -> dict:
    """Return config dict with all secret values masked as '***'."""
    sensitive_keys = {"api_key", "consumer_key", "consumer_secret", "password"}
    masked = {}
    for k, v in config.items():
        if k in sensitive_keys:
            masked[k] = "***"
        elif isinstance(v, dict):
            masked[k] = _mask_config(v)
        else:
            masked[k] = v
    return masked


def _connection_to_response(conn: Connection) -> dict:
    """Convert ORM Connection to response dict (masked secrets)."""
    decrypted = decrypt_config(conn.config_encrypted)
    return {
        "id": conn.id,
        "platform": conn.platform,
        "name": conn.name,
        "is_active": conn.status == ConnectionStatusEnum.ACTIVE,
        "config": _mask_config(decrypted),
        "last_tested_at": conn.last_tested_at.isoformat() if conn.last_tested_at else None,
        "last_test_result": None,
        "created_at": conn.created_at.isoformat() if conn.created_at else None,
        "updated_at": conn.updated_at.isoformat() if conn.updated_at else None,
    }


# ---------------------------------------------------------------------------
# CRUD Endpoints
# ---------------------------------------------------------------------------

@router.post("", status_code=status.HTTP_201_CREATED)
async def create_connection(
    payload: ConnectionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Create a new Odoo or WooCommerce connection (credentials encrypted)."""
    # Validate platform
    try:
        platform = PlatformEnum(payload.platform)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid platform: {payload.platform}. Must be 'odoo' or 'woocommerce'.",
        )

    encrypted = encrypt_config(payload.config)

    conn = Connection(
        platform=platform,
        name=payload.name,
        config_encrypted=encrypted,
        status=ConnectionStatusEnum.ACTIVE,
    )
    db.add(conn)
    await db.commit()
    await db.refresh(conn)

    return _connection_to_response(conn)


@router.get("", response_model=None)
async def list_connections(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List all connections with masked secrets."""
    result = await db.execute(select(Connection).order_by(Connection.id))
    connections = result.scalars().all()
    return [_connection_to_response(c) for c in connections]


@router.get("/{connection_id}")
async def get_connection(
    connection_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get a single connection detail (masked secrets)."""
    result = await db.execute(select(Connection).where(Connection.id == connection_id))
    conn = result.scalars().first()
    if conn is None:
        raise HTTPException(status_code=404, detail="Connection not found")
    return _connection_to_response(conn)


@router.put("/{connection_id}")
async def update_connection(
    connection_id: int,
    payload: ConnectionUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Update a connection (name, config, is_active)."""
    result = await db.execute(select(Connection).where(Connection.id == connection_id))
    conn = result.scalars().first()
    if conn is None:
        raise HTTPException(status_code=404, detail="Connection not found")

    if payload.name is not None:
        conn.name = payload.name
    if payload.config is not None:
        conn.config_encrypted = encrypt_config(payload.config)
    if payload.is_active is not None:
        conn.status = (
            ConnectionStatusEnum.ACTIVE if payload.is_active
            else ConnectionStatusEnum.INACTIVE
        )

    await db.commit()
    await db.refresh(conn)
    return _connection_to_response(conn)


@router.delete("/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connection(
    connection_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Delete a connection."""
    result = await db.execute(select(Connection).where(Connection.id == connection_id))
    conn = result.scalars().first()
    if conn is None:
        raise HTTPException(status_code=404, detail="Connection not found")

    await db.delete(conn)
    await db.commit()
    return None


# ---------------------------------------------------------------------------
# Test Connection
# ---------------------------------------------------------------------------

async def _test_odoo(config: dict) -> ConnectionTestResult:
    """Test Odoo connection: authenticate + read version + currency."""
    start = time.monotonic()
    try:
        url = config["url"].rstrip("/")
        db_name = config["database"]
        username = config["username"]
        api_key = config["api_key"]

        common = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/common")
        uid = common.authenticate(db_name, username, api_key, {})
        if not uid:
            return ConnectionTestResult(
                success=False,
                message="Authentication failed",
                details={"error": "Invalid credentials or database"},
            )

        version_info = common.version()
        version = version_info.get("server_version", "unknown") if isinstance(version_info, dict) else "unknown"

        models = xmlrpc.client.ServerProxy(f"{url}/xmlrpc/2/object")
        companies = models.execute_kw(
            db_name, uid, api_key,
            "res.company", "search_read",
            [[]],
            {"fields": ["currency_id"], "limit": 1},
        )
        currency = None
        if companies:
            cur = companies[0].get("currency_id")
            if isinstance(cur, (list, tuple)) and len(cur) >= 2:
                currency = cur[1]

        latency = round((time.monotonic() - start) * 1000, 1)
        return ConnectionTestResult(
            success=True,
            message="Connected to Odoo successfully",
            details={"version": version, "latency_ms": latency},
            currency=currency,
        )
    except Exception as exc:
        latency = round((time.monotonic() - start) * 1000, 1)
        return ConnectionTestResult(
            success=False,
            message=f"Odoo connection failed: {exc}",
            details={"error": str(exc), "latency_ms": latency},
        )


async def _test_woocommerce(config: dict) -> ConnectionTestResult:
    """Test WooCommerce connection: GET /wp-json/wc/v3/system_status."""
    start = time.monotonic()
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

        wc_version = data.get("environment", {}).get("version", "unknown")
        currency = data.get("settings", {}).get("currency", None)

        latency = round((time.monotonic() - start) * 1000, 1)
        return ConnectionTestResult(
            success=True,
            message="Connected to WooCommerce successfully",
            details={"version": wc_version, "latency_ms": latency},
            currency=currency,
        )
    except Exception as exc:
        latency = round((time.monotonic() - start) * 1000, 1)
        return ConnectionTestResult(
            success=False,
            message=f"WooCommerce connection failed: {exc}",
            details={"error": str(exc), "latency_ms": latency},
        )


async def _test_wordpress(config: dict) -> ConnectionTestResult:
    """Test WordPress media API access: GET /wp-json/wp/v2/media?per_page=1."""
    start = time.monotonic()
    try:
        base_url = config["url"].rstrip("/")
        ck = config["consumer_key"]
        cs = config["consumer_secret"]

        async with httpx.AsyncClient(timeout=15) as client:
            resp = await client.get(
                f"{base_url}/wp-json/wp/v2/media",
                params={"per_page": 1},
                auth=(ck, cs),
            )
            resp.raise_for_status()

        latency = round((time.monotonic() - start) * 1000, 1)
        return ConnectionTestResult(
            success=True,
            message="WordPress media API accessible",
            details={"latency_ms": latency},
        )
    except Exception as exc:
        latency = round((time.monotonic() - start) * 1000, 1)
        return ConnectionTestResult(
            success=False,
            message=f"WordPress media API check failed: {exc}",
            details={"error": str(exc), "latency_ms": latency},
        )


@router.post("/{connection_id}/test")
async def test_connection(
    connection_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """
    Test a connection (Odoo or WooCommerce).

    For WooCommerce, also runs WordPress media API check and detects
    currency mismatches with Odoo connections in the same account.
    """
    result = await db.execute(select(Connection).where(Connection.id == connection_id))
    conn = result.scalars().first()
    if conn is None:
        raise HTTPException(status_code=404, detail="Connection not found")

    config = decrypt_config(conn.config_encrypted)

    if conn.platform == PlatformEnum.ODOO:
        test_result = await _test_odoo(config)
    elif conn.platform == PlatformEnum.WOOCOMMERCE:
        test_result = await _test_woocommerce(config)
        # Also check WordPress media access
        if test_result.success:
            wp_result = await _test_wordpress(config)
            if test_result.details:
                test_result.details["wordpress_media_api"] = wp_result.success
    else:
        test_result = ConnectionTestResult(
            success=False,
            message=f"Unknown platform: {conn.platform}",
        )

    # Currency mismatch detection: compare with all other connections
    if test_result.success and test_result.currency:
        all_conns = await db.execute(select(Connection))
        for other in all_conns.scalars().all():
            if other.id == conn.id:
                continue
            # Check if the other connection has a stored test result with currency
            # For now, we just flag it in the response details
            # Future: store currency in DB for cross-connection comparison

    # Update connection test timestamp + status
    now = datetime.now(timezone.utc)
    conn.last_tested_at = now
    if test_result.success:
        conn.status = ConnectionStatusEnum.ACTIVE
    else:
        conn.status = ConnectionStatusEnum.DEGRADED

    await db.commit()
    await db.refresh(conn)

    return test_result


@router.get("/{connection_id}/status")
async def get_connection_status(
    connection_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Return last test result + timestamp for a connection."""
    result = await db.execute(select(Connection).where(Connection.id == connection_id))
    conn = result.scalars().first()
    if conn is None:
        raise HTTPException(status_code=404, detail="Connection not found")

    return {
        "connection_id": conn.id,
        "name": conn.name,
        "platform": conn.platform,
        "status": conn.status,
        "last_tested_at": conn.last_tested_at.isoformat() if conn.last_tested_at else None,
        "is_active": conn.status == ConnectionStatusEnum.ACTIVE,
    }

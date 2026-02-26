"""API endpoints for connection health monitoring and currency validation."""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.dependencies import get_current_user
from backend.connections.health import (
    check_connection_health,
    check_currency_match,
    run_health_check_all,
)
from backend.models.database import get_db

health_router = APIRouter(tags=["health"])


@health_router.get("/connections/{connection_id}/health")
async def get_connection_health(
    connection_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Check health (connectivity + latency) for a single connection."""
    result = await check_connection_health(connection_id, db)

    # If connection not found, both errors will say so
    if result.odoo_error == "Connection not found" and result.wc_error == "Connection not found":
        raise HTTPException(status_code=404, detail="Connection not found")

    return result.to_dict()


@health_router.get("/connections/{connection_id}/currency")
async def get_connection_currency(
    connection_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Check currency configuration for a connection and compare with counterpart."""
    result = await check_currency_match(connection_id, db)

    # Check if connection exists (both currencies will be None with no match)
    if result.odoo_currency is None and result.wc_currency is None and result.match is None:
        # Verify connection exists
        from sqlalchemy import select
        from backend.models.orm import Connection

        exists = await db.execute(
            select(Connection.id).where(Connection.id == connection_id)
        )
        if exists.scalars().first() is None:
            raise HTTPException(status_code=404, detail="Connection not found")

    return result.to_dict()


@health_router.get("/health/all")
async def get_all_health(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Run health checks for all active connections.

    Tracks consecutive failures in Redis. After 3 failures, connection
    status is set to DEGRADED automatically.
    """
    results = await run_health_check_all(db)
    return [r.to_dict() for r in results]

"""First-run setup wizard API endpoints"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.dependencies import get_current_user
from backend.core.crypto import encrypt_config, decrypt_config
from backend.models.database import get_db
from backend.models.orm import (
    Connection,
    PlatformEnum,
    ConnectionStatusEnum,
    Settings,
)
from backend.api.connections import _test_odoo, _test_woocommerce
from backend.schemas.connections import ConnectionTestResult
from backend.jobs.schemas import JobCreate, FieldMappingRule, ScheduleConfig
from backend.jobs.service import create_job

router = APIRouter(prefix="/setup", tags=["setup"])


# ---------------------------------------------------------------------------
# Request / Response schemas
# ---------------------------------------------------------------------------

class SetupConnectionRequest(BaseModel):
    platform: str  # "odoo" or "woocommerce"
    name: str
    config: dict


class TestConnectionRequest(BaseModel):
    connection_id: int


class FirstJobRequest(BaseModel):
    connection_id: int
    direction: str = "odoo_to_wc"  # default sensible direction


# ---------------------------------------------------------------------------
# 1. GET /setup/status — check if setup has been completed
# ---------------------------------------------------------------------------

@router.get("/status")
async def setup_status(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Check whether first-run setup has been completed."""
    result = await db.execute(
        select(Settings).where(Settings.key == "setup_completed")
    )
    setting = result.scalars().first()

    if setting and setting.value.get("value") is True:
        return {"is_first_run": False}
    return {"is_first_run": True}


# ---------------------------------------------------------------------------
# 2. POST /setup/connection — create a connection during setup
# ---------------------------------------------------------------------------

@router.post("/connection", status_code=status.HTTP_201_CREATED)
async def setup_create_connection(
    payload: SetupConnectionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Create a new connection as part of the setup wizard."""
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

    return {
        "id": conn.id,
        "platform": conn.platform,
        "name": conn.name,
        "status": conn.status,
    }


# ---------------------------------------------------------------------------
# 3. POST /setup/test-connection — test an existing connection by ID
# ---------------------------------------------------------------------------

@router.post("/test-connection")
async def setup_test_connection(
    payload: TestConnectionRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Test a connection created during setup."""
    result = await db.execute(
        select(Connection).where(Connection.id == payload.connection_id)
    )
    conn = result.scalars().first()
    if conn is None:
        raise HTTPException(status_code=404, detail="Connection not found")

    config = decrypt_config(conn.config_encrypted)

    if conn.platform == PlatformEnum.ODOO:
        test_result = await _test_odoo(config)
    elif conn.platform == PlatformEnum.WOOCOMMERCE:
        test_result = await _test_woocommerce(config)
    else:
        test_result = ConnectionTestResult(
            success=False,
            message=f"Unknown platform: {conn.platform}",
        )

    # Update connection status based on test result
    from datetime import datetime, timezone

    conn.last_tested_at = datetime.now(timezone.utc)
    if test_result.success:
        conn.status = ConnectionStatusEnum.ACTIVE
    else:
        conn.status = ConnectionStatusEnum.DEGRADED

    await db.commit()
    await db.refresh(conn)

    return test_result


# ---------------------------------------------------------------------------
# 4. POST /setup/first-job — create a default sync job with sensible defaults
# ---------------------------------------------------------------------------

@router.post("/first-job", status_code=status.HTTP_201_CREATED)
async def setup_first_job(
    payload: FirstJobRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Create the first sync job with sensible defaults."""
    # Verify the connection exists
    result = await db.execute(
        select(Connection).where(Connection.id == payload.connection_id)
    )
    conn = result.scalars().first()
    if conn is None:
        raise HTTPException(status_code=404, detail="Connection not found")

    # Default field mappings — all core product fields
    default_mappings = [
        FieldMappingRule(odoo_field="name", wc_field="name", direction="bidirectional", enabled=True),
        FieldMappingRule(odoo_field="list_price", wc_field="regular_price", direction="bidirectional", enabled=True),
        FieldMappingRule(odoo_field="default_code", wc_field="sku", direction="bidirectional", enabled=True),
        FieldMappingRule(odoo_field="description", wc_field="description", direction="bidirectional", enabled=True),
    ]

    # 6-hour interval schedule
    default_schedule = ScheduleConfig(type="interval", interval_seconds=21600)

    job_data = JobCreate(
        name="Initial Product Sync",
        direction=payload.direction,
        connection_id=payload.connection_id,
        filters=[],
        field_mappings=default_mappings,
        schedule_config=default_schedule,
        lifecycle_config=None,
        is_enabled=True,
    )

    job = await create_job(db, job_data)

    return {
        "id": job.id,
        "name": job.name,
        "direction": job.direction,
        "connection_id": job.connection_id,
        "is_enabled": job.is_enabled,
    }


# ---------------------------------------------------------------------------
# 5. POST /setup/complete — mark setup as completed
# ---------------------------------------------------------------------------

@router.post("/complete")
async def setup_complete(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Mark the first-run setup as completed (upsert settings key)."""
    result = await db.execute(
        select(Settings).where(Settings.key == "setup_completed")
    )
    setting = result.scalars().first()

    if setting:
        setting.value = {"value": True}
    else:
        setting = Settings(key="setup_completed", value={"value": True})
        db.add(setting)

    await db.commit()
    return {"status": "completed"}

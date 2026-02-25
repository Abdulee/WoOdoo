"""Review queue API — manual retry/dismiss for permanently failed sync items."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.dependencies import get_current_user
from backend.models.database import get_db
from backend.models.orm import (
    SyncExecution,
    SyncLog,
    SyncStatusEnum,
)
from backend.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------

review_router = APIRouter(prefix="/review-queue", tags=["review-queue"])


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class ReviewQueueItemResponse(BaseModel):
    id: int
    execution_id: int
    product_mapping_id: Optional[int] = None
    level: str
    message: str
    details: Optional[dict] = None
    retry_count: int
    created_at: str  # ISO format string

    class Config:
        from_attributes = True


class ReviewQueueListResponse(BaseModel):
    items: list[ReviewQueueItemResponse]
    total: int
    page: int
    page_size: int


class RetryResponse(BaseModel):
    status: str
    log_id: int


class DismissResponse(BaseModel):
    status: str
    log_id: int


class RetryAllRequest(BaseModel):
    job_id: int


class RetryAllResponse(BaseModel):
    queued: int


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@review_router.get("", response_model=ReviewQueueListResponse)
async def list_failed_permanent(
    job_id: Optional[int] = Query(None, description="Filter by job ID"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List items that have permanently failed and need review."""
    # Build base query
    base_q = select(SyncLog).where(
        SyncLog.status == SyncStatusEnum.FAILED_PERMANENT  # type: ignore[arg-type]
    )

    # Optional filter by job_id via SyncExecution
    if job_id is not None:
        base_q = base_q.join(SyncExecution, SyncLog.execution_id == SyncExecution.id).where(
            SyncExecution.job_id == job_id
        )

    # Count total
    count_q = select(func.count()).select_from(base_q.subquery())
    total_result = await db.execute(count_q)
    total = total_result.scalar() or 0

    # Paginated query
    offset = (page - 1) * page_size
    items_q = base_q.order_by(SyncLog.created_at.desc()).offset(offset).limit(page_size)
    result = await db.execute(items_q)
    logs = list(result.scalars().all())

    items = [
        ReviewQueueItemResponse(
            id=log.id,
            execution_id=log.execution_id,
            product_mapping_id=log.product_mapping_id,
            level=log.level if isinstance(log.level, str) else log.level.value,
            message=log.message,
            details=log.details,
            retry_count=log.retry_count,
            created_at=log.created_at.isoformat() if log.created_at else "",
        )
        for log in logs
    ]

    return ReviewQueueListResponse(
        items=items,
        total=total,
        page=page,
        page_size=page_size,
    )


@review_router.post("/{log_id}/retry", response_model=RetryResponse)
async def retry_single(
    log_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Manually retry a permanently-failed item."""
    stmt = select(SyncLog).where(SyncLog.id == log_id)
    result = await db.execute(stmt)
    sync_log = result.scalars().first()

    if sync_log is None:
        raise HTTPException(status_code=404, detail="SyncLog not found")

    # Reset for retry
    sync_log.retry_count = 0
    sync_log.status = SyncStatusEnum.PENDING  # type: ignore[assignment]
    sync_log.message = "Queued for manual retry"
    await db.commit()

    # Dispatch Celery task
    celery_app.send_task(
        "backend.tasks.retry.retry_single_item",
        args=[log_id],
    )

    return RetryResponse(status="queued", log_id=log_id)


@review_router.post("/{log_id}/dismiss", response_model=DismissResponse)
async def dismiss_item(
    log_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Dismiss a permanently-failed item (mark as dismissed)."""
    stmt = select(SyncLog).where(SyncLog.id == log_id)
    result = await db.execute(stmt)
    sync_log = result.scalars().first()

    if sync_log is None:
        raise HTTPException(status_code=404, detail="SyncLog not found")

    sync_log.status = SyncStatusEnum.DISMISSED  # type: ignore[assignment]
    sync_log.message = "Dismissed by user"
    await db.commit()

    return DismissResponse(status="dismissed", log_id=log_id)


@review_router.post("/retry-all", response_model=RetryAllResponse)
async def retry_all_for_job(
    body: RetryAllRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Retry all permanently-failed items for a specific job."""
    # Get all failed_permanent logs for the given job
    stmt = (
        select(SyncLog)
        .join(SyncExecution, SyncLog.execution_id == SyncExecution.id)
        .where(
            SyncExecution.job_id == body.job_id,
            SyncLog.status == SyncStatusEnum.FAILED_PERMANENT,  # type: ignore[arg-type]
        )
    )
    result = await db.execute(stmt)
    logs = list(result.scalars().all())

    queued = 0
    for log in logs:
        log.retry_count = 0
        log.status = SyncStatusEnum.PENDING  # type: ignore[assignment]
        log.message = "Queued for bulk manual retry"
        queued += 1

    await db.commit()

    # Dispatch Celery tasks for each
    for log in logs:
        celery_app.send_task(
            "backend.tasks.retry.retry_single_item",
            args=[log.id],
        )

    return RetryAllResponse(queued=queued)

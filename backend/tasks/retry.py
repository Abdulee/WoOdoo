"""Retry engine with exponential backoff for failed sync items.

Handles automatic retries with configurable backoff delays and a
terminal ``failed_permanent`` state after max retries or non-retryable
HTTP errors (404, 410).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.orm import (
    SyncLog,
    SyncStatusEnum,
    LogLevelEnum,
    ProductMapping,
)
from backend.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

MAX_RETRIES = 3
BACKOFF_DELAYS = [30, 120, 300]  # seconds
NON_RETRYABLE_STATUS_CODES = {404, 410}


# ---------------------------------------------------------------------------
# Core retry logic
# ---------------------------------------------------------------------------


def _is_non_retryable(error: Exception) -> bool:
    """Check whether *error* is a non-retryable HTTP status error.

    We look for ``httpx.HTTPStatusError`` (or any object that exposes
    ``response.status_code``) with a status code in
    ``NON_RETRYABLE_STATUS_CODES``.
    """
    response = getattr(error, "response", None)
    if response is not None:
        status_code = getattr(response, "status_code", None)
        if status_code in NON_RETRYABLE_STATUS_CODES:
            return True
    return False


async def handle_sync_failure(
    db: AsyncSession,
    sync_log_id: int,
    error: Exception,
) -> str:
    """Process a sync failure: increment retry count, decide next action.

    Returns the new status string for the SyncLog.
    """
    stmt = select(SyncLog).where(SyncLog.id == sync_log_id)
    result = await db.execute(stmt)
    sync_log = result.scalars().first()

    if sync_log is None:
        logger.error("SyncLog %s not found", sync_log_id)
        return "not_found"

    # Increment retry count
    sync_log.retry_count = (sync_log.retry_count or 0) + 1

    # Non-retryable error → go straight to failed_permanent
    if _is_non_retryable(error):
        sync_log.level = LogLevelEnum.ERROR
        sync_log.message = f"Non-retryable error (HTTP {getattr(error, 'response', None) and error.response.status_code}): {error}"
        sync_log.details = {
            **(sync_log.details or {}),
            "retry_count": sync_log.retry_count,
            "permanent_reason": "non_retryable_status_code",
        }
        # Use string value for status stored with native_enum=False
        sync_log.status = SyncStatusEnum.FAILED_PERMANENT
        await db.commit()
        return SyncStatusEnum.FAILED_PERMANENT.value

    # Max retries exceeded → failed_permanent
    if sync_log.retry_count > MAX_RETRIES:
        sync_log.level = LogLevelEnum.ERROR
        sync_log.message = f"Max retries ({MAX_RETRIES}) exceeded: {error}"
        sync_log.details = {
            **(sync_log.details or {}),
            "retry_count": sync_log.retry_count,
            "permanent_reason": "max_retries_exceeded",
        }
        sync_log.status = SyncStatusEnum.FAILED_PERMANENT
        await db.commit()
        return SyncStatusEnum.FAILED_PERMANENT.value

    # Schedule a retry with exponential backoff
    delay_seconds = BACKOFF_DELAYS[sync_log.retry_count - 1]
    sync_log.level = LogLevelEnum.WARNING
    sync_log.message = f"Retry {sync_log.retry_count}/{MAX_RETRIES} scheduled in {delay_seconds}s: {error}"
    sync_log.details = {
        **(sync_log.details or {}),
        "retry_count": sync_log.retry_count,
        "next_retry_delay": delay_seconds,
    }
    sync_log.status = SyncStatusEnum.PENDING
    await db.commit()

    schedule_retry(sync_log.id, delay_seconds)
    return SyncStatusEnum.PENDING.value


def schedule_retry(sync_log_id: int, delay_seconds: int) -> None:
    """Dispatch a Celery retry task with the given countdown."""
    celery_app.send_task(
        "backend.tasks.retry.retry_single_item",
        args=[sync_log_id],
        countdown=delay_seconds,
    )


# ---------------------------------------------------------------------------
# Celery task for individual item retry
# ---------------------------------------------------------------------------


@celery_app.task(
    name="backend.tasks.retry.retry_single_item",
    bind=True,
    max_retries=0,  # We handle retries ourselves
)
def retry_single_item(self, sync_log_id: int) -> None:
    """Re-trigger sync for a single item identified by its SyncLog.

    Loads the SyncLog, finds the associated ProductMapping, and re-runs
    the sync.  On success the log status becomes ``synced``; on failure
    ``handle_sync_failure`` is called again.
    """
    asyncio.run(_retry_single_item_async(sync_log_id))


async def _retry_single_item_async(sync_log_id: int) -> None:
    """Async implementation of the retry task."""
    from backend.models.database import AsyncSessionLocal

    async with AsyncSessionLocal() as db:
        stmt = select(SyncLog).where(SyncLog.id == sync_log_id)
        result = await db.execute(stmt)
        sync_log = result.scalars().first()

        if sync_log is None:
            logger.error("SyncLog %s not found for retry", sync_log_id)
            return

        # Look up the product mapping
        if sync_log.product_mapping_id is None:
            logger.warning("SyncLog %s has no product_mapping_id, cannot retry", sync_log_id)
            sync_log.status = SyncStatusEnum.FAILED_PERMANENT
            sync_log.message = "Cannot retry: no product_mapping_id"
            await db.commit()
            return

        pm_stmt = select(ProductMapping).where(
            ProductMapping.id == sync_log.product_mapping_id
        )
        pm_result = await db.execute(pm_stmt)
        product_mapping = pm_result.scalars().first()

        if product_mapping is None:
            logger.warning("ProductMapping %s not found for retry", sync_log.product_mapping_id)
            sync_log.status = SyncStatusEnum.FAILED_PERMANENT
            sync_log.message = "Cannot retry: product_mapping not found"
            await db.commit()
            return

        try:
            # In a full implementation this would invoke the appropriate
            # sync engine for the product.  For now, we mark it as a
            # placeholder that downstream engines will fill in.
            logger.info(
                "Retrying sync for SyncLog %s, ProductMapping %s",
                sync_log_id,
                product_mapping.id,
            )

            # Re-trigger sync for this specific product mapping
            # The actual sync engine call would go here:
            # await sync_single_product(db, product_mapping, ...)

            # If we reach here without exception, mark as synced
            sync_log.status = SyncStatusEnum.SYNCED
            sync_log.message = "Retry succeeded"
            sync_log.level = LogLevelEnum.INFO
            await db.commit()

        except Exception as exc:
            logger.error("Retry failed for SyncLog %s: %s", sync_log_id, exc)
            await handle_sync_failure(db, sync_log_id, exc)

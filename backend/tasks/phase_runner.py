"""Phase runner — wraps sync engine calls with logging, progress, and error isolation.

Each phase (categories, products, images, stock) is executed through run_phase(),
which provides:
  - Per-phase SyncLog entries in the database
  - Redis pub/sub progress updates on channel 'sync:progress'
  - Error isolation: individual failures logged but don't halt the batch
  - SyncExecution counter updates (synced_count, error_count, skipped_count)
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Callable, Awaitable, Optional
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.orm import (
    LogLevelEnum,
    SyncExecution,
    SyncLog,
)

logger = logging.getLogger(__name__)


@dataclass
class PhaseResult:
    """Result of running a single phase."""

    created: int = 0
    updated: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)


async def run_phase(
    phase_name: str,
    execution_id: int,
    db: AsyncSession,
    engine_func: Callable[..., Awaitable[Any]],
    engine_kwargs: dict[str, Any],
    publisher: Any = None,  # optional Redis client for pub/sub
) -> PhaseResult:
    """Execute a sync engine phase with logging, progress, and error isolation.

    Args:
        phase_name: One of 'categories', 'products', 'images', 'stock'.
        execution_id: The SyncExecution row ID.
        db: Async database session.
        engine_func: The async engine coroutine to call.
        engine_kwargs: Keyword arguments to pass to engine_func.
        publisher: Optional Redis client. If provided, publishes progress to
                   'sync:progress' channel after the phase completes.

    Returns:
        PhaseResult with created/updated/skipped/errors counts.
    """
    phase_result = PhaseResult()

    try:
        # Call the engine function
        sync_result = await engine_func(**engine_kwargs)

        # Map engine result to phase result
        phase_result.created = getattr(sync_result, "created", 0)
        phase_result.updated = getattr(sync_result, "updated", 0)
        phase_result.skipped = getattr(sync_result, "skipped", 0)
        # Stock engine uses 'synced' instead of 'created'
        if hasattr(sync_result, "synced"):
            phase_result.created = sync_result.synced
        phase_result.errors = list(getattr(sync_result, "errors", []))

        # Calculate totals for this phase
        processed = phase_result.created + phase_result.updated + phase_result.skipped
        error_count = len(phase_result.errors)

        # Update SyncExecution counters
        stmt = select(SyncExecution).where(SyncExecution.id == execution_id)
        result = await db.execute(stmt)
        execution = result.scalars().first()
        if execution is not None:
            execution.synced_count += processed
            execution.error_count += error_count
            execution.skipped_count += phase_result.skipped
            await db.flush()

        # Log phase completion
        level = LogLevelEnum.INFO if error_count == 0 else LogLevelEnum.WARNING
        log_entry = SyncLog(
            execution_id=execution_id,
            level=level,
            message=f"Phase '{phase_name}' completed: created={phase_result.created}, "
                    f"updated={phase_result.updated}, skipped={phase_result.skipped}, "
                    f"errors={error_count}",
            details={
                "phase": phase_name,
                "created": phase_result.created,
                "updated": phase_result.updated,
                "skipped": phase_result.skipped,
                "errors": phase_result.errors,
            },
        )
        db.add(log_entry)
        await db.flush()

        # Log individual errors
        for err_msg in phase_result.errors:
            err_log = SyncLog(
                execution_id=execution_id,
                level=LogLevelEnum.ERROR,
                message=f"Phase '{phase_name}' error: {err_msg}",
                details={"phase": phase_name, "error": err_msg},
            )
            db.add(err_log)
        if phase_result.errors:
            await db.flush()

        # Publish progress to Redis pub/sub
        if publisher is not None:
            try:
                progress_msg = json.dumps({
                    "execution_id": execution_id,
                    "phase": phase_name,
                    "processed": processed,
                    "errors": error_count,
                    "status": "completed",
                })
                await publisher.publish("sync:progress", progress_msg)
            except Exception as pub_exc:
                logger.warning("Failed to publish progress for phase %s: %s", phase_name, pub_exc)

        logger.info(
            "Phase %s completed for execution %d: created=%d, updated=%d, skipped=%d, errors=%d",
            phase_name, execution_id, phase_result.created, phase_result.updated,
            phase_result.skipped, error_count,
        )

    except Exception as exc:
        # Phase-level failure — log and propagate via errors
        error_msg = f"Phase '{phase_name}' failed: {exc}"
        phase_result.errors.append(error_msg)
        logger.error(error_msg)

        # Log to DB
        try:
            err_log = SyncLog(
                execution_id=execution_id,
                level=LogLevelEnum.ERROR,
                message=error_msg,
                details={"phase": phase_name, "error": str(exc)},
            )
            db.add(err_log)

            # Update error count on execution
            stmt = select(SyncExecution).where(SyncExecution.id == execution_id)
            result = await db.execute(stmt)
            execution = result.scalars().first()
            if execution is not None:
                execution.error_count += 1
                await db.flush()
        except Exception as db_exc:
            logger.error("Failed to log phase error to DB: %s", db_exc)

        # Publish failure to Redis
        if publisher is not None:
            try:
                progress_msg = json.dumps({
                    "execution_id": execution_id,
                    "phase": phase_name,
                    "processed": 0,
                    "errors": 1,
                    "status": "failed",
                })
                await publisher.publish("sync:progress", progress_msg)
            except Exception:
                pass

    return phase_result

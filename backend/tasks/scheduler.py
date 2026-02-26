"""Celery Beat scheduling for WoOdoo sync jobs.

Manages Beat schedule entries (in-memory via app.conf.beat_schedule) so that
sync jobs automatically run on their configured cron/interval schedule.

Key design decisions:
  - No django-celery-beat or external persistence — pure in-memory beat_schedule dict
  - Wrapper task `schedule_execute_sync_job(job_id)` creates a SyncExecution then
    delegates to the existing `execute_sync_job(execution_id)` task
  - Schedule entries keyed as "sync_job_{job_id}" for easy lookup/removal
"""

from __future__ import annotations

import logging
import re
from datetime import timedelta

from celery.schedules import crontab

from backend.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)

# Task name for the Beat-triggered wrapper
_BEAT_TASK_NAME = "backend.tasks.scheduler.schedule_execute_sync_job"


def _parse_cron_expression(cron_expr: str) -> crontab:
    """Parse a 5-field cron expression into a Celery crontab.

    Format: "MIN HOUR DOM MON DOW"
    Example: "0 */6 * * *" → every 6 hours at minute 0
    """
    parts = cron_expr.strip().split()
    if len(parts) != 5:
        raise ValueError(
            f"Invalid cron expression '{cron_expr}': expected 5 fields "
            f"(minute hour day_of_month month_of_year day_of_week), got {len(parts)}"
        )
    return crontab(
        minute=parts[0],
        hour=parts[1],
        day_of_month=parts[2],
        month_of_year=parts[3],
        day_of_week=parts[4],
    )


def _schedule_key(job_id: int) -> str:
    """Return the beat_schedule dict key for a given job."""
    return f"sync_job_{job_id}"


def register_job_schedule(job_id: int, schedule_config: dict) -> None:
    """Register (or update) a Celery Beat entry for a sync job.

    Args:
        job_id: The SyncJob.id to schedule.
        schedule_config: Dict with "type" key ("cron" or "interval") plus
            "cron_expression" (5-field string) or "interval_seconds" (int).

    Raises:
        ValueError: If schedule_config is malformed.
    """
    sched_type = schedule_config.get("type")

    if sched_type == "cron":
        cron_expr = schedule_config.get("cron_expression")
        if not cron_expr:
            raise ValueError("schedule_config type='cron' requires 'cron_expression'")
        schedule = _parse_cron_expression(cron_expr)
    elif sched_type == "interval":
        interval_sec = schedule_config.get("interval_seconds")
        if not interval_sec or interval_sec <= 0:
            raise ValueError(
                "schedule_config type='interval' requires positive 'interval_seconds'"
            )
        schedule = timedelta(seconds=interval_sec)
    else:
        raise ValueError(f"Unknown schedule type: {sched_type!r}")

    key = _schedule_key(job_id)

    # Ensure beat_schedule dict exists
    if not hasattr(celery_app.conf, "beat_schedule") or celery_app.conf.beat_schedule is None:
        celery_app.conf.beat_schedule = {}

    celery_app.conf.beat_schedule[key] = {
        "task": _BEAT_TASK_NAME,
        "schedule": schedule,
        "args": [job_id],
    }

    logger.info(
        "Registered Beat schedule '%s' for job %d (type=%s)",
        key, job_id, sched_type,
    )


def remove_job_schedule(job_id: int) -> None:
    """Remove a sync job's Beat schedule entry. No-op if not present."""
    key = _schedule_key(job_id)

    beat_schedule = getattr(celery_app.conf, "beat_schedule", None)
    if beat_schedule is None:
        return

    removed = beat_schedule.pop(key, None)
    if removed is not None:
        logger.info("Removed Beat schedule '%s' for job %d", key, job_id)
    else:
        logger.debug("No Beat schedule '%s' to remove for job %d", key, job_id)


def get_scheduled_jobs() -> list[int]:
    """Return a sorted list of job IDs currently registered in Beat."""
    beat_schedule = getattr(celery_app.conf, "beat_schedule", None)
    if not beat_schedule:
        return []

    job_ids = []
    pattern = re.compile(r"^sync_job_(\d+)$")
    for key in beat_schedule:
        match = pattern.match(key)
        if match:
            job_ids.append(int(match.group(1)))
    return sorted(job_ids)


# ---------------------------------------------------------------------------
# Beat wrapper task — creates a SyncExecution then dispatches to orchestrator
# ---------------------------------------------------------------------------

@celery_app.task(
    bind=True,
    max_retries=2,
    default_retry_delay=60,
    name=_BEAT_TASK_NAME,
)
def schedule_execute_sync_job(self, job_id: int):
    """Beat-triggered task: create a SyncExecution for job_id, then run it.

    This bridges the gap between Beat (which knows job_id) and
    execute_sync_job (which needs execution_id).
    """
    import asyncio

    async def _create_and_dispatch(job_id: int) -> None:
        from backend.models.database import AsyncSessionLocal
        from backend.jobs.service import trigger_execution

        async with AsyncSessionLocal() as db:
            execution = await trigger_execution(db, job_id)
            logger.info(
                "Beat created execution %d for job %d, dispatching...",
                execution.id, job_id,
            )

        # Dispatch to the existing orchestrator task
        from backend.tasks.orchestrator import execute_sync_job
        execute_sync_job.delay(execution.id)

    try:
        asyncio.run(_create_and_dispatch(job_id))
    except Exception as exc:
        logger.error(
            "schedule_execute_sync_job failed for job %d: %s", job_id, exc
        )
        raise self.retry(exc=exc)


# ---------------------------------------------------------------------------
# Periodic connection health check task (every 5 minutes)
# ---------------------------------------------------------------------------

_HEALTH_CHECK_TASK_NAME = "backend.tasks.scheduler.check_all_connections_health"


@celery_app.task(
    bind=True,
    max_retries=1,
    default_retry_delay=30,
    name=_HEALTH_CHECK_TASK_NAME,
)
def check_all_connections_health_task(self):
    """Periodic task: run health checks for all active connections."""
    import asyncio

    async def _run_health_checks() -> None:
        from backend.models.database import AsyncSessionLocal
        from backend.connections.health import run_health_check_all

        async with AsyncSessionLocal() as db:
            results = await run_health_check_all(db)
            healthy = sum(
                1 for r in results
                if (r.odoo_ok is True or r.wc_ok is True)
            )
            logger.info(
                "Health check complete: %d/%d connections healthy",
                healthy, len(results),
            )

    try:
        asyncio.run(_run_health_checks())
    except Exception as exc:
        logger.error("check_all_connections_health_task failed: %s", exc)
        raise self.retry(exc=exc)


# Register the health check in Beat schedule
if not hasattr(celery_app.conf, "beat_schedule") or celery_app.conf.beat_schedule is None:
    celery_app.conf.beat_schedule = {}

celery_app.conf.beat_schedule["connection_health_check"] = {
    "task": _HEALTH_CHECK_TASK_NAME,
    "schedule": timedelta(minutes=5),
    "args": [],
}

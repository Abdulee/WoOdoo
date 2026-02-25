"""Business logic layer for Job CRUD operations"""

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.jobs.schemas import JobCreate, JobUpdate
from backend.models.orm import SyncJob, SyncExecution, ExecutionStatusEnum


async def create_job(db: AsyncSession, job_data: JobCreate) -> SyncJob:
    """Create a new sync job."""
    job = SyncJob(
        name=job_data.name,
        direction=job_data.direction,
        connection_id=job_data.connection_id,
        filters=[f.model_dump() for f in job_data.filters],
        field_mappings=[fm.model_dump() for fm in job_data.field_mappings],
        schedule_config=job_data.schedule_config.model_dump() if job_data.schedule_config else None,
        lifecycle_config=job_data.lifecycle_config.model_dump() if job_data.lifecycle_config else None,
        is_enabled=job_data.is_enabled,
    )
    db.add(job)
    await db.commit()
    await db.refresh(job)
    return job


async def get_job(db: AsyncSession, job_id: int) -> SyncJob | None:
    """Get a single sync job by ID."""
    result = await db.execute(select(SyncJob).where(SyncJob.id == job_id))
    return result.scalars().first()


async def list_jobs(db: AsyncSession) -> tuple[list[SyncJob], int]:
    """List all sync jobs with total count."""
    result = await db.execute(select(SyncJob).order_by(SyncJob.id))
    jobs = list(result.scalars().all())

    count_result = await db.execute(select(func.count(SyncJob.id)))
    total = count_result.scalar() or 0

    return jobs, total


async def update_job(db: AsyncSession, job_id: int, job_data: JobUpdate) -> SyncJob | None:
    """Update a sync job (partial update, only non-None fields)."""
    job = await get_job(db, job_id)
    if job is None:
        return None

    if job_data.name is not None:
        job.name = job_data.name
    if job_data.direction is not None:
        job.direction = job_data.direction
    if job_data.connection_id is not None:
        job.connection_id = job_data.connection_id
    if job_data.filters is not None:
        job.filters = [f.model_dump() for f in job_data.filters]
    if job_data.field_mappings is not None:
        job.field_mappings = [fm.model_dump() for fm in job_data.field_mappings]
    if job_data.schedule_config is not None:
        job.schedule_config = job_data.schedule_config.model_dump()
    if job_data.lifecycle_config is not None:
        job.lifecycle_config = job_data.lifecycle_config.model_dump()
    if job_data.is_enabled is not None:
        job.is_enabled = job_data.is_enabled

    await db.commit()
    await db.refresh(job)
    return job


async def soft_delete_job(db: AsyncSession, job_id: int) -> SyncJob | None:
    """Soft delete a sync job by setting is_enabled=False."""
    job = await get_job(db, job_id)
    if job is None:
        return None

    job.is_enabled = False
    await db.commit()
    await db.refresh(job)
    return job


async def trigger_execution(db: AsyncSession, job_id: int) -> SyncExecution:
    """Create a pending SyncExecution row for a job."""
    execution = SyncExecution(
        job_id=job_id,
        status=ExecutionStatusEnum.RUNNING,  # ORM default is RUNNING; task says "pending" but enum has no PENDING
    )
    db.add(execution)
    await db.commit()
    await db.refresh(execution)
    return execution


async def list_executions(db: AsyncSession, job_id: int) -> list[SyncExecution]:
    """List all executions for a given job."""
    result = await db.execute(
        select(SyncExecution)
        .where(SyncExecution.job_id == job_id)
        .order_by(SyncExecution.started_at.desc())
    )
    return list(result.scalars().all())

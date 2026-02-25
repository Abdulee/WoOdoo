"""FastAPI router for Job CRUD + execution endpoints"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.dependencies import get_current_user
from backend.jobs.schemas import (
    JobCreate,
    JobListResponse,
    JobResponse,
    JobUpdate,
)
from backend.jobs.service import (
    create_job,
    get_job,
    list_jobs,
    list_executions,
    soft_delete_job,
    trigger_execution,
    update_job,
)
from backend.models.database import get_db

router = APIRouter(prefix="/jobs", tags=["jobs"])


@router.post("", status_code=status.HTTP_201_CREATED, response_model=JobResponse)
async def create_job_endpoint(
    payload: JobCreate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Create a new sync job."""
    job = await create_job(db, payload)
    return JobResponse.model_validate(job)


@router.get("", response_model=JobListResponse)
async def list_jobs_endpoint(
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List all sync jobs with total count."""
    jobs, total = await list_jobs(db)
    return JobListResponse(
        jobs=[JobResponse.model_validate(j) for j in jobs],
        total=total,
    )


@router.get("/{job_id}", response_model=JobResponse)
async def get_job_endpoint(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Get a single sync job by ID."""
    job = await get_job(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobResponse.model_validate(job)


@router.put("/{job_id}", response_model=JobResponse)
async def update_job_endpoint(
    job_id: int,
    payload: JobUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Partial update a sync job (only non-None fields)."""
    job = await update_job(db, job_id, payload)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobResponse.model_validate(job)


@router.delete("/{job_id}", status_code=status.HTTP_200_OK)
async def delete_job_endpoint(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Soft delete a sync job (sets is_enabled=False)."""
    job = await soft_delete_job(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")
    return JobResponse.model_validate(job)


@router.post("/{job_id}/run")
async def run_job_endpoint(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Trigger manual execution of a sync job (creates pending SyncExecution row)."""
    job = await get_job(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    execution = await trigger_execution(db, job_id)
    return {
        "execution_id": execution.id,
        "job_id": job_id,
        "status": execution.status,
    }


@router.get("/{job_id}/executions")
async def list_executions_endpoint(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List past executions for a sync job."""
    job = await get_job(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    executions = await list_executions(db, job_id)
    return [
        {
            "id": e.id,
            "status": e.status,
            "started_at": e.started_at.isoformat() if e.started_at else None,
            "completed_at": e.completed_at.isoformat() if e.completed_at else None,
        }
        for e in executions
    ]


@router.get("/{job_id}/preview")
async def preview_job_endpoint(
    job_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Preview sync job results (stub — real implementation is T20)."""
    job = await get_job(db, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    return {
        "total": 0,
        "products": [],
        "message": "Preview requires active Odoo connection",
    }

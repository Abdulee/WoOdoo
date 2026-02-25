"""Matching API endpoints for WoOdoo.

Provides routes for:
- triggering auto-match by SKU
- polling Celery task status
- listing unmatched products
- manual link / unlink
- listing SKU conflicts
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.dependencies import get_current_user
from backend.matching.auto_match import auto_match_products
from backend.models.database import get_db
from backend.models.orm import ProductMapping
from backend.tasks.celery_app import celery_app

matching_router = APIRouter(prefix="/matching", tags=["matching"])


# ---------------------------------------------------------------------------
# Request / response schemas
# ---------------------------------------------------------------------------


class AutoMatchRequest(BaseModel):
    connection_id: int


class AutoMatchResponse(BaseModel):
    task_id: str
    status: str


class TaskStatusResponse(BaseModel):
    task_id: str
    status: str
    result: dict | None = None


class ManualLinkRequest(BaseModel):
    odoo_product_id: int
    wc_product_id: int


class UnmatchedResponse(BaseModel):
    items: list = []
    total: int = 0
    source: str


class ConflictsResponse(BaseModel):
    conflicts: list = []


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@matching_router.post("/auto", response_model=AutoMatchResponse)
async def trigger_auto_match(
    body: AutoMatchRequest,
    current_user: dict = Depends(get_current_user),
):
    """Dispatch auto-match Celery task for a given connection."""
    result = auto_match_products.delay(body.connection_id)
    return AutoMatchResponse(task_id=result.id, status="started")


@matching_router.get("/status/{task_id}", response_model=TaskStatusResponse)
async def get_task_status(
    task_id: str,
    current_user: dict = Depends(get_current_user),
):
    """Poll a Celery task for its current status / result."""
    async_result = celery_app.AsyncResult(task_id)
    resp = TaskStatusResponse(
        task_id=task_id,
        status=async_result.status,
        result=async_result.result if async_result.ready() else None,
    )
    return resp


@matching_router.get("/unmatched", response_model=UnmatchedResponse)
async def list_unmatched(
    source: str = "odoo",
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List products from *source* that are not yet mapped.

    TODO: implement actual DB query once Odoo/WC product caches exist.
    Currently returns an empty list as a placeholder.
    """
    if source not in ("odoo", "wc"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="source must be 'odoo' or 'wc'",
        )
    # TODO: query Odoo/WC product IDs NOT in product_mappings
    return UnmatchedResponse(items=[], total=0, source=source)


@matching_router.post("/link", status_code=status.HTTP_201_CREATED)
async def manual_link(
    body: ManualLinkRequest,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Manually link an Odoo product to a WooCommerce product."""
    # Check for existing mapping (odoo_template_id + woo_product_id uniqueness)
    stmt = select(ProductMapping).where(
        ProductMapping.odoo_template_id == body.odoo_product_id,
        ProductMapping.woo_product_id == body.wc_product_id,
    )
    result = await db.execute(stmt)
    existing = result.scalars().first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Mapping already exists",
        )

    mapping = ProductMapping(
        odoo_template_id=body.odoo_product_id,
        woo_product_id=body.wc_product_id,
        match_method="manual",
    )
    db.add(mapping)
    await db.commit()
    await db.refresh(mapping)

    return {
        "id": mapping.id,
        "odoo_template_id": mapping.odoo_template_id,
        "woo_product_id": mapping.woo_product_id,
        "match_method": mapping.match_method,
        "sync_status": mapping.sync_status,
        "created_at": mapping.created_at.isoformat() if mapping.created_at else None,
    }


@matching_router.delete("/link/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT)
async def manual_unlink(
    mapping_id: int,
    current_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove a product mapping (hard delete)."""
    stmt = select(ProductMapping).where(ProductMapping.id == mapping_id)
    result = await db.execute(stmt)
    mapping = result.scalars().first()
    if mapping is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Mapping {mapping_id} not found",
        )
    await db.delete(mapping)
    await db.commit()
    return None


@matching_router.get("/conflicts", response_model=ConflictsResponse)
async def list_conflicts(
    current_user: dict = Depends(get_current_user),
):
    """Return SKU conflicts detected during last auto-match run.

    Conflicts are returned as part of the auto_match task result
    (stored in Celery/Redis).  This endpoint returns a static empty
    list — a future iteration will persist conflicts to the DB or
    read from the latest task result.
    """
    return ConflictsResponse(conflicts=[])

"""Mapping table CRUD service layer for WoOdoo sync platform.

Provides async functions for creating, querying, and updating mapping rows
(ProductMapping, CategoryMapping, AttributeMapping) and sync execution
checkpoints. All functions accept an AsyncSession as the first argument.

This module is purely a DB CRUD layer — no external API calls.
"""

from __future__ import annotations

from typing import Union

from sqlalchemy import select, func as sa_func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.models.orm import (
    AttributeMapping,
    CategoryMapping,
    ProductMapping,
    SyncExecution,
    SyncLog,
)

# ---------------------------------------------------------------------------
# Type aliases
# ---------------------------------------------------------------------------
AnyMapping = Union[ProductMapping, CategoryMapping, AttributeMapping]

# ---------------------------------------------------------------------------
# Dispatch tables
# ---------------------------------------------------------------------------
MODEL_MAP: dict[str, type] = {
    "product": ProductMapping,
    "category": CategoryMapping,
    "attribute": AttributeMapping,
}

# Column that stores the Odoo-side ID for each mapping type
ODOO_ID_COLUMN: dict[str, str] = {
    "product": "odoo_template_id",
    "category": "odoo_category_id",
    "attribute": "odoo_attribute_id",
}

# Column that stores the WooCommerce-side ID for each mapping type
WOO_ID_COLUMN: dict[str, str] = {
    "product": "woo_product_id",
    "category": "woo_category_id",
    "attribute": "woo_attribute_id",
}


def _resolve_model(model: str) -> type:
    """Return the ORM class for *model*, or raise ValueError."""
    try:
        return MODEL_MAP[model]
    except KeyError:
        raise ValueError(
            f"Unknown model '{model}'. Choose from: {', '.join(MODEL_MAP)}"
        )


# ---------------------------------------------------------------------------
# CRUD functions
# ---------------------------------------------------------------------------


async def get_mapping_by_odoo_id(
    db: AsyncSession,
    model: str,
    odoo_id: int,
) -> AnyMapping | None:
    """Return the first mapping row whose Odoo ID column equals *odoo_id*."""
    cls = _resolve_model(model)
    col_name = ODOO_ID_COLUMN[model]
    stmt = select(cls).where(getattr(cls, col_name) == odoo_id)
    result = await db.execute(stmt)
    return result.scalars().first()


async def get_mapping_by_woo_id(
    db: AsyncSession,
    model: str,
    woo_id: int,
) -> AnyMapping | None:
    """Return the first mapping row whose WooCommerce ID column equals *woo_id*."""
    cls = _resolve_model(model)
    col_name = WOO_ID_COLUMN[model]
    stmt = select(cls).where(getattr(cls, col_name) == woo_id)
    result = await db.execute(stmt)
    return result.scalars().first()


async def create_mapping(
    db: AsyncSession,
    model: str,
    **kwargs,
) -> AnyMapping:
    """Insert a new mapping row and return it (flushed with id populated)."""
    cls = _resolve_model(model)
    instance = cls(**kwargs)
    db.add(instance)
    await db.flush()
    await db.refresh(instance)
    return instance


async def update_mapping(
    db: AsyncSession,
    model: str,
    mapping_id: int,
    **fields,
) -> AnyMapping:
    """Update an existing mapping row identified by *mapping_id*.

    Raises ``ValueError`` when the row is not found.
    """
    cls = _resolve_model(model)
    stmt = select(cls).where(cls.id == mapping_id)
    result = await db.execute(stmt)
    instance = result.scalars().first()
    if instance is None:
        raise ValueError(f"{cls.__name__} with id={mapping_id} not found")
    for key, value in fields.items():
        setattr(instance, key, value)
    await db.flush()
    await db.refresh(instance)
    return instance


async def search_or_create(
    db: AsyncSession,
    model: str,
    odoo_id: int | None = None,
    woo_id: int | None = None,
    extra_fields: dict | None = None,
) -> tuple[AnyMapping, bool]:
    """Find an existing mapping by Odoo or WooCommerce ID, or create one.

    Returns ``(mapping, created)`` where *created* is ``True`` when a new row
    was inserted and ``False`` when an existing row was returned.

    This function is **idempotent**: repeated calls with the same IDs never
    duplicate rows.
    """
    # Try to find existing
    if odoo_id is not None:
        existing = await get_mapping_by_odoo_id(db, model, odoo_id)
        if existing is not None:
            return existing, False

    if woo_id is not None:
        existing = await get_mapping_by_woo_id(db, model, woo_id)
        if existing is not None:
            return existing, False

    # Build kwargs for creation
    create_kwargs: dict = {}
    if odoo_id is not None:
        create_kwargs[ODOO_ID_COLUMN[model]] = odoo_id
    if woo_id is not None:
        create_kwargs[WOO_ID_COLUMN[model]] = woo_id
    if extra_fields:
        create_kwargs.update(extra_fields)

    mapping = await create_mapping(db, model, **create_kwargs)
    return mapping, True


async def get_mappings_by_job(
    db: AsyncSession,
    job_id: int,
    status_filter: str | None = None,
) -> list[ProductMapping]:
    """Return ProductMappings linked to *job_id* via SyncLog → SyncExecution.

    Since ``ProductMapping`` does not have a direct ``job_id`` column, this
    function joins through ``SyncLog`` (which has ``product_mapping_id``) and
    ``SyncExecution`` (which has ``job_id``) to locate the relevant mappings.

    An optional *status_filter* narrows results by ``sync_status``.
    """
    stmt = (
        select(ProductMapping)
        .join(SyncLog, SyncLog.product_mapping_id == ProductMapping.id)
        .join(SyncExecution, SyncExecution.id == SyncLog.execution_id)
        .where(SyncExecution.job_id == job_id)
    )
    if status_filter is not None:
        stmt = stmt.where(ProductMapping.sync_status == status_filter)
    # Deduplicate — a mapping may appear in multiple logs
    stmt = stmt.distinct()
    result = await db.execute(stmt)
    return list(result.scalars().all())


async def update_sync_checkpoint(
    db: AsyncSession,
    execution_id: int,
    last_processed_id: int,
) -> None:
    """Update the sync checkpoint on a SyncExecution row.

    Since ``SyncExecution`` has no dedicated ``last_processed_id`` column,
    this uses ``synced_count`` as a proxy to track progress.
    """
    stmt = select(SyncExecution).where(SyncExecution.id == execution_id)
    result = await db.execute(stmt)
    execution = result.scalars().first()
    if execution is None:
        raise ValueError(f"SyncExecution with id={execution_id} not found")
    execution.synced_count = last_processed_id
    await db.flush()

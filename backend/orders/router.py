"""FastAPI router for order sync endpoints."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from backend.auth.dependencies import get_current_user
from backend.models.database import get_db
from backend.models.orm import OrderMapping
from backend.orders.schemas import OrderSyncRequest, OrderSyncResult, OrderResponse
from backend.orders.sync import sync_order

orders_router = APIRouter(prefix="/orders", tags=["orders"])


@orders_router.post("/sync", response_model=OrderSyncResult)
async def sync_order_endpoint(
    payload: OrderSyncRequest,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> OrderSyncResult:
    """Sync a single WooCommerce order into Odoo as a draft sale order."""
    result = await sync_order(
        wc_order_id=payload.wc_order_id,
        connection_id=payload.connection_id,
        db=db,
    )
    await db.commit()
    return result


@orders_router.get("")
async def list_orders(
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """List synced order mappings with pagination."""
    offset = (page - 1) * page_size

    # Total count
    count_result = await db.execute(select(func.count(OrderMapping.id)))
    total = count_result.scalar() or 0

    # Paginated rows
    stmt = (
        select(OrderMapping)
        .order_by(OrderMapping.id.desc())
        .offset(offset)
        .limit(page_size)
    )
    result = await db.execute(stmt)
    mappings = result.scalars().all()

    items = [OrderResponse.model_validate(m) for m in mappings]
    return {"items": items, "total": total}


@orders_router.get("/{wc_order_id}", response_model=OrderResponse)
async def get_order(
    wc_order_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
) -> OrderResponse:
    """Get a specific order mapping by WooCommerce order ID."""
    result = await db.execute(
        select(OrderMapping).where(OrderMapping.woo_order_id == wc_order_id)
    )
    mapping = result.scalars().first()
    if mapping is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Order mapping for WC order {wc_order_id} not found",
        )
    return OrderResponse.model_validate(mapping)


@orders_router.delete("/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_order_mapping(
    mapping_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: dict = Depends(get_current_user),
):
    """Delete an order mapping (does not delete the Odoo order)."""
    result = await db.execute(
        select(OrderMapping).where(OrderMapping.id == mapping_id)
    )
    mapping = result.scalars().first()
    if mapping is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Order mapping {mapping_id} not found",
        )
    await db.delete(mapping)
    await db.commit()
    return None

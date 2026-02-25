"""Stock sync engine — sync stock levels from Odoo to WooCommerce.

Stock is Odoo → WC only. Odoo is the authoritative stock source.
Variant-level sync: each ProductMapping with odoo_product_id maps a specific variant.
Batch API used for efficiency.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.clients.odoo import OdooClient
from backend.clients.woocommerce import WooCommerceClient
from backend.models.orm import ProductMapping

logger = logging.getLogger(__name__)

BATCH_SIZE = 50  # WC batch max is 100; use 50 for safety


@dataclass
class SyncResult:
    """Accumulator for stock sync statistics."""

    synced: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)


async def sync_stock_odoo_to_wc(
    db: AsyncSession,
    odoo_client: OdooClient,
    wc_client: WooCommerceClient,
    *,
    warehouse_id: int = 1,
    template_ids: list[int] | None = None,
) -> SyncResult:
    """Sync stock levels from Odoo to WooCommerce.

    Algorithm:
    1. Load all ProductMappings that have both woo_product_id and odoo_product_id set
       (variant mappings). If template_ids is specified, filter by those.
    2. Collect all odoo_product_ids from the mappings.
    3. Batch fetch stock quantities from Odoo product.product.
    4. Group mappings by woo_product_id (for batch update per WC product).
    5. For each WC product:
       a. If any mapping has woo_variation_id → batch update variations.
       b. If single mapping with no woo_variation_id → update product directly.
    """
    result = SyncResult()

    # Step 1: Load mappings with variant data
    stmt = select(ProductMapping).where(
        ProductMapping.woo_product_id.isnot(None),
        ProductMapping.odoo_product_id.isnot(None),
    )
    if template_ids:
        stmt = stmt.where(ProductMapping.odoo_template_id.in_(template_ids))
    pm_result = await db.execute(stmt)
    mappings = list(pm_result.scalars().all())

    if not mappings:
        return result

    # Step 2: Get all odoo_product_ids
    odoo_product_ids = [m.odoo_product_id for m in mappings if m.odoo_product_id]

    # Step 3: Batch fetch stock from Odoo (synchronous client)
    stock_data = odoo_client.search_read(
        "product.product",
        [("id", "in", odoo_product_ids)],
        ["id", "qty_available", "virtual_available"],
        limit=len(odoo_product_ids) + 10,
    )
    # Build odoo_product_id → qty_available dict (clamp negatives to 0)
    odoo_stock: dict[int, int] = {
        d["id"]: max(0, int(d.get("qty_available", 0) or 0))
        for d in stock_data
    }

    # Step 4: Group by woo_product_id
    by_woo_product: dict[int, list[ProductMapping]] = {}
    for mapping in mappings:
        pid = mapping.woo_product_id
        if pid not in by_woo_product:
            by_woo_product[pid] = []
        by_woo_product[pid].append(mapping)

    # Step 5: Update WC in batches
    for woo_product_id, product_mappings in by_woo_product.items():
        try:
            # Check if variable (has variation IDs) or simple product
            has_variations = any(
                m.woo_variation_id is not None for m in product_mappings
            )

            if has_variations:
                # Build batch update payload
                update_items: list[dict[str, Any]] = []
                for m in product_mappings:
                    if m.woo_variation_id is None:
                        continue
                    qty = odoo_stock.get(m.odoo_product_id, 0)
                    update_items.append({
                        "id": m.woo_variation_id,
                        "stock_quantity": qty,
                        "manage_stock": True,
                        "stock_status": "instock" if qty > 0 else "outofstock",
                    })

                # Send in batches of BATCH_SIZE
                for i in range(0, len(update_items), BATCH_SIZE):
                    batch = update_items[i : i + BATCH_SIZE]
                    await wc_client.batch_variations(
                        woo_product_id, update=batch
                    )
                    result.synced += len(batch)
            else:
                # Simple product — use single mapping
                m = product_mappings[0]
                qty = odoo_stock.get(m.odoo_product_id, 0)
                await wc_client.update_product(woo_product_id, {
                    "stock_quantity": qty,
                    "manage_stock": True,
                    "stock_status": "instock" if qty > 0 else "outofstock",
                })
                result.synced += 1
        except Exception as exc:
            msg = f"Error syncing stock for woo_product {woo_product_id}: {exc}"
            logger.error(msg)
            result.errors.append(msg)

    return result

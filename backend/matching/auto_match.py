"""Auto-match Odoo ↔ WooCommerce products by SKU.

Celery task + async implementation.  Matches Odoo ``default_code`` to
WooCommerce ``sku`` (case-insensitive, whitespace-stripped).
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.clients.odoo import OdooClient
from backend.clients.woocommerce import WooCommerceClient
from backend.core.crypto import decrypt_config
from backend.models.database import AsyncSessionLocal
from backend.models.orm import Connection, ProductMapping
from backend.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Celery task
# ---------------------------------------------------------------------------


@celery_app.task(
    bind=True,
    name="backend.matching.auto_match.auto_match_products",
    max_retries=2,
    default_retry_delay=30,
)
def auto_match_products(self, connection_id: int) -> dict:
    """Synchronous Celery task — delegates to async impl via asyncio.run()."""
    try:
        return asyncio.run(_run_auto_match(connection_id))
    except Exception as exc:
        logger.error("auto_match_products failed for connection %s: %s", connection_id, exc)
        raise self.retry(exc=exc)


# ---------------------------------------------------------------------------
# Async implementation
# ---------------------------------------------------------------------------


async def _run_auto_match(connection_id: int) -> dict:
    """Core auto-match logic.

    1. Load connection, decrypt credentials.
    2. Fetch Odoo products (with default_code) and all WC products.
    3. Build normalised SKU lookup dicts.
    4. Detect conflicts (duplicate SKUs).
    5. Create ProductMapping rows for matched SKUs (skip existing).
    6. Return summary stats.
    """
    async with AsyncSessionLocal() as db:
        # 1 — load connection
        conn = await _load_connection(db, connection_id)
        config = decrypt_config(conn.config_encrypted)

        # 2 — fetch products from both platforms
        odoo_products = _fetch_odoo_products(config)
        wc_products = await _fetch_wc_products(config)

        # 3 — build lookup dicts (normalised SKU → list of products)
        odoo_by_sku: dict[str, list[dict]] = defaultdict(list)
        for p in odoo_products:
            sku = (p.get("default_code") or "").strip().lower()
            if sku:
                odoo_by_sku[sku].append(p)

        wc_by_sku: dict[str, list[dict]] = defaultdict(list)
        for p in wc_products:
            sku = (p.get("sku") or "").strip().lower()
            if sku:
                wc_by_sku[sku].append(p)

        # 4 — detect conflicts
        conflicts: list[dict[str, Any]] = []
        all_skus = set(odoo_by_sku.keys()) | set(wc_by_sku.keys())
        matchable_skus: set[str] = set()

        for sku in all_skus:
            odoo_list = odoo_by_sku.get(sku, [])
            wc_list = wc_by_sku.get(sku, [])
            if len(odoo_list) > 1 or len(wc_list) > 1:
                conflicts.append({
                    "sku": sku,
                    "odoo_ids": [p["id"] for p in odoo_list],
                    "wc_ids": [p["id"] for p in wc_list],
                })
            elif len(odoo_list) == 1 and len(wc_list) == 1:
                matchable_skus.add(sku)

        # 5 — create mappings for clean 1:1 matches
        matched = 0
        for sku in matchable_skus:
            odoo_prod = odoo_by_sku[sku][0]
            wc_prod = wc_by_sku[sku][0]

            tmpl_id_raw = odoo_prod.get("product_tmpl_id")
            if isinstance(tmpl_id_raw, (list, tuple)):
                odoo_tmpl_id = tmpl_id_raw[0]
            else:
                odoo_tmpl_id = int(tmpl_id_raw) if tmpl_id_raw else odoo_prod["id"]

            wc_id = wc_prod["id"]

            # Skip if mapping already exists (idempotent)
            exists = await _mapping_exists(db, odoo_tmpl_id, wc_id)
            if exists:
                continue

            mapping = ProductMapping(
                odoo_template_id=odoo_tmpl_id,
                woo_product_id=wc_id,
                match_method="auto_sku",
            )
            db.add(mapping)
            matched += 1

        await db.commit()

        # 6 — compute unmatched counts
        matched_odoo_skus = matchable_skus
        matched_wc_skus = matchable_skus
        unmatched_odoo = len([
            s for s in odoo_by_sku
            if s not in matched_odoo_skus and s not in {c["sku"] for c in conflicts}
        ])
        unmatched_wc = len([
            s for s in wc_by_sku
            if s not in matched_wc_skus and s not in {c["sku"] for c in conflicts}
        ])

        return {
            "matched": matched,
            "unmatched_odoo": unmatched_odoo,
            "unmatched_wc": unmatched_wc,
            "conflicts": conflicts,
        }


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _load_connection(db: AsyncSession, connection_id: int) -> Connection:
    """Load a Connection row or raise."""
    stmt = select(Connection).where(Connection.id == connection_id)
    result = await db.execute(stmt)
    conn = result.scalars().first()
    if conn is None:
        raise ValueError(f"Connection {connection_id} not found")
    return conn


def _fetch_odoo_products(config: dict) -> list[dict]:
    """Fetch Odoo products that have a default_code set (synchronous)."""
    client = OdooClient(
        url=config["url"],
        db=config["db"],
        username=config["username"],
        api_key=config["api_key"],
    )
    client.authenticate()
    return client.search_read(
        "product.product",
        [("default_code", "!=", False)],
        fields=["id", "default_code", "display_name", "product_tmpl_id"],
        limit=10000,
    )


async def _fetch_wc_products(config: dict) -> list[dict]:
    """Fetch all WC products (async, paginated)."""
    async with WooCommerceClient(
        store_url=config["store_url"],
        consumer_key=config["consumer_key"],
        consumer_secret=config["consumer_secret"],
    ) as client:
        products: list[dict] = []
        async for page_data in client._paginate("products", {"per_page": 100}):
            products.extend(page_data)
        return products


async def _mapping_exists(db: AsyncSession, odoo_template_id: int, woo_product_id: int) -> bool:
    """Check if a mapping already exists for this odoo_template_id + woo_product_id pair."""
    stmt = select(ProductMapping).where(
        ProductMapping.odoo_template_id == odoo_template_id,
        ProductMapping.woo_product_id == woo_product_id,
    )
    result = await db.execute(stmt)
    return result.scalars().first() is not None

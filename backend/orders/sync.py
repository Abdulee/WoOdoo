"""Core order sync logic — WooCommerce order → Odoo draft sale.order."""

from __future__ import annotations

import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.clients.odoo import OdooClient
from backend.clients.woocommerce import WooCommerceClient
from backend.core.crypto import decrypt_config
from backend.models.orm import Connection, OrderMapping, ProductMapping, Settings
from backend.orders.schemas import OrderSyncResult

logger = logging.getLogger(__name__)


async def sync_order(
    wc_order_id: int,
    connection_id: int,
    db: AsyncSession,
) -> OrderSyncResult:
    """Sync a single WooCommerce order into Odoo as a draft sale order.

    Steps:
        1. Load connection, decrypt credentials.
        2. Fetch WC order.
        3. Check idempotency (order_mappings).
        4. Build Odoo sale.order dict with line items.
        5. Create in Odoo, record mapping.
    """
    try:
        # ------------------------------------------------------------------
        # 1. Load connection + decrypt
        # ------------------------------------------------------------------
        result = await db.execute(
            select(Connection).where(Connection.id == connection_id)
        )
        connection = result.scalars().first()
        if connection is None:
            return OrderSyncResult(
                wc_order_id=wc_order_id,
                status="failed",
                error=f"Connection {connection_id} not found",
            )

        config = decrypt_config(connection.config_encrypted)

        # ------------------------------------------------------------------
        # 2. Build clients
        # ------------------------------------------------------------------
        wc_client = WooCommerceClient(
            store_url=config["url"],
            consumer_key=config["consumer_key"],
            consumer_secret=config["consumer_secret"],
        )

        odoo_client = OdooClient(
            url=config.get("odoo_url", config.get("url", "")),
            db=config.get("database", ""),
            username=config.get("username", ""),
            api_key=config.get("api_key", ""),
        )

        # ------------------------------------------------------------------
        # 3. Fetch WC order
        # ------------------------------------------------------------------
        try:
            wc_order = await wc_client.get_order(wc_order_id)
            wc_order_data: dict[str, Any] = wc_order.model_dump()
        finally:
            await wc_client.close()

        # ------------------------------------------------------------------
        # 4. Idempotency check
        # ------------------------------------------------------------------
        existing = await db.execute(
            select(OrderMapping).where(
                OrderMapping.woo_order_id == wc_order_id
            )
        )
        existing_mapping = existing.scalars().first()
        if existing_mapping is not None and existing_mapping.sync_status == "synced":
            return OrderSyncResult(
                wc_order_id=wc_order_id,
                odoo_order_id=existing_mapping.odoo_order_id,
                status="synced",
            )

        # ------------------------------------------------------------------
        # 5. Resolve generic customer ID from settings
        # ------------------------------------------------------------------
        settings_result = await db.execute(
            select(Settings).where(Settings.key == "generic_odoo_customer_id")
        )
        settings_row = settings_result.scalars().first()
        generic_customer_id = 1
        if settings_row is not None:
            val = settings_row.value
            if isinstance(val, dict):
                generic_customer_id = int(val.get("value", 1))
            elif isinstance(val, (int, float)):
                generic_customer_id = int(val)

        # ------------------------------------------------------------------
        # 6. Build order lines
        # ------------------------------------------------------------------
        order_lines: list[tuple] = []
        for item in wc_order_data.get("line_items", []):
            wc_product_id = item.get("product_id")
            line_vals: dict[str, Any] = {
                "product_uom_qty": item.get("quantity", 1),
                "price_unit": float(item.get("subtotal", item.get("total", "0")))
                / max(item.get("quantity", 1), 1),
            }

            # Lookup product mapping
            if wc_product_id:
                pm_result = await db.execute(
                    select(ProductMapping).where(
                        ProductMapping.woo_product_id == wc_product_id
                    )
                )
                pm = pm_result.scalars().first()
                if pm is not None and pm.odoo_product_id:
                    line_vals["product_id"] = pm.odoo_product_id
                else:
                    line_vals["product_id"] = False
                    line_vals["name"] = item.get("name", "Unknown product")
            else:
                line_vals["product_id"] = False
                line_vals["name"] = item.get("name", "Unknown product")

            order_lines.append((0, 0, line_vals))

        # ------------------------------------------------------------------
        # 7. Create Odoo sale.order
        # ------------------------------------------------------------------
        order_origin = f"WC-{wc_order_data.get('number', wc_order_id)}"
        sale_order_vals = {
            "partner_id": generic_customer_id,
            "origin": order_origin,
            "state": "draft",
            "order_line": order_lines,
        }

        odoo_order_id: int = odoo_client.create_sale_order(sale_order_vals)

        # ------------------------------------------------------------------
        # 8. Record mapping
        # ------------------------------------------------------------------
        if existing_mapping is not None:
            existing_mapping.odoo_order_id = odoo_order_id
            existing_mapping.sync_status = "synced"
        else:
            mapping = OrderMapping(
                woo_order_id=wc_order_id,
                odoo_order_id=odoo_order_id,
                sync_status="synced",
            )
            db.add(mapping)

        await db.flush()

        return OrderSyncResult(
            wc_order_id=wc_order_id,
            odoo_order_id=odoo_order_id,
            status="synced",
        )

    except Exception as exc:
        logger.exception("Order sync failed for WC order %d", wc_order_id)
        return OrderSyncResult(
            wc_order_id=wc_order_id,
            status="failed",
            error=str(exc),
        )

"""Product sync engine — Odoo → WooCommerce product synchronization.

Handles simple products (1 variant) and variable products (2+ variants)
using field-level hashing for delta detection to avoid unnecessary API calls.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.clients.odoo import OdooClient
from backend.clients.woocommerce import WooCommerceClient
from backend.models.orm import ProductMapping
from backend.sync.hashing import compute_product_hashes, diff_hashes
from backend.sync.mappings import (
    get_mapping_by_odoo_id,
    search_or_create,
    update_mapping,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Result container
# ---------------------------------------------------------------------------


@dataclass
class SyncResult:
    """Accumulator for product sync statistics."""

    created: int = 0
    updated: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Default field mapping
# ---------------------------------------------------------------------------

DEFAULT_FIELD_MAPPINGS: list[dict] = [
    {"odoo_field": "name", "wc_field": "name", "direction": "odoo_to_wc"},
    {"odoo_field": "list_price", "wc_field": "regular_price", "direction": "odoo_to_wc"},
    {"odoo_field": "default_code", "wc_field": "sku", "direction": "odoo_to_wc"},
    {"odoo_field": "description", "wc_field": "description", "direction": "odoo_to_wc"},
]


# ---------------------------------------------------------------------------
# Field mapping engine
# ---------------------------------------------------------------------------


def _build_wc_payload(
    odoo_data: dict,
    field_mappings: list[dict],
) -> dict:
    """Build a WC product payload dict from Odoo data via field mappings.

    Only applies entries where direction == "odoo_to_wc".
    Prices are formatted as strings.
    """
    payload: dict = {}
    for fm in field_mappings:
        if fm.get("direction") != "odoo_to_wc":
            continue
        odoo_field = fm["odoo_field"]
        wc_field = fm["wc_field"]
        value = odoo_data.get(odoo_field)

        # Format prices as strings
        if wc_field in ("regular_price", "sale_price", "price"):
            value = str(value) if value is not None else "0"

        if value is not None:
            payload[wc_field] = value

    return payload


def _template_to_data_dict(template) -> dict:
    """Convert an OdooProductTemplate to a plain dict for hashing/mapping."""
    return {
        "name": template.name,
        "list_price": template.list_price,
        "default_code": template.default_code,
        "description": template.description,
        "barcode": template.barcode,
        "weight": template.weight,
    }


def _odoo_fields_from_mappings(field_mappings: list[dict]) -> list[str]:
    """Extract the list of Odoo field names from field mappings."""
    return [
        fm["odoo_field"]
        for fm in field_mappings
        if fm.get("direction") == "odoo_to_wc"
    ]


# ---------------------------------------------------------------------------
# Variant mapping lookup
# ---------------------------------------------------------------------------


async def _get_variant_mapping(
    db: AsyncSession,
    template_id: int,
    variant_id: int,
) -> ProductMapping | None:
    """Find a ProductMapping by odoo_template_id AND odoo_product_id."""
    stmt = select(ProductMapping).where(
        ProductMapping.odoo_template_id == template_id,
        ProductMapping.odoo_product_id == variant_id,
    )
    result = await db.execute(stmt)
    return result.scalars().first()


# ---------------------------------------------------------------------------
# Main sync function
# ---------------------------------------------------------------------------


async def sync_products(
    db: AsyncSession,
    odoo_client: OdooClient,
    wc_client: WooCommerceClient,
    field_mappings: list[dict] | None = None,
    template_ids: list[int] | None = None,
) -> SyncResult:
    """Sync products from Odoo to WooCommerce.

    Handles both simple products (1 variant) and variable products (2+ variants)
    with field-level hashing for delta detection.

    Args:
        db: Async database session.
        odoo_client: Synchronous Odoo XML-RPC client.
        wc_client: Async WooCommerce REST client.
        field_mappings: Custom field mappings. Uses defaults if None/empty.
        template_ids: Optional filter — only sync these template IDs.

    Returns:
        SyncResult with created/updated/skipped counts and errors.
    """
    result = SyncResult()

    # Resolve field mappings
    mappings = field_mappings if field_mappings else DEFAULT_FIELD_MAPPINGS
    odoo_fields = _odoo_fields_from_mappings(mappings)

    # Fetch Odoo templates (SYNCHRONOUS — no await)
    templates = odoo_client.get_product_templates()

    # Filter by template_ids if specified
    if template_ids is not None:
        templates = [t for t in templates if t.id in template_ids]

    if not templates:
        return result

    for template in templates:
        try:
            data_dict = _template_to_data_dict(template)
            wc_payload = _build_wc_payload(data_dict, mappings)

            if template.product_variant_count >= 2:
                await _sync_variable_product(
                    db, odoo_client, wc_client, template, data_dict,
                    wc_payload, odoo_fields, result,
                )
            else:
                await _sync_simple_product(
                    db, wc_client, template, data_dict,
                    wc_payload, odoo_fields, result,
                )
        except Exception as exc:
            msg = f"template {template.id}: {str(exc)}"
            logger.error("Error syncing product %s: %s", template.id, exc)
            result.errors.append(msg)

    return result


# ---------------------------------------------------------------------------
# Simple product sync
# ---------------------------------------------------------------------------


async def _sync_simple_product(
    db: AsyncSession,
    wc_client: WooCommerceClient,
    template,
    data_dict: dict,
    wc_payload: dict,
    odoo_fields: list[str],
    result: SyncResult,
) -> None:
    """Sync a simple product (template with 1 variant)."""
    mapping = await get_mapping_by_odoo_id(db, "product", template.id)

    if mapping is None:
        # Create new WC product
        wc_product = await wc_client.create_product({"type": "simple", **wc_payload})

        # Create mapping
        new_hashes = compute_product_hashes(data_dict, odoo_fields)
        await search_or_create(
            db, "product",
            odoo_id=template.id,
            woo_id=wc_product.id,
            extra_fields={
                "woo_product_id": wc_product.id,
                "sync_status": "synced",
                "sync_origin": "woodoo",
                "field_hashes": new_hashes,
                "last_synced_at": datetime.now(timezone.utc),
            },
        )
        result.created += 1
    else:
        # Check for changes via hashing
        current_hashes = compute_product_hashes(data_dict, odoo_fields)
        stored_hashes = mapping.field_hashes or {}
        changed_fields = diff_hashes(current_hashes, stored_hashes)

        if not changed_fields:
            result.skipped += 1
            return

        # Update WC product
        await wc_client.update_product(mapping.woo_product_id, wc_payload)

        # Update mapping with anti-ping-pong
        await update_mapping(
            db, "product", mapping.id,
            sync_origin="woodoo",
            sync_status="synced",
            last_synced_at=datetime.now(timezone.utc),
            field_hashes=current_hashes,
        )
        result.updated += 1


# ---------------------------------------------------------------------------
# Variable product sync
# ---------------------------------------------------------------------------


async def _sync_variable_product(
    db: AsyncSession,
    odoo_client: OdooClient,
    wc_client: WooCommerceClient,
    template,
    data_dict: dict,
    wc_payload: dict,
    odoo_fields: list[str],
    result: SyncResult,
) -> None:
    """Sync a variable product (template with 2+ variants)."""
    # Step 1: Create/update WC parent product as type=variable
    mapping = await get_mapping_by_odoo_id(db, "product", template.id)

    if mapping is None:
        # Create variable product on WC
        wc_product = await wc_client.create_product({"type": "variable", **wc_payload})
        woo_product_id = wc_product.id

        # Create template-level mapping
        new_hashes = compute_product_hashes(data_dict, odoo_fields)
        await search_or_create(
            db, "product",
            odoo_id=template.id,
            woo_id=woo_product_id,
            extra_fields={
                "woo_product_id": woo_product_id,
                "sync_status": "synced",
                "sync_origin": "woodoo",
                "field_hashes": new_hashes,
                "last_synced_at": datetime.now(timezone.utc),
            },
        )
        result.created += 1
    else:
        woo_product_id = mapping.woo_product_id

        # Check for template-level changes
        current_hashes = compute_product_hashes(data_dict, odoo_fields)
        stored_hashes = mapping.field_hashes or {}
        changed_fields = diff_hashes(current_hashes, stored_hashes)

        if changed_fields:
            await wc_client.update_product(woo_product_id, wc_payload)
            await update_mapping(
                db, "product", mapping.id,
                sync_origin="woodoo",
                sync_status="synced",
                last_synced_at=datetime.now(timezone.utc),
                field_hashes=current_hashes,
            )
            result.updated += 1
        else:
            result.skipped += 1

    # Step 2: Sync each variant
    variants = odoo_client.get_product_variants(template.id)

    for variant in variants:
        variant_payload = {
            "sku": variant.default_code,
            "regular_price": str(variant.lst_price),
        }

        variant_data = {
            "default_code": variant.default_code,
            "lst_price": variant.lst_price,
        }
        variant_fields = ["default_code", "lst_price"]

        var_mapping = await _get_variant_mapping(db, template.id, variant.id)

        if var_mapping is None:
            # Create variation on WC
            wc_variation = await wc_client.create_variation(
                woo_product_id, variant_payload,
            )

            # Create variant-level mapping
            var_hashes = compute_product_hashes(variant_data, variant_fields)
            from backend.sync.mappings import create_mapping
            await create_mapping(
                db, "product",
                odoo_template_id=template.id,
                odoo_product_id=variant.id,
                woo_product_id=woo_product_id,
                woo_variation_id=wc_variation.id,
                sync_status="synced",
                sync_origin="woodoo",
                field_hashes=var_hashes,
                last_synced_at=datetime.now(timezone.utc),
            )
            result.created += 1
        else:
            # Check for variant-level changes
            var_current = compute_product_hashes(variant_data, variant_fields)
            var_stored = var_mapping.field_hashes or {}
            var_changed = diff_hashes(var_current, var_stored)

            if not var_changed:
                result.skipped += 1
                continue

            await wc_client.update_variation(
                woo_product_id, var_mapping.woo_variation_id, variant_payload,
            )
            await update_mapping(
                db, "product", var_mapping.id,
                sync_origin="woodoo",
                sync_status="synced",
                last_synced_at=datetime.now(timezone.utc),
                field_hashes=var_current,
            )
            result.updated += 1

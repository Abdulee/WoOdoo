"""Category sync engine — bidirectional category sync between Odoo and WooCommerce.

Handles topological sorting (parents before children) and idempotent
create/update via the mapping CRUD layer.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from backend.clients.odoo import OdooClient
from backend.clients.woocommerce import WooCommerceClient
from backend.sync.mappings import (
    get_mapping_by_odoo_id,
    get_mapping_by_woo_id,
    search_or_create,
    update_mapping,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Result container
# ---------------------------------------------------------------------------


@dataclass
class SyncResult:
    """Accumulator for sync statistics."""

    created: int = 0
    updated: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Topological sort helper
# ---------------------------------------------------------------------------


def _topological_sort(
    categories: list[dict[str, Any]],
    parent_key: str = "parent_id",
    *,
    odoo_style: bool = True,
) -> list[dict[str, Any]]:
    """Sort *categories* so that parents always appear before their children.

    Parameters
    ----------
    categories:
        List of category dicts.  Each must have ``"id"`` and a parent field.
    parent_key:
        Key that stores the parent reference (``"parent_id"`` for Odoo,
        ``"parent"`` for WC).
    odoo_style:
        If ``True``, the parent value is either ``False`` (root) or
        ``[parent_id, display_name]``.  If ``False``, the parent value is
        an ``int`` where ``0`` means root.

    Returns
    -------
    list[dict]
        Topologically sorted list (parents first).
    """
    if not categories:
        return []

    def _extract_parent_id(cat: dict[str, Any]) -> int | None:
        raw = cat.get(parent_key)
        if odoo_style:
            if raw is False or raw is None:
                return None
            # Odoo returns [id, display_name]
            if isinstance(raw, (list, tuple)) and len(raw) >= 1:
                return int(raw[0])
            return None
        else:
            # WC style: int, 0 = root
            if isinstance(raw, int) and raw != 0:
                return raw
            return None

    by_id: dict[int, dict[str, Any]] = {c["id"]: c for c in categories}
    sorted_result: list[dict[str, Any]] = []
    processed_ids: set[int] = set()

    # Iterative: keep adding categories whose parent is already processed
    remaining = list(categories)
    max_iterations = len(categories) + 1  # safety valve
    iteration = 0
    while remaining and iteration < max_iterations:
        iteration += 1
        progress = False
        next_remaining: list[dict[str, Any]] = []
        for cat in remaining:
            pid = _extract_parent_id(cat)
            # Root (no parent) or parent already processed or parent not in our set
            if pid is None or pid in processed_ids or pid not in by_id:
                sorted_result.append(cat)
                processed_ids.add(cat["id"])
                progress = True
            else:
                next_remaining.append(cat)
        remaining = next_remaining
        if not progress:
            # Cycle detected — dump remaining as-is
            sorted_result.extend(remaining)
            break

    return sorted_result


# ---------------------------------------------------------------------------
# Odoo → WooCommerce
# ---------------------------------------------------------------------------


async def sync_categories_odoo_to_wc(
    db: AsyncSession,
    odoo_client: OdooClient,
    wc_client: WooCommerceClient,
) -> SyncResult:
    """Sync all categories from Odoo to WooCommerce.

    Algorithm:
    1. Fetch all Odoo categories
    2. Topologically sort (parents before children)
    3. For each category:
       a. Check category_mappings for existing mapping
       b. If exists and name unchanged → skip
       c. If exists and name changed → update WC
       d. If not exists → create on WC, then create mapping
    """
    result = SyncResult()

    # 1 — Fetch Odoo categories (OdooClient is synchronous)
    odoo_cats = odoo_client.get_categories()

    # Convert Pydantic models to dicts for topological sort
    cat_dicts = [{"id": c.id, "name": c.name, "parent_id": c.parent_id} for c in odoo_cats]

    # 2 — Topological sort
    sorted_cats = _topological_sort(cat_dicts, parent_key="parent_id", odoo_style=True)

    # Track odoo_id → woo_id for parent resolution
    odoo_to_woo: dict[int, int] = {}

    # Pre-populate from existing mappings
    for cat in sorted_cats:
        existing = await get_mapping_by_odoo_id(db, "category", cat["id"])
        if existing and existing.woo_category_id is not None:
            odoo_to_woo[cat["id"]] = existing.woo_category_id

    # 3 — Process each category
    for cat in sorted_cats:
        odoo_id = cat["id"]
        name = cat["name"]
        raw_parent = cat.get("parent_id")

        # Resolve Odoo parent_id to int or None
        odoo_parent_id: int | None = None
        if raw_parent and isinstance(raw_parent, (list, tuple)) and len(raw_parent) >= 1:
            odoo_parent_id = int(raw_parent[0])

        # Determine WC parent id
        wc_parent_id = 0
        if odoo_parent_id is not None and odoo_parent_id in odoo_to_woo:
            wc_parent_id = odoo_to_woo[odoo_parent_id]

        try:
            mapping = await get_mapping_by_odoo_id(db, "category", odoo_id)

            if mapping is not None and mapping.woo_category_id is not None:
                # Already mapped — check if name changed
                if mapping.name != name:
                    await wc_client.update_category(
                        mapping.woo_category_id,
                        {"name": name, "parent": wc_parent_id},
                    )
                    await update_mapping(
                        db, "category", mapping.id, name=name
                    )
                    result.updated += 1
                else:
                    result.skipped += 1
                # Ensure lookup table is populated
                odoo_to_woo[odoo_id] = mapping.woo_category_id
            else:
                # Create on WC
                wc_cat = await wc_client.create_category(
                    {"name": name, "parent": wc_parent_id}
                )
                wc_cat_id = wc_cat.id

                # Create or update mapping
                mapping_obj, created = await search_or_create(
                    db,
                    "category",
                    odoo_id=odoo_id,
                    woo_id=wc_cat_id,
                    extra_fields={"name": name},
                )
                if not created and mapping_obj.woo_category_id is None:
                    await update_mapping(
                        db, "category", mapping_obj.id,
                        woo_category_id=wc_cat_id, name=name,
                    )

                odoo_to_woo[odoo_id] = wc_cat_id
                result.created += 1
        except Exception as exc:
            msg = f"Error syncing Odoo category {odoo_id} ({name}): {exc}"
            logger.error(msg)
            result.errors.append(msg)

    return result


# ---------------------------------------------------------------------------
# WooCommerce → Odoo
# ---------------------------------------------------------------------------


async def sync_categories_wc_to_odoo(
    db: AsyncSession,
    wc_client: WooCommerceClient,
    odoo_client: OdooClient,
) -> SyncResult:
    """Sync all categories from WooCommerce to Odoo.

    Algorithm:
    1. Fetch all WC categories
    2. Topologically sort (parents before children)
    3. For each category:
       a. Check category_mappings for existing mapping
       b. If exists → skip (already mapped)
       c. If not exists → create on Odoo, then create mapping
    """
    result = SyncResult()

    # 1 — Fetch WC categories
    wc_cats = await wc_client.get_categories()

    # Convert to dicts for topological sort
    cat_dicts = [
        {"id": c.id, "name": c.name, "parent": c.parent}
        for c in wc_cats
    ]

    # 2 — Topological sort
    sorted_cats = _topological_sort(cat_dicts, parent_key="parent", odoo_style=False)

    # Track woo_id → odoo_id for parent resolution
    woo_to_odoo: dict[int, int] = {}

    # Pre-populate from existing mappings
    for cat in sorted_cats:
        existing = await get_mapping_by_woo_id(db, "category", cat["id"])
        if existing and existing.odoo_category_id is not None:
            woo_to_odoo[cat["id"]] = existing.odoo_category_id

    # 3 — Process each category
    for cat in sorted_cats:
        wc_id = cat["id"]
        name = cat["name"]
        wc_parent = cat.get("parent", 0)

        # Resolve WC parent to Odoo parent
        odoo_parent_id: int | bool = False
        if isinstance(wc_parent, int) and wc_parent != 0 and wc_parent in woo_to_odoo:
            odoo_parent_id = woo_to_odoo[wc_parent]

        try:
            mapping = await get_mapping_by_woo_id(db, "category", wc_id)

            if mapping is not None:
                # Already mapped — skip
                woo_to_odoo[wc_id] = mapping.odoo_category_id
                result.skipped += 1
            else:
                # Create on Odoo (OdooClient is synchronous)
                new_odoo_id = odoo_client.create(
                    "product.category",
                    {"name": name, "parent_id": odoo_parent_id},
                )

                # Create mapping
                await search_or_create(
                    db,
                    "category",
                    odoo_id=new_odoo_id,
                    woo_id=wc_id,
                    extra_fields={"name": name},
                )

                woo_to_odoo[wc_id] = new_odoo_id
                result.created += 1
        except Exception as exc:
            msg = f"Error syncing WC category {wc_id} ({name}): {exc}"
            logger.error(msg)
            result.errors.append(msg)

    return result

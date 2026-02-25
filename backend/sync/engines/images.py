"""Image sync engine — sync product images from Odoo to WordPress/WooCommerce.

Flow per product:
  1. Fetch product.template image data from Odoo (base64 field 'image_1920')
  2. Decode base64 → bytes via decode_odoo_image()
  3. Compute SHA256 hash via compute_image_hash()
  4. Check image_mappings table — if hash already exists for this product_mapping_id → SKIP (dedup)
  5. Upload bytes to WordPress Media Library via WordPressClient.upload_image()
  6. If old wp_media_id exists and hash changed → delete_media(old_wp_media_id) (cleanup)
  7. Create/update ImageMapping row with new wp_media_id, woo_image_url, odoo_image_hash
  8. Return SyncResult
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from backend.celery_app import celery_app
from backend.clients.odoo import OdooClient
from backend.clients.wordpress import (
    WordPressClient,
    compute_image_hash,
    decode_odoo_image,
    detect_mime_type,
)
from backend.models.orm import ImageMapping, ProductMapping

logger = logging.getLogger(__name__)


@dataclass
class SyncResult:
    """Accumulator for image sync statistics."""

    created: int = 0
    updated: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)


async def sync_product_images(
    db: AsyncSession,
    product_mapping_id: int,
    odoo_client: OdooClient,
    wp_client: WordPressClient,
    *,
    position: int = 0,
) -> SyncResult:
    """Sync images for a single product mapping.

    Algorithm:
    1. Load ProductMapping from DB to get odoo_template_id
    2. Fetch image_1920 from Odoo via odoo_client.read()
    3. If no image (False/None/empty) → return early with skipped=1
    4. Decode base64 → bytes; compute hash
    5. Load existing ImageMapping for this product_mapping_id + position
    6. If existing mapping has same hash → skip (dedup)
    7. Detect MIME type; build filename
    8. Upload to WordPress → get WPMediaItem
    9. If old wp_media_id exists and different → delete old media (cleanup)
    10. Create or update ImageMapping row
    """
    result = SyncResult()

    # Load ProductMapping
    stmt = select(ProductMapping).where(ProductMapping.id == product_mapping_id)
    pm_result = await db.execute(stmt)
    product_mapping = pm_result.scalars().first()
    if product_mapping is None:
        result.errors.append(f"ProductMapping {product_mapping_id} not found")
        return result

    try:
        # Fetch image from Odoo (synchronous call — no await)
        image_data = odoo_client.read(
            "product.template", [product_mapping.odoo_template_id], ["image_1920"]
        )
        if not image_data or not image_data[0].get("image_1920"):
            result.skipped += 1
            return result

        base64_str = image_data[0]["image_1920"]
        image_bytes = decode_odoo_image(base64_str)
        image_hash = compute_image_hash(image_bytes)

        # Load existing ImageMapping for this position
        stmt2 = select(ImageMapping).where(
            ImageMapping.product_mapping_id == product_mapping_id,
            ImageMapping.woo_image_position == position,
        )
        im_result = await db.execute(stmt2)
        existing = im_result.scalars().first()

        # Hash dedup check
        if existing is not None and existing.odoo_image_hash == image_hash:
            result.skipped += 1
            return result

        # Upload to WordPress
        mime_type = detect_mime_type(image_bytes)
        ext = mime_type.split("/")[-1] if "/" in mime_type else "jpg"
        filename = f"product_{product_mapping.odoo_template_id}_{position}.{ext}"

        media = await wp_client.upload_image(filename, image_bytes, mime_type)

        # Cleanup old media if hash changed and old media exists
        if existing is not None and existing.wp_media_id is not None:
            try:
                await wp_client.delete_media(existing.wp_media_id)
            except Exception as del_exc:
                logger.warning(
                    "Failed to delete old media %d: %s",
                    existing.wp_media_id,
                    del_exc,
                )

        now = datetime.now(timezone.utc)
        if existing is not None:
            # Update existing mapping
            existing.odoo_image_hash = image_hash
            existing.wp_media_id = media.id
            existing.woo_image_url = media.source_url
            existing.last_synced_at = now
            await db.flush()
            result.updated += 1
        else:
            # Create new mapping
            new_mapping = ImageMapping(
                product_mapping_id=product_mapping_id,
                odoo_image_hash=image_hash,
                wp_media_id=media.id,
                woo_image_url=media.source_url,
                woo_image_position=position,
                last_synced_at=now,
            )
            db.add(new_mapping)
            await db.flush()
            result.created += 1

        await db.commit()
    except Exception as exc:
        msg = f"Error syncing images for product_mapping {product_mapping_id}: {exc}"
        logger.error(msg)
        result.errors.append(msg)

    return result


@celery_app.task(
    name="sync.sync_product_images",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
    queue="image_sync",
)
def sync_product_images_task(
    self, product_mapping_id: int, wp_config: dict, odoo_config: dict
) -> dict:
    """Celery task that syncs images for a single product.

    wp_config: dict with keys: wp_url, username, application_password
    odoo_config: dict with keys: url, db, username, api_key
    """
    import asyncio

    from backend.clients.odoo import OdooClient as _OdooClient
    from backend.clients.wordpress import WordPressClient as _WordPressClient
    from backend.models.database import AsyncSessionLocal

    async def _run() -> dict:
        odoo_client = _OdooClient(**odoo_config)
        async with _WordPressClient(**wp_config) as wp_client:
            async with AsyncSessionLocal() as db:
                res = await sync_product_images(
                    db, product_mapping_id, odoo_client, wp_client
                )
                return {
                    "created": res.created,
                    "updated": res.updated,
                    "skipped": res.skipped,
                    "errors": res.errors,
                }

    try:
        return asyncio.run(_run())
    except Exception as exc:
        raise self.retry(exc=exc)

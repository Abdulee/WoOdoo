"""Webhook processors — debounce + anti-ping-pong + Celery dispatch."""

from __future__ import annotations

import logging

import redis.asyncio as redis

from backend.core.config import settings

logger = logging.getLogger(__name__)

DEBOUNCE_TTL_SECONDS = 5

SUPPORTED_WC_TOPICS = {
    "product.updated",
    "product.created",
    "product.deleted",
    "order.created",
    "order.updated",
}


async def _get_redis() -> redis.Redis | None:
    """Get a Redis client."""
    try:
        client = redis.from_url(settings.redis_url, decode_responses=True)
        await client.ping()
        return client
    except Exception as e:
        logger.warning("Redis not available for webhook processor: %s", e)
        return None


async def process_wc_webhook(topic: str, payload: dict) -> None:
    """Process an incoming WooCommerce webhook.

    1. Check topic is supported.
    2. Extract resource_id from payload.
    3. Anti-ping-pong: skip if sync origin is woodoo.
    4. Debounce: skip if duplicate within 5s.
    5. Dispatch to Celery.
    """
    if topic not in SUPPORTED_WC_TOPICS:
        logger.info("Unsupported WC webhook topic '%s', ignoring.", topic)
        return

    # Extract resource id — WC sends 'id' at top level for product/order events
    resource_id = payload.get("id")
    if resource_id is None:
        logger.warning("WC webhook payload missing 'id' field, skipping.")
        return

    resource_type = topic.split(".")[0]  # 'product' or 'order'

    client = await _get_redis()
    if client is not None:
        try:
            # Anti-ping-pong: if this change originated from woodoo, skip
            origin_key = f"webhook:sync_origin:wc:{resource_type}:{resource_id}"
            origin = await client.get(origin_key)
            if origin == "woodoo":
                logger.info(
                    "Skipping WC webhook for %s %s — originated from WoOdoo sync.",
                    resource_type, resource_id,
                )
                # Clear the origin marker
                await client.delete(origin_key)
                return

            # Debounce: skip if already queued within TTL
            debounce_key = f"webhook:debounce:wc:{resource_type}:{resource_id}"
            already_queued = await client.set(
                debounce_key, "1", ex=DEBOUNCE_TTL_SECONDS, nx=True,
            )
            if not already_queued:
                logger.info(
                    "Debounced WC webhook for %s %s (within %ds window).",
                    resource_type, resource_id, DEBOUNCE_TTL_SECONDS,
                )
                return
        finally:
            await client.aclose()

    # Dispatch to Celery
    _dispatch_sync(source="wc", resource_type=resource_type, resource_id=resource_id)


async def process_odoo_webhook(model: str, record_id: int, action: str) -> None:
    """Process an incoming Odoo webhook.

    1. Anti-ping-pong: skip if sync origin is woodoo.
    2. Debounce: skip if duplicate within 5s.
    3. Dispatch to Celery for supported model/action combos.
    """
    supported_actions = {"write", "create"}
    supported_models = {"product.template"}

    if model not in supported_models or action not in supported_actions:
        logger.info(
            "Odoo webhook for model=%s action=%s not actionable, ignoring.",
            model, action,
        )
        return

    client = await _get_redis()
    if client is not None:
        try:
            # Anti-ping-pong
            origin_key = f"webhook:sync_origin:odoo:{model}:{record_id}"
            origin = await client.get(origin_key)
            if origin == "woodoo":
                logger.info(
                    "Skipping Odoo webhook for %s %s — originated from WoOdoo sync.",
                    model, record_id,
                )
                await client.delete(origin_key)
                return

            # Debounce
            debounce_key = f"webhook:debounce:odoo:{model}:{record_id}"
            already_queued = await client.set(
                debounce_key, "1", ex=DEBOUNCE_TTL_SECONDS, nx=True,
            )
            if not already_queued:
                logger.info(
                    "Debounced Odoo webhook for %s %s (within %ds window).",
                    model, record_id, DEBOUNCE_TTL_SECONDS,
                )
                return
        finally:
            await client.aclose()

    # Dispatch to Celery
    _dispatch_sync(source="odoo", resource_type=model, resource_id=record_id)


def _dispatch_sync(source: str, resource_type: str, resource_id: int | str) -> None:
    """Dispatch a sync task to Celery.

    Uses send_task to avoid importing the actual task module at webhook time.
    """
    try:
        from backend.tasks.celery_app import celery_app

        celery_app.send_task(
            "backend.tasks.orchestrator.execute_sync_job",
            kwargs={
                "execution_id": -1,  # Placeholder — real impl will create execution
            },
            queue="default",
        )
        logger.info(
            "Dispatched sync task for %s %s:%s",
            source, resource_type, resource_id,
        )
    except Exception as e:
        logger.error("Failed to dispatch Celery task: %s", e)

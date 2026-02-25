"""Webhook router — endpoints for WooCommerce and Odoo incoming webhooks."""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from backend.core.config import settings
from backend.webhooks.health import update_last_received, get_health
from backend.webhooks.processor import process_wc_webhook, process_odoo_webhook

logger = logging.getLogger(__name__)

webhooks_router = APIRouter(tags=["webhooks"])


@webhooks_router.post("/webhooks/woocommerce")
async def wc_webhook(request: Request):
    """Receive a WooCommerce webhook.

    Validates HMAC-SHA256 signature from ``X-WC-Webhook-Signature`` header,
    then dispatches processing asynchronously.
    """
    body = await request.body()

    # --- Signature validation ---
    sig_header = request.headers.get("X-WC-Webhook-Signature")
    if not sig_header:
        return JSONResponse(status_code=401, content={"error": "invalid signature"})

    secret = settings.wc_webhook_secret
    expected_sig = base64.b64encode(
        hmac.new(secret.encode(), body, hashlib.sha256).digest()
    ).decode()

    if not hmac.compare_digest(sig_header, expected_sig):
        return JSONResponse(status_code=401, content={"error": "invalid signature"})

    # --- Parse payload ---
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "invalid JSON body"})

    topic = request.headers.get("X-WC-Webhook-Topic", "")
    if not topic:
        topic = payload.get("topic", "")

    # --- Process ---
    await process_wc_webhook(topic, payload)

    # --- Track health ---
    await update_last_received("wc")

    return {"status": "accepted"}


@webhooks_router.post("/webhooks/odoo")
async def odoo_webhook(request: Request):
    """Receive an Odoo webhook.

    Validates ``X-Odoo-Secret`` header against configured secret.
    """
    secret_header = request.headers.get("X-Odoo-Secret")
    if not secret_header or secret_header != settings.odoo_webhook_secret:
        return JSONResponse(status_code=401, content={"error": "invalid signature"})

    # --- Parse payload ---
    try:
        payload = await request.json()
    except Exception:
        return JSONResponse(status_code=400, content={"error": "invalid JSON body"})

    model = payload.get("model", "")
    record_id = payload.get("record_id", 0)
    action = payload.get("action", "")

    # --- Process ---
    await process_odoo_webhook(model, record_id, action)

    # --- Track health ---
    await update_last_received("odoo")

    return {"status": "accepted"}


@webhooks_router.get("/webhooks/health")
async def webhooks_health():
    """Return webhook health status — last received timestamps and healthy flags."""
    return await get_health()

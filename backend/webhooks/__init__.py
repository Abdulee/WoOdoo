"""Webhook receivers for WooCommerce and Odoo incoming webhooks."""

from backend.webhooks.router import webhooks_router

__all__ = ["webhooks_router"]

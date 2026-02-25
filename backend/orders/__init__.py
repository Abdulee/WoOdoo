"""Order sync module — syncs WooCommerce orders into Odoo as draft sale orders."""

from backend.orders.router import orders_router

__all__ = ["orders_router"]

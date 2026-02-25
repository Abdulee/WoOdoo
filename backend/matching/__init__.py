"""Product matching module for WoOdoo.

Provides auto-matching (by SKU) and manual linking of Odoo products
to WooCommerce products.
"""

from backend.matching.router import matching_router

__all__ = ["matching_router"]

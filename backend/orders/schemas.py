"""Pydantic schemas for WooCommerce → Odoo order sync."""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class OrderLineItemIn(BaseModel):
    product_id: int | None = None  # WC product id
    variation_id: int | None = None
    name: str
    quantity: int
    price: str  # unit price as string


class OrderSyncRequest(BaseModel):
    wc_order_id: int
    connection_id: int


class OrderSyncResult(BaseModel):
    wc_order_id: int
    odoo_order_id: int | None = None
    status: str  # "synced" | "failed"
    error: str | None = None


class OrderResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    woo_order_id: int
    odoo_order_id: int | None
    sync_status: str
    created_at: datetime

"""Connection configuration and test result models"""
from pydantic import BaseModel, ConfigDict
from typing import Optional, Dict, Any
from datetime import datetime


class OdooConnectionConfig(BaseModel):
    url: str
    database: str
    username: str
    api_key: str


class WooCommerceConnectionConfig(BaseModel):
    url: str
    consumer_key: str
    consumer_secret: str
    version: str = "wc/v3"


class ConnectionCreate(BaseModel):
    platform: str  # "odoo" or "woocommerce"
    name: str
    config: Dict[str, Any]  # OdooConnectionConfig or WooCommerceConnectionConfig as dict


class ConnectionUpdate(BaseModel):
    name: Optional[str] = None
    config: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None


class ConnectionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    platform: str
    name: str
    is_active: bool
    last_tested_at: Optional[datetime] = None
    created_at: datetime


class ConnectionTestResult(BaseModel):
    success: bool
    message: str
    details: Optional[Dict[str, Any]] = None
    currency: Optional[str] = None  # For currency mismatch detection

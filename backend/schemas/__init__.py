"""WoOdoo shared Pydantic schema contracts"""
from backend.schemas.odoo import (
    OdooCategory, OdooAttribute, OdooAttributeValue, OdooAttributeLine,
    OdooProductProduct, OdooProductTemplate, OdooPartner,
    OdooSaleOrder, OdooSaleOrderLine,
)
from backend.schemas.woocommerce import (
    WCImage, WCAttribute, WCAttributeValue, WCCategory,
    WCProductAttribute, WCVariation, WCProduct,
    WCOrderLineItem, WCOrder, WCBatchRequest, WCBatchResponse,
)
from backend.schemas.connections import (
    OdooConnectionConfig, WooCommerceConnectionConfig,
    ConnectionCreate, ConnectionUpdate, ConnectionResponse, ConnectionTestResult,
)
from backend.schemas.sync import (
    FieldMapping, FilterConfig, ScheduleConfig, LifecycleConfig,
    SyncJobCreate, SyncJobUpdate, SyncJobResponse,
    SyncExecutionResponse, SyncLogResponse, ProductDiffField, ProductDiff,
)
from backend.schemas.websocket import SyncProgressEvent, LogEntry, ConnectionHealthEvent

__all__ = [
    "OdooCategory", "OdooAttribute", "OdooAttributeValue", "OdooAttributeLine",
    "OdooProductProduct", "OdooProductTemplate", "OdooPartner",
    "OdooSaleOrder", "OdooSaleOrderLine",
    "WCImage", "WCAttribute", "WCAttributeValue", "WCCategory",
    "WCProductAttribute", "WCVariation", "WCProduct",
    "WCOrderLineItem", "WCOrder", "WCBatchRequest", "WCBatchResponse",
    "OdooConnectionConfig", "WooCommerceConnectionConfig",
    "ConnectionCreate", "ConnectionUpdate", "ConnectionResponse", "ConnectionTestResult",
    "FieldMapping", "FilterConfig", "ScheduleConfig", "LifecycleConfig",
    "SyncJobCreate", "SyncJobUpdate", "SyncJobResponse",
    "SyncExecutionResponse", "SyncLogResponse", "ProductDiffField", "ProductDiff",
    "SyncProgressEvent", "LogEntry", "ConnectionHealthEvent",
]

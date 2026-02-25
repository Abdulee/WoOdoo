"""Sync job, execution, and logging models"""
from pydantic import BaseModel, ConfigDict
from typing import Optional, List, Dict, Any
from datetime import datetime


class FieldMapping(BaseModel):
    field_name: str
    direction: str  # "odoo_to_wc", "wc_to_odoo", "bidirectional", "skip"
    odoo_field: str
    wc_field: str
    transform: Optional[str] = None  # optional transform function name


class FilterConfig(BaseModel):
    category_ids: List[int] = []
    tag_ids: List[int] = []
    only_active: bool = True
    price_min: Optional[float] = None
    price_max: Optional[float] = None
    custom_domain: Optional[List[Any]] = None  # Odoo domain filter
    wc_status: Optional[str] = None  # "publish", "draft", "any"


class ScheduleConfig(BaseModel):
    trigger: str = "manual"  # "manual", "interval", "cron"
    interval_minutes: Optional[int] = None  # for interval trigger
    cron_expression: Optional[str] = None  # for cron trigger
    enabled: bool = False


class LifecycleConfig(BaseModel):
    on_odoo_create: str = "create_in_wc"  # "create_in_wc", "skip", "flag"
    on_odoo_delete: str = "archive_in_wc"  # "archive_in_wc", "delete_in_wc", "flag", "skip"
    on_wc_create: str = "flag"  # "create_in_odoo", "skip", "flag"
    on_wc_delete: str = "flag"  # "archive_in_odoo", "delete_in_odoo", "flag", "skip"


class SyncJobCreate(BaseModel):
    name: str
    direction: str  # "odoo_to_wc", "wc_to_odoo", "bidirectional"
    filters: FilterConfig = FilterConfig()
    field_mappings: List[FieldMapping] = []
    schedule_config: ScheduleConfig = ScheduleConfig()
    lifecycle_config: LifecycleConfig = LifecycleConfig()
    is_enabled: bool = True
    connection_id: Optional[int] = None


class SyncJobUpdate(BaseModel):
    name: Optional[str] = None
    direction: Optional[str] = None
    filters: Optional[FilterConfig] = None
    field_mappings: Optional[List[FieldMapping]] = None
    schedule_config: Optional[ScheduleConfig] = None
    lifecycle_config: Optional[LifecycleConfig] = None
    is_enabled: Optional[bool] = None


class SyncJobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    name: str
    direction: str
    filters: Optional[Dict[str, Any]] = None
    field_mappings: Optional[List[Any]] = None
    schedule_config: Optional[Dict[str, Any]] = None
    lifecycle_config: Optional[Dict[str, Any]] = None
    is_enabled: bool
    connection_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime


class SyncExecutionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    job_id: int
    status: str
    started_at: datetime
    completed_at: Optional[datetime] = None
    total_products: int
    synced_count: int
    error_count: int
    skipped_count: int


class SyncLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    execution_id: int
    product_mapping_id: Optional[int] = None
    level: str
    message: str
    details: Optional[Dict[str, Any]] = None
    created_at: datetime


class ProductDiffField(BaseModel):
    field: str
    odoo_value: Any
    wc_value: Any
    is_different: bool
    sync_direction: str


class ProductDiff(BaseModel):
    odoo_template_id: Optional[int] = None
    woo_product_id: Optional[int] = None
    fields: List[ProductDiffField] = []
    sync_status: str
    last_synced_at: Optional[datetime] = None

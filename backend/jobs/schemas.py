"""Pydantic schemas for Job CRUD operations"""

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict


class FilterRule(BaseModel):
    field: str
    operator: str  # '=', '!=', 'in', 'not in', '>', '<', 'like', 'ilike'
    value: Any


class FieldMappingRule(BaseModel):
    odoo_field: str
    wc_field: str
    direction: Literal["odoo_to_wc", "wc_to_odoo", "both", "skip"]
    enabled: bool = True


class ScheduleConfig(BaseModel):
    type: Literal["cron", "interval"]
    cron_expression: Optional[str] = None  # e.g. "0 */6 * * *"
    interval_seconds: Optional[int] = None  # e.g. 3600


class LifecycleConfig(BaseModel):
    on_new_source: Literal["create", "flag"] = "create"
    on_deleted_source: Literal["archive", "delete", "flag", "ignore"] = "ignore"


class JobCreate(BaseModel):
    name: str
    direction: Literal["odoo_to_wc", "wc_to_odoo", "bidirectional"]
    connection_id: Optional[int] = None
    filters: list[FilterRule] = []
    field_mappings: list[FieldMappingRule] = []
    schedule_config: Optional[ScheduleConfig] = None
    lifecycle_config: Optional[LifecycleConfig] = None
    is_enabled: bool = True


class JobUpdate(BaseModel):
    name: Optional[str] = None
    direction: Optional[Literal["odoo_to_wc", "wc_to_odoo", "bidirectional"]] = None
    connection_id: Optional[int] = None
    filters: Optional[list[FilterRule]] = None
    field_mappings: Optional[list[FieldMappingRule]] = None
    schedule_config: Optional[ScheduleConfig] = None
    lifecycle_config: Optional[LifecycleConfig] = None
    is_enabled: Optional[bool] = None


class JobResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    direction: str
    connection_id: Optional[int]
    filters: list
    field_mappings: list
    schedule_config: Optional[dict]
    lifecycle_config: Optional[dict]
    is_enabled: bool
    created_at: datetime
    updated_at: datetime


class JobListResponse(BaseModel):
    jobs: list[JobResponse]
    total: int

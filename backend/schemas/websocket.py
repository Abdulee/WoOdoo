"""WebSocket event models for real-time sync progress and logging"""
from pydantic import BaseModel
from typing import Optional, Dict, Any
from datetime import datetime


class SyncProgressEvent(BaseModel):
    event_type: str  # "progress", "log", "completed", "error", "health"
    execution_id: Optional[int] = None
    job_id: Optional[int] = None
    total: Optional[int] = None
    current: Optional[int] = None
    synced: Optional[int] = None
    errors: Optional[int] = None
    skipped: Optional[int] = None
    percentage: Optional[float] = None
    message: Optional[str] = None
    timestamp: str = ""


class LogEntry(BaseModel):
    level: str  # "info", "warning", "error"
    message: str
    product_id: Optional[int] = None
    details: Optional[Dict[str, Any]] = None
    timestamp: str = ""


class ConnectionHealthEvent(BaseModel):
    event_type: str = "health"
    platform: str
    status: str  # "connected", "disconnected", "degraded"
    message: Optional[str] = None
    timestamp: str = ""

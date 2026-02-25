"""SQLAlchemy 2.0 ORM models for WoOdoo sync platform"""

from datetime import datetime
from enum import Enum as PyEnum
from typing import List, Optional

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Boolean,
    func,
)
from sqlalchemy import JSON
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.models.database import Base


# ============================================================================
# ENUMS
# ============================================================================


class PlatformEnum(str, PyEnum):
    """Supported platforms"""
    ODOO = "odoo"
    WOOCOMMERCE = "woocommerce"


class ConnectionStatusEnum(str, PyEnum):
    """Connection status states"""
    ACTIVE = "active"
    INACTIVE = "inactive"
    DEGRADED = "degraded"


class SyncDirectionEnum(str, PyEnum):
    """Sync job directions"""
    ODOO_TO_WC = "odoo_to_wc"
    WC_TO_ODOO = "wc_to_odoo"
    BIDIRECTIONAL = "bidirectional"


class SyncOriginEnum(str, PyEnum):
    """Where a sync originated from"""
    ODOO = "odoo"
    WOOCOMMERCE = "woocommerce"
    WOODOO = "woodoo"


class SyncStatusEnum(str, PyEnum):
    """Product mapping sync status"""
    SYNCED = "synced"
    PENDING = "pending"
    FAILED = "failed"
    REVIEW = "review"
    FAILED_PERMANENT = "failed_permanent"
    DISMISSED = "dismissed"


class ExecutionStatusEnum(str, PyEnum):
    """Sync job execution status"""
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


class LogLevelEnum(str, PyEnum):
    """Log message severity levels"""
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"


class OrderSyncStatusEnum(str, PyEnum):
    """Order sync status"""
    SYNCED = "synced"
    PENDING = "pending"
    FAILED = "failed"


# ============================================================================
# MODELS
# ============================================================================


class Connection(Base):
    """Represents a connection to Odoo or WooCommerce"""
    __tablename__ = "connections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    platform: Mapped[str] = mapped_column(
        Enum(PlatformEnum, native_enum=False), nullable=False
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    config_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(
        Enum(ConnectionStatusEnum, native_enum=False),
        default=ConnectionStatusEnum.ACTIVE,
        nullable=False,
    )
    last_tested_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    sync_jobs: Mapped[List["SyncJob"]] = relationship("SyncJob", back_populates="connection")

    def __repr__(self) -> str:
        return f"<Connection(id={self.id}, platform={self.platform}, name={self.name})>"


class SyncJob(Base):
    """Defines a sync job between Odoo and WooCommerce"""
    __tablename__ = "sync_jobs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    direction: Mapped[str] = mapped_column(
        Enum(SyncDirectionEnum, native_enum=False), nullable=False
    )
    filters: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    field_mappings: Mapped[list] = mapped_column(JSON, default=list, nullable=False)
    schedule_config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    lifecycle_config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    is_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    connection_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("connections.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    # Relationships
    connection: Mapped[Optional["Connection"]] = relationship("Connection", back_populates="sync_jobs")
    executions: Mapped[List["SyncExecution"]] = relationship("SyncExecution", back_populates="job")

    def __repr__(self) -> str:
        return f"<SyncJob(id={self.id}, name={self.name}, direction={self.direction})>"


class ProductMapping(Base):
    """Maps Odoo products to WooCommerce products"""
    __tablename__ = "product_mappings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    odoo_template_id: Mapped[int] = mapped_column(Integer, nullable=False)
    odoo_product_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    woo_product_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    woo_variation_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    field_hashes: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    sync_origin: Mapped[str] = mapped_column(
        Enum(SyncOriginEnum, native_enum=False),
        default=SyncOriginEnum.WOODOO,
        nullable=False,
    )
    sync_status: Mapped[str] = mapped_column(
        Enum(SyncStatusEnum, native_enum=False),
        default=SyncStatusEnum.PENDING,
        nullable=False,
    )
    match_method: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    # Relationships
    images: Mapped[List["ImageMapping"]] = relationship("ImageMapping", back_populates="product_mapping")
    logs: Mapped[List["SyncLog"]] = relationship("SyncLog", back_populates="product_mapping")

    __table_args__ = (
        Index("ix_product_mappings_odoo_template_id", "odoo_template_id"),
        Index("ix_product_mappings_woo_product_id", "woo_product_id"),
    )

    def __repr__(self) -> str:
        return f"<ProductMapping(id={self.id}, odoo_template_id={self.odoo_template_id}, woo_product_id={self.woo_product_id})>"


class CategoryMapping(Base):
    """Maps Odoo categories to WooCommerce categories"""
    __tablename__ = "category_mappings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    odoo_category_id: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    woo_category_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    def __repr__(self) -> str:
        return f"<CategoryMapping(id={self.id}, odoo_id={self.odoo_category_id}, woo_id={self.woo_category_id})>"


class AttributeMapping(Base):
    """Maps Odoo attributes to WooCommerce attributes"""
    __tablename__ = "attribute_mappings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    odoo_attribute_id: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    woo_attribute_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    name: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    def __repr__(self) -> str:
        return f"<AttributeMapping(id={self.id}, odoo_id={self.odoo_attribute_id}, woo_id={self.woo_attribute_id})>"


class ImageMapping(Base):
    """Maps product images between systems"""
    __tablename__ = "image_mappings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    product_mapping_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("product_mappings.id"), nullable=False
    )
    odoo_image_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    wp_media_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    woo_image_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    woo_image_position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Relationships
    product_mapping: Mapped["ProductMapping"] = relationship("ProductMapping", back_populates="images")

    def __repr__(self) -> str:
        return f"<ImageMapping(id={self.id}, product_mapping_id={self.product_mapping_id})>"


class SyncExecution(Base):
    """Record of a sync job execution"""
    __tablename__ = "sync_executions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    job_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("sync_jobs.id"), nullable=False
    )
    status: Mapped[str] = mapped_column(
        Enum(ExecutionStatusEnum, native_enum=False),
        default=ExecutionStatusEnum.RUNNING,
        nullable=False,
    )
    started_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    total_products: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    synced_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    skipped_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # Relationships
    job: Mapped["SyncJob"] = relationship("SyncJob", back_populates="executions")
    logs: Mapped[List["SyncLog"]] = relationship("SyncLog", back_populates="execution")

    __table_args__ = (
        Index("ix_sync_executions_job_started", "job_id", "started_at"),
    )

    def __repr__(self) -> str:
        return f"<SyncExecution(id={self.id}, job_id={self.job_id}, status={self.status})>"


class SyncLog(Base):
    """Detailed logs from sync execution"""
    __tablename__ = "sync_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    execution_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("sync_executions.id"), nullable=False
    )
    product_mapping_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("product_mappings.id"), nullable=True
    )
    status: Mapped[Optional[str]] = mapped_column(
        Enum(SyncStatusEnum, native_enum=False), nullable=True
    )
    level: Mapped[str] = mapped_column(
        Enum(LogLevelEnum, native_enum=False), nullable=False
    )
    message: Mapped[str] = mapped_column(Text, nullable=False)
    details: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    retry_count: Mapped[int] = mapped_column(Integer, default=0, server_default="0")

    # Relationships
    execution: Mapped["SyncExecution"] = relationship("SyncExecution", back_populates="logs")
    product_mapping: Mapped[Optional["ProductMapping"]] = relationship("ProductMapping", back_populates="logs")

    __table_args__ = (
        Index("ix_sync_logs_execution_created", "execution_id", "created_at"),
    )

    def __repr__(self) -> str:
        return f"<SyncLog(id={self.id}, execution_id={self.execution_id}, level={self.level})>"


class OrderMapping(Base):
    """Maps WooCommerce orders to Odoo orders"""
    __tablename__ = "order_mappings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    woo_order_id: Mapped[int] = mapped_column(Integer, nullable=False, unique=True)
    odoo_order_id: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sync_status: Mapped[str] = mapped_column(
        Enum(OrderSyncStatusEnum, native_enum=False),
        default=OrderSyncStatusEnum.PENDING,
        nullable=False,
    )
    last_synced_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<OrderMapping(id={self.id}, woo_order_id={self.woo_order_id}, odoo_order_id={self.odoo_order_id})>"


class Settings(Base):
    """Key-value settings for WoOdoo configuration"""
    __tablename__ = "settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    value: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return f"<Settings(key={self.key})>"

"""Odoo XML-RPC Client

Typed client for Odoo 18 XML-RPC API.
Authentication via API key (api_key used as password parameter).
"""
from __future__ import annotations

import time
import logging
import xmlrpc.client
from typing import Any, Optional

from backend.schemas.odoo import (
    OdooProductTemplate,
    OdooProductProduct,
    OdooCategory,
    OdooAttribute,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class OdooError(Exception):
    """Base exception for Odoo client errors."""


class OdooAuthError(OdooError):
    """Authentication failed — wrong credentials or insufficient permissions."""


class OdooNotFoundError(OdooError):
    """Record not found in Odoo."""


class OdooValidationError(OdooError):
    """Odoo returned a validation/server fault."""


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class OdooClient:
    """Synchronous Odoo XML-RPC client.

    Args:
        url: Odoo server URL (e.g. https://mycompany.odoo.com)
        db: Odoo database name
        username: Login username
        api_key: API key (used as password in XML-RPC calls)
        max_retries: Number of retry attempts on transient errors
        retry_delay: Base delay in seconds between retries (exponential backoff)
    """

    def __init__(
        self,
        url: str,
        db: str,
        username: str,
        api_key: str,
        max_retries: int = 3,
        retry_delay: float = 1.0,
    ) -> None:
        self.url = url.rstrip("/")
        self.db = db
        self.username = username
        self.api_key = api_key
        self.max_retries = max_retries
        self.retry_delay = retry_delay
        self.uid: Optional[int] = None

        # XML-RPC server proxies (lazy-evaluated to allow mocking in tests)
        self._common: Optional[xmlrpc.client.ServerProxy] = None
        self._models: Optional[xmlrpc.client.ServerProxy] = None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @property
    def common(self) -> xmlrpc.client.ServerProxy:
        if self._common is None:
            self._common = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/common")
        return self._common

    @property
    def models(self) -> xmlrpc.client.ServerProxy:
        if self._models is None:
            self._models = xmlrpc.client.ServerProxy(f"{self.url}/xmlrpc/2/object")
        return self._models

    def _with_retry(self, fn, *args, **kwargs) -> Any:
        """Call fn(*args, **kwargs) with exponential backoff retry on transient errors."""
        last_exc: Exception = RuntimeError("No attempts made")
        for attempt in range(self.max_retries):
            try:
                return fn(*args, **kwargs)
            except (ConnectionRefusedError, ConnectionResetError, OSError, TimeoutError) as exc:
                last_exc = exc
                wait = self.retry_delay * (2 ** attempt)
                logger.warning(
                    "Transient error on attempt %d/%d: %s — retrying in %.1fs",
                    attempt + 1,
                    self.max_retries,
                    exc,
                    wait,
                )
                time.sleep(wait)
            except xmlrpc.client.Fault as fault:
                # Fault code 2 = access denied
                if fault.faultCode == 2:
                    raise OdooAuthError(
                        f"Access denied (fault 2): {fault.faultString}"
                    ) from fault
                # Other faults are not transient — raise immediately
                raise OdooValidationError(
                    f"Odoo fault {fault.faultCode}: {fault.faultString}"
                ) from fault
        raise OdooError(
            f"Max retries ({self.max_retries}) exceeded: {last_exc}"
        ) from last_exc

    # ------------------------------------------------------------------
    # Core methods
    # ------------------------------------------------------------------

    def authenticate(self) -> int:
        """Authenticate against Odoo and store the UID.

        Returns:
            int: User ID (uid) on success.

        Raises:
            OdooAuthError: If credentials are invalid.
        """
        try:
            uid = self._with_retry(
                self.common.authenticate,
                self.db,
                self.username,
                self.api_key,
                {},
            )
        except OdooAuthError:
            raise
        except OdooError:
            raise

        if not uid:
            raise OdooAuthError(
                f"Authentication failed for user '{self.username}' on db '{self.db}'"
            )

        self.uid = int(uid)
        logger.info("Authenticated as uid=%d", self.uid)
        return self.uid

    def _ensure_authenticated(self) -> int:
        if self.uid is None:
            self.authenticate()
        assert self.uid is not None
        return self.uid

    def execute_kw(
        self,
        model: str,
        method: str,
        args: list,
        kwargs: Optional[dict] = None,
    ) -> Any:
        """Low-level execute_kw wrapper with retry logic."""
        uid = self._ensure_authenticated()
        return self._with_retry(
            self.models.execute_kw,
            self.db,
            uid,
            self.api_key,
            model,
            method,
            args,
            kwargs or {},
        )

    def search_read(
        self,
        model: str,
        domain: list,
        fields: Optional[list] = None,
        limit: int = 100,
        offset: int = 0,
        order: str = "",
    ) -> list[dict]:
        """Search and read records from an Odoo model.

        Args:
            model: Odoo model name (e.g. 'product.template')
            domain: Odoo domain filter list (e.g. [('active','=',True)])
            fields: List of field names to return (None = all fields)
            limit: Maximum number of records (default 100)
            offset: Pagination offset
            order: Sort order string (e.g. 'name asc')

        Returns:
            List of dicts with requested fields.
        """
        kw: dict[str, Any] = {"limit": limit, "offset": offset}
        if fields is not None:
            kw["fields"] = fields
        if order:
            kw["order"] = order

        return self.execute_kw(model, "search_read", [domain], kw)

    def read(self, model: str, ids: list[int], fields: Optional[list] = None) -> list[dict]:
        """Read specific records by IDs."""
        kw: dict[str, Any] = {}
        if fields is not None:
            kw["fields"] = fields
        return self.execute_kw(model, "read", [ids], kw)

    def write(self, model: str, ids: list[int], values: dict) -> bool:
        """Write (update) records."""
        return self.execute_kw(model, "write", [ids, values])

    def create(self, model: str, values: dict) -> int:
        """Create a new record and return its ID."""
        return self.execute_kw(model, "create", [values])

    def search_count(self, model: str, domain: list) -> int:
        """Return the count of records matching domain."""
        return self.execute_kw(model, "search_count", [domain])

    # ------------------------------------------------------------------
    # Product convenience methods
    # ------------------------------------------------------------------

    _TEMPLATE_FIELDS = [
        "id",
        "name",
        "description_sale",
        "description",
        "list_price",
        "standard_price",
        "categ_id",
        "taxes_id",
        "attribute_line_ids",
        "product_variant_ids",
        "product_variant_count",
        "image_1920",
        "active",
        "type",
        "default_code",
        "barcode",
        "weight",
        "write_date",
    ]

    _VARIANT_FIELDS = [
        "id",
        "name",
        "default_code",
        "barcode",
        "lst_price",
        "standard_price",
        "qty_available",
        "virtual_available",
        "combination_indices",
        "product_template_attribute_value_ids",
    ]

    _CATEGORY_FIELDS = ["id", "name", "parent_id"]
    _ATTRIBUTE_FIELDS = ["id", "name", "value_ids"]

    def get_product_templates(
        self,
        domain: Optional[list] = None,
        fields: Optional[list] = None,
    ) -> list[OdooProductTemplate]:
        """Fetch product templates with Pydantic validation."""
        raw = self.search_read(
            "product.template",
            domain or [("active", "=", True)],
            fields or self._TEMPLATE_FIELDS,
            limit=1000,
        )
        return [OdooProductTemplate.model_validate(r) for r in raw]

    def get_product_variants(self, template_id: int) -> list[OdooProductProduct]:
        """Fetch all variants for a given product template."""
        raw = self.search_read(
            "product.product",
            [("product_tmpl_id", "=", template_id)],
            self._VARIANT_FIELDS,
            limit=500,
        )
        return [OdooProductProduct.model_validate(r) for r in raw]

    def get_categories(self, domain: Optional[list] = None) -> list[OdooCategory]:
        """Fetch product categories."""
        raw = self.search_read(
            "product.category",
            domain or [],
            self._CATEGORY_FIELDS,
            limit=500,
        )
        return [OdooCategory.model_validate(r) for r in raw]

    def get_attributes(self) -> list[OdooAttribute]:
        """Fetch all product attributes."""
        raw = self.search_read(
            "product.attribute",
            [],
            self._ATTRIBUTE_FIELDS,
            limit=500,
        )
        return [OdooAttribute.model_validate(r) for r in raw]

    def create_sale_order(self, values: dict) -> int:
        """Create a draft sale order and return the new order ID."""
        return self.create("sale.order", values)

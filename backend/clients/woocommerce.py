"""WooCommerce REST API client for product, category, attribute, and order management.

Handles authentication via WooCommerce REST API Consumer Key / Secret (HTTP Basic Auth)
and provides full CRUD + batch operations for the WC /wp-json/wc/v3 endpoints.

Usage:
    async with WooCommerceClient(
        store_url="https://mystore.com",
        consumer_key="ck_xxx",
        consumer_secret="cs_xxx",
    ) as client:
        products = await client.get_products()
"""

import asyncio
from typing import Any, AsyncGenerator, Optional

import httpx

from backend.schemas.woocommerce import (
    WCAttribute,
    WCBatchResponse,
    WCCategory,
    WCOrder,
    WCProduct,
    WCVariation,
)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class WCError(Exception):
    """Base exception for WooCommerce API errors."""


class WCAuthError(WCError):
    """Raised when authentication fails (HTTP 401 or 403)."""


class WCNotFoundError(WCError):
    """Raised when a resource is not found (HTTP 404)."""


class WCAPIError(WCError):
    """Raised for other WooCommerce API errors (4xx/5xx).

    Attributes:
        status_code: HTTP status code from the response.
        wc_code: WooCommerce-specific error code string (e.g. "woocommerce_rest_invalid_id").
    """

    def __init__(
        self,
        message: str,
        status_code: Optional[int] = None,
        wc_code: Optional[str] = None,
    ):
        self.status_code = status_code
        self.wc_code = wc_code
        super().__init__(message)


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------


class WooCommerceClient:
    """Async WooCommerce REST API v3 client.

    Authentication uses WooCommerce REST API keys via HTTP Basic Auth.
    See: https://woocommerce.github.io/woocommerce-rest-api-docs/#authentication
    """

    def __init__(
        self,
        store_url: str,
        consumer_key: str,
        consumer_secret: str,
        rate_limit_delay: float = 0.1,
        timeout: float = 30.0,
    ):
        self.base_url = f"{store_url.rstrip('/')}/wp-json/wc/v3"
        self._rate_limit_delay = rate_limit_delay
        self._client = httpx.AsyncClient(
            auth=httpx.BasicAuth(consumer_key, consumer_secret),
            timeout=timeout,
            headers={"Accept": "application/json"},
        )

    # -- Context manager support ---------------------------------------------

    async def __aenter__(self) -> "WooCommerceClient":
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.aclose()

    # -- Internal helpers ----------------------------------------------------

    def _raise_for_status(self, response: httpx.Response) -> None:
        """Map HTTP error codes to typed WC exceptions.

        WooCommerce error responses typically look like::

            {"code": "woocommerce_rest_product_invalid_id",
             "message": "Invalid ID.",
             "data": {"status": 404}}
        """
        if response.status_code < 400:
            return

        # Try to parse WC-style JSON error body
        try:
            body = response.json()
            message = body.get("message", response.reason_phrase or "Unknown error")
            wc_code = body.get("code")
        except Exception:
            message = response.reason_phrase or "Unknown error"
            wc_code = None

        status = response.status_code

        if status in (401, 403):
            raise WCAuthError(f"WooCommerce auth error {status}: {message}")

        if status == 404:
            raise WCNotFoundError(f"WooCommerce not found: {message}")

        raise WCAPIError(
            message=f"WooCommerce API error {status}: {message}",
            status_code=status,
            wc_code=wc_code,
        )

    async def _get(
        self, path: str, params: Optional[dict[str, Any]] = None
    ) -> httpx.Response:
        """Send a GET request and return the raw response (after status check)."""
        response = await self._client.get(f"{self.base_url}/{path}", params=params)
        self._raise_for_status(response)
        await asyncio.sleep(self._rate_limit_delay)
        return response

    async def _post(self, path: str, data: dict[str, Any]) -> httpx.Response:
        """Send a POST request with JSON body."""
        response = await self._client.post(f"{self.base_url}/{path}", json=data)
        self._raise_for_status(response)
        await asyncio.sleep(self._rate_limit_delay)
        return response

    async def _put(self, path: str, data: dict[str, Any]) -> httpx.Response:
        """Send a PUT request with JSON body."""
        response = await self._client.put(f"{self.base_url}/{path}", json=data)
        self._raise_for_status(response)
        await asyncio.sleep(self._rate_limit_delay)
        return response

    async def _delete(
        self, path: str, params: Optional[dict[str, Any]] = None
    ) -> httpx.Response:
        """Send a DELETE request."""
        response = await self._client.delete(
            f"{self.base_url}/{path}", params=params
        )
        self._raise_for_status(response)
        await asyncio.sleep(self._rate_limit_delay)
        return response

    async def _paginate(
        self, path: str, params: Optional[dict[str, Any]] = None
    ) -> AsyncGenerator[list[dict[str, Any]], None]:
        """Async generator that follows WC pagination via X-WP-TotalPages header.

        Yields one page of results (list of dicts) per iteration.
        """
        params = dict(params) if params else {}
        page = 1
        while True:
            params["page"] = page
            params.setdefault("per_page", 100)
            response = await self._client.get(
                f"{self.base_url}/{path}", params=params
            )
            self._raise_for_status(response)
            yield response.json()
            total_pages = int(response.headers.get("X-WP-TotalPages", "1"))
            if page >= total_pages:
                break
            page += 1
            await asyncio.sleep(self._rate_limit_delay)

    # -- Product methods -----------------------------------------------------

    async def get_products(
        self, domain: Optional[list[Any]] = None
    ) -> list[WCProduct]:
        """Retrieve all products (paginated).

        Args:
            domain: Reserved for future server-side filtering; currently ignored.

        Returns:
            List of validated WCProduct models.
        """
        items: list[WCProduct] = []
        async for page_data in self._paginate("products"):
            for record in page_data:
                items.append(WCProduct.model_validate(record))
        return items

    async def get_product(self, product_id: int) -> WCProduct:
        """Retrieve a single product by ID.

        Args:
            product_id: WooCommerce product ID.

        Returns:
            Validated WCProduct model.

        Raises:
            WCNotFoundError: If the product does not exist.
        """
        response = await self._get(f"products/{product_id}")
        return WCProduct.model_validate(response.json())

    async def create_product(self, data: dict[str, Any]) -> WCProduct:
        """Create a new product.

        Args:
            data: Product fields as a dict (name, type, sku, etc.).

        Returns:
            The created WCProduct.
        """
        response = await self._post("products", data)
        return WCProduct.model_validate(response.json())

    async def update_product(
        self, product_id: int, data: dict[str, Any]
    ) -> WCProduct:
        """Update an existing product.

        Args:
            product_id: WooCommerce product ID.
            data: Fields to update.

        Returns:
            The updated WCProduct.
        """
        response = await self._put(f"products/{product_id}", data)
        return WCProduct.model_validate(response.json())

    async def delete_product(
        self, product_id: int, force: bool = True
    ) -> dict[str, Any]:
        """Delete a product.

        Args:
            product_id: WooCommerce product ID.
            force: Whether to permanently delete (bypass trash). Defaults to True.

        Returns:
            Raw API response dict.
        """
        response = await self._delete(
            f"products/{product_id}", params={"force": str(force).lower()}
        )
        return response.json()

    # -- Batch product methods -----------------------------------------------

    async def batch_products(
        self,
        create: Optional[list[dict[str, Any]]] = None,
        update: Optional[list[dict[str, Any]]] = None,
        delete: Optional[list[int]] = None,
    ) -> WCBatchResponse:
        """Batch create/update/delete products in a single request.

        Args:
            create: List of product dicts to create.
            update: List of product dicts to update (must include "id").
            delete: List of product IDs to delete.

        Returns:
            WCBatchResponse with created, updated, and deleted items.
        """
        payload: dict[str, Any] = {}
        if create:
            payload["create"] = create
        if update:
            payload["update"] = update
        if delete:
            payload["delete"] = delete
        response = await self._post("products/batch", payload)
        return WCBatchResponse.model_validate(response.json())

    # -- Variation methods ---------------------------------------------------

    async def get_variations(self, product_id: int) -> list[WCVariation]:
        """Retrieve all variations for a variable product.

        Args:
            product_id: Parent product ID.

        Returns:
            List of validated WCVariation models.
        """
        items: list[WCVariation] = []
        async for page_data in self._paginate(f"products/{product_id}/variations"):
            for record in page_data:
                items.append(WCVariation.model_validate(record))
        return items

    async def create_variation(
        self, product_id: int, data: dict[str, Any]
    ) -> WCVariation:
        """Create a new variation for a product.

        Args:
            product_id: Parent product ID.
            data: Variation fields (sku, price, attributes, etc.).

        Returns:
            The created WCVariation.
        """
        response = await self._post(f"products/{product_id}/variations", data)
        return WCVariation.model_validate(response.json())

    async def update_variation(
        self, product_id: int, variation_id: int, data: dict[str, Any]
    ) -> WCVariation:
        """Update an existing variation.

        Args:
            product_id: Parent product ID.
            variation_id: Variation ID.
            data: Fields to update.

        Returns:
            The updated WCVariation.
        """
        response = await self._put(
            f"products/{product_id}/variations/{variation_id}", data
        )
        return WCVariation.model_validate(response.json())

    async def batch_variations(
        self,
        product_id: int,
        create: Optional[list[dict[str, Any]]] = None,
        update: Optional[list[dict[str, Any]]] = None,
        delete: Optional[list[int]] = None,
    ) -> WCBatchResponse:
        """Batch create/update/delete variations for a product.

        Args:
            product_id: Parent product ID.
            create: List of variation dicts to create.
            update: List of variation dicts to update (must include "id").
            delete: List of variation IDs to delete.

        Returns:
            WCBatchResponse with created, updated, and deleted items.
        """
        payload: dict[str, Any] = {}
        if create:
            payload["create"] = create
        if update:
            payload["update"] = update
        if delete:
            payload["delete"] = delete
        response = await self._post(
            f"products/{product_id}/variations/batch", payload
        )
        return WCBatchResponse.model_validate(response.json())

    # -- Category methods ----------------------------------------------------

    async def get_categories(self) -> list[WCCategory]:
        """Retrieve all product categories (paginated).

        Returns:
            List of validated WCCategory models.
        """
        items: list[WCCategory] = []
        async for page_data in self._paginate("products/categories"):
            for record in page_data:
                items.append(WCCategory.model_validate(record))
        return items

    async def create_category(self, data: dict[str, Any]) -> WCCategory:
        """Create a new product category.

        Args:
            data: Category fields (name, slug, parent, description, etc.).

        Returns:
            The created WCCategory.
        """
        response = await self._post("products/categories", data)
        return WCCategory.model_validate(response.json())

    async def update_category(
        self, category_id: int, data: dict[str, Any]
    ) -> WCCategory:
        """Update an existing product category.

        Args:
            category_id: WooCommerce category ID.
            data: Fields to update.

        Returns:
            The updated WCCategory.
        """
        response = await self._put(f"products/categories/{category_id}", data)
        return WCCategory.model_validate(response.json())

    # -- Attribute methods ---------------------------------------------------

    async def get_attributes(self) -> list[WCAttribute]:
        """Retrieve all product attributes (paginated).

        Returns:
            List of validated WCAttribute models.
        """
        items: list[WCAttribute] = []
        async for page_data in self._paginate("products/attributes"):
            for record in page_data:
                items.append(WCAttribute.model_validate(record))
        return items

    async def create_attribute(self, data: dict[str, Any]) -> WCAttribute:
        """Create a new product attribute.

        Args:
            data: Attribute fields (name, slug, type, etc.).

        Returns:
            The created WCAttribute.
        """
        response = await self._post("products/attributes", data)
        return WCAttribute.model_validate(response.json())

    # -- Order methods -------------------------------------------------------

    async def get_orders(
        self,
        status: Optional[str] = None,
        after: Optional[str] = None,
    ) -> list[WCOrder]:
        """Retrieve orders with optional filtering.

        Args:
            status: Filter by order status (e.g. "processing", "completed").
            after: Filter orders created after this ISO 8601 date string.

        Returns:
            List of validated WCOrder models.
        """
        params: dict[str, Any] = {}
        if status:
            params["status"] = status
        if after:
            params["after"] = after

        items: list[WCOrder] = []
        async for page_data in self._paginate("orders", params):
            for record in page_data:
                items.append(WCOrder.model_validate(record))
        return items

    async def get_order(self, order_id: int) -> WCOrder:
        """Retrieve a single order by ID.

        Args:
            order_id: WooCommerce order ID.

        Returns:
            Validated WCOrder model.

        Raises:
            WCNotFoundError: If the order does not exist.
        """
        response = await self._get(f"orders/{order_id}")
        return WCOrder.model_validate(response.json())

    async def update_order(
        self, order_id: int, data: dict[str, Any]
    ) -> WCOrder:
        """Update an existing order.

        Args:
            order_id: WooCommerce order ID.
            data: Fields to update (e.g. status, meta_data).

        Returns:
            The updated WCOrder.
        """
        response = await self._put(f"orders/{order_id}", data)
        return WCOrder.model_validate(response.json())

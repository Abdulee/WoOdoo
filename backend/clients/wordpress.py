"""WordPress REST API client for media uploads with SHA256 hash-based dedup utilities.

Handles authentication via WordPress Application Passwords (HTTP Basic Auth)
and provides image processing utilities for Odoo base64 image handling.

Usage:
    client = WordPressClient(
        wp_url="https://example.com",
        username="admin",
        application_password="xxxx xxxx xxxx xxxx"
    )
    media = await client.upload_image("photo.jpg", image_bytes, "image/jpeg")
"""

import base64
import hashlib
from typing import Optional

import httpx
from pydantic import BaseModel


class WPMediaItem(BaseModel):
    """WordPress media item returned from the REST API."""

    id: int
    url: str  # guid.rendered — permalink URL
    source_url: str  # direct file URL
    mime_type: str


class WordPressClientError(Exception):
    """Raised when WordPress API returns an error."""

    def __init__(self, status_code: int, message: str, code: Optional[str] = None):
        self.status_code = status_code
        self.code = code
        super().__init__(f"WordPress API error {status_code}: {message}")


class WordPressClient:
    """Async WordPress REST API client for media operations.

    Authentication uses WordPress Application Passwords via HTTP Basic Auth.
    See: https://make.wordpress.org/core/2020/11/05/application-passwords-integration-guide/
    """

    def __init__(
        self,
        wp_url: str,
        username: str,
        application_password: str,
        timeout: float = 30.0,
    ):
        self.base_url = f"{wp_url.rstrip('/')}/wp-json/wp/v2"
        self._client = httpx.AsyncClient(
            auth=httpx.BasicAuth(username, application_password),
            timeout=timeout,
            headers={"Accept": "application/json"},
        )

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.aclose()

    async def __aenter__(self) -> "WordPressClient":
        return self

    async def __aexit__(self, *args: object) -> None:
        await self.close()

    def _parse_media_item(self, data: dict) -> WPMediaItem:
        """Parse WordPress API response into WPMediaItem."""
        return WPMediaItem(
            id=data["id"],
            url=data.get("guid", {}).get("rendered", ""),
            source_url=data.get("source_url", ""),
            mime_type=data.get("mime_type", ""),
        )

    def _raise_for_status(self, response: httpx.Response) -> None:
        """Raise WordPressClientError for non-2xx responses."""
        if response.status_code >= 400:
            try:
                body = response.json()
                message = body.get("message", response.reason_phrase or "Unknown error")
                code = body.get("code")
            except Exception:
                message = response.reason_phrase or "Unknown error"
                code = None
            raise WordPressClientError(
                status_code=response.status_code,
                message=message,
                code=code,
            )

    async def upload_image(
        self, filename: str, image_bytes: bytes, mime_type: str
    ) -> WPMediaItem:
        """Upload an image to WordPress media library.

        Args:
            filename: Target filename (e.g. "product-image.jpg")
            image_bytes: Raw image bytes
            mime_type: MIME type (e.g. "image/jpeg", "image/png")

        Returns:
            WPMediaItem with WordPress media ID and URLs

        Raises:
            WordPressClientError: If the upload fails
        """
        response = await self._client.post(
            f"{self.base_url}/media",
            content=image_bytes,
            headers={
                "Content-Type": mime_type,
                "Content-Disposition": f'attachment; filename="{filename}"',
            },
        )
        self._raise_for_status(response)
        return self._parse_media_item(response.json())

    async def get_media(self, media_id: int) -> WPMediaItem:
        """Retrieve a media item by ID.

        Args:
            media_id: WordPress media attachment ID

        Returns:
            WPMediaItem with media details

        Raises:
            WordPressClientError: If the media is not found or request fails
        """
        response = await self._client.get(f"{self.base_url}/media/{media_id}")
        self._raise_for_status(response)
        return self._parse_media_item(response.json())

    async def delete_media(self, media_id: int) -> bool:
        """Delete a media item by ID.

        Uses force=true to bypass trash (permanent delete).

        Args:
            media_id: WordPress media attachment ID

        Returns:
            True if deletion was successful

        Raises:
            WordPressClientError: If the media is not found or request fails
        """
        response = await self._client.delete(
            f"{self.base_url}/media/{media_id}",
            params={"force": "true"},
        )
        self._raise_for_status(response)
        return True


# ---------------------------------------------------------------------------
# Image processing utilities (standalone functions)
# ---------------------------------------------------------------------------


def decode_odoo_image(base64_str: str) -> bytes:
    """Decode Odoo's base64-encoded image string to raw bytes.

    Odoo stores images in fields like `image_1920` as base64-encoded strings.
    Handles both standard and URL-safe base64 with optional padding.

    Args:
        base64_str: Base64-encoded image string from Odoo

    Returns:
        Raw image bytes

    Raises:
        ValueError: If the string is not valid base64
    """
    try:
        # Strip whitespace/newlines that Odoo may include
        cleaned = base64_str.strip()
        return base64.b64decode(cleaned)
    except Exception as e:
        raise ValueError(f"Invalid base64 image data: {e}") from e


def compute_image_hash(image_bytes: bytes) -> str:
    """Compute SHA256 hex digest of raw image bytes.

    Used for deduplication: if two images produce the same hash,
    they are identical and the upload can be skipped.

    Args:
        image_bytes: Raw image bytes

    Returns:
        SHA256 hex digest string (64 chars)
    """
    return hashlib.sha256(image_bytes).hexdigest()


def detect_mime_type(image_bytes: bytes) -> str:
    """Detect MIME type from magic bytes (file signature).

    Supports:
        - PNG: starts with \\x89PNG
        - JPEG: starts with \\xff\\xd8\\xff
        - GIF: starts with GIF8 (GIF87a or GIF89a)

    Args:
        image_bytes: Raw image bytes (at least first 4 bytes needed)

    Returns:
        MIME type string (e.g. "image/png")

    Raises:
        ValueError: If the format cannot be detected
    """
    if len(image_bytes) < 4:
        raise ValueError("Image data too short to detect format")

    if image_bytes[:4] == b"\x89PNG":
        return "image/png"
    if image_bytes[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if image_bytes[:4] == b"GIF8":
        return "image/gif"

    raise ValueError(
        f"Unknown image format (magic bytes: {image_bytes[:4]!r})"
    )

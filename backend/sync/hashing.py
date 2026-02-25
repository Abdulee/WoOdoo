"""Field-level hash engine for change detection in WoOdoo sync.

Computes deterministic SHA-256 hashes of normalized field values to detect
real changes and prevent sync ping-pong loops between Odoo ↔ WooCommerce.
"""

import hashlib
import json
import re
from decimal import Decimal, InvalidOperation


# Pre-compiled pattern: matches integers, floats, scientific notation
_NUMBER_RE = re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$")


def _normalize_value(value: object) -> str:
    """Normalize a field value to a canonical string for hashing.

    Rules:
        1. None / empty string / empty list → ""
        2. Booleans → "true" or "false"
        3. Numbers (int, float, Decimal) → 2-decimal-place string e.g. "10.00"
        4. Strings that look like numbers → same 2-decimal-place treatment
        5. Plain strings → strip + lowercase
        6. Lists → sort primitives, serialize to compact sorted-key JSON
        7. Dicts → compact sorted-key JSON
    """
    # 1. None / empty-ish
    if value is None:
        return ""
    if isinstance(value, str) and value.strip() == "":
        return ""
    if isinstance(value, list) and len(value) == 0:
        return ""

    # 2. Booleans (must come before int check since bool is subclass of int)
    if isinstance(value, bool):
        return "true" if value else "false"

    # 3. Numeric types (int, float, Decimal)
    if isinstance(value, (int, float)):
        return f"{Decimal(str(value)):.2f}"
    if isinstance(value, Decimal):
        return f"{value:.2f}"

    # 4. String that looks like a number
    if isinstance(value, str) and _NUMBER_RE.match(value.strip()):
        try:
            return f"{Decimal(value.strip()):.2f}"
        except InvalidOperation:
            pass  # Fall through to plain string handling

    # 5. Plain strings
    if isinstance(value, str):
        return value.strip().lower()

    # 6. Lists
    if isinstance(value, list):
        # Sort primitive elements; leave dicts/lists unsorted (order-sensitive)
        try:
            sorted_list = sorted(value)
        except TypeError:
            sorted_list = value
        return json.dumps(sorted_list, sort_keys=True, separators=(",", ":"))

    # 7. Dicts
    if isinstance(value, dict):
        return json.dumps(value, sort_keys=True, separators=(",", ":"))

    # Fallback: convert to string
    return str(value).strip().lower()


def compute_field_hash(field_name: str, value: object) -> str:
    """Compute SHA-256 hash of a normalized field value.

    Args:
        field_name: Name of the field (unused in hash computation but kept
            for API symmetry and potential future use).
        value: The raw field value to hash.

    Returns:
        Hex digest string (64 characters).
    """
    normalized = _normalize_value(value)
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def compute_product_hashes(
    product_data: dict, field_list: list[str]
) -> dict[str, str]:
    """Hash each listed field from product data.

    Args:
        product_data: Dict of field_name → raw value.
        field_list: Which fields to hash.

    Returns:
        Dict of field_name → hex digest for each field in *field_list*.
        Missing fields are treated as None.
    """
    return {
        field: compute_field_hash(field, product_data.get(field))
        for field in field_list
    }


def diff_hashes(
    current_hashes: dict[str, str], stored_hashes: dict[str, str]
) -> list[str]:
    """Return field names where hashes differ (or are new/removed).

    Args:
        current_hashes: Freshly computed hashes.
        stored_hashes: Previously stored hashes.

    Returns:
        Sorted list of field names that changed, appeared, or disappeared.
    """
    all_fields = set(current_hashes) | set(stored_hashes)
    changed = [
        field
        for field in all_fields
        if current_hashes.get(field) != stored_hashes.get(field)
    ]
    return sorted(changed)


def has_real_changes(
    source_data: dict, stored_hashes: dict[str, str], field_list: list[str]
) -> bool:
    """Return True if any field in *field_list* changed vs stored hashes.

    Args:
        source_data: Raw product data dict.
        stored_hashes: Previously stored hashes.
        field_list: Fields to check.

    Returns:
        True when at least one field hash differs.
    """
    current = compute_product_hashes(source_data, field_list)
    return len(diff_hashes(current, stored_hashes)) > 0


def should_skip_ping_pong(
    sync_origin: str | None,
    current_hashes: dict[str, str],
    stored_hashes: dict[str, str],
) -> bool:
    """Determine if an incoming change is an echo of our own write.

    Anti-ping-pong logic:
        • If sync_origin is NOT 'woodoo' → never skip (not our echo).
        • If sync_origin IS 'woodoo' AND all hashes match → skip (echo).
        • If sync_origin IS 'woodoo' BUT hashes differ → don't skip
          (genuine change from the remote side).

    After a skip, the **caller** is responsible for clearing sync_origin
    (e.g. setting it to None or 'woocommerce').

    Args:
        sync_origin: Current sync_origin value on the product mapping.
        current_hashes: Hashes of incoming data.
        stored_hashes: Hashes stored from our last write.

    Returns:
        True if the change should be skipped (it's our own echo).
    """
    if sync_origin != "woodoo":
        return False
    # sync_origin is 'woodoo' — check if data actually changed
    return len(diff_hashes(current_hashes, stored_hashes)) == 0

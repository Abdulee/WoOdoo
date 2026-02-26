# Sync Engine

The sync engine is the core of WoOdoo. It handles fetching data from source systems, detecting changes, and pushing updates to destination systems — all while avoiding unnecessary API calls and infinite sync loops.

## Sync Pipeline

Every sync execution runs phases in a strict order:

```
1. Categories   — Hierarchical category sync (topological sort)
2. Products     — Simple + variable product sync with delta detection
3. Images       — Product images via WordPress Media Library
4. Stock        — Inventory levels (Odoo-authoritative, batch API)
```

Each phase runs independently but in sequence. A failure in one phase is logged but does not prevent subsequent phases from running.

## Phase Details

### Categories

- Fetches all Odoo product categories via XML-RPC
- Performs **topological sort** to ensure parent categories are created before children
- Creates/updates WC categories via REST API
- Stores mappings in `category_mappings` table

### Products

Handles two product types:

**Simple products** (1 variant):
1. Fetch `product.template` from Odoo
2. Build WC payload via field mappings
3. Compute field-level hashes
4. Compare with stored hashes → skip if unchanged
5. Create or update WC product

**Variable products** (2+ variants):
1. Create/update the WC parent product as `type=variable`
2. For each Odoo `product.product` variant:
   - Build variant payload (SKU + price)
   - Compute variant-level hashes
   - Create or update WC variation

### Images

1. Fetch `image_1920` (base64) from Odoo `product.template`
2. Decode base64 → raw bytes
3. Compute SHA-256 hash of image data
4. Check `image_mappings` — if hash matches → **skip** (deduplication)
5. Upload to WordPress Media Library
6. If replacing an old image (hash changed): delete old WP media
7. Store mapping with new `wp_media_id` and `woo_image_url`

### Stock

- Stock is **Odoo → WC only** (Odoo is the authoritative inventory source)
- Loads all `ProductMapping` records with variant IDs
- Batch-fetches Odoo stock quantities
- Groups by WC product ID for efficient batch updates (50 items per batch)

## Field-Level Hashing

WoOdoo uses SHA-256 hashes to detect real changes at the field level. This avoids unnecessary API calls when data hasn't actually changed.

### How It Works

```
Odoo Data → Normalize → SHA-256 Hash → Compare with Stored Hash → Skip or Sync
```

### Normalization Rules

Before hashing, values are normalized to a canonical form:

| Type | Normalization | Example |
|------|--------------|---------|
| `None` / empty string / `[]` | `""` | `None` → `""` |
| Boolean | `"true"` or `"false"` | `True` → `"true"` |
| Number (int, float, Decimal) | 2-decimal string | `10` → `"10.00"` |
| Numeric string | 2-decimal string | `"9.99"` → `"9.99"` |
| String | strip + lowercase | `"  Hello "` → `"hello"` |
| List | sort + compact JSON | `[3, 1, 2]` → `[1,2,3]` |
| Dict | sorted-key compact JSON | `{"b": 1, "a": 2}` → `{"a":2,"b":1}` |

This ensures that semantically equivalent values produce the same hash, regardless of formatting differences between Odoo and WooCommerce.

### Hash Storage

Hashes are stored per-field in the `field_hashes` JSON column of `product_mappings`:

```json
{
  "name": "a1b2c3d4...",
  "list_price": "e5f6g7h8...",
  "default_code": "i9j0k1l2...",
  "description": "m3n4o5p6..."
}
```

### Delta Detection

On each sync:

1. **Compute** current hashes for all mapped fields
2. **Load** stored hashes from the database
3. **Diff** — find fields where the hash changed, appeared, or disappeared
4. If **no changes** → skip (no API call)
5. If **changes detected** → push full payload to WC, then store new hashes

```python
current_hashes = compute_product_hashes(data, fields)
stored_hashes  = mapping.field_hashes or {}
changed_fields = diff_hashes(current_hashes, stored_hashes)

if not changed_fields:
    result.skipped += 1  # No API call needed
    return
```

## Anti-Ping-Pong

When WoOdoo writes to WooCommerce, WC may trigger a webhook back to WoOdoo. Without protection, this creates an infinite loop:

```
WoOdoo writes to WC → WC webhook fires → WoOdoo sees "change" → writes to WC → ...
```

### How It's Prevented

Every `ProductMapping` has a `sync_origin` field:

| Value | Meaning |
|-------|---------|
| `woodoo` | Last write was from WoOdoo |
| `woocommerce` | Last write was from WC (webhook) |
| `odoo` | Last write was from Odoo (webhook) |

**Decision logic:**

```python
def should_skip_ping_pong(sync_origin, current_hashes, stored_hashes):
    if sync_origin != "woodoo":
        return False  # Not our echo — always process
    
    # sync_origin is "woodoo" — check if data actually changed
    return len(diff_hashes(current_hashes, stored_hashes)) == 0
    # If hashes match → it's our own echo → SKIP
    # If hashes differ → genuine external change → PROCESS
```

This means:
- If WoOdoo wrote last AND hashes match → **skip** (it's an echo of our own write)
- If WoOdoo wrote last BUT hashes differ → **process** (genuine change from external source)
- If sync_origin is not WoOdoo → **always process** (change from Odoo or WC)

## Retry Engine

Failed sync items are retried with exponential backoff:

| Retry | Delay | Total Wait |
|-------|-------|------------|
| 1st | 30 seconds | 30s |
| 2nd | 120 seconds | 2.5 min |
| 3rd | 300 seconds | 7.5 min |

After 3 failed retries, the item moves to `failed_permanent` status and appears in the Review Queue.

### Non-Retryable Errors

HTTP 404 and 410 responses go directly to `failed_permanent` (no retries). These indicate the resource no longer exists.

## Field Mapping Engine

The field mapping engine translates Odoo data to WC payloads based on job configuration:

```python
# For each field mapping with direction == "odoo_to_wc":
for fm in field_mappings:
    odoo_value = odoo_data[fm["odoo_field"]]
    wc_payload[fm["wc_field"]] = format_value(odoo_value, fm["wc_field"])
```

Special handling:
- **Price fields** (`regular_price`, `sale_price`, `price`) are always formatted as strings (WC API requirement)
- **SKU** maps to `default_code` (Odoo) ↔ `sku` (WC) by default
- **Description** maps directly

### Default Mappings

If no custom mappings are provided, these defaults are used:

| Odoo Field | WC Field | Direction |
|-----------|----------|-----------|
| `name` | `name` | odoo_to_wc |
| `list_price` | `regular_price` | odoo_to_wc |
| `default_code` | `sku` | odoo_to_wc |
| `description` | `description` | odoo_to_wc |

## Concurrency Control

### Advisory Locks

Each sync job acquires a PostgreSQL advisory lock before running:

```sql
SELECT pg_advisory_xact_lock(hashtext('job-{job_id}'))
```

This prevents two workers from running the same job simultaneously. The lock is released when the transaction commits.

### Task Queue Separation

- **Default queue** — Product, category, and stock sync tasks
- **Image queue** — Image sync tasks (lower concurrency to reduce bandwidth)

This prevents image uploads from starving product sync workers.

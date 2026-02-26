# Job Builder

The Job Builder is the primary interface for creating and configuring sync jobs. Each job defines what to sync, how fields map between systems, and when sync runs.

## Creating a Job

### Via the UI

1. Navigate to **Jobs** → **New Job**
2. Fill in the job details:
   - **Name** — A descriptive name (e.g., "Product Sync Every 6h")
   - **Direction** — Which way data flows
   - **Connection** — Which Odoo/WC connection to use
3. Configure field mappings
4. Set a schedule
5. Optionally configure lifecycle rules and filters
6. Click **Create**

### Via the API

```bash
curl -X POST http://localhost:8000/api/jobs \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Product Sync Every 6h",
    "direction": "odoo_to_wc",
    "connection_id": 1,
    "filters": [],
    "field_mappings": [
      {"odoo_field": "name", "wc_field": "name", "direction": "odoo_to_wc", "enabled": true},
      {"odoo_field": "list_price", "wc_field": "regular_price", "direction": "bidirectional", "enabled": true},
      {"odoo_field": "default_code", "wc_field": "sku", "direction": "odoo_to_wc", "enabled": true},
      {"odoo_field": "description", "wc_field": "description", "direction": "odoo_to_wc", "enabled": true}
    ],
    "schedule_config": {"type": "interval", "interval_seconds": 21600},
    "lifecycle_config": {"on_new_source": "create", "on_deleted_source": "archive"},
    "is_enabled": true
  }'
```

## Direction

| Direction | Description |
|-----------|-------------|
| `odoo_to_wc` | Odoo is the source of truth. Data flows from Odoo → WooCommerce |
| `wc_to_odoo` | WooCommerce is the source of truth. Data flows from WC → Odoo |
| `bidirectional` | Both systems can update. Most recent change wins (with anti-ping-pong protection) |

## Field Mappings

Field mappings define which Odoo fields correspond to which WooCommerce fields, and in which direction data flows for each field.

### Structure

```json
{
  "odoo_field": "name",
  "wc_field": "name",
  "direction": "odoo_to_wc",
  "enabled": true
}
```

### Field Directions

Each field mapping has its own direction, independent of the job's overall direction:

| Direction | Behavior |
|-----------|----------|
| `odoo_to_wc` | Only sync this field from Odoo → WC |
| `wc_to_odoo` | Only sync this field from WC → Odoo |
| `bidirectional` | Sync this field in both directions |
| `skip` | Exclude this field from sync entirely |

This means you can have an `odoo_to_wc` job where the `description` field uses `bidirectional` mapping — the job's direction controls the overall flow, but individual fields can override.

### Common Mappings

| Odoo Field | WC Field | Notes |
|-----------|----------|-------|
| `name` | `name` | Product title |
| `list_price` | `regular_price` | Formatted as string for WC API |
| `default_code` | `sku` | Internal reference / SKU |
| `description` | `description` | Long description |
| `barcode` | *(custom)* | Often used for matching, not direct sync |
| `weight` | `weight` | Product weight |

### Stock-Only Sync

A common use case is matching products by SKU/barcode and only syncing stock levels:

1. Create a job with direction `odoo_to_wc`
2. Set all field mappings to `skip` except stock-related fields
3. Use the Matching feature to link products by SKU ↔ barcode
4. The sync engine will skip product data but update stock levels

## Schedule Configuration

### Cron Schedule

Use standard 5-field cron expressions:

```json
{
  "type": "cron",
  "cron_expression": "0 */6 * * *"
}
```

| Field | Values | Description |
|-------|--------|-------------|
| Minute | 0-59 | Minute of the hour |
| Hour | 0-23 | Hour of the day |
| Day of Month | 1-31 | Day of the month |
| Month | 1-12 | Month of the year |
| Day of Week | 0-6 | Day of the week (0=Sunday) |

**Examples:**

| Expression | Description |
|-----------|-------------|
| `0 */6 * * *` | Every 6 hours at minute 0 |
| `0 0 * * *` | Daily at midnight |
| `*/30 * * * *` | Every 30 minutes |
| `0 9 * * 1-5` | Weekdays at 9 AM |
| `0 2 * * 0` | Sundays at 2 AM |

### Interval Schedule

Use a fixed interval in seconds:

```json
{
  "type": "interval",
  "interval_seconds": 21600
}
```

| Seconds | Description |
|---------|-------------|
| 900 | Every 15 minutes |
| 3600 | Every hour |
| 21600 | Every 6 hours |
| 86400 | Every 24 hours |

### No Schedule (Manual Only)

Omit `schedule_config` or set it to `null`. The job can only be triggered manually via the UI or API (`POST /api/jobs/{id}/run`).

## Lifecycle Configuration

Lifecycle rules control what happens when products appear or disappear from the source system.

### on_new_source

What to do when a new product appears in the source system:

| Value | Behavior |
|-------|----------|
| `create` | Automatically create the product in the destination system |
| `flag` | Mark the product for manual review (appears in Review Queue) |

### on_deleted_source

What to do when a product is deleted from the source system:

| Value | Behavior |
|-------|----------|
| `archive` | Set the product to draft/archived in the destination |
| `delete` | Permanently delete the product from the destination |
| `flag` | Mark for manual review |
| `ignore` | Do nothing — leave the orphaned product as-is |

### Example

```json
{
  "on_new_source": "create",
  "on_deleted_source": "archive"
}
```

## Filters

Filters restrict which products are included in a sync job.

### Structure

```json
{
  "field": "categ_id",
  "operator": "=",
  "value": 5
}
```

### Operators

| Operator | Description |
|----------|-------------|
| `=` | Equal to |
| `!=` | Not equal to |
| `>` | Greater than |
| `<` | Less than |
| `>=` | Greater than or equal |
| `<=` | Less than or equal |
| `in` | In list of values |
| `not in` | Not in list of values |
| `like` | SQL LIKE pattern |

### Example: Sync Only Specific Categories

```json
[
  {
    "field": "categ_id",
    "operator": "in",
    "value": [5, 12, 18]
  }
]
```

### Example: Sync Products Above a Price

```json
[
  {
    "field": "list_price",
    "operator": ">",
    "value": 10.00
  }
]
```

## Running Jobs

### Manual Trigger

From the UI: Click **Run Now** on any job.

From the API:

```bash
curl -X POST http://localhost:8000/api/jobs/1/run \
  -H "Authorization: Bearer $TOKEN"
```

### Scheduled Execution

When a job has a schedule, Celery Beat automatically triggers it. The Beat wrapper:

1. Creates a new `SyncExecution` record
2. Dispatches to the Celery worker
3. Worker runs the sync pipeline (categories → products → images → stock)

### Monitoring

- **Dashboard** — Shows recent executions with success/error counts
- **Logs** — Filter by job, status, time range
- **WebSocket** — Live progress during sync (phase, processed/total, current product name)

## Previewing

Before running a sync, you can preview what would be affected:

```bash
curl http://localhost:8000/api/jobs/1/preview \
  -H "Authorization: Bearer $TOKEN"
```

This returns the list of products that match the job's filters without actually syncing anything.

# API Reference

All endpoints require JWT authentication unless noted otherwise. Include the token in the `Authorization` header:

```
Authorization: Bearer <token>
```

Base URL: `http://localhost:8000`

---

## Authentication

### POST /api/auth/login

Login and obtain a JWT access token. Rate limited to 5 attempts per minute.

**Request:**

```json
{
  "username": "admin",
  "password": "your-password"
}
```

**Response (200):**

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer",
  "expires_in": 86400
}
```

**Errors:** `401` Invalid credentials

### POST /api/auth/change-password

Change the admin user's password. Requires authentication.

**Request:**

```json
{
  "current_password": "old-password",
  "new_password": "new-password"
}
```

**Response (200):**

```json
{
  "message": "Password updated successfully"
}
```

---

## Health

### GET /api/health

Check backend health status. **No authentication required.**

**Response (200):**

```json
{
  "status": "healthy",
  "timestamp": "2025-01-15T10:30:00Z"
}
```

---

## Connections

### POST /api/connections

Create a new Odoo or WooCommerce connection. Credentials are encrypted at rest.

**Request:**

```json
{
  "platform": "odoo",
  "name": "My Odoo Instance",
  "config": {
    "url": "https://mycompany.odoo.com",
    "database": "mycompany-prod",
    "username": "admin",
    "api_key": "your-api-key"
  }
}
```

**Response (201):**

```json
{
  "id": 1,
  "platform": "odoo",
  "name": "My Odoo Instance",
  "is_active": true,
  "config": {
    "url": "https://mycompany.odoo.com",
    "database": "mycompany-prod",
    "username": "admin",
    "api_key": "***"
  },
  "last_tested_at": null,
  "created_at": "2025-01-15T10:30:00",
  "updated_at": "2025-01-15T10:30:00"
}
```

> Note: Secret fields (`api_key`, `consumer_key`, `consumer_secret`, `password`) are always masked as `***` in responses.

### GET /api/connections

List all connections.

**Response (200):**

```json
[
  {
    "id": 1,
    "platform": "odoo",
    "name": "My Odoo Instance",
    "is_active": true,
    "config": { "url": "https://mycompany.odoo.com", "api_key": "***", "..." : "..." },
    "last_tested_at": "2025-01-15T10:35:00",
    "created_at": "2025-01-15T10:30:00",
    "updated_at": "2025-01-15T10:30:00"
  }
]
```

### GET /api/connections/{id}

Get a single connection's details.

### PUT /api/connections/{id}

Update a connection (name, config, or is_active).

**Request:**

```json
{
  "name": "Updated Name",
  "config": { "url": "https://new-url.odoo.com", "..." : "..." },
  "is_active": true
}
```

All fields are optional — only provided fields are updated.

### DELETE /api/connections/{id}

Delete a connection. Returns `204 No Content`.

### POST /api/connections/{id}/test

Test a connection. For Odoo, authenticates via XML-RPC and reads the server version and currency. For WooCommerce, hits the `/system_status` endpoint and also checks WordPress Media API access.

**Response (200):**

```json
{
  "success": true,
  "message": "Connected to Odoo successfully",
  "details": {
    "version": "18.0",
    "latency_ms": 245.3
  },
  "currency": "EUR"
}
```

### GET /api/connections/{id}/status

Get the last test result and status for a connection.

**Response (200):**

```json
{
  "connection_id": 1,
  "name": "My Odoo Instance",
  "platform": "odoo",
  "status": "active",
  "last_tested_at": "2025-01-15T10:35:00",
  "is_active": true
}
```

### GET /api/connections/{id}/health

Run a health check on a specific connection.

### GET /api/health/all

Run health checks on all active connections. Returns an array of health check results.

### GET /api/connections/{id}/currency

Get the detected currency for a connection (used for currency mismatch warnings).

---

## Sync Jobs

### POST /api/jobs

Create a new sync job.

**Request:**

```json
{
  "name": "Product Sync Every 6h",
  "direction": "odoo_to_wc",
  "connection_id": 1,
  "filters": [],
  "field_mappings": [
    {
      "odoo_field": "name",
      "wc_field": "name",
      "direction": "odoo_to_wc",
      "enabled": true
    },
    {
      "odoo_field": "list_price",
      "wc_field": "regular_price",
      "direction": "bidirectional",
      "enabled": true
    }
  ],
  "schedule_config": {
    "type": "interval",
    "interval_seconds": 21600
  },
  "lifecycle_config": {
    "on_new_source": "create",
    "on_deleted_source": "archive"
  },
  "is_enabled": true
}
```

**Response (201):**

```json
{
  "id": 1,
  "name": "Product Sync Every 6h",
  "direction": "odoo_to_wc",
  "connection_id": 1,
  "is_enabled": true,
  "filters": [],
  "field_mappings": [ "..." ],
  "schedule_config": { "type": "interval", "interval_seconds": 21600 },
  "lifecycle_config": { "on_new_source": "create", "on_deleted_source": "archive" },
  "created_at": "2025-01-15T11:00:00",
  "updated_at": "2025-01-15T11:00:00"
}
```

### GET /api/jobs

List all sync jobs.

### GET /api/jobs/{id}

Get a single job's details, including its field mappings and schedule configuration.

### PUT /api/jobs/{id}

Update a job. All fields from the create request are accepted. If `schedule_config` changes, the Celery Beat schedule is automatically updated.

### DELETE /api/jobs/{id}

Soft-delete a job (disables it and removes its schedule). Returns `204 No Content`.

### POST /api/jobs/{id}/run

Trigger a manual execution of a sync job. Creates a new `SyncExecution` and dispatches it to the Celery worker.

**Response (200):**

```json
{
  "execution_id": 42,
  "message": "Sync job triggered successfully"
}
```

### GET /api/jobs/{id}/executions

List all executions for a job, ordered by most recent first.

**Response (200):**

```json
[
  {
    "id": 42,
    "job_id": 1,
    "status": "completed",
    "started_at": "2025-01-15T11:00:00",
    "completed_at": "2025-01-15T11:02:30",
    "total_products": 150,
    "synced_count": 148,
    "error_count": 2,
    "skipped_count": 0
  }
]
```

### GET /api/jobs/{id}/preview

Preview what would be synced without actually running the job. Returns a list of products that would be affected.

---

## Orders

### POST /api/orders/sync

Sync a single WooCommerce order to Odoo. Creates a sale order with mapped line items.

**Request:**

```json
{
  "wc_order_id": 1234,
  "connection_id": 1
}
```

### GET /api/orders

List all order mappings (WC order ID ↔ Odoo order ID).

**Query parameters:** `page`, `per_page`, `status`

### GET /api/orders/{wc_order_id}

Get a specific order mapping by WooCommerce order ID.

### DELETE /api/orders/{mapping_id}

Delete an order mapping. Returns `204 No Content`.

---

## Product Matching

### POST /api/matching/auto

Trigger automatic product matching. Matches WooCommerce products to Odoo products by SKU ↔ barcode.

**Response (200):**

```json
{
  "task_id": "abc123-def456",
  "message": "Auto-matching started"
}
```

### GET /api/matching/status/{task_id}

Poll the status of an auto-match task.

**Response (200):**

```json
{
  "task_id": "abc123-def456",
  "status": "completed",
  "matched": 45,
  "unmatched": 12,
  "conflicts": 3
}
```

### GET /api/matching/unmatched

List products that could not be auto-matched.

### POST /api/matching/link

Manually link an Odoo product to a WooCommerce product.

**Request:**

```json
{
  "odoo_template_id": 42,
  "woo_product_id": 789,
  "match_method": "manual"
}
```

### DELETE /api/matching/link/{mapping_id}

Remove a product mapping (unlink).

### GET /api/matching/conflicts

List SKU conflicts (multiple Odoo products with the same barcode, or multiple WC products with the same SKU).

---

## Review Queue

Items that fail after all retry attempts (3 retries with exponential backoff) enter the review queue as `failed_permanent`.

### GET /api/review-queue

List all permanently failed items.

**Query parameters:** `job_id`, `page`, `per_page`

**Response (200):**

```json
[
  {
    "id": 15,
    "execution_id": 42,
    "product_mapping_id": 100,
    "level": "error",
    "message": "Max retries (3) exceeded: HTTPStatusError 500",
    "details": {
      "retry_count": 4,
      "permanent_reason": "max_retries_exceeded"
    },
    "created_at": "2025-01-15T11:05:00"
  }
]
```

### POST /api/review-queue/{log_id}/retry

Retry a single permanently failed item.

### POST /api/review-queue/{log_id}/dismiss

Dismiss a failed item (marks it as `dismissed`).

### POST /api/review-queue/retry-all

Retry all permanently failed items for a given job.

**Query parameters:** `job_id` (required)

---

## Webhooks

### POST /api/webhooks/woocommerce

Receive WooCommerce webhook events. Verifies HMAC signature if `WC_WEBHOOK_SECRET` is configured.

**Headers:**

```
X-WC-Webhook-Signature: base64(HMAC-SHA256(body, secret))
X-WC-Webhook-Topic: product.updated
X-WC-Webhook-Source: https://shop.example.com
```

### POST /api/webhooks/odoo

Receive Odoo webhook events. Verifies HMAC signature if `ODOO_WEBHOOK_SECRET` is configured.

### GET /api/webhooks/health

Check webhook receiver health status.

---

## WebSocket

### WS /api/ws/sync?token=JWT

Real-time sync progress events. Connect with a JWT token in the query parameter.

**Connection:**

```javascript
const ws = new WebSocket(`ws://localhost:8000/api/ws/sync?token=${jwt}`);

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
  console.log(msg);
};
```

**Message types:**

```json
// Progress update
{
  "type": "sync_progress",
  "data": {
    "execution_id": 42,
    "phase": "products",
    "processed": 50,
    "total": 150,
    "current_product": "Blue Widget"
  }
}

// Completion
{
  "type": "sync_complete",
  "data": {
    "execution_id": 42,
    "created": 10,
    "updated": 40,
    "skipped": 100,
    "errors": 0
  }
}

// Error
{
  "type": "sync_error",
  "data": {
    "execution_id": 42,
    "product_name": "Red Widget",
    "error_message": "WooCommerce API returned 500"
  }
}

// Log
{
  "type": "sync_log",
  "data": {
    "execution_id": 42,
    "level": "info",
    "message": "Starting products phase"
  }
}
```

---

## Setup Wizard

### GET /api/setup/status

Check if first-run setup has been completed.

**Response (200):**

```json
{
  "is_first_run": true
}
```

### POST /api/setup/connection

Create a connection during the setup wizard.

**Request:**

```json
{
  "platform": "odoo",
  "name": "My Odoo",
  "config": {
    "url": "https://mycompany.odoo.com",
    "database": "prod",
    "username": "admin",
    "api_key": "..."
  }
}
```

### POST /api/setup/test-connection

Test a connection by its ID during setup.

**Request:**

```json
{
  "connection_id": 1
}
```

### POST /api/setup/first-job

Create a default sync job with sensible defaults (all core product fields, 6-hour interval).

**Request:**

```json
{
  "connection_id": 1,
  "direction": "odoo_to_wc"
}
```

**Response (201):**

```json
{
  "id": 1,
  "name": "Initial Product Sync",
  "direction": "odoo_to_wc",
  "connection_id": 1,
  "is_enabled": true
}
```

### POST /api/setup/complete

Mark setup as completed. Subsequent calls to `/api/setup/status` will return `is_first_run: false`.

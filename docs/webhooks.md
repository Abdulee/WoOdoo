# Webhooks

WoOdoo can receive webhooks from both WooCommerce and Odoo for near-instant sync triggers. Instead of waiting for the next scheduled sync, webhooks notify WoOdoo immediately when a product, order, or stock level changes.

## WooCommerce Webhooks

### Setup in WooCommerce

1. Go to **WooCommerce → Settings → Advanced → Webhooks**
2. Click **Add webhook**
3. Configure:

| Field | Value |
|-------|-------|
| Name | WoOdoo Product Sync |
| Status | Active |
| Topic | Product updated (or select specific events) |
| Delivery URL | `https://your-woodoo.com/api/webhooks/woocommerce` |
| Secret | A strong random string |

4. Click **Save webhook**

### Recommended Topics

Create separate webhooks for each event type you want to track:

| Topic | Trigger |
|-------|---------|
| Product created | New product added in WC |
| Product updated | Product edited in WC |
| Product deleted | Product removed from WC |
| Order created | New order placed |
| Order updated | Order status changed |

### Secret Configuration

Set the same secret in both WooCommerce and WoOdoo:

```env
# In your .env file
WC_WEBHOOK_SECRET=your-webhook-secret-here
```

WoOdoo verifies the webhook signature using HMAC-SHA256:

```
Expected: base64(HMAC-SHA256(request_body, WC_WEBHOOK_SECRET))
Received: X-WC-Webhook-Signature header
```

If the signature doesn't match, the webhook is rejected with `401 Unauthorized`.

### WooCommerce Headers

WoOdoo reads these headers from incoming WC webhooks:

| Header | Purpose |
|--------|---------|
| `X-WC-Webhook-Signature` | HMAC-SHA256 signature for verification |
| `X-WC-Webhook-Topic` | Event type (e.g., `product.updated`) |
| `X-WC-Webhook-Source` | Source WC store URL |

## Odoo Webhooks

Odoo doesn't have built-in webhooks, but you can create them using **Automation Rules** (formerly Automated Actions).

### Setup in Odoo 18

1. Go to **Settings → Technical → Automation → Automation Rules**
2. Click **Create**
3. Configure:

| Field | Value |
|-------|-------|
| Model | Product Template (`product.template`) |
| Trigger | When Updated (or When Created) |
| Before Update Filter | *(optional: specific fields)* |
| Action To Do | Execute Python Code |

4. In the **Python Code** tab, add:

```python
import json
import hmac
import hashlib
import base64
import requests

WOODOO_URL = "https://your-woodoo.com/api/webhooks/odoo"
SECRET = "your-odoo-webhook-secret"

payload = json.dumps({
    "model": "product.template",
    "event": "write",
    "ids": record.ids,
    "values": {
        "name": record.name,
        "list_price": record.list_price,
        "default_code": record.default_code,
    }
})

signature = base64.b64encode(
    hmac.new(SECRET.encode(), payload.encode(), hashlib.sha256).digest()
).decode()

try:
    requests.post(
        WOODOO_URL,
        data=payload,
        headers={
            "Content-Type": "application/json",
            "X-Odoo-Webhook-Signature": signature,
        },
        timeout=10,
    )
except Exception:
    pass  # Don't block the Odoo transaction
```

5. Click **Save**

### Recommended Automation Rules

| Model | Trigger | Description |
|-------|---------|-------------|
| `product.template` | When Updated | Product data changes |
| `product.template` | When Created | New products added |
| `product.product` | When Updated | Variant changes (price, SKU) |
| `stock.quant` | When Updated | Stock level changes |

### Secret Configuration

```env
# In your .env file
ODOO_WEBHOOK_SECRET=your-odoo-webhook-secret-here
```

## How Webhooks Are Processed

When WoOdoo receives a webhook:

1. **Verify signature** — HMAC-SHA256 check (if secret is configured)
2. **Parse payload** — Extract product/order IDs and event type
3. **Trigger sync** — Queue a targeted sync for the affected items only
4. **Anti-ping-pong** — The `sync_origin` is set to the source platform to prevent echo loops

### Webhook vs Scheduled Sync

| Feature | Webhook | Scheduled Sync |
|---------|---------|---------------|
| Latency | Near-instant (seconds) | Minutes to hours |
| Reliability | Depends on network | Guaranteed (Celery retry) |
| Coverage | Individual items | Full catalog scan |
| API usage | Minimal (only changed items) | Higher (scans everything) |

**Recommendation**: Use both. Webhooks for real-time updates, scheduled sync as a safety net to catch anything webhooks miss.

## Webhook Health

Check webhook status:

```bash
curl http://localhost:8000/api/webhooks/health \
  -H "Authorization: Bearer $TOKEN"
```

This returns the health status of the webhook receivers including the last received webhook timestamp and any configuration issues.

## Troubleshooting Webhooks

### WooCommerce webhook not delivering

1. Check WC webhook status — it may have been disabled after delivery failures
2. Verify the Delivery URL is reachable from the WC server
3. Check for SSL certificate issues (WC requires valid HTTPS in production)
4. Look at WC webhook logs: **WooCommerce → Status → Logs**

### Signature verification failing

1. Ensure `WC_WEBHOOK_SECRET` matches the secret in WC webhook settings exactly
2. Check for trailing whitespace in the secret
3. Verify the webhook is using the correct delivery URL

### Odoo automation rule not firing

1. Check the automation rule is enabled
2. Verify the trigger conditions match your use case
3. Check Odoo server logs for Python errors in the automation code
4. Ensure the Odoo server can reach the WoOdoo URL

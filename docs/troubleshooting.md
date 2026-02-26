# Troubleshooting

## Common Issues

### Services won't start

**Symptom:** `docker compose up` fails or containers keep restarting.

**Check:**

```bash
# See which services are unhealthy
docker compose ps

# Check service logs
docker compose logs app --tail 100
docker compose logs worker --tail 100
docker compose logs postgres --tail 50
```

**Common causes:**

- **Port conflict** — Another service is using port 5432, 6379, 8000, or 3000. Change the port in `.env`:
  ```env
  POSTGRES_PORT=5433
  BACKEND_PORT=8001
  ```

- **Missing `.env` file** — Copy from example:
  ```bash
  cp .env.example .env
  bash scripts/generate-keys.sh --write
  ```

- **Missing `FERNET_KEY`** — The backend won't start without a valid Fernet key:
  ```bash
  bash scripts/generate-keys.sh --write
  ```

### Cannot login

**Symptom:** Login returns "Invalid credentials" even with the correct password.

**Check:**

1. Verify `ADMIN_USERNAME` and `ADMIN_PASSWORD` in `.env`
2. The admin user is created on first startup. If you changed the password in `.env` after first startup, reset the database:
   ```bash
   docker compose down -v
   docker compose up -d
   ```
3. Check rate limiting — login is limited to 5 attempts/minute. Wait 60 seconds.

### Connection test fails

**Symptom:** "Test Connection" returns an error.

**Odoo connection errors:**

| Error | Cause | Fix |
|-------|-------|-----|
| Authentication failed | Wrong credentials | Verify username and API key in Odoo (Settings → Users → API Keys) |
| Connection refused | Odoo not reachable | Check URL is correct and accessible from the Docker network |
| SSL certificate verify failed | Self-signed cert | Use `http://` instead of `https://` for local instances |

**WooCommerce connection errors:**

| Error | Cause | Fix |
|-------|-------|-----|
| 401 Unauthorized | Wrong consumer key/secret | Regenerate WC API keys (WooCommerce → Settings → Advanced → REST API) |
| 404 Not Found | Wrong URL or API disabled | Ensure WC REST API v3 is enabled and URL is correct |
| Connection refused | Store not reachable | Check URL and ensure the store is accessible from Docker |

### Sync job shows no results

**Symptom:** Job runs but shows 0 created, 0 updated, 0 errors.

**Check:**

1. **No products in Odoo** — Verify Odoo has published product templates
2. **Filters too restrictive** — Check job filters. Use the Preview feature to see what would be synced
3. **All products already synced** — Delta detection via hashing means unchanged products are skipped. Check the "skipped" count

### Sync is slow

**Symptom:** Sync takes a very long time for a large catalog.

**Solutions:**

1. **Increase worker concurrency:**
   ```env
   CELERY_CONCURRENCY=8
   ```

2. **Image sync is typically the bottleneck.** Lower image concurrency if bandwidth is limited:
   ```env
   CELERY_IMAGE_CONCURRENCY=1
   ```

3. **Use filters** to sync only specific categories or products
4. **Check network latency** between WoOdoo and Odoo/WC (the `test-connection` endpoint reports latency)

### Products not matching

**Symptom:** Auto-match finds 0 matches.

**Check:**

1. Verify Odoo products have `barcode` (internal reference) set
2. Verify WC products have `sku` set
3. SKU and barcode must match exactly (case-sensitive)
4. Use the Explorer page to see unmatched products and link them manually

### Webhook not working

See the [Webhooks documentation](webhooks.md#troubleshooting-webhooks) for webhook-specific troubleshooting.

### Review Queue filling up

**Symptom:** Many items in `failed_permanent` status.

**Check the error details:**

1. Navigate to the Review Queue in the UI
2. Look at the `permanent_reason`:
   - `max_retries_exceeded` — The API call failed 3 times. Check the error message for details
   - `non_retryable_status_code` — HTTP 404 or 410, meaning the resource was deleted
3. Common causes:
   - **WC API rate limiting** — Reduce concurrency or add delays
   - **Product deleted on WC** — Dismiss the failed item
   - **Odoo access rights** — Ensure the API user has read access to `product.template`

## Debugging

### Check backend logs

```bash
# Live logs
docker compose logs -f app

# Worker logs (sync execution details)
docker compose logs -f worker

# Beat logs (scheduler)
docker compose logs -f beat
```

### Increase log verbosity

```env
LOG_LEVEL=DEBUG
```

Then restart:

```bash
docker compose restart app worker beat
```

### Check database directly

```bash
# Connect to PostgreSQL
docker compose exec postgres psql -U woodoo woodoo

# Check recent executions
SELECT id, job_id, status, started_at, completed_at, synced_count, error_count
FROM sync_executions ORDER BY started_at DESC LIMIT 10;

# Check failed items
SELECT id, execution_id, level, message, retry_count, status
FROM sync_logs WHERE status = 'failed_permanent' ORDER BY created_at DESC;

# Check product mappings
SELECT id, odoo_template_id, woo_product_id, sync_status, sync_origin, last_synced_at
FROM product_mappings ORDER BY last_synced_at DESC LIMIT 20;
```

### Check Celery worker status

```bash
# Ping workers
docker compose exec worker celery -A backend.celery_app inspect ping

# List active tasks
docker compose exec worker celery -A backend.celery_app inspect active

# List scheduled tasks
docker compose exec worker celery -A backend.celery_app inspect scheduled
```

### Test API directly

```bash
# Get auth token
TOKEN=$(curl -s -X POST http://localhost:8000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"changeme"}' | jq -r .access_token)

# Health check
curl http://localhost:8000/api/health

# List connections
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/connections

# List jobs
curl -H "Authorization: Bearer $TOKEN" http://localhost:8000/api/jobs
```

### Reset sync state

If you need to force a full re-sync (re-evaluate all products):

```sql
-- Clear all field hashes (forces re-computation)
UPDATE product_mappings SET field_hashes = '{}';

-- Or delete all mappings to start fresh
TRUNCATE product_mappings CASCADE;
TRUNCATE category_mappings CASCADE;
TRUNCATE image_mappings CASCADE;
```

Then trigger a manual sync run.

## Getting Help

1. Check the logs first (`docker compose logs`)
2. Review the [API Reference](api-reference.md) for expected request/response formats
3. Check the [Sync Engine](sync-engine.md) documentation for how sync works
4. Open an issue on GitHub with:
   - WoOdoo version
   - Odoo version
   - WooCommerce version
   - Relevant log output
   - Steps to reproduce

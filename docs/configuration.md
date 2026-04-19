# Configuration

Infrastructure/runtime configuration is done through environment variables. Copy `.env.example` to `.env` and edit the values.

Connection credentials for Odoo and WooCommerce are configured from the web UI (Setup Wizard or Connections page) after startup.

## Quick Setup Checklist

1. Copy `.env.example` to `.env`
2. Run `bash scripts/generate-keys.sh --write`
3. Set `ADMIN_PASSWORD` to a strong password
4. Start services with `docker compose up -d`
5. Open `http://localhost:3000` and complete Setup Wizard

## How to Obtain Connection Credentials

### Odoo API key

1. Log in to Odoo with an admin or integration user
2. Open user preferences/profile settings
3. Navigate to API keys
4. Create a new API key for WoOdoo integration
5. Copy and store the generated key securely

You will use these values in WoOdoo:
- Odoo URL
- Database name
- Username
- API key

### WooCommerce REST API keys

1. In WordPress admin, go to WooCommerce → Settings → Advanced → REST API
2. Add key
3. Set permissions to Read/Write
4. Generate key
5. Copy Consumer Key and Consumer Secret

You will use these values in WoOdoo:
- Store URL
- Consumer key
- Consumer secret

## Environment Variables

### Database (PostgreSQL)

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_USER` | `woodoo` | PostgreSQL superuser name |
| `POSTGRES_PASSWORD` | `woodoo` | PostgreSQL superuser password |
| `POSTGRES_DB` | `woodoo` | Database name |
| `POSTGRES_PORT` | `5432` | Host port mapping for PostgreSQL |
| `DATABASE_URL` | `postgresql+asyncpg://woodoo:woodoo@postgres:5432/woodoo` | Full async connection string (SQLAlchemy format) |

> **Note**: In Docker Compose, the hostname is the service name (`postgres`). For local development outside Docker, use `localhost`.

### Redis

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | `redis://redis:6379/0` | Redis connection URL (Celery broker + pub/sub) |
| `REDIS_PORT` | `6379` | Host port mapping for Redis |

### Authentication & Security

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | `your-secret-key-change-in-production` | JWT signing key. **Generate with** `bash scripts/generate-keys.sh` |
| `FERNET_KEY` | *(empty)* | Fernet encryption key for stored credentials. **Generate with** `bash scripts/generate-keys.sh` |
| `ADMIN_USERNAME` | `admin` | Default admin username (created on first startup) |
| `ADMIN_PASSWORD` | `changeme` | Default admin password. **Change in production!** |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` | JWT token lifetime in minutes (default: 24 hours) |

### Celery Workers

| Variable | Default | Description |
|----------|---------|-------------|
| `CELERY_CONCURRENCY` | `4` | Number of concurrent worker processes for the default task queue |
| `CELERY_IMAGE_CONCURRENCY` | `2` | Number of concurrent image sync workers (lower = less bandwidth) |

### Application

| Variable | Default | Description |
|----------|---------|-------------|
| `ENVIRONMENT` | `development` | Application environment: `development`, `staging`, `production` |
| `LOG_LEVEL` | `INFO` | Logging level: `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL` |

### Ports

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKEND_PORT` | `8000` | Host port for the FastAPI backend |
| `FRONTEND_PORT` | `3000` | Host port for the Next.js frontend |

### Frontend

| Variable | Default | Description |
|----------|---------|-------------|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000` | Backend API URL (must be reachable from the browser) |
| `NEXT_PUBLIC_WS_URL` | `ws://localhost:8000` | WebSocket URL for real-time sync progress |

### Webhooks (Optional)

| Variable | Default | Description |
|----------|---------|-------------|
| `WC_WEBHOOK_SECRET` | *(not set)* | WooCommerce webhook HMAC secret |
| `ODOO_WEBHOOK_SECRET` | *(not set)* | Odoo webhook HMAC secret |

## Generating Keys

Use the included script to generate `SECRET_KEY` and `FERNET_KEY`:

```bash
# Print keys to stdout
bash scripts/generate-keys.sh

# Write keys directly to .env
bash scripts/generate-keys.sh --write
```

Or generate manually:

```bash
# SECRET_KEY (32-byte hex)
python3 -c "import secrets; print(secrets.token_hex(32))"

# FERNET_KEY (base64-encoded)
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

## Connection Configuration

Connections are configured through the UI (Settings or Setup Wizard), not through environment variables. Credentials are encrypted with Fernet before storage.

### Odoo Connection

| Field | Description | Example |
|-------|-------------|---------|
| `url` | Odoo instance URL | `https://mycompany.odoo.com` |
| `database` | Odoo database name | `mycompany-production` |
| `username` | Odoo user login | `admin` |
| `api_key` | Odoo API key (Settings → API Keys) | `abc123...` |

### WooCommerce Connection

| Field | Description | Example |
|-------|-------------|---------|
| `url` | WordPress/WooCommerce site URL | `https://shop.example.com` |
| `consumer_key` | WC REST API consumer key | `ck_abc123...` |
| `consumer_secret` | WC REST API consumer secret | `cs_def456...` |
| `version` | WC API version (default: `wc/v3`) | `wc/v3` |

## Job Configuration

Jobs are configured through the UI Job Builder. Each job has:

### Schedule Config

```json
// Cron-based (5-field cron expression)
{
  "type": "cron",
  "cron_expression": "0 */6 * * *"
}

// Interval-based
{
  "type": "interval",
  "interval_seconds": 21600
}
```

### Field Mappings

```json
[
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
  },
  {
    "odoo_field": "default_code",
    "wc_field": "sku",
    "direction": "odoo_to_wc",
    "enabled": true
  }
]
```

Direction options:
- `odoo_to_wc` — Odoo is the source of truth
- `wc_to_odoo` — WooCommerce is the source of truth
- `bidirectional` — Sync in both directions
- `skip` — Field is excluded from sync

### Lifecycle Config

```json
{
  "on_new_source": "create",      // or "flag"
  "on_deleted_source": "archive"  // or "delete", "flag", "ignore"
}
```

### Filters

```json
[
  {
    "field": "categ_id",
    "operator": "=",
    "value": 5
  }
]
```

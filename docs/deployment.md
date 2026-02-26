# Deployment

## Docker Compose (Recommended)

WoOdoo ships with a production-ready Docker Compose configuration that runs all 6 services.

### Prerequisites

- Docker Engine 24+
- Docker Compose v2
- 2 GB RAM minimum (4 GB recommended)
- Python 3.12+ (only needed for key generation)

### Step-by-Step

#### 1. Clone the repository

```bash
git clone https://github.com/your-org/woodoo.git
cd woodoo
```

#### 2. Generate secrets

```bash
bash scripts/generate-keys.sh --write
```

This creates/updates your `.env` file with:
- `SECRET_KEY` — 32-byte hex string for JWT signing
- `FERNET_KEY` — Base64-encoded key for credential encryption

#### 3. Configure environment

```bash
cp .env.example .env
# Then edit .env with your values
```

**Required changes for production:**

```env
# SECURITY — change these immediately
ADMIN_PASSWORD=your-strong-password
SECRET_KEY=<generated-by-script>
FERNET_KEY=<generated-by-script>

# DATABASE
POSTGRES_PASSWORD=strong-db-password

# ENVIRONMENT
ENVIRONMENT=production
```

See [Configuration](configuration.md) for all available environment variables.

#### 4. Start services

```bash
docker compose up -d
```

#### 5. Verify

```bash
# Check all containers are running and healthy
docker compose ps

# Check backend health
curl http://localhost:8000/api/health

# Check logs for any errors
docker compose logs app --tail 50
docker compose logs worker --tail 50
```

### Service Dependencies

Services start in dependency order with health checks:

```
postgres (healthy) ──┐
                     ├── app (healthy) ──┐
redis (healthy) ─────┤                   ├── frontend
                     ├── worker          │
                     └── beat            │
                                         └── (ready)
```

The `app` container waits for both `postgres` and `redis` to be healthy before starting. The `worker` waits for `app`, `postgres`, and `redis`. The `frontend` waits for `app`.

### Updating

```bash
git pull
docker compose build
docker compose up -d
```

Database migrations run automatically on backend startup via Alembic.

### Stopping

```bash
# Stop all services
docker compose down

# Stop and remove volumes (WARNING: deletes all data)
docker compose down -v
```

## Production Configuration

### Reverse Proxy (Nginx)

For production, place Nginx in front of WoOdoo:

```nginx
upstream woodoo_backend {
    server 127.0.0.1:8000;
}

upstream woodoo_frontend {
    server 127.0.0.1:3000;
}

server {
    listen 443 ssl http2;
    server_name woodoo.example.com;

    ssl_certificate     /etc/ssl/certs/woodoo.crt;
    ssl_certificate_key /etc/ssl/private/woodoo.key;

    # Frontend
    location / {
        proxy_pass http://woodoo_frontend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Backend API
    location /api/ {
        proxy_pass http://woodoo_backend;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # WebSocket
    location /api/ws/ {
        proxy_pass http://woodoo_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
}
```

Update your `.env` to match:

```env
NEXT_PUBLIC_API_URL=https://woodoo.example.com
NEXT_PUBLIC_WS_URL=wss://woodoo.example.com
```

### PostgreSQL Tuning

For larger catalogs (10,000+ products), consider tuning PostgreSQL:

```yaml
# docker-compose.override.yml
services:
  postgres:
    command: >
      postgres
      -c shared_buffers=256MB
      -c effective_cache_size=768MB
      -c work_mem=4MB
      -c max_connections=100
```

### Worker Scaling

Adjust Celery concurrency based on your sync volume:

```env
# Default task workers (product/category/stock sync)
CELERY_CONCURRENCY=4

# Image sync workers (lower = less bandwidth pressure)
CELERY_IMAGE_CONCURRENCY=2
```

For very large catalogs, you can run multiple worker containers:

```yaml
# docker-compose.override.yml
services:
  worker-2:
    extends:
      service: worker
    container_name: woodoo-worker-2
```

### Backups

Back up the PostgreSQL database regularly:

```bash
# Dump database
docker compose exec postgres pg_dump -U woodoo woodoo > backup_$(date +%Y%m%d).sql

# Restore
docker compose exec -T postgres psql -U woodoo woodoo < backup_20250101.sql
```

### Logging

All services log to stdout/stderr. Use Docker's logging drivers for production:

```yaml
# docker-compose.override.yml
services:
  app:
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
```

Set the log level via environment:

```env
LOG_LEVEL=WARNING  # Less verbose in production
```

## Resource Requirements

| Catalog Size | RAM | CPU | Disk |
|-------------|-----|-----|------|
| < 1,000 products | 2 GB | 2 cores | 5 GB |
| 1,000–10,000 | 4 GB | 4 cores | 10 GB |
| 10,000+ | 8 GB | 4+ cores | 20 GB |

Image sync is the most resource-intensive operation (downloads from Odoo, uploads to WordPress). Adjust `CELERY_IMAGE_CONCURRENCY` accordingly.

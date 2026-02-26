# Architecture

WoOdoo is a full-stack application with a clear separation between the API layer, task processing, and the frontend.

## System Overview

```
                        Browser (Next.js)
                             │
                     ┌───────┴───────┐
                     │   Frontend    │  :3000
                     │   (Next.js)   │
                     └───────┬───────┘
                             │ HTTP + WebSocket
                     ┌───────┴───────┐
                     │   Backend     │  :8000
                     │   (FastAPI)   │
                     └──┬────┬────┬──┘
                        │    │    │
               ┌────────┘    │    └────────┐
               ▼             ▼             ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │PostgreSQL│  │  Redis   │  │  Celery   │
        │   :5432  │  │  :6379   │  │ Workers   │
        └──────────┘  └──────────┘  └─────┬─────┘
                                          │
                                    ┌─────┴─────┐
                                    │  Celery   │
                                    │   Beat    │
                                    └───────────┘
```

## Services

WoOdoo runs as 6 Docker containers:

| Service | Image | Role |
|---------|-------|------|
| **postgres** | `postgres:16-alpine` | Primary data store — connections, jobs, mappings, logs |
| **redis** | `redis:7-alpine` | Celery task broker, pub/sub for WebSocket events |
| **app** | Custom (FastAPI) | REST API, WebSocket endpoint, database migrations |
| **worker** | Same image as app | Celery worker that executes sync tasks |
| **beat** | Same image as app | Celery Beat scheduler that triggers jobs on schedule |
| **frontend** | Custom (Next.js) | Web UI served via Next.js |

## Backend Architecture

### Request Flow

```
HTTP Request → FastAPI Router → Pydantic Validation → Service Layer → Database (SQLAlchemy)
                                                           │
                                                    (if async task)
                                                           │
                                                    Celery Task Queue
                                                           │
                                                    Worker → Sync Engine
                                                           │
                                                    Redis Pub/Sub → WebSocket
```

### Layer Breakdown

**Routers** (`backend/auth/`, `backend/api/`, `backend/jobs/`, etc.)
- FastAPI route definitions
- Request validation via Pydantic models
- JWT authentication via `get_current_user` dependency

**Services** (`backend/jobs/service.py`, `backend/auth/service.py`)
- Business logic layer
- Database operations via SQLAlchemy async sessions
- Decoupled from HTTP layer

**Sync Engines** (`backend/sync/engines/`)
- `categories.py` — Category sync with topological sorting
- `products.py` — Product sync (simple + variable) with field-level hashing
- `images.py` — Image sync via WordPress Media Library
- `stock.py` — Stock level sync (Odoo-authoritative, batch API)

**Task System** (`backend/tasks/`)
- `orchestrator.py` — Main Celery task: runs phases in strict order (categories → products → images → stock)
- `phase_runner.py` — Generic phase executor with error handling and progress publishing
- `scheduler.py` — Celery Beat schedule management (register/remove jobs)
- `retry.py` — Exponential backoff retry engine (30s → 120s → 300s, max 3 retries)

**Clients** (`backend/clients/`)
- `odoo.py` — **Synchronous** XML-RPC client for Odoo 18 (`xmlrpc.client`)
- `woocommerce.py` — **Async** REST client for WooCommerce v3 API (`httpx`)
- `wordpress.py` — **Async** REST client for WordPress Media Library (`httpx`)

**WebSocket** (`backend/ws/`)
- `router.py` — WebSocket endpoint at `/api/ws/sync?token=JWT`
- `manager.py` — Connection manager (connect/disconnect/broadcast)
- `publisher.py` — Redis pub/sub publisher for sync progress events

### Database Schema

WoOdoo uses 10 database tables:

| Table | Purpose |
|-------|---------|
| `connections` | Odoo/WooCommerce connection credentials (Fernet encrypted) |
| `sync_jobs` | Job definitions with field mappings, filters, schedule config |
| `sync_executions` | Execution records with status, timing, and counters |
| `sync_logs` | Per-item sync logs with error details and retry counts |
| `product_mappings` | Odoo ↔ WC product ID links with field hashes and sync status |
| `category_mappings` | Odoo ↔ WC category ID links |
| `attribute_mappings` | Odoo ↔ WC attribute ID links |
| `image_mappings` | Product image links with SHA-256 hashes and WP media IDs |
| `order_mappings` | WC order ↔ Odoo sale order links |
| `settings` | Key-value configuration store (e.g., `setup_completed`) |

### Key Enums

| Enum | Values | Used By |
|------|--------|---------|
| `PlatformEnum` | `odoo`, `woocommerce` | Connection |
| `ConnectionStatusEnum` | `active`, `inactive`, `degraded` | Connection |
| `SyncDirectionEnum` | `odoo_to_wc`, `wc_to_odoo`, `bidirectional` | SyncJob |
| `SyncStatusEnum` | `synced`, `pending`, `failed`, `review`, `failed_permanent`, `dismissed` | ProductMapping, SyncLog |
| `ExecutionStatusEnum` | `running`, `completed`, `failed`, `cancelled` | SyncExecution |
| `LogLevelEnum` | `info`, `warning`, `error` | SyncLog |

## Frontend Architecture

The frontend is a Next.js 16 application using the App Router:

```
frontend/src/app/
├── page.tsx              # Dashboard
├── layout.tsx            # Root layout with sidebar navigation
├── connections/page.tsx  # Connection management
├── jobs/
│   ├── page.tsx          # Job listing
│   ├── new/page.tsx      # Create new job
│   └── [id]/edit/page.tsx # Edit existing job
├── explorer/page.tsx     # Product matching explorer
├── logs/page.tsx         # Execution logs viewer
├── orders/page.tsx       # Order sync management
├── settings/page.tsx     # Application settings
└── setup/page.tsx        # First-run setup wizard
```

The frontend communicates with the backend via:
- **REST API** — All CRUD operations via `NEXT_PUBLIC_API_URL`
- **WebSocket** — Real-time sync progress via `NEXT_PUBLIC_WS_URL`

## Data Flow: Sync Execution

```
1. Trigger (manual or Beat schedule)
       │
2. Create SyncExecution (status=RUNNING)
       │
3. Acquire PostgreSQL advisory lock (prevents concurrent runs for same job)
       │
4. Execute phases in strict order:
       │
   ┌───┴───────────────────────────────────┐
   │ a. Categories (topological sort)      │
   │ b. Products (simple + variable)       │
   │ c. Images (WordPress Media Library)   │
   │ d. Stock (batch update)               │
   └───┬───────────────────────────────────┘
       │
5. Each phase:
   - Fetches source data
   - Computes field hashes
   - Compares with stored hashes (delta detection)
   - Creates/updates only changed items
   - Publishes progress via Redis → WebSocket
       │
6. Mark execution COMPLETED (or FAILED)
```

## Security

- **JWT authentication** on all API endpoints (except health check)
- **Fernet encryption** for stored connection credentials
- **bcrypt** password hashing for admin user
- **Rate limiting** on login endpoint (5 attempts/minute via SlowAPI)
- **HMAC verification** on incoming webhooks
- **PostgreSQL advisory locks** to prevent concurrent job execution
- **WebSocket auth** via JWT token in query parameter

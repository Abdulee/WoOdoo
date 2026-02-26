# Development

Guide for setting up a local development environment, running tests, and contributing to WoOdoo.

## Prerequisites

- Python 3.12+
- Node.js 20+ and npm
- Docker and Docker Compose (for PostgreSQL and Redis)
- Git

## Project Structure

```
woodoo/
├── backend/                    # Python/FastAPI backend
│   ├── main.py                 # FastAPI app entry point (registers all routers)
│   ├── celery_app.py           # Celery app singleton (DO NOT MODIFY)
│   ├── pyproject.toml          # Python dependencies and project config
│   ├── auth/                   # Authentication (JWT, bcrypt, rate limiting)
│   │   ├── router.py           # /api/auth/* endpoints
│   │   ├── service.py          # Auth business logic
│   │   └── dependencies.py     # get_current_user dependency
│   ├── api/                    # Connection CRUD
│   │   └── connections.py      # /api/connections/* endpoints + test helpers
│   ├── jobs/                   # Sync job management
│   │   ├── router.py           # /api/jobs/* endpoints
│   │   ├── service.py          # Job CRUD + trigger_execution
│   │   └── schemas.py          # Pydantic models (JobCreate, FieldMappingRule, etc.)
│   ├── clients/                # External system clients
│   │   ├── odoo.py             # SYNCHRONOUS XML-RPC client
│   │   ├── woocommerce.py      # ASYNC REST client (httpx)
│   │   └── wordpress.py        # ASYNC REST client for Media Library
│   ├── sync/                   # Sync engine
│   │   ├── engines/            # Per-entity sync logic
│   │   │   ├── categories.py   # Category sync (topological sort)
│   │   │   ├── products.py     # Product sync (simple + variable)
│   │   │   ├── images.py       # Image sync (WordPress Media Library)
│   │   │   └── stock.py        # Stock sync (Odoo → WC, batch API)
│   │   ├── hashing.py          # SHA-256 field-level hashing + anti-ping-pong
│   │   └── mappings.py         # Mapping CRUD (product_mappings table)
│   ├── tasks/                  # Celery task system
│   │   ├── orchestrator.py     # Main sync task (phase pipeline)
│   │   ├── phase_runner.py     # Generic phase executor
│   │   ├── scheduler.py        # Celery Beat schedule management
│   │   └── retry.py            # Exponential backoff retry engine
│   ├── webhooks/               # Webhook receivers
│   │   └── router.py           # /api/webhooks/* endpoints
│   ├── orders/                 # Order sync
│   │   └── router.py           # /api/orders/* endpoints
│   ├── matching/               # Product matching
│   │   └── router.py           # /api/matching/* endpoints
│   ├── connections/            # Connection health monitoring
│   │   ├── health.py           # Health check logic
│   │   └── health_router.py    # /api/health/* endpoints
│   ├── setup/                  # Setup wizard
│   │   └── router.py           # /api/setup/* endpoints
│   ├── ws/                     # WebSocket
│   │   ├── router.py           # WS /api/ws/sync endpoint
│   │   ├── manager.py          # Connection manager
│   │   └── publisher.py        # Redis pub/sub publisher
│   ├── core/                   # Core config
│   │   ├── config.py           # Settings (pydantic-settings)
│   │   └── crypto.py           # Fernet encrypt/decrypt
│   ├── models/                 # Database
│   │   ├── orm.py              # SQLAlchemy 2.0 models (10 tables)
│   │   └── database.py         # Engine, session factory, Base
│   └── schemas/                # Shared Pydantic schemas
│       └── connections.py      # Connection request/response models
├── frontend/                   # Next.js 16 frontend
│   ├── src/app/                # App Router pages
│   ├── types/api.ts            # TypeScript API types
│   ├── package.json            # Node dependencies
│   ├── tsconfig.json           # TypeScript config
│   └── Dockerfile              # Frontend Docker image
├── alembic/                    # Database migrations
│   ├── alembic.ini
│   └── versions/               # Migration files
├── docker/
│   └── Dockerfile              # Backend Docker image
├── scripts/
│   └── generate-keys.sh        # Key generation utility
├── tests/                      # Test suite
│   ├── conftest.py             # Shared fixtures
│   └── ...                     # Test files
├── docker-compose.yml          # All 6 services
├── .env.example                # Environment template
└── README.md                   # Project overview
```

## Local Development Setup

### 1. Start infrastructure services

```bash
# Start only PostgreSQL and Redis
docker compose up -d postgres redis
```

### 2. Backend setup

```bash
# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate

# Install dependencies (including dev tools)
pip install -e "backend[dev]"

# Copy and configure environment
cp .env.example .env
bash scripts/generate-keys.sh --write

# Update DATABASE_URL for local development (not Docker hostname)
# Edit .env: DATABASE_URL=postgresql+asyncpg://woodoo:woodoo@localhost:5432/woodoo
# Edit .env: REDIS_URL=redis://localhost:6379/0

# Run backend
uvicorn backend.main:app --reload --port 8000
```

### 3. Celery worker (in a separate terminal)

```bash
source .venv/bin/activate
celery -A backend.celery_app worker --loglevel=debug
```

### 4. Celery Beat (in a separate terminal)

```bash
source .venv/bin/activate
celery -A backend.celery_app beat --loglevel=debug
```

### 5. Frontend setup

```bash
cd frontend

# Install dependencies
npm install

# Run development server
npm run dev
```

The frontend will be available at `http://localhost:3000`.

## Running Tests

### Backend Tests

WoOdoo has 288 tests covering all backend functionality.

```bash
# Run all tests
pytest

# Run with coverage
pytest --cov=backend --cov-report=html

# Run specific test file
pytest tests/test_hashing.py

# Run tests matching a pattern
pytest -k "test_sync_products"

# Run with verbose output
pytest -v
```

**Important test notes:**

- Tests use SQLite (in-memory), not PostgreSQL
- All async tests must be decorated with `@pytest.mark.asyncio` (strict mode)
- The OdooClient is synchronous — never `await` it in tests; wrap in `asyncio.to_thread()` for async contexts
- The WooCommerceClient is async — always `await` its methods

### Frontend Type Checking

```bash
cd frontend
npx tsc --noEmit
```

### Linting

```bash
# Python
black backend/ --check
isort backend/ --check
flake8 backend/

# TypeScript
cd frontend && npx tsc --noEmit
```

## Key Design Decisions

### OdooClient is Synchronous

The Odoo XML-RPC client (`backend/clients/odoo.py`) uses Python's built-in `xmlrpc.client`, which is synchronous. In async contexts (FastAPI endpoints, async tests), wrap calls in `asyncio.to_thread()`:

```python
# WRONG
products = await odoo_client.get_product_templates()

# CORRECT
products = odoo_client.get_product_templates()  # Sync call

# In async context
products = await asyncio.to_thread(odoo_client.get_product_templates)
```

### WooCommerceClient is Async

The WC client uses `httpx.AsyncClient` and must always be awaited:

```python
product = await wc_client.create_product(data)
```

### Celery Tasks are Synchronous

Celery tasks use `asyncio.run()` internally to run async code:

```python
@celery_app.task(bind=True)
def execute_sync_job(self, execution_id: int):
    asyncio.run(_run_sync_pipeline(execution_id))
```

### JSON Instead of JSONB

The ORM uses `JSON` (not `JSONB`) for SQLite compatibility in tests. This means:
- No PostgreSQL-specific JSON operators in queries
- JSON columns are still fully functional in PostgreSQL

### celery_app.py is Root — Do Not Modify

`backend/celery_app.py` is the Celery app singleton. It's imported by multiple modules. Avoid modifying it.

## Adding a New Sync Engine

1. Create `backend/sync/engines/your_entity.py`:

```python
from dataclasses import dataclass, field

@dataclass
class SyncResult:
    created: int = 0
    updated: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)

async def sync_your_entity(db, odoo_client, wc_client, **kwargs) -> SyncResult:
    result = SyncResult()
    # Your sync logic here
    return result
```

2. Add the phase to `backend/tasks/orchestrator.py` in `_run_sync_pipeline()`

3. Add a mapping model to `backend/models/orm.py` if needed

4. Create an Alembic migration:
   ```bash
   alembic revision --autogenerate -m "Add your_entity_mappings table"
   alembic upgrade head
   ```

5. Add tests in `tests/`

## Adding a New API Endpoint

1. Create a new router file (e.g., `backend/your_feature/router.py`):

```python
from fastapi import APIRouter, Depends
from backend.auth.dependencies import get_current_user

router = APIRouter(prefix="/your-feature", tags=["your-feature"])

@router.get("")
async def list_items(current_user: dict = Depends(get_current_user)):
    return []
```

2. Register it in `backend/main.py`:

```python
from backend.your_feature.router import router as your_feature_router
app.include_router(your_feature_router, prefix="/api")
```

3. Add Pydantic schemas in `backend/your_feature/schemas.py`

4. Add tests

## Database Migrations

WoOdoo uses Alembic for database migrations:

```bash
# Create a new migration
alembic revision --autogenerate -m "Description of changes"

# Apply all pending migrations
alembic upgrade head

# Rollback one migration
alembic downgrade -1

# Check current migration status
alembic current
```

Migrations run automatically on backend startup in Docker.

## Environment Variables for Development

Override these in your local `.env` for development outside Docker:

```env
DATABASE_URL=postgresql+asyncpg://woodoo:woodoo@localhost:5432/woodoo
REDIS_URL=redis://localhost:6379/0
ENVIRONMENT=development
LOG_LEVEL=DEBUG
```

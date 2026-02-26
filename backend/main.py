"""FastAPI application entry point"""

import asyncio
from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
import asyncpg
from celery.app.control import Inspect

from backend.core.config import settings
from backend.auth import router as auth_router, JWTMiddleware, initialize_admin_user
from backend.auth.router import limiter
from backend.models.database import init_db
from backend.api import connections_router
from backend.jobs import jobs_router
from backend.ws import ws_router
from backend.webhooks import webhooks_router
from backend.orders import orders_router
from backend.tasks.review_queue import review_router
from backend.matching import matching_router
from backend.setup.router import router as setup_router
from backend.connections.health_router import health_router

logger = logging.getLogger(__name__)

# Global state for connections
_db_pool = None
_redis_client = None


async def get_db_pool():
    """Get or create database connection pool"""
    global _db_pool
    if _db_pool is None:
        _db_pool = await asyncpg.create_pool(
            settings.database_url.replace("postgresql+asyncpg://", "postgresql://"),
            min_size=5,
            max_size=20,
        )
    return _db_pool


async def get_redis_client():
    """Get or create Redis client"""
    global _redis_client
    if _redis_client is None:
        try:
            import redis.asyncio as redis
            _redis_client = redis.from_url(settings.redis_url, decode_responses=True)
            await _redis_client.ping()
        except Exception as e:
            logger.warning(f"Redis not available: {e}")
            _redis_client = None
    return _redis_client


async def check_database():
    """Check database connection"""
    try:
        pool = await get_db_pool()
        async with pool.acquire() as conn:
            await conn.fetchval("SELECT 1")
        return True
    except Exception as e:
        logger.error(f"Database check failed: {e}")
        return False


async def check_redis():
    """Check Redis connection"""
    try:
        client = await get_redis_client()
        if client is None:
            return False
        await client.ping()
        return True
    except Exception as e:
        logger.error(f"Redis check failed: {e}")
        return False


async def check_celery():
    """Check Celery workers"""
    try:
        from backend.celery_app import celery_app
        
        inspect = Inspect(app=celery_app)
        stats = await asyncio.to_thread(inspect.stats)
        
        if stats:
            return True
        return False
    except Exception as e:
        logger.error(f"Celery check failed: {e}")
        return False


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Lifespan context manager for startup and shutdown"""
    # Startup
    logger.info("Starting up WoOdoo application")
    try:
        # Initialize database
        await init_db(settings.database_url)
        
        # Create tables
        from backend.models.database import create_tables
        await create_tables()
        
        # Initialize admin user
        from backend.models.database import _async_session_factory
        if _async_session_factory:
            async with _async_session_factory() as db:
                await initialize_admin_user(db)
        
        await get_db_pool()
        await get_redis_client()
        logger.info("Database and Redis connections established")
    except Exception as e:
        logger.error(f"Failed to establish connections: {e}")
    
    yield
    
    # Shutdown
    logger.info("Shutting down WoOdoo application")
    global _db_pool, _redis_client
    
    if _db_pool:
        await _db_pool.close()
        _db_pool = None
    
    if _redis_client:
        try:
            await _redis_client.close()
        except Exception:
            pass
        _redis_client = None


# Create FastAPI app
app = FastAPI(
    title="WoOdoo",
    description="Odoo ↔ WooCommerce Synchronization Platform",
    version="0.1.0",
    lifespan=lifespan,
)

# Add CORS middleware (allow all origins in development)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Add JWT authentication middleware
app.add_middleware(JWTMiddleware)

# Add rate limiting
app.state.limiter = limiter
async def rate_limit_handler(request, exc):
    from starlette.responses import JSONResponse
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many requests. Rate limit exceeded."},
    )

app.add_exception_handler(RateLimitExceeded, rate_limit_handler)


@app.get("/api/health")
async def health_check():
    """
    Health check endpoint that reports status of all services.
    Gracefully degrades if services are unavailable.
    """
    db_status = "connected" if await check_database() else "disconnected"
    redis_status = "connected" if await check_redis() else "disconnected"
    celery_status = "workers_active" if await check_celery() else "no_workers"
    
    return {
        "status": "ok",
        "database": db_status,
        "redis": redis_status,
        "celery": celery_status,
    }


# Include auth routes
app.include_router(auth_router)

# Include connections routes
app.include_router(connections_router, prefix="/api")

# Include jobs routes
app.include_router(jobs_router, prefix="/api")

# Include WebSocket routes
app.include_router(ws_router, prefix="/api")

# Include webhooks routes
app.include_router(webhooks_router, prefix="/api")

# Include review queue routes
app.include_router(review_router, prefix="/api")

# Include orders routes
app.include_router(orders_router, prefix="/api")

# Include matching routes
app.include_router(matching_router, prefix="/api")

# Include setup wizard routes
app.include_router(setup_router, prefix="/api")

# Include connection health routes
app.include_router(health_router, prefix="/api")

if __name__ == "__main__":
    import uvicorn
    
    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
    )

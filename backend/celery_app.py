"""Celery application configuration"""

from celery import Celery
from backend.core.config import settings

# Initialize Celery app
celery_app = Celery(
    "woodoo",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

# Auto-discover tasks from all registered apps
celery_app.autodiscover_tasks(["backend"])

# Configuration
celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
)

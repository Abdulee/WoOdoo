"""Celery application configuration for the WoOdoo task orchestration layer.

This module defines a SEPARATE Celery app from backend/celery_app.py.
It configures two queues:
  - default: data sync tasks (categories, products, stock)
  - image_sync: lower concurrency for image uploads
"""

from celery import Celery
from backend.core.config import settings

celery_app = Celery(
    "woodoo_tasks",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_routes={
        "backend.tasks.orchestrator.execute_sync_job": {"queue": "default"},
        "backend.tasks.orchestrator.run_image_phase": {"queue": "image_sync"},
    },
    task_soft_time_limit=600,   # 10 min soft limit
    task_time_limit=660,         # 11 min hard kill
    task_acks_late=True,
    worker_prefetch_multiplier=1,
)

from celery import Celery

from backend.app.core.config import settings

celery_app = Celery(
    "opensupport",
    broker=settings.redis_url,
    backend=settings.redis_url,
    include=["backend.app.workers.tasks"],
)
celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    task_track_started=True,
    broker_connection_retry_on_startup=True,
    beat_schedule={
        "sweep-webhook-outbox-every-minute": {
            "task": "opensupport.sweep_webhook_deliveries",
            "schedule": 60.0,
        },
    },
)

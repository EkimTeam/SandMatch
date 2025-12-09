"""
Celery configuration for SandMatch project.
"""
import os
from celery import Celery
from celery.schedules import crontab

# Set default Django settings module
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'sandmatch.settings.local')

app = Celery('sandmatch')

# Load config from Django settings with CELERY_ prefix
app.config_from_object('django.conf:settings', namespace='CELERY')

# Auto-discover tasks in all installed apps
app.autodiscover_tasks()

# Периодические задачи
app.conf.beat_schedule = {
    # Проверка предстоящих турниров каждый час
    'check-upcoming-tournaments': {
        'task': 'apps.telegram_bot.tasks.check_upcoming_tournaments',
        'schedule': crontab(minute=0),  # Каждый час в 00 минут
    },
    # Очистка старых логов уведомлений раз в день в 3:00
    'cleanup-old-notifications': {
        'task': 'apps.telegram_bot.tasks.cleanup_old_notifications',
        'schedule': crontab(hour=3, minute=0),
    },
}


@app.task(bind=True, ignore_result=True)
def debug_task(self):
    """Debug task for testing Celery"""
    print(f'Request: {self.request!r}')

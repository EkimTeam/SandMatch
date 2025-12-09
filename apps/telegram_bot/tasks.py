"""
Celery задачи для Telegram бота
"""
from celery import shared_task
from django.utils import timezone


@shared_task
def send_tournament_notification(tournament_id, notification_type):
    """
    Отправка уведомлений о турнире
    
    Args:
        tournament_id: ID турнира
        notification_type: тип уведомления (tournament_open, tournament_start и т.д.)
    """
    # TODO: Реализовать после настройки бота
    pass


@shared_task
def send_match_notification(match_id, notification_type):
    """
    Отправка уведомлений о матче
    
    Args:
        match_id: ID матча
        notification_type: тип уведомления (match_start, match_result)
    """
    # TODO: Реализовать после настройки бота
    pass


@shared_task
def send_pair_request_notification(pair_request_id):
    """
    Отправка уведомления о запросе на пару
    
    Args:
        pair_request_id: ID запроса на пару
    """
    # TODO: Реализовать после настройки бота
    pass


@shared_task
def cleanup_old_notifications():
    """
    Очистка старых логов уведомлений (старше 30 дней)
    """
    from apps.telegram_bot.models import NotificationLog
    from datetime import timedelta
    
    threshold = timezone.now() - timedelta(days=30)
    deleted_count, _ = NotificationLog.objects.filter(sent_at__lt=threshold).delete()
    
    return f"Удалено {deleted_count} старых уведомлений"

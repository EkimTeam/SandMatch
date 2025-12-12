"""
Celery задачи для Telegram бота
"""
import asyncio
import logging
from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task
def send_new_tournament_notification(tournament_id):
    """
    Отправка уведомлений о новом турнире
    
    Args:
        tournament_id: ID турнира
    """
    from apps.tournaments.models import Tournament
    from apps.telegram_bot.services import NotificationService
    
    try:
        tournament = Tournament.objects.get(id=tournament_id)
        
        # Создаём сервис и отправляем уведомления
        service = NotificationService()
        sent_count = asyncio.run(service.notify_new_tournament(tournament))
        asyncio.run(service.close())
        
        logger.info(f"Отправлено {sent_count} уведомлений о турнире {tournament.name}")
        return f"Отправлено {sent_count} уведомлений"
        
    except Tournament.DoesNotExist:
        logger.error(f"Турнир {tournament_id} не найден")
        return f"Турнир {tournament_id} не найден"
    except Exception as e:
        logger.error(f"Ошибка отправки уведомлений о турнире {tournament_id}: {e}")
        return f"Ошибка: {e}"


@shared_task
def send_tournament_reminder(tournament_id, hours_before=24):
    """
    Отправка напоминаний о начале турнира
    
    Args:
        tournament_id: ID турнира
        hours_before: за сколько часов напомнить
    """
    from apps.tournaments.models import Tournament
    from apps.telegram_bot.services import NotificationService
    
    try:
        tournament = Tournament.objects.get(id=tournament_id)
        
        # Создаём сервис и отправляем напоминания
        service = NotificationService()
        sent_count = asyncio.run(
            service.notify_tournament_starting_soon(tournament, hours_before)
        )
        asyncio.run(service.close())
        
        logger.info(f"Отправлено {sent_count} напоминаний о турнире {tournament.name}")
        return f"Отправлено {sent_count} напоминаний"
        
    except Tournament.DoesNotExist:
        logger.error(f"Турнир {tournament_id} не найден")
        return f"Турнир {tournament_id} не найден"
    except Exception as e:
        logger.error(f"Ошибка отправки напоминаний о турнире {tournament_id}: {e}")
        return f"Ошибка: {e}"


@shared_task
def send_match_result_notification(match_id):
    """
    Отправка уведомлений о результате матча
    
    Args:
        match_id: ID матча
    """
    from apps.matches.models import Match
    from apps.telegram_bot.services import NotificationService
    
    try:
        match = Match.objects.select_related('tournament', 'team1', 'team2').get(id=match_id)
        
        # Создаём сервис и отправляем уведомления
        service = NotificationService()
        sent_count = asyncio.run(service.notify_match_result(match))
        asyncio.run(service.close())
        
        logger.info(f"Отправлено {sent_count} уведомлений о результате матча {match_id}")
        return f"Отправлено {sent_count} уведомлений"
        
    except Match.DoesNotExist:
        logger.error(f"Матч {match_id} не найден")
        return f"Матч {match_id} не найден"
    except Exception as e:
        logger.error(f"Ошибка отправки уведомлений о матче {match_id}: {e}")
        return f"Ошибка: {e}"


@shared_task
def check_upcoming_tournaments():
    """
    Проверка предстоящих турниров и отправка напоминаний
    Запускается периодически (например, каждый час)
    """
    from apps.tournaments.models import Tournament
    from datetime import timedelta
    
    now = timezone.now()
    reminder_time = now + timedelta(hours=24)
    
    # Находим турниры, которые начнутся через 24 часа
    tournaments = Tournament.objects.filter(
        status='created',
        date__gte=now,
        date__lte=reminder_time
    )
    
    sent_tasks = 0
    for tournament in tournaments:
        # Проверяем, не отправляли ли уже напоминание
        from apps.telegram_bot.models import NotificationLog
        already_sent = NotificationLog.objects.filter(
            tournament=tournament,
            notification_type='tournament_reminder',
            sent_at__gte=now - timedelta(hours=25)
        ).exists()
        
        if not already_sent:
            send_tournament_reminder.delay(tournament.id, hours_before=24)
            sent_tasks += 1
    
    return f"Запланировано {sent_tasks} напоминаний о турнирах"


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


@shared_task
def send_pair_invitation_notification(invitation_id):
    """
    Отправка уведомления о приглашении в пару
    
    Args:
        invitation_id: ID приглашения
    """
    from apps.tournaments.registration_models import PairInvitation
    from apps.telegram_bot.services import NotificationService
    
    try:
        invitation = PairInvitation.objects.select_related(
            'sender', 'receiver', 'tournament'
        ).get(id=invitation_id)
        
        # Создаём сервис и отправляем уведомление
        service = NotificationService()
        sent_count = asyncio.run(service.notify_pair_invitation(invitation))
        asyncio.run(service.close())
        
        logger.info(f"Отправлено уведомление о приглашении {invitation_id}")
        return f"Отправлено {sent_count} уведомлений"
        
    except PairInvitation.DoesNotExist:
        logger.error(f"Приглашение {invitation_id} не найдено")
        return f"Приглашение {invitation_id} не найдено"
    except Exception as e:
        logger.error(f"Ошибка отправки уведомления о приглашении {invitation_id}: {e}")
        return f"Ошибка: {e}"


@shared_task
def send_invitation_accepted_notification(invitation_id):
    """
    Отправка уведомления о принятии приглашения
    
    Args:
        invitation_id: ID приглашения
    """
    from apps.tournaments.registration_models import PairInvitation
    from apps.telegram_bot.services import NotificationService
    
    try:
        invitation = PairInvitation.objects.select_related(
            'sender', 'receiver', 'tournament'
        ).get(id=invitation_id)
        
        # Создаём сервис и отправляем уведомление отправителю
        service = NotificationService()
        sent_count = asyncio.run(service.notify_invitation_accepted(invitation))
        asyncio.run(service.close())
        
        logger.info(f"Отправлено уведомление о принятии приглашения {invitation_id}")
        return f"Отправлено {sent_count} уведомлений"
        
    except PairInvitation.DoesNotExist:
        logger.error(f"Приглашение {invitation_id} не найдено")
        return f"Приглашение {invitation_id} не найдено"
    except Exception as e:
        logger.error(f"Ошибка отправки уведомления о принятии приглашения {invitation_id}: {e}")
        return f"Ошибка: {e}"


@shared_task
def send_partner_registration_notification(registration_id):
    """
    Отправка уведомления напарнику о регистрации
    
    Args:
        registration_id: ID регистрации
    """
    from apps.tournaments.registration_models import TournamentRegistration
    from apps.telegram_bot.services import NotificationService
    
    try:
        registration = TournamentRegistration.objects.select_related(
            'player', 'partner', 'tournament'
        ).get(id=registration_id)
        
        if not registration.partner:
            return "Регистрация без напарника"
        
        # Создаём сервис и отправляем уведомление напарнику
        service = NotificationService()
        sent_count = asyncio.run(service.notify_partner_registration(registration))
        asyncio.run(service.close())
        
        logger.info(f"Отправлено уведомление напарнику о регистрации {registration_id}")
        return f"Отправлено {sent_count} уведомлений"
        
    except TournamentRegistration.DoesNotExist:
        logger.error(f"Регистрация {registration_id} не найдена")
        return f"Регистрация {registration_id} не найдена"
    except Exception as e:
        logger.error(f"Ошибка отправки уведомления напарнику {registration_id}: {e}")
        return f"Ошибка: {e}"


@shared_task
def send_status_changed_notification(registration_id, old_status, new_status):
    """
    Отправка уведомления об изменении статуса регистрации
    
    Args:
        registration_id: ID регистрации
        old_status: старый статус
        new_status: новый статус
    """
    from apps.tournaments.registration_models import TournamentRegistration
    from apps.telegram_bot.services import NotificationService
    
    try:
        registration = TournamentRegistration.objects.select_related(
            'player', 'partner', 'tournament'
        ).get(id=registration_id)
        
        # Создаём сервис и отправляем уведомления
        service = NotificationService()
        sent_count = asyncio.run(
            service.notify_status_changed(registration, old_status, new_status)
        )
        asyncio.run(service.close())
        
        logger.info(f"Отправлено уведомление об изменении статуса регистрации {registration_id}")
        return f"Отправлено {sent_count} уведомлений"
        
    except TournamentRegistration.DoesNotExist:
        logger.error(f"Регистрация {registration_id} не найдена")
        return f"Регистрация {registration_id} не найдена"
    except Exception as e:
        logger.error(f"Ошибка отправки уведомления об изменении статуса {registration_id}: {e}")
        return f"Ошибка: {e}"

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
    Проверка предстоящих турниров и отправка напоминаний и анонсов
    Запускается периодически (например, каждый час)
    """
    from apps.tournaments.models import Tournament, TournamentAnnouncementSettings
    from datetime import timedelta
    
    now = timezone.now()
    
    # Проверяем турниры для разных временных триггеров
    triggers = [
        ('72h', 72, 1),  # (тип, часов до турнира, допуск в часах)
        ('48h', 48, 1),
        ('24h', 24, 1),
        ('2h', 2, 0.5),
    ]
    
    sent_tasks = 0
    sent_reminders = 0
    
    for trigger_type, hours_before, tolerance in triggers:
        time_min = now + timedelta(hours=hours_before - tolerance)
        time_max = now + timedelta(hours=hours_before + tolerance)
        
        # Находим турниры в нужном временном окне
        tournaments = Tournament.objects.filter(
            date__gte=time_min,
            date__lte=time_max
        ).select_related('announcement_settings')
        
        for tournament in tournaments:
            # Проверяем наличие настроек анонсов
            try:
                settings = tournament.announcement_settings
                # Отправляем анонс в чат, если настроено
                send_tournament_announcement_to_chat.delay(tournament.id, trigger_type)
                sent_tasks += 1
            except TournamentAnnouncementSettings.DoesNotExist:
                pass
            
            # Отправляем персональные напоминания участникам (старая логика)
            if trigger_type == '24h':
                from apps.telegram_bot.models import NotificationLog
                already_sent = NotificationLog.objects.filter(
                    tournament=tournament,
                    notification_type='tournament_reminder',
                    sent_at__gte=now - timedelta(hours=25)
                ).exists()
                
                if not already_sent:
                    send_tournament_reminder.delay(tournament.id, hours_before=24)
                    sent_reminders += 1
    
    return f"Запланировано {sent_tasks} анонсов и {sent_reminders} напоминаний о турнирах"


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


@shared_task
def send_partner_left_notification(registration_id: int):
    """Заглушка задачи уведомления напарнику о выходе из пары.

    Функция нужна, чтобы избежать ошибок импорта из RegistrationService.leave_pair.
    Сейчас она просто пишет в лог и ничего не отправляет в Telegram.
    """

    logger.info(
        "[send_partner_left_notification] Игрок вышел из пары, registration_id=%s",
        registration_id,
    )
    return "ok"


@shared_task
def send_partner_cancelled_notification(registration_id: int):
    """Заглушка задачи уведомления напарнику об отмене регистрации.

    Используется в RegistrationService.cancel_registration. Пока что задача
    только логирует событие, чтобы не блокировать веб-интерфейс при отсутствии
    полноценной интеграции с NotificationService.
    """

    logger.info(
        "[send_partner_cancelled_notification] Регистрация напарника переведена "
        "в 'ищет пару', registration_id=%s",
        registration_id,
    )
    return "ok"


@shared_task
def send_tournament_announcement_to_chat(tournament_id: int, trigger_type: str):
    """
    Отправка анонса турнира в Telegram чат
    
    Args:
        tournament_id: ID турнира
        trigger_type: тип триггера (creation, 72h, 48h, 24h, 2h, roster_change)
    """
    from apps.tournaments.models import Tournament, TournamentAnnouncementSettings
    from apps.tournaments.api_views import generate_announcement_text
    from django.utils import timezone
    from datetime import timedelta
    
    logger.info(f"[ANNOUNCEMENT] Начало отправки анонса для турнира {tournament_id}, триггер: {trigger_type}")
    
    try:
        tournament = Tournament.objects.get(id=tournament_id)
        logger.info(f"[ANNOUNCEMENT] Турнир найден: {tournament.name}")
        
        # Проверяем наличие настроек анонсов
        try:
            settings = tournament.announcement_settings
        except TournamentAnnouncementSettings.DoesNotExist:
            logger.info(f"Настройки анонсов не найдены для турнира {tournament_id}")
            return "Настройки анонсов не найдены"
        
        # Проверяем, нужно ли отправлять анонс для данного триггера
        trigger_enabled = False
        timestamp_field = None
        
        if trigger_type == "creation":
            trigger_enabled = settings.send_on_creation
            timestamp_field = "sent_on_creation"
        elif trigger_type == "72h":
            trigger_enabled = settings.send_72h_before
            timestamp_field = "sent_72h_before"
        elif trigger_type == "48h":
            trigger_enabled = settings.send_48h_before
            timestamp_field = "sent_48h_before"
        elif trigger_type == "24h":
            trigger_enabled = settings.send_24h_before
            timestamp_field = "sent_24h_before"
        elif trigger_type == "2h":
            trigger_enabled = settings.send_2h_before
            timestamp_field = "sent_2h_before"
        elif trigger_type == "roster_change":
            trigger_enabled = settings.send_on_roster_change
            timestamp_field = "last_roster_change_sent"
        
        if not trigger_enabled:
            logger.info(f"[ANNOUNCEMENT] Триггер {trigger_type} отключен для турнира {tournament_id}")
            return f"Триггер {trigger_type} отключен"
        
        logger.info(f"[ANNOUNCEMENT] Триггер {trigger_type} включен, проверяем отправку...")
        
        # Проверяем, не отправляли ли уже
        if timestamp_field:
            last_sent = getattr(settings, timestamp_field)
            if last_sent:
                if trigger_type == "roster_change":
                    # Для roster_change разрешаем повторную отправку, но не чаще,
                    # чем раз в несколько секунд, чтобы склеить цепочку
                    # внутренних сохранений в одно уведомление.
                    if timezone.now() - last_sent < timedelta(seconds=3):
                        logger.info(
                            f"[ANNOUNCEMENT] roster_change уже был отправлен недавно для турнира {tournament_id}, подавляем дубликат"
                        )
                        return "Анонс roster_change уже отправлен недавно"
                else:
                    logger.info(
                        f"[ANNOUNCEMENT] Анонс {trigger_type} уже был отправлен для турнира {tournament_id}"
                    )
                    return f"Анонс {trigger_type} уже отправлен"
        
        logger.info(f"[ANNOUNCEMENT] Генерируем текст анонса...")
        # Генерируем текст анонса
        announcement_text = generate_announcement_text(tournament)
        logger.info(f"[ANNOUNCEMENT] Текст анонса сгенерирован, длина: {len(announcement_text)} символов")
        
        # Отправляем в Telegram
        from aiogram import Bot
        from aiogram.client.default import DefaultBotProperties
        from aiogram.enums import ParseMode
        from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
        from django.conf import settings as django_settings
        from asgiref.sync import async_to_sync

        # Кнопка "Зарегистрироваться" — открывает личный чат с ботом
        # и сразу переводит пользователя на регистрацию в конкретный турнир
        bot_username = getattr(django_settings, 'TELEGRAM_BOT_USERNAME', 'beachplay_bot')
        bot_url = f"https://t.me/{bot_username}?start=register_{tournament.id}"
        
        reply_markup = InlineKeyboardMarkup(inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="✅ Зарегистрироваться",
                    url=bot_url,
                )
            ]
        ])

        message_id = None

        # Для избежания ошибок "Event loop is closed" создаём Bot внутри каждого
        # async-вызова и закрываем его сессию после использования.
        #
        # Особый случай: для roster_change мы всегда отправляем новое сообщение
        # в конец чата и по возможности удаляем предыдущее, чтобы пользователи
        # видели актуальную информацию, а не тихое редактирование старого поста.
        if (
            settings.announcement_mode == 'edit_single'
            and settings.last_announcement_message_id
            and trigger_type != 'roster_change'
        ):
            # Режим редактирования: пытаемся отредактировать существующее сообщение
            async def edit_message():
                bot = Bot(
                    token=django_settings.TELEGRAM_BOT_TOKEN,
                    default=DefaultBotProperties(parse_mode=ParseMode.MARKDOWN)
                )
                try:
                    await bot.edit_message_text(
                        chat_id=settings.telegram_chat_id,
                        message_id=settings.last_announcement_message_id,
                        text=announcement_text,
                        reply_markup=reply_markup
                    )
                    return settings.last_announcement_message_id
                except Exception as e:
                    # Если не удалось отредактировать (сообщение удалено/слишком старое),
                    # пытаемся удалить старое и отправить новое
                    logger.warning(f"Не удалось отредактировать сообщение {settings.last_announcement_message_id}: {e}")
                    try:
                        await bot.delete_message(
                            chat_id=settings.telegram_chat_id,
                            message_id=settings.last_announcement_message_id
                        )
                    except Exception:
                        pass  # Игнорируем ошибку удаления
                    
                    # Отправляем новое сообщение
                    msg = await bot.send_message(
                        chat_id=settings.telegram_chat_id,
                        text=announcement_text,
                        reply_markup=reply_markup,
                    )
                    return msg.message_id
                finally:
                    await bot.session.close()

            message_id = async_to_sync(edit_message)()
        else:
            # Режим новых сообщений или первая отправка в режиме редактирования
            async def send_message():
                bot = Bot(
                    token=django_settings.TELEGRAM_BOT_TOKEN,
                    default=DefaultBotProperties(parse_mode=ParseMode.MARKDOWN)
                )
                try:
                    # Для roster_change пробуем удалить предыдущее сообщение,
                    # чтобы новое оказалось внизу чата
                    if trigger_type == 'roster_change' and settings.last_announcement_message_id:
                        try:
                            await bot.delete_message(
                                chat_id=settings.telegram_chat_id,
                                message_id=settings.last_announcement_message_id,
                            )
                            logger.info(
                                f"[ANNOUNCEMENT] Предыдущее сообщение {settings.last_announcement_message_id} удалено перед отправкой нового (roster_change)"
                            )
                        except Exception as e:
                            logger.warning(
                                f"[ANNOUNCEMENT] Не удалось удалить предыдущее сообщение {settings.last_announcement_message_id} перед отправкой нового (roster_change): {e}"
                            )

                    msg = await bot.send_message(
                        chat_id=settings.telegram_chat_id,
                        text=announcement_text,
                        reply_markup=reply_markup,
                    )
                    return msg.message_id
                finally:
                    await bot.session.close()

            message_id = async_to_sync(send_message)()
        
        logger.info(f"[ANNOUNCEMENT] Сообщение отправлено успешно, message_id: {message_id}")
        
        # Сохраняем message_id для режима редактирования
        if settings.announcement_mode == 'edit_single' and message_id:
            settings.last_announcement_message_id = message_id
        
        # Обновляем timestamp отправки
        update_fields = ["updated_at"]
        if timestamp_field:
            setattr(settings, timestamp_field, timezone.now())
            update_fields.append(timestamp_field)
        if settings.announcement_mode == 'edit_single':
            update_fields.append("last_announcement_message_id")
        
        settings.save(update_fields=update_fields)
        logger.info(f"[ANNOUNCEMENT] Настройки сохранены, анонс {trigger_type} отправлен для турнира {tournament_id}")
        
        mode_str = "отредактирован" if settings.announcement_mode == 'edit_single' and settings.last_announcement_message_id else "отправлен"
        logger.info(f"Анонс турнира {tournament.name} {mode_str} в чат {settings.telegram_chat_id} (триггер: {trigger_type})")
        return f"Анонс {mode_str} (триггер: {trigger_type})"
        
    except Tournament.DoesNotExist:
        logger.error(f"Турнир {tournament_id} не найден")
        return f"Турнир {tournament_id} не найден"
    except Exception as e:
        logger.error(f"Ошибка отправки анонса турнира {tournament_id}: {e}", exc_info=True)
        return f"Ошибка: {e}"

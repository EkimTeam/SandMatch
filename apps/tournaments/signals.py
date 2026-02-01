"""
Сигналы для синхронизации TournamentEntry с TournamentRegistration
"""
from django.db.models.signals import post_save, post_delete, pre_save
from django.dispatch import receiver
from django.db import transaction

from apps.tournaments.models import TournamentEntry, Tournament
from apps.tournaments.registration_models import TournamentRegistration
from apps.tournaments.services.registration_service import RegistrationService


@receiver(post_save, sender=TournamentEntry)
def sync_tournament_entry_created(sender, instance, created, **kwargs):
    """
    Синхронизировать TournamentEntry с TournamentRegistration при создании/обновлении.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    logger.info(f"[ENTRY_SYNC] Сигнал вызван для TournamentEntry {instance.id}, created: {created}, team: {instance.team}")
    
    if created or instance.team:
        logger.info(f"[ENTRY_SYNC] Вызываем sync_tournament_entry_to_registration для турнира {instance.tournament.id}")
        RegistrationService.sync_tournament_entry_to_registration(instance)
        logger.info(f"[ENTRY_SYNC] Синхронизация завершена")


@receiver(post_delete, sender=TournamentEntry)
def sync_tournament_entry_deleted(sender, instance, **kwargs):
    """
    Удалить соответствующие TournamentRegistration при удалении TournamentEntry.

    Этот сигнал в первую очередь обслуживает действия организатора/админа
    в интерфейсе управления участниками (удаление команды из турнира).

    Для пользовательских сценариев (отмена регистрации, выход из пары)
    RegistrationService сперва обновляет/обнуляет связанные регистрации,
    поэтому на момент удаления TournamentEntry у них уже нет ссылки на
    команду и они не будут затронуты этим сигналом.
    """
    from apps.tournaments.registration_models import TournamentRegistration

    if instance.team:
        TournamentRegistration.objects.filter(
            tournament=instance.tournament,
            team=instance.team,
            status__in=[
                TournamentRegistration.Status.MAIN_LIST,
                TournamentRegistration.Status.RESERVE_LIST,
            ],
        ).delete()


@receiver(pre_save, sender=Tournament)
def track_planned_participants_change(sender, instance, **kwargs):
    """
    Отслеживаем изменение planned_participants для последующего пересчёта статусов.
    """
    if instance.pk:
        try:
            old_instance = Tournament.objects.get(pk=instance.pk)
            instance._old_planned_participants = old_instance.planned_participants
        except Tournament.DoesNotExist:
            instance._old_planned_participants = None
    else:
        instance._old_planned_participants = None


@receiver(post_save, sender=Tournament)
def recalculate_on_planned_participants_change(sender, instance, created, **kwargs):
    """
    Пересчитать статусы регистраций при изменении planned_participants.
    """
    if not created and hasattr(instance, '_old_planned_participants'):
        old_value = instance._old_planned_participants
        new_value = instance.planned_participants
        
        # Если изменилось количество участников, пересчитываем статусы
        if old_value != new_value:
            RegistrationService._recalculate_registration_statuses(instance)


# ============================================================================
# Сигналы для TournamentRegistration
# ============================================================================

@receiver(pre_save, sender=TournamentRegistration)
def track_registration_status_change(sender, instance, **kwargs):
    """
    Отслеживаем изменение статуса регистрации для последующей синхронизации.
    """
    if instance.pk:
        try:
            old_instance = TournamentRegistration.objects.get(pk=instance.pk)
            instance._old_status = old_instance.status
            instance._old_team = old_instance.team
        except TournamentRegistration.DoesNotExist:
            instance._old_status = None
            instance._old_team = None
    else:
        instance._old_status = None
        instance._old_team = None


@receiver(post_save, sender=TournamentRegistration)
def sync_registration_to_entry(sender, instance, created, **kwargs):
    """
    Синхронизировать TournamentRegistration с TournamentEntry при создании/обновлении.
    
    Правила:
    - Если статус main_list/reserve_list и есть team → создать/обновить TournamentEntry
    - Если статус looking_for_partner или invited → удалить TournamentEntry
    - При изменении статуса → пересчитать очередь
    """
    # Избегаем рекурсии - если это вызов из пересчёта, не пересчитываем снова
    if getattr(instance, '_skip_recalculation', False):
        return
    
    old_status = getattr(instance, '_old_status', None)
    old_team = getattr(instance, '_old_team', None)
    
    # Синхронизируем с TournamentEntry
    RegistrationService._sync_to_tournament_entry(instance)
    
    # Пересчитываем очередь если:
    # 1. Создана новая регистрация с командой (main_list/reserve_list)
    # 2. Изменился статус
    # 3. Изменилась команда (сформировалась пара)
    should_recalculate = (
        (created and instance.team and instance.status in [
            TournamentRegistration.Status.MAIN_LIST,
            TournamentRegistration.Status.RESERVE_LIST
        ]) or
        (not created and old_status != instance.status) or
        (not created and old_team != instance.team and instance.team is not None)
    )
    
    if should_recalculate:
        # Используем transaction.on_commit чтобы избежать проблем с вложенными транзакциями
        transaction.on_commit(
            lambda: RegistrationService._recalculate_registration_statuses(instance.tournament)
        )


@receiver(post_delete, sender=TournamentRegistration)
def recalculate_on_registration_deleted(sender, instance, **kwargs):
    """
    Пересчитать очередь при удалении регистрации.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    logger.info(f"[ROSTER_CHANGE] Сигнал post_delete вызван для регистрации {instance.id}, статус был: {instance.status}")
    
    # Пропускаем анонс, если установлен флаг _skip_announcement (для парных операций)
    skip_announcement = getattr(instance, '_skip_announcement', False)
    if skip_announcement:
        logger.info(f"[ROSTER_CHANGE] (post_delete) Пропускаем анонс для instance.id={instance.id} (флаг _skip_announcement)")
    
    # Удаляем TournamentEntry если есть команда
    if instance.team:
        TournamentEntry.objects.filter(
            tournament=instance.tournament,
            team=instance.team
        ).delete()
    
    # Пересчитываем очередь
    # Используем transaction.on_commit для безопасности
    tournament = instance.tournament
    transaction.on_commit(
        lambda: RegistrationService._recalculate_registration_statuses(tournament)
    )
    
    # Отправляем анонс об изменении состава (с учётом хеша состава) только если не пропускаем
    if skip_announcement:
        return
    
    try:
        from apps.tournaments.models import TournamentAnnouncementSettings
        settings = tournament.announcement_settings

        if not settings.send_on_roster_change:
            logger.info("[ROSTER_CHANGE] Триггер roster_change отключен (post_delete)")
            return

        # Вычисляем новый хеш общего состава (все регистрации турнира)
        import hashlib
        all_regs = TournamentRegistration.objects.filter(
            tournament=tournament
        ).select_related('player', 'partner', 'team').order_by('id')

        roster_items = []
        for reg in all_regs:
            status_code = reg.status
            if reg.team:
                roster_items.append(f"team_{reg.team_id}_{status_code}")
            elif reg.player:
                roster_items.append(f"player_{reg.player_id}_{status_code}")

        roster_string = "|".join(roster_items)
        new_hash = hashlib.md5(roster_string.encode()).hexdigest()

        logger.info(f"[ROSTER_CHANGE] (post_delete) Старый хеш: {settings.roster_hash}, новый хеш: {new_hash}")

        if settings.roster_hash == new_hash:
            logger.info("[ROSTER_CHANGE] (post_delete) Хеш не изменился, анонс не отправляем")
            return

        settings.roster_hash = new_hash
        settings.save(update_fields=['roster_hash', 'updated_at'])

        logger.info("[ROSTER_CHANGE] (post_delete) Хеш изменился, отправляем анонс")
        
        # Получаем transaction_id из контекста для группировки парных операций
        from apps.tournaments.services.registration_service import RegistrationService
        transaction_id = RegistrationService._get_transaction_id()
        
        # Захватываем переменные для lambda
        tournament_id = tournament.id
        txn_id = transaction_id
        
        from apps.telegram_bot.tasks import send_tournament_announcement_to_chat
        transaction.on_commit(
            lambda: send_tournament_announcement_to_chat.delay(
                tournament_id, 
                'roster_change',
                transaction_id=txn_id
            )
        )
    except Exception as e:
        logger.error(f"[ROSTER_CHANGE] Ошибка при отправке анонса после удаления: {e}", exc_info=True)


# ============================================================================
# Сигналы для автоматических анонсов турниров
# ============================================================================

@receiver(post_save, sender=TournamentRegistration)
def check_roster_change_for_announcement(sender, instance, created, **kwargs):
    """
    Отслеживаем изменения состава участников для отправки анонсов в Telegram чат.
    Срабатывает при любых изменениях: добавление в основу, резерв, "ищу пару".
    
    Логика:
    - Вычисляем хеш состава турнира (список пар в основном/резервном списке)
    - Сравниваем с предыдущим хешем в TournamentSettings
    - Если хеш изменился → отправляем анонс
    - Если хеш не изменился → пропускаем
    
    Это предотвращает дублирование анонсов при массовых операциях.
    """
    import logging
    logger = logging.getLogger(__name__)
    
    # Пропускаем анонс, если установлен флаг _skip_announcement (для парных операций)
    if getattr(instance, '_skip_announcement', False):
        logger.info(f"[ROSTER_CHANGE] (post_save) Пропускаем анонс для instance.id={instance.id} (флаг _skip_announcement)")
        return
    
    logger.info(f"[ROSTER_CHANGE] Сигнал post_save вызван для регистрации {instance.id}, статус: {instance.status}, created: {created}")
    
    # Проверяем наличие настроек анонсов
    try:
        from apps.tournaments.models import TournamentAnnouncementSettings
        from apps.tournaments.services.registration_service import RegistrationService
        
        settings = instance.tournament.announcement_settings
        
        logger.info(f"[ROSTER_CHANGE] Настройки найдены для турнира {instance.tournament.id}, send_on_roster_change: {settings.send_on_roster_change}")
        
        if not settings.send_on_roster_change:
            logger.info(f"[ROSTER_CHANGE] Триггер roster_change отключен")
            return

        # Вычисляем новый хеш общего состава (все регистрации турнира)
        import hashlib
        all_regs = TournamentRegistration.objects.filter(
            tournament=instance.tournament
        ).select_related('player', 'partner', 'team').order_by('id')

        roster_items = []
        for reg in all_regs:
            status_code = reg.status
            if reg.team:
                roster_items.append(f"team_{reg.team_id}_{status_code}")
            elif reg.player:
                roster_items.append(f"player_{reg.player_id}_{status_code}")

        roster_string = "|".join(roster_items)
        new_hash = hashlib.md5(roster_string.encode()).hexdigest()

        logger.info(f"[ROSTER_CHANGE] (post_save) Старый хеш: {settings.roster_hash}, новый хеш: {new_hash}")

        # Если хеш не изменился, не шлём повторный анонс
        if settings.roster_hash == new_hash:
            logger.info(f"[ROSTER_CHANGE] (post_save) Хеш не изменился, анонс не отправляем")
            return

        settings.roster_hash = new_hash
        settings.save(update_fields=['roster_hash', 'updated_at'])

        logger.info(f"[ROSTER_CHANGE] (post_save) Хеш изменился, отправляем анонс")
        
        # Получаем transaction_id из контекста для группировки парных операций
        transaction_id = RegistrationService._get_transaction_id()
        logger.info(f"[ROSTER_CHANGE] (post_save) Получен transaction_id из контекста: {transaction_id}, instance.id={instance.id}, player={instance.player_id}, partner={instance.partner_id}")
        
        # Отправляем анонс асинхронно с transaction_id
        from apps.telegram_bot.tasks import send_tournament_announcement_to_chat
        transaction.on_commit(
            lambda: send_tournament_announcement_to_chat.delay(
                instance.tournament.id, 
                'roster_change',
                transaction_id=transaction_id
            )
        )
        logger.info(f"[ROSTER_CHANGE] Задача отправки анонса поставлена в очередь (transaction_id: {transaction_id})")
    
    except Exception as e:
        # Не ломаем основной процесс регистрации при ошибках анонсов
        logger.error(f"[ROSTER_CHANGE] Ошибка в сигнале check_roster_change_for_announcement: {e}", exc_info=True)


@receiver(post_save, sender=Tournament)
def send_announcement_on_tournament_creation(sender, instance, created, **kwargs):
    """
    Отправляем анонс при создании турнира, если настроено.
    """
    if not created:
        return
    
    try:
        from apps.tournaments.models import TournamentAnnouncementSettings
        settings = instance.announcement_settings
        
        if settings.send_on_creation:
            from apps.telegram_bot.tasks import send_tournament_announcement_to_chat
            transaction.on_commit(
                lambda: send_tournament_announcement_to_chat.delay(instance.id, 'creation')
            )
    except Exception:
        # Настройки анонсов не обязательны для всех турниров
        pass

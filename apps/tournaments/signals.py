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
    if created or instance.team:
        RegistrationService.sync_tournament_entry_to_registration(instance)


@receiver(post_delete, sender=TournamentEntry)
def sync_tournament_entry_deleted(sender, instance, **kwargs):
    """
    Удалить соответствующие TournamentRegistration при удалении TournamentEntry.
    """
    from apps.tournaments.registration_models import TournamentRegistration
    
    if instance.team:
        # Удаляем регистрации для этой команды
        TournamentRegistration.objects.filter(
            tournament=instance.tournament,
            team=instance.team
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

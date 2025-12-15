"""
Сигналы для синхронизации TournamentEntry с TournamentRegistration
"""
from django.db.models.signals import post_save, post_delete, pre_save
from django.dispatch import receiver

from apps.tournaments.models import TournamentEntry, Tournament
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

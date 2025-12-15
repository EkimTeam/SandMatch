"""
Сигналы для синхронизации TournamentEntry с TournamentRegistration
"""
from django.db.models.signals import post_save, post_delete
from django.dispatch import receiver

from apps.tournaments.models import TournamentEntry
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

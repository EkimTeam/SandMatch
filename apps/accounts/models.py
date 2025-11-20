from django.db import models
from django.contrib.auth.models import User


class UserProfile(models.Model):
    class Role(models.TextChoices):
        ADMIN = 'ADMIN', 'Admin'
        ORGANIZER = 'ORGANIZER', 'Organizer'
        REFEREE = 'REFEREE', 'Referee'
        REGISTERED = 'REGISTERED', 'Registered User'

    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    role = models.CharField(max_length=32, choices=Role.choices, default=Role.REGISTERED)
    # Привязка веб-аккаунта к игроку (может быть пустой)
    player = models.ForeignKey('players.Player', null=True, blank=True, on_delete=models.SET_NULL, related_name='user_profiles')
    # Идентификаторы Telegram на будущее
    telegram_id = models.BigIntegerField(null=True, blank=True, unique=True)
    telegram_username = models.CharField(max_length=255, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self) -> str:
        return f"{self.user.username} ({self.role})"

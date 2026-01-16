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
    # Согласие на обработку персональных данных
    pdn_consent_given_at = models.DateTimeField(null=True, blank=True)
    pdn_consent_version = models.CharField(max_length=32, null=True, blank=True)

    def __str__(self) -> str:
        return f"{self.user.username} ({self.role})"


class PDNActionLog(models.Model):
    """Журнал операций с персональными данными (ПДн).

    Фиксирует ключевые действия: анонимизация, удаление, выгрузка и т.п.
    """

    ACTION_EXPORT = "export"
    ACTION_ANONYMIZE = "anonymize"
    ACTION_UPDATE_PROFILE = "update_profile"
    ACTION_CHANGE_PASSWORD = "change_password"
    ACTION_LINK_PLAYER = "link_player"
    ACTION_UNLINK_PLAYER = "unlink_player"
    ACTION_CREATE_PLAYER = "create_player"

    ACTION_CHOICES = [
        (ACTION_EXPORT, "Выгрузка персональных данных"),
        (ACTION_ANONYMIZE, "Анонимизация персональных данных"),
        (ACTION_UPDATE_PROFILE, "Обновление профиля пользователя"),
        (ACTION_CHANGE_PASSWORD, "Смена пароля пользователя"),
        (ACTION_LINK_PLAYER, "Связь пользователя с игроком"),
        (ACTION_UNLINK_PLAYER, "Отвязка игрока от пользователя"),
        (ACTION_CREATE_PLAYER, "Создание игрока пользователем"),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="pdn_actions")
    action = models.CharField(max_length=32, choices=ACTION_CHOICES)
    created_at = models.DateTimeField(auto_now_add=True)
    meta = models.JSONField(null=True, blank=True)

    class Meta:
        verbose_name = "Операция с ПДн"
        verbose_name_plural = "Операции с ПДн"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.get_action_display()} для {self.user.username} ({self.created_at})"

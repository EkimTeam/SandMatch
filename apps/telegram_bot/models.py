from django.db import models
from django.contrib.auth.models import User
from django.utils import timezone
import secrets
import string


class TelegramUser(models.Model):
    """Связь Telegram-аккаунта с пользователем beachplay"""
    telegram_id = models.BigIntegerField(unique=True, db_index=True, null=True, blank=True, verbose_name="Telegram ID")
    username = models.CharField(max_length=255, blank=True, null=True, verbose_name="Username")
    first_name = models.CharField(max_length=255, blank=True, verbose_name="Имя")
    last_name = models.CharField(max_length=255, blank=True, null=True, verbose_name="Фамилия")
    
    # Связь с основным пользователем
    user = models.OneToOneField(
        User,
        on_delete=models.CASCADE,
        related_name='telegram_profile',
        null=True,
        blank=True,
        verbose_name="Пользователь"
    )
    
    # Связь с игроком (если есть)
    player = models.OneToOneField(
        'players.Player',
        on_delete=models.SET_NULL,
        related_name='telegram_profile',
        null=True,
        blank=True,
        verbose_name="Игрок"
    )
    
    # Настройки уведомлений
    notifications_enabled = models.BooleanField(default=True, verbose_name="Уведомления включены")
    notify_tournament_open = models.BooleanField(default=True, verbose_name="Открытие регистрации")
    notify_tournament_start = models.BooleanField(default=True, verbose_name="Старт турнира")
    notify_match_start = models.BooleanField(default=True, verbose_name="Начало матча")
    notify_match_result = models.BooleanField(default=True, verbose_name="Результат матча")
    notify_rating_change = models.BooleanField(default=True, verbose_name="Изменение рейтинга")
    notify_pair_request = models.BooleanField(default=True, verbose_name="Запрос на пару")
    
    # Метаданные
    language_code = models.CharField(max_length=10, default='ru', verbose_name="Язык")
    is_blocked = models.BooleanField(default=False, verbose_name="Заблокировал бота")
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Создан")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Обновлён")
    last_interaction = models.DateTimeField(auto_now=True, verbose_name="Последнее взаимодействие")
    
    class Meta:
        verbose_name = "Telegram пользователь"
        verbose_name_plural = "Telegram пользователи"
        ordering = ['-created_at']
    
    def __str__(self):
        if self.username:
            return f"@{self.username} ({self.telegram_id})"
        return f"{self.first_name} ({self.telegram_id})"


class TournamentSubscription(models.Model):
    """Подписки на уведомления о турнирах"""
    telegram_user = models.ForeignKey(
        TelegramUser,
        on_delete=models.CASCADE,
        related_name='subscriptions',
        verbose_name="Telegram пользователь"
    )
    
    # Подписка на организатора
    organizer = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='telegram_subscribers',
        null=True,
        blank=True,
        verbose_name="Организатор"
    )
    
    # Подписка на площадку
    venue = models.ForeignKey(
        'venues.Venue',
        on_delete=models.CASCADE,
        related_name='telegram_subscribers',
        null=True,
        blank=True,
        verbose_name="Площадка"
    )
    
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Создана")
    
    class Meta:
        verbose_name = "Подписка"
        verbose_name_plural = "Подписки"
        unique_together = [
            ('telegram_user', 'organizer'),
            ('telegram_user', 'venue'),
        ]
        ordering = ['-created_at']
    
    def __str__(self):
        if self.organizer:
            return f"{self.telegram_user} → {self.organizer.get_full_name() or self.organizer.username}"
        if self.venue:
            return f"{self.telegram_user} → {self.venue.name}"
        return f"Подписка #{self.id}"


class PairRequest(models.Model):
    """Запросы на создание пары для турнира"""
    STATUS_CHOICES = [
        ('pending', 'Ожидает'),
        ('accepted', 'Принят'),
        ('declined', 'Отклонён'),
        ('cancelled', 'Отменён'),
    ]
    
    tournament = models.ForeignKey(
        'tournaments.Tournament',
        on_delete=models.CASCADE,
        related_name='pair_requests',
        verbose_name="Турнир"
    )
    
    # Кто предложил
    from_user = models.ForeignKey(
        TelegramUser,
        on_delete=models.CASCADE,
        related_name='sent_pair_requests',
        verbose_name="От кого"
    )
    
    # Кому предложил
    to_user = models.ForeignKey(
        TelegramUser,
        on_delete=models.CASCADE,
        related_name='received_pair_requests',
        verbose_name="Кому"
    )
    
    status = models.CharField(
        max_length=20,
        choices=STATUS_CHOICES,
        default='pending',
        verbose_name="Статус"
    )
    
    message = models.TextField(blank=True, verbose_name="Сообщение")
    
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Создан")
    updated_at = models.DateTimeField(auto_now=True, verbose_name="Обновлён")
    
    class Meta:
        verbose_name = "Запрос на пару"
        verbose_name_plural = "Запросы на пару"
        unique_together = [('tournament', 'from_user', 'to_user')]
        ordering = ['-created_at']
    
    def __str__(self):
        return f"{self.from_user} → {self.to_user} ({self.tournament.name})"


class NotificationLog(models.Model):
    """Лог отправленных уведомлений"""
    telegram_user = models.ForeignKey(
        TelegramUser,
        on_delete=models.CASCADE,
        related_name='notifications',
        verbose_name="Telegram пользователь"
    )
    
    notification_type = models.CharField(max_length=50, verbose_name="Тип уведомления")
    tournament = models.ForeignKey(
        'tournaments.Tournament',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        verbose_name="Турнир"
    )
    
    sent_at = models.DateTimeField(auto_now_add=True, verbose_name="Отправлено")
    success = models.BooleanField(default=True, verbose_name="Успешно")
    error_message = models.TextField(blank=True, verbose_name="Ошибка")
    
    class Meta:
        verbose_name = "Лог уведомлений"
        verbose_name_plural = "Логи уведомлений"
        ordering = ['-sent_at']
        indexes = [
            models.Index(fields=['telegram_user', '-sent_at']),
            models.Index(fields=['notification_type', '-sent_at']),
        ]
    
    def __str__(self):
        return f"{self.notification_type} → {self.telegram_user} ({self.sent_at})"


class LinkCode(models.Model):
    """Временные коды для связывания Telegram с аккаунтом"""
    code = models.CharField(max_length=8, unique=True, db_index=True, verbose_name="Код")
    user = models.ForeignKey(
        User,
        on_delete=models.CASCADE,
        related_name='telegram_link_codes',
        verbose_name="Пользователь"
    )
    
    created_at = models.DateTimeField(auto_now_add=True, verbose_name="Создан")
    expires_at = models.DateTimeField(verbose_name="Истекает")
    is_used = models.BooleanField(default=False, verbose_name="Использован")
    used_at = models.DateTimeField(null=True, blank=True, verbose_name="Использован в")
    
    class Meta:
        verbose_name = "Код связывания"
        verbose_name_plural = "Коды связывания"
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['code', 'is_used']),
        ]
    
    def __str__(self):
        return f"{self.code} ({self.user.username})"
    
    def is_valid(self):
        """Проверка валидности кода"""
        return not self.is_used and timezone.now() < self.expires_at
    
    @classmethod
    def generate_code(cls, user, expires_in_minutes=15):
        """
        Генерация нового кода для пользователя
        
        Args:
            user: пользователь Django
            expires_in_minutes: время жизни кода в минутах
            
        Returns:
            LinkCode объект
        """
        # Генерируем уникальный код (6 символов: буквы и цифры)
        while True:
            code = ''.join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6))
            if not cls.objects.filter(code=code).exists():
                break
        
        # Создаём код
        expires_at = timezone.now() + timezone.timedelta(minutes=expires_in_minutes)
        return cls.objects.create(
            code=code,
            user=user,
            expires_at=expires_at
        )

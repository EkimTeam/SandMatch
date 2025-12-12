"""
Модели для системы регистрации на турниры с поиском пары и приглашениями.
"""
from django.db import models
from django.core.exceptions import ValidationError


class TournamentRegistration(models.Model):
    """
    Регистрация игрока на турнир.
    
    Один игрок = одна запись на турнир (независимо от статуса).
    Статусы:
    - looking_for_partner: игрок ищет пару
    - invited: игрок получил приглашение в пару (но ещё не принял)
    - main_list: пара в основном составе
    - reserve_list: пара в резерве
    """
    
    class Status(models.TextChoices):
        LOOKING_FOR_PARTNER = 'looking_for_partner', 'Ищет пару'
        INVITED = 'invited', 'Приглашён в пару'
        MAIN_LIST = 'main_list', 'Основной состав'
        RESERVE_LIST = 'reserve_list', 'Резервный список'
    
    tournament = models.ForeignKey(
        'tournaments.Tournament',
        on_delete=models.CASCADE,
        related_name='registrations',
        verbose_name='Турнир'
    )
    player = models.ForeignKey(
        'players.Player',
        on_delete=models.CASCADE,
        related_name='tournament_registrations',
        verbose_name='Игрок'
    )
    partner = models.ForeignKey(
        'players.Player',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='partner_registrations',
        verbose_name='Напарник',
        help_text='Заполняется когда пара сформирована'
    )
    team = models.ForeignKey(
        'teams.Team',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name='tournament_registrations',
        verbose_name='Команда',
        help_text='Ссылка на команду из teams.Team (переиспользуем существующие)'
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.LOOKING_FOR_PARTNER,
        verbose_name='Статус'
    )
    registered_at = models.DateTimeField(
        auto_now_add=True,
        verbose_name='Дата регистрации'
    )
    updated_at = models.DateTimeField(
        auto_now=True,
        verbose_name='Дата обновления'
    )
    
    # Для отслеживания порядка регистрации (для определения основного состава/резерва)
    registration_order = models.PositiveIntegerField(
        default=0,
        verbose_name='Порядок регистрации',
        help_text='Автоматически заполняется при создании'
    )
    
    class Meta:
        verbose_name = 'Регистрация на турнир'
        verbose_name_plural = 'Регистрации на турниры'
        ordering = ['registration_order', 'registered_at']
        constraints = [
            models.UniqueConstraint(
                fields=['tournament', 'player'],
                name='unique_player_registration_per_tournament'
            )
        ]
        indexes = [
            models.Index(fields=['tournament', 'status']),
            models.Index(fields=['player', 'tournament']),
        ]
    
    def __str__(self):
        partner_str = f" + {self.partner}" if self.partner else ""
        return f"{self.player}{partner_str} → {self.tournament.name} ({self.get_status_display()})"
    
    def clean(self):
        """Валидация регистрации"""
        super().clean()
        
        # Игрок не может быть своим напарником
        if self.partner and self.partner_id == self.player_id:
            raise ValidationError({'partner': 'Игрок не может быть своим напарником'})
        
        # Если есть напарник, должна быть команда
        if self.partner and not self.team:
            raise ValidationError({'team': 'Для пары должна быть указана команда'})
        
        # Если статус main_list или reserve_list, должна быть команда
        if self.status in [self.Status.MAIN_LIST, self.Status.RESERVE_LIST] and not self.team:
            raise ValidationError({'team': f'Для статуса {self.get_status_display()} должна быть указана команда'})
    
    def save(self, *args, **kwargs):
        # Автоматически устанавливаем registration_order при создании
        if not self.pk and self.registration_order == 0:
            max_order = TournamentRegistration.objects.filter(
                tournament=self.tournament
            ).aggregate(
                models.Max('registration_order')
            )['registration_order__max']
            self.registration_order = (max_order or 0) + 1
        
        super().save(*args, **kwargs)


class PairInvitation(models.Model):
    """
    Приглашение игрока в пару для турнира.
    
    Создаётся когда один игрок приглашает другого сыграть в паре.
    """
    
    class Status(models.TextChoices):
        PENDING = 'pending', 'Ожидает ответа'
        ACCEPTED = 'accepted', 'Принято'
        DECLINED = 'declined', 'Отклонено'
        CANCELLED = 'cancelled', 'Отменено отправителем'
    
    tournament = models.ForeignKey(
        'tournaments.Tournament',
        on_delete=models.CASCADE,
        related_name='pair_invitations',
        verbose_name='Турнир'
    )
    sender = models.ForeignKey(
        'players.Player',
        on_delete=models.CASCADE,
        related_name='sent_pair_invitations',
        verbose_name='Отправитель'
    )
    receiver = models.ForeignKey(
        'players.Player',
        on_delete=models.CASCADE,
        related_name='received_pair_invitations',
        verbose_name='Получатель'
    )
    status = models.CharField(
        max_length=20,
        choices=Status.choices,
        default=Status.PENDING,
        verbose_name='Статус'
    )
    message = models.TextField(
        blank=True,
        verbose_name='Сообщение',
        help_text='Опциональное сообщение от отправителя'
    )
    created_at = models.DateTimeField(
        auto_now_add=True,
        verbose_name='Дата отправки'
    )
    responded_at = models.DateTimeField(
        null=True,
        blank=True,
        verbose_name='Дата ответа'
    )
    
    class Meta:
        verbose_name = 'Приглашение в пару'
        verbose_name_plural = 'Приглашения в пары'
        ordering = ['-created_at']
        indexes = [
            models.Index(fields=['tournament', 'status']),
            models.Index(fields=['receiver', 'status']),
            models.Index(fields=['sender', 'tournament']),
        ]
    
    def __str__(self):
        return f"{self.sender} → {self.receiver} для {self.tournament.name} ({self.get_status_display()})"
    
    def clean(self):
        """Валидация приглашения"""
        super().clean()
        
        # Нельзя пригласить самого себя
        if self.sender_id == self.receiver_id:
            raise ValidationError({'receiver': 'Нельзя пригласить самого себя'})
        
        # Проверяем, что оба игрока зарегистрированы на турнир
        if self.pk is None:  # Только при создании
            sender_reg = TournamentRegistration.objects.filter(
                tournament=self.tournament,
                player=self.sender
            ).first()
            
            receiver_reg = TournamentRegistration.objects.filter(
                tournament=self.tournament,
                player=self.receiver
            ).first()
            
            if not sender_reg:
                raise ValidationError({'sender': 'Отправитель не зарегистрирован на турнир'})
            
            if not receiver_reg:
                raise ValidationError({'receiver': 'Получатель не зарегистрирован на турнир'})
            
            # Оба должны искать пару
            if sender_reg.status != TournamentRegistration.Status.LOOKING_FOR_PARTNER:
                raise ValidationError({'sender': 'Отправитель уже не ищет пару'})
            
            if receiver_reg.status != TournamentRegistration.Status.LOOKING_FOR_PARTNER:
                raise ValidationError({'receiver': 'Получатель уже не ищет пару'})

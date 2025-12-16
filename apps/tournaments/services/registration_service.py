"""
Сервис для управления регистрацией на турниры.

Основные функции:
- Регистрация игрока на турнир (с поиском пары или с напарником)
- Отправка и обработка приглашений в пару
- Управление основным составом и резервом
- Синхронизация с TournamentEntry
- Переиспользование существующих команд из teams.Team
"""
from typing import Optional, Tuple
from django.db import transaction, models
from django.core.exceptions import ValidationError
from django.utils import timezone

from apps.tournaments.registration_models import TournamentRegistration, PairInvitation
from apps.tournaments.models import Tournament, TournamentEntry
from apps.teams.models import Team
from apps.players.models import Player


class RegistrationService:
    """Сервис для управления регистрацией на турниры"""
    
    @staticmethod
    def _get_or_create_team(player1: Player, player2: Player) -> Team:
        """
        Получить существующую команду или создать новую.
        Проверяет обе комбинации игроков (A+B и B+A).
        """
        # Проверяем обе комбинации
        team = Team.objects.filter(
            player_1=player1, player_2=player2
        ).first()
        
        if not team:
            team = Team.objects.filter(
                player_1=player2, player_2=player1
            ).first()
        
        # Если команда не найдена, создаём новую
        if not team:
            team = Team.objects.create(
                player_1=player1,
                player_2=player2
            )
        
        return team
    
    @staticmethod
    def _recalculate_registration_statuses(tournament: Tournament):
        """
        Пересчитать статусы всех регистраций (основной состав / резерв).
        Вызывается при изменении planned_participants или при изменении регистраций.
        """
        # Получаем все пары (main_list и reserve_list)
        registrations = TournamentRegistration.objects.filter(
            tournament=tournament,
            status__in=[
                TournamentRegistration.Status.MAIN_LIST,
                TournamentRegistration.Status.RESERVE_LIST
            ]
        ).order_by('registration_order', 'registered_at')
        
        max_teams = tournament.planned_participants or 0
        
        # Обновляем статусы
        for idx, reg in enumerate(registrations):
            new_status = (
                TournamentRegistration.Status.MAIN_LIST
                if idx < max_teams
                else TournamentRegistration.Status.RESERVE_LIST
            )
            
            if reg.status != new_status:
                old_status = reg.status
                reg.status = new_status
                
                # Устанавливаем флаг для избежания рекурсии в сигналах
                reg._skip_recalculation = True
                reg.save(update_fields=['status', 'updated_at'])
                
                # Синхронизируем с TournamentEntry
                RegistrationService._sync_to_tournament_entry(reg)
                
                # Отправляем уведомление об изменении статуса
                from apps.telegram_bot.tasks import send_status_changed_notification
                send_status_changed_notification.delay(reg.id, old_status, new_status)
    
    @staticmethod
    def _sync_to_tournament_entry(registration: TournamentRegistration):
        """
        Синхронизировать регистрацию с TournamentEntry.
        Создаёт или обновляет запись в TournamentEntry для основного состава и резерва.
        """
        if not registration.team:
            return
        
        # Для основного состава и резерва создаём запись
        if registration.status in [
            TournamentRegistration.Status.MAIN_LIST,
            TournamentRegistration.Status.RESERVE_LIST
        ]:
            TournamentEntry.objects.get_or_create(
                tournament=registration.tournament,
                team=registration.team,
                defaults={
                    'is_out_of_competition': False,
                    'group_index': None,
                    'row_index': None
                }
            )
        else:
            # Удаляем из TournamentEntry если есть
            TournamentEntry.objects.filter(
                tournament=registration.tournament,
                team=registration.team
            ).delete()
    
    @staticmethod
    @transaction.atomic
    def register_single(
        tournament: Tournament,
        player: Player
    ) -> TournamentRegistration:
        """
        Простая регистрация игрока (для индивидуальных турниров).
        Игрок сразу попадает в основной состав или резерв.
        
        Args:
            tournament: Турнир
            player: Игрок
            
        Returns:
            TournamentRegistration
            
        Raises:
            ValidationError: если игрок уже зарегистрирован
        """
        # Проверяем, что игрок ещё не зарегистрирован
        existing = TournamentRegistration.objects.filter(
            tournament=tournament,
            player=player
        ).first()
        
        if existing:
            raise ValidationError(f'Игрок {player} уже зарегистрирован на турнир')
        
        # Ищем или создаём команду из одного игрока (player_2=NULL)
        team, _ = Team.objects.get_or_create(player_1=player, player_2=None)
        
        # Определяем статус (основной состав или резерв)
        current_main_count = TournamentRegistration.objects.filter(
            tournament=tournament,
            status=TournamentRegistration.Status.MAIN_LIST
        ).count()
        
        max_teams = tournament.planned_participants or 0
        status = (
            TournamentRegistration.Status.MAIN_LIST
            if current_main_count < max_teams
            else TournamentRegistration.Status.RESERVE_LIST
        )
        
        # Создаём регистрацию
        registration = TournamentRegistration.objects.create(
            tournament=tournament,
            player=player,
            team=team,
            status=status
        )
        
        # Синхронизируем с TournamentEntry
        RegistrationService._sync_to_tournament_entry(registration)
        
        return registration
    
    @staticmethod
    @transaction.atomic
    def register_looking_for_partner(
        tournament: Tournament,
        player: Player
    ) -> TournamentRegistration:
        """
        Зарегистрировать игрока в режиме "ищет пару" (для парных турниров).
        
        Args:
            tournament: Турнир
            player: Игрок
            
        Returns:
            TournamentRegistration
            
        Raises:
            ValidationError: если игрок уже зарегистрирован
        """
        # Проверяем, что игрок ещё не зарегистрирован
        existing = TournamentRegistration.objects.filter(
            tournament=tournament,
            player=player
        ).first()
        
        if existing:
            raise ValidationError(f'Игрок {player} уже зарегистрирован на турнир')
        
        # Создаём регистрацию
        registration = TournamentRegistration.objects.create(
            tournament=tournament,
            player=player,
            status=TournamentRegistration.Status.LOOKING_FOR_PARTNER
        )
        
        return registration
    
    @staticmethod
    @transaction.atomic
    def register_with_partner(
        tournament: Tournament,
        player: Player,
        partner: Player,
        notify_partner: bool = True
    ) -> TournamentRegistration:
        """
        Зарегистрировать игрока с напарником.
        Пара сразу попадает в участники (основной состав или резерв).
        
        Args:
            tournament: Турнир
            player: Игрок (инициатор регистрации)
            partner: Напарник
            notify_partner: Отправить уведомление напарнику
            
        Returns:
            TournamentRegistration игрока-инициатора
            
        Raises:
            ValidationError: если игрок или напарник уже зарегистрированы
        """
        # Проверяем, что оба игрока ещё не зарегистрированы
        player_reg = TournamentRegistration.objects.filter(
            tournament=tournament,
            player=player
        ).first()
        
        partner_reg = TournamentRegistration.objects.filter(
            tournament=tournament,
            player=partner
        ).first()
        
        if player_reg:
            raise ValidationError(f'Игрок {player} уже зарегистрирован на турнир')
        
        if partner_reg:
            raise ValidationError(f'Напарник {partner} уже зарегистрирован на турнир')
        
        # Получаем или создаём команду
        team = RegistrationService._get_or_create_team(player, partner)
        
        # Определяем статус (основной состав или резерв)
        current_main_count = TournamentRegistration.objects.filter(
            tournament=tournament,
            status=TournamentRegistration.Status.MAIN_LIST
        ).count()
        
        max_teams = tournament.planned_participants or 0
        status = (
            TournamentRegistration.Status.MAIN_LIST
            if current_main_count < max_teams
            else TournamentRegistration.Status.RESERVE_LIST
        )
        
        # Создаём регистрацию для игрока
        player_registration = TournamentRegistration.objects.create(
            tournament=tournament,
            player=player,
            partner=partner,
            team=team,
            status=status
        )
        
        # Создаём регистрацию для напарника (с тем же порядком)
        partner_registration = TournamentRegistration.objects.create(
            tournament=tournament,
            player=partner,
            partner=player,
            team=team,
            status=status,
            registration_order=player_registration.registration_order
        )
        
        # Синхронизируем с TournamentEntry
        RegistrationService._sync_to_tournament_entry(player_registration)
        
        # Отправляем уведомление напарнику
        if notify_partner:
            from apps.telegram_bot.tasks import send_partner_registration_notification
            transaction.on_commit(lambda: send_partner_registration_notification.delay(partner_registration.id))
        
        return player_registration
    
    @staticmethod
    @transaction.atomic
    def send_pair_invitation(
        tournament: Tournament,
        sender: Player,
        receiver: Player,
        message: str = ''
    ) -> PairInvitation:
        """
        Отправить приглашение в пару.
        
        Args:
            tournament: Турнир
            sender: Отправитель (должен искать пару)
            receiver: Получатель (любой игрок с привязкой к Telegram)
            message: Опциональное сообщение
            
        Returns:
            PairInvitation
            
        Raises:
            ValidationError: если условия не выполнены
        """
        # Проверяем, что отправитель ищет пару
        sender_reg = TournamentRegistration.objects.filter(
            tournament=tournament,
            player=sender,
            status=TournamentRegistration.Status.LOOKING_FOR_PARTNER
        ).first()
        
        if not sender_reg:
            raise ValidationError('Отправитель не зарегистрирован или уже не ищет пару')
        
        # Проверяем статус получателя
        receiver_reg = TournamentRegistration.objects.filter(
            tournament=tournament,
            player=receiver
        ).first()
        
        # Получатель может быть:
        # 1. Не зарегистрирован вообще (receiver_reg is None)
        # 2. Ищет пару (status=LOOKING_FOR_PARTNER)
        # Нельзя приглашать тех, кто уже в паре (MAIN_LIST, RESERVE_LIST)
        if receiver_reg and receiver_reg.status != TournamentRegistration.Status.LOOKING_FOR_PARTNER:
            raise ValidationError('Этот игрок уже зарегистрирован в паре на этот турнир')
        
        # Проверяем, нет ли уже активного приглашения
        existing = PairInvitation.objects.filter(
            tournament=tournament,
            sender=sender,
            receiver=receiver,
            status=PairInvitation.Status.PENDING
        ).first()
        
        if existing:
            raise ValidationError('Приглашение уже отправлено')
        
        # Создаём приглашение
        invitation = PairInvitation.objects.create(
            tournament=tournament,
            sender=sender,
            receiver=receiver,
            message=message
        )
        
        # Отправляем уведомление получателю
        from apps.telegram_bot.tasks import send_pair_invitation_notification
        transaction.on_commit(lambda: send_pair_invitation_notification.delay(invitation.id))
        
        return invitation
    
    @staticmethod
    @transaction.atomic
    def accept_pair_invitation(invitation: PairInvitation) -> Tuple[TournamentRegistration, TournamentRegistration]:
        """
        Принять приглашение в пару.
        Объединяет две регистрации в одну пару.
        
        Args:
            invitation: Приглашение
            
        Returns:
            Tuple[регистрация отправителя, регистрация получателя]
            
        Raises:
            ValidationError: если приглашение не может быть принято
        """
        if invitation.status != PairInvitation.Status.PENDING:
            raise ValidationError('Приглашение уже обработано')
        
        sender = invitation.sender
        receiver = invitation.receiver
        tournament = invitation.tournament
        
        # Получаем регистрацию отправителя
        sender_reg = TournamentRegistration.objects.filter(
            tournament=tournament,
            player=sender
        ).first()
        
        if not sender_reg:
            raise ValidationError('Регистрация отправителя не найдена')
        
        # Получаем или создаём регистрацию получателя
        receiver_reg = TournamentRegistration.objects.filter(
            tournament=tournament,
            player=receiver
        ).first()
        
        if not receiver_reg:
            # Создаём регистрацию для получателя (он не подавал заявку сам)
            receiver_reg = TournamentRegistration.objects.create(
                tournament=tournament,
                player=receiver,
                status=TournamentRegistration.Status.INVITED
            )
        
        # Получаем или создаём команду
        team = RegistrationService._get_or_create_team(sender, receiver)
        
        # Определяем статус (основной состав или резерв)
        current_main_count = TournamentRegistration.objects.filter(
            tournament=tournament,
            status=TournamentRegistration.Status.MAIN_LIST
        ).count()
        
        max_teams = tournament.planned_participants or 0
        status = (
            TournamentRegistration.Status.MAIN_LIST
            if current_main_count < max_teams
            else TournamentRegistration.Status.RESERVE_LIST
        )
        
        # Используем registration_order отправителя (он регистрировался первым)
        registration_order = sender_reg.registration_order
        
        # Обновляем регистрацию отправителя
        sender_reg.partner = receiver
        sender_reg.team = team
        sender_reg.status = status
        sender_reg.save(update_fields=['partner', 'team', 'status', 'updated_at'])
        
        # Обновляем регистрацию получателя
        receiver_reg.partner = sender
        receiver_reg.team = team
        receiver_reg.status = status
        receiver_reg.registration_order = registration_order
        receiver_reg.save(update_fields=['partner', 'team', 'status', 'registration_order', 'updated_at'])
        
        # Обновляем приглашение
        invitation.status = PairInvitation.Status.ACCEPTED
        invitation.responded_at = timezone.now()
        invitation.save(update_fields=['status', 'responded_at'])
        
        # Синхронизируем с TournamentEntry
        RegistrationService._sync_to_tournament_entry(sender_reg)
        
        # Отменяем все другие приглашения для обоих игроков
        PairInvitation.objects.filter(
            tournament=tournament,
            status=PairInvitation.Status.PENDING
        ).filter(
            models.Q(sender=sender) | models.Q(receiver=sender) |
            models.Q(sender=receiver) | models.Q(receiver=receiver)
        ).exclude(id=invitation.id).update(
            status=PairInvitation.Status.CANCELLED,
            responded_at=timezone.now()
        )
        
        # Отправляем уведомление отправителю о принятии
        from apps.telegram_bot.tasks import send_invitation_accepted_notification
        transaction.on_commit(lambda: send_invitation_accepted_notification.delay(invitation.id))
        
        return sender_reg, receiver_reg
    
    @staticmethod
    @transaction.atomic
    def decline_pair_invitation(invitation: PairInvitation):
        """
        Отклонить приглашение в пару.
        
        Args:
            invitation: Приглашение
            
        Raises:
            ValidationError: если приглашение не может быть отклонено
        """
        if invitation.status != PairInvitation.Status.PENDING:
            raise ValidationError('Приглашение уже обработано')
        
        # Обновляем приглашение
        invitation.status = PairInvitation.Status.DECLINED
        invitation.responded_at = timezone.now()
        invitation.save(update_fields=['status', 'responded_at'])
        
        # Проверяем, была ли у получателя регистрация до приглашения
        receiver_reg = TournamentRegistration.objects.filter(
            tournament=invitation.tournament,
            player=invitation.receiver
        ).first()
        
        if receiver_reg:
            # Если получатель сам подавал заявку "ищу пару", возвращаем его в этот статус
            # Если он не подавал заявку (создан при приглашении), удаляем регистрацию
            if receiver_reg.status == TournamentRegistration.Status.INVITED:
                # Проверяем, есть ли другие приглашения для этого игрока
                other_invitations = PairInvitation.objects.filter(
                    tournament=invitation.tournament,
                    receiver=invitation.receiver,
                    status=PairInvitation.Status.PENDING
                ).exclude(id=invitation.id).exists()
                
                if not other_invitations:
                    # Если нет других приглашений и он не подавал заявку сам - удаляем
                    receiver_reg.delete()
            else:
                # Возвращаем в статус "ищет пару"
                receiver_reg.status = TournamentRegistration.Status.LOOKING_FOR_PARTNER
                receiver_reg.save(update_fields=['status', 'updated_at'])
    
    @staticmethod
    @transaction.atomic
    def leave_pair(registration: TournamentRegistration):
        """
        Отказаться от текущей пары (оба игрока переходят в "ищу пару").
        
        Args:
            registration: Регистрация игрока
        """
        tournament = registration.tournament
        partner = registration.partner
        team = registration.team
        
        if not partner:
            raise ValidationError('Вы не состоите в паре')
        
        # Удаляем TournamentEntry если есть команда
        if team:
            TournamentEntry.objects.filter(
                tournament=tournament,
                team=team
            ).delete()
        
        # Находим регистрацию напарника
        partner_reg = TournamentRegistration.objects.filter(
            tournament=tournament,
            player=partner
        ).first()
        
        # Переводим обоих в "ищу пару"
        registration.partner = None
        registration.team = None
        registration.status = TournamentRegistration.Status.LOOKING_FOR_PARTNER
        # Сигнал post_save автоматически вызовет пересчёт, не нужно устанавливать флаг
        registration.save(update_fields=['partner', 'team', 'status', 'updated_at'])
        
        if partner_reg:
            partner_reg.partner = None
            partner_reg.team = None
            partner_reg.status = TournamentRegistration.Status.LOOKING_FOR_PARTNER
            # Сигнал post_save автоматически вызовет пересчёт, не нужно устанавливать флаг
            partner_reg.save(update_fields=['partner', 'team', 'status', 'updated_at'])
            
            # Отправляем уведомление напарнику
            from apps.telegram_bot.tasks import send_partner_left_notification
            transaction.on_commit(lambda: send_partner_left_notification.delay(partner_reg.id))
        
        # Пересчёт статусов будет вызван автоматически через сигнал post_save
    
    @staticmethod
    @transaction.atomic
    def cancel_registration(registration: TournamentRegistration):
        """
        Полностью отменить регистрацию игрока на турнир (покинуть все списки).
        
        Если игрок в паре:
        - Напарник переводится в режим "ищет пару"
        - TournamentEntry удаляется
        - Статусы пересчитываются
        
        Args:
            registration: Регистрация
        """
        tournament = registration.tournament
        partner = registration.partner
        team = registration.team
        
        # Удаляем TournamentEntry если есть команда
        if team:
            TournamentEntry.objects.filter(
                tournament=tournament,
                team=team
            ).delete()
        
        # Если игрок в паре, обновляем регистрацию напарника
        if partner:
            partner_reg = TournamentRegistration.objects.filter(
                tournament=tournament,
                player=partner
            ).first()
            
            if partner_reg:
                partner_reg.partner = None
                partner_reg.team = None
                partner_reg.status = TournamentRegistration.Status.LOOKING_FOR_PARTNER
                # Сигнал post_save автоматически вызовет пересчёт
                partner_reg.save(update_fields=['partner', 'team', 'status', 'updated_at'])
                
                # Отправляем уведомление напарнику
                from apps.telegram_bot.tasks import send_partner_cancelled_notification
                transaction.on_commit(lambda: send_partner_cancelled_notification.delay(partner_reg.id))
        
        # Удаляем регистрацию - сигнал post_delete автоматически вызовет пересчёт
        registration.delete()
    
    @staticmethod
    @transaction.atomic
    def update_tournament_max_teams(tournament: Tournament, new_max_teams: int):
        """
        Обновить planned_participants турнира и пересчитать статусы регистраций.
        
        Args:
            tournament: Турнир
            new_max_teams: Новое количество участников
        """
        tournament.planned_participants = new_max_teams
        tournament.save(update_fields=['planned_participants'])
        
        # Пересчитываем статусы всех регистраций
        RegistrationService._recalculate_registration_statuses(tournament)
        
        # Синхронизируем с TournamentEntry
        registrations = TournamentRegistration.objects.filter(
            tournament=tournament,
            status__in=[
                TournamentRegistration.Status.MAIN_LIST,
                TournamentRegistration.Status.RESERVE_LIST
            ]
        )
        
        for reg in registrations:
            RegistrationService._sync_to_tournament_entry(reg)
    
    @staticmethod
    @transaction.atomic
    def sync_tournament_entry_to_registration(tournament_entry: TournamentEntry):
        """
        Синхронизировать TournamentEntry с TournamentRegistration.
        Вызывается при добавлении участника через основной интерфейс.
        
        Логика: создаётся ОДНА запись для команды (пары или одиночки).
        
        Args:
            tournament_entry: Запись TournamentEntry
        """
        tournament = tournament_entry.tournament
        team = tournament_entry.team
        
        if not team:
            return
        
        # Проверяем, есть ли уже регистрация для этой команды
        existing_reg = TournamentRegistration.objects.filter(
            tournament=tournament,
            team=team
        ).first()
        
        if existing_reg:
            # Обновляем существующую регистрацию
            # Пересчитываем статусы всех регистраций
            RegistrationService._recalculate_registration_statuses(tournament)
            return
        
        # Определяем статус (основной состав или резерв)
        # Считаем команды, а не отдельных игроков
        current_main_count = TournamentRegistration.objects.filter(
            tournament=tournament,
            status=TournamentRegistration.Status.MAIN_LIST
        ).values('team').distinct().count()
        
        max_teams = tournament.planned_participants or 0
        status = (
            TournamentRegistration.Status.MAIN_LIST
            if current_main_count < max_teams
            else TournamentRegistration.Status.RESERVE_LIST
        )
        
        # Создаём ОДНУ регистрацию для команды
        # player указывает на player_1, partner на player_2 (если есть)
        TournamentRegistration.objects.create(
            tournament=tournament,
            player=team.player_1,
            partner=team.player_2,
            team=team,
            status=status
        )

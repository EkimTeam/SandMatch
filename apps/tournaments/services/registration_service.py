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
import threading
import uuid
from contextvars import ContextVar

from apps.tournaments.registration_models import TournamentRegistration, PairInvitation
from apps.tournaments.models import Tournament, TournamentEntry
from apps.teams.models import Team
from apps.players.models import Player

# Контекстная переменная для transaction_id (работает с async/sync)
_transaction_id_context: ContextVar[Optional[str]] = ContextVar('transaction_id', default=None)


class RegistrationService:
    """Сервис для управления регистрацией на турниры"""
    
    @staticmethod
    def _mark_skip_announcement(instance):
        """Пометить экземпляр для пропуска анонса в сигнале"""
        instance._skip_announcement = True
    
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
        # Получаем все регистрации основного и резервного списка
        registrations = TournamentRegistration.objects.filter(
            tournament=tournament,
            status__in=[
                TournamentRegistration.Status.MAIN_LIST,
                TournamentRegistration.Status.RESERVE_LIST,
            ],
        ).order_by('registration_order', 'registered_at')

        max_teams = tournament.planned_participants or 0

        # Работает по КОМАНДАМ, а не по отдельным строкам регистрации.
        # Важный инвариант: если основной список уже заполнен (есть max_teams
        # команд со статусом MAIN_LIST), формирование новых пар не должно
        # вытеснять существующие команды в резерв только из-за более раннего
        # registration_order (например, когда игрок давно был в LOOKING_FOR_PARTNER).

        # Шаг 1. Собираем команды в порядке регистрации.
        teams_ordered: list[int] = []
        team_current_status: dict[int, str] = {}

        for reg in registrations:
            team_id = reg.team_id or reg.id  # подстраховка на случай отсутствия team

            if team_id not in team_current_status:
                team_current_status[team_id] = reg.status
                teams_ordered.append(team_id)

        # Делим команды на текущие MAIN и RESERVE в порядке регистрации.
        main_teams: list[int] = [tid for tid in teams_ordered if team_current_status[tid] == TournamentRegistration.Status.MAIN_LIST]
        reserve_teams: list[int] = [tid for tid in teams_ordered if team_current_status[tid] == TournamentRegistration.Status.RESERVE_LIST]

        # Шаг 2. Определяем желаемый статус для каждой команды.
        desired_team_status: dict[int, str] = {}

        # Если текущих MAIN больше, чем лимит, оставляем в MAIN только
        # самые ранние по очереди, остальные отправляем в резерв.
        if len(main_teams) > max_teams:
            keep_main = set(main_teams[:max_teams])
            for tid in main_teams:
                desired_team_status[tid] = (
                    TournamentRegistration.Status.MAIN_LIST
                    if tid in keep_main
                    else TournamentRegistration.Status.RESERVE_LIST
                )
        else:
            # Иначе все текущие MAIN остаются MAIN.
            for tid in main_teams:
                desired_team_status[tid] = TournamentRegistration.Status.MAIN_LIST

            # Считаем, сколько слотов в основном списке ещё свободно.
            remaining_slots = max_teams - len(main_teams)

            # Заполняем оставшиеся слоты резервными командами по очереди.
            for tid in reserve_teams:
                if remaining_slots > 0:
                    desired_team_status[tid] = TournamentRegistration.Status.MAIN_LIST
                    remaining_slots -= 1
                else:
                    desired_team_status[tid] = TournamentRegistration.Status.RESERVE_LIST

        # На всякий случай для команд без явного решения сохраняем текущий статус.
        for tid in teams_ordered:
            if tid not in desired_team_status:
                desired_team_status[tid] = team_current_status.get(tid, TournamentRegistration.Status.RESERVE_LIST)

        # Шаг 3. Применяем изменения к записям регистрации.
        for reg in registrations:
            team_id = reg.team_id or reg.id
            new_status = desired_team_status.get(team_id, reg.status)

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
        # Считаем количество КОМАНД в основном списке, а не количество записей регистрации.
        current_main_count = (
            TournamentRegistration.objects
            .filter(
                tournament=tournament,
                status=TournamentRegistration.Status.MAIN_LIST,
            )
            .values('team_id')
            .distinct()
            .count()
        )
        
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
            ValidationError: если игрок или напарник уже состоят в паре на этот турнир
        """
        # Получаем существующие регистрации (если есть)
        player_reg = TournamentRegistration.objects.filter(
            tournament=tournament,
            player=player
        ).first()

        partner_reg = TournamentRegistration.objects.filter(
            tournament=tournament,
            player=partner
        ).first()

        # Нельзя формировать пару, если кто-то уже в основной/резервной паре
        forbidden_statuses = {
            TournamentRegistration.Status.MAIN_LIST,
            TournamentRegistration.Status.RESERVE_LIST,
        }

        if player_reg and player_reg.status in forbidden_statuses:
            raise ValidationError(f'Игрок {player} уже зарегистрирован в паре на этот турнир')

        if partner_reg and partner_reg.status in forbidden_statuses:
            raise ValidationError(f'Напарник {partner} уже зарегистрирован в паре на этот турнир')

        # Получаем или создаём команду
        team = RegistrationService._get_or_create_team(player, partner)

        # Определяем статус (основной состав или резерв)
        # Считаем количество КОМАНД в основном списке, а не количество записей регистрации.
        current_main_count = (
            TournamentRegistration.objects
            .filter(
                tournament=tournament,
                status=TournamentRegistration.Status.MAIN_LIST,
            )
            .values('team_id')
            .distinct()
            .count()
        )

        max_teams = tournament.planned_participants or 0
        status = (
            TournamentRegistration.Status.MAIN_LIST
            if current_main_count < max_teams
            else TournamentRegistration.Status.RESERVE_LIST
        )

        # Базовый registration_order: НОВАЯ пара всегда встаёт в КОНЕЦ очереди.
        # Игроки из LOOKING_FOR_PARTNER могли иметь старый registration_order,
        # но он не должен вытеснять уже сформированные команды из основного состава.
        from django.db.models import Max

        max_order = (
            TournamentRegistration.objects
            .filter(tournament=tournament)
            .aggregate(Max("registration_order"))
            .get("registration_order__max")
            or 0
        )
        registration_order: int = max_order + 1

        # Обновляем/создаём регистрацию для инициатора
        if player_reg and player_reg.status == TournamentRegistration.Status.LOOKING_FOR_PARTNER:
            player_registration = player_reg
            player_registration.partner = partner
            player_registration.team = team
            player_registration.status = status
            player_registration.registration_order = registration_order
            # Помечаем для пропуска анонса в сигнале
            RegistrationService._mark_skip_announcement(player_registration)
            player_registration.save(update_fields=[
                'partner',
                'team',
                'status',
                'registration_order',
                'updated_at',
            ])
        else:
            # Создаём объект без сохранения, помечаем флагом, затем сохраняем
            player_registration = TournamentRegistration(
                tournament=tournament,
                player=player,
                partner=partner,
                team=team,
                status=status,
                registration_order=registration_order,
            )
            # Помечаем для пропуска анонса в сигнале ДО сохранения
            RegistrationService._mark_skip_announcement(player_registration)
            player_registration.save()

        # Обновляем/создаём регистрацию для напарника
        if partner_reg and partner_reg.status == TournamentRegistration.Status.LOOKING_FOR_PARTNER:
            partner_registration = partner_reg
            partner_registration.partner = player
            partner_registration.team = team
            partner_registration.status = status
            partner_registration.registration_order = registration_order
            # Помечаем для пропуска анонса в сигнале
            RegistrationService._mark_skip_announcement(partner_registration)
            partner_registration.save(update_fields=[
                'partner',
                'team',
                'status',
                'registration_order',
                'updated_at',
            ])
        else:
            # Создаём объект без сохранения, помечаем флагом, затем сохраняем
            partner_registration = TournamentRegistration(
                tournament=tournament,
                player=partner,
                partner=player,
                team=team,
                status=status,
                registration_order=registration_order,
            )
            # Помечаем для пропуска анонса в сигнале ДО сохранения
            RegistrationService._mark_skip_announcement(partner_registration)
            partner_registration.save()

        # Синхронизируем с TournamentEntry
        RegistrationService._sync_to_tournament_entry(player_registration)

        # Отправляем анонс об изменении состава ОДИН РАЗ после завершения парной операции
        from apps.telegram_bot.tasks import send_tournament_announcement_to_chat
        transaction.on_commit(
            lambda: send_tournament_announcement_to_chat.delay(tournament.id, 'roster_change')
        )

        # Отправляем уведомление напарнику о том, что инициатор его зарегистрировал
        # Передаём player_registration.id, чтобы в уведомлении было:
        # "Игрок {player} зарегистрировал вас (partner) в паре"
        if notify_partner:
            from apps.telegram_bot.tasks import send_partner_registration_notification
            # Захватываем ID для lambda
            reg_id = player_registration.id
            transaction.on_commit(lambda: send_partner_registration_notification.delay(reg_id))

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
        
        # Находим регистрацию напарника
        partner_reg = TournamentRegistration.objects.filter(
            tournament=tournament,
            player=partner
        ).first()
        
        # ВАЖНО: Сначала обнуляем team и меняем статус у ОБЕИХ регистраций,
        # и только потом удаляем TournamentEntry.
        # Иначе сигнал post_delete для TournamentEntry удалит регистрации,
        # которые ещё имеют ссылку на team и статус MAIN_LIST/RESERVE_LIST.
        
        # Переводим обоих в "ищу пару"
        registration.partner = None
        registration.team = None
        registration.status = TournamentRegistration.Status.LOOKING_FOR_PARTNER
        # Помечаем для пропуска анонса в сигнале
        RegistrationService._mark_skip_announcement(registration)
        # Сигнал post_save автоматически вызовет пересчёт
        registration.save()
        
        if partner_reg:
            partner_reg.partner = None
            partner_reg.team = None
            partner_reg.status = TournamentRegistration.Status.LOOKING_FOR_PARTNER
            # Помечаем для пропуска анонса в сигнале
            RegistrationService._mark_skip_announcement(partner_reg)
            # Сигнал post_save автоматически вызовет пересчёт
            partner_reg.save()
            
            # Отправляем уведомление напарнику
            from apps.telegram_bot.tasks import send_partner_left_notification
            transaction.on_commit(lambda: send_partner_left_notification.delay(partner_reg.id))
        
        # Теперь безопасно удаляем TournamentEntry
        # (регистрации уже не имеют ссылки на team, поэтому сигнал post_delete их не затронет)
        if team:
            TournamentEntry.objects.filter(
                tournament=tournament,
                team=team
            ).delete()
        
        # Отправляем анонс об изменении состава ОДИН РАЗ после завершения парной операции
        from apps.telegram_bot.tasks import send_tournament_announcement_to_chat
        transaction.on_commit(
            lambda: send_tournament_announcement_to_chat.delay(tournament.id, 'roster_change')
        )
        
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

        # Помечаем для пропуска анонса в сигнале post_delete
        RegistrationService._mark_skip_announcement(registration)

        # Удаляем TournamentEntry если есть команда
        if team:
            TournamentEntry.objects.filter(
                tournament=tournament,
                team=team
            ).delete()

        # Удаляем регистрацию текущего игрока - сигнал post_delete автоматически вызовет пересчёт
        registration.delete()

        # Если игрок был в паре, после полной отмены регистрации
        # явно регистрируем напарника в режиме "ищет пару".
        # Это эквивалентно нажатию кнопки "Зарегистрироваться без пары" за напарника
        # и не зависит от того, что могло сделать удаление TournamentEntry через сигналы.
        if partner:
            from django.core.exceptions import ValidationError

            try:
                # Пытаемся создать/обновить регистрацию напарника как "ищет пару"
                RegistrationService.register_looking_for_partner(tournament, partner)
            except ValidationError:
                # Если по каким-то причинам напарник не может быть зарегистрирован
                # (например, турнир заблокирован для регистраций), просто игнорируем
                # эту ошибку, чтобы не ломать отмену регистрации инициатора.
                pass
        
        # Отправляем анонс об изменении состава ОДИН РАЗ после завершения операции
        from apps.telegram_bot.tasks import send_tournament_announcement_to_chat
        transaction.on_commit(
            lambda: send_tournament_announcement_to_chat.delay(tournament.id, 'roster_change')
        )
    
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
        import logging
        logger = logging.getLogger(__name__)
        
        tournament = tournament_entry.tournament
        team = tournament_entry.team
        
        logger.info(f"[SYNC_TO_REG] Начало синхронизации TournamentEntry {tournament_entry.id} для турнира {tournament.id}, team: {team}")
        
        if not team:
            logger.info(f"[SYNC_TO_REG] Нет команды, пропускаем")
            return
        
        # Проверяем, есть ли уже регистрация для этой команды
        existing_reg = TournamentRegistration.objects.filter(
            tournament=tournament,
            team=team
        ).first()
        
        if existing_reg:
            logger.info(f"[SYNC_TO_REG] Регистрация уже существует (ID: {existing_reg.id}), пересчитываем статусы")
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
        
        logger.info(f"[SYNC_TO_REG] Создаём новую регистрацию, статус: {status}, current_main_count: {current_main_count}, max_teams: {max_teams}")
        
        # Создаём ОДНУ регистрацию для команды
        # player указывает на player_1, partner на player_2 (если есть)
        reg = TournamentRegistration.objects.create(
            tournament=tournament,
            player=team.player_1,
            partner=team.player_2,
            team=team,
            status=status
        )
        
        logger.info(f"[SYNC_TO_REG] Регистрация создана (ID: {reg.id}), статус: {reg.status}")

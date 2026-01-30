"""
Сервис для отправки уведомлений через Telegram бота
"""
import os
import logging
from typing import List, Optional
from datetime import datetime, timedelta

from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.utils.markdown import hbold
from asgiref.sync import sync_to_async

from apps.telegram_bot.models import TelegramUser, NotificationLog

logger = logging.getLogger(__name__)


class NotificationService:
    """Сервис для отправки уведомлений"""
    
    def __init__(self):
        self.bot_token = os.getenv('TELEGRAM_BOT_TOKEN')
        if not self.bot_token:
            raise ValueError("TELEGRAM_BOT_TOKEN не установлен")
        
        self.bot = Bot(
            token=self.bot_token,
            default=DefaultBotProperties(parse_mode=ParseMode.HTML)
        )
        self.web_app_url = os.getenv('WEB_APP_URL', 'https://beachplay.ru')
    
    async def send_notification(
        self,
        telegram_user: TelegramUser,
        message: str,
        notification_type: str,
        tournament=None
    ) -> bool:
        """
        Отправка уведомления пользователю
        
        Args:
            telegram_user: пользователь Telegram
            message: текст сообщения
            notification_type: тип уведомления
            tournament: турнир (опционально)
            
        Returns:
            True если успешно, False если ошибка
        """
        # Проверяем, что уведомления включены
        if not telegram_user.notifications_enabled:
            return False
        
        # Проверяем, что пользователь не заблокировал бота
        if telegram_user.is_blocked:
            return False
        
        try:
            await self.bot.send_message(
                chat_id=telegram_user.telegram_id,
                text=message
            )
            
            # Логируем успешную отправку
            await self._log_notification(
                telegram_user=telegram_user,
                notification_type=notification_type,
                tournament=tournament,
                success=True
            )
            
            return True
            
        except Exception as e:
            logger.error(f"Ошибка отправки уведомления {telegram_user.telegram_id}: {e}")
            
            # Если бот заблокирован пользователем
            if "bot was blocked by the user" in str(e).lower():
                await self._mark_user_blocked(telegram_user)
            
            # Логируем ошибку
            await self._log_notification(
                telegram_user=telegram_user,
                notification_type=notification_type,
                tournament=tournament,
                success=False,
                error_message=str(e)
            )
            
            return False
    
    async def notify_new_tournament(self, tournament) -> int:
        """
        Уведомление о новом турнире
        
        Args:
            tournament: объект Tournament
            
        Returns:
            количество отправленных уведомлений
        """
        # Получаем пользователей для уведомления
        users = await self._get_users_for_tournament_notification(tournament)
        
        message = (
            f"🆕 {hbold('Новый турнир!')}\n\n"
            f"{hbold(tournament.name)}\n"
        )
        
        if tournament.date:
            message += f"📅 Дата: {tournament.date.strftime('%d.%m.%Y')}\n"
        
        if tournament.venue:
            message += f"📍 Площадка: {tournament.venue.name}\n"
        
        message += f"\n🔗 Подробнее: {self.web_app_url}/tournaments/{tournament.id}"
        
        sent_count = 0
        for user in users:
            if user.notify_tournament_open:
                success = await self.send_notification(
                    telegram_user=user,
                    message=message,
                    notification_type='new_tournament',
                    tournament=tournament
                )
                if success:
                    sent_count += 1
        
        return sent_count
    
    async def notify_tournament_starting_soon(self, tournament, hours_before: int = 24) -> int:
        """
        Напоминание о начале турнира
        
        Args:
            tournament: объект Tournament
            hours_before: за сколько часов напомнить
            
        Returns:
            количество отправленных уведомлений
        """
        # Получаем участников турнира
        users = await self._get_tournament_participants(tournament)
        
        time_text = f"{hours_before} часов" if hours_before > 1 else "1 час"
        
        message = (
            f"⏰ {hbold('Напоминание о турнире')}\n\n"
            f"{hbold(tournament.name)}\n"
            f"Начало через {time_text}!\n"
        )
        
        if tournament.date:
            message += f"📅 {tournament.date.strftime('%d.%m.%Y в %H:%M')}\n"
        
        if tournament.venue:
            message += f"📍 {tournament.venue.name}\n"
        
        message += f"\n🔗 Подробнее: {self.web_app_url}/tournaments/{tournament.id}"
        
        sent_count = 0
        for user in users:
            if user.notify_tournament_start:
                success = await self.send_notification(
                    telegram_user=user,
                    message=message,
                    notification_type='tournament_reminder',
                    tournament=tournament
                )
                if success:
                    sent_count += 1
        
        return sent_count
    
    async def notify_match_result(self, match) -> int:
        """
        Уведомление о результате матча
        
        Args:
            match: объект Match
            
        Returns:
            количество отправленных уведомлений
        """
        # Получаем игроков из команд
        users = await self._get_match_participants(match)
        
        message = (
            f"✅ {hbold('Результат матча')}\n\n"
            f"{hbold(match.tournament.name)}\n"
        )
        
        if match.team1 and match.team2:
            message += f"\n{match.team1} vs {match.team2}\n"
        
        if match.score:
            message += f"Счёт: {hbold(match.score)}\n"
        
        message += f"\n🔗 Подробнее: {self.web_app_url}/tournaments/{match.tournament.id}"
        
        sent_count = 0
        for user in users:
            if user.notify_match_result:
                success = await self.send_notification(
                    telegram_user=user,
                    message=message,
                    notification_type='match_result',
                    tournament=match.tournament
                )
                if success:
                    sent_count += 1
        
        return sent_count
    
    @sync_to_async
    def _get_users_for_tournament_notification(self, tournament) -> List[TelegramUser]:
        """Получение пользователей для уведомления о новом турнире"""
        from apps.telegram_bot.models import TournamentSubscription
        from django.db.models import Q
        
        # Пользователи, подписанные на организатора или площадку
        subscriptions = TournamentSubscription.objects.filter(
            Q(organizer=tournament.organizer) |
            Q(venue=tournament.venue)
        ).select_related('telegram_user')
        
        return [sub.telegram_user for sub in subscriptions]
    
    @sync_to_async
    def _get_tournament_participants(self, tournament) -> List[TelegramUser]:
        """Получение участников турнира"""
        from apps.tournaments.models import TournamentEntry
        from apps.teams.models import Team
        from django.db.models import Q
        
        # Получаем команды турнира
        entries = TournamentEntry.objects.filter(
            tournament=tournament
        ).select_related('team')
        
        team_ids = [entry.team_id for entry in entries]
        
        # Получаем игроков из команд
        teams = Team.objects.filter(id__in=team_ids)
        player_ids = set()
        for team in teams:
            if team.player_1_id:
                player_ids.add(team.player_1_id)
            if team.player_2_id:
                player_ids.add(team.player_2_id)
        
        # Получаем TelegramUser по player_id
        return list(
            TelegramUser.objects.filter(
                player_id__in=player_ids,
                notifications_enabled=True,
                is_blocked=False
            )
        )
    
    @sync_to_async
    def _get_match_participants(self, match) -> List[TelegramUser]:
        """Получение участников матча"""
        from django.db.models import Q
        
        player_ids = set()
        
        if match.team1:
            if match.team1.player_1_id:
                player_ids.add(match.team1.player_1_id)
            if match.team1.player_2_id:
                player_ids.add(match.team1.player_2_id)
        
        if match.team2:
            if match.team2.player_1_id:
                player_ids.add(match.team2.player_1_id)
            if match.team2.player_2_id:
                player_ids.add(match.team2.player_2_id)
        
        return list(
            TelegramUser.objects.filter(
                player_id__in=player_ids,
                notifications_enabled=True,
                is_blocked=False
            )
        )
    
    @sync_to_async
    def _log_notification(
        self,
        telegram_user: TelegramUser,
        notification_type: str,
        tournament=None,
        success: bool = True,
        error_message: str = ""
    ):
        """Логирование отправленного уведомления"""
        NotificationLog.objects.create(
            telegram_user=telegram_user,
            notification_type=notification_type,
            tournament=tournament,
            success=success,
            error_message=error_message
        )
    
    @sync_to_async
    def _mark_user_blocked(self, telegram_user: TelegramUser):
        """Пометить пользователя как заблокировавшего бота"""
        telegram_user.is_blocked = True
        telegram_user.save(update_fields=['is_blocked'])
    
    async def notify_pair_invitation(self, invitation) -> int:
        """
        Уведомление о приглашении в пару
        
        Args:
            invitation: объект PairInvitation
            
        Returns:
            количество отправленных уведомлений
        """
        # Получаем TelegramUser получателя
        user = await self._get_telegram_user_by_player(invitation.receiver_id)
        if not user:
            return 0
        
        message = (
            f"🤝 {hbold('Приглашение в пару!')}\n\n"
            f"{hbold(invitation.sender.get_full_name())} приглашает вас сыграть в паре\n"
            f"на турнире {hbold(invitation.tournament.name)}\n"
        )
        
        if invitation.message:
            message += f"\n💬 Сообщение: {invitation.message}\n"
        
        message += (
            f"\n📅 Дата турнира: {invitation.tournament.date.strftime('%d.%m.%Y')}\n"
            f"\n🔗 Открыть Mini App для ответа: {self.web_app_url}/mini-app/invitations"
        )
        
        success = await self.send_notification(
            telegram_user=user,
            message=message,
            notification_type='pair_invitation',
            tournament=invitation.tournament
        )
        
        return 1 if success else 0
    
    async def notify_invitation_accepted(self, invitation) -> int:
        """
        Уведомление о принятии приглашения
        
        Args:
            invitation: объект PairInvitation
            
        Returns:
            количество отправленных уведомлений
        """
        # Получаем TelegramUser отправителя
        user = await self._get_telegram_user_by_player(invitation.sender_id)
        if not user:
            return 0
        
        message = (
            f"✅ {hbold('Приглашение принято!')}\n\n"
            f"{hbold(invitation.receiver.get_full_name())} принял ваше приглашение!\n"
            f"Турнир: {hbold(invitation.tournament.name)}\n"
            f"📅 {invitation.tournament.date.strftime('%d.%m.%Y')}\n"
            f"\n🔗 Подробнее: {self.web_app_url}/tournaments/{invitation.tournament.id}"
        )
        
        success = await self.send_notification(
            telegram_user=user,
            message=message,
            notification_type='invitation_accepted',
            tournament=invitation.tournament
        )
        
        return 1 if success else 0
    
    async def notify_partner_registration(self, registration) -> int:
        """
        Уведомление напарнику о регистрации
        
        Args:
            registration: объект TournamentRegistration
            
        Returns:
            количество отправленных уведомлений
        """
        if not registration.partner:
            return 0
        
        # Получаем TelegramUser напарника
        user = await self._get_telegram_user_by_player(registration.partner_id)
        if not user:
            return 0
        
        status_text = {
            'main_list': 'основной состав',
            'reserve_list': 'резервный список',
        }.get(registration.status, registration.get_status_display())

        # Формируем отображаемое имя игрока
        player = registration.player
        player_name = (
            getattr(player, 'display_name', None)
            or f"{getattr(player, 'first_name', '')} {getattr(player, 'last_name', '')}".strip()
            or "Игрок"
        )
        
        message = (
            f"🎾 {hbold('Регистрация на турнир')}\n\n"
            f"{hbold(player_name)} зарегистрировал вас в паре\n"
            f"на турнир {hbold(registration.tournament.name)}\n"
            f"📅 {registration.tournament.date.strftime('%d.%m.%Y')}\n"
            f"\n📋 Статус: {hbold(status_text)}\n"
            f"\n🔗 Подробнее: {self.web_app_url}/tournaments/{registration.tournament.id}"
        )
        
        success = await self.send_notification(
            telegram_user=user,
            message=message,
            notification_type='partner_registration',
            tournament=registration.tournament
        )
        
        return 1 if success else 0
    
    async def notify_status_changed(self, registration, old_status: str, new_status: str) -> int:
        """
        Уведомление об изменении статуса регистрации
        
        Args:
            registration: объект TournamentRegistration
            old_status: старый статус
            new_status: новый статус
            
        Returns:
            количество отправленных уведомлений
        """
        # Отправляем уведомления обоим игрокам
        player_ids = [registration.player_id]
        if registration.partner_id:
            player_ids.append(registration.partner_id)
        
        users = await self._get_telegram_users_by_players(player_ids)
        
        status_text = {
            'main_list': 'основной состав',
            'reserve_list': 'резервный список',
            'looking_for_partner': 'ищет пару',
        }.get(new_status, new_status)
        
        # Определяем emoji в зависимости от изменения статуса
        emoji = "📋"
        if old_status == 'reserve_list' and new_status == 'main_list':
            emoji = "🎉"
            status_text = f"переведены в {hbold('основной состав')}"
        elif old_status == 'main_list' and new_status == 'reserve_list':
            emoji = "⚠️"
            status_text = f"переведены в {hbold('резервный список')}"
        else:
            status_text = f"изменён на {hbold(status_text)}"
        
        message = (
            f"{emoji} {hbold('Изменение статуса регистрации')}\n\n"
            f"Турнир: {hbold(registration.tournament.name)}\n"
            f"📅 {registration.tournament.date.strftime('%d.%m.%Y')}\n"
            f"\nВаш статус {status_text}\n"
            f"\n🔗 Подробнее: {self.web_app_url}/tournaments/{registration.tournament.id}"
        )
        
        sent_count = 0
        for user in users:
            success = await self.send_notification(
                telegram_user=user,
                message=message,
                notification_type='status_changed',
                tournament=registration.tournament
            )
            if success:
                sent_count += 1
        
        return sent_count
    
    @sync_to_async
    def _get_telegram_user_by_player(self, player_id: int) -> Optional[TelegramUser]:
        """Получение TelegramUser по player_id"""
        try:
            return TelegramUser.objects.get(
                player_id=player_id,
                notifications_enabled=True,
                is_blocked=False
            )
        except TelegramUser.DoesNotExist:
            return None
    
    @sync_to_async
    def _get_telegram_users_by_players(self, player_ids: List[int]) -> List[TelegramUser]:
        """Получение TelegramUser по списку player_id"""
        return list(
            TelegramUser.objects.filter(
                player_id__in=player_ids,
                notifications_enabled=True,
                is_blocked=False
            )
        )
    
    async def close(self):
        """Закрытие сессии бота"""
        await self.bot.session.close()

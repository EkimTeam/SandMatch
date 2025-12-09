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
    
    async def close(self):
        """Закрытие сессии бота"""
        await self.bot.session.close()

"""
Обработчики команд для работы с турнирами
"""
from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.utils.markdown import hbold, hcode
from asgiref.sync import sync_to_async
from django.db.models import Q, Count

from apps.telegram_bot.models import TelegramUser
from apps.tournaments.models import Tournament, TournamentEntry
from apps.teams.models import Team

router = Router()


@sync_to_async
def get_telegram_user(telegram_id):
    """Получение Telegram пользователя"""
    try:
        return TelegramUser.objects.select_related('user', 'player').get(telegram_id=telegram_id)
    except TelegramUser.DoesNotExist:
        return None


@sync_to_async
def get_active_tournaments():
    """Получение списка активных турниров"""
    return list(
        Tournament.objects.filter(
            Q(status='created') | Q(status='active')
        ).annotate(
            participants_count=Count('entries')
        ).order_by('-date', '-created_at')[:10]
    )


@sync_to_async
def get_user_tournaments(player_id):
    """Получение турниров пользователя"""
    if not player_id:
        return []
    
    # Находим команды игрока
    team_ids = Team.objects.filter(
        Q(player_1_id=player_id) | Q(player_2_id=player_id)
    ).values_list('id', flat=True)
    
    # Находим турниры через участников
    tournament_ids = TournamentEntry.objects.filter(
        team_id__in=team_ids
    ).values_list('tournament_id', flat=True).distinct()
    
    return list(
        Tournament.objects.filter(
            id__in=tournament_ids
        ).annotate(
            participants_count=Count('entries')
        ).order_by('-date', '-created_at')[:10]
    )


@sync_to_async
def check_registration(tournament_id, player_id):
    """Проверка регистрации игрока на турнир"""
    if not player_id:
        return False
    
    team_ids = Team.objects.filter(
        Q(player_1_id=player_id) | Q(player_2_id=player_id)
    ).values_list('id', flat=True)
    
    return TournamentEntry.objects.filter(
        tournament_id=tournament_id,
        team_id__in=team_ids
    ).exists()


def format_tournament_info(tournament, is_registered=False):
    """Форматирование информации о турнире"""
    system_names = {
        'round_robin': '⟳ Круговая',
        'knockout': '🏆 Олимпийская',
        'king': '👑 Кинг',
    }
    
    status_names = {
        'created': '📝 Набор участников',
        'active': '▶️ В процессе',
        'completed': '✅ Завершён',
    }
    
    mode_names = {
        'singles': '1️⃣ Одиночный',
        'doubles': '2️⃣ Парный',
    }
    
    text = f"{hbold(tournament.name)}\n\n"
    
    if tournament.date:
        text += f"📅 Дата: {tournament.date.strftime('%d.%m.%Y')}\n"
    
    text += f"🎯 Система: {system_names.get(tournament.system, tournament.system)}\n"
    text += f"👥 Формат: {mode_names.get(tournament.participant_mode, tournament.participant_mode)}\n"
    text += f"📊 Статус: {status_names.get(tournament.status, tournament.status)}\n"
    
    if hasattr(tournament, 'participants_count'):
        text += f"👤 Участников: {tournament.participants_count}"
        if tournament.planned_participants:
            text += f"/{tournament.planned_participants}"
        text += "\n"
    
    if is_registered:
        text += f"\n✅ {hbold('Ты зарегистрирован')}\n"
    
    return text


@router.message(Command("tournaments"))
async def cmd_tournaments(message: Message):
    """
    Обработка команды /tournaments
    Показывает список активных турниров
    """
    telegram_user = await get_telegram_user(message.from_user.id)
    
    if not telegram_user:
        await message.answer(
            "❌ Ошибка: твой Telegram аккаунт не найден в системе.\n"
            "Отправь /start для регистрации."
        )
        return
    
    tournaments = await get_active_tournaments()
    
    if not tournaments:
        await message.answer(
            "📋 Активных турниров пока нет.\n\n"
            "Следи за обновлениями на сайте beachplay.ru"
        )
        return
    
    player_id = telegram_user.player_id if telegram_user.player else None
    
    await message.answer(f"{hbold('🏆 Активные турниры')}\n")
    
    for tournament in tournaments:
        is_registered = await check_registration(tournament.id, player_id)
        text = format_tournament_info(tournament, is_registered)
        
        # Создаём inline-кнопки
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="📋 Подробнее",
                    url=f"http://localhost:8080/tournaments/{tournament.id}"
                )
            ]
        ])
        
        # Добавляем кнопку регистрации, если турнир в статусе набора и игрок не зарегистрирован
        if tournament.status == 'created' and player_id and not is_registered:
            keyboard.inline_keyboard.insert(0, [
                InlineKeyboardButton(
                    text="✅ Зарегистрироваться",
                    callback_data=f"register_{tournament.id}"
                )
            ])
        
        await message.answer(text, reply_markup=keyboard)


@router.message(Command("mytournaments"))
async def cmd_my_tournaments(message: Message):
    """
    Обработка команды /mytournaments
    Показывает турниры пользователя
    """
    telegram_user = await get_telegram_user(message.from_user.id)
    
    if not telegram_user:
        await message.answer(
            "❌ Ошибка: твой Telegram аккаунт не найден в системе.\n"
            "Отправь /start для регистрации."
        )
        return
    
    if not telegram_user.user:
        await message.answer(
            "⚠️ Твой Telegram не связан с аккаунтом на сайте.\n\n"
            "Для связывания используй /link"
        )
        return
    
    if not telegram_user.player:
        await message.answer(
            "⚠️ Профиль игрока не связан с аккаунтом.\n\n"
            "Свяжи профиль на сайте: beachplay.ru/profile"
        )
        return
    
    tournaments = await get_user_tournaments(telegram_user.player_id)
    
    if not tournaments:
        await message.answer(
            "📋 Ты пока не участвуешь ни в одном турнире.\n\n"
            "Используй /tournaments для просмотра активных турниров"
        )
        return
    
    await message.answer(f"{hbold('🏆 Мои турниры')}\n")
    
    for tournament in tournaments:
        text = format_tournament_info(tournament, is_registered=True)
        
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="📋 Подробнее",
                    url=f"http://localhost:8080/tournaments/{tournament.id}"
                )
            ]
        ])
        
        await message.answer(text, reply_markup=keyboard)


@router.callback_query(F.data.startswith("register_"))
async def callback_register(callback: CallbackQuery):
    """
    Обработка callback для регистрации на турнир
    """
    tournament_id = int(callback.data.split("_")[1])
    
    telegram_user = await get_telegram_user(callback.from_user.id)
    
    if not telegram_user or not telegram_user.player:
        await callback.answer(
            "⚠️ Для регистрации свяжи профиль игрока на сайте",
            show_alert=True
        )
        return
    
    # Проверяем, не зарегистрирован ли уже
    is_registered = await check_registration(tournament_id, telegram_user.player_id)
    
    if is_registered:
        await callback.answer("✅ Ты уже зарегистрирован на этот турнир", show_alert=True)
        return
    
    # Отправляем на сайт для регистрации
    await callback.answer(
        "Перейди на сайт для завершения регистрации",
        show_alert=False
    )
    
    # Обновляем сообщение с кнопкой перехода на сайт
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text="📝 Зарегистрироваться на сайте",
                url=f"http://localhost:8080/tournaments/{tournament_id}"
            )
        ]
    ])
    
    await callback.message.edit_reply_markup(reply_markup=keyboard)

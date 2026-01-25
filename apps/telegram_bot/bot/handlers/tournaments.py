"""
Обработчики команд для работы с турнирами
"""
import os
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

# URL веб-приложения из переменной окружения
WEB_APP_URL = os.getenv('WEB_APP_URL', 'https://beachplay.ru')


@sync_to_async
def get_telegram_user(telegram_id):
    """Получение Telegram пользователя"""
    try:
        return TelegramUser.objects.select_related('user', 'player').get(telegram_id=telegram_id)
    except TelegramUser.DoesNotExist:
        return None


@sync_to_async
def get_live_tournaments():
    """Получение турниров в процессе (live)"""
    return list(
        Tournament.objects.filter(
            status='active'
        ).annotate(
            participants_count=Count('entries')
        ).order_by('-date', '-created_at')[:10]
    )


@sync_to_async
def get_registration_tournaments():
    """Получение турниров для регистрации"""
    return list(
        Tournament.objects.filter(
            status='created'
        ).annotate(
            participants_count=Count('entries')
        ).order_by('date', 'created_at')[:10]
    )


@sync_to_async
def get_user_tournaments(player_id):
    """Получение турниров пользователя через TournamentRegistration"""
    if not player_id:
        return []
    
    from apps.tournaments.registration_models import TournamentRegistration
    
    # Находим турниры через регистрации
    tournament_ids = TournamentRegistration.objects.filter(
        player_id=player_id
    ).values_list('tournament_id', flat=True).distinct()
    
    # Получаем турниры по статусам
    active_tournaments = list(
        Tournament.objects.filter(
            id__in=tournament_ids,
            status='active'
        ).annotate(
            participants_count=Count('entries')
        ).order_by('-date', '-created_at')
    )
    
    created_tournaments = list(
        Tournament.objects.filter(
            id__in=tournament_ids,
            status='created'
        ).annotate(
            participants_count=Count('entries')
        ).order_by('date', 'created_at')
    )
    
    # Считаем сколько осталось места для completed
    active_count = len(active_tournaments)
    created_count = len(created_tournaments)
    total_shown = active_count + created_count
    
    # Определяем сколько completed показать (минимум 1, если есть место)
    if total_shown < 5:
        completed_limit = 5 - total_shown
    else:
        completed_limit = 1
    
    completed_tournaments = list(
        Tournament.objects.filter(
            id__in=tournament_ids,
            status='completed'
        ).annotate(
            participants_count=Count('entries')
        ).order_by('-date', '-created_at')[:completed_limit]
    )
    
    # Объединяем: active + created + completed
    return active_tournaments + created_tournaments + completed_tournaments


@sync_to_async
def check_registration(tournament_id, player_id):
    """Проверка регистрации игрока на турнир через TournamentRegistration"""
    if not player_id:
        return False
    
    from apps.tournaments.registration_models import TournamentRegistration
    
    return TournamentRegistration.objects.filter(
        tournament_id=tournament_id,
        player_id=player_id
    ).exists()


@sync_to_async
def get_registration_status(tournament_id, player_id):
    """Получение детальной информации о регистрации игрока"""
    if not player_id:
        return None
    
    from apps.tournaments.registration_models import TournamentRegistration
    
    try:
        reg = TournamentRegistration.objects.select_related('partner', 'team').get(
            tournament_id=tournament_id,
            player_id=player_id
        )
        return {
            'id': reg.id,
            'status': reg.status,
            'partner': reg.partner,
            'team': reg.team,
            'registration_order': reg.registration_order,
            'registered_at': reg.registered_at
        }
    except TournamentRegistration.DoesNotExist:
        return None


@sync_to_async
def get_tournament(tournament_id):
    """Получение турнира по ID"""
    try:
        return Tournament.objects.annotate(
            participants_count=Count('entries')
        ).get(id=tournament_id)
    except Tournament.DoesNotExist:
        return None


@sync_to_async
def search_players_by_name(query, exclude_player_id=None):
    """Поиск игроков по ФИО"""
    from apps.players.models import Player
    
    players = Player.objects.filter(
        Q(first_name__icontains=query) |
        Q(last_name__icontains=query) |
        Q(patronymic__icontains=query)
    )
    
    if exclude_player_id:
        players = players.exclude(id=exclude_player_id)
    
    return list(players.order_by('last_name', 'first_name')[:10])


@sync_to_async
def register_single_tournament(tournament_id, player_id):
    """Регистрация на индивидуальный турнир через RegistrationService"""
    from apps.tournaments.services import RegistrationService
    from apps.players.models import Player
    
    tournament = Tournament.objects.get(id=tournament_id)
    player = Player.objects.get(id=player_id)
    
    registration = RegistrationService.register_single(tournament, player)
    return registration


@sync_to_async
def register_looking_for_partner_tournament(tournament_id, player_id):
    """Регистрация в режиме 'Ищу пару' через RegistrationService"""
    from apps.tournaments.services import RegistrationService
    from apps.players.models import Player
    
    tournament = Tournament.objects.get(id=tournament_id)
    player = Player.objects.get(id=player_id)
    
    registration = RegistrationService.register_looking_for_partner(tournament, player)
    return registration


@sync_to_async
def register_with_partner_tournament(tournament_id, player_id, partner_id):
    """Регистрация с напарником через RegistrationService"""
    from apps.tournaments.services import RegistrationService
    from apps.players.models import Player
    
    tournament = Tournament.objects.get(id=tournament_id)
    player = Player.objects.get(id=player_id)
    partner = Player.objects.get(id=partner_id)
    
    registration = RegistrationService.register_with_partner(tournament, player, partner, notify_partner=True)
    return registration


@sync_to_async
def leave_pair_tournament(tournament_id, player_id):
    """Выход из пары через RegistrationService"""
    from apps.tournaments.services import RegistrationService
    from apps.tournaments.registration_models import TournamentRegistration
    
    registration = TournamentRegistration.objects.get(
        tournament_id=tournament_id,
        player_id=player_id
    )
    
    RegistrationService.leave_pair(registration)


@sync_to_async
def cancel_registration_tournament(tournament_id, player_id):
    """Полная отмена регистрации через RegistrationService"""
    from apps.tournaments.services import RegistrationService
    from apps.tournaments.registration_models import TournamentRegistration
    
    registration = TournamentRegistration.objects.get(
        tournament_id=tournament_id,
        player_id=player_id
    )
    
    RegistrationService.cancel_registration(registration)


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
    Показывает турниры Live и турниры для регистрации
    """
    telegram_user = await get_telegram_user(message.from_user.id)
    
    if not telegram_user:
        await message.answer(
            "❌ Ошибка: твой Telegram аккаунт не найден в системе.\n"
            "Отправь /start для регистрации."
        )
        return
    
    player_id = telegram_user.player_id if telegram_user.player else None
    
    # Получаем турниры Live
    live_tournaments = await get_live_tournaments()
    
    # Получаем турниры для регистрации
    registration_tournaments = await get_registration_tournaments()
    
    if not live_tournaments and not registration_tournaments:
        await message.answer(
            "📋 Активных турниров пока нет.\n\n"
            "Следи за обновлениями на сайте beachplay.ru"
        )
        return
    
    # Показываем турниры Live
    if live_tournaments:
        await message.answer(f"{hbold('🔴 Турниры Live')}\n")
        
        for tournament in live_tournaments:
            is_registered = await check_registration(tournament.id, player_id)
            text = format_tournament_info(tournament, is_registered)
            
            keyboard = InlineKeyboardMarkup(inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="📋 Подробнее",
                        url=f"{WEB_APP_URL}/tournaments/{tournament.id}"
                    )
                ]
            ])
            
            await message.answer(text, reply_markup=keyboard)
    
    # Показываем турниры для регистрации
    if registration_tournaments:
        await message.answer(f"\n{hbold('📝 Турниры для регистрации')}\n")
        
        for tournament in registration_tournaments:
            is_registered = await check_registration(tournament.id, player_id)
            text = format_tournament_info(tournament, is_registered)
            
            keyboard = InlineKeyboardMarkup(inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="📋 Подробнее",
                        url=f"{WEB_APP_URL}/tournaments/{tournament.id}"
                    )
                ]
            ])
            
            # Добавляем кнопку регистрации, если игрок не зарегистрирован
            if player_id and not is_registered:
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
                    url=f"{WEB_APP_URL}/tournaments/{tournament.id}"
                )
            ]
        ])
        
        await message.answer(text, reply_markup=keyboard)
    
    # Добавляем сообщение о полном списке
    await message.answer(
        f"\n📋 Все турниры вы можете посмотреть на {hbold('BeachPlay.ru')}"
    )


@router.callback_query(F.data.startswith("register_"))
async def callback_register(callback: CallbackQuery):
    """
    Обработка callback для регистрации на турнир
    Определяет тип турнира и показывает соответствующие опции
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
    
    # Получаем турнир
    tournament = await get_tournament(tournament_id)
    
    if not tournament:
        await callback.answer("❌ Турнир не найден", show_alert=True)
        return
    
    # Для индивидуальных турниров - сразу регистрируем
    if tournament.participant_mode == 'singles':
        try:
            await register_single_tournament(tournament_id, telegram_user.player_id)
            await callback.answer("✅ Ты успешно зарегистрирован на турнир!", show_alert=True)
            
            # Обновляем сообщение
            text = format_tournament_info(tournament, is_registered=True)
            keyboard = InlineKeyboardMarkup(inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="📋 Подробнее",
                        url=f"{WEB_APP_URL}/tournaments/{tournament_id}"
                    )
                ]
            ])
            await callback.message.edit_text(text, reply_markup=keyboard)
        except Exception as e:
            await callback.answer(f"❌ Ошибка регистрации: {str(e)}", show_alert=True)
        return
    
    # Для парных турниров - показываем выбор режима
    await callback.answer()
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text="🔍 Ищу пару",
                callback_data=f"reg_looking_{tournament_id}"
            )
        ],
        [
            InlineKeyboardButton(
                text="👥 С напарником",
                callback_data=f"reg_with_partner_{tournament_id}"
            )
        ],
        [
            InlineKeyboardButton(
                text="❌ Отмена",
                callback_data=f"reg_cancel_{tournament_id}"
            )
        ]
    ])
    
    await callback.message.answer(
        f"{hbold('Выбери способ регистрации:')}\n\n"
        "🔍 Ищу пару - ты будешь в списке поиска пары\n"
        "👥 С напарником - зарегистрироваться с конкретным игроком",
        reply_markup=keyboard
    )

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
from apps.tournaments.models import Tournament, TournamentEntry, TournamentPlacement
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
    """Получение турниров в процессе (live), отсортированных по алфавиту"""
    return list(
        Tournament.objects.filter(
            status='active'
        ).annotate(
            participants_count=Count('entries')
        ).order_by('name')[:10]
    )


@sync_to_async
def get_registration_tournaments():
    """Получение турниров для регистрации, отсортированных по дате и времени (ближайший первым)"""
    return list(
        Tournament.objects.filter(
            status='created'
        ).annotate(
            participants_count=Count('entries')
        ).order_by('date', 'start_time', 'created_at')[:10]
    )


@sync_to_async
def get_completed_tournaments(limit=5):
    """Получение завершенных турниров"""
    return list(
        Tournament.objects.filter(
            status='completed'
        ).annotate(
            participants_count=Count('entries')
        ).order_by('-date', '-created_at')[:limit]
    )


@sync_to_async
def get_user_tournaments(player_id):
    """Получение турниров пользователя через Team и TournamentEntry (как в мини-аппе)"""
    if not player_id:
        return []
    
    # Находим команды игрока (как в мини-аппе)
    team_ids = Team.objects.filter(
        Q(player_1_id=player_id) | Q(player_2_id=player_id)
    ).values_list('id', flat=True)
    
    # Находим турниры через участников
    tournament_ids = TournamentEntry.objects.filter(
        team_id__in=team_ids
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
def search_players_by_name(query, exclude_player_id=None, tournament_id=None):
    """Поиск игроков по ФИО, исключая уже зарегистрированных на турнир"""
    from apps.players.models import Player
    from apps.tournaments.registration_models import TournamentRegistration
    
    players = Player.objects.filter(
        Q(first_name__icontains=query) |
        Q(last_name__icontains=query) |
        Q(patronymic__icontains=query)
    )
    
    if exclude_player_id:
        players = players.exclude(id=exclude_player_id)
    
    # Исключаем игроков, которые уже зарегистрированы на турнир
    # Оставляем только тех, кто вообще не зарегистрирован на этот турнир,
    # либо зарегистрирован в статусе LOOKING_FOR_PARTNER.
    if tournament_id:
        # Находим игроков, у которых есть регистрация на турнир
        # с любым статусом, КРОМЕ LOOKING_FOR_PARTNER – их нужно скрыть
        busy_player_ids = TournamentRegistration.objects.filter(
            tournament_id=tournament_id,
        ).exclude(
            status=TournamentRegistration.Status.LOOKING_FOR_PARTNER,
        ).values_list("player_id", flat=True)

        players = players.exclude(id__in=busy_player_ids)
    
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
    from apps.telegram_bot.models import TelegramUser
    
    tournament = Tournament.objects.get(id=tournament_id)
    player = Player.objects.get(id=player_id)
    partner = Player.objects.get(id=partner_id)
    
    registration = RegistrationService.register_with_partner(tournament, player, partner, notify_partner=True)
    
    # Проверяем, есть ли у напарника связь с Telegram
    partner_has_telegram = TelegramUser.objects.filter(player_id=partner_id).exists()
    
    return registration, partner_has_telegram


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


@sync_to_async
def get_user_place(tournament_id: int, player_id: int) -> str | None:
    """Получить место игрока в завершённом турнире.

    Возвращает строку с местом (например, "1" или "1–3"), либо None,
    если место не найдено.
    """
    if not player_id:
        return None

    # Находим все записи участника в турнире
    entries = TournamentEntry.objects.filter(
        tournament_id=tournament_id,
        team__isnull=False,
    ).filter(
        Q(team__player_1_id=player_id) | Q(team__player_2_id=player_id)
    )

    if not entries.exists():
        return None

    placement = (
        TournamentPlacement.objects
        .filter(tournament_id=tournament_id, entry__in=entries)
        .order_by('place_from')
        .first()
    )
    if not placement:
        return None

    if placement.place_from == placement.place_to:
        return str(placement.place_from)
    return f"{placement.place_from}–{placement.place_to}"


@sync_to_async
def get_tournament_winner(tournament_id: int) -> str | None:
    """Получить победителя турнира по TournamentPlacement.

    Возвращает имя игрока или пары, либо None если данных нет.
    """
    placements = (
        TournamentPlacement.objects
        .filter(tournament_id=tournament_id, place_from=1)
        .select_related("entry__team__player_1", "entry__team__player_2")
        .order_by("place_from")
    )
    if not placements.exists():
        return None

    placement = placements.first()
    entry = placement.entry
    if not entry or not entry.team:
        return None

    team = entry.team
    p1 = getattr(team, "player_1", None)
    p2 = getattr(team, "player_2", None)

    def _player_name(player):
        if not player:
            return ""
        # Всегда отображаем как "Фамилия Имя"
        return f"{player.last_name} {player.first_name}"

    # Одиночный или парный формат
    if p1 and not p2:
        return _player_name(p1)
    if p1 and p2:
        return f"{_player_name(p1)} / {_player_name(p2)}"

    return None


@sync_to_async
def get_total_tournaments_count() -> int:
    """Общее количество турниров в системе (для текста 'Всего в истории N турниров')."""
    return Tournament.objects.count()


def format_tournament_info(tournament, is_registered: bool = False, place: str | None = None, winner: str | None = None):
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
        # Для завершённых турниров показываем место игрока, а если места ещё нет — вообще ничего не добавляем
        if tournament.status == 'completed':
            if place:
                # Без дополнительной пустой строки
                text += f"🏆 {hbold(f'Твоё место {place}')}\n"
        else:
            text += f"\n✅ {hbold('Ты зарегистрирован')}\n"

    # Для завершённых турниров, если передан победитель, добавляем строку в конце
    if tournament.status == 'completed' and winner:
        text += f"🥇 Победитель: {winner}\n"
    
    return text


@router.message(Command("tournaments"))
async def cmd_tournaments(message: Message):
    """
    Обработка команды /tournaments
    Показывает активные турниры, турниры для регистрации и завершенные
    """
    from aiogram.types import WebAppInfo
    
    telegram_user = await get_telegram_user(message.from_user.id)
    
    if not telegram_user:
        await message.answer(
            "❌ Ошибка: твой Telegram аккаунт не найден в системе.\n"
            "Отправь /start для регистрации."
        )
        return
    
    player_id = telegram_user.player_id if telegram_user.player else None
    
    live_tournaments = await get_live_tournaments()
    registration_tournaments = await get_registration_tournaments()
    
    # Логика: если активных + регистрация < 5, добавляем завершенные
    total_count = len(live_tournaments) + len(registration_tournaments)
    completed_tournaments = []
    if total_count < 5:
        completed_tournaments = await get_completed_tournaments(limit=5 - total_count)
    
    if not live_tournaments and not registration_tournaments and not completed_tournaments:
        await message.answer("Нет доступных турниров")
        return
    
    # Активные турниры
    if live_tournaments:
        await message.answer(f"{hbold('🏆 Активные турниры')}")
        for tournament in live_tournaments:
            keyboard = InlineKeyboardMarkup(inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="📱 В мини-апп",
                        web_app=WebAppInfo(url=f"{WEB_APP_URL}/mini-app/tournaments/{tournament.id}")
                    ),
                    InlineKeyboardButton(
                        text="🌐 На BeachPlay.ru",
                        url=f"{WEB_APP_URL}/tournaments/{tournament.id}"
                    )
                ],
                [
                    InlineKeyboardButton(
                        text="◀️ Назад",
                        callback_data="main_menu"
                    )
                ]
            ])
            winner = await get_tournament_winner(tournament.id)
            await message.answer(
                format_tournament_info(tournament, winner=winner),
                reply_markup=keyboard
            )
    
    # Турниры для регистрации
    if registration_tournaments:
        await message.answer(f"{hbold('📝 Турниры для регистрации')}")
        for tournament in registration_tournaments:
            is_registered = False
            if player_id:
                is_registered = await check_registration(tournament.id, player_id)
            
            keyboard_buttons = []
            
            if not is_registered:
                keyboard_buttons.append([
                    InlineKeyboardButton(
                        text="✅ Зарегистрироваться",
                        callback_data=f"register_{tournament.id}"
                    )
                ])
            
            keyboard_buttons.append([
                InlineKeyboardButton(
                    text="📱 В мини-апп",
                    web_app=WebAppInfo(url=f"{WEB_APP_URL}/mini-app/tournaments/{tournament.id}")
                ),
                InlineKeyboardButton(
                    text="🌐 На BeachPlay.ru",
                    url=f"{WEB_APP_URL}/tournaments/{tournament.id}"
                )
            ])
            keyboard_buttons.append([
                InlineKeyboardButton(
                    text="◀️ Назад",
                    callback_data="main_menu"
                )
            ])
            
            keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)
            await message.answer(
                format_tournament_info(tournament, is_registered),
                reply_markup=keyboard
            )
    
    # Завершенные турниры (если есть)
    if completed_tournaments:
        await message.answer(f"{hbold('✅ Завершенные турниры')}")
        for tournament in completed_tournaments:
            keyboard = InlineKeyboardMarkup(inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="📱 В мини-апп",
                        web_app=WebAppInfo(url=f"{WEB_APP_URL}/mini-app/tournaments/{tournament.id}")
                    ),
                    InlineKeyboardButton(
                        text="🌐 На BeachPlay.ru",
                        url=f"{WEB_APP_URL}/tournaments/{tournament.id}"
                    )
                ],
                [
                    InlineKeyboardButton(
                        text="◀️ Назад",
                        callback_data="main_menu"
                    )
                ]
            ])
            await message.answer(
                format_tournament_info(tournament),
                reply_markup=keyboard
            )
    
    # Кнопка "Посмотреть все турниры" и итоговая статистика
    final_keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text="🌐 Посмотреть все турниры на BeachPlay.ru",
                url=f"{WEB_APP_URL}/tournaments"
            )
        ],
        [
            InlineKeyboardButton(
                text="◀️ Назад",
                callback_data="main_menu"
            )
        ]
    ])

    total_count = await get_total_tournaments_count()
    await message.answer(
        f"Всего в истории турниров: {total_count}",
        reply_markup=final_keyboard,
    )


@router.message(Command("mytournaments"))
async def cmd_my_tournaments(message: Message):
    """
    Обработка команды /mytournaments
    Показывает турниры пользователя
    """
    from aiogram.types import WebAppInfo
    
    telegram_user = await get_telegram_user(message.from_user.id)
    
    if not telegram_user:
        await message.answer(
            "❌ Ошибка: твой Telegram аккаунт не найден в системе.\n"
            "Отправь /start для регистрации."
        )
        return
    
    if not telegram_user.player:
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🏆 Турниры",
                    callback_data="cmd_tournaments"
                ),
                InlineKeyboardButton(
                    text="✍️ Заявиться на турнир",
                    callback_data="cmd_register"
                )
            ],
            [
                InlineKeyboardButton(
                    text="◀️ Назад",
                    callback_data="main_menu"
                )
            ]
        ])
        await message.answer(
            "⚠️ Профиль игрока не связан с аккаунтом.\n\n"
            "Свяжи профиль на сайте: beachplay.ru/profile",
            reply_markup=keyboard
        )
        return
    
    tournaments = await get_user_tournaments(telegram_user.player_id)
    
    if not tournaments:
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🏆 Турниры",
                    callback_data="cmd_tournaments"
                ),
                InlineKeyboardButton(
                    text="✍️ Заявиться на турнир",
                    callback_data="cmd_register"
                )
            ],
            [
                InlineKeyboardButton(
                    text="◀️ Назад",
                    callback_data="main_menu"
                )
            ]
        ])
        await message.answer(
            "📋 Ты пока не участвуешь ни в одном турнире.",
            reply_markup=keyboard
        )
        return
    
    # Разделяем на активные, предстоящие и завершенные
    active_tournaments = [t for t in tournaments if t.status == 'active']
    upcoming_tournaments = [t for t in tournaments if t.status == 'created']
    completed_tournaments = [t for t in tournaments if t.status == 'completed']
    
    # Активные турниры (live)
    if active_tournaments:
        await message.answer(f"{hbold('🔥 Активные турниры')}")
        for tournament in active_tournaments:
            keyboard = InlineKeyboardMarkup(inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="📱 В мини-апп",
                        web_app=WebAppInfo(url=f"{WEB_APP_URL}/mini-app/tournaments/{tournament.id}")
                    ),
                    InlineKeyboardButton(
                        text="🌐 На BeachPlay.ru",
                        url=f"{WEB_APP_URL}/tournaments/{tournament.id}"
                    )
                ],
                [
                    InlineKeyboardButton(
                        text="◀️ Назад",
                        callback_data="main_menu"
                    )
                ]
            ])
            await message.answer(
                format_tournament_info(tournament, is_registered=True),
                reply_markup=keyboard
            )
    
    # Предстоящие турниры (created)
    if upcoming_tournaments:
        await message.answer(f"{hbold('📅 Предстоящие турниры')}")
        for tournament in upcoming_tournaments:
            keyboard = InlineKeyboardMarkup(inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="📱 В мини-апп",
                        web_app=WebAppInfo(url=f"{WEB_APP_URL}/mini-app/tournaments/{tournament.id}")
                    ),
                    InlineKeyboardButton(
                        text="🌐 На BeachPlay.ru",
                        url=f"{WEB_APP_URL}/tournaments/{tournament.id}"
                    )
                ],
                [
                    InlineKeyboardButton(
                        text="◀️ Назад",
                        callback_data="main_menu"
                    )
                ]
            ])
            await message.answer(
                format_tournament_info(tournament, is_registered=True),
                reply_markup=keyboard
            )
    
    # Завершенные турниры (completed)
    if completed_tournaments:
        await message.answer(f"{hbold('✅ Завершенные турниры')}")
        for tournament in completed_tournaments:
            keyboard = InlineKeyboardMarkup(inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="📱 В мини-апп",
                        web_app=WebAppInfo(url=f"{WEB_APP_URL}/mini-app/tournaments/{tournament.id}")
                    ),
                    InlineKeyboardButton(
                        text="🌐 На BeachPlay.ru",
                        url=f"{WEB_APP_URL}/tournaments/{tournament.id}"
                    )
                ],
                [
                    InlineKeyboardButton(
                        text="◀️ Назад",
                        callback_data="main_menu"
                    )
                ]
            ])
            await message.answer(
                format_tournament_info(tournament, is_registered=True),
                reply_markup=keyboard
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
    
    # Формируем заголовок с названием турнира и датой
    if tournament.date:
        date_str = tournament.date.strftime('%d.%m.%Y')
        title = f"Выбери способ регистрации на {tournament.name} {date_str}:"
    else:
        title = f"Выбери способ регистрации на {tournament.name}:"

    await callback.message.answer(
        f"{hbold(title)}\n\n"
        "🔍 Ищу пару - ты будешь в списке поиска пары\n"
        "👥 С напарником - зарегистрироваться с конкретным игроком",
        reply_markup=keyboard
    )

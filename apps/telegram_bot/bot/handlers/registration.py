"""
Обработчики для регистрации на турниры через бота
"""
from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import CallbackQuery, Message, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.utils.markdown import hbold
from aiogram.fsm.context import FSMContext
from aiogram.fsm.state import State, StatesGroup
from asgiref.sync import sync_to_async

from apps.telegram_bot.models import TelegramUser
from .tournaments import (
    get_telegram_user,
    get_tournament,
    register_looking_for_partner_tournament,
    register_with_partner_tournament,
    search_players_by_name,
    get_registration_status,
    leave_pair_tournament,
    cancel_registration_tournament,
    get_user_tournaments
)

router = Router()

# URL веб-приложения
import os
WEB_APP_URL = os.getenv('WEB_APP_URL', 'https://beachplay.ru')


class PartnerSearchStates(StatesGroup):
    """Состояния для поиска напарника"""
    waiting_for_partner_name = State()


@router.callback_query(F.data.startswith("reg_looking_"))
async def callback_register_looking(callback: CallbackQuery):
    """
    Регистрация в режиме "Ищу пару"
    """
    tournament_id = int(callback.data.split("_")[2])
    
    telegram_user = await get_telegram_user(callback.from_user.id)
    
    if not telegram_user or not telegram_user.player:
        await callback.answer("⚠️ Ошибка: профиль игрока не найден", show_alert=True)
        return
    
    try:
        await register_looking_for_partner_tournament(tournament_id, telegram_user.player_id)
        await callback.answer("✅ Ты зарегистрирован в режиме 'Ищу пару'!", show_alert=True)
        
        # Обновляем сообщение
        tournament = await get_tournament(tournament_id)
        await callback.message.edit_text(
            f"✅ {hbold('Регистрация успешна!')}\n\n"
            f"Ты зарегистрирован на турнир {hbold(tournament.name)} в режиме 'Ищу пару'.\n\n"
            "Другие игроки смогут пригласить тебя в пару, или ты можешь найти напарника самостоятельно.",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="📋 Подробнее",
                        url=f"{WEB_APP_URL}/tournaments/{tournament_id}"
                    )
                ],
                [
                    InlineKeyboardButton(
                        text="🏠 В главное меню",
                        callback_data="main_menu"
                    )
                ]
            ])
        )
    except Exception as e:
        await callback.answer(f"❌ Ошибка регистрации: {str(e)}", show_alert=True)


@router.callback_query(F.data.startswith("reg_with_partner_"))
async def callback_register_with_partner(callback: CallbackQuery, state: FSMContext):
    """
    Начало процесса регистрации с напарником
    """
    tournament_id = int(callback.data.split("_")[3])
    
    telegram_user = await get_telegram_user(callback.from_user.id)
    
    if not telegram_user or not telegram_user.player:
        await callback.answer("⚠️ Ошибка: профиль игрока не найден", show_alert=True)
        return
    
    await callback.answer()
    
    # Сохраняем tournament_id в состояние
    await state.update_data(tournament_id=tournament_id)
    await state.set_state(PartnerSearchStates.waiting_for_partner_name)
    
    await callback.message.answer(
        f"{hbold('Поиск напарника')}\n\n"
        "Введи ФИО напарника для поиска (минимум 2 символа):\n\n"
        "Например: Иванов\n"
        "Или: Иван Петров\n\n"
        "Для отмены отправь /cancel"
    )


@router.message(PartnerSearchStates.waiting_for_partner_name)
async def process_partner_search(message: Message, state: FSMContext):
    """
    Обработка поиска напарника по ФИО
    """
    query = message.text.strip()
    
    # Проверка на команду отмены
    if query.lower() in ['/cancel', 'отмена']:
        await state.clear()
        await message.answer("❌ Поиск напарника отменён")
        return
    
    # Минимальная длина запроса
    if len(query) < 2:
        await message.answer("⚠️ Введи минимум 2 символа для поиска")
        return
    
    telegram_user = await get_telegram_user(message.from_user.id)
    
    if not telegram_user or not telegram_user.player:
        await state.clear()
        await message.answer("❌ Ошибка: профиль игрока не найден")
        return
    
    # Показываем результаты поиска
    data = await state.get_data()
    tournament_id = data.get('tournament_id')
    
    # Поиск игроков с фильтрацией зарегистрированных на турнир
    players = await search_players_by_name(query, exclude_player_id=telegram_user.player_id, tournament_id=tournament_id)
    
    if not players:
        await message.answer(
            f"❌ Свободные игроки с ФИО '{query}' не найдены.\n\n"
            "Попробуй другой запрос или отправь /cancel для отмены"
        )
        return
    
    keyboard_buttons = []
    for player in players:
        full_name = f"{player.last_name} {player.first_name}"
        if player.patronymic:
            full_name += f" {player.patronymic}"
        
        keyboard_buttons.append([
            InlineKeyboardButton(
                text=full_name,
                callback_data=f"select_partner_{tournament_id}_{player.id}"
            )
        ])
    
    keyboard_buttons.append([
        InlineKeyboardButton(
            text="🔍 Новый поиск",
            callback_data=f"new_search_{tournament_id}"
        )
    ])
    keyboard_buttons.append([
        InlineKeyboardButton(
            text="❌ Отмена",
            callback_data=f"cancel_search_{tournament_id}"
        )
    ])
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)
    
    await message.answer(
        f"{hbold('Результаты поиска:')}\n\n"
        f"Найдено {hbold('свободных')} игроков: {len(players)}\n"
        "Выбери напарника из списка:",
        reply_markup=keyboard
    )


@router.callback_query(F.data.startswith("select_partner_"))
async def callback_select_partner(callback: CallbackQuery, state: FSMContext):
    """
    Подтверждение выбора напарника и регистрация
    """
    parts = callback.data.split("_")
    tournament_id = int(parts[2])
    partner_id = int(parts[3])
    
    telegram_user = await get_telegram_user(callback.from_user.id)
    
    if not telegram_user or not telegram_user.player:
        await callback.answer("⚠️ Ошибка: профиль игрока не найден", show_alert=True)
        await state.clear()
        return
    
    try:
        registration, partner_has_telegram = await register_with_partner_tournament(tournament_id, telegram_user.player_id, partner_id)
        await callback.answer("✅ Регистрация успешна!", show_alert=True)
        await state.clear()
        
        tournament = await get_tournament(tournament_id)
        
        # Формируем сообщение в зависимости от наличия Telegram у напарника
        if partner_has_telegram:
            message_text = (
                f"✅ {hbold('Регистрация успешна!')}\n\n"
                f"Ты зарегистрирован на турнир {hbold(tournament.name)} с напарником.\n\n"
                "Напарнику отправлено уведомление в Telegram."
            )
        else:
            message_text = (
                f"✅ {hbold('Регистрация успешна!')}\n\n"
                f"Ты зарегистрирован на турнир {hbold(tournament.name)} с напарником.\n\n"
                "⚠️ Обратите внимание: у вашего напарника не установлена связь между BeachPlay и Telegram-аккаунтом.\n\n"
                "Напарник не получит автоматическое уведомление о регистрации. "
                "Пожалуйста, сообщите ему о турнире другим способом."
            )
        
        await callback.message.edit_text(
            message_text,
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="📋 Подробнее",
                        url=f"{WEB_APP_URL}/tournaments/{tournament_id}"
                    )
                ],
                [
                    InlineKeyboardButton(
                        text="🏠 В главное меню",
                        callback_data="main_menu"
                    )
                ]
            ])
        )
    except Exception as e:
        await callback.answer(f"❌ Ошибка регистрации: {str(e)}", show_alert=True)
        await state.clear()


@router.callback_query(F.data.startswith("new_search_"))
async def callback_new_search(callback: CallbackQuery, state: FSMContext):
    """
    Начать новый поиск напарника
    """
    tournament_id = int(callback.data.split("_")[2])
    
    await callback.answer()
    await state.update_data(tournament_id=tournament_id)
    await state.set_state(PartnerSearchStates.waiting_for_partner_name)
    
    await callback.message.answer(
        f"{hbold('Поиск напарника')}\n\n"
        "Введи ФИО напарника для поиска (минимум 2 символа):"
    )


@router.callback_query(F.data.startswith("cancel_search_"))
async def callback_cancel_search(callback: CallbackQuery, state: FSMContext):
    """
    Отмена поиска напарника
    """
    await state.clear()
    await callback.answer("Поиск отменён")
    await callback.message.edit_text("❌ Поиск напарника отменён")


@router.callback_query(F.data.startswith("reg_cancel_"))
async def callback_cancel_registration_choice(callback: CallbackQuery):
    """
    Отмена выбора режима регистрации
    """
    await callback.answer("Регистрация отменена")
    await callback.message.edit_text("❌ Регистрация отменена")


@router.callback_query(F.data.startswith("cancel_reg_"))
async def callback_cancel_registration(callback: CallbackQuery):
    """
    Отмена регистрации на турнир
    Показывает варианты: выйти из пары или покинуть турнир полностью
    """
    tournament_id = int(callback.data.split("_")[2])
    
    telegram_user = await get_telegram_user(callback.from_user.id)
    
    if not telegram_user or not telegram_user.player:
        await callback.answer("⚠️ Ошибка: профиль игрока не найден", show_alert=True)
        return
    
    # Получаем статус регистрации
    reg_status = await get_registration_status(tournament_id, telegram_user.player_id)
    
    if not reg_status:
        await callback.answer("❌ Ты не зарегистрирован на этот турнир", show_alert=True)
        return
    
    await callback.answer()
    
    # Если есть напарник - показываем два варианта
    if reg_status['partner']:
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🔄 Выйти из пары",
                    callback_data=f"leave_pair_{tournament_id}"
                )
            ],
            [
                InlineKeyboardButton(
                    text="❌ Покинуть турнир полностью",
                    callback_data=f"full_cancel_{tournament_id}"
                )
            ],
            [
                InlineKeyboardButton(
                    text="◀️ Назад",
                    callback_data=f"back_to_tournament_{tournament_id}"
                )
            ]
        ])
        
        await callback.message.answer(
            f"{hbold('Отмена регистрации')}\n\n"
            "Выбери действие:\n\n"
            "🔄 Выйти из пары - ты и твой напарник перейдёте в список 'Ищу пару'\n\n"
            "❌ Покинуть турнир полностью - ты будешь удалён из всех списков, "
            "а твой напарник перейдёт в список 'Ищу пару'",
            reply_markup=keyboard
        )
    else:
        # Без напарника - только полная отмена
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="❌ Покинуть турнир",
                    callback_data=f"full_cancel_{tournament_id}"
                )
            ],
            [
                InlineKeyboardButton(
                    text="◀️ Назад",
                    callback_data=f"back_to_tournament_{tournament_id}"
                )
            ]
        ])
        
        await callback.message.answer(
            f"{hbold('Отмена регистрации')}\n\n"
            "Ты будешь удалён из всех списков турнира.",
            reply_markup=keyboard
        )


@router.callback_query(F.data.startswith("leave_pair_"))
async def callback_leave_pair(callback: CallbackQuery):
    """
    Выход из пары
    """
    tournament_id = int(callback.data.split("_")[2])
    
    telegram_user = await get_telegram_user(callback.from_user.id)
    
    if not telegram_user or not telegram_user.player:
        await callback.answer("⚠️ Ошибка: профиль игрока не найден", show_alert=True)
        return
    
    try:
        await leave_pair_tournament(tournament_id, telegram_user.player_id)
        await callback.answer("✅ Ты вышел из пары", show_alert=True)
        
        tournament = await get_tournament(tournament_id)
        await callback.message.edit_text(
            f"✅ {hbold('Выход из пары')}\n\n"
            f"Ты и твой напарник теперь в списке 'Ищу пару' для турнира {hbold(tournament.name)}.",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="📋 Подробнее",
                        url=f"{WEB_APP_URL}/tournaments/{tournament_id}"
                    )
                ],
                [
                    InlineKeyboardButton(
                        text="🏠 В главное меню",
                        callback_data="main_menu"
                    )
                ]
            ])
        )
    except Exception as e:
        await callback.answer(f"❌ Ошибка: {str(e)}", show_alert=True)


@router.callback_query(F.data.startswith("full_cancel_"))
async def callback_full_cancel(callback: CallbackQuery):
    """
    Полная отмена регистрации
    """
    tournament_id = int(callback.data.split("_")[2])
    
    telegram_user = await get_telegram_user(callback.from_user.id)
    
    if not telegram_user or not telegram_user.player:
        await callback.answer("⚠️ Ошибка: профиль игрока не найден", show_alert=True)
        return
    
    try:
        await cancel_registration_tournament(tournament_id, telegram_user.player_id)
        await callback.answer("✅ Регистрация отменена", show_alert=True)
        
        tournament = await get_tournament(tournament_id)
        await callback.message.edit_text(
            f"✅ {hbold('Регистрация отменена')}\n\n"
            f"Ты больше не участвуешь в турнире {hbold(tournament.name)}.",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="📋 Подробнее",
                        url=f"{WEB_APP_URL}/tournaments/{tournament_id}"
                    )
                ],
                [
                    InlineKeyboardButton(
                        text="🏠 В главное меню",
                        callback_data="main_menu"
                    )
                ]
            ])
        )
    except Exception as e:
        await callback.answer(f"❌ Ошибка: {str(e)}", show_alert=True)


@router.callback_query(F.data.startswith("back_to_tournament_"))
async def callback_back_to_tournament(callback: CallbackQuery):
    """
    Возврат к информации о турнире
    """
    await callback.answer("Действие отменено")
    await callback.message.delete()


@router.message(Command("myregistration"))
async def cmd_my_registration(message: Message):
    """
    Команда для просмотра статуса регистрации на турниры
    """
    telegram_user = await get_telegram_user(message.from_user.id)
    
    if not telegram_user:
        await message.answer(
            "❌ Ошибка: твой Telegram аккаунт не найден в системе.\n"
            "Отправь /start для регистрации."
        )
        return
    
    if not telegram_user.player:
        await message.answer(
            "⚠️ Профиль игрока не связан с аккаунтом.\n\n"
            "Свяжи профиль на сайте: beachplay.ru/profile"
        )
        return
    
    # Получаем турниры пользователя
    tournaments = await get_user_tournaments(telegram_user.player_id)
    
    if not tournaments:
        await message.answer(
            "📋 Ты пока не зарегистрирован ни на один турнир.\n\n"
            "Используй /tournaments для просмотра доступных турниров"
        )
        return
    
    # Показываем только турниры в статусе 'created' (набор участников)
    created_tournaments = [t for t in tournaments if t.status == 'created']
    
    if not created_tournaments:
        await message.answer(
            "📋 У тебя нет активных регистраций на турниры.\n\n"
            "Используй /tournaments для просмотра доступных турниров"
        )
        return
    
    await message.answer(f"{hbold('📝 Мои регистрации')}\n")
    
    for tournament in created_tournaments:
        # Получаем детальную информацию о регистрации
        reg_status = await get_registration_status(tournament.id, telegram_user.player_id)
        
        if not reg_status:
            continue
        
        # Формируем текст статуса
        status_text = ""
        if reg_status['status'] == 'main_list':
            status_text = "✅ Основной состав"
        elif reg_status['status'] == 'reserve_list':
            status_text = "📋 Резервный список"
        elif reg_status['status'] == 'looking_for_partner':
            status_text = "🔍 Ищу пару"
        elif reg_status['status'] == 'invited':
            status_text = "📨 Есть приглашение"
        
        # Формируем текст о напарнике
        partner_text = ""
        if reg_status['partner']:
            partner = reg_status['partner']
            partner_name = f"{partner.last_name} {partner.first_name}"
            if partner.patronymic:
                partner_name += f" {partner.patronymic}"
            partner_text = f"\n👥 Напарник: {partner_name}"
        
        text = (
            f"{hbold(tournament.name)}\n"
            f"📊 Статус: {status_text}{partner_text}\n"
        )
        
        if tournament.date:
            text += f"📅 Дата: {tournament.date.strftime('%d.%m.%Y')}\n"
        
        # Кнопки действий
        keyboard_buttons = [
            [
                InlineKeyboardButton(
                    text="📋 Подробнее",
                    url=f"{WEB_APP_URL}/tournaments/{tournament.id}"
                )
            ]
        ]
        
        # Добавляем кнопку отмены регистрации
        keyboard_buttons.append([
            InlineKeyboardButton(
                text="❌ Отменить регистрацию",
                callback_data=f"cancel_reg_{tournament.id}"
            )
        ])
        
        keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)
        
        await message.answer(text, reply_markup=keyboard)


@router.callback_query(F.data == "main_menu")
async def callback_main_menu(callback: CallbackQuery):
    """
    Возврат в главное меню
    """
    await callback.answer()
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text="🎾 Открыть BeachPlay",
                url=f"{WEB_APP_URL}/mini-app/"
            )
        ],
        [
            InlineKeyboardButton(
                text="🏆 Турниры",
                callback_data="cmd_tournaments"
            )
        ],
        [
            InlineKeyboardButton(
                text="📋 Мои турниры",
                callback_data="cmd_mytournaments"
            ),
            InlineKeyboardButton(
                text="📝 Мои регистрации",
                callback_data="cmd_myregistration"
            )
        ],
        [
            InlineKeyboardButton(
                text="👤 Мой профиль",
                callback_data="cmd_profile"
            )
        ]
    ])
    
    await callback.message.edit_text(
        f"{hbold('🏠 Главное меню')}\n\n"
        "Используй кнопки ниже для быстрого доступа:",
        reply_markup=keyboard
    )


@router.callback_query(F.data == "cmd_tournaments")
async def callback_cmd_tournaments(callback: CallbackQuery):
    """
    Обработчик кнопки "Турниры"
    """
    await callback.answer()
    await callback.message.delete()
    
    # Вызываем команду напрямую через callback
    from .tournaments import get_telegram_user, get_live_tournaments, get_registration_tournaments, format_tournament_info, check_registration
    
    telegram_user = await get_telegram_user(callback.from_user.id)
    
    if not telegram_user:
        await callback.message.answer(
            "❌ Ошибка: твой Telegram аккаунт не найден в системе.\n"
            "Отправь /start для регистрации."
        )
        return
    
    player_id = telegram_user.player_id if telegram_user.player else None
    
    live_tournaments = await get_live_tournaments()
    registration_tournaments = await get_registration_tournaments()
    
    if not live_tournaments and not registration_tournaments:
        await callback.message.answer("Нет доступных турниров")
        return
    
    if live_tournaments:
        await callback.message.answer(f"{hbold('🏆 Турниры Live')}")
        for tournament in live_tournaments:
            from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
            keyboard = InlineKeyboardMarkup(inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="📋 Подробнее",
                        url=f"{WEB_APP_URL}/tournaments/{tournament.id}"
                    )
                ]
            ])
            await callback.message.answer(
                format_tournament_info(tournament),
                reply_markup=keyboard
            )
    
    if registration_tournaments:
        await callback.message.answer(f"{hbold('📝 Турниры для регистрации')}")
        for tournament in registration_tournaments:
            is_registered = False
            if player_id:
                is_registered = await check_registration(tournament.id, player_id)
            
            from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
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
                    text="📋 Подробнее",
                    url=f"{WEB_APP_URL}/tournaments/{tournament.id}"
                )
            ])
            
            keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)
            await callback.message.answer(
                format_tournament_info(tournament, is_registered),
                reply_markup=keyboard
            )


@router.callback_query(F.data == "cmd_mytournaments")
async def callback_cmd_mytournaments(callback: CallbackQuery):
    """
    Обработчик кнопки "Мои турниры"
    """
    await callback.answer()
    await callback.message.delete()
    
    from .tournaments import get_telegram_user, get_user_tournaments, format_tournament_info
    
    telegram_user = await get_telegram_user(callback.from_user.id)
    
    if not telegram_user:
        await callback.message.answer(
            "❌ Ошибка: твой Telegram аккаунт не найден в системе.\n"
            "Отправь /start для регистрации."
        )
        return
    
    if not telegram_user.player:
        await callback.message.answer(
            "⚠️ Профиль игрока не связан с аккаунтом.\n\n"
            "Свяжи профиль на сайте: beachplay.ru/profile"
        )
        return
    
    tournaments = await get_user_tournaments(telegram_user.player_id)
    
    if not tournaments:
        await callback.message.answer(
            "📋 Ты пока не зарегистрирован ни на один турнир.\n\n"
            "Используй /tournaments для просмотра доступных турниров"
        )
        return
    
    await callback.message.answer(f"{hbold('🏆 Мои турниры')}\n")
    
    for tournament in tournaments:
        from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="📋 Подробнее",
                    url=f"{WEB_APP_URL}/tournaments/{tournament.id}"
                )
            ]
        ])
        await callback.message.answer(
            format_tournament_info(tournament, is_registered=True),
            reply_markup=keyboard
        )


@router.callback_query(F.data == "cmd_myregistration")
async def callback_cmd_myregistration(callback: CallbackQuery):
    """
    Обработчик кнопки "Мои регистрации"
    """
    await callback.answer()
    await callback.message.delete()
    
    from .tournaments import get_telegram_user, get_user_tournaments
    
    telegram_user = await get_telegram_user(callback.from_user.id)
    
    if not telegram_user:
        await callback.message.answer(
            "❌ Ошибка: твой Telegram аккаунт не найден в системе.\n"
            "Отправь /start для регистрации."
        )
        return
    
    if not telegram_user.player:
        await callback.message.answer(
            "⚠️ Профиль игрока не связан с аккаунтом.\n\n"
            "Свяжи профиль на сайте: beachplay.ru/profile"
        )
        return
    
    tournaments = await get_user_tournaments(telegram_user.player_id)
    
    if not tournaments:
        await callback.message.answer(
            "📋 Ты пока не зарегистрирован ни на один турнир.\n\n"
            "Используй /tournaments для просмотра доступных турниров"
        )
        return
    
    created_tournaments = [t for t in tournaments if t.status == 'created']
    
    if not created_tournaments:
        await callback.message.answer(
            "📋 У тебя нет активных регистраций на турниры.\n\n"
            "Используй /tournaments для просмотра доступных турниров"
        )
        return
    
    await callback.message.answer(f"{hbold('📝 Мои регистрации')}\n")
    
    for tournament in created_tournaments:
        reg_status = await get_registration_status(tournament.id, telegram_user.player_id)
        
        if not reg_status:
            continue
        
        status_text = ""
        if reg_status['status'] == 'main_list':
            status_text = "✅ Основной состав"
        elif reg_status['status'] == 'reserve_list':
            status_text = "📋 Резервный список"
        elif reg_status['status'] == 'looking_for_partner':
            status_text = "🔍 Ищу пару"
        elif reg_status['status'] == 'invited':
            status_text = "📨 Есть приглашение"
        
        partner_text = ""
        if reg_status['partner']:
            partner = reg_status['partner']
            partner_name = f"{partner.last_name} {partner.first_name}"
            if partner.patronymic:
                partner_name += f" {partner.patronymic}"
            partner_text = f"\n👥 Напарник: {partner_name}"
        
        text = (
            f"{hbold(tournament.name)}\n"
            f"📊 Статус: {status_text}{partner_text}\n"
        )
        
        if tournament.date:
            text += f"📅 Дата: {tournament.date.strftime('%d.%m.%Y')}\n"
        
        from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
        keyboard_buttons = [
            [
                InlineKeyboardButton(
                    text="📋 Подробнее",
                    url=f"{WEB_APP_URL}/tournaments/{tournament.id}"
                )
            ]
        ]
        
        keyboard_buttons.append([
            InlineKeyboardButton(
                text="❌ Отменить регистрацию",
                callback_data=f"cancel_reg_{tournament.id}"
            )
        ])
        
        keyboard = InlineKeyboardMarkup(inline_keyboard=keyboard_buttons)
        
        await callback.message.answer(text, reply_markup=keyboard)


@router.callback_query(F.data == "cmd_profile")
async def callback_cmd_profile(callback: CallbackQuery):
    """
    Обработчик кнопки "Мой профиль"
    """
    await callback.answer()
    await callback.message.delete()
    
    from .tournaments import get_telegram_user
    
    telegram_user = await get_telegram_user(callback.from_user.id)
    
    if not telegram_user:
        await callback.message.answer(
            "❌ Ошибка: твой Telegram аккаунт не найден в системе.\n"
            "Отправь /start для регистрации."
        )
        return
    
    if telegram_user.player:
        player = telegram_user.player
        text = (
            f"{hbold('👤 Мой профиль')}\n\n"
            f"👤 Имя: {player.first_name} {player.last_name}\n"
        )
        if player.patronymic:
            text = (
                f"{hbold('👤 Мой профиль')}\n\n"
                f"👤 Имя: {player.first_name} {player.patronymic} {player.last_name}\n"
            )
        
        if hasattr(player, 'current_rating') and player.current_rating:
            text += f"🏆 Рейтинг: {int(player.current_rating)} BP\n"
        
        from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="📝 Редактировать профиль",
                    url=f"{WEB_APP_URL}/profile"
                )
            ]
        ])
        
        await callback.message.answer(text, reply_markup=keyboard)
    else:
        from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
        keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🔗 Связать профиль",
                    url=f"{WEB_APP_URL}/profile"
                )
            ]
        ])
        
        await callback.message.answer(
            f"{hbold('⚠️ Профиль не связан')}\n\n"
            "Твой Telegram аккаунт не связан с профилем игрока.\n\n"
            "Используй команду /link для связывания.",
            reply_markup=keyboard
        )

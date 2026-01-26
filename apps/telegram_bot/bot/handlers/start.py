"""
Обработчик команды /start
"""
import os
from aiogram import Router, F
from aiogram.filters import CommandStart
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from aiogram.utils.markdown import hbold
from asgiref.sync import sync_to_async

from apps.telegram_bot.models import TelegramUser
from ..keyboards import get_main_keyboard

router = Router()

# URL веб-приложения
WEB_APP_URL = os.getenv('WEB_APP_URL', 'https://beachplay.ru')


@sync_to_async
def get_or_create_telegram_user(telegram_id, username, first_name, last_name, language_code):
    """Получение или создание Telegram пользователя"""
    return TelegramUser.objects.get_or_create(
        telegram_id=telegram_id,
        defaults={
            'username': username,
            'first_name': first_name or '',
            'last_name': last_name or '',
            'language_code': language_code or 'ru',
        }
    )


@router.message(CommandStart())
async def cmd_start(message: Message):
    """
    Обработка команды /start
    """
    # Получаем или создаём пользователя
    telegram_user, created = await get_or_create_telegram_user(
        telegram_id=message.from_user.id,
        username=message.from_user.username,
        first_name=message.from_user.first_name,
        last_name=message.from_user.last_name,
        language_code=message.from_user.language_code,
    )
    
    # Получаем постоянную клавиатуру
    main_keyboard = get_main_keyboard()
    
    if created:
        await message.answer(
            f"Привет, {hbold(message.from_user.first_name)}! 👋\n\n"
            f"Добро пожаловать в бот {hbold('BeachPlay')}!\n\n"
            f"Здесь ты можешь:\n"
            f"• Регистрироваться на турниры\n"
            f"• Искать пару для игры\n"
            f"• Следить за расписанием и результатами\n"
            f"• Получать уведомления о турнирах\n\n"
            f"Для начала свяжи свой Telegram с аккаунтом на beachplay.ru\n"
            f"Используй команду /link",
            reply_markup=main_keyboard
        )
    else:
        await message.answer(
            f"С возвращением, {hbold(message.from_user.first_name)}! 👋\n\n"
            f"Используй кнопки ниже для быстрого доступа:",
            reply_markup=main_keyboard
        )


@router.message(F.text == "🏆 Турниры")
async def handle_tournaments_button(message: Message):
    """Обработчик кнопки 'Турниры'"""
    from .registration import callback_cmd_tournaments
    # Создаём фейковый callback для переиспользования логики
    from aiogram.types import CallbackQuery
    from unittest.mock import AsyncMock
    
    callback = AsyncMock(spec=CallbackQuery)
    callback.from_user = message.from_user
    callback.message = message
    callback.answer = AsyncMock()
    
    await callback_cmd_tournaments(callback)


@router.message(F.text == "👤 Мой профиль")
async def handle_profile_button(message: Message):
    """Обработчик кнопки 'Мой профиль'"""
    from .registration import callback_cmd_profile
    from aiogram.types import CallbackQuery
    from unittest.mock import AsyncMock
    
    callback = AsyncMock(spec=CallbackQuery)
    callback.from_user = message.from_user
    callback.message = message
    callback.answer = AsyncMock()
    
    await callback_cmd_profile(callback)


@router.message(F.text == "✍️ Заявиться на турнир")
async def handle_register_button(message: Message):
    """Обработчик кнопки 'Заявиться на турнир'"""
    from .registration import callback_cmd_register
    from aiogram.types import CallbackQuery
    from unittest.mock import AsyncMock
    
    callback = AsyncMock(spec=CallbackQuery)
    callback.from_user = message.from_user
    callback.message = message
    callback.answer = AsyncMock()
    
    await callback_cmd_register(callback)


@router.message(F.text == "📋 Мои заявки")
async def handle_myregistration_button(message: Message):
    """Обработчик кнопки 'Мои заявки'"""
    from .registration import callback_cmd_myregistration
    from aiogram.types import CallbackQuery
    from unittest.mock import AsyncMock
    
    callback = AsyncMock(spec=CallbackQuery)
    callback.from_user = message.from_user
    callback.message = message
    callback.answer = AsyncMock()
    
    await callback_cmd_myregistration(callback)


@router.message(F.text == "📋 Мои турниры")
async def handle_mytournaments_button(message: Message):
    """Обработчик кнопки 'Мои турниры'"""
    from .registration import callback_cmd_mytournaments
    from aiogram.types import CallbackQuery
    from unittest.mock import AsyncMock
    
    callback = AsyncMock(spec=CallbackQuery)
    callback.from_user = message.from_user
    callback.message = message
    callback.answer = AsyncMock()
    
    await callback_cmd_mytournaments(callback)


@router.message(F.text == "🔴 Live")
async def handle_live_button(message: Message):
    """Обработчик кнопки 'Live'"""
    from .registration import callback_cmd_live
    from aiogram.types import CallbackQuery
    from unittest.mock import AsyncMock
    
    callback = AsyncMock(spec=CallbackQuery)
    callback.from_user = message.from_user
    callback.message = message
    callback.answer = AsyncMock()
    
    await callback_cmd_live(callback)


@router.message(F.text == "🌐 BeachPlay.ru")
async def handle_website_button(message: Message):
    """Обработчик кнопки 'BeachPlay.ru'"""
    from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text="🌐 Открыть BeachPlay.ru",
                url=f"{WEB_APP_URL}"
            )
        ]
    ])
    
    await message.answer(
        f"{hbold('BeachPlay.ru')} — платформа для пляжного волейбола\n\n"
        f"На сайте ты можешь:\n"
        f"• Просматривать все турниры\n"
        f"• Управлять своим профилем\n"
        f"• Создавать турниры\n"
        f"• Следить за рейтингом игроков",
        reply_markup=keyboard
    )

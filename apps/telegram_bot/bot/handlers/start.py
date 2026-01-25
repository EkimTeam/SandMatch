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
    
    # Создаём клавиатуру с Web App кнопкой
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text="🎾 Открыть BeachPlay",
                web_app=WebAppInfo(url=f"{WEB_APP_URL}/mini-app/")
            )
        ],
        [
            InlineKeyboardButton(
                text="🏆 Турниры",
                web_app=WebAppInfo(url=f"{WEB_APP_URL}/mini-app/tournaments")
            )
        ],
        [
            InlineKeyboardButton(
                text="👤 Мой профиль",
                web_app=WebAppInfo(url=f"{WEB_APP_URL}/mini-app/profile")
            )
        ]
    ])
    
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
            reply_markup=keyboard
        )
    else:
        # Создаём клавиатуру с командами бота
        bot_keyboard = InlineKeyboardMarkup(inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🎾 Открыть BeachPlay",
                    web_app=WebAppInfo(url=f"{WEB_APP_URL}/mini-app/")
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
        
        await message.answer(
            f"С возвращением, {hbold(message.from_user.first_name)}! 👋\n\n"
            f"Используй кнопки ниже для быстрого доступа:",
            reply_markup=bot_keyboard
        )

"""
Обработчик команды /start
"""
from aiogram import Router, F
from aiogram.filters import CommandStart
from aiogram.types import Message
from aiogram.utils.markdown import hbold
from asgiref.sync import sync_to_async

from apps.telegram_bot.models import TelegramUser

router = Router()


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
            f"Используй команду /link"
        )
    else:
        await message.answer(
            f"С возвращением, {hbold(message.from_user.first_name)}! 👋\n\n"
            f"Чем могу помочь?\n\n"
            f"/tournaments - список турниров\n"
            f"/mytournaments - мои турниры\n"
            f"/profile - мой профиль\n"
            f"/help - справка по командам"
        )

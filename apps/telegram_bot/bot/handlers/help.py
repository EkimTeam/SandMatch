"""
Обработчик команды /help - справка по командам
"""
import os
from aiogram import Router
from aiogram.filters import Command
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from aiogram.utils.markdown import hbold, hcode

router = Router()

# URL веб-приложения
WEB_APP_URL = os.getenv('WEB_APP_URL', 'https://beachplay.ru')


@router.message(Command("help"))
async def cmd_help(message: Message):
    """
    Обработка команды /help
    Показывает список доступных команд
    """
    help_text = f"{hbold('📖 Справка по командам')}\n\n"
    
    help_text += f"{hbold('Основные команды:')}\n"
    help_text += f"{hcode('/start')} - Начать работу с ботом\n"
    help_text += f"{hcode('/help')} - Эта справка\n"
    help_text += f"{hcode('/profile')} - Мой профиль\n\n"
    
    help_text += f"{hbold('Связывание аккаунта:')}\n"
    help_text += f"{hcode('/link КОД')} - Связать Telegram с аккаунтом\n"
    help_text += f"Код можно получить на сайте beachplay.ru\n\n"
    
    help_text += f"{hbold('Турниры:')}\n"
    help_text += f"{hcode('/tournaments')} - Список активных турниров\n"
    help_text += f"{hcode('/mytournaments')} - Мои турниры\n\n"
    
    help_text += f"{hbold('Полезные ссылки:')}\n"
    help_text += f"🌐 Сайт: beachplay.ru\n"
    help_text += f"📊 Рейтинг: beachplay.ru/rating\n"
    help_text += f"👤 Профиль: beachplay.ru/profile\n\n"
    
    help_text += f"По всем вопросам обращайся к администратору"
    
    # Создаём клавиатуру с Web App кнопками
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text="🎾 Открыть BeachPlay",
                web_app=WebAppInfo(url=f"{WEB_APP_URL}/mini-app/")
            )
        ]
    ])
    
    await message.answer(help_text, reply_markup=keyboard)

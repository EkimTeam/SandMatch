"""
Клавиатуры для Telegram-бота
"""
import os
from aiogram.types import ReplyKeyboardMarkup, KeyboardButton, WebAppInfo

WEB_APP_URL = os.getenv('WEB_APP_URL', 'https://beachplay.ru')


def get_main_keyboard() -> ReplyKeyboardMarkup:
    """
    Возвращает основную постоянную клавиатуру бота
    """
    keyboard = ReplyKeyboardMarkup(
        keyboard=[
            [
                KeyboardButton(
                    text="📱 Мини-апп",
                    web_app=WebAppInfo(url=f"{WEB_APP_URL}/mini-app/")
                ),
                KeyboardButton(text="🌐 BeachPlay.ru")
            ],
            [
                KeyboardButton(text="🏆 Турниры"),
                KeyboardButton(text="📋 Мои турниры")
            ],
            [
                KeyboardButton(text="🔴 Live"),
                KeyboardButton(text="✍️ Заявиться на турнир")
            ],
            [
                KeyboardButton(text="📝 Мои заявки"),
                KeyboardButton(text="👤 Мой профиль")
            ]
        ],
        resize_keyboard=True,
        input_field_placeholder="Выберите действие..."
    )
    return keyboard

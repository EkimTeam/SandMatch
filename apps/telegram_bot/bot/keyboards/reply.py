"""
Reply клавиатуры для бота
"""
from aiogram.types import ReplyKeyboardMarkup, KeyboardButton
from aiogram.utils.keyboard import ReplyKeyboardBuilder


def get_main_keyboard() -> ReplyKeyboardMarkup:
    """Основная клавиатура"""
    builder = ReplyKeyboardBuilder()
    builder.row(
        KeyboardButton(text="🏐 Турниры"),
        KeyboardButton(text="📊 Рейтинг"),
    )
    builder.row(
        KeyboardButton(text="👥 Найти пару"),
        KeyboardButton(text="⚙️ Настройки"),
    )
    return builder.as_markup(resize_keyboard=True)

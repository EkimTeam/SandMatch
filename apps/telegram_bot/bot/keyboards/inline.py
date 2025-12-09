"""
Inline клавиатуры для бота
"""
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.utils.keyboard import InlineKeyboardBuilder


def get_main_menu_keyboard() -> InlineKeyboardMarkup:
    """Главное меню"""
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(text="🏐 Турниры", callback_data="tournaments"),
        InlineKeyboardButton(text="📊 Рейтинг", callback_data="rating"),
    )
    builder.row(
        InlineKeyboardButton(text="👥 Найти пару", callback_data="find_pair"),
        InlineKeyboardButton(text="⚙️ Настройки", callback_data="settings"),
    )
    return builder.as_markup()


def get_tournament_actions_keyboard(tournament_id: int) -> InlineKeyboardMarkup:
    """Действия с турниром"""
    builder = InlineKeyboardBuilder()
    builder.row(
        InlineKeyboardButton(
            text="✅ Зарегистрироваться",
            callback_data=f"register_{tournament_id}"
        )
    )
    builder.row(
        InlineKeyboardButton(
            text="📋 Расписание",
            callback_data=f"schedule_{tournament_id}"
        ),
        InlineKeyboardButton(
            text="🏆 Результаты",
            callback_data=f"results_{tournament_id}"
        ),
    )
    builder.row(
        InlineKeyboardButton(text="◀️ Назад", callback_data="tournaments")
    )
    return builder.as_markup()

"""
Singleton для получения экземпляра бота Telegram.
Используется для отправки сообщений из Celery задач.
"""
from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from django.conf import settings


_bot_instance = None


def get_bot() -> Bot:
    """
    Получить экземпляр бота Telegram.
    Создаёт singleton при первом вызове.
    
    Returns:
        Bot: Экземпляр aiogram Bot
    """
    global _bot_instance
    
    if _bot_instance is None:
        bot_token = settings.TELEGRAM_BOT_TOKEN
        if not bot_token:
            raise ValueError("TELEGRAM_BOT_TOKEN не установлен в настройках")
        
        _bot_instance = Bot(
            token=bot_token,
            default=DefaultBotProperties(parse_mode=ParseMode.HTML)
        )
    
    return _bot_instance

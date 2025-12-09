"""
Настройка диспетчера aiogram
"""
from aiogram import Dispatcher
from aiogram.fsm.storage.memory import MemoryStorage

from .config import BotConfig


def setup_dispatcher(config: BotConfig) -> Dispatcher:
    """
    Создание и настройка диспетчера
    
    Args:
        config: конфигурация бота
        
    Returns:
        настроенный диспетчер
    """
    # Создаём хранилище для FSM (в продакшене можно использовать Redis)
    storage = MemoryStorage()
    
    # Создаём диспетчер
    dp = Dispatcher(storage=storage)
    
    # Регистрируем роутеры
    from .handlers import start, link
    dp.include_router(start.router)
    dp.include_router(link.router)
    
    # Будет добавлено позже:
    # from .handlers import tournaments, registration, pairs, rating
    # dp.include_router(tournaments.router)
    # dp.include_router(registration.router)
    # dp.include_router(pairs.router)
    # dp.include_router(rating.router)
    
    return dp

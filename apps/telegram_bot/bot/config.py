"""
Конфигурация Telegram бота
"""
import os
from dataclasses import dataclass


@dataclass
class BotConfig:
    """Конфигурация бота"""
    token: str
    webhook_url: str = ""
    webhook_path: str = "/api/telegram/webhook/"
    use_webhook: bool = False
    web_app_url: str = ""
    
    @classmethod
    def from_env(cls):
        """Загрузка конфигурации из переменных окружения"""
        return cls(
            token=os.getenv("TELEGRAM_BOT_TOKEN", ""),
            webhook_url=os.getenv("TELEGRAM_WEBHOOK_URL", ""),
            use_webhook=os.getenv("TELEGRAM_USE_WEBHOOK", "false").lower() == "true",
            web_app_url=os.getenv("WEB_APP_URL", "https://beachplay.ru"),
        )

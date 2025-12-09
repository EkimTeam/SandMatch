"""
Management команда для запуска Telegram бота
"""
import asyncio
import logging

from django.core.management.base import BaseCommand
from aiogram import Bot
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode

from apps.telegram_bot.bot.config import BotConfig
from apps.telegram_bot.bot.dispatcher import setup_dispatcher

# Настройка логирования
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = 'Запуск Telegram бота'

    def add_arguments(self, parser):
        parser.add_argument(
            '--webhook',
            action='store_true',
            help='Использовать webhook вместо long polling'
        )

    def handle(self, *args, **options):
        """Запуск бота"""
        config = BotConfig.from_env()
        
        if not config.token:
            self.stderr.write(
                self.style.ERROR('TELEGRAM_BOT_TOKEN не установлен в .env файле!')
            )
            return
        
        use_webhook = options.get('webhook', False) or config.use_webhook
        
        if use_webhook:
            self.stdout.write(
                self.style.WARNING('Webhook режим пока не реализован. Используйте long polling.')
            )
            return
        
        self.stdout.write(self.style.SUCCESS('Запуск бота в режиме long polling...'))
        
        # Запускаем бота
        asyncio.run(self.start_bot(config))
    
    async def start_bot(self, config: BotConfig):
        """Асинхронный запуск бота"""
        # Создаём бота
        bot = Bot(
            token=config.token,
            default=DefaultBotProperties(parse_mode=ParseMode.HTML)
        )
        
        # Настраиваем диспетчер
        dp = setup_dispatcher(config)
        
        try:
            # Получаем информацию о боте
            bot_info = await bot.get_me()
            logger.info(f"Бот запущен: @{bot_info.username}")
            self.stdout.write(
                self.style.SUCCESS(f'✅ Бот @{bot_info.username} успешно запущен!')
            )
            
            # Удаляем webhook если был установлен
            await bot.delete_webhook(drop_pending_updates=True)
            
            # Запускаем polling
            await dp.start_polling(bot)
            
        except Exception as e:
            logger.error(f"Ошибка при запуске бота: {e}")
            self.stderr.write(self.style.ERROR(f'❌ Ошибка: {e}'))
        finally:
            await bot.session.close()

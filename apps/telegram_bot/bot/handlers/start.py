"""Обработчик команды /start"""
import os
from aiogram import Router, F
from aiogram.filters import CommandStart, StateFilter, Command
from aiogram.types import Message, InlineKeyboardMarkup, InlineKeyboardButton, WebAppInfo
from aiogram.utils.markdown import hbold
from asgiref.sync import sync_to_async
from aiogram.fsm.context import FSMContext

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


@router.message(Command("chat_id"))
async def cmd_chat_id(message: Message):
    """Отправляет ID текущего чата в личные сообщения пользователю.

    В группе/канале бот шлёт chat_id в личку, а в самом чате пишет
    короткую подсказку.
    """
    chat = message.chat

    # Если команда вызвана в группе/супергруппе/канале — шлём ID в личку
    if chat.type in {"group", "supergroup", "channel"}:
        try:
            # Формируем подробную информацию о чате
            info_lines = [
                f"📋 **Информация о чате '{chat.title}'**",
                f"",
                f"🆔 **Chat ID:** `{chat.id}`",
                f"📱 **Тип:** {chat.type}",
            ]
            
            # Если это сообщение в теме (topic)
            if hasattr(message, 'message_thread_id') and message.message_thread_id:
                info_lines.append(f"💬 **Thread ID (тема):** `{message.message_thread_id}`")
                info_lines.append(f"")
                info_lines.append(f"⚠️ Для анонсов используй **Chat ID**, а не Thread ID")
            
            info_lines.append(f"")
            info_lines.append(f"✅ Скопируй Chat ID и вставь в настройки анонсов турнира")
            
            await message.bot.send_message(
                chat_id=message.from_user.id,
                text="\n".join(info_lines),
                parse_mode="Markdown"
            )
            await message.answer(
                "Я отправил подробную информацию о чате тебе в личные сообщения. "
                "Если сообщения нет — сначала открой личный диалог со мной и отправь /start."
            )
        except Exception as e:
            await message.answer(
                f"Не удалось отправить ID в личные сообщения: {e}\n"
                "Открой личный диалог со мной и отправь /start, а затем повтори /chat_id."
            )
        return

    # В личном чате просто выводим ID этого диалога
    await message.answer(f"ID этого чата: `{chat.id}`", parse_mode="Markdown")


@router.message(CommandStart())
async def cmd_start(message: Message):
    """Обработка команды /start.

    В группах не показываем большое меню, а просим написать в личку.
    Полноценное меню доступно только в приватном чате.
    
    Поддерживает Deep Link параметры:
    - /start register — показать турниры для регистрации
    """
    # В группе/супергруппе подсказка одной строкой
    if message.chat.type in {"group", "supergroup"}:
        await message.answer(
            "Я BeachPlay-бот и показываю меню только в личных сообщениях. "
            "Чтобы начать, открой диалог со мной и отправь /start."
        )
        return

    # Личный чат: показываем полноценное меню и регистрируем пользователя
    telegram_user, created = await get_or_create_telegram_user(
        telegram_id=message.from_user.id,
        username=message.from_user.username,
        first_name=message.from_user.first_name,
        last_name=message.from_user.last_name,
        language_code=message.from_user.language_code,
    )
    
    # Проверяем Deep Link параметр
    deep_link_param = message.text.split(maxsplit=1)[1] if len(message.text.split()) > 1 else None
    
    # Создаём inline-клавиатуру с командами бота (4 ряда по 2 кнопки)
    bot_keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text="📱 Мини-апп",
                web_app=WebAppInfo(url=f"{WEB_APP_URL}/mini-app/")
            ),
            InlineKeyboardButton(
                text="🌐 BeachPlay.ru",
                url=f"{WEB_APP_URL}"
            )
        ],
        [
            InlineKeyboardButton(
                text="🏆 Турниры",
                callback_data="cmd_tournaments"
            ),
            InlineKeyboardButton(
                text="📋 Мои турниры",
                callback_data="cmd_mytournaments"
            )
        ],
        [
            InlineKeyboardButton(
                text="🔴 Live",
                callback_data="cmd_live"
            ),
            InlineKeyboardButton(
                text="✍️ Заявиться на турнир",
                callback_data="cmd_register"
            )
        ],
        [
            InlineKeyboardButton(
                text="📝 Мои заявки",
                callback_data="cmd_myregistration"
            ),
            InlineKeyboardButton(
                text="👤 Мой профиль",
                callback_data="cmd_profile"
            )
        ]
    ])

    if created:
        # Первый заход в бота — показываем приветствие и сразу 8 кнопок
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
            reply_markup=bot_keyboard
        )
    else:
        # Повторный заход — то же меню
        await message.answer(
            f"С возвращением, {hbold(message.from_user.first_name)}! 👋\n\n"
            f"Используй кнопки ниже для быстрого доступа:",
            reply_markup=bot_keyboard
        )
    
    # Если пришли по Deep Link с параметром register — автоматически показываем турниры для регистрации
    if deep_link_param:
        from aiogram.types import CallbackQuery
        from unittest.mock import AsyncMock

        # /start register_<tournament_id> -> сразу открыть конкретный турнир
        if deep_link_param.startswith("register_"):
            try:
                tournament_id = int(deep_link_param.split("_", 1)[1])
            except ValueError:
                tournament_id = None

            if tournament_id is not None:
                from .tournaments import callback_register

                callback = AsyncMock(spec=CallbackQuery)
                callback.data = f"register_{tournament_id}"
                callback.from_user = message.from_user
                callback.message = message
                callback.answer = AsyncMock()

                await callback_register(callback)
                return

        # /start register -> общий список турниров для регистрации
        if deep_link_param == "register":
            from .registration import callback_cmd_register

            callback = AsyncMock(spec=CallbackQuery)
            callback.from_user = message.from_user
            callback.message = message
            callback.answer = AsyncMock()

            await callback_cmd_register(callback)


@router.message(F.text == "🏆 Турниры")
async def handle_tournaments_button(message: Message):
    """Обработчик кнопки 'Турниры'"""
    from .registration import callback_cmd_tournaments
    # Создаём фейковый callback для переиспользования логики
    from aiogram.types import CallbackQuery
    from unittest.mock import AsyncMock
    
    callback = AsyncMock(spec=CallbackQuery)
    callback.from_user = message.from_user
    callback.message = message
    callback.answer = AsyncMock()
    
    await callback_cmd_tournaments(callback)


@router.message(F.text == "👤 Мой профиль")
async def handle_profile_button(message: Message):
    """Обработчик кнопки 'Мой профиль'"""
    from .registration import callback_cmd_profile
    from aiogram.types import CallbackQuery
    from unittest.mock import AsyncMock
    
    callback = AsyncMock(spec=CallbackQuery)
    callback.from_user = message.from_user
    callback.message = message
    callback.answer = AsyncMock()
    
    await callback_cmd_profile(callback)


@router.message(F.text == "✍️ Заявиться на турнир")
async def handle_register_button(message: Message):
    """Обработчик кнопки 'Заявиться на турнир'"""
    from .registration import callback_cmd_register
    from aiogram.types import CallbackQuery
    from unittest.mock import AsyncMock
    
    callback = AsyncMock(spec=CallbackQuery)
    callback.from_user = message.from_user
    callback.message = message
    callback.answer = AsyncMock()
    
    await callback_cmd_register(callback)


@router.message(F.text == "📝 Мои заявки")
async def handle_myregistration_button(message: Message):
    """Обработчик кнопки 'Мои заявки'"""
    from .registration import callback_cmd_myregistration
    from aiogram.types import CallbackQuery
    from unittest.mock import AsyncMock
    
    callback = AsyncMock(spec=CallbackQuery)
    callback.from_user = message.from_user
    callback.message = message
    callback.answer = AsyncMock()
    
    await callback_cmd_myregistration(callback)


@router.message(F.text == "📋 Мои турниры")
async def handle_mytournaments_button(message: Message):
    """Обработчик кнопки 'Мои турниры'"""
    from .registration import callback_cmd_mytournaments
    from aiogram.types import CallbackQuery
    from unittest.mock import AsyncMock
    
    callback = AsyncMock(spec=CallbackQuery)
    callback.from_user = message.from_user
    callback.message = message
    callback.answer = AsyncMock()
    
    await callback_cmd_mytournaments(callback)


@router.message(F.text == "🔴 Live")
async def handle_live_button(message: Message):
    """Обработчик кнопки 'Live'"""
    from .registration import callback_cmd_live
    from aiogram.types import CallbackQuery
    from unittest.mock import AsyncMock
    
    callback = AsyncMock(spec=CallbackQuery)
    callback.from_user = message.from_user
    callback.message = message
    callback.answer = AsyncMock()
    
    await callback_cmd_live(callback)


@router.message(F.text == "🌐 BeachPlay.ru")
async def handle_website_button(message: Message):
    """Обработчик кнопки 'BeachPlay.ru'"""
    from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
    
    keyboard = InlineKeyboardMarkup(inline_keyboard=[
        [
            InlineKeyboardButton(
                text="🌐 Открыть BeachPlay.ru",
                url=f"{WEB_APP_URL}"
            )
        ]
    ])
    
    await message.answer(
        f"{hbold('BeachPlay.ru')} — платформа для пляжного волейбола\n\n"
        f"На сайте ты можешь:\n"
        f"• Просматривать все турниры\n"
        f"• Управлять своим профилем\n"
        f"• Создавать турниры\n"
        f"• Следить за рейтингом игроков",
        reply_markup=keyboard
    )


@router.message(F.text, StateFilter(None))
async def fallback_text_handler(message: Message, state: FSMContext):
    """Обработчик произвольного текста.

    В личке подсказываем про /start, в группах молчим, чтобы не спамить.
    """
    # В группах/каналах никак не реагируем на произвольный текст
    if message.chat.type in {"group", "supergroup", "channel"}:
        return

    # В личке не перебиваем стандартные команды, которые начинаются с "/"
    if message.text and message.text.startswith("/"):
        return

    await message.answer("Чтобы начать, отправь /start.")

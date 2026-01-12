"""
Обработчик команды /link - связывание с аккаунтом
"""
from aiogram import Router, F
from aiogram.filters import Command
from aiogram.types import Message
from aiogram.utils.markdown import hbold, hcode
from asgiref.sync import sync_to_async
from django.utils import timezone

from django.db import models
from apps.telegram_bot.models import TelegramUser, LinkCode
from apps.players.models import Player

router = Router()


@sync_to_async
def get_telegram_user(telegram_id):
    """Получение Telegram пользователя"""
    try:
        return TelegramUser.objects.get(telegram_id=telegram_id)
    except TelegramUser.DoesNotExist:
        return None


@sync_to_async
def validate_and_use_code(code_str, telegram_user):
    """
    Валидация и использование кода связывания
    
    Returns:
        tuple: (success: bool, message: str, user: User|None)
    """
    try:
        link_code = LinkCode.objects.select_related('user').get(code=code_str.upper())
    except LinkCode.DoesNotExist:
        return False, "❌ Код не найден. Проверь правильность ввода.", None
    
    if not link_code.is_valid():
        if link_code.is_used:
            return False, "❌ Этот код уже был использован.", None
        else:
            return False, "❌ Код истёк. Сгенерируй новый на сайте.", None
    
    # Проверяем, не связан ли уже этот Telegram с другим пользователем
    if telegram_user.user and telegram_user.user != link_code.user:
        return False, f"❌ Твой Telegram уже связан с аккаунтом {telegram_user.user.username}", None

    # Если у этого пользователя уже есть TelegramUser (созданный, например, через сайт),
    # аккуратно объединяем записи, чтобы не нарушать уникальность OneToOne по user.
    existing_for_user = TelegramUser.objects.filter(user=link_code.user).exclude(pk=telegram_user.pk).first()
    if existing_for_user:
        # Если у существующей записи нет telegram_id, переносим туда текущий telegram_id и базовые данные,
        # а временную запись (созданную по telegram_id без user) удаляем.
        if existing_for_user.telegram_id is None:
            # Чтобы не нарушить уникальность telegram_id, сначала освобождаем его у временной записи
            original_telegram_id = telegram_user.telegram_id
            if original_telegram_id is not None:
                telegram_user.telegram_id = None
                telegram_user.save(update_fields=["telegram_id"])

            existing_for_user.telegram_id = original_telegram_id
            existing_for_user.username = telegram_user.username or existing_for_user.username
            if not existing_for_user.first_name:
                existing_for_user.first_name = telegram_user.first_name
            if not existing_for_user.last_name:
                existing_for_user.last_name = telegram_user.last_name
            existing_for_user.language_code = telegram_user.language_code or existing_for_user.language_code
            existing_for_user.save()

            # После переноса данных работаем дальше с existing_for_user как с основным объектом
            telegram_user.delete()
            telegram_user = existing_for_user
        else:
            # Крайний случай: у пользователя уже есть полноценная запись TelegramUser с другим telegram_id.
            # В этом случае считаем, что аккаунт уже связан, и не пытаемся переназначать.
            return False, "❌ Этот аккаунт уже связан с другим Telegram.", None

    # Связываем аккаунты (на этом этапе либо используем исходный telegram_user, либо объединённый existing_for_user)
    telegram_user.user = link_code.user
    
    # Пытаемся найти игрока по email или ФИО пользователя, если ещё не привязан
    if telegram_user.player is None:
        try:
            player = Player.objects.filter(
                models.Q(email=link_code.user.email) |
                models.Q(last_name=link_code.user.last_name, first_name=link_code.user.first_name)
            ).first()
            
            if player:
                telegram_user.player = player
        except Exception:
            # Автоподбор игрока не критичен, ошибки здесь не должны ломать связывание аккаунта
            pass
    
    telegram_user.save()
    
    # Помечаем код как использованный
    link_code.is_used = True
    link_code.used_at = timezone.now()
    link_code.save()
    
    return True, "✅ Аккаунты успешно связаны!", link_code.user


@router.message(Command("link"))
async def cmd_link(message: Message):
    """
    Обработка команды /link [КОД]
    """
    # Получаем Telegram пользователя
    telegram_user = await get_telegram_user(message.from_user.id)
    if not telegram_user:
        await message.answer(
            "❌ Ошибка: твой Telegram аккаунт не найден в системе.\n"
            "Отправь /start для регистрации."
        )
        return
    
    # Проверяем, не связан ли уже
    if telegram_user.user:
        await message.answer(
            f"✅ Твой Telegram уже связан с аккаунтом:\n"
            f"{hbold(telegram_user.user.get_full_name() or telegram_user.user.username)}\n\n"
            f"Для отвязки обратись к администратору."
        )
        return
    
    # Извлекаем код из команды
    args = message.text.split(maxsplit=1)
    if len(args) < 2:
        await message.answer(
            f"Для связывания аккаунта:\n\n"
            f"1️⃣ Зайди на {hbold('beachplay.ru')}\n"
            f"2️⃣ В профиле нажми {hbold('Связать с Telegram')}\n"
            f"3️⃣ Скопируй код и отправь мне:\n"
            f"   {hcode('/link ТВОЙ_КОД')}\n\n"
            f"Пример: {hcode('/link ABC123')}"
        )
        return
    
    code = args[1].strip()
    
    # Валидируем и используем код
    try:
        success, msg, user = await validate_and_use_code(code, telegram_user)
    except Exception as e:
        # Временный блок для дебага: показываем текст ошибки вместо немого падения
        await message.answer(f"❌ Внутренняя ошибка при связывании: {e}")
        return
    
    if success:
        await message.answer(
            f"{msg}\n\n"
            f"Привет, {hbold(user.get_full_name() or user.username)}! 👋\n\n"
            f"Теперь ты можешь:\n"
            f"• Регистрироваться на турниры через бота\n"
            f"• Получать уведомления о матчах\n"
            f"• Следить за своим рейтингом\n\n"
            f"Используй /tournaments для просмотра турниров"
        )
    else:
        await message.answer(msg)

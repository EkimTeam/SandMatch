"""
Обработчик команды /profile - просмотр профиля
"""
from aiogram import Router
from aiogram.filters import Command
from aiogram.types import Message
from aiogram.utils.markdown import hbold
from asgiref.sync import sync_to_async

from apps.telegram_bot.models import TelegramUser

router = Router()


@sync_to_async
def get_user_profile(telegram_id):
    """Получение профиля пользователя"""
    try:
        telegram_user = TelegramUser.objects.select_related('user', 'player').get(telegram_id=telegram_id)
        return telegram_user
    except TelegramUser.DoesNotExist:
        return None


@router.message(Command("profile"))
async def cmd_profile(message: Message):
    """
    Обработка команды /profile
    Показывает информацию о профиле пользователя
    """
    telegram_user = await get_user_profile(message.from_user.id)
    
    if not telegram_user:
        await message.answer(
            "❌ Ошибка: твой Telegram аккаунт не найден в системе.\n"
            "Отправь /start для регистрации."
        )
        return
    
    if not telegram_user.user:
        await message.answer(
            "⚠️ Твой Telegram не связан с аккаунтом на сайте.\n\n"
            "Для связывания:\n"
            "1️⃣ Зайди на beachplay.ru\n"
            "2️⃣ В профиле сгенерируй код\n"
            "3️⃣ Отправь мне /link КОД"
        )
        return
    
    user = telegram_user.user
    player = telegram_user.player
    
    # Формируем информацию о профиле
    profile_text = f"👤 {hbold('Твой профиль')}\n\n"
    
    # Основная информация
    full_name = user.get_full_name()
    if full_name:
        profile_text += f"📝 Имя: {hbold(full_name)}\n"
    profile_text += f"🔑 Логин: {hbold(user.username)}\n"
    
    if user.email:
        profile_text += f"📧 Email: {user.email}\n"
    
    # Информация об игроке
    if player:
        profile_text += f"\n🎾 {hbold('Игровой профиль')}\n"
        
        if player.display_name:
            profile_text += f"🏷 Отображаемое имя: {hbold(player.display_name)}\n"
        
        if player.city:
            profile_text += f"📍 Город: {player.city}\n"
        
        if player.level:
            level_names = {
                'beginner': 'Новичок',
                'amateur': 'Любитель',
                'intermediate': 'Средний',
                'advanced': 'Продвинутый',
                'expert': 'Эксперт',
                'master': 'Мастер',
                'pro': 'Профессионал',
            }
            level_display = level_names.get(player.level, player.level)
            profile_text += f"🎯 Уровень: {level_display}\n"
        
        profile_text += f"⭐️ Рейтинг: {hbold(str(player.current_rating))}\n"
        
        if player.is_profi:
            profile_text += f"\n🏆 {hbold('Профессиональный игрок BTR')}\n"
    else:
        profile_text += f"\n⚠️ Профиль игрока не связан\n"
        profile_text += f"Свяжи профиль на сайте для участия в турнирах\n"
    
    profile_text += f"\n💻 Редактировать профиль: beachplay.ru/profile"
    
    await message.answer(profile_text)

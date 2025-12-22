# Структура связей пользователей

## Обзор

В системе существует несколько способов связывания пользователей с игроками и внешними сервисами. Этот документ описывает актуальную структуру и логику работы.

## Модели и связи

### 1. UserProfile (accounts_userprofile)

**Поля:**
- `user` - OneToOne связь с Django User
- `role` - роль пользователя (ADMIN, ORGANIZER, REFEREE, REGISTERED)
- `player` - ForeignKey к Player (может быть NULL)
- `telegram_id` - BigInteger (может быть NULL) - **УСТАРЕВШЕЕ ПОЛЕ**
- `telegram_username` - CharField (может быть NULL) - **УСТАРЕВШЕЕ ПОЛЕ**

**Примечание:** Поля `telegram_id` и `telegram_username` в UserProfile являются устаревшими и не используются. Связь с Telegram осуществляется через модель TelegramUser.

### 2. TelegramUser (telegram_bot_telegramuser)

**Поля:**
- `telegram_id` - BigInteger, уникальный ID пользователя в Telegram
- `username` - Telegram username
- `user` - OneToOne связь с Django User (может быть NULL)
- `player` - OneToOne связь с Player (может быть NULL)

**Назначение:** Основная модель для связи пользователя с Telegram и игроком через Telegram-бота.

### 3. Player (players_player)

**Поля:**
- `btr_player` - OneToOne связь с BtrPlayer (может быть NULL)
- Другие поля игрока (имя, рейтинг и т.д.)

## Логика проверки связей

### Связь с Telegram
Проверяется наличие записи в `TelegramUser` с `user_id = user.id`:
```python
has_telegram = hasattr(user, 'telegram_profile') and user.telegram_profile is not None
```

### Связь с BP игроком
Проверяется в двух местах (приоритет - TelegramUser):
1. `TelegramUser.player` (если пользователь связал игрока через Telegram-бота)
2. `UserProfile.player` (если связь установлена через веб-интерфейс)

```python
if telegram_user and telegram_user.player:
    has_bp_player = True
elif profile and profile.player:
    has_bp_player = True
```

### Связь с BTR игроком
Проверяется через связанного BP игрока:
```python
if telegram_user and telegram_user.player:
    has_btr_player = telegram_user.player.btr_player_id is not None
elif profile and profile.player:
    has_btr_player = profile.player.btr_player_id is not None
```

## Рекомендации

### Синхронизация данных

Для избежания расхождений рекомендуется:

1. **При связывании через Telegram-бота:**
   - Обновлять `TelegramUser.player`
   - Опционально синхронизировать с `UserProfile.player`

2. **При связывании через веб-интерфейс:**
   - Обновлять `UserProfile.player`
   - Если существует `TelegramUser`, синхронизировать `TelegramUser.player`

3. **Удаление устаревших полей:**
   - Поля `UserProfile.telegram_id` и `UserProfile.telegram_username` можно удалить в будущей миграции
   - Вся логика работы с Telegram должна использовать модель `TelegramUser`

## Примеры запросов

### Получение всех пользователей с связями
```python
users = User.objects.select_related(
    'profile',
    'profile__player',
    'profile__player__btr_player',
    'telegram_profile',
    'telegram_profile__player',
    'telegram_profile__player__btr_player'
)
```

### Фильтр пользователей с BP игроком
```python
users.filter(
    Q(telegram_profile__player__isnull=False) | 
    Q(profile__player__isnull=False)
)
```

### Фильтр пользователей с BTR игроком
```python
users.filter(
    Q(telegram_profile__player__btr_player__isnull=False) | 
    Q(profile__player__btr_player__isnull=False)
)
```

### Фильтр пользователей с Telegram
```python
users.filter(telegram_profile__isnull=False)
```

# Telegram Bot для BeachPlay

Telegram-бот для управления турнирами по пляжному теннису.

## Возможности

### Основные команды

- `/start` — Начать работу с ботом
- `/help` — Справка по командам
- `/link <КОД>` — Связать Telegram с аккаунтом на сайте
- `/profile` — Просмотр профиля пользователя
- `/tournaments` — Список активных турниров
- `/mytournaments` — Мои турниры

### Функционал

1. **Связывание аккаунта**
   - Генерация кода на сайте (в профиле пользователя)
   - Связывание через команду `/link КОД`
   - Автоматическое связывание с профилем игрока

2. **Просмотр профиля**
   - Основная информация о пользователе
   - Игровой профиль (рейтинг, уровень, город)
   - Статус профессионального игрока BTR

3. **Работа с турнирами**
   - Просмотр активных турниров
   - Информация о системе, формате, участниках
   - Inline-кнопки для перехода на сайт
   - Список турниров пользователя

## Настройка

### 1. Создание бота

1. Найди [@BotFather](https://t.me/BotFather) в Telegram
2. Отправь команду `/newbot`
3. Следуй инструкциям для создания бота
4. Сохрани полученный токен

### 2. Настройка переменных окружения

Добавь в `.env` файл:

```env
# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_USE_WEBHOOK=false
TELEGRAM_WEBHOOK_URL=
```

### 3. Установка зависимостей

Убедись, что установлены необходимые пакеты:

```bash
pip install aiogram==3.4.1
pip install asgiref
```

Или через Docker:

```bash
docker-compose exec web pip install aiogram==3.4.1
```

## Запуск бота

### Development (Long Polling)

```bash
# Локально
python manage.py run_bot

# В Docker
docker-compose exec web python manage.py run_bot
```

### Production (Webhook)

```bash
# Настрой webhook URL в .env
TELEGRAM_USE_WEBHOOK=true
TELEGRAM_WEBHOOK_URL=https://yourdomain.com

# Запусти бота
python manage.py run_bot --webhook
```

## Структура проекта

```
apps/telegram_bot/
├── bot/
│   ├── config.py              # Конфигурация бота
│   ├── dispatcher.py          # Настройка диспетчера
│   ├── handlers/              # Обработчики команд
│   │   ├── start.py           # /start
│   │   ├── link.py            # /link
│   │   ├── profile.py         # /profile
│   │   ├── help.py            # /help
│   │   └── tournaments.py     # /tournaments, /mytournaments
│   └── keyboards/             # Клавиатуры (будет добавлено)
├── management/
│   └── commands/
│       └── run_bot.py         # Команда запуска
├── models.py                  # Модели (TelegramUser, LinkCode)
└── README.md                  # Эта документация
```

## Тестирование

### 1. Проверка связывания

1. Зайди на сайт `http://localhost:8080/profile`
2. Нажми «Сгенерировать код» в разделе Telegram
3. Скопируй код
4. Отправь боту `/link ВАШ_КОД`
5. Проверь статус связи на сайте

### 2. Проверка команд

```
/start          - Приветствие
/profile        - Должен показать твой профиль
/tournaments    - Список активных турниров
/mytournaments  - Твои турниры (если есть)
/help           - Справка
```

## Разработка

### Добавление новой команды

1. Создай файл обработчика в `bot/handlers/`
2. Определи роутер и обработчики
3. Зарегистрируй роутер в `dispatcher.py`

Пример:

```python
# bot/handlers/mycommand.py
from aiogram import Router
from aiogram.filters import Command
from aiogram.types import Message

router = Router()

@router.message(Command("mycommand"))
async def cmd_mycommand(message: Message):
    await message.answer("Hello from mycommand!")
```

```python
# bot/dispatcher.py
from .handlers import mycommand
dp.include_router(mycommand.router)
```

### Работа с базой данных

Используй `@sync_to_async` для Django ORM:

```python
from asgiref.sync import sync_to_async

@sync_to_async
def get_user(user_id):
    return User.objects.get(id=user_id)

# В обработчике
user = await get_user(123)
```

## Следующие шаги

- [ ] Уведомления о новых турнирах
- [ ] Напоминания о начале турнира
- [ ] Уведомления о результатах матчей
- [ ] Поиск пары для игры
- [ ] Telegram Mini App для регистрации на турниры
- [ ] Webhook режим для production

## Troubleshooting

### Бот не отвечает

1. Проверь токен в `.env`
2. Убедись, что бот запущен: `docker-compose exec web python manage.py run_bot`
3. Проверь логи: `docker-compose logs -f web`

### Ошибка при связывании

1. Проверь, что код не истёк (15 минут)
2. Убедись, что код введён правильно (заглавные буквы)
3. Проверь, что пользователь не связан с другим аккаунтом

### Команды не работают

1. Убедись, что обработчики зарегистрированы в `dispatcher.py`
2. Проверь порядок роутеров (более специфичные должны быть выше)
3. Перезапусти бота

## Полезные ссылки

- [aiogram Documentation](https://docs.aiogram.dev/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [BotFather](https://t.me/BotFather)

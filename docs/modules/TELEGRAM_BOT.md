# Telegram бот

## Описание
Telegram бот для уведомлений, команд и запуска Mini-App.

## Файлы
- Backend: `apps/telegram_bot/bot.py`, `apps/telegram_bot/handlers/`, `apps/telegram_bot/models.py`
- Models: `TelegramUser`, `TelegramChat`

## Команды

### /start
Приветствие и регистрация пользователя
```
Привет! Я бот BeachPlay.
Нажми кнопку ниже, чтобы открыть приложение.
[Открыть BeachPlay] → Mini-App
```

### /tournaments
Список ближайших турниров

### /my_tournaments
Мои турниры (где зарегистрирован)

### /rating
Мой рейтинг и позиция

### /help
Справка по командам

## Модель TelegramUser
```python
class TelegramUser(models.Model):
    telegram_id = BigIntegerField(unique=True)
    username = CharField(max_length=100, null=True)
    first_name = CharField(max_length=100)
    last_name = CharField(max_length=100, null=True)
    user = ForeignKey(CustomUser, null=True)  # Связь с User
    created_at = DateTimeField(auto_now_add=True)
    is_active = BooleanField(default=True)
```

## Webhook
```python
# Настройка webhook
TELEGRAM_WEBHOOK_URL = f"{DOMAIN}/api/telegram/webhook/"

# Endpoint
@csrf_exempt
def telegram_webhook(request):
    update = telegram.Update.de_json(request.body, bot)
    dispatcher.process_update(update)
    return JsonResponse({'ok': True})
```

## Handlers
```python
# apps/telegram_bot/handlers/start.py
def start_command(update, context):
    keyboard = [[InlineKeyboardButton(
        "Открыть BeachPlay",
        web_app=WebAppInfo(url=f"{DOMAIN}/miniapp/")
    )]]
    
    update.message.reply_text(
        "Привет! Нажми кнопку ниже:",
        reply_markup=InlineKeyboardMarkup(keyboard)
    )
```

## Интеграция с Mini-App
```python
# Передача данных в Mini-App
def open_miniapp(update, context):
    telegram_user = update.effective_user
    
    # Создать или получить TelegramUser
    tg_user, _ = TelegramUser.objects.get_or_create(
        telegram_id=telegram_user.id,
        defaults={
            'username': telegram_user.username,
            'first_name': telegram_user.first_name
        }
    )
    
    # Mini-App получит telegram_user_id через initData
```

## Настройки
```env
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_BOT_USERNAME=your_bot_username
TELEGRAM_WEBHOOK_URL=https://beachplay.ru/api/telegram/webhook/
```

## Запуск
```bash
# В docker-compose.prod.yml
telegram-bot:
  image: ghcr.io/ekimteam/sandmatch/web:latest
  environment:
    - RUN_TELEGRAM_BOT=true
```

## Troubleshooting
- Webhook не работает → проверить TELEGRAM_WEBHOOK_URL и SSL
- Команды не отвечают → проверить handlers регистрацию
- Mini-App не открывается → проверить WebAppInfo URL

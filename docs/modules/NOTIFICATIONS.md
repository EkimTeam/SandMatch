# Уведомления

## Описание
Система уведомлений через Telegram с использованием Celery для асинхронной отправки.

## Файлы
- Backend: `apps/telegram_bot/services/notifications.py`, `apps/telegram_bot/tasks.py`
- Models: `TelegramUser`
- Queue: Celery + Redis

## Типы уведомлений

### tournament_start
Турнир начался
```
🎾 Турнир "Кубок города" начался!
Ваш первый матч в 10:00 на корте 1.
```

### match_ready
Ваш матч скоро начнется
```
⏰ Ваш матч начнется через 15 минут!
Корт 2, соперники: Иванов/Петров
```

### registration_confirmed
Регистрация подтверждена
```
✅ Вы зарегистрированы на турнир "Летний кубок"
Дата: 15 июля, 10:00
```

### partner_invitation
Приглашение в пару
```
👥 Иван Петров приглашает вас в пару
Турнир: "Кубок города"
[Принять] [Отклонить]
```

### tournament_results
Результаты турнира
```
🏆 Турнир "Кубок города" завершен!
Ваше место: 3
Новый рейтинг: 875 (+25)
```

## API

### POST /api/notifications/send/
Отправить уведомление (внутренний)
```json
{
  "telegram_user_id": 123456789,
  "type": "match_ready",
  "data": {
    "match_id": 100,
    "court": 2,
    "time": "10:00"
  }
}
```

## Celery Tasks

```python
# apps/telegram_bot/tasks.py

@shared_task
def send_tournament_start_notification(tournament_id):
    tournament = Tournament.objects.get(id=tournament_id)
    participants = tournament.entries.all()
    
    for entry in participants:
        telegram_user = entry.team.player_1.user.telegram_user
        send_telegram_message(
            telegram_user.telegram_id,
            f"🎾 Турнир '{tournament.name}' начался!"
        )

@shared_task
def send_match_ready_notification(match_id, minutes_before=15):
    match = Match.objects.get(id=match_id)
    # Отправить уведомления обоим командам
    ...
```

## Сервис отправки

```python
# apps/telegram_bot/services/notifications.py

def send_telegram_message(telegram_id: int, text: str, **kwargs):
    """
    Отправить сообщение в Telegram
    
    Args:
        telegram_id: ID пользователя в Telegram
        text: Текст сообщения
        **kwargs: reply_markup, parse_mode и т.д.
    """
    bot = telegram.Bot(token=settings.TELEGRAM_BOT_TOKEN)
    bot.send_message(
        chat_id=telegram_id,
        text=text,
        **kwargs
    )

def send_notification(user_id: int, notification_type: str, data: dict):
    """
    Отправить уведомление определенного типа
    
    Выбирает шаблон и отправляет через Celery
    """
    template = NOTIFICATION_TEMPLATES[notification_type]
    text = template.format(**data)
    
    telegram_user = TelegramUser.objects.get(user_id=user_id)
    send_telegram_message.delay(telegram_user.telegram_id, text)
```

## Шаблоны

```python
NOTIFICATION_TEMPLATES = {
    'tournament_start': "🎾 Турнир '{tournament_name}' начался!\n{details}",
    'match_ready': "⏰ Ваш матч начнется через {minutes} минут!\n"
                   "Корт {court}, соперники: {opponents}",
    'registration_confirmed': "✅ Вы зарегистрированы на турнир '{tournament_name}'\n"
                             "Дата: {date}, {time}",
    'partner_invitation': "👥 {inviter_name} приглашает вас в пару\n"
                         "Турнир: '{tournament_name}'",
    'tournament_results': "🏆 Турнир '{tournament_name}' завершен!\n"
                         "Ваше место: {place}\n"
                         "Новый рейтинг: {new_rating} ({change})"
}
```

## Триггеры

```python
# При начале турнира
@receiver(post_save, sender=Tournament)
def on_tournament_start(sender, instance, **kwargs):
    if instance.status == 'active' and instance._state.adding == False:
        send_tournament_start_notification.delay(instance.id)

# За 15 минут до матча
@periodic_task(run_every=timedelta(minutes=5))
def check_upcoming_matches():
    now = timezone.now()
    upcoming = Match.objects.filter(
        status='scheduled',
        scheduled_time__range=(now, now + timedelta(minutes=20))
    )
    
    for match in upcoming:
        send_match_ready_notification.delay(match.id)
```

## Настройки уведомлений

```python
# Пользователь может отключить типы уведомлений
class NotificationSettings(models.Model):
    user = OneToOneField(CustomUser)
    tournament_start = BooleanField(default=True)
    match_ready = BooleanField(default=True)
    registration_confirmed = BooleanField(default=True)
    partner_invitation = BooleanField(default=True)
    tournament_results = BooleanField(default=True)
```

## Celery Configuration

```python
# sandmatch/settings/base.py
CELERY_BROKER_URL = 'redis://redis:6379/0'
CELERY_RESULT_BACKEND = 'redis://redis:6379/0'
CELERY_BEAT_SCHEDULE = {
    'check-upcoming-matches': {
        'task': 'apps.telegram_bot.tasks.check_upcoming_matches',
        'schedule': timedelta(minutes=5),
    },
}
```

## Запуск

```bash
# Celery Worker
celery -A sandmatch worker -l info

# Celery Beat (для периодических задач)
celery -A sandmatch beat -l info
```

## Troubleshooting
- Уведомления не приходят → проверить Celery worker
- Дубли уведомлений → проверить idempotency в tasks
- Неверный текст → проверить шаблоны NOTIFICATION_TEMPLATES

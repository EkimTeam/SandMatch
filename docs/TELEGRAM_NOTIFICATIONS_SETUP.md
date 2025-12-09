# Настройка уведомлений Telegram бота

## Архитектура

```
┌─────────────┐     ┌──────────┐     ┌─────────────┐
│   Django    │────▶│  Redis   │◀────│   Celery    │
│   (Web)     │     │ (Broker) │     │   Worker    │
└─────────────┘     └──────────┘     └─────────────┘
                          ▲
                          │
                    ┌─────────────┐
                    │   Celery    │
                    │    Beat     │
                    └─────────────┘
```

- **Django** — создаёт задачи (например, при создании турнира)
- **Redis** — очередь задач
- **Celery Worker** — выполняет задачи (отправка уведомлений)
- **Celery Beat** — планировщик (запускает периодические задачи)

---

## 1. Проверка инфраструктуры

### Проверь `.env` файл

Убедись, что в `.env` есть эти строки:

```env
# Celery
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_RESULT_BACKEND=redis://redis:6379/0

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token_here
WEB_APP_URL=https://beachplay.ru
```

**Важно:**
- `redis://redis:6379/0` — `redis` это имя сервиса в docker-compose
- Локально и на проде используй одинаковые настройки (если Redis в Docker Compose)

---

## 2. Запуск локально

### Шаг 1: Запусти все сервисы

```bash
docker-compose up -d --build
```

Это запустит:
- `sandmatch_redis` — брокер сообщений
- `sandmatch_web` — Django приложение
- `sandmatch_celery` — обработчик задач
- `sandmatch_celery_beat` — планировщик

### Шаг 2: Проверь статус контейнеров

```bash
docker-compose ps
```

Все должны быть в статусе `Up`:

```
NAME                      STATUS
sandmatch_redis           Up
sandmatch_web             Up
sandmatch_celery          Up
sandmatch_celery_beat     Up
```

### Шаг 3: Проверь логи

```bash
# Celery Worker
docker-compose logs -f celery

# Celery Beat
docker-compose logs -f celery-beat
```

**Что должно быть в логах:**

**Celery Worker:**
```
[tasks]
  . apps.telegram_bot.tasks.check_upcoming_tournaments
  . apps.telegram_bot.tasks.cleanup_old_notifications
  . apps.telegram_bot.tasks.send_match_result_notification
  . apps.telegram_bot.tasks.send_new_tournament_notification
  . apps.telegram_bot.tasks.send_tournament_reminder

celery@... ready.
```

**Celery Beat:**
```
Scheduler: Sending due task check-upcoming-tournaments
Scheduler: Sending due task cleanup-old-notifications
```

---

## 3. Тестирование уведомлений

### Тест 1: Уведомление о новом турнире (вручную)

1. **Зайди в Django shell:**

```bash
docker-compose exec web python manage.py shell
```

2. **Выполни:**

```python
from apps.telegram_bot.tasks import send_new_tournament_notification
from apps.tournaments.models import Tournament

# Найди турнир
tournament = Tournament.objects.first()
print(f"Турнир: {tournament.name} (ID: {tournament.id})")

# Отправь уведомление
result = send_new_tournament_notification.delay(tournament.id)
print(f"Задача создана: {result.id}")
```

3. **Проверь логи Celery:**

```bash
docker-compose logs -f celery
```

Должно быть:
```
Отправлено N уведомлений о турнире "Название турнира"
```

4. **Проверь Telegram** — подписчики должны получить уведомление.

---

### Тест 2: Напоминание о турнире (вручную)

```python
from apps.telegram_bot.tasks import send_tournament_reminder
from apps.tournaments.models import Tournament

tournament = Tournament.objects.first()

# Напоминание за 24 часа
result = send_tournament_reminder.delay(tournament.id, hours_before=24)
print(f"Задача создана: {result.id}")
```

Участники турнира должны получить напоминание в Telegram.

---

### Тест 3: Автоматические напоминания (периодическая задача)

Celery Beat каждый час проверяет турниры, которые начнутся через 24 часа.

**Как проверить:**

1. **Создай турнир, который начнётся через ~24 часа:**
   - Зайди в админку: http://localhost:8000/sm-admin/
   - Создай турнир с датой = завтра в это же время
   - Добавь участников (команды с игроками, у которых есть Telegram)

2. **Подожди следующего часа** (или перезапусти beat):

```bash
docker-compose restart celery-beat
```

3. **Проверь логи:**

```bash
docker-compose logs -f celery-beat
docker-compose logs -f celery
```

Должно быть:
```
Запланировано 1 напоминаний о турнирах
Отправлено N напоминаний о турнире "Название"
```

---

## 4. Автоматизация на проде

### Вариант А: Docker Compose (рекомендую)

На проде используй тот же `docker-compose.yml`:

```bash
# Деплой
git pull
docker-compose up -d --build

# Проверка
docker-compose ps
docker-compose logs -f celery
docker-compose logs -f celery-beat
```

**Всё!** Celery worker и beat будут работать постоянно и автоматически перезапускаться при падении.

---

### Вариант Б: Systemd (если без Docker на проде)

Создай файлы сервисов:

**`/etc/systemd/system/sandmatch-celery.service`:**

```ini
[Unit]
Description=SandMatch Celery Worker
After=network.target

[Service]
Type=forking
User=www-data
Group=www-data
WorkingDirectory=/var/www/sandmatch
Environment="PATH=/var/www/sandmatch/venv/bin"
ExecStart=/var/www/sandmatch/venv/bin/celery -A sandmatch worker -l info
Restart=always

[Install]
WantedBy=multi-user.target
```

**`/etc/systemd/system/sandmatch-celery-beat.service`:**

```ini
[Unit]
Description=SandMatch Celery Beat
After=network.target

[Service]
Type=simple
User=www-data
Group=www-data
WorkingDirectory=/var/www/sandmatch
Environment="PATH=/var/www/sandmatch/venv/bin"
ExecStart=/var/www/sandmatch/venv/bin/celery -A sandmatch beat -l info
Restart=always

[Install]
WantedBy=multi-user.target
```

**Запуск:**

```bash
sudo systemctl daemon-reload
sudo systemctl enable sandmatch-celery sandmatch-celery-beat
sudo systemctl start sandmatch-celery sandmatch-celery-beat
sudo systemctl status sandmatch-celery sandmatch-celery-beat
```

---

## 5. Интеграция с кодом

### При создании турнира в админке

Добавь в `apps/tournaments/admin.py`:

```python
from apps.telegram_bot.tasks import send_new_tournament_notification

class TournamentAdmin(admin.ModelAdmin):
    # ... существующий код
    
    def save_model(self, request, obj, form, change):
        is_new = obj.pk is None
        super().save_model(request, obj, form, change)
        
        # Отправляем уведомление о новом турнире
        if is_new and obj.status == 'created':
            send_new_tournament_notification.delay(obj.id)
```

### При внесении результата матча

Добавь в `apps/matches/admin.py`:

```python
from apps.telegram_bot.tasks import send_match_result_notification

class MatchAdmin(admin.ModelAdmin):
    # ... существующий код
    
    def save_model(self, request, obj, form, change):
        old_score = None
        if change:
            old_score = Match.objects.get(pk=obj.pk).score
        
        super().save_model(request, obj, form, change)
        
        # Отправляем уведомление если результат изменился
        if obj.score and obj.score != old_score:
            send_match_result_notification.delay(obj.id)
```

---

## 6. Мониторинг

### Проверка работы Celery

```bash
# Статус контейнеров
docker-compose ps

# Логи в реальном времени
docker-compose logs -f celery celery-beat

# Последние 100 строк
docker-compose logs --tail=100 celery
```

### Проверка Redis

```bash
# Подключиться к Redis
docker-compose exec redis redis-cli

# Посмотреть очередь задач
> KEYS *
> LLEN celery
```

### Проверка логов уведомлений

В Django Admin:
- Перейди в **Telegram bot → Логи уведомлений**
- Проверь успешность отправки
- Смотри ошибки

---

## 7. Troubleshooting

### Celery не запускается

**Проблема:** `ModuleNotFoundError: No module named 'celery'`

**Решение:**
```bash
docker-compose exec web pip install celery redis
docker-compose restart celery celery-beat
```

---

### Задачи не выполняются

**Проблема:** Задачи создаются, но не выполняются

**Проверь:**
1. Celery worker запущен:
   ```bash
   docker-compose ps celery
   ```

2. Redis доступен:
   ```bash
   docker-compose exec celery ping redis -c 1
   ```

3. Логи worker:
   ```bash
   docker-compose logs -f celery
   ```

---

### Уведомления не приходят

**Проверь:**

1. **Бот запущен:**
   ```bash
   docker-compose exec web python manage.py run_bot
   ```

2. **TELEGRAM_BOT_TOKEN правильный** в `.env`

3. **Пользователь подписан:**
   - Для новых турниров — нужна подписка на организатора/площадку
   - Для напоминаний — нужно быть участником турнира

4. **Настройки уведомлений включены:**
   - В Django Admin → Telegram users → проверь `notifications_enabled`

5. **Логи уведомлений:**
   - Django Admin → Notification logs → смотри ошибки

---

## 8. Периодические задачи

### Текущие задачи

| Задача | Расписание | Описание |
|--------|-----------|----------|
| `check_upcoming_tournaments` | Каждый час | Проверяет турниры через 24 часа и отправляет напоминания |
| `cleanup_old_notifications` | Раз в день (3:00) | Удаляет логи старше 30 дней |

### Изменить расписание

Отредактируй `sandmatch/celery.py`:

```python
app.conf.beat_schedule = {
    'check-upcoming-tournaments': {
        'task': 'apps.telegram_bot.tasks.check_upcoming_tournaments',
        'schedule': crontab(minute=0),  # Каждый час
        # 'schedule': crontab(minute='*/30'),  # Каждые 30 минут
        # 'schedule': crontab(hour=9, minute=0),  # Раз в день в 9:00
    },
}
```

Перезапусти beat:
```bash
docker-compose restart celery-beat
```

---

## 9. Полезные команды

```bash
# Перезапуск всех сервисов
docker-compose restart

# Перезапуск только Celery
docker-compose restart celery celery-beat

# Остановка Celery
docker-compose stop celery celery-beat

# Просмотр логов
docker-compose logs -f celery celery-beat

# Очистка Redis (удаление всех задач)
docker-compose exec redis redis-cli FLUSHALL

# Проверка задач в очереди
docker-compose exec redis redis-cli LLEN celery
```

---

## 10. Чеклист для продакшена

- [ ] Redis запущен и доступен
- [ ] `.env` содержит `CELERY_BROKER_URL` и `TELEGRAM_BOT_TOKEN`
- [ ] Celery worker запущен и работает
- [ ] Celery beat запущен и работает
- [ ] Периодические задачи настроены в `sandmatch/celery.py`
- [ ] Логи Celery мониторятся (нет ошибок)
- [ ] Тестовое уведомление отправлено и получено
- [ ] Автоматические напоминания работают
- [ ] Логи уведомлений проверяются в админке

---

## Готово! 🎉

Теперь у тебя полностью рабочая система уведомлений:
- ✅ Уведомления о новых турнирах
- ✅ Напоминания за 24 часа до начала
- ✅ Уведомления о результатах матчей
- ✅ Автоматическая очистка старых логов
- ✅ Простой деплой через Docker Compose

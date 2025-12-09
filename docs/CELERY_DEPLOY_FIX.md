# Исправление проблем с Celery на Production

## Проблема
Контейнеры `sandmatch_celery` и `sandmatch_celery_beat` не запускаются.

## Решение

### Шаг 1: Закоммить изменения

```bash
git add docker-compose.prod.yml
git commit -m "fix: update docker-compose.prod.yml for Celery"
git push origin main
```

### Шаг 2: На Production VM

```bash
# Подключись к VM
ssh ubuntu@your-vm-ip

# Перейди в директорию проекта
cd /opt/sandmatch/app

# Подтяни последние изменения
git pull origin main

# Останови все контейнеры
docker-compose -f docker-compose.prod.yml down

# Запусти заново
docker-compose -f docker-compose.prod.yml up -d

# Проверь статус
docker-compose -f docker-compose.prod.yml ps
```

### Шаг 3: Проверь логи

Теперь имена контейнеров будут с префиксом проекта:

```bash
# Посмотри все контейнеры
docker ps

# Логи будут доступны через compose:
docker-compose -f docker-compose.prod.yml logs -f web
docker-compose -f docker-compose.prod.yml logs -f celery
docker-compose -f docker-compose.prod.yml logs -f celery-beat
docker-compose -f docker-compose.prod.yml logs -f redis

# Или напрямую (имена могут быть app-celery-1, app-celery-beat-1):
docker logs -f app-celery-1
docker logs -f app-celery-beat-1
```

### Шаг 4: Проверь работу Celery

```bash
# Проверь, что Celery worker видит задачи
docker-compose -f docker-compose.prod.yml exec celery celery -A sandmatch inspect active

# Проверь, что beat работает
docker-compose -f docker-compose.prod.yml exec celery-beat celery -A sandmatch inspect scheduled
```

## Альтернатива: Использовать docker-compose logs

Вместо прямого обращения к контейнерам по имени, используй команды compose:

```bash
# Следить за всеми логами
docker-compose -f docker-compose.prod.yml logs -f

# Только Celery
docker-compose -f docker-compose.prod.yml logs -f celery celery-beat

# Последние 100 строк
docker-compose -f docker-compose.prod.yml logs --tail=100 celery
```

## Проверка работоспособности

### 1. Все контейнеры запущены

```bash
docker-compose -f docker-compose.prod.yml ps
```

Должно быть:
- `app-redis-1` — Up
- `app-web-1` — Up
- `app-celery-1` — Up
- `app-celery-beat-1` — Up

### 2. Celery worker подключен к Redis

```bash
docker-compose -f docker-compose.prod.yml logs celery | grep "Connected to redis"
```

### 3. Celery beat запланировал задачи

```bash
docker-compose -f docker-compose.prod.yml logs celery-beat | grep "Scheduler"
```

### 4. Тестовая задача

Создай тестовую задачу в Django shell:

```bash
docker-compose -f docker-compose.prod.yml exec web python manage.py shell
```

```python
from apps.telegram_bot.tasks import send_tournament_notification
result = send_tournament_notification.delay(123, "test", "Test message")
print(f"Task ID: {result.id}")
exit()
```

Проверь логи:

```bash
docker-compose -f docker-compose.prod.yml logs celery | grep "test"
```

## Если всё ещё не работает

### Проблема 1: Celery не может подключиться к Redis

**Симптом:** `Error: Cannot connect to redis://redis:6379/0`

**Решение:**

```bash
# Проверь, что Redis запущен
docker-compose -f docker-compose.prod.yml exec redis redis-cli ping
# Должно вернуть: PONG

# Проверь переменные окружения
docker-compose -f docker-compose.prod.yml exec celery env | grep CELERY
```

Убедись, что в `.env`:
```env
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_RESULT_BACKEND=redis://redis:6379/0
```

### Проблема 2: Celery падает при старте

**Симптом:** Контейнер постоянно перезапускается

**Решение:**

```bash
# Посмотри логи с самого начала
docker-compose -f docker-compose.prod.yml logs --tail=500 celery

# Проверь, что все зависимости установлены
docker-compose -f docker-compose.prod.yml exec web pip list | grep celery
```

### Проблема 3: Celery beat не создаёт задачи

**Симптом:** В логах нет записей о запланированных задачах

**Решение:**

```bash
# Проверь, что таблицы django-celery-beat созданы
docker-compose -f docker-compose.prod.yml exec web python manage.py migrate django_celery_beat

# Проверь, что есть периодические задачи
docker-compose -f docker-compose.prod.yml exec web python manage.py shell
```

```python
from django_celery_beat.models import PeriodicTask
print(PeriodicTask.objects.all())
exit()
```

## Быстрая команда для мониторинга

Добавь alias в `~/.bashrc` на VM:

```bash
alias celery-logs='docker-compose -f /opt/sandmatch/app/docker-compose.prod.yml logs -f celery celery-beat'
alias celery-status='docker-compose -f /opt/sandmatch/app/docker-compose.prod.yml ps'
```

Теперь можно просто:

```bash
celery-logs
celery-status
```

## Итоговый чеклист

- [ ] Закоммитил изменения в `docker-compose.prod.yml`
- [ ] Запушил в `main`
- [ ] Подключился к VM
- [ ] Подтянул изменения (`git pull`)
- [ ] Перезапустил контейнеры (`docker-compose down && up -d`)
- [ ] Проверил статус (`docker-compose ps`)
- [ ] Проверил логи Celery
- [ ] Проверил логи Celery Beat
- [ ] Протестировал отправку задачи
- [ ] Всё работает! 🎉

# Чеклист деплоя SandMatch

## Перед деплоем

### 1. Проверь `.env` файл

```env
# Django
SECRET_KEY=your-secret-key
DEBUG=False
ALLOWED_HOSTS=beachplay.ru,www.beachplay.ru

# Database (Managed PostgreSQL)
DATABASE_URL=postgresql://user:password@host:port/dbname

# Celery
CELERY_BROKER_URL=redis://redis:6379/0
CELERY_RESULT_BACKEND=redis://redis:6379/0

# Telegram Bot
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_USE_WEBHOOK=false
WEB_APP_URL=https://beachplay.ru
```

### 2. Проверь docker-compose.yml

Убедись, что все сервисы настроены:
- ✅ `redis` — брокер для Celery
- ✅ `web` — Django приложение
- ✅ `celery` — обработчик задач
- ✅ `celery-beat` — планировщик

---

## Деплой на продакшен

### Шаг 1: Обнови код

```bash
cd /path/to/SandMatch
git pull origin main
```

### Шаг 2: Пересобери и запусти контейнеры

```bash
docker-compose up -d --build
```

### Шаг 3: Примени миграции

```bash
docker-compose exec web python manage.py migrate
```

### Шаг 4: Собери статику

```bash
docker-compose exec web python manage.py collectstatic --noinput
```

### Шаг 5: Проверь статус

```bash
docker-compose ps
```

Все контейнеры должны быть `Up`:
```
NAME                      STATUS
sandmatch_redis           Up
sandmatch_web             Up
sandmatch_celery          Up
sandmatch_celery_beat     Up
```

### Шаг 6: Проверь логи

```bash
# Все сервисы
docker-compose logs --tail=50

# Только web
docker-compose logs -f web

# Только celery
docker-compose logs -f celery celery-beat
```

---

## Запуск Telegram бота

### Вариант А: В отдельном терминале (для тестирования)

```bash
docker-compose exec web python manage.py run_bot
```

**Минус:** Бот остановится при закрытии терминала.

### Вариант Б: Через screen/tmux (рекомендую)

```bash
# Создать screen сессию
screen -S telegram_bot

# Запустить бота
docker-compose exec web python manage.py run_bot

# Отключиться от сессии: Ctrl+A, затем D

# Вернуться к сессии
screen -r telegram_bot

# Список сессий
screen -ls
```

### Вариант В: Добавить в docker-compose (лучший вариант)

Добавь в `docker-compose.yml`:

```yaml
  telegram-bot:
    build: .
    container_name: sandmatch_telegram_bot
    restart: unless-stopped
    command: python manage.py run_bot
    env_file:
      - .env
    depends_on:
      - redis
```

Затем:

```bash
docker-compose up -d telegram-bot
docker-compose logs -f telegram-bot
```

---

## Проверка работоспособности

### 1. Web приложение

```bash
curl http://localhost:8000/
# Или открой в браузере
```

### 2. Telegram бот

Отправь боту команду `/start` в Telegram.

### 3. Celery

```bash
# Проверь логи
docker-compose logs celery | grep "ready"

# Должно быть:
# celery@... ready.
```

### 4. Celery Beat

```bash
# Проверь логи
docker-compose logs celery-beat | grep "Scheduler"

# Должно быть:
# Scheduler: Sending due task check-upcoming-tournaments
```

### 5. Redis

```bash
docker-compose exec redis redis-cli ping
# Ответ: PONG
```

---

## Мониторинг

### Логи в реальном времени

```bash
# Все сервисы
docker-compose logs -f

# Конкретный сервис
docker-compose logs -f web
docker-compose logs -f celery
docker-compose logs -f celery-beat
```

### Использование ресурсов

```bash
docker stats
```

### Проверка базы данных

```bash
docker-compose exec web python manage.py dbshell
```

---

## Откат изменений

Если что-то пошло не так:

```bash
# Откатить код
git reset --hard HEAD~1

# Пересобрать контейнеры
docker-compose up -d --build

# Откатить миграции (если нужно)
docker-compose exec web python manage.py migrate app_name migration_name
```

---

## Остановка сервисов

```bash
# Остановить все
docker-compose stop

# Остановить конкретный сервис
docker-compose stop celery

# Остановить и удалить контейнеры
docker-compose down

# Остановить, удалить контейнеры и volumes
docker-compose down -v
```

---

## Troubleshooting

### Контейнер не запускается

```bash
# Проверь логи
docker-compose logs service_name

# Пересобери образ
docker-compose build --no-cache service_name
docker-compose up -d service_name
```

### Celery не видит задачи

```bash
# Перезапусти worker
docker-compose restart celery

# Проверь, что задачи зарегистрированы
docker-compose exec celery celery -A sandmatch inspect registered
```

### База данных недоступна

```bash
# Проверь подключение
docker-compose exec web python manage.py dbshell

# Проверь DATABASE_URL в .env
```

### Telegram бот не отвечает

```bash
# Проверь токен в .env
echo $TELEGRAM_BOT_TOKEN

# Проверь логи бота
docker-compose logs telegram-bot

# Перезапусти бота
docker-compose restart telegram-bot
```

---

## Автоматизация деплоя

### Создай скрипт `deploy.sh`:

```bash
#!/bin/bash
set -e

echo "🚀 Начинаю деплой SandMatch..."

# 1. Обновить код
echo "📥 Обновление кода..."
git pull origin main

# 2. Пересобрать контейнеры
echo "🔨 Пересборка контейнеров..."
docker-compose up -d --build

# 3. Миграции
echo "🗄️ Применение миграций..."
docker-compose exec -T web python manage.py migrate

# 4. Статика
echo "📦 Сборка статики..."
docker-compose exec -T web python manage.py collectstatic --noinput

# 5. Проверка
echo "✅ Проверка статуса..."
docker-compose ps

echo "🎉 Деплой завершён!"
echo "📊 Проверь логи: docker-compose logs -f"
```

Использование:

```bash
chmod +x deploy.sh
./deploy.sh
```

---

## Резервное копирование

### База данных

```bash
# Экспорт
docker-compose exec web python manage.py dumpdata > backup.json

# Импорт
docker-compose exec -T web python manage.py loaddata backup.json
```

### Медиа файлы

```bash
# Если используешь volumes
docker run --rm -v sandmatch_media:/data -v $(pwd):/backup \
  alpine tar czf /backup/media_backup.tar.gz /data
```

---

## Чеклист после деплоя

- [ ] Все контейнеры запущены (`docker-compose ps`)
- [ ] Web приложение доступно (открыть в браузере)
- [ ] Telegram бот отвечает (отправить `/start`)
- [ ] Celery worker работает (проверить логи)
- [ ] Celery beat работает (проверить логи)
- [ ] Миграции применены
- [ ] Статика собрана
- [ ] Нет ошибок в логах
- [ ] Тестовое уведомление отправлено

---

## Полезные команды

```bash
# Перезапуск всех сервисов
docker-compose restart

# Просмотр логов за последние 5 минут
docker-compose logs --since 5m

# Очистка неиспользуемых образов
docker system prune -a

# Вход в контейнер
docker-compose exec web bash

# Выполнение команды Django
docker-compose exec web python manage.py <command>

# Проверка переменных окружения
docker-compose exec web env | grep TELEGRAM
```

---

## Готово! ✅

Твой проект задеплоен и работает! 🎉

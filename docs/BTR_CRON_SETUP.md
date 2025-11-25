# Настройка Cron для автоматического обновления BTR-рейтингов

## Описание

Система автоматически скачивает и импортирует новые файлы рейтингов BTR с сайта https://btrussia.com/ru/cl/arkhiv.

## Команда для запуска

```bash
python manage.py fetch_btr_ratings
```

### Параметры команды:

- `--limit N` - Скачать максимум N файлов (по умолчанию: все новые)
- `--force` - Принудительно обработать все файлы, даже уже импортированные
- `--dry-run` - Только показать, какие файлы будут скачаны, без реального импорта

### Примеры использования:

```bash
# Скачать и импортировать все новые файлы
python manage.py fetch_btr_ratings

# Скачать только последние 5 файлов
python manage.py fetch_btr_ratings --limit 5

# Проверить, какие файлы будут скачаны (без импорта)
python manage.py fetch_btr_ratings --dry-run

# Принудительно переимпортировать все файлы
python manage.py fetch_btr_ratings --force
```

## Настройка Cron на продакшене

### Вариант 1: Ежедневная проверка в первые 5 дней месяца

Добавьте в crontab:

```bash
# BTR рейтинги: проверка каждый день в 03:00, только в первые 5 дней месяца
0 3 1-5 * * cd /app && python manage.py fetch_btr_ratings >> /var/log/btr_import.log 2>&1
```

### Вариант 2: Ежедневная проверка (рекомендуется)

Так как команда скачивает только новые файлы, можно запускать её ежедневно:

```bash
# BTR рейтинги: проверка каждый день в 03:00
0 3 * * * cd /app && python manage.py fetch_btr_ratings >> /var/log/btr_import.log 2>&1
```

### Вариант 3: Еженедельная проверка

```bash
# BTR рейтинги: проверка каждый понедельник в 03:00
0 3 * * 1 cd /app && python manage.py fetch_btr_ratings >> /var/log/btr_import.log 2>&1
```

## Настройка через Docker Compose

Если используется Docker, добавьте в `docker-compose.yml`:

```yaml
services:
  web:
    # ... существующая конфигурация ...
    
  cron:
    build: .
    command: >
      sh -c "
        echo '0 3 * * * cd /app && python manage.py fetch_btr_ratings >> /var/log/btr_import.log 2>&1' | crontab - &&
        crond -f
      "
    env_file:
      - .env
    depends_on:
      - web
    restart: unless-stopped
```

## Мониторинг и логирование

### Просмотр логов:

```bash
# Последние 100 строк лога
tail -n 100 /var/log/btr_import.log

# Следить за логом в реальном времени
tail -f /var/log/btr_import.log

# Поиск ошибок в логе
grep -i "error\|ошибка" /var/log/btr_import.log
```

### Проверка статуса последнего импорта:

```bash
# Через Django shell
python manage.py shell
>>> from apps.btr.models import BtrSourceFile
>>> last_file = BtrSourceFile.objects.order_by('-applied_at').first()
>>> print(f"Последний файл: {last_file.filename}, дата: {last_file.applied_at}")
```

### Проверка количества данных:

```bash
python manage.py shell
>>> from apps.btr.models import BtrPlayer, BtrRatingSnapshot
>>> print(f"Игроков BTR: {BtrPlayer.objects.count()}")
>>> print(f"Снимков рейтинга: {BtrRatingSnapshot.objects.count()}")
```

## Ручной запуск на проде

```bash
# Через Docker
docker compose exec web python manage.py fetch_btr_ratings

# Или напрямую в контейнере
docker exec -it <container_name> python manage.py fetch_btr_ratings
```

## Troubleshooting

### Проблема: Команда не запускается по cron

**Решение:**
1. Проверьте, что cron запущен: `service cron status`
2. Проверьте права на файл лога: `chmod 666 /var/log/btr_import.log`
3. Убедитесь, что переменные окружения доступны в cron

### Проблема: Ошибка при скачивании файлов

**Решение:**
1. Проверьте доступность сайта: `curl https://btrussia.com/ru/cl/arkhiv`
2. Проверьте настройки прокси (если используется)
3. Убедитесь, что установлены зависимости: `pip install requests beautifulsoup4`

### Проблема: Дубли игроков

**Решение:**
1. Очистите данные: `python manage.py clear_btr_data --confirm`
2. Запустите импорт заново: `python manage.py fetch_btr_ratings`

## Рекомендации

1. **Логирование**: Настройте ротацию логов через `logrotate`
2. **Мониторинг**: Настройте алерты при ошибках импорта
3. **Бэкапы**: Делайте бэкап БД перед массовым импортом
4. **Тестирование**: Сначала запустите с `--dry-run` для проверки

## Пример настройки logrotate

Создайте файл `/etc/logrotate.d/btr_import`:

```
/var/log/btr_import.log {
    daily
    rotate 30
    compress
    delaycompress
    notifempty
    create 0644 root root
    sharedscripts
}
```

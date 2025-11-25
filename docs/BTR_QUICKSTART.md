# BTR Integration - Quick Start

## Быстрый старт для продакшена

### 1. Установка зависимостей

Убедитесь, что в `requirements.txt` есть:
```
openpyxl~=3.1
xlrd~=2.0
beautifulsoup4~=4.12
requests~=2.31
```

Установите:
```bash
pip install -r requirements.txt
```

### 2. Применение миграций

```bash
python manage.py migrate btr
```

### 3. Тестовый запуск

```bash
# Проверить доступные файлы на сайте
python manage.py check_btr_files --limit 10

# Тестовый импорт (без скачивания)
python manage.py fetch_btr_ratings --dry-run --limit 3

# Реальный импорт последнего файла
python manage.py fetch_btr_ratings --limit 1
```

### 4. Настройка Cron

#### Вариант A: Docker Compose (рекомендуется)

Добавьте в crontab хоста:
```bash
# Каждый день в 03:00
0 3 * * * /path/to/project/scripts/docker_fetch_btr_ratings.sh >> /var/log/btr_cron.log 2>&1
```

Сделайте скрипт исполняемым:
```bash
chmod +x scripts/docker_fetch_btr_ratings.sh
```

#### Вариант B: Прямой запуск

Добавьте в crontab:
```bash
# Каждый день в 03:00
0 3 * * * cd /app && python manage.py fetch_btr_ratings >> /var/log/btr_import.log 2>&1
```

### 5. Мониторинг

Проверка последнего импорта:
```bash
python manage.py shell -c "
from apps.btr.models import BtrSourceFile, BtrPlayer
last = BtrSourceFile.objects.order_by('-applied_at').first()
print(f'Последний файл: {last.filename if last else \"Нет\"}')
print(f'Всего игроков: {BtrPlayer.objects.count()}')
"
```

Просмотр логов:
```bash
tail -f /var/log/btr_import.log
```

## Команды для управления

### Импорт данных

```bash
# Скачать все новые файлы
python manage.py fetch_btr_ratings

# Скачать только N последних файлов
python manage.py fetch_btr_ratings --limit 5

# Проверить без скачивания
python manage.py fetch_btr_ratings --dry-run

# Принудительно переимпортировать все файлы
python manage.py fetch_btr_ratings --force
```

### Управление данными

```bash
# Проверить доступные файлы на сайте
python manage.py check_btr_files

# Очистить все данные BTR
python manage.py clear_btr_data --confirm

# Импортировать из локальной директории
python manage.py import_btr_files /path/to/directory
```

## Структура данных

### Модели:

- **BtrPlayer** - Игроки BTR (РНИ, ФИО, пол, дата рождения, город)
- **BtrRatingSnapshot** - Снимки рейтинга (игрок, категория, дата, очки, позиция)
- **BtrSourceFile** - Файлы-источники (URL, имя файла, дата импорта)

### Категории рейтинга:

- `men_double` - Взрослые, парный, мужчины
- `men_mixed` - Взрослые, смешанный, мужчины
- `women_double` - Взрослые, парный, женщины
- `women_mixed` - Взрослые, смешанный, женщины
- `junior_male` - До 19, Юноши
- `junior_female` - До 19, Девушки

## Troubleshooting

### Проблема: Команда не находит новые файлы

**Решение:**
```bash
# Проверьте доступность сайта
curl -I https://btrussia.com/ru/cl/arkhiv

# Проверьте список файлов
python manage.py check_btr_files
```

### Проблема: Ошибка при импорте

**Решение:**
```bash
# Посмотрите детальные логи
python manage.py fetch_btr_ratings --limit 1

# Проверьте зависимости
pip list | grep -E "requests|beautifulsoup4|openpyxl|xlrd"
```

### Проблема: Дубли игроков

**Решение:**
```bash
# Очистите и переимпортируйте
python manage.py clear_btr_data --confirm
python manage.py fetch_btr_ratings
```

## Полезные ссылки

- Детальная документация: `docs/BTR_INTEGRATION_PLAN.md`
- Настройка cron: `docs/BTR_CRON_SETUP.md`
- Тестирование: `docs/BTR_TESTING.md`

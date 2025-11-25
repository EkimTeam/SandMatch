# Тестирование системы импорта BTR

## Локальное тестирование

### 1. Установка зависимостей

```bash
docker compose exec web pip install beautifulsoup4~=4.12 requests~=2.31 xlrd~=2.0
```

### 2. Проверка доступных файлов на сайте

```bash
# Показать все доступные файлы
docker compose exec web python manage.py check_btr_files

# Показать только последние 10 файлов
docker compose exec web python manage.py check_btr_files --limit 10
```

### 3. Тестовый запуск (без скачивания)

```bash
# Посмотреть, какие файлы будут скачаны
docker compose exec web python manage.py fetch_btr_ratings --dry-run

# Скачать только последние 3 файла (для теста)
docker compose exec web python manage.py fetch_btr_ratings --limit 3 --dry-run
```

### 4. Реальный импорт (тестовый)

```bash
# Скачать и импортировать последний файл
docker compose exec web python manage.py fetch_btr_ratings --limit 1
```

### 5. Проверка результатов

```bash
# Через Django shell
docker compose exec web python manage.py shell

>>> from apps.btr.models import BtrPlayer, BtrRatingSnapshot, BtrSourceFile
>>> 
>>> # Проверяем количество данных
>>> print(f"Игроков BTR: {BtrPlayer.objects.count()}")
>>> print(f"Снимков рейтинга: {BtrRatingSnapshot.objects.count()}")
>>> print(f"Файлов-источников: {BtrSourceFile.objects.count()}")
>>> 
>>> # Проверяем последний импортированный файл
>>> last_file = BtrSourceFile.objects.order_by('-applied_at').first()
>>> if last_file:
>>>     print(f"Последний файл: {last_file.filename}")
>>>     print(f"Дата применения: {last_file.applied_at}")
>>> 
>>> # Проверяем примеры игроков
>>> for player in BtrPlayer.objects.all()[:5]:
>>>     print(f"{player.last_name} {player.first_name} (РНИ: {player.rni}, пол: {player.gender})")
```

## Тестирование на проде

### Перед настройкой cron:

1. **Проверьте доступность сайта BTR:**
```bash
curl -I https://btrussia.com/ru/cl/arkhiv
```

2. **Запустите команду вручную:**
```bash
docker compose exec web python manage.py fetch_btr_ratings --limit 1
```

3. **Проверьте логи:**
```bash
docker compose logs web | grep -i btr
```

4. **Убедитесь, что данные импортировались:**
```bash
docker compose exec web python manage.py shell -c "from apps.btr.models import BtrPlayer; print(BtrPlayer.objects.count())"
```

### После настройки cron:

1. **Проверьте, что cron запущен:**
```bash
# На хосте
crontab -l

# В контейнере (если cron внутри)
docker compose exec web crontab -l
```

2. **Проверьте логи cron:**
```bash
tail -f /var/log/btr_import.log
```

3. **Проверьте последний импорт:**
```bash
docker compose exec web python manage.py shell -c "
from apps.btr.models import BtrSourceFile
last = BtrSourceFile.objects.order_by('-applied_at').first()
if last:
    print(f'Последний файл: {last.filename}')
    print(f'Дата: {last.applied_at}')
else:
    print('Файлы не найдены')
"
```

## Сценарии тестирования

### Сценарий 1: Первый импорт (пустая БД)

```bash
# 1. Очистить БД (если нужно)
docker compose exec web python manage.py clear_btr_data --confirm

# 2. Скачать последние 5 файлов
docker compose exec web python manage.py fetch_btr_ratings --limit 5

# 3. Проверить результаты
docker compose exec web python manage.py shell -c "
from apps.btr.models import BtrPlayer, BtrRatingSnapshot
print(f'Игроков: {BtrPlayer.objects.count()}')
print(f'Снимков: {BtrRatingSnapshot.objects.count()}')
"
```

### Сценарий 2: Обновление (добавление новых файлов)

```bash
# 1. Запустить импорт (скачает только новые файлы)
docker compose exec web python manage.py fetch_btr_ratings

# 2. Проверить, что новые файлы добавились
docker compose exec web python manage.py shell -c "
from apps.btr.models import BtrSourceFile
print(f'Всего файлов: {BtrSourceFile.objects.count()}')
print('Последние 3 файла:')
for f in BtrSourceFile.objects.order_by('-applied_at')[:3]:
    print(f'  - {f.filename} ({f.applied_at})')
"
```

### Сценарий 3: Переимпорт (обновление данных игроков)

```bash
# 1. Принудительно переимпортировать все файлы
docker compose exec web python manage.py fetch_btr_ratings --force

# 2. Проверить, что данные обновились
docker compose exec web python manage.py shell -c "
from apps.btr.models import BtrPlayer
# Проверяем, что у игроков заполнены поля
players_with_city = BtrPlayer.objects.exclude(city='').count()
players_with_gender = BtrPlayer.objects.exclude(gender='').count()
print(f'Игроков с городом: {players_with_city}')
print(f'Игроков с полом: {players_with_gender}')
"
```

## Проверка производительности

```bash
# Засечь время импорта
time docker compose exec web python manage.py fetch_btr_ratings --limit 10
```

## Проверка обработки ошибок

### Тест 1: Недоступность сайта

```bash
# Временно заблокировать доступ к сайту (например, через /etc/hosts)
# Запустить команду и проверить, что она корректно обрабатывает ошибку
docker compose exec web python manage.py fetch_btr_ratings
```

### Тест 2: Повреждённый файл

```bash
# Создать повреждённый файл и попробовать импортировать
# Команда должна пропустить файл и продолжить работу
```

## Чек-лист перед продакшеном

- [ ] Установлены все зависимости (requests, beautifulsoup4, xlrd, openpyxl)
- [ ] Команда `check_btr_files` показывает доступные файлы
- [ ] Команда `fetch_btr_ratings --dry-run` работает без ошибок
- [ ] Тестовый импорт 1 файла прошёл успешно
- [ ] Данные корректно сохранились в БД
- [ ] Логирование работает
- [ ] Скрипты имеют права на выполнение (`chmod +x scripts/*.sh`)
- [ ] Настроен logrotate для ротации логов
- [ ] Настроен мониторинг/алерты при ошибках

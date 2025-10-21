# Локальный запуск SandMatch для разработки

## 🚀 Быстрый старт (Dev режим)

### Шаг 1: Подготовка .env файла

```bash
# Скопировать пример
cp .env.example .env
```

Убедитесь что в `.env` установлено:
```env
DJANGO_DEBUG=1
DJANGO_SETTINGS_MODULE=sandmatch.settings.local
POSTGRES_HOST=db
```

---

### Шаг 2: Раскомментировать БД в docker-compose.yml

Откройте `docker-compose.yml` и раскомментируйте секцию `db`:

```yaml
services:
  db:  # ← Убрать #
    image: postgres:14
    restart: unless-stopped
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-sandmatch}
      POSTGRES_USER: ${POSTGRES_USER:-sandmatch}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-sandmatch}
    ports:
      - "5432:5432"
    volumes:
      - db_data:/var/lib/postgresql/data
  
  web:
    build: .
    restart: unless-stopped
    env_file:
      - .env
    ports:
      - "8000:8000"
    depends_on:  # ← Добавить эту секцию
      - db

volumes:
  db_data:
```

---

### Шаг 3: Запустить приложение

```bash
# Собрать и запустить контейнеры
docker compose up --build

# Или в фоновом режиме
docker compose up --build -d
```

**Что происходит:**
1. Собирается фронтенд (Vite) внутри Docker образа
2. Запускается PostgreSQL на порту 5432
3. Запускается Django на порту 8000
4. Применяются миграции автоматически
5. Копируются frontend ассеты

---

### Шаг 4: Проверить что всё работает

```bash
# Посмотреть логи
docker compose logs -f web

# Проверить статус контейнеров
docker compose ps
```

Должно быть:
```
NAME                STATE     PORTS
sandmatch-db-1      running   0.0.0.0:5432->5432/tcp
sandmatch-web-1     running   0.0.0.0:8000->8000/tcp
```

---

### Шаг 5: Открыть в браузере

Откройте: **http://localhost:8000/**

**Проверьте в DevTools (F12):**
- Network tab → нет 404 ошибок
- Console tab → нет ошибок
- React приложение загружается

---

## 🔧 Полезные команды

### Просмотр логов
```bash
# Все логи
docker compose logs -f

# Только web
docker compose logs -f web

# Только БД
docker compose logs -f db
```

### Выполнение команд Django
```bash
# Войти в контейнер
docker compose exec web sh

# Создать суперпользователя
docker compose exec web python manage.py createsuperuser

# Применить миграции вручную
docker compose exec web python manage.py migrate

# Собрать статику вручную
docker compose exec web python manage.py collectstatic --noinput
```

### Проверка frontend ассетов
```bash
# Посмотреть что скопировалось
docker compose exec web ls -la /app/staticfiles/frontend/

# Посмотреть manifest.json
docker compose exec web cat /app/staticfiles/frontend/manifest.json
```

### Остановка и очистка
```bash
# Остановить контейнеры
docker compose down

# Остановить и удалить volumes (БД будет очищена!)
docker compose down -v

# Пересобрать образ с нуля
docker compose build --no-cache
```

---

## 🐛 Решение проблем

### Проблема: "Connection refused" к БД

**Причина:** БД не запущена или web стартует раньше БД

**Решение:**
```yaml
# В docker-compose.yml добавить depends_on
web:
  depends_on:
    - db
```

---

### Проблема: 404 на frontend ассеты

**Проверить:**
```bash
# 1. Ассеты скопировались?
docker compose exec web ls -la /app/staticfiles/frontend/

# 2. manifest.json существует?
docker compose exec web cat /app/staticfiles/frontend/manifest.json

# 3. Логи entrypoint
docker compose logs web | grep "entrypoint"
```

**Должны быть строки:**
```
[entrypoint] Копирую Vite-ассеты: /app/frontend/dist → /app/staticfiles/frontend
[entrypoint] Vite-ассеты успешно скопированы
```

---

### Проблема: Белый экран в браузере

**Проверить в DevTools Console:**
- Ошибки загрузки JS/CSS?
- Ошибки React?

**Проверить в DevTools Network:**
- Все файлы `/static/frontend/assets/*` загружаются с 200?
- Пути правильные?

**Решение:**
```bash
# Пересобрать с нуля
docker compose down
docker compose build --no-cache
docker compose up
```

---

### Проблема: "apps.core not found"

**Причина:** Новое приложение не подхватилось

**Решение:**
```bash
# Пересобрать образ
docker compose build web
docker compose up -d web
```

---

## 📊 Проверка что исправления работают

### 1. Vite base path
```bash
# Открыть manifest.json
docker compose exec web cat /app/staticfiles/frontend/manifest.json
```

Пути должны быть относительные: `"file": "assets/main-HASH.js"`

### 2. Django template tags
```bash
# Войти в shell
docker compose exec web python manage.py shell

# Проверить
from django.conf import settings
print('apps.core' in settings.INSTALLED_APPS)  # True

from apps.core.templatetags import vite_assets
print(hasattr(vite_assets, 'vite_asset'))  # True
```

### 3. Static files mapping
```bash
# Проверить структуру
docker compose exec web ls -la /app/staticfiles/
```

Должна быть папка `frontend/` с файлами

### 4. Загрузка в браузере

Откройте http://localhost:8000/ и в DevTools Network проверьте:
- JS файл загружается с `/static/frontend/assets/index-HASH.js`
- CSS файл загружается с `/static/frontend/assets/main-HASH.css`
- Response headers содержат `Content-Type: application/javascript`

---

## 🎯 Для тестирования PROD режима (с Nginx)

Если хотите протестировать полную prod конфигурацию с Nginx:

```bash
# 1. Создать .env для prod
cp .env.example .env

# 2. Изменить в .env
DJANGO_DEBUG=0
DJANGO_SETTINGS_MODULE=sandmatch.settings.prod

# 3. Запустить prod compose
docker compose -f docker-compose.prod.yml up --build
```

Откройте: **http://localhost:8000/** (через Nginx)

**Проверьте в DevTools:**
- Response headers содержат `Content-Encoding: gzip`
- Response headers содержат `Cache-Control: public, immutable`

---

## 📝 Итого для локального запуска

```bash
# 1. Раскомментировать db в docker-compose.yml
# 2. Создать .env (если нет)
cp .env.example .env

# 3. Запустить
docker compose up --build

# 4. Открыть браузер
# http://localhost:8000/

# 5. Проверить что работает
# - React приложение загружается
# - Нет 404 в Network
# - Нет ошибок в Console
```

Готово! 🚀

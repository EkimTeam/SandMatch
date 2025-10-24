# Локальная разработка BeachPlay (SandMatch)

Этот гайд описывает быстрый запуск проекта локально «как в проде», а также удобный режим разработки с Vite dev server.

## Предварительные требования

- Docker Desktop (Windows/macOS) или Docker Engine (Linux)
- Node.js LTS (>=18) для фронтенда
- Git

## Переменные окружения

1) Скопируйте `.env.example` в `.env`:

```bash
cp .env.example .env
```

2) Рекомендуемые значения для локали в `.env`:

```env
DJANGO_SETTINGS_MODULE=sandmatch.settings.local
DJANGO_DEBUG=1
ALLOWED_HOSTS=localhost,127.0.0.1,0.0.0.0

# Postgres (локальная БД через docker-compose.override.yml)
POSTGRES_DB=sandmatch
POSTGRES_USER=sandmatch
POSTGRES_PASSWORD=sandmatch
POSTGRES_HOST=db
POSTGRES_PORT=5432
```

> В проде используйте `sandmatch.settings.prod` и Managed PostgreSQL.

## Запуск вариант A: «Как в проде» (без Vite dev server)

Цель — увидеть ту же картинку, что и в проде, за счёт сборки фронтенда и подключения ассетов через `static/frontend/manifest.json`.

1) Соберите фронтенд:
```bash
cd frontend
npm ci
npm run build
cd ..
```

2) Запустите бэкенд (Docker):
```bash
docker compose up -d
```

3) Примените миграции и соберите статику:
```bash
docker compose exec web python manage.py migrate
docker compose exec web python manage.py collectstatic --noinput
```

4) Откройте приложение: http://localhost:8000

В HTML будут ссылки вида `/static/frontend/assets/*.css|*.js` — это и есть поведение «как в проде».

## Запуск вариант B: Режим разработки (Vite dev server)

Цель — быстрый цикл разработки (горячая перезагрузка React, быстрые правки UI).

1) Запустите бэкенд и базу:
```bash
docker compose up -d
```

2) Запустите фронтенд:
```bash
cd frontend
npm ci
npm run dev   # http://localhost:3000
```

3) Откройте SPA: http://localhost:3000

Vite проксирует `/api`, `/static`, `/sm-admin` на `http://localhost:8000` (см. `frontend/vite.config.ts`).

## Локальная БД с тестовыми данными

Если хотите использовать локальную БД в контейнере, добавьте `docker-compose.override.yml` (см. файл в корне репозитория), в котором определён сервис `db`. После `docker compose up -d` у вас будет PostgreSQL с доступом:

```
host: db
port: 5432
user: sandmatch
password: sandmatch
database: sandmatch
```

Переменная `POSTGRES_HOST=db` в `.env` уже указывает на этот контейнер.

Импорт тестовых данных (при наличии дампа):
```bash
# SQL дамп
cat dump.sql | docker compose exec -T db psql -U sandmatch -d sandmatch

# или загрузка фикстур Django
docker compose exec web python manage.py loaddata fixtures/*.json
```

## Полезные команды

```bash
# Логи
docker compose logs -f web

# Django shell
docker compose exec web python manage.py shell

# Создать суперпользователя
docker compose exec web python manage.py createsuperuser

# Пересобрать образы
docker compose build --no-cache

# Остановить всё
docker compose down

# Удалить с томами (сброс БД!)
docker compose down -v
```

## Troubleshooting

Смотрите `docs/TROUBLESHOOTING.md` — чек-лист по статике, Nginx (для проде), CSP и пр.

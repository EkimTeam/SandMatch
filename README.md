# SandMatch

Веб‑сервис для организации и проведения турниров по пляжному теннису.

## Быстрый старт (MVP0, локально в Docker)

1) Скопируйте `.env.example` в `.env` и задайте переменные окружения (минимум `DJANGO_SECRET_KEY`).
2) Запустите:

```bash
docker compose up --build
```

Сервис будет доступен на http://localhost:8080

Админка Django: http://localhost:8080/sm-admin

Создать суперпользователя:

```bash
docker compose exec web python manage.py createsuperuser
```

## Стек

- Django (Python 3.11+)
- PostgreSQL 14
- Docker + docker-compose
- Bootstrap 5 (позже)

## Структура проекта

```
SandMatch/
├─ sandmatch/
│  ├─ settings/
│  │  ├─ base.py
│  │  ├─ local.py
│  │  └─ prod.py
│  ├─ __init__.py
│  ├─ urls.py
│  ├─ wsgi.py
│  └─ asgi.py
├─ apps/
│  ├─ players/
│  ├─ teams/
│  ├─ tournaments/
│  └─ matches/
├─ templates/
├─ static/
├─ scripts/
│  └─ entrypoint.sh
├─ manage.py
├─ Dockerfile
├─ docker-compose.yml
├─ requirements.txt
├─ .env.example
├─ .gitignore
└─ docs/
   └─ PLAN.md
```

## Настройки

- Переменные БД задаются в `.env` (`POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_HOST`, `POSTGRES_PORT`).
- По умолчанию используется `sandmatch.settings.local`.

## Дальнейшие шаги

- Реализация моделей и бизнес‑логики по плану в `docs/PLAN.md`.
- Добавление CI/CD и прод‑настроек (MVP1, Yandex Cloud).

## Форматирование кода (pre-commit)

Установите pre-commit и активируйте хуки:

```bash
pip install pre-commit
pre-commit install
pre-commit run --all-files
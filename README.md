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

## Что уже работает (UI)

- Стартовая навигация: разделы `Турниры`, `Игроки`, `Статистика`.
- Страница `Турниры`: активные и история, кнопка «Начать новый турнир» (модальное окно).
- Создание турнира (круговая/олимпийка, формат сета, регламент, количество групп и участников для круговой).
- Страница турнира: отрисовка пустых групповых таблиц и «порядок игр», кнопки «Завершить», «Удалить», «Поделиться» (серый).
- Админ-действие «Сгенерировать расписание (круговая)» — создаёт матчи по круговой системе.

## Management-команды

```bash
docker compose exec web python manage.py seed_rulesets        # пресеты регламентов
docker compose exec web python.manage.py generate_round_robin <tournament_id>  # генерация расписания (круговая)
docker compose exec web python manage.py reset_presets        # пересоздать пресеты форматов и регламентов
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

## База данных

Смотрите подробности по схеме, ограничениям и служебным таблицам в `docs/DB.md`.

Основные операции:

```bash
# применить миграции
docker compose exec web python manage.py migrate

# создать суперпользователя
docker compose exec web python manage.py createsuperuser

# пересчитать денормализованную статистику по турниру
docker compose exec web python manage.py recalc_stats <tournament_id>
```

## Дальнейшие шаги

- Добавление участников и UI‑генерации расписания; ввод результатов матчей.
- Подсчет таблиц группы по `Ruleset`; экспорт/шаринг результатов.
- CI/CD и прод‑настройки (MVP1, Yandex Cloud).

## Форматирование кода (pre-commit)

Установите pre-commit и активируйте хуки:

```bash
pip install pre-commit
pre-commit install
pre-commit run --all-files
# SandMatch

Веб‑сервис для организации и проведения турниров по пляжному теннису.

## Быстрый старт (MVP0, локально в Docker)

1) Скопируйте `.env.example` в `.env` и задайте переменные окружения (минимум `DJANGO_SECRET_KEY`).
2) Запустите:

```bash
# сборка и запуск в фоне (рекомендуется)
docker compose up --build -d

# смотреть логи веб-контейнера
docker compose logs -f web
```

Сервис будет доступен на http://localhost:8080

Админка Django: http://localhost:8080/sm-admin

Создать суперпользователя:

```bash
docker compose exec web python manage.py createsuperuser
```

Пересборка образа требуется только если менялись `Dockerfile`, `requirements.txt` или системные зависимости. При правке Python‑кода в режиме разработки изменения подхватываются без сборки.

## Что уже работает (UI)

- Стартовая навигация: разделы `Турниры`, `Игроки`, `Статистика`.
- Страница `Турниры`: активные и история, кнопка «Начать новый турнир» (модальное окно).
- Создание турнира (круговая/олимпийка, формат сета, регламент, количество групп и участников для круговой).
- Страница турнира: отрисовка групповых таблиц и «порядок игр», кнопки «Завершить», «Удалить», «Поделиться».
- Админ-действие «Сгенерировать расписание (круговая)» — создаёт матчи по круговой системе.
- Ввод счёта матча в матрице (MVP: один сет) через модальное окно.
  - Отражение счёта в зеркальной ячейке (например, 6:4 → 4:6).
  - Сохранение в БД с выставлением `winner`, `status=completed`, `finished_at`.
  - Восстановление счёта из БД при перезагрузке/возврате на страницу.
  - Автоматический пересчёт технических столбцов на фронтенде (Победы, Сеты, Сеты соот., Геймы, Геймы соот.) и вычисление «Места» по каскаду: Победы → личная встреча → Сеты соот. → личная встреча → Геймы соот. → личная встреча → спец-тайбрейкеры (Петров Михаил → рейтинг → алфавит).
  - Экспорт PNG по кнопке «Поделиться»: снимается текущий вид таблиц (с учётом показанных техстолбцов и ФИО), добавляются заголовок и логотип в шапке, внизу — футер «SandMatch» слева и «скоро онлайн» справа; служебные элементы (переключатели, чекбокс фиксации, туры, нижняя панель) не попадают в картинку.

## Management-команды

```bash
docker compose exec web python manage.py seed_rulesets        # пресеты регламентов
docker compose exec web python manage.py generate_round_robin <tournament_id>  # генерация расписания (круговая)
docker compose exec web python manage.py reset_presets        # пересоздать пресеты форматов и регламентов
```

## Стек

- Django (Python 3.11+)
- PostgreSQL 14
- Docker + docker-compose
- Frontend: Vite + React 18 + TypeScript (Tailwind CSS настроен), html2canvas для экспорта PNG

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

- UI ввода результатов: поддержка нескольких сетов и тай‑брейков согласно `SetFormat` (TODO: чемпионский TB учитывать как 1:0 в «Сеты»).
- Формализация правил сортировки мест в пресет `Ruleset` (часть логики сейчас на фронтенде).
- Печатная версия экспорта и публичный шаринг-URL.
- CI/CD и прод‑настройки (MVP1, Yandex Cloud).

## Форматирование кода (pre-commit)

Установите pre-commit и активируйте хуки:

```bash
pip install pre-commit
pre-commit install
pre-commit run --all-files
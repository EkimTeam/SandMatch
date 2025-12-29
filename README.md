# BeachPlay (SandMatch)

Веб‑сервис для организации и проведения турниров по пляжному теннису.

## Документация

- **[Индекс документации](docs/INDEX.md)** - Навигация по всей документации
- **[Сводная таблица функционала](docs/SYSTEM_OVERVIEW.md)** - Все 23 модуля системы
- **[Архитектурные диаграммы](docs/SYSTEM_ARCHITECTURE.md)** - Mermaid диаграммы системы
- **[План деплоя](DEPLOYMENT_PLAN.md)** - Детальный план развертывания

---

## Runbook: прод‑деплой и обслуживание

Ниже краткий чек‑лист, чтобы развернуть и поддерживать проект в проде.

### 1) Предусловия

- Установлены: Docker, Docker Compose, Nginx, Certbot (если нужен HTTPS).
- Домен указывает на сервер (A‑запись), сертификаты выпущены.

### 2) Обновление кода и сборка образов

```bash
cd /opt/sandmatch/app
git pull --ff-only
docker compose down
docker compose build --no-cache
docker compose up -d
```

### 3) Важные переменные окружения (.env)

- `DJANGO_SETTINGS_MODULE=sandmatch.settings.prod`
- `DJANGO_DEBUG=0`
- `ALLOWED_HOSTS=beachplay.ru,127.0.0.1,localhost,<PUBLIC_IP>`
- `CSRF_TRUSTED_ORIGINS=https://beachplay.ru`
- `DATABASE_URL=postgres://user:pass@host:5432/db?sslmode=require` (или `POSTGRES_*`)
- `DJANGO_SECRET_KEY=<случайная_строка>`

### 4) Nginx

В HTTPS‑сервере должен быть блок раздачи статики:

```nginx
location /static/ {
    alias /opt/sandmatch/app/static/;
    access_log off;
}
```

API и страница приложения проксируются на `http://127.0.0.1:8000`.

### 5) Синхронизация фронт‑ассетов

Скрипт `scripts/entrypoint.sh` автоматически пополняет `/app/static/frontend` из
`/app/frontend/dist` при старте контейнера, если каталог пуст. Это избавляет от
ручного копирования после сборки образа.

Если используется Nginx, он читает файлы с хоста:

```
/opt/sandmatch/app/static/frontend/
```

При первом запуске файлы появятся автоматически (за счёт entrypoint) в контейнере.
Если `/opt/sandmatch/app/static` смонтирован как volume — файлы будут видны и на хосте.

### 6) Миграции и статика

`entrypoint.sh` выполняет:

- `python manage.py migrate --noinput`
- `python manage.py collectstatic --noinput` (не прерывает деплой при ошибках)

### 7) Быстрые проверки после запуска

```bash
docker compose ps
curl -i http://127.0.0.1:8000/api/health/
curl -I https://beachplay.ru/static/frontend/manifest.json
```

### 8) Частые проблемы

- Нет ассетов по домену → проверьте, что папка `/opt/sandmatch/app/static/frontend/` не пустая и
  что в HTTPS‑блоке Nginx есть `location /static/ { alias /opt/sandmatch/app/static/; }`.
- Пустая главная страница → проверьте, что `DJANGO_DEBUG=0` (иначе шаблон ждёт dev‑сервер Vite).
- Админка/логин не работает → проверьте `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, время сервера,
  наличие пользователей в БД; при необходимости создайте суперпользователя:
  `docker compose exec -it web python manage.py createsuperuser`.

### 9) Резервное копирование БД (пример)

```bash
docker compose exec -T db pg_dump \
  -U ${POSTGRES_USER:-sandmatch} \
  -d ${POSTGRES_DB:-sandmatch} \
  -F c -f /tmp/backup_$(date +%F_%H%M).dump
```

### 10) Обновление данных из дампа (только предметные таблицы)

Используйте `pg_restore --data-only` или отфильтрованный SQL для таблиц `players_*`,
`teams_*`, `tournaments_*`, `matches_*` (служебные таблицы не трогаем). См. подробные шаги
в истории развертывания или обратитесь к runbook деплоя данных.


## Frontend: как работать локально и на проде

### Локальная разработка (Vite dev server)

Команды (в каталоге `frontend/`):

```bash
npm install
npm run dev   # старт Vite на http://localhost:3000
```

Особенности:

- При `DJANGO_DEBUG=1` (локально) шаблон `templates/spa.html` подключает Vite dev‑сервер:
  - `http://localhost:3000/@vite/client`
  - `http://localhost:3000/src/main.tsx`
- Бэкенд (Django) продолжает обслуживать API на `http://127.0.0.1:8000`.
- Рекомендуется настроить прокси в `frontend/vite.config.ts`, если нужно пробрасывать `/api/*` на 8000.

Типовой запуск локально:

```bash
# Терминал 1 (бэкенд)
docker compose up -d db
DJANGO_DEBUG=1 python manage.py runserver 0.0.0.0:8000

# Терминал 2 (фронтенд)
cd frontend && npm run dev
```

### Продакшен (сборка и раздача ассетов)

- Сборка фронта происходит в CI/CD: `vite build` на этапе сборки Docker‑образа.
- Собранные файлы оказываются в контейнере в `/app/frontend/dist` и на старте
  `scripts/entrypoint.sh` автоматически копируются в `/app/static/frontend`, если папка пуста.
- Nginx на VM раздаёт статику из `alias /opt/sandmatch/app/static/;`,
  поэтому файлы доступны по `https://<домен>/static/frontend/...`.
- В проде `DJANGO_DEBUG=0`, и `templates/spa.html` подключает ассеты из манифеста (`manifest.json`).

Ничего руками делать на VM не требуется: авто‑деплой сам собирает образ и
устанавливает ассеты. Не используйте `docker-compose.override.yml` в проде.

### Полезные команды и проверки

```bash
# Проверить манифест через Nginx
curl -I https://beachplay.ru/static/frontend/manifest.json

# Проверить наличие ассетов в контейнере
docker compose exec web ls -la /app/static/frontend/

# Здоровье бэкенда
curl -i https://beachplay.ru/api/health/
```

### Troubleshooting фронтенда

- Пустая страница после деплоя:
  - Проверьте, что `DJANGO_DEBUG=0` в `.env` на VM.
  - Убедитесь, что `manifest.json` отдаётся по `/static/frontend/manifest.json`.
- 404 на `/static/frontend/*` по HTTPS:
  - Убедитесь, что в HTTPS‑сервере Nginx есть `location /static/ { alias /opt/sandmatch/app/static/; }`.
  - Проверьте, что на хосте `/opt/sandmatch/app/static/frontend/` не пустой (если смонтирован volume).
- Локально ассеты не обновляются в браузере:
  - «Жёсткая» перезагрузка (Ctrl+F5) или очистка кэша.


## Быстрый старт (MVP0, локально в Docker)

1) Скопируйте `.env.example` в `.env` и задайте переменные окружения (минимум `DJANGO_SECRET_KEY`).
2) Запустите:

```bash
# сборка и запуск в фоне (рекомендуется)
docker compose up --build -d

# смотреть логи веб-контейнера
docker compose logs -f web
```

Сервис будет доступен на http://localhost:8000

Админка Django: http://localhost:8000/sm-admin

Создать суперпользователя:

```bash
docker compose exec web python manage.py createsuperuser
```

Пересборка образа требуется только если менялись `Dockerfile`, `requirements.txt` или системные зависимости. При правке Python‑кода в режиме разработки изменения подхватываются без сборки.

## Что уже работает (UI)

### Навигация и общие страницы
- Стартовая навигация: разделы `Турниры`, `Игроки`, `Статистика`.
- Страница `Турниры`: активные и история, кнопка «Начать новый турнир» (модальное окно).
- Создание турнира (круговая/олимпийка, формат сета, регламент, количество групп и участников для круговой).

### Круговая система
- **Групповые таблицы**: отрисовка участников, счетов, технических столбцов (победы, сеты, соотношения, место).
- **Расписание туров**: отображение под таблицей с интерактивностью:
  - Зачеркивание завершенных матчей
  - Подсветка live-матчей зеленым фоном
  - Hover-эффект: при наведении на игру подсвечиваются соответствующие ячейки в таблице
  - Клик на игру открывает диалог ввода счета
- **Модальное окно действий** с тремя состояниями:
  - Не начат: "Начать матч", "Ввести счёт"
  - Идет (live): "Отменить матч", "Ввести счёт"
  - Завершен: "Начать матч" (только свободный формат), "Ввести счёт", "Удалить матч"
- **Проверка занятости**: при начале матча проверяется, что участники не играют в других матчах
- **Подсветка ячеек**:
  - Live-матчи: светло-зеленый фон (#e9fbe9) + красный кружочек перед счетом
  - Победные ячейки: светло-зеленый фон (#d1fae5)
- **Удаление счета**: кнопка для завершенных матчей с подтверждением

### Олимпийская система
- **Сетка плей-офф**: автоматическая генерация, SVG-соединения между раундами
- **Drag & Drop**: перетаскивание участников в слоты сетки
- **Автопродвижение**: победитель автоматически продвигается в следующий раунд
- **Матч за 3-е место**: поддержка полуфиналов и финала

### Единая модалка ввода счёта (круговая и олимпийская)
- Поддержка нескольких сетов согласно `SetFormat` (до N сетов, TB при 6:6, чемпионский TB в решающем сете)
- Быстрые пресеты (например, 6:0…6:4, 7:5, 7:6) и ввод очков TB для проигравшего при 7:6/6:7
docker compose exec web python manage.py reset_presets        # пересоздать пресеты форматов и регламентов
 
# Рейтинг (см. также docs/RATING.md)
docker compose exec web python manage.py cleanup_tournament_rating <tournament_id> [--dry-run]
docker compose exec web python manage.py recompute_tournament_rating <tournament_id> [--set-start]
```

Подробнее о методике и инструментах рейтинга: см. docs/RATING.md.

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

- Учет чемпионского TB как 1:0 в агрегате «Сеты» в таблицах групп (сейчас хранится TB очками; в агрегате пока TODO).
- Формализация правил сортировки мест в пресет `Ruleset` (часть логики сейчас на фронтенде).
- Печатная версия экспорта и публичный шаринг-URL.
- CI/CD и прод‑настройки (MVP1, Yandex Cloud).

## API (фрагменты)

- Группы — ввод счёта одного сета (MVP-совместимость): `POST /api/tournaments/{id}/match_save_score/`
  - Тело: `{ match_id, id_team_first, id_team_second, games_first, games_second }`
- Плей‑офф — полный счёт (все сеты): `POST /api/tournaments/{id}/match_save_score_full/`
  - Тело: `{ match_id, sets: [{ index, games_1, games_2, tb_1?, tb_2?, is_tiebreak_only? }] }`

Сериализатор турнира (`TournamentSerializer`) включает поле `set_format` с параметрами формата сетов.

## Форматирование кода (pre-commit)

Установите pre-commit и активируйте хуки:

```bash
pip install pre-commit
pre-commit install
pre-commit run --all-files
```

## Локальный запуск

### Вариант A: разработка с Vite dev server (рекомендуется)

1) Поднимите backend (Docker):

```bash
docker compose up -d
curl -i http://127.0.0.1:8000/api/health/
```

2) Запустите фронтенд:

```bash
cd frontend
npm ci
npm run dev
```

3) Откройте SPA: http://localhost:3000

Примечание: dev‑прокси в `frontend/vite.config.ts` направляет `/api`, `/static`, `/sm-admin` на `http://localhost:8000`.

### Вариант B: без Vite dev, смотреть собранную версию

1) Соберите фронтенд:

```bash
cd frontend && npm ci && npm run build && cd ..
```

2) Перезапустите backend (в образе уже есть копирование сборки в `static/frontend/`):

```bash
docker compose restart web
```

3) Откройте SPA: http://localhost:8000

## Прод (VM): последовательность деплоя

Эти шаги учитывают поддержку Vite manifest и загрузку ассетов через `vite_assets` в Django.

1) Обновить код на VM:

```bash
cd /opt/sandmatch/app
git pull --ff-only origin main
```

2) Полностью пересобрать и запустить контейнеры (обновится сборка фронтенда и появится `static/frontend/manifest.json`):

```bash
docker compose down
docker compose build --no-cache
docker compose up -d
```

3) Применить миграции и собрать статику (entrypoint делает это автоматически, но можно вручную):

```bash
docker compose exec web python manage.py migrate --noinput
docker compose exec web python manage.py collectstatic --noinput
```

4) Проверки:

```bash
docker compose ps
docker compose logs -n 100 web
curl -i http://127.0.0.1:8000/api/health/
```

5) Если используется Nginx как reverse‑proxy:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

После этого публичная страница должна загружаться с подключёнными CSS/JS из `/static/frontend/`.
# BeachPlay

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

Сервис будет доступен на http://localhost:8000

Админка Django: http://localhost:8000/sm-admin

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
- Единая модалка ввода счёта (круговая и олимпийская):
  - Поддержка нескольких сетов согласно `SetFormat` (до N сетов, TB при 6:6, чемпионский TB в решающем сете).
  - Быстрые пресеты (например, 6:0…6:4, 7:5, 7:6) и ввод очков TB для проигравшего при 7:6/6:7.
  - Валидация по формату, блокировка некорректного ввода.
  - Для круговой — зеркальное отражение в парной ячейке, мгновенное обновление таблиц без перезагрузки.
  - Для олимпийки — сохранение полного счёта всех сетов и автопродвижение победителя.
- Сохранение результатов:
  - Группы: фиксируется победитель и завершение матча, счёт отображается в обеих ячейках.
  - Плей‑офф: сохраняются все сеты/тай‑брейки, ставится победитель, матч завершается, победитель продвигается по сетке.
- Экспорт PNG по кнопке «Поделиться»: снимается текущий вид таблиц/сетки, добавляются заголовок и логотип в шапке, внизу — футер «BeachPlay» слева и «скоро онлайн» справа; служебные элементы (переключатели, чекбокс фиксации, туры, нижняя панель) не попадают в картинку.

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
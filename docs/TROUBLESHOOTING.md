## Дубли в players_playerratinghistory после завершения турнира

Симптомы:
- Для одного игрока по одному матчу есть по 2 и более записей в `players_playerratinghistory`.
- Итоговый рейтинг `players_player.current_rating` выглядит завышенным/заниженным.

Причина:
- Повторный запуск расчёта рейтинга для того же турнира (раньше endpoint завершения не был идемпотентным).

Решение (один из вариантов):
- Очистить данные расчёта по турниру и пересчитать:
  ```bash
  python manage.py cleanup_tournament_rating <tournament_id>
  python manage.py recompute_tournament_rating <tournament_id> --set-start
  ```
- Либо дедуплицировать записи на уровне SQL и пересобрать агрегаты (см. docs/RATING.md).

Профилактика:
- Начиная с текущей версии, `POST /api/tournaments/<id>/complete/` идемпотентен: повторный пересчёт блокируется, если турнир уже завершён или агрегаты `PlayerRatingDynamic` существуют.

## Дубликаты записей рейтинга при завершении турнира

Если после завершения турнира обнаруживаются дубликаты записей рейтинга, это может быть вызвано повторным запуском расчёта рейтинга для того же турнира. Чтобы исправить эту проблему, можно очистить данные расчёта по турниру и пересчитать рейтинг или дедуплицировать записи на уровне SQL и пересобрать агрегаты.

## Статика/стили не загружаются

1) __Проверить наличие manifest локально__
```bash
curl -I http://localhost:8000/static/frontend/manifest.json
```
Ожидаем `HTTP/1.1 200 OK`.

2) __Проверить теги на странице__
```bash
curl -s http://localhost:8000/ | grep -E "(link|script)" | head -20
```
Должны быть ссылки вида `/static/frontend/assets/*.css|*.js` (в режиме `DJANGO_DEBUG=0`).

3) __Проверить тип контента CSS/JS__
```bash
curl -I http://localhost:8000/static/frontend/assets/main-*.css | grep Content-Type
curl -I http://localhost:8000/static/frontend/assets/main-*.js  | grep Content-Type
```
Ожидаем `text/css` и `application/javascript` соответственно.

4) __Пересобрать фронтенд и collectstatic__
```bash
cd frontend && npm ci && npm run build && cd ..
docker compose exec web python manage.py collectstatic --noinput
```

5) __Проверить переменные окружения__
- Чтобы страница подхватывала манифест: `DJANGO_DEBUG=0`
- Для Vite dev server: `DJANGO_DEBUG=1` и запущен `npm run dev`

## Nginx (прод)

1) __Проверка конфигурации__
```bash
sudo nginx -t && sudo systemctl reload nginx
```

2) __Проверка раздачи статики__
```bash
curl -I https://beachplay.ru/static/frontend/manifest.json
```

3) __Права на файлы__
```bash
sudo chown -R www-data:www-data /opt/sandmatch/app/static/
sudo chmod -R 755 /opt/sandmatch/app/static/
```

## База данных

1) __Подключение к локальному контейнеру БД__
```bash
docker compose exec db psql -U sandmatch -d sandmatch -c "SELECT 1;"
```

2) __Импорт дампа в локальную БД__
```bash
# SQL дамп
cat dump.sql | docker compose exec -T db psql -U sandmatch -d sandmatch

# Django фикстуры
docker compose exec web python manage.py loaddata fixtures/*.json
```

3) __Проверка настроек подключения__
Убедитесь, что значения `.env` соответствуют вашей БД:
```
POSTGRES_DB=sandmatch
POSTGRES_USER=sandmatch
POSTGRES_PASSWORD=sandmatch
POSTGRES_HOST=db      # или хост внешней БД
POSTGRES_PORT=5432
```

## Health‑checks

1) __Базовый__
```bash
curl -s http://localhost:8000/api/health/
```
Ожидаем `{ "ok": true }`.

## Частые вопросы

- __Хочу видеть локально «как на проде»__ — установите `DJANGO_DEBUG=0`, выполните `npm run build` в `frontend/`, затем `collectstatic`, откройте `http://localhost:8000`.
- __Хочу быстро править UI__ — оставьте `DJANGO_DEBUG=1`, запустите `docker compose up -d` и `npm run dev` в `frontend/`, работайте на `http://localhost:3000`.

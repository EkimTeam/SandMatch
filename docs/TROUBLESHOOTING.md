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

## Дубликаты игроков (BP) после импорта BTR

Симптомы:
- В базе есть 2+ записей `players_player` с одинаковыми ФИО.
- Один игрок может быть связан с BTR (`Player.btr_player_id`), другой — нет.
- Один из дублей мог участвовать в турнирах / матчах / пересчёте рейтинга, другой — нет.
- В многостадийном турнире (например, мастер `251` и его стадии) могли сыграть дубли — из‑за этого «реальный» игрок размазан по двум `player_id`.

Причина:
- Импорт BTR → BP создал новые `Player` для BTR‑профилей, которые заранее не были «связаны» с существующими BP‑игроками.

### Какие ссылки нужно учитывать при слиянии игроков

В этой кодовой базе `Match` хранит команды (`Team`), а `Team` хранит игроков (`Player`). Поэтому слияние игроков делается через:
- замены `player_id` в `teams_team` (создание/переиспользование корректной `Team`),
- перелинковку `TournamentEntry.team_id`, `DrawPosition.entry_id`, `Match.team_1/team_2/winner/team_low/team_high`,
- перелинковку регистрации (`TournamentRegistration`, `PairInvitation`),
- перелинковку профиля (`accounts.UserProfile.player_id`),
- перелинковку/дедупликацию рейтингов (`PlayerRatingHistory`, `PlayerRatingDynamic`).

### Новый набор management-команд

Команды рассчитаны на прод‑использование. Всегда начинайте с `--dry-run`.

1) Найти потенциальные дубли:
```bash
python manage.py players_find_duplicates

# точнее (ФИО + дата рождения)
python manage.py players_find_duplicates --by-birth-date

# только группы, где есть хотя бы один игрок с BTR-связью
python manage.py players_find_duplicates --only-with-btr
```

2) Слить дубль в канонического игрока:
```bash
# DRY RUN
python manage.py players_merge <source_player_id> <target_player_id> --dry-run

# реальный запуск
python manage.py players_merge <source_player_id> <target_player_id>

# если нужно перенести BTR-связь с source на target
python manage.py players_merge <source_player_id> <target_player_id> --prefer-btr-target

# опционально удалять старые teams.Team, которые удалось заменить
python manage.py players_merge <source_player_id> <target_player_id> --delete-old-teams
```

### Как выбирать target/source (4 коллизии)

Ниже — практическое правило выбора «target» (канонического игрока, который остаётся) и «source» (который удаляем).

1) Два идентичных игрока, один связан с BTR, и оба нигде не играли
- **target**: игрок со связью с BTR
- **source**: игрок без BTR

2) Два идентичных игрока, один связан с BTR, а второй играл матчи/турниры с расчётом рейтинга
- **target**: игрок, который реально играл/имеет историю матчей/рейтинга
- Затем используйте `--prefer-btr-target`, чтобы перенести BTR‑связь на target.

3) Два идентичных игрока, один сыграл многостадийный турнир 251 (или его стадии) и получил пересчитанный рейтинг
- **target**: игрок, который был использован в матчах/командах турнира 251
- **source**: второй дубль

4) Комбинация: один играл 251, а другой играл и другие турниры/матчи с рейтингом
- В этом случае безопаснее всего:
  - Сначала откатить завершение 251 (сбросить его рейтинг/места),
  - Затем слить игроков в одного,
  - Потом завершить 251 заново для корректного пересчёта рейтинга.

### Процедура для мастер-турнира 251 (rollback → merge → complete)

Цель: «не поломать введённые результаты», но пересчитать рейтинг так, как будто дублей никогда не было.

Рекомендуемый порядок:

1) Откатить завершение 251 (если он завершён):
```bash
python manage.py tournament_rollback_complete 251

# сначала можно проверить dry-run
python manage.py tournament_rollback_complete 251 --dry-run
```

2) Выполнить слияния игроков (всё сначала с `--dry-run`, затем реальный запуск):
```bash
python manage.py players_merge <source_player_id> <target_player_id> --dry-run
python manage.py players_merge <source_player_id> <target_player_id>
```

3) Завершить мастер‑турнир 251 заново (пересчёт рейтинга по стадиям):
```bash
python manage.py tournament_complete_master 251

# если нужно завершать несмотря на незавершённые матчи
python manage.py tournament_complete_master 251 --force
```

Примечания:
- Откат завершения 251 удаляет `PlayerRatingHistory` по всем стадиям и `PlayerRatingDynamic` по master, а также возвращает стадии в статус `active`.
- Слияние игроков НЕ меняет результаты матчей — оно меняет только ссылки на игроков/команды.

### Важные ограничения

- Команда `players_merge` блокирует ситуацию, когда оба игрока привязаны к разным `BtrPlayer` (это требует ручного решения).
- Если после слияния в турнире образуется конфликт позиций/участий (например, одна и та же команда оказывается дважды), команда делает дедупликацию `TournamentEntry` и переносит ссылки `DrawPosition`/`TournamentPlacement` на оставшийся entry.

## Бэкап базы данных (PostgreSQL) + скачать на локальный ПК + восстановление

Перед любыми массовыми операциями (слияние игроков, откат/перезавершение турнира) рекомендуется сделать бэкап.

Ниже примеры для окружения, где PostgreSQL работает в контейнере `db` (docker compose).

### Сделать бэкап на сервере/хосте

1) Создать папку для бэкапов на хосте (пример):
```bash
mkdir -p backups
```

2) Сделать `pg_dump` в файл (custom format, удобно для восстановления):
```bash
docker compose exec -T db pg_dump \
  -U sandmatch \
  -d sandmatch \
  -Fc \
  -f /tmp/sandmatch.dump

docker compose exec -T db ls -lh /tmp/sandmatch.dump
```

3) Скопировать бэкап из контейнера на хост:
```bash
docker cp $(docker compose ps -q db):/tmp/sandmatch.dump backups/sandmatch_$(date +%Y-%m-%d_%H-%M).dump
```

Если команда `docker cp` недоступна (или вы работаете через CI), можно вывести дамп в stdout и редиректнуть на хост:
```bash
docker compose exec -T db pg_dump -U sandmatch -d sandmatch -Fc > backups/sandmatch_$(date +%Y-%m-%d_%H-%M).dump
```

### Скачать бэкап на локальный компьютер

Вариант через `scp` (на локальном ПК):
```bash
scp <user>@<server>:/path/to/project/backups/sandmatch_YYYY-MM-DD_HH-MM.dump ./
```

Если есть доступ только по SFTP — можно скачать тем же путём через любой клиент (WinSCP/FileZilla).

### Восстановление из бэкапа

Важно: восстановление перезаписывает данные. Делайте это в обслуживаемое окно.

1) Загрузить файл дампа на сервер (например, в папку `backups/`).

2) (Рекомендуется) остановить приложение, чтобы не было записи в БД во время восстановления.

3) Восстановить дамп:

Если дамп в формате `-Fc` (custom):
```bash
# Сбросить схему перед восстановлением (осторожно)
docker compose exec -T db psql -U sandmatch -d sandmatch -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

# Восстановить
cat backups/sandmatch_YYYY-MM-DD_HH-MM.dump | docker compose exec -T db pg_restore \
  -U sandmatch \
  -d sandmatch \
  --no-owner \
  --no-privileges \
  --clean \
  --if-exists
```

Если дамп plain SQL (`pg_dump` без `-Fc`):
```bash
cat backups/sandmatch_YYYY-MM-DD_HH-MM.sql | docker compose exec -T db psql -U sandmatch -d sandmatch
```

4) После восстановления:
- проверить доступность БД (`SELECT 1`)
- запустить приложение
- при необходимости выполнить `migrate` (если код ожидает миграции, которых нет в дампе):
```bash
docker compose exec web python manage.py migrate
```

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

## Ошибка `no space left on device` при работе Docker (прод)

Симптомы:

- В логах сборки/запуска контейнеров появляются сообщения вида:
  - `failed to register layer: write ... no space left on device`
  - `write /usr/local/lib/python...: no space left on device`
- Новые образы не собираются, деплой падает.

### Диагностика

1. Проверить общий статус дисков:

   ```bash
   df -h
   ```

   Ищем раздел, где установлен Docker (обычно `/` или `/dev/vda1`) и смотрим `%` использования.

2. Проверить, что именно занимает место в Docker:

   ```bash
   docker system df
   ```

   Обращаем внимание на:

   - `Images` — размер образов и сколько из них можно освободить (`reclaimable`).
   - `Containers` — размер контейнеров.
   - `Local Volumes` — размер томов и `reclaimable`.

### Базовая очистка (безопасно для продакшена)

1. Удалить висящие (неиспользуемые) образы:

   ```bash
   docker image prune -f
   ```

   Это удалит только образы, на которые не ссылается ни один контейнер.

2. При необходимости — удалить остановленные контейнеры:

   ```bash
   docker container prune -f
   ```

3. При необходимости — удалить неиспользуемые тома (осторожно, может удалить данные):

   ```bash
   docker volume prune -f
   ```

### Агрессивная очистка (только если понимаете последствия)

Удаляет все неиспользуемые образы, контейнеры, сети и тома:

```bash
docker system prune -a -f
```

Использовать только если:

- Понимаете, какие сервисы крутятся на сервере.
- Есть возможность пересобрать образы из Dockerfile/CI.

### После очистки

- Повторно запустить сборку/деплой.
- При регулярном деплое полезно периодически проверять:

  ```bash
  docker system df
  ```

  и при росте `Images reclaimable` до нескольких десятков ГБ — выполнять `docker image prune -f`.

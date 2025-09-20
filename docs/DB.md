# База данных SandMatch

Этот документ описывает текущую схему БД и операционные процедуры.

## Схема и ключевые сущности

- players_player
  - Добавлено поле `city VARCHAR(100) NOT NULL DEFAULT ''` — город игрока.

- matches_match
  - Структурированные поля стадии/раунда:
    - `stage VARCHAR(16) CHECK IN ('group','playoff','placement')` — стадия турнира
    - `group_index SMALLINT NULL` — номер группы для группового этапа
    - `round_index SMALLINT NULL` — номер тура/раунда внутри стадии
  - Статусы и время:
    - `status VARCHAR(16) CHECK IN ('scheduled','live','completed','walkover','retired','default')`
    - `scheduled_time TIMESTAMPTZ NULL`
    - `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`
    - `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`
  - Нормализованные ссылки на команды для уникальности пары:
    - `team_low_id INTEGER REFERENCES teams_team(id) ON DELETE RESTRICT` (PROTECT)
    - `team_high_id INTEGER REFERENCES teams_team(id) ON DELETE RESTRICT`
  - Ограничения и индексы:
    - Уникальность пары в рамках турнира/стадии/группы: `UNIQUE (tournament_id, stage, group_index, team_low_id, team_high_id)`
    - Индексы: `(tournament_id, status)`, `(tournament_id, winner_id)`, `(tournament_id, team_low_id)`, `(tournament_id, team_high_id)`, `(tournament_id, stage, group_index, round_index, order_in_round)`

- matches_matchset (без изменений схемы в рамках данной итерации)
  - Используется для хранения счёта сетов и тайбрейков

- matches_matchspecialoutcome (НОВАЯ)
  - Особые исходы матча (неявка/снятие/дисквалификация)
  - Поля: `match_id UNIQUE`, `type`, `retired_team_id`, `defaulted_team_id`, `set_number`, `score_at_stop`

- tournaments_tournamententry (без изменений схемы в рамках данной итерации)

- tournaments_tournamententrystats (НОВАЯ)
  - Денормализованная статистика участника турнира
  - Поля: `entry_id UNIQUE`, `wins`, `sets_won`, `sets_lost`, `games_won`, `games_lost`, `updated_at`

## Автоматическое обновление updated_at

Для таблиц `matches_match` и `tournaments_tournamententrystats` добавлена функция/триггер, проставляющий `updated_at = now()` при обновлении строки.

## Логика пересчёта статистики

Сервис: `apps/tournaments/services/stats.py`
- `recalc_group_stats(tournament, group_index)` — пересчитывает статистику для одной группы
- `recalc_tournament_stats(tournament)` — пересчитывает для всех групп турнира

Интеграция:
- Пересчёт вызывается автоматически в `apps/tournaments/views.py` после сохранения счёта матча (`save_score`).
- Доступна management-команда:

```bash
docker compose exec web python manage.py recalc_stats <tournament_id>
```

## Применение изменений

- На уровне БД изменения применены (см. `sql_migrations.sql`).
- На уровне Django модели синхронизированы fake-миграциями, проект готов к работе.

## Примечания по данным

- Для существующих матчей выполнен backfill:
  - `team_low_id = LEAST(team_1_id, team_2_id)`, `team_high_id = GREATEST(...)`
  - Если `round_name` имел вид `Группа N`, то выставлены `stage='group'` и `group_index=N`.
- Уникальное ограничение для пар предотвращает дубли `(A,B)` и `(B,A)` в рамках одной группы турнира.

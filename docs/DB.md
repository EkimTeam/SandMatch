## Ранжирование мест в группе (MVP)

Ранжирование вычисляется на фронтенде по каскаду показателей:
1. Победы
2. Личные встречи между двумя оставшимися равными участниками
3. «Сеты соот.» (выигранные / всего)
4. Личные встречи
5. «Геймы соот.» (выигранные / всего)
6. Личные встречи
7. Дополнительные тайбрейкеры: рейтинг (для пар — сумма рейтингов) → алфавитная сортировка по имени.

Реализация: `computePlacements`, `rankGroup`, `h2hCompare` в `frontend/src/pages/TournamentDetailPage.tsx`.
# База данных BeachPlay

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
  - Используется для хранения счёта сетов и тай‑брейков.
  - Сеты сохраняются «от победителя»: `games_1 >= games_2`, где `games_1/games_2` — очки победителя/проигравшего в данном сете. Для чемпионского тай‑брейка (`is_tiebreak_only=true`) значения `tb_1/tb_2` также фиксируются «от победителя». На стороне UI остаётся TODO: учитывать чемпионский TB как 1:0/0:1 в агрегате «Сеты».

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
- Пересчёт техстолбцов в текущем MVP выполняется на фронтенде из отображаемых данных матрицы (см. `frontend/src/pages/TournamentDetailPage.tsx`).
- Бэкенд сохраняет «сырые» сеты в `matches_matchset` и фиксирует победителя/статус матча.
- Для плей‑офф доступен endpoint `POST /api/tournaments/{id}/match_save_score_full/`, принимающий массив сетов; победитель вычисляется по числу выигранных сетов и продвигается дальше по сетке.
- Для бэкенд‑пересчёта предусмотрены сервисы в `apps/tournaments/services/stats.py` (при необходимости массового перерасчёта или бэкенд‑эндпоинта).
- Доступна management-команда:

```bash
docker compose exec web python manage.py recalc_stats <tournament_id>
```

## Применение изменений

- Все изменения схемы применяются штатными Django‑миграциями, находящимися в каталогах приложений:
  - `apps/players/migrations/`
  - `apps/teams/migrations/`
  - `apps/tournaments/migrations/`
  - `apps/matches/migrations/`

Применение:

```bash
docker compose exec web python manage.py migrate
```

## Примечания по данным

- Для существующих матчей выполнен backfill:
  - `team_low_id = LEAST(team_1_id, team_2_id)`, `team_high_id = GREATEST(...)`
  - Если `round_name` имел вид `Группа N`, то выставлены `stage='group'` и `group_index=N`.
- Уникальное ограничение для пар предотвращает дубли `(A,B)` и `(B,A)` в рамках одной группы турнира.

---

## Групповые расписания: tournaments_tournament.group_schedule_patterns

- Поле `group_schedule_patterns` в таблице `tournaments_tournament` хранит соответствие выбранного шаблона расписания для каждой группы.
- Тип: JSON‑объект со строковыми ключами вида `"Группа X"` и значениями `pattern_id` (INTEGER):

```json
{
  "Группа 1": 5,
  "Группа 2": 1
}
```

- Семантика: значение — ID из `tournaments_schedulepattern`.
- Совместимость: если поле пусто (`NULL` / `{}` / строка `"{}"`), по умолчанию используется алгоритм Бергера.
- Сериализация API: `TournamentSerializer` всегда возвращает объект (dict). Если в БД хранится строка JSON, она парсится на лету.

## Нумерация туров: order_in_round → round_index

- Для группового этапа значение `order_in_round` кодирует тур матчей с шагом 100:
  - Тур 1: номера 1, 2, 3, …
  - Тур 2: 101, 102, 103, …
  - Тур k: `(k-1)*100 + i`, где `i` — порядковый номер пары в туре, начиная с 1.

- Из `order_in_round` вычисляется `round_index` (номер тура):

```text
round_index = ((order_in_round - 1) // 100) + 1
```

- При сохранении матчей группового этапа заполняются поля:
  - `stage = 'group'`
  - `group_index = X` (номер группы)
  - `round_index = k` (см. формулу)
  - `round_name = 'Группа X'`
  - `team_low_id`, `team_high_id` — нормализованная пара для уникальности
  - `team_1_id`, `team_2_id` — фактический порядок показа в UI

## Фиксация участников: порядок операций (lock_participants)

- Endpoint: `POST /api/tournaments/{id}/lock_participants/`.
- Транзакционный сценарий для `matches_match`:
  1) Удаляются только незавершенные групповые матчи: `WHERE tournament_id=:id AND stage='group' AND status='scheduled'`.
  2) По `group_schedule_patterns` определяется алгоритм на каждую группу; при пустом значении — Бергер.
  3) Генерируются пары, рассчитывается `order_in_round` и `round_index`.
  4) Сохранение матчей с заполнением полей, уникальность обеспечивается по `(tournament, stage, group_index, team_low, team_high)`.

## Совместимость и источники данных для генерации

- Список участников в группе формируется по `tournaments_tournamententry (group_index, row_index)` — порядок строк таблицы UI.
- Это гарантирует соответствие индексов 1..N в шаблоне позициям участников в группе.

---

## Диаграмма последовательности: фиксация участников (lock_participants)

```mermaid
sequenceDiagram
    autonumber
    actor User as Пользователь (UI)
    participant FE as Frontend (React)
    participant API as TournamentViewSet.lock_participants
    participant Gen as round_robin.generate_round_robin_matches
    participant Persist as persist_generated_matches
    database DB as PostgreSQL

    User->>FE: Клик "Зафиксировать участников"
    FE->>API: POST /api/tournaments/{id}/lock_participants/
    API->>DB: DELETE matches_match WHERE stage='group' AND status='scheduled'
    API->>Gen: generate_round_robin_matches(tournament)
    Gen->>DB: SELECT entries (group_index,row_index)
    Gen->>DB: SELECT tournaments_schedulepattern (по group_schedule_patterns)
    Gen-->>API: список пар с order_in_round и round_name
    API->>Persist: persist_generated_matches(tournament, pairs)
    Persist->>DB: INSERT/GET_OR_CREATE matches_match
    Note right of Persist: stage, group_index, round_index, round_name,<br/>team_low/high, team_1/2, order_in_round
    Persist-->>API: created = N
    API-->>FE: { ok: true, created: N }
    FE-->>User: Матчи созданы, таблица обновлена
```

---

## ER‑диаграмма основных таблиц (tournaments_*, matches_*, players_*, teams_*)

```mermaid
erDiagram
    players_player ||--o{ teams_team : "player_1_id / player_2_id"
    teams_team ||--o{ tournaments_tournamententry : has
    tournaments_tournament ||--o{ tournaments_tournamententry : has
    tournaments_tournament ||--o{ matches_match : has
    tournaments_tournament ||--o{ tournaments_knockoutbracket : has

    tournaments_tournamententry ||--|| tournaments_tournamententrystats : has
    teams_team ||--o{ matches_match : team_1_id
    teams_team ||--o{ matches_match : team_2_id
    teams_team ||--o{ matches_match : team_low_id
    teams_team ||--o{ matches_match : team_high_id

    matches_match ||--o{ matches_matchset : has
    matches_match ||--o| matches_matchspecialoutcome : has

    tournaments_tournament {
        int id PK
        date date
        varchar system
        varchar participant_mode
        int groups_count
        jsonb group_schedule_patterns
        int planned_participants
    }

    tournaments_tournamententry {
        int id PK
        int tournament_id FK
        int team_id FK
        smallint group_index
        smallint row_index
    }

    tournaments_tournamententrystats {
        int id PK
        int entry_id FK UNIQUE
        int wins
        int sets_won
        int sets_lost
        int games_won
        int games_lost
        timestamptz updated_at
    }

    teams_team {
        int id PK
        int player_1_id FK
        int player_2_id FK NULL
        varchar name (computed)
    }

    players_player {
        int id PK
        varchar first_name
        varchar last_name
        varchar display_name
        varchar level
    }

    matches_match {
        int id PK
        int tournament_id FK
        int team_1_id FK NULL
        int team_2_id FK NULL
        int team_low_id FK NULL
        int team_high_id FK NULL
        int winner_id FK NULL
        varchar stage
        smallint group_index NULL
        smallint round_index NULL
        varchar round_name NULL
        int order_in_round
        varchar status
        timestamptz created_at
        timestamptz updated_at
    }

    matches_matchset {
        int id PK
        int match_id FK
        smallint index
        smallint games_1
        smallint games_2
        smallint tb_1 NULL
        smallint tb_2 NULL
        boolean is_tiebreak_only
    }

    matches_matchspecialoutcome {
        int id PK
        int match_id FK UNIQUE
        varchar type
        int retired_team_id FK NULL
        int defaulted_team_id FK NULL
        smallint set_number NULL
        varchar score_at_stop NULL
    }
```

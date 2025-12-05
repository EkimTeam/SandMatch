# Турниры Кинг (King / Americano)

Этот документ описывает **актуальную** реализацию турниров системы Кинг в SandMatch:

- модель данных и режимы подсчёта G- / M+ / NO
- API и сервисы бэкенда
- вычисление статистики и ранжирования
- поведение фронтенда (страница King, UX ввода счёта)
- экспорт таблицы и пересчёт рейтинга.

## 1. Модель турнира

Турниры Кинг — это отдельный тип турниров:

- `Tournament.system = "king"`
- `Tournament.participant_mode = "singles"`
- участники групп хранятся как `TournamentEntry` с `team_id`, где:
  - `team.player_1_id` — **реальный игрок**;
  - `team.player_2_id` всегда `NULL` (фиктивная вторая позиция не используется).

### 1.1. Режимы подсчёта для Кинг

Поле `Tournament.king_calculation_mode` определяет активный режим:

- `g_minus` — **G-**: не учитывать лишние матчи (обрезка до минимального числа матчей в группе).
- `m_plus` — **M+**: добавить средние значения за недостающие матчи (до максимального числа матчей в группе).
- `no` — **NO**: считать как есть, без компенсации разного количества матчей.

Режим влияет на отображение/ранжирование, но бэкенд всегда считает агрегаты **сразу для всех трёх режимов**.

## 2. Расписание и матчи Кинг

### 2.1. Генерация и хранение

- Расписание по турам генерируется и сохраняется как обычные `Match` с временными `Team`:
  - в матчах **всегда** пары: `team_1.player_1_id`, `team_1.player_2_id`, `team_2.player_1_id`, `team_2.player_2_id` не `NULL`;
  - для каждого матча создаются собственные пары (игрок может быть в любой команде и в любой позиции).
- В API для Кинг используется отдельная ручка:
  - `GET /tournaments/{id}/king_schedule/` — расписание турнира Кинг.

### 2.2. Формат `king_schedule`

`TournamentViewSet.king_schedule` формирует структуру:

```jsonc
{
  "ok": true,
  "schedule": {
    "1": {                 // группа 1
      "participants": [
        {
          "id": 123,      // TournamentEntry.id
          "team_id": 10,  // teams_team.id
          "player_id": 5, // team.player_1_id — базовый игрок для строки
          "name": "Иванов Иван",
          "display_name": "Иван",
          "row_index": 1
        },
        ...
      ],
      "rounds": [
        {
          "round": 1,
          "matches": [
            {
              "id": 1001,
              "team1_players": [ { "id": 5, "name": "...", "display_name": "..." }, ... ],
              "team2_players": [ ... ],
              "score": "15:13 11:9",
              "status": "scheduled" | "live" | "completed",
              "sets": [ { "index": 1, "games_1": 15, "games_2": 13, ... }, ... ]
            },
            ...
          ]
        },
        ...
      ]
    },
    "2": { ... }
  }
}
```

Важно:

- `participants[].player_id` — **прямая проекция** `teams_team.player_1_id` и используется для сопоставления с `team*_players[].id` в матчах.
- `rounds[].matches[].sets` содержит полный счёт по сетам и тай-брейкам и используется как фронтендом, так и бэкендом.

## 3. Статистика и ранжирование (backend)

### 3.1. Сервис `king_stats.py`

Файл: `apps/tournaments/services/king_stats.py`.

Основные функции:

- `_aggregate_for_king_group(tournament, group_index, group_data)` → `(stats: Dict[int, dict], compute_stats_for_row)`
  - считает агрегаты **по всем трём режимам** одновременно для каждой строки `row_index`:
    - NO: `wins`, `sets_won`, `sets_lost`, `games_won`, `games_lost`, `games_ratio`, `sets_ratio_value`;
    - G-: `wins_g`, `sets_won_g`, `sets_lost_g`, `games_won_g`, `games_lost_g`, `games_ratio_g`, `sets_ratio_value_g`;
    - M+: `wins_m` (всегда 0, сравнение по абсолютам), `sets_won_m`, `sets_lost_m`, `games_won_m`, `games_lost_m`, `games_ratio_m`, `sets_ratio_value_m`;
    - служебное поле `points_by_round` для отладки.
  - использует **данные расписания King** (`group_data.rounds` + реальные `Match` и `MatchSet`) и точную привязку игрока:
    - участник группы → `team_id` → `team.player_1_id` → поиск игрока в любой паре и позиции матча.

- `compute_king_group_ranking(tournament, group_index, calculation_mode, group_data, stats, compute_stats_for_row)`
  - выполняет **ранжирование** внутри группы по `tournament.ruleset.ordering_priority`;
  - использует переданные агрегаты `stats` как базу;
  - пересчитывает статистику только для тай-брейков (мини-турниров: личные встречи, между собой и т.п.), вызывая `compute_stats_for_row` для подмножеств.

### 3.2. API `king_stats`

Ручка: `GET /tournaments/{id}/king_stats/` (`TournamentViewSet.king_stats`).

- Проверяет, что `tournament.system == KING`.
- Для каждой группы:
  - собирает `group_data` в формате, аналогичном `king_schedule`;
  - вызывает `_aggregate_for_king_group` и `compute_king_group_ranking`;
  - возвращает:

```jsonc
{
  "ok": true,
  "groups": {
    "1": {
      "stats": {
        "1": { "wins": 3, "wins_g": 2, "wins_m": 0, ... },
        "2": { ... },
        ...
      },
      "placements": {
        "1": 1,
        "2": 2,
        ...
      }
    },
    "2": { ... }
  }
}
```

Фронтенд использует эти агрегаты как базу для отображения и ранжирования.

## 4. Страница турнира Кинг (frontend)

Файл: `frontend/src/pages/KingPage.tsx`.

Главные элементы UX:

- верхняя часть — информация о турнире, выбор режима подсчёта G-/M+/NO, показывать ли полные имена;
- таблица группы:
  - строки A, B, C, ... соответствуют `row_index` (начинается с 1);
  - по столбцам — туры, затем служебные столбцы: G-/M+, Wins, Sets, Games, Ratio, Place;
  - для отдыхающих — серые ячейки;
  - для игроков, у которых в данном туре матч в статусе `live`, в ячейке показывается **красный кружок без текста**.
- справа от таблицы — расписание и плитки матчей.

### 4.1. Расписание слева

- Используется структура `groupData.rounds` из `king_schedule`.
- Текстовая форма: `A+B vs C+D` для каждого матча и тура.
- Буквы считаются так:
  - `participants[].player_id` → `row_index` → буква `A + (row_index - 1)`.
- Состояния:
  - `live` — зелёная подложка под текстом, не растягивающаяся вправо;
  - `completed` — зачёркнутый текст;
  - клик по строке матча открывает модалку действий по матчу (см. ниже).

### 4.2. Плитки матчей справа

- Данные берутся из тех же `groupData.rounds[].matches`.
- Состояния плитки:
  - `scheduled` — обычный фон, по центру `vs` или счёт;
  - `live` — зелёный фон, красный кружок + текст `идёт` вместо счёта;
  - `completed` — отображается итоговый счёт.
- Клик по плитке открывает ту же модалку действий по матчу, что и клик по строке расписания.

### 4.3. Ранжирование на фронте

Файл: `frontend/src/utils/kingRanking.ts`.

- `computeKingGroupRanking(...)` принимает:
  - `tournament`, `groupData`, `groupIndex`, `calculationMode`, `statsByRow` (агрегаты с бэка);
- логика:
  - для базовых критериев (wins, sets_ratio, games_ratio и т.п.) использует **готовые значения** из `statsByRow` с нужным суффиксом (`""`, `_g`, `_m`);
  - только при равенстве по текущему критерию строит мини-турнир между нужными строками и пересчитывает статистику для этого подмножества по данным king_schedule;
  - поддерживаются критерии и их head-to-head варианты: `wins`, `sets_fraction`, `games_ratio`, `games_diff`, `sets_diff`, `name_asc`, `<metric>_h2h`, `head_to_head`.

## 5. Ввод счёта и статусы матчей

### 5.1. Диалог действий по матчу (унифицированный с RR)

При клике по матчу (плитка или строка в расписании) открывается модалка `scoreDialog` с заголовком в зависимости от статуса:

- `scheduled` → «Матч не начат»;
- `live` → «Матч идёт»;
- `completed` → «Матч завершен».

Кнопки:

- **scheduled**:
  - «Начать матч» → `POST /tournaments/{id}/match_start/`;
  - «Ввести счёт» → открывает модалку `MatchScoreModal` для ввода/редактирования полного счёта.
- **live**:
  - «Отменить матч» → `POST /tournaments/{id}/match_cancel/`, переводит матч обратно в `scheduled`;
  - «Ввести счёт» → `MatchScoreModal`.
- **completed**:
  - «Ввести счёт» → редактирование существующего счёта;
  - «Удалить матч» → `POST /tournaments/{id}/match_delete_score/`, обнуляет статус и сеты (возврат в `scheduled`).

После любого изменения счёта/статуса:

- перезагружается турнир (`reload()` на фронте);
- повторно запрашивается `king_schedule`;
- таблица и расписание автоматически обновляются.

### 5.2. Сохранение полного счёта

Используется единая ручка:

- `POST /tournaments/{id}/match_save_score_full/`
  - очищает старые сеты матча;
  - создаёт новые `MatchSet` с учётом тай-брейков и формата `set_format`;
  - рассчитывает победителя по сетам и проставляет `winner`, `finished_at`, `status = completed`.

## 6. Пересчёт рейтинга

При завершении турнира (кнопка «Завершить турнир» на странице King):

- вызывается `POST /tournaments/{id}/complete/` (`TournamentViewSet.complete`);
- бекенд:
  - переводит турнир в статус `COMPLETED`;
  - вызывает `compute_ratings_for_tournament(tournament.id)` из `apps.players.services.rating_service`.

Таким образом, турниры системы Кинг **участвуют в расчёте рейтинга** наравне с другими системами (при условии, что `Tournament.is_rating_calc` и коэффициент рейтинга настроены соответствующим образом).

## 7. Экспорт таблицы («Поделиться»)

На странице King есть кнопка «Поделиться», которая делает экспорт всей таблицы и расписания в PNG‑файл.

Технически:

- используется `html2canvas` с `scale = 2` для повышения чёткости;
- элементы с `data-export-exclude="true"` временно скрываются, а с `data-export-only="true"` — показываются;
- по завершении всё возвращается в исходное состояние.

Имя файла экспорта:

- `beachplay_tournament_<ID>.png` (полностью унифицировано с круговой системой).

Футер экспортируемого изображения:

- левый текст: `BeachPlay.ru`;
- правый текст: `всегда онлайн!`.

## 8. Устаревшие документы и артефакты

Исторически для Кинг использовались отдельные планы/черновики (`KING_IMPLEMENTATION_PLAN.md`, старый `KingPage_old.tsx` и пр.).

Актуальным источником правды по реализации является **данный файл** и фактический код:

- `apps/tournaments/services/king_stats.py`
- `apps/tournaments/api_views.py` (эндпоинты `king_schedule`, `king_stats`, `set_king_calculation_mode`, `match_*`)
- `frontend/src/pages/KingPage.tsx`
- `frontend/src/utils/kingRanking.ts`.

Старые документы-планы могут быть удалены, как только информация из них либо перенесена сюда, либо признана неактуальной.

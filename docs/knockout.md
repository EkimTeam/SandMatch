# ТЗ: Олимпийская система (Single Elimination) для BeachPlay

Дата: 2025-09-22
Ответственный: команда BeachPlay
Стек: Django (Python 3.11+), PostgreSQL 14, Docker + docker-compose, DRF, SPA на Vite + React 18 + TypeScript (страница `frontend/src/pages/KnockoutPage.tsx`).

## Цели

- Реализовать отображение и проведение турниров по олимпийской системе.
- Поддержать посев, BYE, W/O, RET, DEF, матч за 3‑е место.
- Масштабируемая сетка 8–128+ участников с удобным UX на десктопе и мобиле.
- Автопродвижение победителей по сетке. Экспорт в печать/PNG.

Примеры‑референсы: championat.com (статичный эталон), rttf.ru (реальный вид), itftennis.com (динамика и большие сетки).

## Модель данных (дополнения)

Используем существующие `apps/matches/models.py` и метаданные сетки/сервисы в `apps/tournaments/`.

### Сущности

- KnockoutBracket
  - `tournament: FK(Tournament)`
  - `index: smallint` (1..N)
  - `size: smallint` (8/16/32/64/128)
  - `has_third_place: bool`
  - `created_at`
  - Уникальность `(tournament, index)`

- DrawPosition
  - `bracket: FK(KnockoutBracket)`
  - `position: smallint` (1..size)
  - `entry: FK(TournamentEntry, null=True)`
  - `seed: smallint, null=True`
  - `source: char(8)` — `MAIN|LL|WC|Q|BYE`
  - Уникальность `(bracket, position)`

- Изменения в `matches.Match`
  - `bracket: FK(KnockoutBracket, null=True, related_name="matches")`
  - `is_third_place: bool = False`
  - Индексы по `(tournament, stage, bracket, round_index, order_in_round)`

## Бизнес‑правила

- Размер сетки — ближайшая степень 2 ≥ числу участников. BYE = size − N.
- Посев: классическая схема размещения сидов (1/2 по концам; 3/4 по четвертям; 5–8 по восьмушкам и т.д.). Непосеянные — случайная жеребьёвка оставшихся слотов.
- Продвижение: победитель матча (`round_index=r`, `order=k`) попадает в матч `r+1`, `order=ceil(k/2)`, слот 1/2 по чётности `k`.
- Матч за 3‑е: между проигравшими полуфиналов; не влияет на финал.
- Особые исходы:
  - W/O (walkover): победитель без игры, статус W/O, автопродвижение.
  - RET (retired), DEF (default): детали в `MatchSpecialOutcome`, автопродвижение.
- Счёт валидируется по `tournaments.SetFormat` (сеты, тай‑брейки, решающий TB).

## Сервисы (apps/tournaments/services/knockout.py)

- `generate_brackets(tournament, participants, brackets_count, seeds=None, has_third_place=True) -> list[KnockoutBracket]`
  - Расчёт размера сетки, распределение по `brackets_count`, создание `DrawPosition`.
  - Построение первого раунда и пустых матчей всех последующих раундов до финала, плюс опционально матч за 3‑е.
  - BYE оформляются как автопобеды и сразу продвигаются.
  - Всё в транзакции.

- `progress_winner(match) -> None`
  - Находит целевой матч следующего раунда и заполняет соответствующий слот.
  - Для полуфиналов при `has_third_place` — записывает проигравшего в матч за 3‑е.
  - Обновляет статусы матчей.

- «Сид‑карты» для 8/16/32/64/128 — заготовленные массивы размещения.

## API/URLs (DRF)

- Создание турнира олимпиской системы:
  - `POST /api/tournaments/new_knockout/`
  - Тело:
    ```json
    {
      "name": "Кубок Осени",
      "date": "2025-10-10",
      "system": "knockout",
      "participant_mode": "singles" | "doubles",
      "set_format_id": 1,
      "ruleset_id": 1,
      "brackets_count": 1
    }
    ```

- Создание сетки для турнира (если ещё не создана):
  - `POST /api/tournaments/<id>/create_knockout_bracket/`
  - Тело: `{ "size": 16, "has_third_place": true }`
  - Ответ: `{ ok, bracket: { id, index, size, has_third_place }, matches_created }`

- Посев участников в сетку автоматически:
  - `POST /api/tournaments/<id>/seed_bracket/`
  - Тело: `{ "bracket_id": <id> }`
  - Ответ: `{ ok: true }`

- Получение данных для отрисовки сетки (со связями между матчами):
  - `GET /api/tournaments/<id>/brackets/<bid>/draw/`
  - Возвращает структуру раундов и матчей с информацией о соединениях.

- Сохранение полного счёта матча (все сеты):
  - `POST /api/tournaments/<id>/match_save_score_full/`
  - Тело:
    ```json
    {
      "match_id": 123,
      "sets": [
        { "index": 1, "games_1": 6, "games_2": 4 },
        { "index": 2, "games_1": 7, "games_2": 6, "tb_1": 7, "tb_2": 5 }
      ]
    }
    ```
  - При сохранении победитель автоматически продвигается в следующий раунд.

- Завершить турнир (и запустить расчёт рейтинга):
  - `POST /api/tournaments/<id>/complete/`
  - Идемпотентно: повторный вызов заблокирован, если расчёт уже выполнен.

Безопасность: все изменяющие действия — в транзакциях; при записи счёта по матчу используется блокировка строки (`SELECT ... FOR UPDATE`).

## Фронтенд (SPA)

- Страница: `frontend/src/pages/KnockoutPage.tsx` (React).
- Источники данных: `tournamentApi.getBracketDraw`, `tournamentApi.getById`.
- Ввод счёта: единая модалка `frontend/src/components/MatchScoreModal.tsx` с поддержкой нескольких сетов/TB и вызовом `POST /api/tournaments/{id}/match_save_score_full/`.
- Логика загрузки/перерисовки: после сохранения счёта вызывается `loadDraw()` для обновления сетки.
- Экспорт: html2canvas → PNG, доступно с кнопки «Поделиться».

## План работ

1) Сервис `generate_brackets` + JSON сериализация + базовый рендер в `knockout.html` (инлайновый JS).
2) Ввод счёта (`POST /matches/<id>/score/`), `progress_winner`, матч за 3‑е, W/O/RET/DEF.
3) UX/визуал: подсветки, мобильный режим, экспорт.
4) Admin: action «Сгенерировать сетку (Олимпийская)» и management‑команда `generate_knockout`.
5) Производительность: lazy‑рендер колонок для 64/128.
6) Тесты: юнит‑тесты генератора/прогресса/особых исходов; e2e сценарии.

## Критерии приёмки

- Корректная генерация посева и BYE для N участников, сетки 8–128.
- Автопродвижение победителей и заполнение матча за 3‑е.
- Особые исходы корректно учитываются и двигают сетку.
- Интерфейс отзывчив, большие сетки рендерятся без заметных лагов.
- Экспорт в печать/PNG читабелен.

## Зависимости/риски

- Сложность регламентов — ограничить пресетами `Ruleset` (ITF‑подобный порядок тай‑брейков и H2H).
- Производительность DOM — при 64/128+ использовать ленивую отрисовку колонок.
- Кроссбраузерность html2canvas — тестировать на популярных браузерах.

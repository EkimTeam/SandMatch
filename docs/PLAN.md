# План разработки SandMatch (MVP0 → MVP1)

Документ основан на `D:\Техническое Задание SandMatch.txt` и `D:\Подробный план реализации SandMatch.txt`.

## Архитектура и стек

- Бэкенд: Django (Python 3.11+), Django Admin
- БД: PostgreSQL 14+
- Фронтенд: Django Templates, Bootstrap 5, нативный JS
- Контейнеризация: Docker + docker-compose (MVP0)
- Веб‑сервер (MVP1): Nginx + Gunicorn
- Логи/мониторинг (MVP1): Yandex Cloud Monitoring/Logs, Sentry (опц.)
- Секреты: .env локально; GitHub Secrets + YC Lockbox на прод
- Статика/медиа (MVP1): YC Object Storage (S3)

## Модель данных (базовая)

- players.Player: name, timestamps
- teams.Team: player_1, player_2 (уникальность состава)
- tournaments.Tournament: name, date, status, type, groups_count, set_format, ruleset, planned_participants
- tournaments.TournamentEntry: tournament, team, is_out_of_competition
- matches.Match: tournament, round_name, order_in_round, team_1, team_2, winner
- matches.MatchSet: match, score1, score2, tie_break
- tournaments.Ruleset, tournaments.SetFormat — справочники

## Ключевая логика

- Круговая система: генерация расписания, ввод счёта, сортировка по регламенту
- Олимпийская система: сетка, ввод счёта, авто‑продвижение победителя, матч за 3‑е место
- История: список завершенных, детали, история игрока
- Экспорт результатов: html шаблон + html2canvas → PNG
- Завершение турнира: статус completed, пересчет рейтинга (синхронно в MVP)

## Что уже сделано (MVP0, текущий этап)

- UI: навигация (`Турниры`, `Игроки`, `Статистика`), адаптивный базовый шаблон и логотип.
- Страница `Турниры`: активные и история, модальное окно «Начать новый турнир» с валидацией для круговой.
- Страница турнира: пустые таблицы по группам и «порядок игр», переключатели колонок.
- Действия турнира: «Завершить», «Удалить», «Поделиться» (заглушка).
- Admin action: «Сгенерировать расписание (круговая)» и команда `generate_round_robin`.
- Пресеты: команды `seed_rulesets`, `reset_presets`.

## Ближайшие задачи

- UI добавления участников/команд в турнир; распределение по группам.
- Кнопка «Сгенерировать расписание» на странице турнира (без админки).
- Ввод результатов матча (сеты/тай‑брейки) с валидацией по `SetFormat`.
- Подсчёт таблицы группы и сортировка по `Ruleset` (wins, h2h, ratios).
- Экспорт/«Поделиться»: печатная версия и PNG.

## MVP1 (Yandex Cloud)

- ВМ, Managed PostgreSQL, Object Storage, домен/SSL
- Контейнеры: web + nginx + миграции; Gunicorn
- CI/CD: GitHub Actions (lint/test/build/push/deploy)
- Мониторинг/логи, бэкапы, политика секретов
- Критерии готовности:
  - Доступ по HTTPS, деплой без простоя
  - Бэкапы протестированы, базовые алерты

## Риски

- Сложность регламентов — ограничить пресетами в MVP
- Производительность больших таблиц — индексы, пагинация
- Кроссбраузерность html2canvas — тест на популярных браузерах

## Следующие шаги

- Реализация моделей и CRUD
- Генерация таблиц/сеток, ввод счетов
- История и экспорт результатов

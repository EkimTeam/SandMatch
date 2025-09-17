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
- tournaments.Tournament: name, date, status, type, groups_count, set_format, ruleset
- tournaments.TournamentTeam: tournament, team, is_out_of_rating
- matches.Match: tournament, round/group, team_1, team_2, score_1/2, tiebreak_1/2, winner
- rules.Ruleset (база для будущего конструктора регламента)

## Ключевая логика

- Круговая система: генерация расписания, ввод счета, сортировка по регламенту
- Олимпийская система: генерация сетки, ввод счета, авто‑продвижение победителя, матч за 3‑е место
- История: список завершенных, детали, история игрока
- Экспорт результатов: html шаблон + html2canvas → PNG
- Завершение турнира: статус completed, пересчет рейтинга (синхронно в MVP)

## MVP0 (локально, Docker)

- Инициализация Django‑проекта (этот репозиторий)
- PostgreSQL через docker‑compose
- Базовые страницы и админка
- Тесты (pytest)
- Критерии готовности:
  - Все FR основной логики работают локально
  - Проект запускается `docker compose up`
  - 20–30 автотестов на ключевые сценарии

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

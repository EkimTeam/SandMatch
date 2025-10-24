# План улучшений CI/CD и локальной разработки

## 1) Критические задачи (прод)
- Nginx: хранить актуальную конфигурацию в репозитории (`nginx/beachplay.conf`), проверять и перезагружать в `deploy/deploy.sh`.
- Статика: в деплое валидировать `static/frontend/manifest.json` и наличие основных ассетов (CSS/JS), логировать расхождения.
- CSP: включать только в проде (`settings/prod.py`), в локали отключать middleware CSP (в `settings/local.py`).
- Health checks: базовый `/api/health/` и расширенный вывод (manifest_exists, entries_count) для staff.
- Логи деплоя: больше диагностики по статике и ответам HTTPS, явные сообщения об ошибках.

## 2) Локальная разработка (DX)
- Добавить `docker-compose.override.yml`:
  - сервис `db` (PostgreSQL) для локали;
  - `web` с volume `.:/app` (горячая перезагрузка Django) и запуском `runserver`.
- Обновить `settings/local.py`:
  - отключить CSP middleware;
  - использовать `POSTGRES_HOST=db` по умолчанию.
- Документация:
  - `docs/LOCAL_DEVELOPMENT.md` — единый гайд по запуску локально;
  - `docs/TROUBLESHOOTING.md` — чеклист диагностики (статика, Nginx, CSP, manifest).
- Утилиты:
  - Makefile с целями `dev`, `migrate`, `logs`, `format` (опционально).

## 3) CI ( `.github/workflows/ci.yml` )
- Проверка Vite build-артефактов (наличие `frontend/dist/manifest.json`).
- Линт фронта неблокирующий (уже так), бэкенд линт — по согласованию.
- Включить кэш npm после стабилизации.

## 4) CD ( `.github/workflows/cd.yml` + `deploy/deploy.sh` )
- Сборка и push образа (есть), автодеплой по SSH (есть).
- Перед стартом:
  - резервный `dumpdata` БД;
  - миграции с откатом при неуспехе (есть);
  - `collectstatic` (есть).
- После старта:
  - smoke‑тесты API (есть);
  - проверка статики по HTTPS (расширить проверкой manifest JSON);
  - проверка главной страницы.

## 5) Политика окружений
- Прод: `docker-compose.prod.yml` + Nginx на VM.
- Локаль: `docker-compose.yml` + `docker-compose.override.yml` (не коммитить чувствительные `.env`).
- Для просмотра данных как на проде — только read‑only доступ или выгрузка маскированных данных.

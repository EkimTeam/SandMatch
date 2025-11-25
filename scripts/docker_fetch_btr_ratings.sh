#!/bin/bash
# Скрипт для запуска импорта BTR-рейтингов через Docker Compose
# Предназначен для запуска по cron на хосте с Docker

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

echo "[$TIMESTAMP] Запуск импорта BTR-рейтингов через Docker..."

cd "$PROJECT_DIR"

# Запускаем команду в контейнере
docker compose exec -T web python manage.py fetch_btr_ratings

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo "[$TIMESTAMP] ✓ Импорт завершён успешно"
else
    echo "[$TIMESTAMP] ✗ Импорт завершён с ошибкой (код: $EXIT_CODE)"
fi

exit $EXIT_CODE

#!/bin/bash
# Скрипт для автоматического скачивания и импорта BTR-рейтингов
# Предназначен для запуска по cron

set -e  # Остановить выполнение при ошибке

# Настройки
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="/var/log"
LOG_FILE="$LOG_DIR/btr_import.log"
TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S')

# Функция логирования
log() {
    echo "[$TIMESTAMP] $1" | tee -a "$LOG_FILE"
}

# Создаём директорию для логов, если её нет
mkdir -p "$LOG_DIR"

log "=========================================="
log "Начало импорта BTR-рейтингов"
log "=========================================="

# Переходим в директорию проекта
cd "$PROJECT_DIR"

# Активируем виртуальное окружение (если используется)
if [ -f "venv/bin/activate" ]; then
    log "Активация виртуального окружения..."
    source venv/bin/activate
fi

# Загружаем переменные окружения
if [ -f ".env" ]; then
    log "Загрузка переменных окружения..."
    export $(grep -v '^#' .env | xargs)
fi

# Запускаем команду импорта
log "Запуск команды fetch_btr_ratings..."
python manage.py fetch_btr_ratings 2>&1 | tee -a "$LOG_FILE"

EXIT_CODE=${PIPESTATUS[0]}

if [ $EXIT_CODE -eq 0 ]; then
    log "✓ Импорт завершён успешно"
else
    log "✗ Импорт завершён с ошибкой (код: $EXIT_CODE)"
fi

log "=========================================="
log "Конец импорта BTR-рейтингов"
log "=========================================="
log ""

exit $EXIT_CODE

# Руководство по Rollback в SandMatch

## Дата создания: 2025-10-21

---

## 🔄 Автоматический Rollback

При деплое новой версии система автоматически:

1. **Сохраняет текущую версию** в файл `.previous_image_tag`
2. **Деплоит новую версию**
3. **Проверяет health check** (до 60 секунд)
4. **Автоматически откатывается** если health check падает

### Пример автоматического отката

```bash
[deploy] Using image: ghcr.io/ekimteam/sandmatch/web:main-abc123
[deploy] Saved current version for rollback: main-xyz789
[deploy] Starting containers...
[deploy] Smoke check...
[deploy] ERROR: Health check failed after 60s
[deploy] Auto-rollback triggered due to health check failure
[deploy] ROLLBACK: Starting rollback to previous version...
[deploy] Rolling back to: ghcr.io/ekimteam/sandmatch/web:main-xyz789
[deploy] Rollback completed successfully
```

---

## 🛠️ Ручной Rollback

### Откат на предыдущую версию

```bash
cd /opt/sandmatch/app
./deploy/deploy.sh rollback
```

### Что происходит при ручном откате:

1. Читается тег из `.previous_image_tag`
2. Скачивается предыдущий образ
3. Перезапускаются контейнеры
4. Проверяется health check

---

## 📋 Проверка доступных версий

### Посмотреть текущую версию

```bash
docker compose -f docker-compose.prod.yml images web
```

### Посмотреть сохранённую версию для отката

```bash
cat /opt/sandmatch/app/.previous_image_tag
```

### Посмотреть доступные образы в GHCR

```bash
# Через GitHub Container Registry UI
https://github.com/orgs/EkimTeam/packages/container/sandmatch%2Fweb/versions

# Или через docker
docker images | grep sandmatch
```

---

## 🚨 Сценарии использования

### Сценарий 1: Деплой сломал приложение

**Проблема:** После деплоя приложение не работает

**Решение:**
```bash
# Автоматический откат уже должен был сработать
# Если нет - откатить вручную
./deploy/deploy.sh rollback
```

---

### Сценарий 2: Обнаружена критическая ошибка через час после деплоя

**Проблема:** Health check проходит, но есть баг в бизнес-логике

**Решение:**
```bash
# Ручной откат на предыдущую версию
./deploy/deploy.sh rollback

# Проверить что всё работает
curl http://localhost:8000/api/health/
```

---

### Сценарий 3: Нужно откатиться на конкретную версию (не предыдущую)

**Проблема:** Нужна версия старше чем предыдущая

**Решение:**
```bash
# Вручную указать нужный тег
export WEB_IMAGE="ghcr.io/ekimteam/sandmatch/web"
export WEB_IMAGE_TAG="main-старый-sha"

# Запустить деплой с этим тегом
./deploy/deploy.sh
```

---

### Сценарий 4: Файл .previous_image_tag потерян

**Проблема:** Не можем откатиться автоматически

**Решение:**
```bash
# Посмотреть доступные образы
docker images | grep sandmatch

# Вручную задеплоить нужную версию
export WEB_IMAGE_TAG="нужный-тег"
./deploy/deploy.sh
```

---

## 🔍 Health Check

Health check проверяет:

### 1. Django работает
```bash
curl http://localhost:8000/api/health/
```

Ответ:
```json
{
  "ok": true,
  "status": "healthy",
  "checks": {
    "django": true,
    "database": true,
    "frontend_assets": true
  }
}
```

### 2. База данных доступна
- Выполняется `SELECT 1` в БД
- Если БД недоступна → `"database": false` → откат

### 3. Frontend ассеты на месте
- Проверяется наличие `/app/staticfiles/frontend/manifest.json`
- Не критично, но логируется

---

## ⚙️ Настройка

### Изменить таймаут health check

В `deploy/deploy.sh`:
```bash
MAX_ATTEMPTS=30  # Количество попыток (по умолчанию 30)
SLEEP_SECS=2     # Интервал между попытками (по умолчанию 2 сек)
# Итого: 30 * 2 = 60 секунд
```

### Отключить автоматический откат

Закомментировать в `deploy/deploy.sh`:
```bash
# Auto-rollback on health check failure
# if [ -f "$PREVIOUS_TAG_FILE" ]; then
#   log "Auto-rollback triggered due to health check failure"
#   rollback
# else
#   log "No previous version available for rollback"
#   exit 1
# fi
```

---

## 📊 Мониторинг

### Логи деплоя

```bash
# Последние 100 строк логов web сервиса
docker compose -f docker-compose.prod.yml logs --tail=100 web

# Следить за логами в реальном времени
docker compose -f docker-compose.prod.yml logs -f web
```

### Статус контейнеров

```bash
docker compose -f docker-compose.prod.yml ps
```

### Health check вручную

```bash
# Простая проверка
curl http://localhost:8000/api/health/

# С деталями
curl -s http://localhost:8000/api/health/ | jq
```

---

## 🎯 Best Practices

1. **Всегда проверяйте health check** после деплоя вручную
2. **Мониторьте логи** первые 5-10 минут после деплоя
3. **Тестируйте на staging** перед продакшеном (когда будет)
4. **Сохраняйте теги** важных стабильных версий
5. **Документируйте** что изменилось в каждом релизе

---

## 🆘 Troubleshooting

### Проблема: Откат не работает

**Причина:** Файл `.previous_image_tag` не существует

**Решение:**
```bash
# Создать файл вручную с нужным тегом
echo "main-известный-стабильный-sha" > /opt/sandmatch/app/.previous_image_tag

# Попробовать откат снова
./deploy/deploy.sh rollback
```

---

### Проблема: Health check всегда падает

**Причина:** БД недоступна или другая проблема

**Решение:**
```bash
# Проверить БД
docker compose -f docker-compose.prod.yml exec web python manage.py dbshell

# Проверить переменные окружения
docker compose -f docker-compose.prod.yml exec web env | grep POSTGRES

# Посмотреть детальные логи
docker compose -f docker-compose.prod.yml logs web
```

---

### Проблема: Контейнер не запускается после отката

**Причина:** Проблема с образом или конфигурацией

**Решение:**
```bash
# Пересобрать образ
docker compose -f docker-compose.prod.yml build --no-cache

# Очистить старые образы
docker image prune -a

# Попробовать снова
./deploy/deploy.sh
```

---

## 📝 Чеклист перед деплоем

- [ ] Протестировано локально
- [ ] Все тесты проходят в CI
- [ ] Миграции БД проверены
- [ ] Frontend собирается без ошибок
- [ ] Известен тег текущей стабильной версии (на случай ручного отката)
- [ ] Мониторинг готов (логи, метрики)

---

## 🚀 Быстрая справка

```bash
# Деплой новой версии
./deploy/deploy.sh

# Откат на предыдущую
./deploy/deploy.sh rollback

# Проверка health
curl http://localhost:8000/api/health/

# Логи
docker compose -f docker-compose.prod.yml logs -f web

# Статус
docker compose -f docker-compose.prod.yml ps
```

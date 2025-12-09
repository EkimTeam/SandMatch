# Обновление deploy.sh для Celery

## Проблема
CI/CD скрипт `deploy/deploy.sh` запускал только контейнер `web`, а не все сервисы (redis, celery, celery-beat).

## Что исправлено

### 1. Pulling образов
**Было:**
```bash
docker compose pull web
```

**Стало:**
```bash
docker compose pull web celery celery-beat
```

### 2. Запуск контейнеров
**Было:**
```bash
docker compose up -d web
```

**Стало:**
```bash
docker compose up -d
```

Теперь запускаются **все** сервисы из `docker-compose.prod.yml`:
- redis
- web
- celery
- celery-beat

### 3. Проверка Celery
Добавлена проверка статуса Celery сервисов после основного health check.

### 4. Финальный отчёт
Добавлен вывод статуса всех контейнеров в конце деплоя.

## Как применить

### 1. Закоммитить изменения

```bash
git add deploy/deploy.sh docker-compose.prod.yml
git commit -m "fix: deploy script now starts all services including Celery"
git push origin main
```

### 2. Деплой произойдёт автоматически

GitHub Actions запустит обновлённый скрипт, который теперь:
1. ✅ Скачает образы для web, celery, celery-beat
2. ✅ Запустит все 4 контейнера (redis, web, celery, celery-beat)
3. ✅ Проверит статус Celery
4. ✅ Покажет статус всех контейнеров

### 3. Проверка после деплоя

На VM выполни:

```bash
cd /opt/sandmatch/app
docker compose ps
```

Должно быть **4 контейнера Up**:
```
NAME                IMAGE                                    STATUS
app-celery-1        ghcr.io/ekimteam/sandmatch/web:latest   Up
app-celery-beat-1   ghcr.io/ekimteam/sandmatch/web:latest   Up
app-redis-1         redis:7-alpine                           Up
app-web-1           ghcr.io/ekimteam/sandmatch/web:latest   Up
```

## Что изменилось в процессе деплоя

### До исправления:
```
[deploy] Pulling image...
[deploy] Starting containers...
[deploy] docker compose up -d web
✅ Запущен только web
❌ Celery не запущен
❌ Celery-beat не запущен
```

### После исправления:
```
[deploy] Pulling images...
[deploy] Starting all containers...
[deploy] docker compose up -d
✅ Запущен web
✅ Запущен redis
✅ Запущен celery
✅ Запущен celery-beat
[deploy] Checking Celery...
[deploy] 📦 Container status:
SERVICE       STATUS
redis         Up
web           Up
celery        Up
celery-beat   Up
```

## Ручной запуск (если нужно)

Если хочешь запустить деплой вручную на VM:

```bash
cd /opt/sandmatch/app
bash deploy/deploy.sh
```

Скрипт теперь автоматически запустит все сервисы.

## Мониторинг Celery

После деплоя проверь логи:

```bash
# Все логи
docker compose -f docker-compose.prod.yml logs -f

# Только Celery
docker compose -f docker-compose.prod.yml logs -f celery celery-beat

# Проверка активных задач
docker compose -f docker-compose.prod.yml exec celery celery -A sandmatch inspect active
```

## Rollback (если нужно)

Если что-то пошло не так:

```bash
cd /opt/sandmatch/app
git log --oneline -5
git reset --hard <previous-commit>
bash deploy/deploy.sh
```

## Итоговый чеклист

- [x] Исправлен `deploy/deploy.sh` — запуск всех сервисов
- [x] Обновлён `docker-compose.prod.yml` — добавлены Celery сервисы
- [x] Добавлена проверка Celery в deploy скрипт
- [x] Добавлен вывод статуса контейнеров
- [ ] Закоммитить и запушить
- [ ] Дождаться завершения CI/CD
- [ ] Проверить `docker compose ps` на VM
- [ ] Проверить логи Celery
- [ ] Всё работает! 🎉

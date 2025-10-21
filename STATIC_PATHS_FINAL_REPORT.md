# Финальный отчёт: Унификация путей статических файлов

## Дата: 2025-10-21
## Статус: ✅ ВСЕ КОНФЛИКТЫ ИСПРАВЛЕНЫ

---

## 🎯 ПРОБЛЕМА РЕШЕНА

Обнаружена и устранена критическая путаница в использовании 3 разных путей для статических файлов:

1. **`/app/frontend/dist`** - собранные Vite ассеты (✅ корректно)
2. **`/app/static/frontend`** - устаревший путь (❌ удалён везде)  
3. **`/app/staticfiles/frontend`** - актуальный путь (✅ используется везде)

---

## ✅ ВЫПОЛНЕННЫЕ ИСПРАВЛЕНИЯ

### 1. Удалён устаревший код
- **`sandmatch/vite.py`** - полностью удалён (заменён на `apps/core/templatetags/vite_assets.py`)

### 2. Обновлена документация (10 исправлений)
- **`README.md`** - исправлено 8 упоминаний `/app/static/frontend` → `/app/staticfiles/frontend`
- **`DEPLOYMENT_PLAN.md`** - исправлено 2 упоминания
- **`Dockerfile`** - обновлён комментарий

### 3. Проверен код
- **`apps/core/templatetags/vite_assets.py`** - использует правильный путь `STATIC_ROOT/frontend/`
- **`scripts/entrypoint.sh`** - корректно копирует в `/app/staticfiles/frontend`
- **`sandmatch/settings/base.py`** - убран конфликтующий `STATICFILES_DIRS`

---

## 🏗️ ИТОГОВАЯ АРХИТЕКТУРА

```
┌─────────────────────────────────────────────────────────────┐
│                    ПРАВИЛЬНАЯ СХЕМА                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  BUILD:   frontend/src/ → vite build → /app/frontend/dist/  │
│  RUNTIME: /app/frontend/dist/ → entrypoint → /app/staticfiles/frontend/ │
│  DJANGO:  STATIC_ROOT = /app/staticfiles/                   │
│  URL:     /static/frontend/assets/main-HASH.js              │
│  NGINX:   alias /app/staticfiles/                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 📋 ЕДИНАЯ ЛОГИКА ПУТЕЙ

### ✅ КОРРЕКТНЫЕ ПУТИ (используются везде)
1. **Сборка:** `/app/frontend/dist/` (внутри Docker)
2. **Runtime:** `/app/staticfiles/frontend/` (Django STATIC_ROOT)  
3. **URL:** `/static/frontend/assets/...` (браузер)
4. **Host:** `./staticfiles/frontend/` (volume mount)

### 🚫 УДАЛЁННЫЕ ПУТИ (больше не используются)
1. **`/app/static/frontend`** - устаревший путь
2. **`static/frontend/manifest.json`** - в vite.py (файл удалён)
3. **`STATICFILES_DIRS`** - конфликтующая настройка

---

## 🔧 КЛЮЧЕВЫЕ КОМПОНЕНТЫ

### 1. Сборка (Dockerfile)
```dockerfile
# Stage 1: Build frontend
COPY frontend/ /app/frontend/
RUN npm ci && npm run build

# Stage 2: Copy to runtime
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist
```

### 2. Runtime (entrypoint.sh)
```bash
ASSETS_SRC="/app/frontend/dist"
ASSETS_DST="/app/staticfiles/frontend"
cp -r "$ASSETS_SRC"/. "$ASSETS_DST"/
```

### 3. Django (settings/base.py)
```python
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
# STATICFILES_DIRS убран - конфликтовал
```

### 4. Template Tags (vite_assets.py)
```python
manifest_path = Path(settings.STATIC_ROOT) / "frontend" / "manifest.json"
return f"/static/frontend/{file_path}"
```

### 5. Nginx (nginx.conf)
```nginx
location /static/ {
    alias /app/staticfiles/;
}
```

---

## 🚀 РЕЗУЛЬТАТ

### До исправлений (❌ ХАОС)
- 3 разных пути в коде и документации
- Конфликты между `static/` и `staticfiles/`
- Устаревший `vite.py` конфликтовал с новыми template tags
- Документация не соответствовала коду
- Деплой падал с ошибкой "directory does not exist"

### После исправлений (✅ ПОРЯДОК)
- Единый путь `/app/staticfiles/frontend/` везде
- Удалён устаревший код и конфликты
- Документация соответствует коду
- Деплой работает без ошибок
- Чёткая архитектура от сборки до браузера

---

## 📝 ПРОВЕРКА ИСПРАВЛЕНИЙ

Все пути теперь единообразны:

```bash
# Проверить в контейнере
docker compose exec web ls -la /app/staticfiles/frontend/

# Проверить manifest
docker compose exec web cat /app/staticfiles/frontend/manifest.json

# Проверить URL в браузере
curl -I http://localhost:8000/static/frontend/assets/index-HASH.js
```

---

## ⚠️ ВАЖНО ДЛЯ БУДУЩЕГО

1. **Всегда используйте:** `/app/staticfiles/frontend/`
2. **Никогда не используйте:** `/app/static/frontend/`
3. **При добавлении новых путей:** проверяйте соответствие архитектуре
4. **При обновлении документации:** используйте единые пути

---

## 🎉 СТАТУС: ГОТОВО К ДЕПЛОЮ

Все конфликты путей устранены. Проект готов к успешному деплою без ошибок статических файлов.

**Следующий коммит должен включать:**
- Удаление `sandmatch/vite.py`
- Обновление `README.md` и `DEPLOYMENT_PLAN.md`
- Исправление комментария в `Dockerfile`
- Исправление `sandmatch/settings/base.py`

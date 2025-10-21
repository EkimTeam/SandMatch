# Анализ путей статических файлов в SandMatch

## Дата: 2025-10-21
## Статус: КРИТИЧЕСКИЕ КОНФЛИКТЫ ОБНАРУЖЕНЫ

---

## 🚨 ПРОБЛЕМА: Три разных пути используются непоследовательно

### 1. `/app/frontend/dist` (✅ Корректно)
**Назначение:** Собранные Vite ассеты внутри Docker образа  
**Используется в:**
- `Dockerfile` - копирование из builder stage
- `scripts/entrypoint.sh` - источник для копирования (ASSETS_SRC)

### 2. `/app/static/frontend` (❌ УСТАРЕВШИЙ)
**Назначение:** Старый путь для frontend ассетов  
**Проблемы:** Используется в документации, но НЕ в коде  
**Найдено в:**
- `README.md` (8 упоминаний)
- `DEPLOYMENT_PLAN.md` (2 упоминания)
- `sandmatch/vite.py` (устаревший файл)
- `Dockerfile` (комментарий)

### 3. `/app/staticfiles/frontend` (✅ ТЕКУЩИЙ)
**Назначение:** Актуальный путь для Django STATIC_ROOT  
**Используется в:**
- `scripts/entrypoint.sh` (ASSETS_DST)
- `apps/core/templatetags/vite_assets.py`
- `docker-compose.prod.yml` (volume mount)
- `deploy/deploy.sh` (очистка)

---

## 🔧 ПЛАН ИСПРАВЛЕНИЙ

### Шаг 1: Унифицировать логику (КРИТИЧНО)
- Везде использовать `/app/staticfiles/frontend`
- Убрать упоминания `/app/static/frontend`
- Обновить всю документацию

### Шаг 2: Исправить конфликты в коде
- Удалить `sandmatch/vite.py` (устаревший)
- Обновить комментарии в `Dockerfile`
- Проверить все template tags

### Шаг 3: Обновить документацию
- `README.md` - исправить все пути
- `DEPLOYMENT_PLAN.md` - обновить схему
- `LOCAL_SETUP.md` - проверить инструкции

---

## 📋 ДЕТАЛЬНЫЕ КОНФЛИКТЫ

### README.md (8 конфликтов)
```
❌ /app/static/frontend (строки 48, 55, 78, 135, 150, 162, 163)
✅ Должно быть: /app/staticfiles/frontend
```

### DEPLOYMENT_PLAN.md (2 конфликта)
```
❌ /app/static/frontend (строки 6, 7)
✅ Должно быть: /app/staticfiles/frontend
```

### sandmatch/vite.py (УДАЛИТЬ)
```
❌ Устаревший файл с логикой static/frontend/manifest.json
✅ Заменён на apps/core/templatetags/vite_assets.py
```

### Dockerfile (1 конфликт)
```
❌ Комментарий упоминает /app/static/frontend (строка 26)
✅ Обновить комментарий
```

---

## 🎯 ПРАВИЛЬНАЯ АРХИТЕКТУРА

```
┌─────────────────────────────────────────────────────────────┐
│                    DOCKER CONTAINER                         │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. BUILD STAGE:                                           │
│     frontend/src/ → vite build → /app/frontend/dist/       │
│                                                             │
│  2. RUNTIME STAGE:                                         │
│     /app/frontend/dist/ → entrypoint.sh → /app/staticfiles/frontend/ │
│                                                             │
│  3. DJANGO SERVING:                                        │
│     STATIC_ROOT = /app/staticfiles                         │
│     URL: /static/frontend/assets/main-HASH.js              │
│                                                             │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                      HOST MACHINE                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  PRODUCTION:                                               │
│  ./staticfiles/ ← volume mount ← /app/staticfiles/         │
│                                                             │
│  NGINX:                                                    │
│  /static/ → alias /app/staticfiles/                        │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

---

## ✅ КОРРЕКТНЫЕ ПУТИ (использовать везде)

1. **Сборка:** `/app/frontend/dist/` (внутри Docker)
2. **Runtime:** `/app/staticfiles/frontend/` (Django STATIC_ROOT)
3. **URL:** `/static/frontend/assets/...` (браузер)
4. **Host:** `./staticfiles/frontend/` (volume mount)

---

## 🚫 НЕПРАВИЛЬНЫЕ ПУТИ (удалить)

1. **`/app/static/frontend`** - устаревший путь
2. **`static/frontend/manifest.json`** - в vite.py
3. **Любые упоминания `static/` вместо `staticfiles/`**

---

## 📝 СЛЕДУЮЩИЕ ДЕЙСТВИЯ

1. ✅ Удалить sandmatch/vite.py
2. ✅ Обновить README.md (8 мест)
3. ✅ Обновить DEPLOYMENT_PLAN.md (2 места)
4. ✅ Исправить комментарий в Dockerfile
5. ✅ Проверить все template tags
6. ✅ Обновить документацию тестирования

После исправлений везде будет единообразно:
- **Источник:** `/app/frontend/dist/`
- **Назначение:** `/app/staticfiles/frontend/`
- **URL:** `/static/frontend/`

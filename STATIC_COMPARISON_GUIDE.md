# Руководство по сравнению static файлов: локально vs продакшн

## Дата: 2025-10-21

---

## 🔍 ОБНАРУЖЕННАЯ ПРОБЛЕМА

**Локально:** только папка `static/` с `img/logo.png`  
**На проде:** папки `static/` И `staticfiles/`

Это указывает на **конфликт конфигурации** между локальным и продакшн окружениями.

---

## 📊 АНАЛИЗ ТЕКУЩЕЙ СИТУАЦИИ

### Локальная структура
```
c:\Projects\URZM\SandMatch\
├── static/
│   └── img/
│       └── logo.png
└── staticfiles/ (отсутствует или пустая)
```

### Продакшн структура (предположительно)
```
/opt/sandmatch/app/
├── static/
│   └── img/
│       └── logo.png
└── staticfiles/
    ├── admin/ (Django admin assets)
    ├── frontend/ (Vite assets)
    └── img/ (копия из static/)
```

---

## ⚠️ ИСТОЧНИК КОНФЛИКТА

**Проблема в настройках Django:**

1. **STATIC_ROOT** = `staticfiles/` (куда Django собирает всю статику)
2. **STATICFILES_DIRS** = `[static/]` (откуда Django берёт исходную статику)
3. **collectstatic** копирует `static/img/logo.png` → `staticfiles/img/logo.png`

**НО:** мы закомментировали `STATICFILES_DIRS`, что может вызывать проблемы!

---

## 🛠️ КОМАНДЫ ДЛЯ ДИАГНОСТИКИ

### 1. Проверить локальную структуру
```bash
# Посмотреть что есть в проекте
ls -la static/
ls -la staticfiles/ 2>/dev/null || echo "staticfiles/ не существует"

# Проверить в Docker контейнере
docker compose exec web ls -la /app/static/
docker compose exec web ls -la /app/staticfiles/
```

### 2. Проверить продакшн структуру
```bash
# На сервере
ssh user@server "cd /opt/sandmatch/app && ls -la static/"
ssh user@server "cd /opt/sandmatch/app && ls -la staticfiles/"

# Или через Docker на сервере
ssh user@server "docker compose exec web ls -la /app/static/"
ssh user@server "docker compose exec web ls -la /app/staticfiles/"
```

### 3. Сравнить содержимое папок
```bash
# Локально в контейнере
docker compose exec web find /app/static/ -type f | sort
docker compose exec web find /app/staticfiles/ -type f | sort

# На проде
ssh user@server "docker compose exec web find /app/static/ -type f | sort"
ssh user@server "docker compose exec web find /app/staticfiles/ -type f | sort"
```

### 4. Проверить Django настройки
```bash
# Локально
docker compose exec web python manage.py shell -c "
from django.conf import settings
print('STATIC_ROOT:', settings.STATIC_ROOT)
print('STATIC_URL:', settings.STATIC_URL)
print('STATICFILES_DIRS:', getattr(settings, 'STATICFILES_DIRS', 'НЕ УСТАНОВЛЕНО'))
"

# На проде
ssh user@server "docker compose exec web python manage.py shell -c \"
from django.conf import settings
print('STATIC_ROOT:', settings.STATIC_ROOT)
print('STATIC_URL:', settings.STATIC_URL)
print('STATICFILES_DIRS:', getattr(settings, 'STATICFILES_DIRS', 'НЕ УСТАНОВЛЕНО'))
\""
```

---

## 🔧 ИСПРАВЛЕНИЕ КОНФЛИКТА

### Вариант 1: Восстановить STATICFILES_DIRS (РЕКОМЕНДУЕТСЯ)

**Проблема:** Django не знает откуда брать `static/img/logo.png` для collectstatic

**Решение:** Раскомментировать в `sandmatch/settings/base.py`:
```python
# Static & Media
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]  # ← РАСКОММЕНТИРОВАТЬ
```

### Вариант 2: Переместить logo.png в приложение

**Решение:** Переместить `static/img/logo.png` → `apps/core/static/core/img/logo.png`

Django автоматически найдёт статику в приложениях.

---

## 📋 ПОШАГОВАЯ ДИАГНОСТИКА

### Шаг 1: Проверить текущее состояние
```bash
# Локально
docker compose exec web python manage.py collectstatic --dry-run

# Должно показать что будет скопировано
```

### Шаг 2: Сравнить с продом
```bash
# На проде
ssh user@server "docker compose exec web python manage.py collectstatic --dry-run"
```

### Шаг 3: Проверить доступность logo.png
```bash
# Локально
curl -I http://localhost:8000/static/img/logo.png

# На проде
curl -I https://your-domain.com/static/img/logo.png
```

---

## 🎯 РЕКОМЕНДУЕМОЕ РЕШЕНИЕ

### 1. Восстановить STATICFILES_DIRS
```python
# В sandmatch/settings/base.py
STATICFILES_DIRS = [BASE_DIR / "static"]
```

### 2. Проверить что collectstatic работает
```bash
docker compose exec web python manage.py collectstatic --noinput
```

### 3. Убедиться что структура одинаковая
```bash
# Должна быть такая структура в контейнере:
/app/static/img/logo.png          # Исходный файл
/app/staticfiles/img/logo.png     # Скопированный collectstatic
/app/staticfiles/frontend/        # Vite assets (из entrypoint.sh)
/app/staticfiles/admin/           # Django admin assets
```

---

## 🚨 КРИТИЧЕСКИЕ ПРОВЕРКИ

### 1. Logo.png доступен в браузере?
- Локально: http://localhost:8000/static/img/logo.png
- Прод: https://domain.com/static/img/logo.png

### 2. Frontend assets доступны?
- Локально: http://localhost:8000/static/frontend/manifest.json
- Прод: https://domain.com/static/frontend/manifest.json

### 3. Django admin работает?
- Локально: http://localhost:8000/sm-admin/
- Прод: https://domain.com/sm-admin/

---

## 📝 КОМАНДЫ ДЛЯ БЫСТРОЙ ПРОВЕРКИ

```bash
# Полная диагностика локально
echo "=== STATIC FILES DIAGNOSTIC ==="
echo "1. Static directory:"
ls -la static/
echo "2. Staticfiles directory:"
ls -la staticfiles/ 2>/dev/null || echo "staticfiles/ не существует"
echo "3. In container static:"
docker compose exec web ls -la /app/static/ 2>/dev/null || echo "Контейнер не запущен"
echo "4. In container staticfiles:"
docker compose exec web ls -la /app/staticfiles/ 2>/dev/null || echo "Контейнер не запущен"
echo "5. Logo.png accessibility:"
curl -I http://localhost:8000/static/img/logo.png 2>/dev/null || echo "Сервер недоступен"
```

Запустите эту диагностику и сравните результаты с продакшном!

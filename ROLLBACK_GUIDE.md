# Экстренное исправление 404 на frontend ассеты

## Проблема: 404 на /static/frontend/assets/main-*.js

URL: `https://beachplay.ru/static/frontend/assets/main-a8ab42.js` → 404

---

## 🔍 ДИАГНОСТИКА

### 1. Проверить содержимое контейнера
```bash
# На сервере
ssh user@server "docker compose exec web ls -la /app/staticfiles/frontend/"
ssh user@server "docker compose exec web cat /app/staticfiles/frontend/manifest.json"
```

### 2. Проверить Nginx конфигурацию
```bash
# На сервере
ssh user@server "docker compose exec nginx cat /etc/nginx/nginx.conf | grep -A5 -B5 static"
```

### 3. Проверить volume mount
```bash
# На сервере
ssh user@server "ls -la /opt/sandmatch/app/staticfiles/frontend/"
```

---

## 🚨 ВОЗМОЖНЫЕ ПРИЧИНЫ

### 1. Nginx не обновился
**Проблема:** Старая конфигурация Nginx ищет файлы в `/app/static/` вместо `/app/staticfiles/`

**Проверка:**
```bash
ssh user@server "docker compose exec nginx cat /etc/nginx/nginx.conf"
```

**Ожидаемое:** `alias /app/staticfiles/;`  
**Если видите:** `alias /app/static/;` → нужно пересобрать nginx

### 2. Volume mount неправильный
**Проблема:** В docker-compose.prod.yml на сервере старый volume mount

**Проверка:**
```bash
ssh user@server "cat /opt/sandmatch/app/docker-compose.prod.yml | grep staticfiles"
```

**Ожидаемое:** `./staticfiles:/app/staticfiles:ro`

### 3. Ассеты не копируются
**Проблема:** entrypoint.sh не копирует Vite ассеты

**Проверка:**
```bash
ssh user@server "docker compose logs web | grep entrypoint"
```

**Ожидаемое:** `[entrypoint] Vite-ассеты успешно скопированы`

---

## ⚡ БЫСТРОЕ ИСПРАВЛЕНИЕ

### Вариант 1: Пересобрать nginx
```bash
ssh user@server "cd /opt/sandmatch/app && docker compose -f docker-compose.prod.yml build nginx"
ssh user@server "cd /opt/sandmatch/app && docker compose -f docker-compose.prod.yml up -d nginx"
```

### Вариант 2: Полный перезапуск
```bash
ssh user@server "cd /opt/sandmatch/app && docker compose -f docker-compose.prod.yml down"
ssh user@server "cd /opt/sandmatch/app && docker compose -f docker-compose.prod.yml up -d"
```

### Вариант 3: Проверить и исправить volume
```bash
# Проверить что папка существует на хосте
ssh user@server "mkdir -p /opt/sandmatch/app/staticfiles/frontend"

# Скопировать из контейнера на хост (если нужно)
ssh user@server "docker compose exec web cp -r /app/staticfiles/frontend/. /app/staticfiles/frontend/"
```

---

## 🔧 ПОШАГОВАЯ ДИАГНОСТИКА

### Шаг 1: Проверить что ассеты есть в контейнере
```bash
ssh user@server "docker compose exec web ls -la /app/staticfiles/frontend/"
```

**Ожидаемый результат:**
```
manifest.json
assets/
  main-HASH.js
  main-HASH.css
```

### Шаг 2: Проверить Nginx alias
```bash
ssh user@server "docker compose exec nginx cat /etc/nginx/nginx.conf | grep alias"
```

**Ожидаемый результат:**
```
alias /app/staticfiles/;
```

### Шаг 3: Проверить что Nginx видит файлы
```bash
ssh user@server "docker compose exec nginx ls -la /app/staticfiles/frontend/"
```

### Шаг 4: Тестировать прямой доступ
```bash
ssh user@server "docker compose exec nginx wget -O- http://localhost/static/frontend/manifest.json"
```

---

## 🎯 НАИБОЛЕЕ ВЕРОЯТНАЯ ПРИЧИНА

**Nginx использует старую конфигурацию** с `alias /app/static/;` вместо `alias /app/staticfiles/;`

**Решение:**
```bash
ssh user@server "cd /opt/sandmatch/app && docker compose -f docker-compose.prod.yml build --no-cache nginx"
ssh user@server "cd /opt/sandmatch/app && docker compose -f docker-compose.prod.yml up -d nginx"
```

---

## ✅ ПРОВЕРКА ИСПРАВЛЕНИЯ

После любого исправления проверить:

```bash
# 1. Manifest доступен
curl -I https://beachplay.ru/static/frontend/manifest.json

# 2. JS файл доступен (заменить HASH на актуальный)
curl -I https://beachplay.ru/static/frontend/assets/main-HASH.js

# 3. Главная страница загружается
curl -I https://beachplay.ru/
```

Все должны возвращать **200 OK**.

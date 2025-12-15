# Руководство по развёртыванию обновлений системы регистрации

## Обзор

Это руководство описывает шаги для развёртывания обновлений системы регистрации на турниры.

## Предварительные требования

- Docker и Docker Compose установлены
- Доступ к серверу с проектом
- Права на выполнение команд Django

## Шаги развёртывания

### 1. Остановка сервисов

```bash
docker-compose down
```

### 2. Обновление кода

```bash
git pull origin main
```

### 3. Сборка фронтенда

```bash
cd frontend
npm install
npm run build
cd ..
```

### 4. Сборка Docker образов

```bash
docker-compose build
```

### 5. Запуск сервисов

```bash
docker-compose up -d
```

### 6. Проверка миграций

```bash
# Проверить, что миграция 0010 применена
docker-compose exec web python manage.py showmigrations tournaments
```

Должна быть отмечена:
```
[X] 0010_pairinvitation_tournamentregistration
```

Если нет, применить:
```bash
docker-compose exec web python manage.py migrate tournaments
```

### 7. Проверка сигналов

Сигналы должны автоматически зарегистрироваться при запуске.

Проверить логи:
```bash
docker-compose logs web | grep "tournaments.signals"
```

### 8. Проверка Celery

```bash
# Проверить Celery Worker
docker-compose logs celery | tail -50

# Должны быть видны новые задачи:
# - send_pair_invitation_notification
# - send_invitation_accepted_notification
# - send_partner_registration_notification
# - send_status_changed_notification
```

### 9. Тестирование API

#### Простая регистрация (индивидуальный турнир)
```bash
curl -X POST http://localhost:8000/api/mini-app/tournaments/1/register-single/ \
  -H "X-Telegram-Init-Data: ..." \
  -H "Content-Type: application/json"
```

#### Регистрация с напарником (поиск по ФИО)
```bash
curl -X POST http://localhost:8000/api/mini-app/tournaments/1/register-with-partner/ \
  -H "X-Telegram-Init-Data: ..." \
  -H "Content-Type: application/json" \
  -d '{"partner_search": "Иванов Иван"}'
```

#### Отправка приглашения (поиск по ФИО)
```bash
curl -X POST http://localhost:8000/api/mini-app/tournaments/1/send-invitation/ \
  -H "X-Telegram-Init-Data: ..." \
  -H "Content-Type: application/json" \
  -d '{"receiver_search": "Петров Пётр", "message": "Давай сыграем!"}'
```

### 10. Проверка синхронизации

#### Добавить участника через основной интерфейс
1. Войти в админку или основной интерфейс
2. Открыть турнир
3. Добавить участника через "+Добавить участника"
4. Проверить, что создалась запись в `TournamentRegistration`:

```bash
docker-compose exec web python manage.py shell
```

```python
from apps.tournaments.registration_models import TournamentRegistration
from apps.tournaments.models import Tournament

tournament = Tournament.objects.get(id=1)
registrations = TournamentRegistration.objects.filter(tournament=tournament)
print(f"Всего регистраций: {registrations.count()}")
for reg in registrations:
    print(f"{reg.player.get_full_name()} - {reg.get_status_display()}")
```

### 11. Проверка уведомлений

#### Тестовое уведомление о приглашении
```python
from apps.telegram_bot.tasks import send_pair_invitation_notification

# Найти приглашение
from apps.tournaments.registration_models import PairInvitation
invitation = PairInvitation.objects.filter(status='pending').first()

if invitation:
    send_pair_invitation_notification.delay(invitation.id)
    print(f"Отправлено уведомление для приглашения {invitation.id}")
```

Проверить логи Celery:
```bash
docker-compose logs celery -f
```

### 12. Проверка фронтенда

1. Открыть Mini App в Telegram
2. Открыть турнир
3. Проверить:
   - Для индивидуального турнира: показывается простая форма
   - Для парного турнира: показывается выбор режима
   - Поле ввода ФИО вместо ID

## Откат изменений

Если что-то пошло не так:

### 1. Откат кода
```bash
git checkout <previous-commit>
```

### 2. Откат миграций
```bash
docker-compose exec web python manage.py migrate tournaments 0009
```

### 3. Перезапуск сервисов
```bash
docker-compose restart
```

## Мониторинг

### Проверка ошибок в логах

```bash
# Web сервис
docker-compose logs web | grep ERROR

# Celery
docker-compose logs celery | grep ERROR

# Все сервисы
docker-compose logs -f
```

### Проверка базы данных

```bash
docker-compose exec web python manage.py dbshell
```

```sql
-- Количество регистраций
SELECT COUNT(*) FROM tournaments_tournamentregistration;

-- Регистрации по статусам
SELECT status, COUNT(*) 
FROM tournaments_tournamentregistration 
GROUP BY status;

-- Приглашения по статусам
SELECT status, COUNT(*) 
FROM tournaments_pairinvitation 
GROUP BY status;

-- Синхронизация с TournamentEntry
SELECT 
  COUNT(DISTINCT tr.team_id) as registrations_count,
  COUNT(DISTINCT te.team_id) as entries_count
FROM tournaments_tournamentregistration tr
LEFT JOIN tournaments_tournamententry te ON tr.team_id = te.team_id
WHERE tr.status IN ('main_list', 'reserve_list');
```

## Troubleshooting

### Проблема: Сигналы не работают

**Симптомы:** При добавлении участника через основной интерфейс не создаётся `TournamentRegistration`.

**Решение:**
1. Проверить, что `apps.py` содержит `ready()` метод
2. Проверить, что сигналы импортируются
3. Перезапустить сервис:
```bash
docker-compose restart web
```

### Проблема: Поиск по ФИО не работает

**Симптомы:** Всегда возвращается "Игрок не найден".

**Решение:**
1. Проверить, что в базе есть игроки с заполненными ФИО
2. Проверить кодировку в базе данных
3. Тестовый запрос:
```python
from apps.players.models import Player
from django.db.models import Q

search = "Иванов"
players = Player.objects.filter(
    Q(first_name__icontains=search) |
    Q(last_name__icontains=search)
)
print(f"Найдено: {players.count()}")
```

### Проблема: Уведомления не отправляются

**Симптомы:** Celery задачи не выполняются.

**Решение:**
1. Проверить, что Celery запущен:
```bash
docker-compose ps celery
```

2. Проверить Redis:
```bash
docker-compose exec redis redis-cli ping
```

3. Проверить логи Celery:
```bash
docker-compose logs celery -f
```

4. Перезапустить Celery:
```bash
docker-compose restart celery
```

### Проблема: Множественные результаты не обрабатываются

**Симптомы:** При нескольких найденных игроках показывается общая ошибка.

**Решение:**
1. Проверить версию фронтенда
2. Проверить формат ответа API:
```bash
curl -X POST http://localhost:8000/api/mini-app/tournaments/1/register-with-partner/ \
  -H "X-Telegram-Init-Data: ..." \
  -H "Content-Type: application/json" \
  -d '{"partner_search": "Иван"}' \
  -v
```

Должен вернуться:
```json
{
  "error": "Найдено несколько игроков. Уточните запрос.",
  "players": [
    {"id": 1, "full_name": "Иванов Иван Иванович"},
    {"id": 2, "full_name": "Иванов Игорь Петрович"}
  ]
}
```

## Проверочный список

- [ ] Код обновлён
- [ ] Фронтенд собран
- [ ] Docker образы пересобраны
- [ ] Сервисы запущены
- [ ] Миграции применены
- [ ] Сигналы работают
- [ ] Celery видит новые задачи
- [ ] API эндпоинты отвечают
- [ ] Поиск по ФИО работает
- [ ] Синхронизация с TournamentEntry работает
- [ ] Уведомления отправляются
- [ ] Фронтенд обновлён
- [ ] Индивидуальные турниры работают
- [ ] Парные турниры работают

## Контакты поддержки

При возникновении проблем:
1. Проверить логи всех сервисов
2. Проверить документацию в `docs/`
3. Создать issue в репозитории

## Дополнительные ресурсы

- `docs/TOURNAMENT_REGISTRATION_SYSTEM.md` - Полная документация системы
- `docs/REGISTRATION_SYSTEM_UPDATES.md` - Описание изменений backend
- `docs/FRONTEND_REGISTRATION_UPDATES.md` - Описание изменений frontend
- `docs/TELEGRAM_NOTIFICATIONS_SETUP.md` - Настройка уведомлений

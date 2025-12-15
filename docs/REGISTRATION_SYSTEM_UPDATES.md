# Обновления системы регистрации на турниры

## Обзор изменений

Внесены изменения в систему регистрации на турниры согласно уточнениям:

## 1. Поддержка индивидуальных турниров ✅

### Backend
- **Новый метод**: `RegistrationService.register_single(tournament, player)`
  - Создаёт команду с `player_2=NULL`
  - Сразу определяет статус (основной состав / резерв)
  - Синхронизирует с `TournamentEntry`

- **Новый API эндпоинт**: `POST /api/mini-app/tournaments/{id}/register-single/`
  - Простая регистрация без выбора режима
  - Для индивидуальных турниров

### Логика
- Для индивидуальных турниров: только "Зарегистрироваться"
- Нет поиска пар, только основной состав и резерв
- Создаётся `Team` с одним игроком

## 2. Синхронизация с основным интерфейсом ✅

### Backend
- **Новый метод**: `RegistrationService.sync_tournament_entry_to_registration(tournament_entry)`
  - Вызывается при добавлении участника через основной интерфейс
  - Создаёт/обновляет `TournamentRegistration` для обоих игроков
  - Определяет правильный статус

- **Сигналы** (`apps/tournaments/signals.py`):
  - `post_save` на `TournamentEntry` → синхронизация с регистрацией
  - `post_delete` на `TournamentEntry` → удаление регистраций

### Логика
- При добавлении участника через "+Добавить участника":
  - Автоматически создаются записи в `TournamentRegistration`
  - Пользователи бота видят актуальный состав
  - Актуальное количество свободных мест

## 3. Поиск напарника по ФИО ✅

### Backend
- **Обновлён сериализатор** `RegisterWithPartnerSerializer`:
  - Было: `partner_id` (Integer)
  - Стало: `partner_search` (String) - ФИО для поиска

- **Обновлён сериализатор** `SendPairInvitationSerializer`:
  - Было: `receiver_id` (Integer)
  - Стало: `receiver_search` (String) - ФИО для поиска

- **Обновлены API эндпоинты**:
  - `register_with_partner`: поиск по ФИО через `Q` объекты
  - `send_pair_invitation`: поиск по ФИО через `Q` объекты

### Логика поиска
```python
Player.objects.filter(
    Q(first_name__icontains=search_query) |
    Q(last_name__icontains=search_query) |
    Q(patronymic__icontains=search_query)
)
```

### Обработка результатов
- **0 результатов**: `404 Not Found`
- **1 результат**: используется найденный игрок
- **>1 результат**: возвращается список для уточнения:
  ```json
  {
    "error": "Найдено несколько игроков. Уточните запрос.",
    "players": [
      {"id": 1, "full_name": "Иванов Иван Иванович"},
      {"id": 2, "full_name": "Иванов Игорь Петрович"}
    ]
  }
  ```

## 4. Приглашение любому игроку ✅

### Backend
- **Обновлён метод** `RegistrationService.send_pair_invitation()`:
  - Убрана проверка "получатель ищет пару"
  - Проверяется только "отправитель ищет пару"
  - Проверяется "получатель не зарегистрирован на турнир"

### Логика
- Отправитель должен быть в статусе `looking_for_partner`
- Получатель может быть любым игроком с привязкой к Telegram
- Получатель не должен быть уже зарегистрирован на этот турнир

## 5. Логика отказа от приглашения ✅

### Backend
- **Обновлён метод** `RegistrationService.decline_pair_invitation()`:
  - Проверяет, была ли регистрация до приглашения
  - Если игрок сам подавал заявку → возвращает в `looking_for_partner`
  - Если игрок не подавал заявку → удаляет регистрацию

### Логика
```python
if receiver_reg.status == 'invited':
    # Проверяем другие приглашения
    if not other_invitations:
        # Удаляем регистрацию
        receiver_reg.delete()
else:
    # Возвращаем в "ищет пару"
    receiver_reg.status = 'looking_for_partner'
```

### Сценарии
1. **Игрок подал заявку "ищу пару"** → получил приглашение → отказался:
   - Остаётся в списке "ищу пару"

2. **Игрок не подавал заявку** → получил приглашение → отказался:
   - Удаляется из всех списков турнира

## 6. Отмена регистрации для пар ✅

### Backend
- **Метод** `RegistrationService.cancel_registration()` уже реализован правильно:
  - Удаляет регистрацию игрока
  - Переводит напарника в `looking_for_partner`
  - Удаляет `TournamentEntry`
  - Пересчитывает статусы

### Логика
```python
if partner:
    partner_reg.partner = None
    partner_reg.team = None
    partner_reg.status = 'looking_for_partner'
    partner_reg.save()

registration.delete()
_recalculate_registration_statuses(tournament)
```

## 7. Отмена из любого списка ✅

### Backend
- API эндпоинт `cancel_registration` работает для любого статуса:
  - `looking_for_partner`
  - `invited`
  - `main_list`
  - `reserve_list`

### Логика
- Игрок может отменить регистрацию в любом статусе
- Если в паре → напарник переходит в "ищет пару"
- Пересчитываются статусы оставшихся участников

## 8. Синхронизация резерва с TournamentEntry ✅

### Backend
- **Обновлён метод** `RegistrationService._sync_to_tournament_entry()`:
  - Было: только `main_list` → `TournamentEntry`
  - Стало: `main_list` И `reserve_list` → `TournamentEntry`

### Логика
```python
if registration.status in ['main_list', 'reserve_list']:
    TournamentEntry.objects.get_or_create(...)
else:
    TournamentEntry.objects.filter(...).delete()
```

### Результат
- Все участники (основной состав + резерв) видны в `TournamentEntry`
- Пользователи бота видят полный список участников

## Изменённые файлы

### Backend
1. **apps/tournaments/services/registration_service.py**
   - Добавлен `register_single()`
   - Обновлён `send_pair_invitation()`
   - Обновлён `accept_pair_invitation()`
   - Обновлён `decline_pair_invitation()`
   - Обновлён `_sync_to_tournament_entry()`
   - Добавлен `sync_tournament_entry_to_registration()`

2. **apps/tournaments/signals.py** (новый файл)
   - Сигналы для синхронизации `TournamentEntry` ↔ `TournamentRegistration`

3. **apps/tournaments/apps.py**
   - Регистрация сигналов в `ready()`

4. **apps/telegram_bot/api_serializers.py**
   - `RegisterWithPartnerSerializer`: `partner_id` → `partner_search`
   - `SendPairInvitationSerializer`: `receiver_id` → `receiver_search`

5. **apps/telegram_bot/api_views.py**
   - Добавлен `register_single()`
   - Обновлён `register_with_partner()` - поиск по ФИО
   - Обновлён `send_pair_invitation()` - поиск по ФИО

6. **apps/telegram_bot/api_urls_mini_app.py**
   - Добавлен маршрут `/register-single/`

## API изменения

### Новый эндпоинт
```
POST /api/mini-app/tournaments/{id}/register-single/
```
Простая регистрация для индивидуальных турниров.

### Изменённые эндпоинты

**Регистрация с напарником:**
```
POST /api/mini-app/tournaments/{id}/register-with-partner/
Body: { "partner_search": "Иванов Иван" }
```

**Отправка приглашения:**
```
POST /api/mini-app/tournaments/{id}/send-invitation/
Body: { "receiver_search": "Петров Пётр", "message": "Давай сыграем!" }
```

### Ответы при множественных результатах
```json
{
  "error": "Найдено несколько игроков. Уточните запрос.",
  "players": [
    {"id": 1, "full_name": "Иванов Иван Иванович"},
    {"id": 2, "full_name": "Иванов Игорь Петрович"}
  ]
}
```

## Тестирование

### 1. Индивидуальный турнир
```bash
# Простая регистрация
curl -X POST http://localhost:8000/api/mini-app/tournaments/1/register-single/ \
  -H "X-Telegram-Init-Data: ..."
```

### 2. Поиск по ФИО
```bash
# Регистрация с напарником
curl -X POST http://localhost:8000/api/mini-app/tournaments/1/register-with-partner/ \
  -H "X-Telegram-Init-Data: ..." \
  -H "Content-Type: application/json" \
  -d '{"partner_search": "Иванов"}'
```

### 3. Синхронизация с основным интерфейсом
1. Добавить участника через основной интерфейс "+Добавить участника"
2. Проверить `TournamentRegistration` в админке
3. Проверить список участников в Mini App

### 4. Отказ от приглашения
```bash
# Сценарий 1: игрок подавал заявку
# 1. Зарегистрироваться "ищу пару"
# 2. Получить приглашение
# 3. Отказаться
# Результат: остаётся в "ищу пару"

# Сценарий 2: игрок не подавал заявку
# 1. Получить приглашение (без регистрации)
# 2. Отказаться
# Результат: удаляется из списков
```

## Миграции

Новые миграции не требуются - все изменения в логике.

## Обратная совместимость

⚠️ **Breaking changes в API:**
- `partner_id` → `partner_search` (String)
- `receiver_id` → `receiver_search` (String)

Фронтенд нужно обновить для использования поиска по ФИО вместо ID.

## Следующие шаги

1. Обновить фронтенд для:
   - Определения типа турнира (индивидуальный/парный)
   - Поиска игроков по ФИО
   - Обработки множественных результатов поиска
   - Отображения кнопки "Зарегистрироваться" для индивидуальных турниров

2. Тестирование:
   - Индивидуальные турниры
   - Парные турниры
   - Синхронизация с основным интерфейсом
   - Все сценарии отказа от приглашений

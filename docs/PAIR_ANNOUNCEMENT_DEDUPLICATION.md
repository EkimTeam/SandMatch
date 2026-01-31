# Решение проблемы дублирования анонсов при парных операциях

## Проблема

При регистрации/отмене пары на турнир в группе Telegram появлялось **2 одинаковых анонса** вместо одного.

**Причина:** При парных операциях создаются/обновляются **две записи `TournamentRegistration`** (по одной на каждого игрока), что приводит к срабатыванию сигнала `post_save` дважды. Каждый сигнал ставит задачу `send_tournament_announcement_to_chat.delay()` в очередь Celery, и оба сообщения отправляются в группу.

## Решение: Transaction ID для группировки событий

Реализован механизм **transaction_id** для группировки связанных событий одной логической операции (регистрация/отмена пары).

### Архитектура решения

1. **Атрибуты экземпляра** для хранения `transaction_id` на объектах `TournamentRegistration`
2. **Генерация UUID** при начале парной операции
3. **Передача `transaction_id`** через атрибуты экземпляра в сигналы, затем в Celery-задачу
4. **Django cache** для отслеживания обработанных транзакций
5. **Совместимость с `@sync_to_async`** — работает в разных потоках

### Изменённые файлы

#### 1. `apps/tournaments/services/registration_service.py`

Добавлены методы для работы с `transaction_id`:

```python
import uuid

class RegistrationService:
    @staticmethod
    def _set_transaction_id_on_instance(instance, transaction_id: str):
        """Установить transaction_id на экземпляре регистрации (для передачи в сигналы)"""
        instance._transaction_id = transaction_id
    
    @staticmethod
    def _get_transaction_id_from_instance(instance) -> Optional[str]:
        """Получить transaction_id из экземпляра регистрации"""
        return getattr(instance, '_transaction_id', None)
```

Модифицированы методы парных операций:

- `register_with_partner()` — генерирует UUID и устанавливает `_transaction_id` на обоих экземплярах регистрации
- `leave_pair()` — аналогично
- `cancel_registration()` — устанавливает `_transaction_id` перед удалением

Пример из `register_with_partner()`:
```python
# Генерируем transaction_id для группировки событий пары
transaction_id = str(uuid.uuid4())

# ... создание/обновление регистраций ...

# Устанавливаем transaction_id для передачи в сигнал
RegistrationService._set_transaction_id_on_instance(player_registration, transaction_id)
player_registration.save()

# То же для напарника
RegistrationService._set_transaction_id_on_instance(partner_registration, transaction_id)
partner_registration.save()
```

#### 2. `apps/tournaments/signals.py`

Сигнал `check_roster_change_for_announcement` получает `transaction_id` из экземпляра и передаёт в задачу:

```python
from apps.tournaments.services.registration_service import RegistrationService

# Получаем transaction_id из экземпляра для группировки парных операций
transaction_id = RegistrationService._get_transaction_id_from_instance(instance)

# Отправляем анонс асинхронно с transaction_id
from apps.telegram_bot.tasks import send_tournament_announcement_to_chat
transaction.on_commit(
    lambda: send_tournament_announcement_to_chat.delay(
        instance.tournament.id, 
        'roster_change',
        transaction_id=transaction_id
    )
)
```

#### 3. `apps/telegram_bot/tasks.py`

Задача `send_tournament_announcement_to_chat` проверяет дубликаты по `transaction_id`:

```python
from django.core.cache import cache

@shared_task
def send_tournament_announcement_to_chat(tournament_id: int, trigger_type: str, transaction_id: str = None):
    # Для парных операций проверяем, не была ли уже отправлена задача для этой транзакции
    if transaction_id and trigger_type == 'roster_change':
        cache_key = f"announcement_sent_{tournament_id}_{trigger_type}_{transaction_id}"
        
        # Проверяем, была ли уже отправка для этой транзакции
        if cache.get(cache_key):
            logger.info(f"[ANNOUNCEMENT] Анонс для transaction_id {transaction_id} уже отправлен, пропускаем дубликат")
            return "Дубликат анонса для парной операции пропущен"
        
        # Помечаем транзакцию как обработанную (TTL 10 секунд)
        cache.set(cache_key, True, timeout=10)
```

### Как это работает

1. **Регистрация пары:**
   - `register_with_partner()` генерирует UUID: `"abc123-..."`
   - Устанавливает его на обоих экземплярах: `player_registration._transaction_id = "abc123-..."`
   - Сохраняет обе регистрации (игрок + напарник)
   - Срабатывают 2 сигнала `post_save` (для каждого экземпляра)
   - Оба сигнала получают **один и тот же** `transaction_id` из атрибута `instance._transaction_id`
   - Оба сигнала ставят задачу с `transaction_id="abc123-..."`
   - **Первая задача:** проверяет кеш → не найдено → помечает `abc123` как обработанный → отправляет анонс
   - **Вторая задача:** проверяет кеш → найдено `abc123` → **пропускает отправку**

2. **Одиночная регистрация:**
   - `transaction_id` не устанавливается (`None`)
   - Сигнал передаёт `transaction_id=None`
   - Задача пропускает проверку кеша (т.к. `transaction_id is None`)
   - Анонс отправляется как обычно

### Преимущества решения

- ✅ **Нет дубликатов** при парных операциях
- ✅ **Не влияет** на одиночные регистрации
- ✅ **Работает с `@sync_to_async`** — не зависит от потоков, т.к. использует атрибуты экземпляра
- ✅ **Простота** — нет необходимости в `try/finally` для очистки
- ✅ **Минимальное время жизни** в кеше (10 секунд)
- ✅ **Обратная совместимость** (старый код без `transaction_id` работает как раньше)

### Тестирование

Для проверки решения:

1. Зарегистрировать пару через бота/мини-апп
2. Проверить, что в группе появилось **одно** сообщение об изменении состава
3. Отменить регистрацию пары
4. Проверить, что в группе появилось **одно** сообщение об изменении состава
5. Проверить логи на наличие строк:
   - `[ROSTER_CHANGE] Задача отправки анонса поставлена в очередь (transaction_id: ...)`
   - `[ANNOUNCEMENT] Транзакция ... помечена как обработанная`
   - `[ANNOUNCEMENT] Анонс для transaction_id ... уже отправлен, пропускаем дубликат`

### Возможные улучшения

- Использовать Redis вместо Django cache для более надёжного хранения (если Django cache на MemoryStorage)
- Добавить метрики для отслеживания количества пропущенных дубликатов
- Расширить механизм на другие типы триггеров (не только `roster_change`)

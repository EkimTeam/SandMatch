# Архитектура синхронизации регистраций

## Проблема

Система имеет две точки входа для регистрации участников:
1. **Веб-сайт** (основной интерфейс) - организатор добавляет участников через `TournamentEntry`
2. **Telegram Mini App** - участники регистрируются через `TournamentRegistration`

Это создавало проблемы рассинхронизации данных.

## Решение: Двусторонняя синхронизация

### Модели данных

#### TournamentEntry (Основная таблица участников)
- Используется основным интерфейсом сайта
- Содержит: `tournament`, `team`, `group_index`, `row_index`, `is_out_of_competition`
- Это "источник истины" для турнирной сетки

#### TournamentRegistration (Система регистрации Mini App)
- Используется Telegram Mini App
- Содержит: `tournament`, `player`, `partner`, `team`, `status`, `registration_order`
- Статусы: `looking_for_partner`, `invited`, `main_list`, `reserve_list`
- Управляет очередью и статусами регистрации

### Механизм синхронизации

#### 1. Сигналы Django (apps/tournaments/signals.py)

**При создании/обновлении TournamentEntry:**
```python
@receiver(post_save, sender=TournamentEntry)
def sync_tournament_entry_created(sender, instance, created, **kwargs):
    # Создаёт или обновляет TournamentRegistration
    RegistrationService.sync_tournament_entry_to_registration(instance)
```

**При удалении TournamentEntry:**
```python
@receiver(post_delete, sender=TournamentEntry)
def sync_tournament_entry_deleted(sender, instance, **kwargs):
    # Удаляет соответствующие TournamentRegistration
    TournamentRegistration.objects.filter(
        tournament=instance.tournament,
        team=instance.team
    ).delete()
```

**При изменении planned_participants:**
```python
@receiver(pre_save, sender=Tournament)
def track_planned_participants_change(sender, instance, **kwargs):
    # Запоминаем старое значение
    instance._old_planned_participants = old_instance.planned_participants

@receiver(post_save, sender=Tournament)
def recalculate_on_planned_participants_change(sender, instance, created, **kwargs):
    # Если изменилось - пересчитываем статусы
    if old_value != new_value:
        RegistrationService._recalculate_registration_statuses(instance)
```

**При создании/обновлении TournamentRegistration:**
```python
@receiver(pre_save, sender=TournamentRegistration)
def track_registration_status_change(sender, instance, **kwargs):
    # Запоминаем старый статус и команду
    instance._old_status = old_instance.status
    instance._old_team = old_instance.team

@receiver(post_save, sender=TournamentRegistration)
def sync_registration_to_entry(sender, instance, created, **kwargs):
    # Синхронизируем с TournamentEntry
    RegistrationService._sync_to_tournament_entry(instance)
    
    # Пересчитываем очередь если:
    # - Создана новая регистрация с командой
    # - Изменился статус
    # - Изменилась команда (сформировалась пара)
    if should_recalculate:
        transaction.on_commit(
            lambda: RegistrationService._recalculate_registration_statuses(instance.tournament)
        )
```

**При удалении TournamentRegistration:**
```python
@receiver(post_delete, sender=TournamentRegistration)
def recalculate_on_registration_deleted(sender, instance, **kwargs):
    # Удаляем TournamentEntry
    if instance.team:
        TournamentEntry.objects.filter(
            tournament=instance.tournament,
            team=instance.team
        ).delete()
    
    # Пересчитываем очередь
    transaction.on_commit(
        lambda: RegistrationService._recalculate_registration_statuses(tournament)
    )
```

#### 2. Методы синхронизации (apps/tournaments/services/registration_service.py)

**sync_tournament_entry_to_registration:**
- Вызывается при добавлении участника через веб-сайт
- Создаёт одну запись `TournamentRegistration` на команду
- Определяет статус (`main_list` или `reserve_list`) на основе `planned_participants`

**_sync_to_tournament_entry:**
- Вызывается при регистрации через Mini App
- Создаёт или обновляет `TournamentEntry` для статусов `main_list` и `reserve_list`
- Удаляет `TournamentEntry` для статуса `looking_for_partner`

**_recalculate_registration_statuses:**
- Пересчитывает статусы всех регистраций при изменении `planned_participants`
- Синхронизирует изменения с `TournamentEntry`
- Отправляет уведомления об изменении статуса

### Потоки данных

#### Поток 1: Организатор добавляет участника через веб-сайт
```
1. Создаётся TournamentEntry
   ↓
2. Срабатывает сигнал post_save
   ↓
3. Вызывается sync_tournament_entry_to_registration()
   ↓
4. Создаётся TournamentRegistration со статусом main_list/reserve_list
   ↓
5. Участник виден в Mini App
```

#### Поток 2: Организатор удаляет участника через веб-сайт
```
1. Удаляется TournamentEntry (по крестику)
   ↓
2. Срабатывает сигнал post_delete
   ↓
3. Удаляется соответствующий TournamentRegistration
   ↓
4. Участник исчезает из Mini App
```

#### Поток 3: Участник регистрируется через Mini App
```
1. Создаётся TournamentRegistration (статус: looking_for_partner/main_list/reserve_list)
   ↓
2. Если статус main_list/reserve_list:
   ↓
3. Вызывается _sync_to_tournament_entry()
   ↓
4. Создаётся TournamentEntry
   ↓
5. Участник виден на веб-сайте
```

#### Поток 4: Участник отменяет регистрацию через Mini App
```
1. Удаляется TournamentRegistration
   ↓
2. В методе cancel_registration() удаляется TournamentEntry
   ↓
3. Вызывается _recalculate_registration_statuses()
   ↓
4. Пересчитываются статусы оставшихся участников
   ↓
5. Изменения синхронизируются с TournamentEntry
```

#### Поток 5: Организатор изменяет planned_participants
```
1. Обновляется Tournament.planned_participants (3 → 6)
   ↓
2. Срабатывает сигнал pre_save (запоминает старое значение)
   ↓
3. Срабатывает сигнал post_save
   ↓
4. Вызывается _recalculate_registration_statuses()
   ↓
5. Участники из резерва переходят в основной состав
   ↓
6. Для каждого изменённого статуса вызывается _sync_to_tournament_entry()
   ↓
7. Обновляются TournamentEntry
   ↓
8. Отправляются уведомления участникам
```

### Правила синхронизации

1. **TournamentEntry → TournamentRegistration:**
   - Одна команда = одна регистрация
   - `player` = `team.player_1`, `partner` = `team.player_2`
   - Статус определяется по позиции в списке относительно `planned_participants`

2. **TournamentRegistration → TournamentEntry:**
   - Только для статусов `main_list` и `reserve_list`
   - Статус `looking_for_partner` не создаёт `TournamentEntry`
   - При удалении регистрации удаляется и `TournamentEntry`

3. **Пересчёт статусов:**
   - Триггеры: изменение `planned_participants`, добавление/удаление регистрации
   - Сортировка по `registration_order`, затем по `registered_at`
   - Первые N команд → `main_list`, остальные → `reserve_list`

### Преимущества решения

✅ **Автоматическая синхронизация** - изменения в одной системе автоматически отражаются в другой
✅ **Целостность данных** - нет дублирования или потери информации
✅ **Прозрачность** - организатор и участники видят одинаковые данные
✅ **Уведомления** - участники получают уведомления об изменении статуса
✅ **Обратная совместимость** - существующая логика не нарушена

### Тестовые сценарии

#### Сценарий 1: Добавление участников сверх лимита
```
Дано: Турнир на 3 участника
1. Организатор добавляет 4 участника через сайт
   → 3 в main_list, 1 в reserve_list
2. Участник регистрируется через Mini App
   → Попадает в reserve_list (позиция 5)
3. Организатор меняет лимит на 6
   → Все 5 участников переходят в main_list
   → Отправляются уведомления
```

#### Сценарий 2: Удаление участника
```
Дано: 5 участников (3 в main_list, 2 в reserve_list)
1. Организатор удаляет участника из main_list через сайт
   → TournamentEntry удаляется
   → TournamentRegistration удаляется
   → Первый из reserve_list переходит в main_list
   → Обновляется TournamentEntry
   → Отправляется уведомление
```

#### Сценарий 3: Отмена регистрации
```
Дано: Участник в main_list
1. Участник отменяет регистрацию через Mini App
   → TournamentRegistration удаляется
   → TournamentEntry удаляется
   → Статусы пересчитываются
   → Участник из reserve_list переходит в main_list
```

### Файлы системы

- `apps/tournaments/signals.py` - сигналы синхронизации
- `apps/tournaments/services/registration_service.py` - логика синхронизации
- `apps/tournaments/registration_models.py` - модель TournamentRegistration
- `apps/tournaments/models.py` - модель TournamentEntry
- `apps/telegram_bot/api_views.py` - API endpoints для Mini App
- `apps/telegram_bot/api_serializers.py` - сериализаторы данных

### Мониторинг и отладка

Для отладки синхронизации можно использовать:

```python
# В Django shell
from apps.tournaments.models import Tournament, TournamentEntry
from apps.tournaments.registration_models import TournamentRegistration

tournament = Tournament.objects.get(id=X)

# Проверить TournamentEntry
entries = tournament.entries.all()
for e in entries:
    print(f"Entry: {e.team.player_1} - {e.team.player_2}")

# Проверить TournamentRegistration
registrations = TournamentRegistration.objects.filter(tournament=tournament)
for r in registrations:
    print(f"Registration: {r.player} + {r.partner} - {r.status}")
```

### Известные ограничения

1. **Производительность**: При большом количестве участников пересчёт статусов может занять время
2. **Уведомления**: Массовые изменения могут создать много уведомлений
3. **Конфликты**: Одновременное редактирование через сайт и Mini App может привести к race conditions

### Будущие улучшения

- [ ] Кэширование статусов для улучшения производительности
- [ ] Батчинг уведомлений при массовых изменениях
- [ ] Логирование всех операций синхронизации
- [ ] Административная панель для ручной синхронизации

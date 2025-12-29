# Регистрация на турниры

## Описание
Система регистрации на турниры через Mini-App с поиском напарника, очередью, автоматической синхронизацией с TournamentEntry.

## Файлы
- Backend: `apps/tournaments/models.py` (TournamentRegistration), `apps/tournaments/services/registration_service.py`, `apps/tournaments/signals.py`
- Frontend: `frontend/src/components/MiniApp/RegistrationModal.tsx`, `components/MiniApp/PartnerSearchModal.tsx`
- Docs: `docs/SYNCHRONIZATION_ARCHITECTURE.md`

## API

### POST /api/miniapp/tournaments/{id}/register/
Регистрация на турнир
```json
{
  "partner_id": 8,  // null если ищу напарника
  "looking_for_partner": false
}
```

### POST /api/miniapp/tournaments/{id}/cancel/
Отмена регистрации

### GET /api/miniapp/tournaments/{id}/registrations/
Список регистраций турнира

### POST /api/miniapp/tournaments/{id}/invite/
Пригласить напарника
```json
{
  "partner_telegram_id": 123456789
}
```

## Модель TournamentRegistration
```python
class TournamentRegistration(models.Model):
    tournament = ForeignKey(Tournament)
    telegram_user = ForeignKey(TelegramUser)
    partner = ForeignKey(TelegramUser, null=True)
    status = CharField(choices=[
        ('looking_for_partner', 'Ищу напарника'),
        ('invited', 'Приглашен'),
        ('main_list', 'Основной список'),
        ('reserve_list', 'Резервный список')
    ])
    registration_time = DateTimeField(auto_now_add=True)
    position_in_queue = IntegerField(null=True)
```

## Синхронизация TournamentEntry ↔ TournamentRegistration

**Сигналы:**
```python
@receiver(post_save, sender=TournamentEntry)
def sync_entry_to_registration(sender, instance, **kwargs):
    # При добавлении участника через веб → создать TournamentRegistration
    
@receiver(post_save, sender=TournamentRegistration)
def sync_registration_to_entry(sender, instance, **kwargs):
    # При регистрации через Mini-App → создать TournamentEntry
    # Только если есть напарник и турнир не заполнен
```

## Логика

**Регистрация с напарником:**
1. Проверить доступность мест
2. Создать TournamentRegistration для обоих
3. Создать Team
4. Создать TournamentEntry
5. Статус: main_list или reserve_list

**Поиск напарника:**
1. Создать TournamentRegistration со статусом looking_for_partner
2. Отобразить в списке "Ищут напарника"
3. Другие могут пригласить

**Приглашение:**
1. Отправить уведомление в Telegram
2. Создать TournamentRegistration со статусом invited
3. При принятии → создать Team и TournamentEntry

**Пересчет очереди:**
```python
def recalculate_queue(tournament):
    # 1. Получить все регистрации с напарником
    # 2. Сортировать по registration_time
    # 3. Первые planned_participants → main_list
    # 4. Остальные → reserve_list
    # 5. Обновить position_in_queue
```

## UI/UX (Mini-App)
- Кнопка "Зарегистрироваться"
- Выбор: "С напарником" или "Ищу напарника"
- Список "Ищут напарника"
- Отображение позиции в очереди
- Уведомления о приглашениях
- Кнопка "Отменить регистрацию"

## Статусы
- **looking_for_partner** - ищет напарника
- **invited** - приглашен кем-то
- **main_list** - в основном списке (есть место)
- **reserve_list** - в резерве (нет мест)

## Troubleshooting
- Дубли регистраций → проверить уникальность (tournament + telegram_user)
- Не синхронизируется → проверить сигналы
- Неверная очередь → вызвать recalculate_queue

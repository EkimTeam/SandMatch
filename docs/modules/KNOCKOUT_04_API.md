# Олимпийская система (Knockout) - Часть 4: API

## Основные endpoints

```
GET    /api/tournaments/{id}/brackets/{bid}/draw/           - Получить сетку
GET    /api/tournaments/{id}/brackets/{bid}/bye_positions/  - BYE позиции
POST   /api/tournaments/{id}/seed_bracket/                  - Автопосев
POST   /api/tournaments/{id}/brackets/{bid}/assign_participant/ - Назначить
DELETE /api/tournaments/{id}/brackets/{bid}/remove_participant/ - Удалить
POST   /api/tournaments/{id}/clear_bracket/                 - Очистить
POST   /api/tournaments/{id}/edit_settings/                 - Изменить размер
POST   /api/tournaments/{id}/brackets/{bid}/lock_participants/ - Зафиксировать
```

## Примеры запросов

### Автопосев
```json
POST /api/tournaments/42/seed_bracket/
{"bracket_id": 1}

Response: {"ok": true, "seeded_count": 4, "unseeded_count": 12}
```

### Назначить участника
```json
POST /api/tournaments/42/brackets/1/assign_participant/
{"match_id": 100, "slot": "team_1", "entry_id": 5}

Response: {"ok": true}
```

### Изменить размер
```json
POST /api/tournaments/42/edit_settings/
{"planned_participants": 32}

Response: {"ok": true, "old_size": 16, "new_size": 32}
```

## Backend реализация

См. `apps/tournaments/api_views.py` (строки 2200-2600)

---

**Версия:** 1.0  
**Дата:** 29 декабря 2024

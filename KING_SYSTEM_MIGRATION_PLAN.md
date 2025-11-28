# План миграции UX для системы "Кинг" (King-of-the-Court)

Дата: 28 ноября 2025

## Сводная таблица изменений

| # | Изменение | Round Robin | King | Приоритет |
|---|-----------|-------------|------|-----------|
| 1 | Drag-and-Drop участников | ✅ | **ТРЕБУЕТСЯ** | Высокий |
| 2 | Nullable позиции (модель) | ✅ | НЕ ТРЕБУЕТСЯ | - |
| 3 | add_participant для created | ✅ | **ТРЕБУЕТСЯ** | Высокий |
| 4 | set_participant_position | ✅ | НЕ ТРЕБУЕТСЯ | - |
| 5 | remove_participant | ✅ | НЕ ТРЕБУЕТСЯ | - |
| 6 | Автопосев | ✅ | **ТРЕБУЕТСЯ** | Средний |
| 7 | Очистка таблиц | ✅ | **ТРЕБУЕТСЯ** | Средний |
| 8 | DraggableParticipantList | ✅ | **ТРЕБУЕТСЯ** | Высокий |
| 9 | SimplifiedGroupTable | ✅ | **УТОЧНИТЬ** | Средний |
| 10 | Независимая прокрутка | ✅ | **ТРЕБУЕТСЯ** | Высокий |
| 11 | Вычисление размера групп | ✅ | НЕ ТРЕБУЕТСЯ | - |
| 12 | Рейтинг пары (средний) | ✅ | **ТРЕБУЕТСЯ** | Средний |
| 13 | Сортировка участников | ✅ | **ТРЕБУЕТСЯ** | Средний |
| 14 | Фильтрация null позиций | ✅ | **ТРЕБУЕТСЯ** | Низкий |

## Требуется реализовать

### Backend (apps/tournaments/api_views.py)

1. **add_participant** - добавить условие для KING:
```python
if (tournament.system in [Tournament.System.ROUND_ROBIN, Tournament.System.KING] 
    and tournament.status == 'created'):
    entry.group_index = None
    entry.row_index = None
```

2. **auto_seed** - добавить логику для KING:
```python
elif tournament.system == Tournament.System.KING:
    # Очистить позиции
    # Сортировка: рейтинг BP → профи → BTR → случайно
    # Распределить по группам (обычно 1)
```

3. **clear_tables** - добавить KING в условие:
```python
if tournament.system not in [Tournament.System.ROUND_ROBIN, Tournament.System.KING]:
    return Response({'error': 'Недоступно для этой системы'})
```

### Frontend (frontend/src/pages/KingPage.tsx)

1. **Добавить drag-and-drop интерфейс** для статуса `created`
2. **Интегрировать DraggableParticipantList**
3. **Создать KingParticipantTable** (упрощенная таблица с позициями)
4. **Применить независимую прокрутку** (knockout-content стили)
5. **Использовать средний рейтинг** для пар

### Backend Services (apps/tournaments/services/king.py)

1. **Фильтровать участников** с `group_index__isnull=False`
2. **Валидация** перед генерацией расписания

## Особенности Кинг-системы

- Участников: 4-16 (фиксированные значения)
- Обычно 1 группа
- Алгоритм Americano для расписания
- Порядок участников важен для генерации

## Вопросы для уточнения

1. **UI участников в created:** Таблица с позициями или простой список?
2. **Автопосев для нескольких групп:** Как распределять?
3. **Drag-and-drop между позициями:** Нужно ли менять порядок?

## Файлы для изменения

**Backend:**
- `apps/tournaments/api_views.py` (3 метода)
- `apps/tournaments/services/king.py` (фильтрация)

**Frontend:**
- `frontend/src/pages/KingPage.tsx` (основной)
- Создать: `frontend/src/components/KingParticipantTable.tsx`

**Стили:**
- `frontend/src/styles/knockout-dragdrop.css` (уже готов)

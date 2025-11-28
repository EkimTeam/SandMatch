# Технические детали миграции Кинг-системы

## 1. Backend: add_participant

**Файл:** `apps/tournaments/api_views.py`  
**Метод:** `add_participant`  
**Строки:** ~1966-1985

**Текущий код:**
```python
if tournament.system == Tournament.System.ROUND_ROBIN and tournament.status == 'created':
    entry.group_index = None
    entry.row_index = None
```

**Изменить на:**
```python
if tournament.system in [Tournament.System.ROUND_ROBIN, Tournament.System.KING] and tournament.status == 'created':
    entry.group_index = None
    entry.row_index = None
```

---

## 2. Backend: auto_seed

**Файл:** `apps/tournaments/api_views.py`  
**Метод:** `auto_seed`  
**Строки:** ~2336-2507

**Добавить после проверки ROUND_ROBIN:**
```python
elif tournament.system == Tournament.System.KING:
    # Очистить все позиции
    tournament.entries.filter(group_index__isnull=False).update(
        group_index=None,
        row_index=None
    )
    
    # Получить всех участников
    entries = list(tournament.entries.select_related(
        'team__player_1__btr_player',
        'team__player_2__btr_player'
    ).prefetch_related(
        'team__player_1__btr_player__snapshots',
        'team__player_2__btr_player__snapshots'
    ).all())
    
    if not entries:
        return Response({'ok': False, 'error': 'Нет участников'}, status=400)
    
    # Использовать те же функции сортировки
    sorted_entries = sorted(entries, key=sort_key)
    
    # Распределить по группам (обычно 1)
    groups_count = tournament.groups_count or 1
    
    if groups_count == 1:
        for idx, entry in enumerate(sorted_entries):
            entry.group_index = 1
            entry.row_index = idx
            entry.save(update_fields=['group_index', 'row_index'])
    else:
        # Равномерное распределение
        for idx, entry in enumerate(sorted_entries):
            group_num = (idx % groups_count) + 1
            row_num = idx // groups_count
            entry.group_index = group_num
            entry.row_index = row_num
            entry.save(update_fields=['group_index', 'row_index'])
    
    return Response({'ok': True, 'seeded_count': len(sorted_entries)})
```

---

## 3. Backend: clear_tables

**Файл:** `apps/tournaments/api_views.py`  
**Метод:** `clear_tables`  
**Строки:** ~2509-2535

**Текущий код:**
```python
if tournament.system != Tournament.System.ROUND_ROBIN:
    return Response({'ok': False, 'error': 'Очистка таблиц доступна только для круговой системы'}, status=400)
```

**Изменить на:**
```python
if tournament.system not in [Tournament.System.ROUND_ROBIN, Tournament.System.KING]:
    return Response({'ok': False, 'error': 'Очистка таблиц доступна только для круговой системы и кинг'}, status=400)
```

---

## 4. Backend Services: king.py

**Файл:** `apps/tournaments/services/king.py`

**Добавить фильтрацию в методы генерации:**
```python
def generate_matches_for_tournament(tournament: Tournament):
    # Получить только участников с позициями
    entries = TournamentEntry.objects.filter(
        tournament=tournament,
        group_index__isnull=False,
        row_index__isnull=False
    ).order_by('group_index', 'row_index')
    
    # ... остальная логика
```

---

## 5. Frontend: KingPage.tsx структура

**Файл:** `frontend/src/pages/KingPage.tsx`

**Добавить состояния:**
```tsx
const [dragDropState, setDragDropState] = useState<DragDropState>({
  participants: [],
  dropSlots: [],
  isSelectionLocked: false
});
const [dragDropPickerOpen, setDragDropPickerOpen] = useState(false);
```

**Добавить функции загрузки:**
```tsx
const loadParticipantsForDragDrop = async (tournamentData: Tournament) => {
  // Аналогично TournamentDetailPage.tsx
  // Создать slots для группы
  // Загрузить участников
  // Установить dragDropState
};
```

**Добавить обработчики:**
```tsx
const handleDropParticipant = async (groupIndex: number, rowIndex: number, participant: DraggableParticipant) => {
  // Установить позицию через API
};

const handleRemoveParticipant = async (groupIndex: number, rowIndex: number) => {
  // Убрать из позиции
};

const handleAutoSeed = async () => {
  // Вызвать /auto_seed/
};

const handleClearTables = async () => {
  // Вызвать /clear_tables/
};
```

**Рендер для статуса created:**
```tsx
{tournament.status === 'created' ? (
  <div className="knockout-content" style={{ height: 'calc(100vh - 300px)' }}>
    <div className="participants-panel">
      <DraggableParticipantList
        participants={dragDropState.participants}
        onRemoveParticipant={handleRemoveParticipantFromList}
        onAddParticipant={() => setDragDropPickerOpen(true)}
        onAutoSeed={handleAutoSeed}
        onClearTables={handleClearTables}
        maxParticipants={tournament.planned_participants || 16}
        canAddMore={true}
      />
    </div>
    
    <div className="bracket-panel">
      <KingParticipantTable
        groupIndex={0}
        groupName="Участники"
        dropSlots={dragDropState.dropSlots}
        onDrop={handleDropParticipant}
        onRemove={handleRemoveParticipant}
        canEdit={true}
      />
    </div>
  </div>
) : (
  // Существующий UI для active/completed
)}
```

---

## 6. Frontend: KingParticipantTable компонент

**Файл:** `frontend/src/components/KingParticipantTable.tsx` (создать новый)

```tsx
import React from 'react';
import { SimplifiedDropSlot, DraggableParticipant } from '../types/dragdrop';

interface Props {
  groupIndex: number;
  groupName: string;
  dropSlots: SimplifiedDropSlot[];
  onDrop: (groupIndex: number, rowIndex: number, participant: DraggableParticipant) => void;
  onRemove: (groupIndex: number, rowIndex: number) => void;
  canEdit: boolean;
}

export const KingParticipantTable: React.FC<Props> = ({
  groupIndex,
  groupName,
  dropSlots,
  onDrop,
  onRemove,
  canEdit
}) => {
  const handleDrop = (e: React.DragEvent, rowIndex: number) => {
    e.preventDefault();
    const data = e.dataTransfer.getData('application/json');
    if (data) {
      const participant = JSON.parse(data);
      onDrop(groupIndex, rowIndex, participant);
    }
  };

  return (
    <div className="king-participant-table">
      <h3>{groupName}</h3>
      <table className="table">
        <thead>
          <tr>
            <th style={{ width: 50 }}>#</th>
            <th>ФИО</th>
            <th style={{ width: 80 }}>Рейтинг</th>
            {canEdit && <th style={{ width: 50 }}></th>}
          </tr>
        </thead>
        <tbody>
          {dropSlots.map((slot) => (
            <tr
              key={`${slot.groupIndex}-${slot.rowIndex}`}
              onDrop={(e) => handleDrop(e, slot.rowIndex)}
              onDragOver={(e) => e.preventDefault()}
              className={slot.currentParticipant ? 'filled' : 'empty'}
            >
              <td>{slot.rowIndex + 1}</td>
              <td>
                {slot.currentParticipant ? (
                  <span>{slot.currentParticipant.name}</span>
                ) : (
                  <span className="placeholder">Перетащите участника</span>
                )}
              </td>
              <td>
                {slot.currentParticipant?.currentRating ? (
                  <span className="rating-badge">
                    {slot.currentParticipant.currentRating} <small>BP</small>
                  </span>
                ) : (
                  '-'
                )}
              </td>
              {canEdit && (
                <td>
                  {slot.currentParticipant && (
                    <button
                      className="btn-icon"
                      onClick={() => onRemove(slot.groupIndex, slot.rowIndex)}
                      title="Убрать"
                    >
                      ×
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
```

---

## 7. Стили

**Файл:** `frontend/src/styles/knockout-dragdrop.css` (уже есть)

Добавить специфичные стили для Кинг:
```css
.king-participant-table {
  margin-bottom: 24px;
}

.king-participant-table table {
  width: 100%;
  border-collapse: collapse;
}

.king-participant-table tr.empty {
  background-color: #f8f9fa;
}

.king-participant-table tr.filled {
  background-color: #e8f5e9;
}

.king-participant-table .placeholder {
  color: #999;
  font-style: italic;
}
```

---

## Порядок реализации

1. **Backend изменения** (1-2 часа)
   - add_participant
   - auto_seed
   - clear_tables
   - king.py фильтрация

2. **Frontend компонент** (2-3 часа)
   - KingParticipantTable
   - Стили

3. **Frontend интеграция** (3-4 часа)
   - KingPage.tsx состояния
   - Обработчики
   - Рендер для created

4. **Тестирование** (1-2 часа)
   - Добавление участников
   - Drag-and-drop
   - Автопосев
   - Очистка
   - Генерация расписания

**Итого:** 7-11 часов работы

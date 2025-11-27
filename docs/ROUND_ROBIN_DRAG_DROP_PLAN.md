# 🎯 План: Drag-and-Drop для круговых турниров и кинга

## 📝 Задача

Реализовать UX как в олимпийской системе для круговых турниров и кинга на этапе `created`:
- Список участников слева с drag-and-drop
- Упрощенные таблицы справа (только # и ФИО)
- После перехода в `active`/`completed` - полные таблицы

---

## 🎨 Концепция UX

### Status: `created` (Регистрация)

```
┌─────────────────────────────────────┐
│  Шапка турнира                      │
├──────────┬──────────────────────────┤
│ Список   │  Упрощенные таблицы      │
│ участни- │  ┌────┬──────────────┐   │
│ ков      │  │ #  │ ФИО          │   │
│          │  ├────┼──────────────┤   │
│ [Игрок1] │  │ 1  │ [DROP ZONE]  │   │
│ [Игрок2] │  │ 2  │ [DROP ZONE]  │   │
│ [Игрок3] │  │ 3  │ [DROP ZONE]  │   │
│          │  └────┴──────────────┘   │
│ + Добавить                          │
│ Автопосев                           │
└──────────┴──────────────────────────┘
```

### Status: `active` / `completed`

```
┌─────────────────────────────────────┐
│  Шапка турнира                      │
├─────────────────────────────────────┤
│  Полные таблицы                     │
│  ┌────┬──────┬───┬───┬───┬───┬───┐ │
│  │ #  │ ФИО  │ И │ В │ П │ О │ М │ │
│  ├────┼──────┼───┼───┼───┼───┼───┤ │
│  │ 1  │ Игр1 │ 5 │ 4 │ 1 │ 8 │ 2 │ │
│  │ 2  │ Игр2 │ 5 │ 3 │ 2 │ 6 │ 4 │ │
│  └────┴──────┴───┴───┴───┴───┴───┘ │
│                                     │
│  Расписание матчей...               │
└─────────────────────────────────────┘
```

---

## 🔧 Технические детали

### 1. Компоненты для переиспользования

Из `KnockoutPage.tsx`:
- ✅ `DraggableParticipantList` - список участников с drag-and-drop
- ✅ `KnockoutParticipantPicker` - модальное окно выбора участников
- ✅ `DragDropState` - типы для состояния drag-and-drop
- ✅ CSS стили из `knockout-dragdrop.css`

### 2. Новые компоненты

#### `SimplifiedGroupTable.tsx`
Упрощенная таблица для статуса `created`:

```tsx
interface SimplifiedGroupTableProps {
  groupIndex: number;
  groupName: string;
  plannedParticipants: number;
  dropSlots: DropSlot[];
  onDrop: (groupIndex: number, rowIndex: number, participant: DraggableParticipant) => void;
  onRemove: (groupIndex: number, rowIndex: number) => void;
  isLocked: boolean;
}

export const SimplifiedGroupTable: React.FC<SimplifiedGroupTableProps> = ({
  groupIndex,
  groupName,
  plannedParticipants,
  dropSlots,
  onDrop,
  onRemove,
  isLocked
}) => {
  return (
    <div className="simplified-group-table">
      <h3>{groupName}</h3>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>ФИО</th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: plannedParticipants }, (_, i) => {
            const slot = dropSlots.find(s => s.groupIndex === groupIndex && s.rowIndex === i);
            return (
              <tr key={i}>
                <td>{i + 1}</td>
                <td
                  data-drop-slot="true"
                  data-group-index={groupIndex}
                  data-row-index={i}
                  className={slot?.currentParticipant ? 'filled' : 'empty'}
                  onDragOver={handleDragOver}
                  onDrop={(e) => handleDrop(e, groupIndex, i)}
                >
                  {slot?.currentParticipant ? (
                    <>
                      {slot.currentParticipant.name}
                      {!isLocked && (
                        <button onClick={() => onRemove(groupIndex, i)}>×</button>
                      )}
                    </>
                  ) : (
                    <span className="placeholder">Перетащите участника</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
```

### 3. Модификации существующих компонентов

#### `TournamentDetailPage.tsx` (круговая система)

**Добавить:**
```tsx
// Состояние для Drag & Drop
const [dragDropState, setDragDropState] = useState<DragDropState>({
  participants: [],
  dropSlots: [],
  isSelectionLocked: false
});

// Загрузка участников для drag-and-drop
useEffect(() => {
  if (t?.status === 'created') {
    loadParticipantsForDragDrop();
  }
}, [t]);

const loadParticipantsForDragDrop = async () => {
  // Загрузить список всех участников турнира
  // Создать dropSlots для каждой группы и позиции
  // Отметить уже занятые позиции
};

const handleDrop = async (groupIndex: number, rowIndex: number, participant: DraggableParticipant) => {
  // API вызов для добавления участника в группу на позицию
  // Обновить состояние
};

const handleRemove = async (groupIndex: number, rowIndex: number) => {
  // API вызов для удаления участника с позиции
  // Обновить состояние
};

const handleAutoSeed = async () => {
  // Автоматическое распределение участников по группам
  // С учетом рейтинга (если есть)
};
```

**Рендеринг:**
```tsx
{t.status === 'created' ? (
  <div className="knockout-content">
    {/* Левая панель с участниками */}
    <div className="participants-panel">
      <DraggableParticipantList
        participants={dragDropState.participants}
        onRemoveParticipant={handleRemoveParticipant}
        onAddParticipant={() => setPickerOpen({ group: 0, row: 0 })}
        onAutoSeed={handleAutoSeed}
        maxParticipants={t.planned_participants || 32}
        canAddMore={canAddMoreParticipants}
      />
    </div>

    {/* Правая панель с упрощенными таблицами */}
    <div className="bracket-panel">
      {Array.from({ length: t.groups_count || 1 }, (_, gi) => (
        <SimplifiedGroupTable
          key={gi}
          groupIndex={gi}
          groupName={`Группа ${toRoman(gi + 1)}`}
          plannedParticipants={Math.ceil((t.planned_participants || 0) / (t.groups_count || 1))}
          dropSlots={dragDropState.dropSlots.filter(s => s.groupIndex === gi)}
          onDrop={handleDrop}
          onRemove={handleRemove}
          isLocked={dragDropState.isSelectionLocked}
        />
      ))}
    </div>
  </div>
) : (
  // Существующий рендеринг полных таблиц
  <div>
    {/* Полные таблицы с матчами, расписанием и т.д. */}
  </div>
)}
```

#### `KingPage.tsx`

Аналогичные изменения:
- Добавить `DragDropState`
- Использовать `DraggableParticipantList`
- Создать `SimplifiedGroupTable` для кинга
- Условный рендеринг в зависимости от статуса

### 4. API endpoints

Нужно проверить/создать:

```python
# apps/tournaments/api_views.py

@api_view(['POST'])
def add_participant_to_position(request, tournament_id):
    """
    Добавить участника на конкретную позицию в группе
    POST /api/tournaments/{id}/add_participant_position/
    Body: {
        "team_id": 123,
        "group_index": 0,
        "row_index": 2
    }
    """
    pass

@api_view(['POST'])
def remove_participant_from_position(request, tournament_id):
    """
    Удалить участника с позиции
    POST /api/tournaments/{id}/remove_participant_position/
    Body: {
        "group_index": 0,
        "row_index": 2
    }
    """
    pass

@api_view(['POST'])
def auto_seed_participants(request, tournament_id):
    """
    Автоматическое распределение участников по группам
    POST /api/tournaments/{id}/auto_seed/
    Body: {
        "seed_by_rating": true  # опционально
    }
    """
    pass
```

### 5. CSS стили

Переиспользовать из `knockout-dragdrop.css`:
- `.knockout-page-container`
- `.knockout-content`
- `.participants-panel`
- `.bracket-panel`
- `.participant-list`
- `.participant-item`
- `.drag-ghost`
- Все мобильные стили

Добавить новые:
```css
/* Упрощенная таблица группы */
.simplified-group-table {
  margin-bottom: 24px;
  border: 1px solid #e0e0e0;
  border-radius: 8px;
  overflow: hidden;
}

.simplified-group-table h3 {
  background: #f8f9fa;
  padding: 12px 16px;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  border-bottom: 1px solid #e0e0e0;
}

.simplified-group-table table {
  width: 100%;
  border-collapse: collapse;
}

.simplified-group-table th {
  background: #f8f9fa;
  padding: 8px 12px;
  text-align: left;
  font-weight: 600;
  font-size: 14px;
  border-bottom: 2px solid #dee2e6;
}

.simplified-group-table th:first-child {
  width: 50px;
  text-align: center;
}

.simplified-group-table td {
  padding: 12px;
  border-bottom: 1px solid #e9ecef;
}

.simplified-group-table td:first-child {
  text-align: center;
  color: #6c757d;
  font-weight: 600;
}

.simplified-group-table td[data-drop-slot] {
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  min-height: 48px;
}

.simplified-group-table td[data-drop-slot].empty {
  background: #f9fafb;
  border: 1px dashed #d1d5db;
}

.simplified-group-table td[data-drop-slot].empty:hover {
  background: #e9ecef;
  border-color: #adb5bd;
}

.simplified-group-table td[data-drop-slot].filled {
  background: white;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.simplified-group-table td[data-drop-slot].hover-highlight {
  background: #dbeafe !important;
  border-color: #2563eb !important;
  box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.2);
}

.simplified-group-table .placeholder {
  color: #9ca3af;
  font-style: italic;
  font-size: 13px;
}

/* Мобильная адаптация */
@media (max-width: 768px) {
  .simplified-group-table {
    margin-bottom: 16px;
  }
  
  .simplified-group-table h3 {
    font-size: 14px;
    padding: 8px 12px;
  }
  
  .simplified-group-table th,
  .simplified-group-table td {
    padding: 8px;
    font-size: 12px;
  }
}
```

---

## 📋 Этапы реализации

### Этап 1: Подготовка компонентов
- [ ] Создать `SimplifiedGroupTable.tsx`
- [ ] Создать типы `DropSlot` для круговых турниров
- [ ] Добавить CSS стили для упрощенных таблиц

### Этап 2: Backend API
- [ ] Проверить существующие endpoints для добавления/удаления участников
- [ ] Создать/модифицировать endpoints для позиционного добавления
- [ ] Реализовать автопосев с учетом рейтинга

### Этап 3: TournamentDetailPage (круговая)
- [ ] Добавить `DragDropState`
- [ ] Реализовать загрузку участников для drag-and-drop
- [ ] Реализовать обработчики `handleDrop`, `handleRemove`, `handleAutoSeed`
- [ ] Добавить условный рендеринг (created vs active/completed)
- [ ] Интегрировать `DraggableParticipantList`
- [ ] Интегрировать `SimplifiedGroupTable`

### Этап 4: KingPage
- [ ] Аналогичные изменения как для TournamentDetailPage
- [ ] Учесть специфику кинга (группы, раунды)

### Этап 5: Мобильная адаптация
- [ ] Применить стили из `knockout-dragdrop.css`
- [ ] Протестировать на мобильных устройствах
- [ ] Проверить drag-and-drop с touch events

### Этап 6: Тестирование
- [ ] Создание турнира
- [ ] Добавление участников через drag-and-drop
- [ ] Автопосев
- [ ] Удаление участников
- [ ] Фиксация участников
- [ ] Переход в active статус
- [ ] Проверка полных таблиц

---

## 🎯 Ожидаемый результат

### До изменений:
- ❌ Круговые турниры: сразу полные таблицы, неудобно добавлять участников
- ❌ Кинг: сразу полные таблицы, неудобно добавлять участников
- ❌ Разный UX для разных систем

### После изменений:
- ✅ Единый UX для всех систем (олимпийка, круговая, кинг)
- ✅ Удобное добавление участников через drag-and-drop
- ✅ Упрощенные таблицы на этапе формирования
- ✅ Полные таблицы после активации
- ✅ Автопосев с учетом рейтинга
- ✅ Мобильная адаптация

---

## 📝 Примечания

### Особенности круговой системы:
- Несколько групп
- Фиксированное количество участников в группе
- Автопосев должен распределять равномерно

### Особенности кинга:
- Одна группа (обычно)
- Динамическое количество участников
- Автопосев по рейтингу важнее

### Переиспользование кода:
- Максимально использовать компоненты из `KnockoutPage`
- Единые стили для всех систем
- Единая логика drag-and-drop

---

**Статус:** 📋 План готов к реализации  
**Приоритет:** 🔥 Высокий  
**Сложность:** ⭐⭐⭐ Средняя

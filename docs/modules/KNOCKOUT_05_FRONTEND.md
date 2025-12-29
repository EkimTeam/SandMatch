# Олимпийская система (Knockout) - Часть 5: Frontend и UI/UX

## Архитектура компонентов

### Главная страница
**Файл:** `frontend/src/pages/KnockoutPage.tsx` (1264 строки)

**Основные состояния:**
```typescript
const [dragDropState, setDragDropState] = useState<DragDropState>({
  participants: [],      // Список участников слева
  dropSlots: [],        // Слоты для drop в сетке
  isSelectionLocked: false  // Фиксация участников
});

const [byePositions, setByePositions] = useState<Set<number>>(new Set());
const [showFullNames, setShowFullNames] = useState(false);
```

### Компоненты

**1. DraggableParticipantList** - левая панель с участниками
- Drag & Drop из списка
- Кнопка "Добавить участника"
- Кнопка "Автопосев"
- Кнопка "Очистить сетку"
- Чекбокс "Зафиксировать"

**2. BracketWithSVGConnectors** - отображение сетки
- Раунды с матчами
- SVG линии между раундами
- Drop-зоны в первом раунде

**3. RoundComponent** - один раунд
- Матчи раунда
- Drop-зоны (только round_index=0)

## Drag & Drop логика

### Типы
```typescript
interface DraggableParticipant {
  id: number;
  name: string;
  rating: number;
  isInBracket: boolean;
}

interface DropSlot {
  matchId: number;
  slot: 'team_1' | 'team_2';
  currentParticipant: DraggableParticipant | null;
  isBye: boolean;
}
```

### Обработчики

**onDragStart:**
```typescript
const handleDragStart = (participant: DraggableParticipant) => {
  setDraggedParticipant(participant);
};
```

**onDrop:**
```typescript
const handleDrop = async (slot: DropSlot, participant: DraggableParticipant) => {
  if (slot.isBye) {
    alert('Нельзя разместить на BYE позицию');
    return;
  }
  
  // Оптимистичное обновление UI
  updateUIOptimistically(slot, participant);
  
  try {
    await api.post(`/tournaments/${id}/brackets/${bracketId}/assign_participant/`, {
      match_id: slot.matchId,
      slot: slot.slot,
      entry_id: participant.id
    });
  } catch (error) {
    // Откат изменений при ошибке
    rollbackUI();
    alert('Ошибка при размещении участника');
  }
};
```

## Отображение сетки

### SVG линии
```typescript
<svg className="bracket-connectors">
  {rounds.map((round, roundIndex) => 
    round.matches.map((match, matchIndex) => {
      if (roundIndex < rounds.length - 1) {
        const nextMatch = getNextRoundMatch(roundIndex, matchIndex);
        return (
          <line
            x1={matchX}
            y1={matchY}
            x2={nextMatchX}
            y2={nextMatchY}
            stroke="#ccc"
            strokeWidth="2"
          />
        );
      }
    })
  )}
</svg>
```

### Статусы матчей
```css
.match-scheduled { background: white; }
.match-live { background: #d4edda; }  /* Светло-зеленый */
.match-completed { background: #f8f9fa; }
.match-bye { background: #f5f5f5; border: 2px dashed #ccc; }
```

## Валидация

### Проверка заполненности
```typescript
const allSlotsFilled = useMemo(() => {
  return dropSlots.every(slot => 
    slot.isBye || slot.currentParticipant !== null
  );
}, [dropSlots]);

const canLock = allSlotsFilled && !dragDropState.isSelectionLocked;
```

### Чекбокс фиксации
```tsx
<input
  type="checkbox"
  checked={dragDropState.isSelectionLocked}
  onChange={handleLockParticipants}
  disabled={!canLock}
/>
<label>Зафиксировать участников</label>
```

## Troubleshooting

### Проблема: Участники исчезают после автопосева
**Причина:** Двойная загрузка `loadParticipants()`  
**Решение:** Убрать вызов после `handleAutoSeed()`

### Проблема: 400 при очистке сетки
**Причина:** Неправильный формат запроса  
**Решение:** Передавать `{match_id, slot}` вместо `{position}`

### Проблема: Чекбокс недоступен
**Причина:** Неправильный подсчет свободных мест  
**Решение:** Считать `freeSlotsInBracket` из `dropSlots`

---

**Версия:** 1.0  
**Дата:** 29 декабря 2024

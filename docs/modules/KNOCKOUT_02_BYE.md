# Олимпийская система (Knockout) - Часть 2: BYE позиции и ITF правила

## Описание BYE

**BYE** (от англ. "bye" - пропуск) - это пустая позиция в сетке, когда количество участников не является степенью двойки. Участник, получивший BYE, автоматически проходит в следующий раунд без игры.

### Зачем нужны BYE

Олимпийская система требует, чтобы количество участников в каждом раунде было степенью двойки (2, 4, 8, 16, 32...). Если участников меньше, используются BYE позиции.

**Примеры:**
- 5 участников → сетка 8 → 3 BYE
- 12 участников → сетка 16 → 4 BYE
- 20 участников → сетка 32 → 12 BYE

---

## ITF правила размещения BYE

### Основной принцип

BYE размещаются **симметрично** в верхней и нижней половинах сетки, чтобы:
1. Сильнейшие посевы не встречались раньше времени
2. Нагрузка распределялась равномерно
3. Сохранялась справедливость турнира

### Алгоритм расчета

```python
def calculate_bye_positions(bracket_size: int, num_participants: int) -> List[int]:
    """
    Рассчитать позиции BYE согласно правилам ITF.
    
    Args:
        bracket_size: размер сетки (степень двойки: 8, 16, 32...)
        num_participants: количество реальных участников
    
    Returns:
        Список позиций (1-based) для размещения BYE
    
    Алгоритм:
    1. Рассчитать количество BYE: num_byes = bracket_size - num_participants
    2. Сгенерировать ITF порядок позиций (рекурсивно)
    3. Взять первые num_byes позиций из ITF порядка
    4. Преобразовать в позиции BYE (противоположные)
    """
    if num_participants >= bracket_size:
        return []
    
    num_byes = bracket_size - num_participants
    
    # Генерация ITF порядка
    def generate_itf_positions(size: int) -> List[int]:
        """
        Генерация позиций в порядке ITF.
        
        Принцип: чередование верхней и нижней половин
        Для сетки 8: [1, 8, 4, 5, 2, 7, 3, 6]
        Для сетки 16: [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]
        """
        if size == 2:
            return [1, 2]
        
        positions = []
        half = size // 2
        
        # Рекурсивно генерируем для половины
        sub_positions = generate_itf_positions(half)
        
        for pos in sub_positions:
            positions.append(pos)              # Верхняя половина
            positions.append(size - pos + 1)   # Нижняя половина (зеркально)
        
        return positions
    
    itf_order = generate_itf_positions(bracket_size)
    
    # Берём первые num_byes позиций из ITF порядка
    opponent_positions = itf_order[:num_byes]
    
    # Преобразовать позиции противников в реальные позиции BYE
    # Если позиция нечетная → BYE на позиции +1
    # Если позиция четная → BYE на позиции -1
    bye_positions = []
    for pos in opponent_positions:
        if pos % 2 == 1:  # Нечетная
            bye_positions.append(pos + 1)
        else:  # Четная
            bye_positions.append(pos - 1)
    
    return sorted(bye_positions)
```

---

## Примеры расчета BYE

### Пример 1: Сетка 8, 5 участников

**Дано:**
- Размер сетки: 8
- Участников: 5
- BYE нужно: 3

**Шаг 1: ITF порядок для сетки 8**
```
generate_itf_positions(8):
  generate_itf_positions(4):
    generate_itf_positions(2): [1, 2]
    Для каждой позиции:
      1 → [1, 4]  (4 = 4 - 1 + 1)
      2 → [2, 3]  (3 = 4 - 2 + 1)
    Результат: [1, 4, 2, 3]
  
  Для каждой позиции:
    1 → [1, 8]  (8 = 8 - 1 + 1)
    4 → [4, 5]  (5 = 8 - 4 + 1)
    2 → [2, 7]  (7 = 8 - 2 + 1)
    3 → [3, 6]  (6 = 8 - 3 + 1)
  
  Результат: [1, 8, 4, 5, 2, 7, 3, 6]
```

**Шаг 2: Первые 3 позиции**
```
opponent_positions = [1, 8, 4]
```

**Шаг 3: Преобразование в BYE позиции**
```
Позиция 1 (нечетная) → BYE на 1 + 1 = 2
Позиция 8 (четная)   → BYE на 8 - 1 = 7
Позиция 4 (четная)   → BYE на 4 - 1 = 3

bye_positions = [2, 3, 7]
```

**Визуализация:**
```
Позиция 1: Участник 1 ─┐
Позиция 2: BYE ────────┘ → Участник 1 проходит автоматически

Позиция 3: BYE ────────┐
Позиция 4: Участник 2 ─┘ → Участник 2 проходит автоматически

Позиция 5: Участник 3 ─┐
Позиция 6: Участник 4 ─┘ → Играют между собой

Позиция 7: BYE ────────┐
Позиция 8: Участник 5 ─┘ → Участник 5 проходит автоматически
```

### Пример 2: Сетка 16, 12 участников

**Дано:**
- Размер сетки: 16
- Участников: 12
- BYE нужно: 4

**ITF порядок для сетки 16:**
```
[1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]
```

**Первые 4 позиции:**
```
opponent_positions = [1, 16, 8, 9]
```

**BYE позиции:**
```
1 (нечетная)  → BYE на 2
16 (четная)   → BYE на 15
8 (четная)    → BYE на 7
9 (нечетная)  → BYE на 10

bye_positions = [2, 7, 10, 15]
```

**Распределение:**
```
Матч 1:  Поз 1 (Участник) vs Поз 2 (BYE)
Матч 2:  Поз 3 (Участник) vs Поз 4 (Участник)
Матч 3:  Поз 5 (Участник) vs Поз 6 (Участник)
Матч 4:  Поз 7 (BYE) vs Поз 8 (Участник)
Матч 5:  Поз 9 (Участник) vs Поз 10 (BYE)
Матч 6:  Поз 11 (Участник) vs Поз 12 (Участник)
Матч 7:  Поз 13 (Участник) vs Поз 14 (Участник)
Матч 8:  Поз 15 (BYE) vs Поз 16 (Участник)
```

### Пример 3: Сетка 32, 20 участников

**Дано:**
- Размер сетки: 32
- Участников: 20
- BYE нужно: 12

**ITF порядок (первые 12):**
```
[1, 32, 16, 17, 8, 25, 9, 24, 4, 29, 13, 20]
```

**BYE позиции:**
```
1 → 2, 32 → 31, 16 → 15, 17 → 18,
8 → 7, 25 → 26, 9 → 10, 24 → 23,
4 → 3, 29 → 30, 13 → 14, 20 → 19

bye_positions = [2, 3, 7, 10, 14, 15, 18, 19, 23, 26, 30, 31]
```

---

## Создание BYE позиций в базе данных

### Функция создания

```python
@transaction.atomic
def create_bye_positions(bracket: KnockoutBracket, num_participants: int) -> int:
    """
    Создать DrawPosition записи для BYE в неполной сетке.
    
    Args:
        bracket: сетка турнира
        num_participants: количество реальных участников
    
    Returns:
        Количество созданных BYE позиций
    """
    bye_positions = calculate_bye_positions(bracket.size, num_participants)
    
    created_count = 0
    for position in bye_positions:
        DrawPosition.objects.create(
            bracket=bracket,
            position=position,
            entry=None,  # NULL для BYE
            source=DrawPosition.Source.BYE,
            seed=None
        )
        created_count += 1
    
    return created_count
```

### Модель DrawPosition для BYE

```python
class DrawPosition(models.Model):
    bracket = models.ForeignKey(KnockoutBracket)
    position = models.IntegerField()  # 1-based позиция
    entry = models.ForeignKey(TournamentEntry, null=True)  # NULL для BYE
    source = models.CharField(choices=Source.choices)
    seed = models.IntegerField(null=True)
    
    # Для BYE:
    # entry = None
    # source = 'BYE'
    # seed = None
```

---

## Обработка BYE в матчах

### Автоматическое продвижение

Когда один из участников матча - BYE, второй участник автоматически проходит в следующий раунд:

```python
def handle_bye_match(match: Match) -> None:
    """
    Обработать матч с BYE.
    
    Если один из участников NULL (BYE), второй автоматически побеждает.
    """
    if match.team_1 is None and match.team_2 is not None:
        # BYE vs Участник → Участник побеждает
        match.winner = match.team_2
        match.status = Match.Status.COMPLETED
        match.completed_at = timezone.now()
        match.save()
        
        # Продвинуть победителя в следующий раунд
        advance_winner(match)
    
    elif match.team_1 is not None and match.team_2 is None:
        # Участник vs BYE → Участник побеждает
        match.winner = match.team_1
        match.status = Match.Status.COMPLETED
        match.completed_at = timezone.now()
        match.save()
        
        # Продвинуть победителя в следующий раунд
        advance_winner(match)
    
    elif match.team_1 is None and match.team_2 is None:
        # BYE vs BYE → Не должно происходить
        raise ValueError("Матч BYE vs BYE недопустим")
```

### Фиксация участников

При фиксации участников (переход турнира в статус `active`) все BYE матчи автоматически завершаются:

```python
def lock_participants(tournament: Tournament) -> None:
    """
    Зафиксировать участников и начать турнир.
    
    Автоматически завершает все BYE матчи.
    """
    bracket = tournament.knockout_bracket
    
    # Найти все матчи первого раунда с BYE
    bye_matches = Match.objects.filter(
        bracket=bracket,
        round_index=0,
        status=Match.Status.SCHEDULED
    ).filter(
        Q(team_1__isnull=True) | Q(team_2__isnull=True)
    )
    
    # Завершить каждый BYE матч
    for match in bye_matches:
        handle_bye_match(match)
    
    # Изменить статус турнира
    tournament.status = Tournament.Status.ACTIVE
    tournament.save()
```

---

## Отображение BYE на Frontend

### Визуальное представление

**В сетке:**
```tsx
{slot.isBye ? (
  <div className="bye-slot">
    <span className="bye-label">BYE</span>
  </div>
) : slot.currentParticipant ? (
  <div className="participant-slot">
    {slot.currentParticipant.name}
  </div>
) : (
  <div className="empty-slot">
    Пусто
  </div>
)}
```

**CSS стили:**
```css
.bye-slot {
  background-color: #f5f5f5;
  border: 2px dashed #ccc;
  color: #999;
  font-style: italic;
  cursor: not-allowed;
}

.bye-slot:hover {
  border-color: #ff0000; /* Красная рамка при попытке дропа */
}
```

### Drag & Drop ограничения

BYE позиции **нельзя** изменить через drag & drop:

```typescript
const handleDrop = (slot: DropSlot, participant: Participant) => {
  // Проверка BYE
  if (slot.isBye) {
    alert('Нельзя разместить участника на позицию BYE');
    return;
  }
  
  // Продолжить обычную логику
  // ...
};
```

### Tooltip подсказки

```tsx
<Tooltip title={
  slot.isBye 
    ? "BYE позиция - участник автоматически проходит в следующий раунд"
    : "Перетащите участника сюда"
}>
  <div className={slot.isBye ? "bye-slot" : "drop-slot"}>
    {/* ... */}
  </div>
</Tooltip>
```

---

## Пересчет BYE при изменении участников

### Динамическое обновление

Когда количество участников изменяется, BYE позиции пересчитываются:

```python
def update_bye_positions(bracket: KnockoutBracket) -> None:
    """
    Пересчитать BYE позиции на основе текущего количества участников.
    """
    # Подсчитать реальных участников
    num_participants = TournamentEntry.objects.filter(
        tournament=bracket.tournament,
        group_index=1  # В сетке
    ).count()
    
    # Рассчитать новые BYE позиции
    new_bye_positions = set(calculate_bye_positions(bracket.size, num_participants))
    
    # Получить текущие BYE позиции
    current_bye_positions = set(
        DrawPosition.objects.filter(
            bracket=bracket,
            source='BYE'
        ).values_list('position', flat=True)
    )
    
    # Удалить старые BYE (если участников стало больше)
    to_remove = current_bye_positions - new_bye_positions
    if to_remove:
        DrawPosition.objects.filter(
            bracket=bracket,
            position__in=to_remove,
            source='BYE'
        ).update(source='MAIN')
    
    # Добавить новые BYE (если участников стало меньше)
    to_add = new_bye_positions - current_bye_positions
    for position in to_add:
        DrawPosition.objects.update_or_create(
            bracket=bracket,
            position=position,
            defaults={
                'entry': None,
                'source': 'BYE',
                'seed': None
            }
        )
```

---

## Валидация BYE

### Проверки корректности

```python
def validate_bye_positions(bracket: KnockoutBracket) -> List[str]:
    """
    Проверить корректность BYE позиций.
    
    Returns:
        Список ошибок (пустой если всё ок)
    """
    errors = []
    
    # 1. Проверить что BYE позиции рассчитаны правильно
    num_participants = DrawPosition.objects.filter(
        bracket=bracket,
        entry__isnull=False
    ).count()
    
    expected_byes = set(calculate_bye_positions(bracket.size, num_participants))
    actual_byes = set(
        DrawPosition.objects.filter(
            bracket=bracket,
            source='BYE'
        ).values_list('position', flat=True)
    )
    
    if expected_byes != actual_byes:
        errors.append(
            f"BYE позиции не совпадают. "
            f"Ожидается: {expected_byes}, фактически: {actual_byes}"
        )
    
    # 2. Проверить что BYE позиции не имеют участников
    bye_with_entry = DrawPosition.objects.filter(
        bracket=bracket,
        source='BYE',
        entry__isnull=False
    ).count()
    
    if bye_with_entry > 0:
        errors.append(f"Найдено {bye_with_entry} BYE позиций с участниками")
    
    # 3. Проверить что нет матчей BYE vs BYE
    bye_vs_bye = Match.objects.filter(
        bracket=bracket,
        round_index=0,
        team_1__isnull=True,
        team_2__isnull=True
    ).count()
    
    if bye_vs_bye > 0:
        errors.append(f"Найдено {bye_vs_bye} матчей BYE vs BYE")
    
    return errors
```

---

## Продолжение

- [Часть 1: Обзор и архитектура](KNOCKOUT_01_OVERVIEW.md)
- [Часть 3: Автопосев участников](KNOCKOUT_03_SEEDING.md)
- [Часть 4: API и интеграция](KNOCKOUT_04_API.md)
- [Часть 5: Frontend и UI/UX](KNOCKOUT_05_FRONTEND.md)

---

**Версия:** 1.0  
**Дата:** 29 декабря 2024

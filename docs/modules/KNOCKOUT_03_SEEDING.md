# Олимпийская система (Knockout) - Часть 3: Автопосев участников

## Описание

Автопосев (seeding) - это процесс расстановки участников в сетке турнира с учетом их рейтинга и правил ITF. Цель - обеспечить справедливое распределение сильных участников по разным частям сетки, чтобы они встретились только на поздних стадиях турнира.

---

## Правила посева по ITF

### Основные принципы

1. **Сеянные участники** - сильнейшие игроки, которые размещаются на фиксированных позициях
2. **Количество сеянных** зависит от размера сетки
3. **Seed 1 и Seed 2** всегда в разных половинах сетки (встретятся только в финале)
4. **Seeds 3-4** размещаются так, чтобы встретиться с Seeds 1-2 только в полуфиналах
5. **Несеянные участники** распределяются случайно на оставшиеся позиции

### Количество сеянных участников

```python
SEEDS_COUNT_MAP = {
    4: 2,      # Сетка 4 → 2 сеянных (50%)
    8: 2,      # Сетка 8 → 2 сеянных (25%)
    16: 4,     # Сетка 16 → 4 сеянных (25%)
    32: 8,     # Сетка 32 → 8 сеянных (25%)
    64: 16,    # Сетка 64 → 16 сеянных (25%)
    128: 32,   # Сетка 128 → 32 сеянных (25%)
    256: 64,
    512: 128,
}
```

**Правило:** Для сеток >= 16 количество сеянных = размер_сетки / 4

---

## Позиции сеянных участников

### Сетка 8

```python
SEED_POSITIONS_MAP[8] = {
    1: 1,   # Seed 1 → позиция 1 (верх сетки)
    2: 8,   # Seed 2 → позиция 8 (низ сетки)
    3: 5,   # Seed 3 → позиция 5 (середина низа)
    4: 4,   # Seed 4 → позиция 4 (середина верха)
}
```

**Визуализация:**
```
1. Seed 1 ─┐
           ├─ (1/4)
4. Seed 4 ─┘       ├─ (1/2)
                   │
5. Seed 3 ─┐       │
           ├─ (1/4)│
8. Seed 2 ─┘       ├─ Финал
```

### Сетка 16

```python
SEED_POSITIONS_MAP[16] = {
    1: 1,    # Seed 1 → позиция 1
    2: 16,   # Seed 2 → позиция 16
    3: 9,    # Seed 3 → позиция 9
    4: 8,    # Seed 4 → позиция 8
    5: 5,    # Seed 5 → позиция 5
    6: 12,   # Seed 6 → позиция 12
    7: 13,   # Seed 7 → позиция 13
    8: 4,    # Seed 8 → позиция 4
}
```

**Логика распределения:**
- Seeds 1-2: крайние позиции (1 и 16)
- Seeds 3-4: середины половин (8 и 9)
- Seeds 5-8: четвертьфинальные позиции

### Сетка 32

```python
SEED_POSITIONS_MAP[32] = {
    1: 1, 2: 32,      # Крайние
    3: 16, 4: 17,     # Середины половин
    5: 8, 6: 25,      # Четвертьфиналы
    7: 9, 8: 24,
    9: 4, 10: 29,     # 1/8 финала
    11: 13, 12: 20,
    13: 5, 14: 28,
    15: 12, 16: 21,
}
```

---

## Алгоритм автопосева

### Полный процесс

```python
def auto_seed_participants(bracket: KnockoutBracket, entries: List[TournamentEntry]) -> None:
    """
    Автоматический посев участников согласно правилам ITF.
    
    Шаги:
    1. Сортировка по рейтингу (случайно при равных)
    2. Определение сеянных игроков
    3. Специальная обработка для участников с нулевым рейтингом
    4. Расстановка сеянных по ITF позициям
    5. Случайное распределение остальных (учитывая BYE)
    6. Назначение в матчи первого раунда
    """
```

### Шаг 1: Сортировка по рейтингу

```python
# Группировка по рейтингу
from collections import defaultdict
rating_groups = defaultdict(list)

for entry in entries:
    # Получаем рейтинг команды (сумма рейтингов игроков)
    team = entry.team
    rating = 0
    if team:
        if team.player_1:
            rating += team.player_1.current_rating or 0
        if team.player_2:
            rating += team.player_2.current_rating or 0
    rating_groups[rating].append(entry)

# Сортируем группы по рейтингу (убывание) 
# и перемешиваем внутри каждой группы
sorted_entries = []
for rating in sorted(rating_groups.keys(), reverse=True):
    group = rating_groups[rating]
    random.shuffle(group)  # Случайный порядок при равных рейтингах
    sorted_entries.extend(group)
```

**Пример:**
```
Участники с рейтингами: [1500, 1200, 1200, 1000, 1000, 1000, 800]

Группировка:
1500: [Участник A]
1200: [Участник B, Участник C]
1000: [Участник D, Участник E, Участник F]
800:  [Участник G]

После сортировки и перемешивания:
[A, C, B, F, D, E, G]  (B и C случайно, D, E, F случайно)
```

### Шаг 2: Определение сеянных

```python
size = bracket.size
seeds_count = SEEDS_COUNT_MAP.get(size, 0)

# Первые seeds_count участников становятся сеянными
seeded = sorted_entries[:seeds_count]
unseeded = sorted_entries[seeds_count:]
```

### Шаг 3: Специальная обработка нулевых рейтингов

Если среди сеянных больше одного участника с рейтингом 0, применяется специальное правило:

```python
if seeds_count > 0 and len(sorted_entries) >= seeds_count:
    seeded = sorted_entries[:seeds_count]
    zero_rating_count = sum(1 for e in seeded if _get_entry_rating(e) == 0)
    
    if zero_rating_count > 1:
        # Ищем специального участника в списке
        special_entry_index = None
        for i, entry in enumerate(sorted_entries):
            if _is_special_participant(entry):
                special_entry_index = i
                break
        
        # Если найден и не на последней сеянной позиции
        if special_entry_index is not None and special_entry_index != seeds_count - 1:
            special_entry = sorted_entries.pop(special_entry_index)
            # Меняем местами с последним сеянным
            if special_entry_index < seeds_count:
                sorted_entries.insert(seeds_count - 1, special_entry)
            else:
                last_seeded = sorted_entries[seeds_count - 1]
                sorted_entries[seeds_count - 1] = special_entry
                sorted_entries.insert(special_entry_index, last_seeded)
```

**Цель:** Обеспечить, чтобы специальный участник (например, победитель предыдущего турнира) получил последний сеянный номер среди участников с нулевым рейтингом.

### Шаг 4: Обновление BYE позиций

```python
from apps.tournaments.models import DrawPosition as DP

# Убедимся, что все позиции существуют
total_positions = set(range(1, size + 1))
existing_positions = set(DP.objects.filter(bracket=bracket).values_list('position', flat=True))
missing_positions = [p for p in total_positions if p not in existing_positions]

if missing_positions:
    DP.objects.bulk_create([DP(bracket=bracket, position=p) for p in missing_positions])

# Рассчитать BYE позиции
num_participants = len([e for e in entries if e.team_id or getattr(e, 'team', None)])
computed_bye_positions = set(calculate_bye_positions(size, num_participants))

# Сбросить все BYE, затем выставить по рассчитанному набору
DP.objects.filter(bracket=bracket, source='BYE').update(source=DP.Source.MAIN)
if computed_bye_positions:
    DP.objects.filter(bracket=bracket, position__in=computed_bye_positions).update(
        entry=None, 
        source=DP.Source.BYE, 
        seed=None
    )
```

### Шаг 5: Получение позиций для сеянных

```python
def _get_itf_seed_positions(size: int, seeds_count: int) -> Dict[int, int]:
    """
    Получить позиции для сеянных игроков согласно ITF правилам.
    
    Returns:
        Dict[seed_number, position]
    """
    if size not in SEED_POSITIONS_GROUPS or seeds_count == 0:
        return {}
    
    groups = SEED_POSITIONS_GROUPS[size]
    result = {}
    seed_num = 1
    
    for group in groups:
        # Перемешиваем позиции внутри группы (кроме первых двух)
        if len(result) >= 2:  # После seed 1 и 2
            positions = group.copy()
            random.shuffle(positions)
        else:
            positions = group
        
        for position in positions:
            if seed_num <= seeds_count:
                result[seed_num] = position
                seed_num += 1
            else:
                break
        
        if seed_num > seeds_count:
            break
    
    return result
```

**Группы позиций для сетки 16:**
```python
SEED_POSITIONS_GROUPS[16] = [
    [1],        # Seed 1 всегда на позиции 1
    [16],       # Seed 2 всегда на позиции 16
    [9, 8],     # Seeds 3-4 случайно на 8 или 9
]
```

**Пример результата:**
```python
{
    1: 1,   # Seed 1 → позиция 1
    2: 16,  # Seed 2 → позиция 16
    3: 8,   # Seed 3 → позиция 8 (случайно выбрано из [9, 8])
    4: 9,   # Seed 4 → позиция 9
}
```

### Шаг 6: Определение свободных позиций

```python
# Получить позиции BYE
bye_positions = set(DrawPosition.objects.filter(
    bracket=bracket,
    source='BYE'
).values_list('position', flat=True))

# Создать список всех позиций и разделить на сеянные и свободные
all_positions = set(range(1, size + 1))
available_positions = all_positions - bye_positions - set(seed_positions.values())
available_positions = list(available_positions)
random.shuffle(available_positions)  # Случайный порядок
```

**Пример для сетки 8, 5 участников:**
```
Все позиции: {1, 2, 3, 4, 5, 6, 7, 8}
BYE позиции: {2, 3, 7}
Сеянные позиции: {1, 8}
Свободные позиции: {4, 5, 6}
После перемешивания: [6, 4, 5] (случайный порядок)
```

### Шаг 7: Очистка текущих привязок

```python
# Очистить текущие привязки (кроме BYE)
DrawPosition.objects.filter(
    bracket=bracket
).exclude(source='BYE').update(entry=None, seed=None)
```

### Шаг 8: Расстановка сеянных игроков

```python
for seed_num, position in seed_positions.items():
    if seed_num <= len(sorted_entries):
        entry = sorted_entries[seed_num - 1]
        DrawPosition.objects.update_or_create(
            bracket=bracket,
            position=position,
            defaults={
                'entry': entry,
                'source': DrawPosition.Source.MAIN,
                'seed': seed_num
            }
        )
```

**Результат:**
```
Позиция 1: Seed 1 (Участник A, рейтинг 1500)
Позиция 8: Seed 2 (Участник C, рейтинг 1200)
```

### Шаг 9: Расстановка несеянных участников

```python
unseeded_entries = sorted_entries[seeds_count:]
for i, entry in enumerate(unseeded_entries):
    if i < len(available_positions):
        position = available_positions[i]
        DrawPosition.objects.update_or_create(
            bracket=bracket,
            position=position,
            defaults={
                'entry': entry,
                'source': DrawPosition.Source.MAIN,
                'seed': None
            }
        )
```

**Результат:**
```
Позиция 6: Участник B (рейтинг 1200, несеянный)
Позиция 4: Участник F (рейтинг 1000, несеянный)
Позиция 5: Участник D (рейтинг 1000, несеянный)
```

### Шаг 10: Назначение в матчи первого раунда

```python
def _assign_draw_to_matches(bracket: KnockoutBracket) -> None:
    """
    Назначить участников из DrawPosition в матчи первого раунда.
    
    Важно: НЕ выполняет автопродвижение BYE - 
    это должно происходить только при фиксации.
    """
    first_round_matches = Match.objects.filter(
        bracket=bracket,
        round_index=0
    ).order_by('order_in_round')
    
    for match in first_round_matches:
        # Определить позиции для этого матча
        pos1 = ((match.order_in_round - 1) * 2) + 1
        pos2 = ((match.order_in_round - 1) * 2) + 2
        
        # Получить участников из DrawPosition
        dp1 = DrawPosition.objects.filter(bracket=bracket, position=pos1).first()
        dp2 = DrawPosition.objects.filter(bracket=bracket, position=pos2).first()
        
        match.team_1 = dp1.entry.team if dp1 and dp1.entry else None
        match.team_2 = dp2.entry.team if dp2 and dp2.entry else None
        
        # Очистить winner и статус - автопродвижение произойдёт только при фиксации
        match.winner = None
        match.status = Match.Status.SCHEDULED
        
        match.save(update_fields=['team_1', 'team_2', 'winner', 'status'])
```

---

## Полный пример автопосева

### Исходные данные

**Турнир:** Сетка 8, 5 участников

**Участники с рейтингами:**
```
A: 1500
B: 1200
C: 1200
D: 1000
E: 1000
```

### Процесс

**1. Сортировка:**
```
[A(1500), C(1200), B(1200), E(1000), D(1000)]
(B и C случайно, D и E случайно)
```

**2. Определение сеянных:**
```
Сеянные (2): [A, C]
Несеянные (3): [B, E, D]
```

**3. BYE позиции:**
```
calculate_bye_positions(8, 5) = [2, 3, 7]
```

**4. Позиции сеянных:**
```
Seed 1 (A) → позиция 1
Seed 2 (C) → позиция 8
```

**5. Свободные позиции:**
```
Все: {1,2,3,4,5,6,7,8}
BYE: {2,3,7}
Сеянные: {1,8}
Свободные: {4,5,6}
После shuffle: [6,4,5]
```

**6. Расстановка несеянных:**
```
B → позиция 6
E → позиция 4
D → позиция 5
```

**7. Итоговая сетка:**
```
Позиция 1: A (Seed 1, 1500)
Позиция 2: BYE
Позиция 3: BYE
Позиция 4: E (1000)
Позиция 5: D (1000)
Позиция 6: B (1200)
Позиция 7: BYE
Позиция 8: C (Seed 2, 1200)
```

**8. Матчи первого раунда:**
```
Матч 1: A vs BYE       → A проходит автоматически
Матч 2: BYE vs E       → E проходит автоматически
Матч 3: D vs B         → Играют между собой
Матч 4: BYE vs C       → C проходит автоматически
```

---

## Вспомогательные функции

### Получение рейтинга команды

```python
def _get_entry_rating(entry: TournamentEntry) -> int:
    """
    Получить рейтинг команды для сортировки.
    Для пар - среднее арифметическое с округлением до целых.
    Для одиночек - рейтинг игрока.
    """
    team = entry.team
    rating = 0
    if team:
        if team.player_1 and team.player_2:
            r1 = team.player_1.current_rating or 0
            r2 = team.player_2.current_rating or 0
            rating = round((r1 + r2) / 2)
        elif team.player_1:
            rating = team.player_1.current_rating or 0
    return rating
```

**Примеры:**
```python
# Одиночка
team = Team(player_1=Player(current_rating=1200))
_get_entry_rating(entry) → 1200

# Пара
team = Team(
    player_1=Player(current_rating=1200),
    player_2=Player(current_rating=1000)
)
_get_entry_rating(entry) → 1100  # round((1200 + 1000) / 2)

# Нулевой рейтинг
team = Team(player_1=Player(current_rating=0))
_get_entry_rating(entry) → 0
```

### Проверка специального участника

```python
def _is_special_participant(entry: TournamentEntry) -> bool:
    """Проверить, является ли участник специальным (для внутренней логики)."""
    team = entry.team
    if not team:
        return False
    
    # Проверяем имя игрока или пары
    team_name = str(team)
    return "Петров Михаил" in team_name
```

**Использование:** Для специальной обработки победителей предыдущих турниров или почетных участников.

---

## Обновление TournamentEntry

После автопосева необходимо обновить поля `group_index` и `row_index` у участников:

```python
# Обновить участников, которые попали в сетку
for dp in DrawPosition.objects.filter(bracket=bracket, entry__isnull=False):
    entry = dp.entry
    entry.group_index = 1  # 1 = в сетке
    entry.row_index = dp.position
    entry.save(update_fields=['group_index', 'row_index'])

# Обнулить у тех, кто не попал
remaining_entries = TournamentEntry.objects.filter(
    tournament=bracket.tournament
).exclude(
    id__in=DrawPosition.objects.filter(bracket=bracket, entry__isnull=False).values_list('entry_id', flat=True)
)
remaining_entries.update(group_index=None, row_index=None)
```

---

## Продолжение

- [Часть 1: Обзор и архитектура](KNOCKOUT_01_OVERVIEW.md)
- [Часть 2: BYE позиции и ITF правила](KNOCKOUT_02_BYE.md)
- [Часть 4: API и интеграция](KNOCKOUT_04_API.md)
- [Часть 5: Frontend и UI/UX](KNOCKOUT_05_FRONTEND.md)

---

**Версия:** 1.0  
**Дата:** 5 января 2026

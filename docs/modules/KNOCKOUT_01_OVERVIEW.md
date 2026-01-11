# Олимпийская система (Knockout) - Часть 1: Обзор и архитектура

## Описание

Олимпийская система (плей-офф, knockout) - турнирная система с одним выбыванием, где проигравший участник выбывает из турнира. Система поддерживает:
- Автоматический расчет размера сетки (ближайшая степень двойки)
- BYE позиции по правилам ITF для неполных сеток
- Автопосев участников по рейтингу с соблюдением ITF правил
- Ручную расстановку через drag & drop интерфейс
- Матч за 3-е место
- Динамическое изменение размера сетки

---

## Архитектура системы

### Backend компоненты

#### Основные файлы

**Сервисный слой:**
```
apps/tournaments/services/knockout.py (643 строки)
├── Вспомогательные функции
│   ├── validate_bracket_size() - проверка размера сетки
│   ├── calculate_bye_positions() - расчет BYE позиций по ITF
│   └── calculate_rounds_structure() - структура раундов
├── Генерация матчей
│   ├── generate_initial_matches() - создание пустых матчей
│   └── create_bye_positions() - создание BYE позиций
├── Посев участников
│   ├── auto_seed_participants() - автопосев по ITF
│   ├── seed_participants() - основная функция посева
│   └── _assign_draw_to_matches() - назначение в матчи
└── Продвижение победителей
    └── advance_winner() - продвижение в следующий раунд
```

**API слой:**
```
apps/tournaments/api_views.py
├── KnockoutViewSet
│   ├── bracket_draw() - GET данные сетки
│   ├── bye_positions() - GET позиции BYE
│   ├── seed_bracket() - POST автопосев
│   ├── assign_participant() - POST назначить участника
│   ├── remove_participant() - DELETE удалить участника
│   └── clear_bracket() - POST очистить сетку
└── TournamentViewSet
    └── edit_settings() - POST изменить настройки (размер сетки)
```

**Создание турнира:**
```
apps/tournaments/api_new_knockout.py
└── create_knockout_tournament() - создание нового турнира
```

#### Модели данных

**KnockoutBracket** (`apps/tournaments/models.py`)
```python
class KnockoutBracket(models.Model):
    tournament = models.OneToOneField(Tournament, on_delete=models.CASCADE)
    index = models.IntegerField(default=1)  # Номер сетки (обычно 1)
    size = models.IntegerField()  # Размер сетки: 4, 8, 16, 32, 64...
    has_third_place = models.BooleanField(default=True)  # Матч за 3 место
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        unique_together = [['tournament', 'index']]
```

**DrawPosition** (`apps/tournaments/models.py`)
```python
class DrawPosition(models.Model):
    """Позиция в жеребьевке олимпийской системы"""
    
    class Source(models.TextChoices):
        MAIN = 'MAIN', 'Основная сетка'
        BYE = 'BYE', 'BYE (пустая позиция)'
        QUALIFIER = 'QUALIFIER', 'Из квалификации'
    
    bracket = models.ForeignKey(KnockoutBracket, on_delete=models.CASCADE)
    position = models.IntegerField()  # Позиция 1-based (1, 2, 3...)
    entry = models.ForeignKey(TournamentEntry, null=True, on_delete=models.SET_NULL)
    source = models.CharField(max_length=20, choices=Source.choices, default=Source.MAIN)
    seed = models.IntegerField(null=True, blank=True)  # Номер посева (1, 2, 3...)
    
    class Meta:
        unique_together = [['bracket', 'position']]
        ordering = ['position']
```

**Match** (`apps/matches/models.py`)
```python
class Match(models.Model):
    """Матч в турнире"""
    
    class Status(models.TextChoices):
        SCHEDULED = 'scheduled', 'Запланирован'
        IN_PROGRESS = 'in_progress', 'Идет'
        COMPLETED = 'completed', 'Завершен'
        CANCELLED = 'cancelled', 'Отменен'
    
    tournament = models.ForeignKey(Tournament, on_delete=models.CASCADE)
    bracket = models.ForeignKey(KnockoutBracket, null=True, on_delete=models.CASCADE)
    
    # Участники
    team_1 = models.ForeignKey(Team, null=True, related_name='matches_as_team_1')
    team_2 = models.ForeignKey(Team, null=True, related_name='matches_as_team_2')
    winner = models.ForeignKey(Team, null=True, related_name='won_matches')
    
    # Позиция в сетке
    round_index = models.IntegerField()  # 0 = первый раунд, 1 = второй...
    round_name = models.CharField(max_length=50)  # "1/8 финала", "Полуфинал"...
    order_in_round = models.IntegerField()  # Порядковый номер в раунде
    is_third_place = models.BooleanField(default=False)  # Матч за 3 место
    
    # Статус и время
    status = models.CharField(max_length=20, choices=Status.choices)
    started_at = models.DateTimeField(null=True)
    completed_at = models.DateTimeField(null=True)
```

**TournamentEntry** (`apps/tournaments/models.py`)
```python
class TournamentEntry(models.Model):
    """Участник турнира"""
    tournament = models.ForeignKey(Tournament, on_delete=models.CASCADE)
    team = models.ForeignKey(Team, on_delete=models.CASCADE)
    
    # Для knockout: group_index=1 означает "в сетке", null - в левом списке
    group_index = models.IntegerField(null=True)
    row_index = models.IntegerField(null=True)  # Позиция в сетке (1-based)
    
    is_out_of_competition = models.BooleanField(default=False)
```

---

### Frontend компоненты

#### Основные файлы

**Страница турнира:**
```
frontend/src/pages/KnockoutPage.tsx (1000+ строк)
├── Состояние
│   ├── data - данные сетки (раунды, матчи)
│   ├── byePositions - позиции BYE
│   ├── dragDropState - состояние drag & drop
│   └── tMeta - метаданные турнира
├── Загрузка данных
│   ├── loadDraw() - загрузить сетку
│   ├── loadParticipants() - загрузить участников
│   └── useEffect - синхронизация isInBracket
├── Обработчики
│   ├── handleAutoSeed() - автопосев
│   ├── handleDrop() - drag & drop участника
│   ├── handleRemoveFromSlot() - удалить из слота
│   ├── handleClearBracket() - очистить сетку
│   └── handleLockParticipants() - зафиксировать участников
└── Рендеринг
    ├── DraggableParticipantList - левый список
    └── BracketWithSVGConnectors - сетка с SVG линиями
```

**Компонент сетки:**
```
frontend/src/components/BracketWithSVGConnectors.tsx
├── Отрисовка раундов
│   └── RoundComponent для каждого раунда
├── SVG линии
│   └── Соединение матчей между раундами
└── Responsive layout
    └── Адаптация под размер экрана
```

**Компонент раунда:**
```
frontend/src/components/RoundComponent.tsx
├── Список матчей раунда
├── Вертикальное выравнивание
└── Отображение участников и счета
```

**Drag & Drop список:**
```
frontend/src/components/DraggableParticipantList.tsx
├── Список участников вне сетки
├── Drag источник
├── Отображение "в сетке" метки
└── Кнопки управления
    ├── Автопосев
    ├── Очистить сетку
    └── Зафиксировать участников
```

**Стили:**
```
frontend/src/styles/knockout-dragdrop.css
├── Стили drag & drop
├── Стили слотов (обычный, BYE, hover)
└── Анимации
```

---

## Константы и конфигурация

### Размеры сетки

Размер сетки должен быть степенью двойки:
```python
VALID_SIZES = [4, 8, 16, 32, 64, 128, 256, 512]
```

Расчет размера для N участников:
```python
def next_power_of_two(n):
    """Ближайшая степень двойки >= n"""
    if n <= 1:
        return 1
    return 1 << (n - 1).bit_length()

# Примеры:
# 5 участников → сетка 8
# 12 участников → сетка 16
# 20 участников → сетка 32
```

### Названия раундов

```python
ROUND_NAMES = {
    1: "Финал",
    2: "Полуфинал",
    4: "1/4 финала",
    8: "1/8 финала",
    16: "1/16 финала",
    32: "1/32 финала",
    64: "1/64 финала",
}
```

### Количество сеянных участников

```python
SEEDS_COUNT_MAP = {
    4: 2,    # Сетка 4 → 2 сеянных
    8: 2,    # Сетка 8 → 2 сеянных
    16: 4,   # Сетка 16 → 4 сеянных
    32: 8,   # Сетка 32 → 8 сеянных
    64: 16,  # Сетка 64 → 16 сеянных
    128: 32,
    256: 64,
    512: 128,
}
```

### Позиции сеянных (ITF правила)

**Для сетки 8:**
```python
SEED_POSITIONS_MAP[8] = {
    1: 1,  # Seed 1 → позиция 1
    2: 8,  # Seed 2 → позиция 8
    3: 5,  # Seed 3 → позиция 5
    4: 4,  # Seed 4 → позиция 4
}
```

**Для сетки 16:**
```python
SEED_POSITIONS_MAP[16] = {
    1: 1,   # Seed 1 → позиция 1
    2: 16,  # Seed 2 → позиция 16
    3: 9,   # Seed 3 → позиция 9
    4: 8,   # Seed 4 → позиция 8
    5: 5,   # Seed 5 → позиция 5
    6: 12,  # Seed 6 → позиция 12
    7: 13,  # Seed 7 → позиция 13
    8: 4,   # Seed 8 → позиция 4
}
```

**Для сетки 32:**
```python
SEED_POSITIONS_MAP[32] = {
    1: 1, 2: 32, 3: 16, 4: 17,
    5: 8, 6: 25, 7: 9, 8: 24,
    9: 4, 10: 29, 11: 13, 12: 20,
    13: 5, 14: 28, 15: 12, 16: 21,
}
```

---

## Связь позиций с матчами

### Формула расчета

Позиции в сетке нумеруются от 1 до N (размер сетки).
Каждая пара позиций соответствует одному матчу первого раунда:

```python
def position_to_match(position: int) -> Tuple[int, str]:
    """
    Преобразовать позицию в (номер_матча, слот)
    
    Позиции 1-2 → Матч 1 (team_1, team_2)
    Позиции 3-4 → Матч 2 (team_1, team_2)
    Позиции 5-6 → Матч 3 (team_1, team_2)
    ...
    """
    match_order = (position + 1) // 2
    slot = 'team_1' if position % 2 == 1 else 'team_2'
    return match_order, slot
```

### Примеры

**Сетка 8:**
```
Позиция 1 → Матч 1, team_1
Позиция 2 → Матч 1, team_2
Позиция 3 → Матч 2, team_1
Позиция 4 → Матч 2, team_2
Позиция 5 → Матч 3, team_1
Позиция 6 → Матч 3, team_2
Позиция 7 → Матч 4, team_1
Позиция 8 → Матч 4, team_2
```

**Визуализация:**
```
Раунд 1 (4 матча)    Раунд 2 (2 матча)    Раунд 3 (1 матч)
                                           
Поз 1 ─┐                                   
       ├─ Матч 1 ─┐                        
Поз 2 ─┘          │                        
                  ├─ Матч 5 ─┐             
Поз 3 ─┐          │          │             
       ├─ Матч 2 ─┘          │             
Поз 4 ─┘                     ├─ Матч 7 (Финал)
                             │             
Поз 5 ─┐                     │             
       ├─ Матч 3 ─┐          │             
Поз 6 ─┘          │          │             
                  ├─ Матч 6 ─┘             
Поз 7 ─┐          │                        
       ├─ Матч 4 ─┘                        
Поз 8 ─┘                                   
```

---

## Структура раундов

### Расчет количества раундов

Для сетки размером N:
```python
num_rounds = log2(N)

# Примеры:
# Сетка 8 → 3 раунда (1/4, 1/2, финал)
# Сетка 16 → 4 раунда (1/8, 1/4, 1/2, финал)
# Сетка 32 → 5 раундов (1/16, 1/8, 1/4, 1/2, финал)
```

### Количество матчей в раунде

```python
def matches_in_round(bracket_size: int, round_index: int) -> int:
    """
    round_index: 0 = первый раунд, 1 = второй...
    """
    return bracket_size // (2 ** (round_index + 1))

# Для сетки 16:
# Раунд 0 (1/8): 16 / 2 = 8 матчей
# Раунд 1 (1/4): 16 / 4 = 4 матча
# Раунд 2 (1/2): 16 / 8 = 2 матча
# Раунд 3 (финал): 16 / 16 = 1 матч
```

### Структура данных

```python
@dataclass
class RoundInfo:
    round_index: int        # 0, 1, 2...
    matches_count: int      # Количество матчей
    round_name: str         # "1/8 финала", "Полуфинал"...
    is_final: bool          # True для финала
    is_third_place: bool    # True для матча за 3 место
```

---

## Продолжение

- [Часть 2: BYE позиции и ITF правила](KNOCKOUT_02_BYE.md)
- [Часть 3: Автопосев участников](KNOCKOUT_03_SEEDING.md)
- [Часть 4: API и интеграция](KNOCKOUT_04_API.md)
- [Часть 5: Frontend и UI/UX](KNOCKOUT_05_FRONTEND.md)

---

**Версия:** 1.0  
**Дата:** 5 января 2026

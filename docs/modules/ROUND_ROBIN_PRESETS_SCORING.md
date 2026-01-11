# Круговая система - Пресеты и подсчет результатов (дополнение)

## Пресеты форматов счета (SetFormat)

### Модель SetFormat

```python
class SetFormat(models.Model):
    name = CharField()  # Название формата
    games_to = IntegerField(default=6)  # До скольки геймов играется сет
    tiebreak_at = IntegerField(default=6)  # Тайбрейк при этом счёте (обычно 6:6)
    allow_tiebreak_only_set = BooleanField(default=True)  # Разрешён ли сет-тайбрейк до 10
    max_sets = IntegerField(default=1)  # Максимум сетов (1 или 3)
    tiebreak_points = IntegerField(default=7)  # Очки в обычном тайбрейке
    decider_tiebreak_points = IntegerField(default=10)  # Очки в решающем тайбрейке
```

### Примеры пресетов

**1. Стандартный (1 сет до 6 геймов):**
```python
SetFormat(
    name="1 сет до 6",
    games_to=6,
    tiebreak_at=6,
    max_sets=1,
    tiebreak_points=7
)
# Примеры счета: 6:4, 7:5, 7:6(7:5)
```

**2. Короткий (1 сет до 4 геймов):**
```python
SetFormat(
    name="1 сет до 4",
    games_to=4,
    tiebreak_at=4,
    max_sets=1,
    tiebreak_points=7
)
# Примеры счета: 4:2, 5:3, 5:4(7:5)
```

**3. Best of 3 (до 2 побед):**
```python
SetFormat(
    name="До 2 побед из 3",
    games_to=6,
    tiebreak_at=6,
    max_sets=3,
    allow_tiebreak_only_set=True,
    tiebreak_points=7,
    decider_tiebreak_points=10
)
# Примеры счета: 
# - 6:4, 6:3
# - 6:4, 3:6, 10:8 (супер-тайбрейк)
```

**4. Свободный формат:**
```python
SetFormat(
    name="Свободный",
    # Пользователь может добавлять/убирать сеты
    # Для каждого сета можно выбрать пресет или задать произвольный счет
)
```

---

## Пресеты регламентов (Ruleset)

### Модель Ruleset

```python
class Ruleset(models.Model):
    name = CharField()  # Название регламента
    ordering_priority = JSONField()  # Приоритет критериев сортировки
    tournament_system = CharField()  # 'round_robin' | 'knockout' | 'king'
```

### Формат ordering_priority

```json
[
  "wins",
  "h2h",
  "sets_ratio_all",
  "games_ratio_all",
  "sets_ratio_between",
  "games_ratio_between"
]
```

### Примеры пресетов

**1. Стандартный:**
```json
{
  "name": "победы > личные встречи > разница сетов между собой > разница геймов между собой > разница сетов между всеми > разница геймов между всеми",
  "ordering_priority": [
    "wins",
    "h2h",
    "sets_ratio_between",
    "games_ratio_between",
    "sets_ratio_all",
    "games_ratio_all"
  ]
}
```

**2. Упрощенный:**
```json
{
  "name": "победы > разница сетов между всеми > разница геймов между всеми",
  "ordering_priority": [
    "wins",
    "sets_ratio_all",
    "games_ratio_all"
  ]
}
```

**3. Без побед:**
```json
{
  "name": "разница сетов между всеми > разница геймов между всеми",
  "ordering_priority": [
    "sets_ratio_all",
    "games_ratio_all",
    "sets_ratio_between",
    "games_ratio_between"
  ]
}
```

---

## Детальный алгоритм подсчета результатов

### Технические столбцы таблицы

**Основные метрики:**
- `W` (Wins) - количество побед
- `SW` (Sets Won) - выигранные сеты
- `SL` (Sets Lost) - проигранные сеты
- `SR` (Sets Ratio) - соотношение сетов: **SW/(SW+SL)**, округление до 2 знаков
- `GW` (Games Won) - выигранные геймы
- `GL` (Games Lost) - проигранные геймы
- `GR` (Games Ratio) - соотношение геймов: **GW/(GW+GL)**, округление до 2 знаков

**ВАЖНО - Правила подсчета тайбрейков:**

1. **Чемпионский тайбрейк** (супер-тайбрейк до 10):
   - Считается как **один сет** (SW/SL)
   - Считается как **один гейм** (GW/GL)
   - Пример: 6:4, 3:6, 10:8 → победитель SW=2, SL=1, GW=10 (6+3+1, т.к. 10:8 это 1:0), GL=10 (4+6+0, т.к. 10:8 это 1:0)

2. **Обычный тайбрейк** (в сете при 6:6):
   - Считается как **один гейм**
   - Количество очков в тайбрейке **не учитывается**
   - Пример: 7:6(7:5) → победитель GW=7, GL=6

3. **Формат "только чемпионский тайбрейк":**
   - Очки в тайбрейке **приравниваются к геймам**
   - Пример: TB 10:8 → победитель GW=10, GL=8
   - После этого идет стандартный расчет соотношений

### Расчет метрик

**1. Подсчет побед:**
```python
def calculate_wins(team, matches):
    wins = 0
    
    for match in matches:
        if match.winner == team:
            wins += 1
    
    return wins
```

**2. Подсчет сетов:**
```python
def calculate_sets(team, matches):
    sets_won = 0
    sets_lost = 0
    
    for match in matches:
        for match_set in match.sets.all():
            # ВАЖНО: Чемпионский тайбрейк (is_tiebreak_only=True)
            # считается как один сет
            if match.team_1 == team:
                if match_set.games_1 > match_set.games_2:
                    sets_won += 1
                else:
                    sets_lost += 1
            else:  # team_2
                if match_set.games_2 > match_set.games_1:
                    sets_won += 1
                else:
                    sets_lost += 1
    
    return sets_won, sets_lost
```

**3. Подсчет геймов:**
```python
def calculate_games(team, matches):
    games_won = 0
    games_lost = 0
    
    for match in matches:
        for match_set in match.sets.all():
            if match_set.is_tiebreak_only:
                # Формат "только чемпионский тайбрейк":
                # очки в TB приравниваются к геймам
                if match.team_1 == team:
                    games_won += match_set.tb_1 or 0
                    games_lost += match_set.tb_2 or 0
                else:
                    games_won += match_set.tb_2 or 0
                    games_lost += match_set.tb_1 or 0
            else:
                # Обычный сет: геймы + тайбрейк (если есть) = 1 гейм
                if match.team_1 == team:
                    games_won += match_set.games_1
                    games_lost += match_set.games_2
                else:
                    games_won += match_set.games_2
                    games_lost += match_set.games_1
    
    return games_won, games_lost
```

**4. Расчет соотношений:**
```python
def calculate_ratio(won, lost):
    """
    Расчет соотношения с округлением до 3 знаков.
    
    Формула: won / (won + lost)
    """
    total = won + lost
    if total == 0:
        return 0.0
    
    ratio = won / total
    return round(ratio, 2)  # Округление до 2 знаков

# Примеры:
# 12 / (12 + 6) = 12 / 18 = 0.67
# 15 / (15 + 10) = 15 / 25 = 0.60
# 8 / (8 + 0) = 8 / 8 = 1.00
# 0 / (0 + 8) = 0 / 8 = 0.00
```

### Алгоритм сортировки

**Шаг 1: Применение критериев по порядку**

```python
def sort_standings(teams, ruleset):
    """
    Сортировка участников по регламенту.
    
    Применяет критерии последовательно, пока не останется
    участников с равными показателями.
    """
    criteria = ruleset.ordering_priority['criteria']
    
    for criterion in criteria:
        teams = apply_criterion(teams, criterion)
        
        # Если все участники различаются - готово
        if all_teams_different(teams):
            break
    
    return teams
```

**Шаг 2: Личная встреча (H2H)**

```python
def apply_h2h_criterion(teams_with_equal_wins):
    """
    Применение критерия личной встречи.
    
    Правило: Если после применения критерия у двух или более
    участников этот критерий равный, то более высокое место
    определяется по личной победе.
    """
    if len(teams_with_equal_wins) == 2:
        # Простой случай: 2 участника
        team1, team2 = teams_with_equal_wins
        h2h_match = Match.objects.filter(
            Q(team_1=team1, team_2=team2) | Q(team_1=team2, team_2=team1),
            status='completed'
        ).first()
        
        if h2h_match and h2h_match.winner:
            return [h2h_match.winner, team1 if h2h_match.winner == team2 else team2]
    
    elif len(teams_with_equal_wins) > 2:
        # Сложный случай: 3+ участников
        # Создаем мини-таблицу только из матчей между этими участниками
        mini_table = calculate_mini_table(teams_with_equal_wins)
        return sort_by_wins(mini_table)
    
    return teams_with_equal_wins
```

**Пример применения H2H:**
```
Ситуация: 3 участника с 2 победами каждый

Участник A: 2W, SR=1.500
Участник B: 2W, SR=1.500
Участник C: 2W, SR=1.500

Личные встречи:
A vs B: A победил
A vs C: C победил
B vs C: B победил

Мини-таблица:
A: 1W (победил B)
B: 1W (победил C)
C: 1W (победил A)

Все равны → переход к следующему критерию (Set Ratio)
```

### Пример полного расчета

**Исходные данные:**
```
Группа из 4 участников:
- Участник A
- Участник B
- Участник C
- Участник D

Результаты матчей:
A vs B: 6:4, 6:3 (победа A)
A vs C: 6:2, 4:6, 10:8 (победа A)
A vs D: 4:6, 3:6 (победа D)
B vs C: 6:3, 6:4 (победа B)
B vs D: 6:4, 3:6, 10:7 (победа B)
C vs D: 6:4, 6:2 (победа C)
```

**Расчет для участника A:**
```
Матчи: 3
Победы: 2 (vs B, vs C)

Сеты:
vs B: 2-0 (выиграл 6:4, 6:3)
vs C: 2-1 (выиграл 6:2, 10:8; проиграл 4:6)
  ВАЖНО: 10:8 - это чемпионский тайбрейк = 1 сет и 1 гейм
vs D: 0-2 (проиграл 4:6, 3:6)
Итого: SW=4, SL=3

Геймы:
vs B: 12-7 (6+6 vs 4+3)
vs C: 11-12 (6+4+1 vs 2+6+1)
  ВАЖНО: чемпионский TB считается как 1 гейм (не 10 и 8)
vs D: 7-12 (4+3 vs 6+6)
Итого: GW=30, GL=31

Соотношения:
SR = 4/(4+3) = 4/7 = 0.57
GR = 30/(30+31) = 30/61 = 0.49
```

**Итоговая таблица:**
```
Место | Участник | W | SW | SL | SR   | GW | GL | GR   |
------|----------|---|----|----|------|----|----|------|
1     | A        | 2 | 4  | 3  | 0.57 | 30 | 31 | 0.49 |
2     | B        | 2 | 4  | 3  | 0.57 | 31 | 30 | 0.51 |
3     | C        | 2 | 4  | 3  | 0.57 | 30 | 31 | 0.49 |
4     | D        | 0 | 2  | 6  | 0.25 | 30 | 32 | 0.48 |

Сортировка:
1. D на 4 месте (0 побед)
2. A, B, C имеют по 2 победы и одинаковый SR (0.57)
3. Применяем GR: B (0.51) > A (0.49) = C (0.49)
4. A и C равны по GR → применяем H2H: C победил A

Финальная таблица:
1. B
2. C
3. A
4. D
```

---

**Версия:** 1.0  
**Дата:** 5 января 2026

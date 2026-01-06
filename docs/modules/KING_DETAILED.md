# Кинг система (King / Americano) - Детальная документация

## Описание

Кинг (Americano/Mexicano) - турнирная система, где пары формируются динамически каждый раунд. Участники играют с разными партнерами и против разных соперников, накапливая личные очки.

**Ключевые особенности:**
- Динамическое формирование пар каждый раунд
- Личный зачет (каждый игрок накапливает очки)
- Балансированный алгоритм для 4-16 участников
- Поддержка нескольких групп
- Кастомные шаблоны расписания

---

## Архитектура

### Backend компоненты

**Сервисы:**
- `apps/tournaments/services/king.py` (431 строка) - генерация расписания
  - `KingMatchGenerator` - класс генератора
  - `generate_king_matches()` - создание матчей для турнира
  - `persist_king_matches()` - сохранение в БД

**API:**
- `apps/tournaments/api_views.py` - endpoints для управления

**Модели:**
- `Tournament` - турнир с system='king'
- `TournamentEntry` - участники (singles only)
- `Match` - матчи с виртуальными Team
- `SchedulePattern` - шаблоны расписания

### Frontend компоненты

**Страницы:**
- `frontend/src/pages/KingPage.tsx` - главная страница турнира

**API клиент:**
- `frontend/src/services/api.ts` - методы для King

---

## Алгоритм генерации расписания

### Класс KingMatchGenerator

```python
class KingMatchGenerator:
    def __init__(self, participants_count: int):
        self.participants_count = participants_count
        self.validate_participant_count()  # 4-16 участников
    
    def generate_balanced_americano(self) -> List[Dict[str, Any]]:
        """Генерация сбалансированного расписания Американо"""
        n = self.participants_count
        
        if n == 4:
            return self._generate_for_4()    # 3 раунда
        elif n == 5:
            return self._generate_for_5()    # 5 раундов
        elif n == 6:
            return self._generate_for_6()    # 8 раундов
        else:
            return self._generate_round_robin_based(n)  # 7+
```

### Специальные случаи

**4 участника (3 раунда):**
```python
Раунд 1: [0,1] vs [2,3]
Раунд 2: [0,2] vs [1,3]
Раунд 3: [0,3] vs [1,2]
```

**5 участников (5 раундов, 1 отдыхает):**
```python
Раунд 1: [0,1] vs [2,3], отдых: 4
Раунд 2: [0,2] vs [3,4], отдых: 1
Раунд 3: [0,3] vs [1,4], отдых: 2
Раунд 4: [0,4] vs [1,2], отдых: 3
Раунд 5: [1,3] vs [2,4], отдых: 0
```

**6 участников (8 раундов, 2 отдыхают):**
```python
Раунд 1: [0,1] vs [2,3], отдых: [4,5]
Раунд 2: [1,5] vs [3,4], отдых: [0,2]
... (всего 8 раундов)
```

### Round-Robin подход (7+ участников)

```python
def _generate_round_robin_based(self, n: int):
    # 1. Генерируем пары round-robin
    if n % 2 == 0:
        rr_pairs = self._generate_even_round_robin(n)
    else:
        rr_pairs = self._generate_odd_round_robin(n)
    
    # 2. Формируем матчи из пар (каждые 2 пары = 1 матч)
    for round_num, pairs in enumerate(rr_pairs, start=1):
        matches = []
        i = 0
        while i < len(pairs) - 1:
            team1 = list(pairs[i])      # Первая пара
            team2 = list(pairs[i + 1])  # Вторая пара
            matches.append({'team1': team1, 'team2': team2})
            i += 2
```

**Алгоритм вращения (четное количество):**
```python
Исходно: [0, 1, 2, 3, 4, 5]
Раунд 1: 0-5, 1-4, 2-3
Вращение: [0] + [5] + [1,2,3,4] = [0, 5, 1, 2, 3, 4]
Раунд 2: 0-4, 5-3, 1-2
```

---

## Создание команд для матчей

### Формирование пар

В King системе пары формируются динамически каждый раунд. Модель `Match` требует `team_1` и `team_2`, поэтому для каждой пары создается обычная `Team` с двумя игроками.

### Процесс создания

```python
# 1. Получить player_id для каждого участника пары
# В King каждый TournamentEntry имеет team с одним игроком (player_2 = NULL)
team1_player_ids = sorted([entry1.team.player_1_id, entry2.team.player_1_id])
team2_player_ids = sorted([entry3.team.player_1_id, entry4.team.player_1_id])

# 2. Создать или получить Team для пары
team1, _ = Team.objects.get_or_create(
    player_1_id=team1_player_ids[0],
    player_2_id=team1_player_ids[1]
)

team2, _ = Team.objects.get_or_create(
    player_1_id=team2_player_ids[0],
    player_2_id=team2_player_ids[1]
)

# 3. Нормализация для уникальности матча
team_low_id = min(team1.id, team2.id)
team_high_id = max(team1.id, team2.id)
```

### Нормализация пар

**Проблема:** Матч [Team A vs Team B] и [Team B vs Team A] - это один и тот же матч.

**Решение:** Хранить `team_low_id` и `team_high_id` (где low < high).

```python
key = (team_low_id, team_high_id)  # Уникальный ключ для пары
```

---

## Сохранение матчей в БД

### Функция persist_king_matches

```python
@transaction.atomic
def persist_king_matches(tournament: Tournament, generated: List[Dict]) -> int:
    # 1. Загрузить существующие матчи
    existing_qs = Match.objects.filter(
        tournament=tournament,
        stage=Match.Stage.GROUP
    )
    
    # 2. Индексировать по паре команд
    existing_by_pair = {}
    for m in existing_qs:
        if m.team_low_id and m.team_high_id:
            key = (m.team_low_id, m.team_high_id)
            existing_by_pair[key] = m
    
    # 3. Обработать каждый сгенерированный матч
    for match_data in generated:
        # Создать виртуальные Team
        team1, _ = Team.objects.get_or_create(...)
        team2, _ = Team.objects.get_or_create(...)
        
        # Нормализация
        key = (min(team1.id, team2.id), max(team1.id, team2.id))
        
        # Проверить существование
        if key in existing_by_pair:
            # Обновить метаданные (round, group)
            existing_match = existing_by_pair[key]
            existing_match.round_index = match_data['round']
            existing_match.save()
        else:
            # Создать новый матч
            Match.objects.create(
                tournament=tournament,
                team_low_id=key[0],
                team_high_id=key[1],
                team_1=team1,
                team_2=team2,
                round_index=match_data['round'],
                ...
            )
    
    # 4. Удалить лишние матчи
    to_delete = existing_qs.exclude(id__in=used_match_ids)
    to_delete.delete()
```

---

## API Endpoints

### GET /api/tournaments/{id}/king_schedule/

Получить расписание по группам.

**Response:**
```json
{
  "schedule": {
    "Группа 1": {
      "rounds": [
        {
          "round": 1,
          "matches": [
            {
              "row1": 1,  // row_index первого участника пары 1
              "row2": 2,
              "row3": 3,  // row_index первого участника пары 2
              "row4": 4
            }
          ]
        }
      ]
    }
  }
}
```

### POST /api/tournaments/{id}/generate_matches/

Сгенерировать матчи для турнира.

**Response:**
```json
{
  "ok": true,
  "created": 12,
  "message": "Создано 12 матчей"
}
```

---

## Frontend

### Отображение расписания

```typescript
// Преобразование формата API в Record<number, [number, number][][]>
const transformedSchedule: Record<number, [number, number][][]> = {};

for (const [groupName, groupData] of Object.entries(schedule)) {
  const groupIndex = parseInt(groupName.split(' ')[1]);
  transformedSchedule[groupIndex] = groupData.rounds.map(round => 
    round.matches.map(m => [[m.row1, m.row2], [m.row3, m.row4]])
  );
}
```

### Индикация отдыхающих

```tsx
{restingParticipants.length > 0 && (
  <div className="resting-info">
    Отдыхают: {restingParticipants.map(p => p.name).join(', ')}
  </div>
)}
```

---

## Кастомные шаблоны

### Модель SchedulePattern

```python
class SchedulePattern(models.Model):
    name = models.CharField(max_length=100)
    tournament_system = models.CharField(choices=TournamentSystem.choices)
    pattern_type = models.CharField(choices=PatternType.choices)
    custom_schedule = models.JSONField(null=True)
```

### Формат custom_schedule

```json
{
  "rounds": [
    {
      "round": 1,
      "matches": [
        {"team1": [1, 2], "team2": [3, 4]}  // 1-based индексы
      ],
      "resting": [5]
    }
  ]
}
```

---

## Модель MatchSet

### Связь с Match

```python
class MatchSet(models.Model):
    match = models.ForeignKey(Match, on_delete=models.CASCADE, related_name='sets')
    index = models.IntegerField()  # Номер сета (1, 2, 3...)
    games_1 = models.IntegerField()  # Геймы команды 1
    games_2 = models.IntegerField()  # Геймы команды 2
    tb_1 = models.IntegerField(null=True, blank=True)  # Очки в тайбрейке
    tb_2 = models.IntegerField(null=True, blank=True)
    is_tiebreak_only = models.BooleanField(default=False)  # Чемпионский тайбрейк
```

### Порядок записи счета

**ВАЖНО:** Счет в MatchSet записывается в том же порядке, что и команды в Match:
- `games_1` и `tb_1` - для `match.team_1`
- `games_2` и `tb_2` - для `match.team_2`

Порядок не зависит от того, как пользователь кликнул по ячейке в UI.

---

## Формат отображения расписания

### Обозначение "A+B vs C+D"

В UI расписание отображается в формате, где буквы соответствуют **позиции игрока в исходной таблице** (row_index):

```
Раунд 1:
  Корт 1: A+B vs C+D
  Корт 2: E+F vs G+H
  Отдых: I

Где:
  A = игрок с row_index=0
  B = игрок с row_index=1
  C = игрок с row_index=2
  и т.д.
```

**Пример для 6 участников:**
```
Участники: Иванов (0), Петров (1), Сидоров (2), Козлов (3), Смирнов (4), Попов (5)

Раунд 1: A+B vs C+D, E+F отдых
  → Иванов+Петров vs Сидоров+Козлов, Смирнов+Попов отдых
```

---

## Режимы подсчета результатов

### Три режима: M- / G+ / NO

King система поддерживает три режима подсчета для обработки ситуаций с разным количеством сыгранных матчей:

#### 1. Режим NO (Normal) - Стандартный

Учитываются **все сыгранные матчи** участника.

```python
# Пример: участник сыграл 5 матчей из 8 возможных
stats = {
    'wins': 3,
    'games_won': 45,
    'games_lost': 38,
    'games_ratio': 45 / (45 + 38) = 0.542
}
```

#### 2. Режим G- (Games Minus) - До минимума

Учитываются только **первые N матчей**, где N = минимальное количество матчей среди всех участников.

```python
# Если минимум = 4 матча, учитываем только первые 4
stats_g = calculate_stats(matches[:4])
```

**Применение:** Когда турнир еще идет и участники сыграли разное количество матчей.

#### 3. Режим M+ (Matches Plus) - С компенсацией

Для участников, сыгравших **меньше запланированного**, добавляются компенсационные очки за недоигранные матчи.

```python
# Участник сыграл 5 из 8 матчей
played = 5
planned = 8
compensation = (planned - played) * average_games_per_match

stats_m = {
    'games_won': actual_games_won + compensation,
    'games_ratio': games_won  # Абсолютное значение для сравнения
}
```

**Применение:** Для справедливого сравнения когда не все доиграли.

### Выбор режима в UI

```typescript
<select value={mode} onChange={(e) => setMode(e.target.value)}>
  <option value="NO">Стандартный (все матчи)</option>
  <option value="G-">До минимума (G-)</option>
  <option value="M+">С компенсацией (M+)</option>
</select>
```

---

## Определение победителя и регламенты

### Модель Ruleset

```python
class Ruleset(models.Model):
    name = models.CharField(max_length=255)
    ordering_priority = models.JSONField()  # Список критериев
    tournament_system = models.CharField(
        choices=[('round_robin', 'Круговая'), ('king', 'Кинг'), ('knockout', 'Олимпийская')]
    )
```

### Критерии сортировки для King

```json
{
  "ordering_priority": [
    "wins",              // Количество побед
    "games_ratio_all",   // Соотношение геймов между всеми
    "games_ratio_between", // Соотношение геймов между собой (H2H)
    "h2"                 // Личная встреча
  ]
}
```

### Примеры регламентов для King

**1. Стандартный:**
```
"победы > разница геймов между всеми > разница геймов между собой > личные встречи"
```

**2. Без побед:**
```
"разница сетов между всеми > разница геймов между всеми"
```

### Смена регламента

Организатор может выбрать регламент при создании турнира или изменить его в статусе `Created`:

```typescript
<select value={rulesetId} onChange={handleRulesetChange}>
  {rulesets.map(r => (
    <option key={r.id} value={r.id}>{r.name}</option>
  ))}
</select>
```

---

## Действия по статусам турнира

### Статус: Created (Регистрация)

**Доступные действия:**

| Действие | ADMIN | ORGANIZER | REFEREE | USER |
|----------|-------|-----------|---------|------|
| Добавить участника | ✅ | ✅ (свой) | ❌ | ❌ |
| Удалить участника | ✅ | ✅ (свой) | ❌ | ❌ |
| Изменить настройки | ✅ | ✅ (свой) | ❌ | ❌ |
| Выбрать регламент | ✅ | ✅ (свой) | ❌ | ❌ |
| Сгенерировать расписание | ✅ | ✅ (свой) | ❌ | ❌ |
| Начать турнир | ✅ | ✅ (свой) | ❌ | ❌ |
| Просмотр | ✅ | ✅ | ✅ | ✅ |

**UI элементы:**
- Кнопка "Добавить участника"
- Кнопка "Сгенерировать расписание"
- Кнопка "Начать турнир"
- Выпадающий список регламентов
- Настройки турнира (название, дата, формат счета)

### Статус: Active (В процессе)

**Доступные действия:**

| Действие | ADMIN | ORGANIZER | REFEREE | USER |
|----------|-------|-----------|---------|------|
| Ввести счет | ✅ | ✅ (свой) | ✅ | ❌ |
| Начать матч | ✅ | ✅ (свой) | ✅ | ❌ |
| Отменить счет | ✅ | ✅ (свой) | ✅ | ❌ |
| Завершить турнир | ✅ | ✅ (свой) | ❌ | ❌ |
| Вернуть в регистрацию | ✅ | ✅ (свой) | ❌ | ❌ |
| Просмотр | ✅ | ✅ | ✅ | ✅ |

**UI элементы:**
- Таблица результатов с режимами (NO/G-/M+)
- Расписание матчей с возможностью ввода счета
- Индикация текущих матчей (статус LIVE)
- Кнопка "Завершить турнир"

### Статус: Completed (Завершен)

**Доступные действия:**

| Действие | ADMIN | ORGANIZER | REFEREE | USER |
|----------|-------|-----------|---------|------|
| Просмотр | ✅ | ✅ | ✅ | ✅ |
| Экспорт результатов | ✅ | ✅ | ✅ | ✅ |
| Поделиться | ✅ | ✅ | ✅ | ✅ |
| Удалить турнир | ✅ | ❌ | ❌ | ❌ |

**UI элементы:**
- Финальная таблица результатов
- История всех матчей
- Кнопка "Поделиться"
- Кнопка "Экспорт в PNG/PDF"

---

**Версия:** 1.0  
**Дата:** 5 января 2026

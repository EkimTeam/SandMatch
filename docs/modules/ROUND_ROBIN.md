# Круговая система (Round Robin)

## Описание

Круговая система турнира, где каждый участник играет с каждым в своей группе. Поддерживает несколько групп с автоматическим формированием расписания и подсчетом результатов.

---

## Архитектура

### Backend

**Основные файлы:**
- `apps/tournaments/services/round_robin.py` - логика генерации расписания
- `apps/tournaments/api_views.py` - API endpoints (group_schedule, auto_seed, clear_tables)
- `apps/tournaments/api_new_round_robin.py` - создание нового турнира
- `apps/tournaments/models.py` - модели Tournament, TournamentEntry, SchedulePattern

**Типы расписаний:**

Система поддерживает два типа расписаний:

1. **Системные (алгоритмические)** - генерируются автоматически:
   - `berger` - Алгоритм Бергера (вращающийся стол)
   - `snake` - Змейка

2. **Кастомные** - создаются пользователем вручную:
   - Хранятся в модели `SchedulePattern`
   - Привязаны к конкретному количеству участников
   - Содержат JSON с расписанием туров и пар

**Выбор расписания для группы:**

Каждая группа турнира может использовать свое расписание. Это фиксируется в поле `Tournament.group_schedule_patterns`:

```python
# Формат: {"Группа 1": pattern_id, "Группа 2": pattern_id}
group_schedule_patterns = models.JSONField(
    null=True,
    blank=True,
    help_text="Привязка групп к шаблонам расписания"
)
```

**Ключевые функции:**

```python
# apps/tournaments/services/round_robin.py
def generate_round_robin_schedule(entries: List[TournamentEntry], tournament: Tournament) -> List[Match]:
    """
    Генерирует расписание круговой системы.
    
    Args:
        entries: Список участников группы
        tournament: Турнир
        
    Returns:
        Список созданных матчей
        
    Алгоритм (для системных шаблонов):
    1. Если нечетное количество участников - добавляется BYE
    2. Первый участник фиксируется, остальные вращаются
    3. Каждый тур формируется парами: (fixed, last), (first_rotating, second_rotating), ...
    
    Для кастомных шаблонов:
    1. Загружается SchedulePattern по ID из group_schedule_patterns
    2. Используется готовое расписание из custom_schedule JSON
    """
```

### Frontend

**Основные компоненты:**
- `frontend/src/pages/TournamentDetailPage.tsx` - главная страница турнира
- `frontend/src/components/RoundRobinGroupTable.tsx` - таблица группы
- `frontend/src/components/DraggableParticipantList.tsx` - список участников с drag&drop

**Состояние:**

```typescript
interface RoundRobinState {
  groups: Group[];           // Группы турнира
  schedule: Match[];         // Расписание матчей
  standings: Standing[];     // Турнирная таблица
  liveMatches: number[];     // ID активных матчей
}
```

### База данных

**Модели:**

```python
# SchedulePattern - шаблоны расписания
name = CharField()  # Название шаблона
pattern_type = CharField()  # 'berger' | 'snake' | 'custom'
tournament_system = CharField()  # 'round_robin' | 'knockout' | 'king'
participants_count = IntegerField(null=True)  # Для кастомных - обязательно
custom_schedule = JSONField(null=True)  # JSON с расписанием для кастомных
is_system = BooleanField()  # True для системных (нельзя удалить)

# Формат custom_schedule для кастомных шаблонов:
{
  "rounds": [
    {
      "round": 1,
      "pairs": [[1, 2], [3, 4]]  # 1-based индексы участников
    },
    {
      "round": 2,
      "pairs": [[1, 3], [2, 4]]
    }
  ]
}

# Tournament
system = 'round_robin'
status = 'created' | 'active' | 'completed'
groups_count = IntegerField()  # Количество групп
planned_participants = IntegerField()
group_schedule_patterns = JSONField()  # {"Группа 1": pattern_id, "Группа 2": pattern_id}
set_format = ForeignKey(SetFormat)  # Формат счета (пресет)
ruleset = ForeignKey(Ruleset)  # Регламент определения победителя (пресет)

# TournamentEntry
tournament = ForeignKey(Tournament)
team = ForeignKey(Team)
group_index = IntegerField(null=True)  # NULL пока не посеян
row_index = IntegerField(null=True)    # NULL пока не посеян
# ВАЖНО: group_index и row_index равны NULL до тех пор,
# пока участник не будет приписан к конкретной позиции
# (автопосев или ручное перемещение в таблицу)

# Match
tournament = ForeignKey(Tournament)
team_1 = ForeignKey(Team)
team_2 = ForeignKey(Team)
group_index = IntegerField()  # Номер группы
round_index = IntegerField()  # Номер тура
status = 'scheduled' | 'live' | 'completed' | 'walkover' | 'retired' | 'default'

# MatchSet - счет по сетам (зависимая таблица от Match)
match = ForeignKey(Match)
index = IntegerField()  # Номер сета (1, 2, 3)
games_1 = IntegerField()  # Геймы team_1
games_2 = IntegerField()  # Геймы team_2
tb_1 = IntegerField(null=True)  # Тайбрейк team_1
tb_2 = IntegerField(null=True)  # Тайбрейк team_2
# ВАЖНО: Счет записывается в порядке team_1 vs team_2 из Match,
# независимо от того, как пользователь кликнул по ячейке в таблице
```

---

## API Endpoints

### 1. Получить расписание групп

```http
GET /api/tournaments/{id}/group_schedule/
```

**Response:**
```json
{
  "groups": [
    {
      "index": 0,
      "participants": [
        {
          "id": 1,
          "team": {"id": 10, "name": "Иванов/Петров"},
          "position": 1,
          "wins": 2,
          "losses": 1,
          "sets_won": 5,
          "sets_lost": 3,
          "points_won": 126,
          "points_lost": 98
        }
      ],
      "schedule": [
        {
          "round": 1,
          "matches": [
            {
              "id": 100,
              "team_1": {"id": 10, "name": "Иванов/Петров"},
              "team_2": {"id": 11, "name": "Сидоров/Козлов"},
              "status": "completed",
              "score": "6:4, 6:3"
            }
          ]
        }
      ]
    }
  ]
}
```

### 2. Автопосев участников

```http
POST /api/tournaments/{id}/auto_seed/
```

**Request Body:**
```json
{
  "seed_by_rating": true  // Опционально, по умолчанию true
}
```

**Логика посева "по корзинам":**

1. Сортирует участников по рейтингу (если `seed_by_rating=true`)

2. Разбивает на корзины (по количеству групп):
   - Корзина 1: первые N участников (где N = groups_count)
   - Корзина 2: следующие N участников
   - И т.д.

3. Расстановка по группам:
   - **Корзина 1** (первые номера): расставляются по порядку
     * Участник #1 → Группа 1
     * Участник #2 → Группа 2
     * Участник #3 → Группа 3
   - **Корзина 2** (вторые номера): рассеиваются **случайным образом**
   - **Корзина 3** (третьи номера): рассеиваются **случайным образом**
   - И т.д. для остальных корзин

4. **Неравное распределение:**
   - Если количество участников не делится нацело на количество групп,
     то больше участников будет в первых группах
   - **Пример:** 10 участников, 3 группы:
     * Группа 1: 4 участника
     * Группа 2: 3 участника
     * Группа 3: 3 участника

**Пример для 12 участников в 4 группах:**
- Корзина 1: #1, #2, #3, #4 → Группы 1, 2, 3, 4 (по порядку)
- Корзина 2: #5, #6, #7, #8 → случайно по группам
- Корзина 3: #9, #10, #11, #12 → случайно по группам

**Response:**
```json
{
  "ok": true,
  "message": "Участники распределены по группам"
}
```

### 3. Очистить таблицы

```http
POST /api/tournaments/{id}/clear_tables/
```

**Действия:**
1. Удаляет все матчи турнира
2. Обнуляет `group_index` и `row_index` у всех участников
3. Участники возвращаются в левый список

**Response:**
```json
{
  "ok": true,
  "message": "Таблицы очищены"
}
```

### 4. Добавить участника

```http
POST /api/tournaments/{id}/add_participant/
```

**Request Body:**
```json
{
  "team_id": 10
}
```

**Логика:**
- Если турнир в статусе `created` - участник добавляется в левый список (`group_index=null`)
- Если турнир `active` - ошибка (нельзя добавлять после старта)

---

## Бизнес-логика

### Создание турнира

```python
# apps/tournaments/api_new_round_robin.py
def create_round_robin_tournament(data):
    """
    1. Создать Tournament с system='round_robin'
    2. Установить groups_count и planned_participants
    3. Статус = 'created'
    """
```

### Автопосев

```python
# apps/tournaments/api_views.py
@action(detail=True, methods=["post"])
def auto_seed(self, request, pk=None):
    """
    1. Получить всех участников без группы (group_index=null)
    2. Отсортировать по рейтингу (если seed_by_rating=true)
    3. Разбить на корзины по количеству групп
    4. Расставить первую корзину по порядку, остальные - случайно
    5. Сохранить group_index и row_index для каждого участника
    6. Сгенерировать расписание для каждой группы
    """
```

### Генерация расписания

**Алгоритм "вращающегося стола":**

```
Участники: 1, 2, 3, 4, 5, 6

Тур 1:  1-6  2-5  3-4
Тур 2:  1-5  6-4  2-3
Тур 3:  1-4  5-3  6-2
Тур 4:  1-3  4-2  5-6
Тур 5:  1-2  3-6  4-5
```

**Код:**

```python
def generate_round_robin_schedule(entries, tournament):
    n = len(entries)
    if n % 2 == 1:
        entries.append(None)  # BYE
        n += 1
    
    matches = []
    for round_num in range(n - 1):
        for i in range(n // 2):
            home = entries[i]
            away = entries[n - 1 - i]
            
            if home and away:  # Пропускаем BYE
                match = Match.objects.create(
                    tournament=tournament,
                    team_1=home.team,
                    team_2=away.team,
                    group_index=home.group_index,
                    round_index=round_num,
                    status='scheduled'
                )
                matches.append(match)
        
        # Вращение (первый фиксирован)
        entries = [entries[0]] + [entries[-1]] + entries[1:-1]
    
    return matches
```

### Подсчет результатов

**Технические столбцы таблицы:**
- **W** (Wins) - количество побед
- **SW** (Sets Won) - выигранные сеты
- **SL** (Sets Lost) - проигранные сеты
- **SR** (Sets Ratio) - соотношение сетов: **SW/(SW+SL)**, округление до 2 знаков
- **GW** (Games Won) - выигранные геймы
- **GL** (Games Lost) - проигранные геймы
- **GR** (Games Ratio) - соотношение геймов: **GW/(GW+GL)**, округление до 2 знаков

**ВАЖНО - Правила подсчета тайбрейков:**
1. **Чемпионский тайбрейк** (супер-тайбрейк до 10) считается:
   - Как **один сет** (SW/SL)
   - Как **один гейм** (GW/GL)
   - Пример: счет 6:4, 3:6, 10:8 → победитель: SW=2, SL=1, GW=10 (6+3+1, т.к. 10:8 это 1:0), GL=10 (4+6+0, т.к. 10:8 это 1:0)

2. **Обычный тайбрейк** (в сете при 6:6) считается:
   - Как **один гейм**
   - Количество очков в тайбрейке **не учитывается**
   - Пример: счет 7:6(7:5) → победитель: GW=7, GL=6 (тайбрейк = 1 гейм)

3. **Формат "только чемпионский тайбрейк":**
   - Очки набранные в тайбрейке **приравниваются к геймам**
   - Пример: счет TB 10:8 → победитель: GW=10, GL=8
   - После этого идет стандартный расчет соотношений

**Алгоритм сортировки (определяется Ruleset):**

Порядок критериев задается в `Ruleset.ordering_priority`. Возможные критерии:

- **wins** - количество побед (больше - лучше)
- **h2h** - личная встреча (Head-to-Head)
  * Если после применения критерия у двух или более участников
    этот критерий равный, то более высокое место определяется
    по личной победе
- **sets_ratio_all** - соотношение сетов между всеми: SW/(SW+SL)
- **games_ratio_all** - соотношение геймов между всеми: GW/(GW+GL)
- **sets_ratio_between** - соотношение сетов между собой (в личных встречах)
- **games_ratio_between** - соотношение геймов между собой (в личных встречах)

**Примеры регламентов:**
1. Стандартный: `["wins", "h2h", "sets_ratio_between", "games_ratio_between", "sets_ratio_all", "games_ratio_all"]`
2. Упрощенный: `["wins", "sets_ratio_all", "games_ratio_all"]`

**ВАЖНО:** Детальный алгоритм с примерами см. в [ROUND_ROBIN_PRESETS_SCORING.md](ROUND_ROBIN_PRESETS_SCORING.md)

**Пресеты форматов и регламентов:**
- **SetFormat** - пресеты формата счета (1 сет до 6, Best of 3, свободный)
- **Ruleset** - пресеты регламента определения победителя

Подробнее см. [ROUND_ROBIN_PRESETS_SCORING.md](ROUND_ROBIN_PRESETS_SCORING.md)

---

## UI/UX

### Статусы турнира

**Created (Создан / Регистрация):**

Доступные действия:
- ✅ Добавлять/удалять участников
- ✅ Автопосев
- ✅ Очистка таблиц
- ✅ **Изменить настройки турнира** (ADMIN, ORGANIZER)
- ✅ **Зафиксировать участников** → переход в `active` (ADMIN, ORGANIZER)

**Active (Активен / Идет):**

Доступные действия:
- ❌ Нельзя добавлять/удалять участников
- ✅ Вводить счет матчей (ADMIN, ORGANIZER, REFEREE)
- ✅ Начинать/завершать матчи (ADMIN, ORGANIZER, REFEREE)
- ✅ **Вернуть турнир в статус Регистрация** (ADMIN, ORGANIZER)
- ✅ **Завершить турнир** → переход в `completed` (ADMIN, ORGANIZER)

**Completed (Завершен):**

Доступные действия:
- ✅ Просмотр результатов
- ✅ **Поделиться** (все пользователи)
- ❌ Нельзя изменять счет

**Роли и права доступа:**
- **ADMIN** - все действия
- **ORGANIZER** - все действия для своих турниров
- **REFEREE** - ввод счета, начало/завершение матчей
- **USER** - просмотр, поделиться

### Интерактивность

**Live матчи:**
- Светло-зеленый фон у матчей со статусом `live`
- Зеленый индикатор перед счетом в таблице

**Клик на матч (ячейку в таблице):**

Открывается модальное окно с действиями:

**Для матча в статусе `scheduled`:**
- “Начать матч” → статус `live`, светло-зеленый фон
- “Ввести счет” → открывается модальное окно ввода счета

**Для матча в статусе `live`:**
- “Отменить матч” → возврат в `scheduled`
- “Ввести счет” → открывается модальное окно ввода счета

**ВАЖНО:** Порядок участников в модальном окне зависит от того,
как пользователь кликнул по ячейке (team_1 vs team_2 или team_2 vs team_1),
но счет в базе данных (MatchSet) всегда записывается
в порядке team_1 vs team_2 из Match.

### Модальное окно ввода счета

**Общее для всех турнирных систем:**
- Единое модальное окно для Round Robin, Knockout и King
- Форма и содержание зависят от выбранного в турнире SetFormat

**Для свободного формата:**
- Можно добавлять и убирать сеты
- Для каждого сета есть пресеты счета:
  - 6:0, 6:1, 6:2, 6:3, 6:4
  - 7:5, 7:6 (с тайбрейком)
  - Произвольный счет
- Можно задать произвольный счет вручную

**Для фиксированных форматов:**
- Количество сетов задано SetFormat
- Доступны только корректные счета по правилам

---

## Примеры использования

### Создание турнира

```typescript
// Frontend
const createTournament = async () => {
  const response = await api.post('/api/tournaments/', {
    name: 'Летний турнир 2024',
    system: 'round_robin',
    groups_count: 2,
    planned_participants: 16,
    set_format: 'best_of_3'
  });
  
  return response.data;
};
```

### Автопосев

```typescript
const autoSeed = async (tournamentId: number) => {
  await api.post(`/api/tournaments/${tournamentId}/auto_seed/`, {
    seed_by_rating: true
  });
  
  // Перезагрузить данные
  await loadSchedule();
};
```

### Ввод счета

```typescript
const updateScore = async (matchId: number, sets: SetScore[]) => {
  await api.post(`/api/matches/${matchId}/update_score/`, {
    sets: [
      { team_1_score: 6, team_2_score: 4 },
      { team_1_score: 6, team_2_score: 3 }
    ]
  });
  
  // Обновить таблицу и расписание
  await loadSchedule();
};
```

---

## Тестовые сценарии

### 1. Создание и автопосев

1. Создать турнир на 2 группы, 16 участников
2. Добавить 16 участников
3. Нажать "Автопосев"
4. **Ожидаемо:** Участники распределены по 8 в каждой группе, сгенерировано расписание (7 туров × 4 матча = 28 матчей на группу)

### 2. Ввод счета и обновление таблицы

1. Начать матч
2. Ввести счет 6:4, 6:3
3. **Ожидаемо:** 
   - Матч завершен
   - У победителя +1 победа, +2 сета
   - У проигравшего +1 поражение, +2 сета проиграно
   - Таблица пересортирована

### 3. Очистка таблиц

1. Распределить участников по группам
2. Нажать "Очистить таблицы"
3. **Ожидаемо:**
   - Все участники вернулись в левый список
   - Все матчи удалены
   - Таблицы пустые

---

## Troubleshooting

### Проблема: Участники не распределяются по группам

**Причина:** Недостаточно участников для указанного количества групп

**Решение:** Убедитесь, что `participants_count >= groups_count`

### Проблема: Расписание не генерируется

**Причина:** Участники не назначены в группы (`group_index=null`)

**Решение:** Выполните автопосев или вручную распределите участников

### Проблема: Таблица не обновляется после ввода счета

**Причина:** Фронтенд не перезагружает данные после обновления

**Решение:** Проверьте, что после `updateScore` вызывается `loadSchedule()`

---

## Связанные модули

- [Управление матчами](MATCHES.md) - ввод счета, статусы матчей
- [Управление командами](TEAMS.md) - создание команд-участников
- [Рейтинг BP](RATING_BP.md) - пересчет рейтинга после турнира

---

**Версия:** 1.0  
**Дата обновления:** 5 января 2026

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
- `apps/tournaments/models.py` - модели Tournament, TournamentEntry

**Ключевые функции:**

```python
# apps/tournaments/services/round_robin.py
def generate_round_robin_schedule(entries: List[TournamentEntry], tournament: Tournament) -> List[Match]:
    """
    Генерирует расписание круговой системы по алгоритму "вращающегося стола"
    
    Args:
        entries: Список участников группы
        tournament: Турнир
        
    Returns:
        Список созданных матчей
        
    Алгоритм:
    1. Если нечетное количество участников - добавляется BYE
    2. Первый участник фиксируется, остальные вращаются
    3. Каждый тур формируется парами: (fixed, last), (first_rotating, second_rotating), ...
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
# Tournament
system = 'round_robin'
status = 'created' | 'active' | 'completed'
groups_count = IntegerField()  # Количество групп
planned_participants = IntegerField()

# TournamentEntry
tournament = ForeignKey(Tournament)
team = ForeignKey(Team)
group_index = IntegerField()  # Номер группы (0, 1, 2...)
row_index = IntegerField()    # Позиция в группе

# Match
tournament = ForeignKey(Tournament)
team_1 = ForeignKey(Team)
team_2 = ForeignKey(Team)
group_index = IntegerField()  # Номер группы
round_index = IntegerField()  # Номер тура
status = 'scheduled' | 'in_progress' | 'completed' | 'cancelled'
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

**Логика:**
1. Сортирует участников по рейтингу (если `seed_by_rating=true`)
2. Распределяет по группам методом "змейка":
   - Группа 0: 1, 8, 9, 16
   - Группа 1: 2, 7, 10, 15
   - Группа 2: 3, 6, 11, 14
   - Группа 3: 4, 5, 12, 13

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
    3. Распределить по группам методом "змейка"
    4. Сохранить group_index и row_index для каждого участника
    5. Сгенерировать расписание для каждой группы
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

**Метрики:**
- **Wins** - количество побед
- **Losses** - количество поражений
- **Sets Won/Lost** - выигранные/проигранные сеты
- **Points Won/Lost** - выигранные/проигранные очки
- **Set Ratio** - соотношение сетов (для сортировки при равенстве побед)
- **Point Ratio** - соотношение очков

**Сортировка:**
1. По количеству побед (больше - лучше)
2. При равенстве - по соотношению сетов
3. При равенстве - по соотношению очков
4. При равенстве - личная встреча

---

## UI/UX

### Статусы турнира

**Created (Создан):**
- Можно добавлять/удалять участников
- Доступен автопосев
- Доступна очистка таблиц
- Кнопка "Зафиксировать участников" (переход в `active`)

**Active (Активен):**
- Нельзя добавлять/удалять участников
- Можно вводить счет матчей
- Можно начинать/завершать матчи
- Кнопка "Завершить турнир" (переход в `completed`)

**Completed (Завершен):**
- Только просмотр
- Нельзя изменять счет
- Отображаются финальные результаты

### Интерактивность

**Hover эффекты:**
- При наведении на матч в расписании - подсвечиваются строки участников в таблице
- При наведении на участника в таблице - подсвечиваются его матчи

**Live матчи:**
- Зеленый фон у матчей со статусом `in_progress`
- Красный кружок перед счетом в таблице

**Клик на матч:**
- Открывается `MatchActionDialog` с действиями:
  - Начать матч
  - Ввести счет
  - Отменить матч
  - Удалить матч (только для завершенных)

---

## Настройки

### Переменные окружения

Нет специфичных для Round Robin переменных.

### Конфигурация турнира

```python
# При создании турнира
{
  "system": "round_robin",
  "groups_count": 2,           # Количество групп
  "planned_participants": 16,  # Планируемое количество участников
  "set_format": "best_of_3",   # Формат сета
  "points_to_win_set": 6,      # Очков для победы в сете
  "tiebreak_points": 7         # Очков в тай-брейке
}
```

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
**Дата обновления:** 29 декабря 2024

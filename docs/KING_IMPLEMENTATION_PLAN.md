# План реализации турниров "Кинг" (King/Americano)

## Обзор

Новый тип турниров "Кинг" — парный формат, где участники играют в меняющихся составах. Каждый тур игроки объединяются в новые пары и играют против других пар.

## Ключевые отличия от круговой системы

1. **Формат матчей**: В каждом туре игроки объединяются в пары (A+B vs C+D)
2. **Отдыхающие**: Некоторые игроки могут отдыхать в туре (серые ячейки)
3. **Индексация**: Буквы A, B, C, D вместо цифр
4. **Столбцы туров**: "1 тур", "2 тур" вместо матрицы противников
5. **Режимы подсчета**: G- / M+ / NO для компенсации разного количества матчей
6. **Только одиночки**: Парный режим недоступен

## Этап 1: Модели данных (Backend)

### 1.1 Расширение Tournament.System
`apps/tournaments/models.py`
- Добавить `KING = "king", "Кинг"` в `Tournament.System`

### 1.2 Расширение SchedulePattern.TournamentSystem
- Добавить `KING = "king", "Кинг"` в `SchedulePattern.TournamentSystem`

### 1.3 Новое поле Tournament.king_calculation_mode
```python
class KingCalculationMode(models.TextChoices):
    G_MINUS = "g_minus", "G-"
    M_PLUS = "m_plus", "M+"
    NO = "no", "NO"

king_calculation_mode = models.CharField(
    max_length=10,
    choices=KingCalculationMode.choices,
    default=KingCalculationMode.G_MINUS,
    null=True, blank=True
)
```

### 1.4 Расширение Match для Кинг
Два подхода:
- **Вариант A**: Добавить поля `king_team1_player1_index`, `king_team1_player2_index`, etc.
- **Вариант B** (рекомендуется): Создавать виртуальные Team для каждого матча Кинг

### 1.5 Миграции
```bash
python manage.py makemigrations tournaments matches
python manage.py migrate
```

## Этап 2: Шаблоны расписания

### 2.1 Management команда seed_king_patterns.py
Создать:
1. **Системный**: "Балансированный Американо" (из `KingTournament.py`)
2. **Кастомные**: "Кинг 5", "Кинг 6", "Кинг 7" (из txt файла)

### 2.2 Формат custom_schedule для Кинг
```json
{
  "rounds": [{
    "round": 1,
    "matches": [{"team1": [1,4], "team2": [3,2]}],
    "resting": []
  }]
}
```

### 2.3 Сервис генерации
`apps/tournaments/services/king.py` (НОВЫЙ)
- `generate_king_matches(tournament)`
- `_balanced_americano(count)`
- `persist_king_matches(tournament, generated)`

## Этап 3: API endpoints

### 3.1 TournamentViewSet расширения
`apps/tournaments/api_views.py`
- `lock_participants_king` — фиксация + генерация матчей
- `king_schedule` — получить расписание
- `set_king_calculation_mode` — изменить режим G-/M+/NO

### 3.2 Сериализатор
Добавить `king_calculation_mode` в `TournamentSerializer`

## Этап 4: Frontend типы и API

### 4.1 Типы
`frontend/src/types/tournament.ts`
```typescript
export type TournamentSystem = 'round_robin' | 'knockout' | 'king';
export type KingCalculationMode = 'g_minus' | 'm_plus' | 'no';
export interface KingSchedule { ... }
```

### 4.2 API клиент
`frontend/src/services/api.ts`
- `lockParticipantsKing(id)`
- `getKingSchedule(id)`
- `setKingCalculationMode(id, mode)`

## Этап 5: Frontend страница KingPage

### 5.1 KingPage.tsx (НОВЫЙ)
Копия TournamentDetailPage с модификациями:
- Радиокнопки G- / M+ / NO
- Таблица с буквами и турами
- Расписание игр
- Модальное окно ввода счета

### 5.2 KingTable.tsx (НОВЫЙ)
- Первый столбец: A, B, C, D
- Столбцы: "1 тур", "2 тур", ...
- Серые ячейки для отдыхающих
- Столбец "G-/M+"
- Клик → модалка ввода счета

### 5.3 KingSchedule.tsx (НОВЫЙ)
Отображение:
```
Тур 1: A+H vs B+G  C+F vs D+E
[Плитка 1] [Плитка 2]
```

### 5.4 KingCalculationModeSelector.tsx (НОВЫЙ)
Радиокнопки с тултипом

## Этап 6: Логика подсчета

### 6.1 kingCalculations.ts (НОВЫЙ)
`frontend/src/utils/kingCalculations.ts`
- `calculateKingStats(players, matches, schedule, mode)`
- `getPlayerMatchInRound(playerIndex, round, schedule)`

Реализация режимов:
- **G-**: исключить матчи > min_matches
- **M+**: добавить средние за недостающие до max_matches
- **NO**: считать как есть

## Этап 7: Модальное окно создания

### 7.1 CreateTournamentModal обновление
`frontend/src/components/CreateTournamentModal.tsx`
- Переименовать "Американо" → "Кинг"
- При выборе Кинг: автовыбор "Индивидуальный", блокировка "Парный"
- Валидация: 4-16 участников в группе
- Регламент по умолчанию для Кинг

## Этап 8: Роутинг

### 8.1 App.tsx
```typescript
<Route path="/tournaments/:id/king" element={<KingPage />} />
```

### 8.2 Редирект
В TournamentDetailPage: если `system === 'king'` → `navigate('/tournaments/${id}/king')`

## Этап 9: Стили

### 9.1 king.css (НОВЫЙ)
`frontend/src/styles/king.css`
- `.king-table` — стили таблицы
- `.resting-cell` — серые ячейки
- `.match-tile` — плитки матчей
- `.live-indicator` — красный кружок

## Этап 10: Тестирование

### 10.1 Backend тесты
`apps/tournaments/tests/test_king.py`

### 10.2 Frontend тесты
`frontend/src/pages/__tests__/KingPage.test.tsx`

### 10.3 Документация
`docs/KING_TOURNAMENT.md`

## Порядок реализации

### Фаза 1: Фундамент (4-6ч)
1. Расширение моделей
2. Миграции
3. Seed patterns
4. Сервис king.py

### Фаза 2: Backend API (4-6ч)
5. API endpoints
6. Сериализаторы

### Фаза 3: Frontend базовый (6-8ч)
7. Типы TS
8. API клиент
9. KingPage
10. KingTable
11. Роутинг

### Фаза 4: Frontend расширенный (8-10ч)
12. KingSchedule
13. Радиокнопки
14. Логика подсчета
15. Интеграция модалки

### Фаза 5: UX (4-6ч)
16. CreateTournamentModal
17. Стили
18. Тултипы

### Фаза 6: Тестирование (6-8ч)
19. Тесты
20. Документация

**Итого**: 32-44 часа

## Риски

1. Структура хранения матчей Кинг
2. Сложность алгоритма G- / M+
3. Переиспользование модалки ввода счета
4. Производительность пересчета

## Контрольные точки

- ✅ Создание турнира Кинг
- ✅ Добавление участников
- ✅ Генерация матчей
- ✅ Таблица с турами
- ✅ Расписание
- ✅ Ввод счета
- ✅ Режимы G-/M+/NO
- ✅ Подсчет мест

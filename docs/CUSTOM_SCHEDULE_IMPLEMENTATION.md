# Реализация кастомных шаблонов расписания

## Обзор

Документ описывает, как добавить поддержку пользовательских шаблонов расписания с ручным заданием порядка пар по турам.

## Пример: Шаблон для 4 участников

```
Тур 1: 1-3, 2-4
Тур 2: 1-4, 2-3
Тур 3: 1-2, 3-4
```

---

## 1. Модель данных (Backend)

### apps/tournaments/models.py

```python
class SchedulePattern(models.Model):
    """Шаблон расписания для круговых турниров"""
    
    class PatternType(models.TextChoices):
        BERGER = 'berger', 'Алгоритм Бергера'
        SNAKE = 'snake', 'Змейка'
        RANDOM = 'random', 'Случайный'
        COURT_OPTIMIZED = 'court_optimized', 'Оптимизированный по кортам'
        BALANCED_REST = 'balanced_rest', 'Сбалансированный отдых'
        CUSTOM = 'custom', 'Кастомный шаблон'
    
    name = models.CharField(max_length=100, verbose_name="Название")
    pattern_type = models.CharField(
        max_length=20, 
        choices=PatternType.choices,
        verbose_name="Тип шаблона"
    )
    description = models.TextField(verbose_name="Описание")
    is_default = models.BooleanField(default=False, verbose_name="По умолчанию")
    is_system = models.BooleanField(default=True, verbose_name="Системный")
    
    # Для кастомных шаблонов
    participants_count = models.IntegerField(
        null=True, 
        blank=True,
        verbose_name="Количество участников"
    )
    
    # JSON структура для кастомных шаблонов:
    # {
    #   "rounds": [
    #     {"round": 1, "pairs": [[1, 3], [2, 4]]},
    #     {"round": 2, "pairs": [[1, 4], [2, 3]]},
    #     {"round": 3, "pairs": [[1, 2], [3, 4]]}
    #   ]
    # }
    custom_schedule = models.JSONField(
        null=True, 
        blank=True,
        verbose_name="Кастомное расписание"
    )
    
    # Дополнительные параметры для алгоритмических шаблонов
    parameters = models.JSONField(
        default=dict,
        verbose_name="Параметры"
    )
    
    created_by = models.ForeignKey(
        'auth.User',
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="Создал"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = "Шаблон расписания"
        verbose_name_plural = "Шаблоны расписания"
        ordering = ['is_system', '-is_default', 'name']
    
    def __str__(self):
        return f"{self.name} ({self.get_pattern_type_display()})"
    
    def clean(self):
        """Валидация кастомного шаблона"""
        if self.pattern_type == self.PatternType.CUSTOM:
            if not self.custom_schedule:
                raise ValidationError("Для кастомного шаблона требуется custom_schedule")
            if not self.participants_count:
                raise ValidationError("Для кастомного шаблона требуется participants_count")
            
            # Валидация структуры
            self._validate_custom_schedule()
    
    def _validate_custom_schedule(self):
        """Проверка корректности кастомного расписания"""
        rounds = self.custom_schedule.get('rounds', [])
        n = self.participants_count
        
        # Проверка: все участники от 1 до n
        all_participants = set()
        pairs_count = {}
        
        for round_data in rounds:
            pairs = round_data.get('pairs', [])
            round_participants = set()
            
            for pair in pairs:
                if len(pair) != 2:
                    raise ValidationError(f"Пара должна содержать 2 участника: {pair}")
                
                p1, p2 = pair
                
                # Проверка диапазона
                if p1 < 1 or p1 > n or p2 < 1 or p2 > n:
                    raise ValidationError(f"Участники должны быть от 1 до {n}: {pair}")
                
                # Проверка: участник не играет сам с собой
                if p1 == p2:
                    raise ValidationError(f"Участник не может играть сам с собой: {pair}")
                
                # Проверка: участник играет максимум 1 матч в туре
                if p1 in round_participants or p2 in round_participants:
                    raise ValidationError(f"Участник играет более 1 матча в туре {round_data['round']}")
                
                round_participants.add(p1)
                round_participants.add(p2)
                all_participants.add(p1)
                all_participants.add(p2)
                
                # Подсчет пар (нормализованная пара)
                pair_key = tuple(sorted([p1, p2]))
                pairs_count[pair_key] = pairs_count.get(pair_key, 0) + 1
        
        # Проверка: все участники присутствуют
        if all_participants != set(range(1, n + 1)):
            raise ValidationError(f"Не все участники присутствуют в расписании")
        
        # Проверка: каждая пара встречается ровно 1 раз
        for pair, count in pairs_count.items():
            if count != 1:
                raise ValidationError(f"Пара {pair} встречается {count} раз (должна 1)")
        
        # Проверка: количество пар = n*(n-1)/2
        expected_pairs = n * (n - 1) // 2
        if len(pairs_count) != expected_pairs:
            raise ValidationError(
                f"Количество уникальных пар {len(pairs_count)} != {expected_pairs}"
            )


class Tournament(models.Model):
    # ... существующие поля ...
    
    schedule_pattern = models.ForeignKey(
        SchedulePattern,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        verbose_name="Шаблон расписания",
        help_text="Шаблон для генерации расписания круговой системы"
    )
```

---

## 2. Сервис генерации (Backend)

### apps/tournaments/services/round_robin.py

Добавить функцию для кастомных шаблонов:

```python
def _custom_pattern_pairings(
    team_ids: Sequence[int], 
    pattern: 'SchedulePattern'
) -> List[List[Tuple[int, int]]]:
    """Генерация пар по кастомному шаблону.
    
    Args:
        team_ids: список ID команд (упорядоченный)
        pattern: объект SchedulePattern с кастомным расписанием
    
    Returns:
        Список туров, каждый тур - список пар (team_id1, team_id2)
    """
    if len(team_ids) != pattern.participants_count:
        raise ValueError(
            f"Количество команд {len(team_ids)} != "
            f"ожидаемому в шаблоне {pattern.participants_count}"
        )
    
    # Маппинг: позиция в шаблоне (1-based) -> team_id
    position_to_team = {i + 1: team_id for i, team_id in enumerate(team_ids)}
    
    rounds: List[List[Tuple[int, int]]] = []
    
    for round_data in pattern.custom_schedule['rounds']:
        pairs: List[Tuple[int, int]] = []
        
        for pair_positions in round_data['pairs']:
            pos1, pos2 = pair_positions
            team1_id = position_to_team[pos1]
            team2_id = position_to_team[pos2]
            pairs.append((team1_id, team2_id))
        
        rounds.append(pairs)
    
    return rounds


def generate_round_robin_matches(tournament: Tournament) -> List[GeneratedMatch]:
    """Обновленная функция с поддержкой кастомных шаблонов"""
    if tournament.system != Tournament.System.ROUND_ROBIN:
        raise ValueError("Турнир не в режиме круговой системы")
    
    team_ids = list(
        TournamentEntry.objects.filter(tournament=tournament)
        .values_list("team_id", flat=True)
        .order_by("team_id")
    )
    if not team_ids:
        return []
    
    groups = _split_into_groups(team_ids, max(1, tournament.groups_count))
    
    existing = set(
        Match.objects.filter(tournament=tournament)
        .values_list("team_1_id", "team_2_id", "round_name")
    )
    
    generated: List[GeneratedMatch] = []
    
    for gi, group in enumerate(groups):
        # Выбор алгоритма генерации
        if tournament.schedule_pattern and \
           tournament.schedule_pattern.pattern_type == SchedulePattern.PatternType.CUSTOM:
            # Кастомный шаблон
            rr = _custom_pattern_pairings(group, tournament.schedule_pattern)
        else:
            # Стандартный алгоритм Бергера
            rr = _round_robin_pairings(group)
        
        round_name = f"Группа {gi + 1}"
        order = 1
        
        for tour_pairs in rr:
            for t1, t2 in tour_pairs:
                key = (t1, t2, round_name)
                key_rev = (t2, t1, round_name)
                if key in existing or key_rev in existing:
                    continue
                generated.append(GeneratedMatch(t1, t2, round_name, order))
                order += 1
    
    return generated
```

---

## 3. Management команда для создания шаблонов

### apps/tournaments/management/commands/create_schedule_pattern.py

```python
from django.core.management.base import BaseCommand
from apps.tournaments.models import SchedulePattern


class Command(BaseCommand):
    help = "Создает кастомный шаблон расписания"
    
    def add_arguments(self, parser):
        parser.add_argument('--name', type=str, required=True)
        parser.add_argument('--participants', type=int, required=True)
        parser.add_argument('--schedule', type=str, required=True,
                          help='JSON строка с расписанием')
    
    def handle(self, *args, **options):
        import json
        
        name = options['name']
        participants_count = options['participants']
        schedule_json = options['schedule']
        
        try:
            custom_schedule = json.loads(schedule_json)
        except json.JSONDecodeError as e:
            self.stderr.write(f"Ошибка парсинга JSON: {e}")
            return
        
        pattern = SchedulePattern(
            name=name,
            pattern_type=SchedulePattern.PatternType.CUSTOM,
            description=f"Кастомный шаблон для {participants_count} участников",
            participants_count=participants_count,
            custom_schedule=custom_schedule,
            is_system=False
        )
        
        try:
            pattern.full_clean()
            pattern.save()
            self.stdout.write(
                self.style.SUCCESS(f"Шаблон '{name}' успешно создан (ID: {pattern.id})")
            )
        except Exception as e:
            self.stderr.write(f"Ошибка валидации: {e}")
```

**Пример использования:**

```bash
python manage.py create_schedule_pattern \
  --name "Мой шаблон 4х участников" \
  --participants 4 \
  --schedule '{"rounds":[{"round":1,"pairs":[[1,3],[2,4]]},{"round":2,"pairs":[[1,4],[2,3]]},{"round":3,"pairs":[[1,2],[3,4]]}]}'
```

---

## 4. Admin интерфейс

### apps/tournaments/admin.py

```python
from django.contrib import admin
from .models import SchedulePattern


@admin.register(SchedulePattern)
class SchedulePatternAdmin(admin.ModelAdmin):
    list_display = ['name', 'pattern_type', 'participants_count', 'is_default', 'is_system', 'created_at']
    list_filter = ['pattern_type', 'is_default', 'is_system']
    search_fields = ['name', 'description']
    readonly_fields = ['created_at', 'updated_at', 'created_by']
    
    fieldsets = (
        ('Основное', {
            'fields': ('name', 'pattern_type', 'description', 'is_default', 'is_system')
        }),
        ('Кастомный шаблон', {
            'fields': ('participants_count', 'custom_schedule'),
            'classes': ('collapse',)
        }),
        ('Параметры', {
            'fields': ('parameters',),
            'classes': ('collapse',)
        }),
        ('Метаданные', {
            'fields': ('created_by', 'created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )
    
    def save_model(self, request, obj, form, change):
        if not change:  # Новый объект
            obj.created_by = request.user
        super().save_model(request, obj, form, change)
```

---

## 5. Frontend (React)

### Типы TypeScript

```typescript
// frontend/src/types/tournament.ts

export interface SchedulePattern {
  id: number;
  name: string;
  pattern_type: 'berger' | 'snake' | 'random' | 'court_optimized' | 'balanced_rest' | 'custom';
  description: string;
  is_default: boolean;
  is_system: boolean;
  participants_count?: number;
  custom_schedule?: {
    rounds: Array<{
      round: number;
      pairs: number[][];
    }>;
  };
  parameters?: Record<string, any>;
}
```

### API клиент

```typescript
// frontend/src/services/api.ts

export const schedulePatternApi = {
  getList: async (): Promise<SchedulePattern[]> => {
    const response = await api.get('/schedule-patterns/');
    return response.data;
  },
  
  getByParticipantsCount: async (count: number): Promise<SchedulePattern[]> => {
    const response = await api.get('/schedule-patterns/', {
      params: { participants_count: count }
    });
    return response.data;
  },
  
  create: async (data: Partial<SchedulePattern>): Promise<SchedulePattern> => {
    const response = await api.post('/schedule-patterns/', data);
    return response.data;
  },
};
```

### Компонент выбора шаблона

```typescript
// frontend/src/components/SchedulePatternSelector.tsx

interface Props {
  participantsCount: number;
  selectedPatternId?: number;
  onChange: (patternId: number | null) => void;
}

export const SchedulePatternSelector: React.FC<Props> = ({
  participantsCount,
  selectedPatternId,
  onChange
}) => {
  const [patterns, setPatterns] = useState<SchedulePattern[]>([]);
  
  useEffect(() => {
    loadPatterns();
  }, [participantsCount]);
  
  const loadPatterns = async () => {
    try {
      const allPatterns = await schedulePatternApi.getList();
      
      // Фильтруем: системные + кастомные для нужного количества участников
      const filtered = allPatterns.filter(p => 
        p.is_system || 
        (p.pattern_type === 'custom' && p.participants_count === participantsCount)
      );
      
      setPatterns(filtered);
    } catch (error) {
      console.error('Ошибка загрузки шаблонов:', error);
    }
  };
  
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium text-gray-700">
        Шаблон расписания
      </label>
      
      <select
        value={selectedPatternId || ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="w-full px-3 py-2 border border-gray-300 rounded-md"
      >
        <option value="">По умолчанию (Алгоритм Бергера)</option>
        {patterns.map(pattern => (
          <option key={pattern.id} value={pattern.id}>
            {pattern.name}
            {pattern.pattern_type === 'custom' && ` (${pattern.participants_count} участников)`}
          </option>
        ))}
      </select>
      
      {selectedPatternId && (
        <p className="text-sm text-gray-600">
          {patterns.find(p => p.id === selectedPatternId)?.description}
        </p>
      )}
    </div>
  );
};
```

---

## 6. Миграция

```bash
python manage.py makemigrations tournaments
python manage.py migrate tournaments
```

---

## 7. Создание предустановленных шаблонов

### apps/tournaments/management/commands/seed_schedule_patterns.py

```python
from django.core.management.base import BaseCommand
from apps.tournaments.models import SchedulePattern


class Command(BaseCommand):
    help = "Создает предустановленные шаблоны расписания"
    
    def handle(self, *args, **options):
        patterns = [
            {
                'name': 'Алгоритм Бергера',
                'pattern_type': SchedulePattern.PatternType.BERGER,
                'description': 'Классический алгоритм круговой ротации',
                'is_default': True,
                'is_system': True,
            },
            {
                'name': 'Кастомный 4 участника (1-3,2-4 / 1-4,2-3 / 1-2,3-4)',
                'pattern_type': SchedulePattern.PatternType.CUSTOM,
                'description': 'Специальный порядок для 4 участников',
                'is_system': False,
                'participants_count': 4,
                'custom_schedule': {
                    'rounds': [
                        {'round': 1, 'pairs': [[1, 3], [2, 4]]},
                        {'round': 2, 'pairs': [[1, 4], [2, 3]]},
                        {'round': 3, 'pairs': [[1, 2], [3, 4]]},
                    ]
                },
            },
        ]
        
        for pattern_data in patterns:
            pattern, created = SchedulePattern.objects.get_or_create(
                name=pattern_data['name'],
                defaults=pattern_data
            )
            if created:
                self.stdout.write(
                    self.style.SUCCESS(f"Создан шаблон: {pattern.name}")
                )
            else:
                self.stdout.write(f"Шаблон уже существует: {pattern.name}")
```

---

## Итого

Теперь пользователь может:

1. **Создавать кастомные шаблоны** через Admin или management команду
2. **Выбирать шаблон** при создании турнира
3. **Валидация** автоматически проверяет корректность шаблона
4. **Генерация расписания** использует выбранный шаблон

Ваш пример (1-3,2-4 / 1-4,2-3 / 1-2,3-4) будет работать как кастомный шаблон для 4 участников!

---

## Актуализация (2025‑11)

### UI: выбор формата для группы

- При нечетном числе участников N фронтенд подгружает и объединяет шаблоны для N и N+1.
- Фильтр в модалке выбора формата:
  - системные (`is_system=true`) отображаются всегда;
  - кастомные: при четном N — `participants_count=N`; при нечетном N — `participants_count=N+1`.
- Текущий формат берется из `tournaments_tournament.group_schedule_patterns` по ключу вида `"Группа X"`, показывается в хедере модалки и автоматически выделяется в списке.

### Совместимость

- Если `group_schedule_patterns` пустое/`{}`/`"{}"`, используется «Алгоритм Бергера».
- Сериализатор турнира (`TournamentSerializer`) всегда возвращает `group_schedule_patterns` как JSON‑объект (dict), строковые значения безопасно парсятся.

### Фиксация участников и генерация матчей

- `POST /api/tournaments/{id}/lock_participants/` теперь делает:
  1) удаляет старые групповые матчи только в статусе `scheduled`;
  2) генерирует пары по выбранным шаблонам;
  3) сохраняет матчи атомарно.
- Для матчей группового этапа заполняются поля:
  - `stage='group'`, `group_index=X`, `round_index=k`, `round_name='Группа X'`;
  - `team_low_id/ team_high_id` (нормализованная пара) и `team_1_id/ team_2_id` (фактический порядок);
  - `order_in_round` по схеме: Тур1 — 1..; Тур2 — 101..; Турk — `(k-1)*100 + i`.

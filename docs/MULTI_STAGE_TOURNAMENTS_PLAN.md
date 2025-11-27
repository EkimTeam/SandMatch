# 📋 ПЛАН РЕАЛИЗАЦИИ МНОГОСТАДИЙНЫХ ТУРНИРОВ

## 🎯 Цель проекта

Реализовать возможность создания турниров с несколькими стадиями (например, предварительная + финальная), где:
- Пользователь видит единую сущность "Турнир"
- Организатор может легко создавать новые стадии и переключаться между ними
- Рейтинг рассчитывается для всего турнира целиком, а не для каждой стадии отдельно
- Разные стадии могут иметь разные системы (круговая, олимпийская, кинг)

---

## 📐 Основные правила и ограничения

### Терминология
- **Мастер-турнир** - корневой турнир (`parent_tournament_id = NULL`)
- **Стадия** - дочерний турнир (`parent_tournament_id != NULL`)

### Ключевые правила

#### 1. Название турниров
- **Мастер-турнир**: название как создал организатор (например: "ПроАм 22.11.25")
- **Стадии**: `{название_мастера} - {название_стадии}` (например: "ПроАм 22.11.25 - Плей-офф")

#### 2. Удаление стадий
- ✅ Можно удалить только стадию в статусе **CREATED**
- ✅ Можно удалить только **последнюю** стадию (с хвоста)
- ❌ Нельзя удалить предпоследнюю или более ранние стадии

#### 3. Редактирование стадии (только CREATED)
- ✅ **Можно менять**: систему турнира, число участников, число групп
- ❌ **Нельзя менять**: дату, учет рейтинга, призовой фонд (копируются от мастера)
- ℹ️ **Олимпийка**: всегда одна группа по умолчанию

#### 4. Порядок стадий
- Фиксируется при создании через поле `stage_order`
- ❌ Менять порядок после создания нельзя

#### 5. Завершение турнира
- Кнопка **"Завершить турнир"** - на каждой стадии (рассчитывает рейтинг для всего турнира)
- Кнопка **"Завершить стадию"** - на каждой стадии (функционал будет уточнен позже)

#### 6. Ограничение по системам турнира
- ⚠️ **KING** может иметь подстадией только **KING**
- ✅ **Round Robin** и **Knockout** могут смешиваться между собой
- ❌ **KING** НЕ может смешиваться с Round Robin и Knockout

#### 7. Видимость стадий
- **Организатор и админ**: видят все стадии (включая CREATED)
- **Пользователи**: видят только стадии в статусе ACTIVE или COMPLETED

---

## 🗄️ ЭТАП 1: Backend - База данных и модели

### 1.1. Миграция БД

Добавляем два новых поля в таблицу `tournaments_tournament`:

```python
# apps/tournaments/migrations/XXXX_add_stage_fields.py

from django.db import migrations, models

class Migration(migrations.Migration):
    dependencies = [
        ('tournaments', 'XXXX_previous_migration'),
    ]

    operations = [
        migrations.AddField(
            model_name='tournament',
            name='stage_name',
            field=models.CharField(
                max_length=100, 
                blank=True, 
                default='',
                help_text="Название стадии: 'Предварительная стадия', 'Плей-офф', etc."
            ),
        ),
        migrations.AddField(
            model_name='tournament',
            name='stage_order',
            field=models.IntegerField(
                default=0,
                help_text="Порядковый номер стадии (0 для мастера, 1, 2, 3... для стадий)"
            ),
        ),
    ]
```

### 1.2. Расширение модели Tournament

```python
# apps/tournaments/models.py

class Tournament(models.Model):
    # ... существующие поля ...
    
    parent_tournament = models.ForeignKey(
        'self',
        on_delete=models.CASCADE,
        null=True,
        blank=True,
        related_name='child_stages',
        help_text="Родительский турнир (мастер-турнир)"
    )
    
    stage_name = models.CharField(
        max_length=100,
        blank=True,
        default='',
        help_text="Название стадии"
    )
    
    stage_order = models.IntegerField(
        default=0,
        help_text="Порядковый номер стадии (0 для мастера)"
    )
    
    # === МЕТОДЫ ДЛЯ РАБОТЫ СО СТАДИЯМИ ===
    
    def get_master_tournament(self):
        """Возвращает корневой турнир (мастер-турнир)"""
        if self.parent_tournament_id is None:
            return self
        return self.parent_tournament.get_master_tournament()
    
    def get_all_stages(self):
        """Возвращает все стадии турнира в порядке stage_order"""
        master = self.get_master_tournament()
        stages = [master]
        stages.extend(
            master.child_stages.all().order_by('stage_order')
        )
        return stages
    
    def is_master(self):
        """Является ли корневым турниром"""
        return self.parent_tournament_id is None
    
    def get_stage_number(self):
        """Возвращает номер стадии (1 для мастера, 2, 3... для стадий)"""
        if self.is_master():
            return 1
        return self.stage_order + 1
    
    def can_delete_stage(self):
        """Можно ли удалить эту стадию"""
        # Нельзя удалить мастер-турнир через этот метод
        if self.is_master():
            return False
        
        # Можно удалить только в статусе CREATED
        if self.status != self.Status.CREATED:
            return False
        
        # Можно удалить только последнюю стадию
        master = self.get_master_tournament()
        all_stages = master.get_all_stages()
        last_stage = all_stages[-1] if all_stages else None
        
        return self.id == last_stage.id if last_stage else False
    
    def can_edit_stage_settings(self):
        """Можно ли редактировать настройки стадии"""
        # Можно редактировать только в статусе CREATED
        return self.status == self.Status.CREATED
    
    def validate_stage_system(self, new_system: str):
        """
        Проверяет, можно ли создать стадию с указанной системой
        
        Правило: KING может иметь подстадией только KING
        Round Robin и Knockout могут смешиваться
        """
        master = self.get_master_tournament()
        
        # Если мастер - KING, то все стадии должны быть KING
        if master.system == 'king' and new_system != 'king':
            raise ValueError("Турнир системы KING может иметь только стадии системы KING")
        
        # Если мастер - не KING, то стадии не могут быть KING
        if master.system != 'king' and new_system == 'king':
            raise ValueError("Турнир системы Round Robin/Knockout не может иметь стадии системы KING")
        
        return True
```

---

## 🔧 ЭТАП 2: Backend - Сервисы

### 2.1. Сервис MultiStageService

```python
# apps/tournaments/services/multi_stage_service.py

from django.db import transaction
from apps.tournaments.models import Tournament, TournamentEntry
from apps.players.models import PlayerRatingDynamic, PlayerRatingHistory

class MultiStageService:
    
    @staticmethod
    @transaction.atomic
    def create_next_stage(
        parent_tournament_id: int,
        stage_name: str,
        system: str,
        participant_mode: str,
        groups_count: int = 1,
        copy_participants: bool = True,
        selected_participant_ids: list[int] = None,
        created_by_user = None
    ):
        """
        Создает новую стадию турнира
        
        Args:
            parent_tournament_id: ID родительского турнира (мастер или предыдущая стадия)
            stage_name: Название стадии (из пресета или свое)
            system: Система турнира ('round_robin', 'knockout', 'king')
            participant_mode: Режим участников ('single', 'pair')
            groups_count: Количество групп (для round_robin)
            copy_participants: Копировать всех участников
            selected_participant_ids: Список ID команд для новой стадии
            created_by_user: Пользователь-создатель
        
        Returns:
            Tournament: Созданная стадия
        
        Raises:
            ValueError: Если нарушены правила создания стадий
        """
        parent = Tournament.objects.get(id=parent_tournament_id)
        master = parent.get_master_tournament()
        
        # Валидация системы турнира
        master.validate_stage_system(system)
        
        # Определяем порядковый номер новой стадии
        all_stages = master.get_all_stages()
        next_order = len(all_stages)  # 0 - мастер, 1, 2, 3... - стадии
        
        # Формируем полное название стадии
        full_name = f"{master.name} - {stage_name}"
        
        # Для олимпийки всегда одна группа
        if system == 'knockout':
            groups_count = 1
        
        # Создаем новую стадию
        new_stage = Tournament.objects.create(
            name=full_name,
            parent_tournament=master,
            stage_name=stage_name,
            stage_order=next_order,
            system=system,
            participant_mode=participant_mode,
            groups_count=groups_count,
            # Копируем от мастера (нельзя менять)
            date=master.date,
            is_rating_calc=master.is_rating_calc,
            prize_fund=master.prize_fund,
            ruleset=master.ruleset,
            # Прочие поля
            created_by=created_by_user or master.created_by,
            status=Tournament.Status.CREATED
        )
        
        # Копируем участников
        if copy_participants:
            # Все участники из предыдущей стадии
            entries = TournamentEntry.objects.filter(tournament=parent)
            for entry in entries:
                TournamentEntry.objects.create(
                    tournament=new_stage,
                    team=entry.team,
                    is_out_of_competition=entry.is_out_of_competition
                )
        elif selected_participant_ids:
            # Только выбранные участники
            for team_id in selected_participant_ids:
                TournamentEntry.objects.create(
                    tournament=new_stage,
                    team_id=team_id,
                    is_out_of_competition=False
                )
        
        return new_stage
    
    @staticmethod
    def get_master_tournament_data(tournament_id: int):
        """
        Возвращает данные мастер-турнира со всеми стадиями
        
        Returns:
            dict: {
                'master': {...},
                'stages': [...],
                'current_stage_id': int,
                'can_add_stage': bool
            }
        """
        tournament = Tournament.objects.get(id=tournament_id)
        master = tournament.get_master_tournament()
        stages = master.get_all_stages()
        
        return {
            'master': {
                'id': master.id,
                'name': master.name,
                'date': str(master.date) if master.date else '',
                'status': master.status,
                'system': master.system,
                'is_rating_calc': master.is_rating_calc,
                'prize_fund': master.prize_fund or '',
            },
            'stages': [
                {
                    'id': stage.id,
                    'stage_name': stage.stage_name or 'Основная стадия',
                    'stage_order': stage.get_stage_number(),
                    'system': stage.system,
                    'participant_mode': stage.participant_mode,
                    'groups_count': stage.groups_count,
                    'status': stage.status,
                    'participants_count': stage.entries.count(),
                    'matches_count': stage.matches.count(),
                    'is_current': stage.id == tournament_id,
                    'can_delete': stage.can_delete_stage(),
                    'can_edit': stage.can_edit_stage_settings(),
                }
                for stage in stages
            ],
            'current_stage_id': tournament_id,
            'can_add_stage': True,  # Всегда можно добавить стадию
        }
    
    @staticmethod
    @transaction.atomic
    def delete_stage(stage_id: int):
        """
        Удаляет стадию турнира
        
        Raises:
            ValueError: Если стадию нельзя удалить
        """
        stage = Tournament.objects.get(id=stage_id)
        
        if not stage.can_delete_stage():
            raise ValueError(
                "Можно удалить только последнюю стадию в статусе CREATED"
            )
        
        stage.delete()
    
    @staticmethod
    @transaction.atomic
    def update_stage_settings(
        stage_id: int,
        system: str = None,
        groups_count: int = None,
        participant_mode: str = None
    ):
        """
        Обновляет настройки стадии (только для CREATED)
        
        Raises:
            ValueError: Если стадию нельзя редактировать
        """
        stage = Tournament.objects.get(id=stage_id)
        
        if not stage.can_edit_stage_settings():
            raise ValueError("Можно редактировать только стадию в статусе CREATED")
        
        if system:
            # Валидация системы
            stage.get_master_tournament().validate_stage_system(system)
            stage.system = system
            
            # Для олимпийки всегда одна группа
            if system == 'knockout':
                stage.groups_count = 1
        
        if groups_count is not None and stage.system != 'knockout':
            stage.groups_count = groups_count
        
        if participant_mode:
            stage.participant_mode = participant_mode
        
        stage.save()
    
    @staticmethod
    @transaction.atomic
    def complete_master_tournament(master_tournament_id: int, force: bool = False):
        """
        Завершает весь мастер-турнир и рассчитывает рейтинг для всех стадий
        
        Args:
            master_tournament_id: ID мастер-турнира
            force: Принудительное завершение (игнорировать незавершенные стадии)
        
        Raises:
            ValueError: Если не все стадии завершены
        """
        master = Tournament.objects.get(id=master_tournament_id)
        if not master.is_master():
            master = master.get_master_tournament()
        
        all_stages = master.get_all_stages()
        
        # Проверяем, что все стадии завершены
        if not force:
            incomplete_stages = [
                s for s in all_stages 
                if s.status != Tournament.Status.COMPLETED
            ]
            
            if incomplete_stages:
                raise ValueError(
                    f"Не все стадии завершены: {len(incomplete_stages)} стадий"
                )
        
        # Рассчитываем рейтинг для всего турнира
        from apps.players.services.rating_service import compute_ratings_for_multi_stage_tournament
        
        stage_ids = [s.id for s in all_stages]
        compute_ratings_for_multi_stage_tournament(master.id, stage_ids)
        
        # Помечаем все стадии как завершенные
        for stage in all_stages:
            if stage.status != Tournament.Status.COMPLETED:
                stage.status = Tournament.Status.COMPLETED
                stage.save(update_fields=['status'])
```

---

## 🌐 ЭТАП 3: Backend - API Endpoints

### 3.1. Новые endpoints в TournamentViewSet

```python
# apps/tournaments/api_views.py

from apps.tournaments.services.multi_stage_service import MultiStageService

class TournamentViewSet(viewsets.ModelViewSet):
    # ... существующие методы ...
    
    @action(detail=True, methods=['get'])
    def master_data(self, request, pk=None):
        """
        GET /tournaments/{id}/master_data/
        Возвращает данные мастер-турнира со всеми стадиями
        """
        try:
            data = MultiStageService.get_master_tournament_data(pk)
            return Response(data)
        except Tournament.DoesNotExist:
            return Response({'error': 'Турнир не найден'}, status=404)
    
    @action(detail=True, methods=['post'])
    def create_stage(self, request, pk=None):
        """
        POST /tournaments/{id}/create_stage/
        Создает новую стадию турнира
        
        Body:
        {
            "stage_name": "Финальная стадия",
            "system": "knockout",
            "participant_mode": "pair",
            "groups_count": 1,
            "copy_participants": true,
            "selected_participant_ids": [1, 2, 3]  // опционально
        }
        """
        try:
            stage_name = request.data.get('stage_name')
            system = request.data.get('system')
            participant_mode = request.data.get('participant_mode')
            groups_count = request.data.get('groups_count', 1)
            copy_participants = request.data.get('copy_participants', True)
            selected_participant_ids = request.data.get('selected_participant_ids')
            
            if not stage_name or not system or not participant_mode:
                return Response({
                    'ok': False,
                    'error': 'Не указаны обязательные поля'
                }, status=400)
            
            new_stage = MultiStageService.create_next_stage(
                parent_tournament_id=pk,
                stage_name=stage_name,
                system=system,
                participant_mode=participant_mode,
                groups_count=groups_count,
                copy_participants=copy_participants,
                selected_participant_ids=selected_participant_ids,
                created_by_user=request.user
            )
            
            return Response({
                'ok': True,
                'stage_id': new_stage.id,
                'message': f'Стадия "{stage_name}" создана'
            })
            
        except ValueError as e:
            return Response({'ok': False, 'error': str(e)}, status=400)
        except Exception as e:
            return Response({'ok': False, 'error': str(e)}, status=500)
    
    @action(detail=True, methods=['delete'])
    def delete_stage(self, request, pk=None):
        """
        DELETE /tournaments/{id}/delete_stage/
        Удаляет стадию турнира (только последнюю в статусе CREATED)
        """
        try:
            MultiStageService.delete_stage(pk)
            return Response({'ok': True, 'message': 'Стадия удалена'})
        except ValueError as e:
            return Response({'ok': False, 'error': str(e)}, status=400)
        except Exception as e:
            return Response({'ok': False, 'error': str(e)}, status=500)
    
    @action(detail=True, methods=['patch'])
    def update_stage_settings(self, request, pk=None):
        """
        PATCH /tournaments/{id}/update_stage_settings/
        Обновляет настройки стадии (только CREATED)
        
        Body:
        {
            "system": "knockout",
            "groups_count": 2,
            "participant_mode": "pair"
        }
        """
        try:
            system = request.data.get('system')
            groups_count = request.data.get('groups_count')
            participant_mode = request.data.get('participant_mode')
            
            MultiStageService.update_stage_settings(
                stage_id=pk,
                system=system,
                groups_count=groups_count,
                participant_mode=participant_mode
            )
            
            return Response({'ok': True, 'message': 'Настройки обновлены'})
        except ValueError as e:
            return Response({'ok': False, 'error': str(e)}, status=400)
        except Exception as e:
            return Response({'ok': False, 'error': str(e)}, status=500)
    
    @action(detail=True, methods=['post'])
    def complete_master(self, request, pk=None):
        """
        POST /tournaments/{id}/complete_master/
        Завершает весь мастер-турнир и рассчитывает рейтинг
        """
        try:
            force = request.data.get('force', False)
            
            MultiStageService.complete_master_tournament(pk, force=force)
            
            return Response({
                'ok': True,
                'message': 'Турнир завершен, рейтинг рассчитан для всех стадий'
            })
        except ValueError as e:
            return Response({'ok': False, 'error': str(e)}, status=400)
        except Exception as e:
            return Response({'ok': False, 'error': str(e)}, status=500)
```

### 3.2. Обновление сериализатора

```python
# apps/tournaments/serializers.py

class TournamentSerializer(serializers.ModelSerializer):
    # ... существующие поля ...
    
    stages_count = serializers.SerializerMethodField()
    is_master = serializers.SerializerMethodField()
    master_tournament_id = serializers.SerializerMethodField()
    
    def get_stages_count(self, obj):
        """Количество стадий (только для мастер-турниров)"""
        if obj.parent_tournament_id is None:
            return 1 + obj.child_stages.count()
        return None
    
    def get_is_master(self, obj):
        """Является ли мастер-турниром"""
        return obj.is_master()
    
    def get_master_tournament_id(self, obj):
        """ID мастер-турнира"""
        return obj.get_master_tournament().id
    
    class Meta:
        model = Tournament
        fields = [
            # ... существующие поля ...
            'parent_tournament',
            'stage_name',
            'stage_order',
            'stages_count',
            'is_master',
            'master_tournament_id',
        ]
```

### 3.3. Фильтрация списка турниров

```python
# apps/tournaments/api_views.py

class TournamentViewSet(viewsets.ModelViewSet):
    
    def get_queryset(self):
        """Показываем только мастер-турниры в списке"""
        queryset = Tournament.objects.all()
        
        # В списке показываем только мастер-турниры
        if self.action == 'list':
            queryset = queryset.filter(parent_tournament_id__isnull=True)
        
        return queryset.select_related('created_by').prefetch_related('entries')
```

---

## 🎨 ЭТАП 4: Frontend - Компоненты

### 4.1. Константы для названий стадий

```typescript
// frontend/src/constants/stageNames.ts

export const STAGE_NAME_PRESETS = [
  'Предварительная стадия',
  'Плей-офф',
  'Финальная стадия',
  'Финал А',
  'Финал B',
  'Финал C',
  'Финал Hard',
  'Финал Light',
  'Полуфинальная стадия',
  'Дополнительный турнир',
  'Собственное название'
] as const;
```

### 4.2. Селектор стадий (как кнопки M, MX, MU в BTR)

```typescript
// frontend/src/components/TournamentStageSelector.tsx

interface Stage {
  id: number;
  stage_name: string;
  stage_order: number;
  system: string;
  status: string;
  can_delete: boolean;
  can_edit: boolean;
  is_current: boolean;
}

interface Props {
  stages: Stage[];
  currentStageId: number;
  canEdit: boolean;
  onStageChange: (stageId: number) => void;
  onDeleteStage?: (stageId: number) => void;
}

export const TournamentStageSelector: React.FC<Props> = ({
  stages,
  currentStageId,
  canEdit,
  onStageChange,
  onDeleteStage
}) => {
  // Фильтруем стадии: организатор видит все, пользователь - только active/completed
  const visibleStages = stages.filter(stage => {
    if (canEdit) return true;
    return stage.status === 'active' || stage.status === 'completed';
  });
  
  if (visibleStages.length <= 1) return null;
  
  return (
    <div className="flex gap-1 mb-3 stage-selector">
      {visibleStages.map((stage) => (
        <div key={stage.id} className="relative">
          <button
            onClick={() => onStageChange(stage.id)}
            className={`
              px-3 py-1.5 text-sm rounded border transition-all
              ${stage.is_current
                ? 'bg-blue-600 text-white border-blue-600 font-medium'
                : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'
              }
            `}
          >
            {stage.stage_name}
          </button>
          
          {/* Кнопка удаления (только для последней стадии в CREATED) */}
          {canEdit && stage.can_delete && onDeleteStage && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (confirm(`Удалить стадию "${stage.stage_name}"?`)) {
                  onDeleteStage(stage.id);
                }
              }}
              className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600"
              title="Удалить стадию"
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
};
```

### 4.3. Модальное окно создания стадии

```typescript
// frontend/src/components/CreateStageModal.tsx

import { STAGE_NAME_PRESETS } from '../constants/stageNames';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  tournamentId: number;
  masterSystem: string;  // Система мастер-турнира для валидации
  currentParticipants: Array<{id: number; name: string}>;
  onStageCreated: (stageId: number) => void;
}

export const CreateStageModal: React.FC<Props> = ({
  isOpen,
  onClose,
  tournamentId,
  masterSystem,
  currentParticipants,
  onStageCreated
}) => {
  const [stageNamePreset, setStageNamePreset] = useState(STAGE_NAME_PRESETS[0]);
  const [customStageName, setCustomStageName] = useState('');
  const [system, setSystem] = useState<'round_robin' | 'knockout' | 'king'>(
    masterSystem === 'king' ? 'king' : 'knockout'
  );
  const [participantMode, setParticipantMode] = useState<'single' | 'pair'>('pair');
  const [groupsCount, setGroupsCount] = useState(1);
  const [copyAll, setCopyAll] = useState(true);
  const [selectedParticipants, setSelectedParticipants] = useState<number[]>([]);
  
  // Определяем доступные системы турнира
  const availableSystems = masterSystem === 'king' 
    ? [{ value: 'king', label: 'Кинг' }]
    : [
        { value: 'round_robin', label: 'Круговая' },
        { value: 'knockout', label: 'Олимпийская' }
      ];
  
  const handleSubmit = async () => {
    const stageName = stageNamePreset === 'Собственное название' 
      ? customStageName 
      : stageNamePreset;
    
    if (!stageName.trim()) {
      alert('Введите название стадии');
      return;
    }
    
    try {
      const response = await api.post(`/tournaments/${tournamentId}/create_stage/`, {
        stage_name: stageName,
        system,
        participant_mode: participantMode,
        groups_count: system === 'knockout' ? 1 : groupsCount,
        copy_participants: copyAll,
        selected_participant_ids: copyAll ? null : selectedParticipants
      });
      
      if (response.data.ok) {
        alert(`Стадия "${stageName}" создана!`);
        onStageCreated(response.data.stage_id);
        onClose();
      }
    } catch (error: any) {
      alert(error.response?.data?.error || 'Ошибка при создании стадии');
    }
  };
  
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-bold mb-4">Создать новую стадию</h2>
        
        {/* Название стадии */}
        <div className="mb-4">
          <label className="block mb-2 font-medium">Название стадии</label>
          <select
            value={stageNamePreset}
            onChange={(e) => setStageNamePreset(e.target.value)}
            className="w-full border rounded px-3 py-2 mb-2"
          >
            {STAGE_NAME_PRESETS.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          
          {stageNamePreset === 'Собственное название' && (
            <input
              type="text"
              value={customStageName}
              onChange={(e) => setCustomStageName(e.target.value)}
              placeholder="Введите название стадии"
              className="w-full border rounded px-3 py-2"
            />
          )}
        </div>
        
        {/* Система турнира */}
        <div className="mb-4">
          <label className="block mb-2 font-medium">Система турнира</label>
          <select
            value={system}
            onChange={(e) => setSystem(e.target.value as any)}
            className="w-full border rounded px-3 py-2"
          >
            {availableSystems.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          
          {masterSystem === 'king' && (
            <p className="text-sm text-gray-600 mt-1">
              ℹ️ Турнир системы KING может иметь только стадии системы KING
            </p>
          )}
        </div>
        
        {/* Количество групп (только для круговой) */}
        {system === 'round_robin' && (
          <div className="mb-4">
            <label className="block mb-2 font-medium">Количество групп</label>
            <input
              type="number"
              min="1"
              max="10"
              value={groupsCount}
              onChange={(e) => setGroupsCount(parseInt(e.target.value) || 1)}
              className="w-full border rounded px-3 py-2"
            />
          </div>
        )}
        
        {/* Режим участников */}
        <div className="mb-4">
          <label className="block mb-2 font-medium">Формат</label>
          <select
            value={participantMode}
            onChange={(e) => setParticipantMode(e.target.value as any)}
            className="w-full border rounded px-3 py-2"
          >
            <option value="pair">Парный</option>
            <option value="single">Одиночный</option>
          </select>
        </div>
        
        {/* Участники */}
        <div className="mb-4">
          <label className="flex items-center gap-2 mb-2">
            <input
              type="checkbox"
              checked={copyAll}
              onChange={(e) => setCopyAll(e.target.checked)}
            />
            <span className="font-medium">
              Скопировать всех участников из текущей стадии
            </span>
          </label>
          
          {!copyAll && (
            <div className="mt-2 border rounded p-3 max-h-60 overflow-y-auto">
              <div className="text-sm text-gray-600 mb-2">
                Выберите участников для новой стадии:
              </div>
              {currentParticipants.map(p => (
                <label key={p.id} className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    checked={selectedParticipants.includes(p.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedParticipants([...selectedParticipants, p.id]);
                      } else {
                        setSelectedParticipants(selectedParticipants.filter(id => id !== p.id));
                      }
                    }}
                  />
                  <span>{p.name}</span>
                </label>
              ))}
            </div>
          )}
        </div>
        
        {/* Кнопки */}
        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Создать стадию
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 border rounded hover:bg-gray-50"
          >
            Отмена
          </button>
        </div>
      </div>
    </div>
  );
};
```

### 4.4. Индикатор количества стадий в плитке турнира

```typescript
// frontend/src/components/TournamentCard.tsx

{tournament.stages_count && tournament.stages_count > 1 && (
  <span className="text-xs px-2 py-0.5 rounded bg-purple-100 text-purple-700">
    {tournament.stages_count} {tournament.stages_count === 2 ? 'стадии' : 'стадий'}
  </span>
)}
```

---

## 📱 ЭТАП 5: Frontend - Интеграция в страницы

### 5.1. Обновление TournamentDetailPage

```typescript
// frontend/src/pages/TournamentDetailPage.tsx

const TournamentDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [tournament, setTournament] = useState<any>(null);
  const [masterData, setMasterData] = useState<any>(null);
  const [showCreateStageModal, setShowCreateStageModal] = useState(false);
  
  const canEdit = /* логика проверки прав */;
  
  useEffect(() => {
    loadTournament();
    loadMasterData();
  }, [id]);
  
  const loadMasterData = async () => {
    try {
      const { data } = await api.get(`/tournaments/${id}/master_data/`);
      setMasterData(data);
    } catch (error) {
      console.error('Error loading master data:', error);
    }
  };
  
  const handleStageChange = (stageId: number) => {
    const stage = masterData.stages.find(s => s.id === stageId);
    if (!stage) return;
    
    // Перенаправляем на соответствующую страницу
    if (stage.system === 'knockout') {
      navigate(`/tournaments/${stageId}/knockout`);
    } else if (stage.system === 'king') {
      navigate(`/tournaments/${stageId}/king`);
    } else {
      navigate(`/tournaments/${stageId}`);
    }
  };
  
  const handleDeleteStage = async (stageId: number) => {
    try {
      await api.delete(`/tournaments/${stageId}/delete_stage/`);
      alert('Стадия удалена');
      loadMasterData();
      
      // Переходим на предыдущую стадию
      const stages = masterData.stages.filter(s => s.id !== stageId);
      if (stages.length > 0) {
        handleStageChange(stages[stages.length - 1].id);
      }
    } catch (error: any) {
      alert(error.response?.data?.error || 'Ошибка при удалении стадии');
    }
  };
  
  return (
    <div className="container mx-auto p-4">
      {/* Селектор стадий */}
      {masterData && (
        <TournamentStageSelector
          stages={masterData.stages}
          currentStageId={parseInt(id)}
          canEdit={canEdit}
          onStageChange={handleStageChange}
          onDeleteStage={canEdit ? handleDeleteStage : undefined}
        />
      )}
      
      {/* Название турнира */}
      <h1 className="text-2xl font-bold mb-2">{tournament?.name}</h1>
      
      {/* Остальной контент */}
      {/* ... */}
      
      {/* Кнопка "Добавить стадию" (внизу, перед "Поделиться") */}
      {canEdit && (
        <button
          onClick={() => setShowCreateStageModal(true)}
          className="w-full px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 mb-2"
        >
          + Добавить стадию
        </button>
      )}
      
      {/* Кнопка "Поделиться" */}
      <button className="w-full px-4 py-2 border rounded hover:bg-gray-50">
        📤 Поделиться
      </button>
      
      {/* Модальное окно создания стадии */}
      {showCreateStageModal && masterData && (
        <CreateStageModal
          isOpen={showCreateStageModal}
          onClose={() => setShowCreateStageModal(false)}
          tournamentId={parseInt(id)}
          masterSystem={masterData.master.system}
          currentParticipants={participants}
          onStageCreated={(stageId) => {
            loadMasterData();
            handleStageChange(stageId);
          }}
        />
      )}
    </div>
  );
};
```

### 5.2. Аналогично для KnockoutPage и KingPage

Применить ту же логику интеграции селектора стадий и модального окна.

### 5.3. Обновление функции "Поделиться"

```typescript
const handleShare = async () => {
  // Скрываем селектор стадий
  const stageSelector = document.querySelector('.stage-selector');
  const originalDisplay = stageSelector?.style.display;
  
  if (stageSelector) {
    stageSelector.style.display = 'none';
  }
  
  try {
    // Делаем скриншот
    const element = document.getElementById('tournament-content');
    if (element) {
      const canvas = await html2canvas(element);
      // ... остальная логика экспорта
    }
  } finally {
    // Показываем обратно
    if (stageSelector && originalDisplay) {
      stageSelector.style.display = originalDisplay;
    }
  }
};
```

---

## 🧮 ЭТАП 6: Расчет рейтинга для многостадийных турниров

### 6.1. Модификация rating_service

```python
# apps/players/services/rating_service.py

def compute_ratings_for_multi_stage_tournament(master_tournament_id: int, stage_ids: list[int]):
    """
    Рассчитывает рейтинг для многостадийного турнира.
    Обрабатывает все матчи из всех стадий в хронологическом порядке.
    
    Args:
        master_tournament_id: ID мастер-турнира
        stage_ids: Список ID всех стадий (включая мастер)
    """
    from apps.matches.models import Match
    from apps.players.models import Player, PlayerRatingDynamic, PlayerRatingHistory
    from apps.tournaments.models import Tournament, TournamentEntry
    from django.db.models import Q
    
    master = Tournament.objects.get(id=master_tournament_id)
    
    # Получаем все завершенные матчи из всех стадий
    all_matches = Match.objects.filter(
        tournament_id__in=stage_ids,
        status=Match.Status.COMPLETED
    ).exclude(
        Q(team_1__isnull=True) | Q(team_2__isnull=True)  # Исключаем BYE
    ).select_related(
        'team_1', 'team_2', 'tournament'
    ).prefetch_related(
        'team_1__player_1', 'team_1__player_2',
        'team_2__player_1', 'team_2__player_2'
    ).order_by('finished_at', 'id')
    
    # Собираем всех уникальных игроков
    all_player_ids = set()
    for match in all_matches:
        if match.team_1:
            if match.team_1.player_1_id:
                all_player_ids.add(match.team_1.player_1_id)
            if match.team_1.player_2_id:
                all_player_ids.add(match.team_1.player_2_id)
        if match.team_2:
            if match.team_2.player_1_id:
                all_player_ids.add(match.team_2.player_1_id)
            if match.team_2.player_2_id:
                all_player_ids.add(match.team_2.player_2_id)
    
    # Создаем записи PlayerRatingDynamic для мастер-турнира
    for player_id in all_player_ids:
        player = Player.objects.get(id=player_id)
        PlayerRatingDynamic.objects.create(
            player=player,
            tournament_id=master_tournament_id,  # Важно: мастер-турнир!
            rating_before=player.current_rating,
            rating_after=player.current_rating
        )
    
    # Создаем словарь is_out_of_competition для всех стадий
    entry_map = {}
    for stage_id in stage_ids:
        entries = TournamentEntry.objects.filter(tournament_id=stage_id)
        for entry in entries:
            entry_map[(stage_id, entry.team_id)] = entry
    
    # Обрабатываем матчи последовательно
    for match in all_matches:
        # Проверяем is_out_of_competition
        team1_entry = entry_map.get((match.tournament_id, match.team_1_id))
        team2_entry = entry_map.get((match.tournament_id, match.team_2_id))
        
        if (team1_entry and team1_entry.is_out_of_competition) or \
           (team2_entry and team2_entry.is_out_of_competition):
            # Пропускаем матч, записываем нулевые изменения
            # ... логика записи нулевых изменений
            continue
        
        # Рассчитываем изменение рейтинга (используем существующую логику)
        # ... существующая логика расчета
        
        # Записываем в PlayerRatingHistory с tournament_id = match.tournament_id
        # Обновляем PlayerRatingDynamic с tournament_id = master_tournament_id
```

---

## ✅ ЧЕКЛИСТ РЕАЛИЗАЦИИ

### Backend:
- [ ] Миграция: добавить `stage_name` и `stage_order`
- [ ] Методы модели Tournament (get_master_tournament, get_all_stages, etc.)
- [ ] Сервис MultiStageService
- [ ] API endpoints (master_data, create_stage, delete_stage, update_stage_settings, complete_master)
- [ ] Обновление сериализатора
- [ ] Фильтрация списка турниров (только мастер-турниры)
- [ ] Модификация rating_service для многостадийных турниров

### Frontend:
- [ ] Константы STAGE_NAME_PRESETS
- [ ] Компонент TournamentStageSelector
- [ ] Компонент CreateStageModal
- [ ] Индикатор стадий в TournamentCard
- [ ] Интеграция в TournamentDetailPage
- [ ] Интеграция в KnockoutPage
- [ ] Интеграция в KingPage
- [ ] Обновление функции "Поделиться" (исключение селектора)

### Тестирование:
- [ ] Создание многостадийного турнира
- [ ] Переключение между стадиями
- [ ] Удаление последней стадии
- [ ] Валидация системы KING (не может смешиваться с RR/Knockout)
- [ ] Расчет рейтинга для всех стадий
- [ ] Фильтрация стадий по роли (организатор vs пользователь)
- [ ] Экспорт без селектора стадий
- [ ] Редактирование настроек стадии (только CREATED)
- [ ] Копирование участников при создании стадии
- [ ] Выбор участников при создании стадии

---

## 📝 Дополнительные заметки

### Миграция существующих турниров
После реализации функционала потребуется:
1. Найти турниры, которые нужно объединить (по названию, дате, участникам)
2. Создать связи через `parent_tournament_id`
3. Установить `stage_name` и `stage_order`
4. Пересчитать рейтинг для объединенных турниров

### Будущие улучшения
- Кнопка "Завершить стадию" (функционал будет определен позже)
- Возможность клонирования турнира со всеми стадиями
- Статистика по всем стадиям турнира
- Экспорт результатов всех стадий одним файлом

---

**Дата создания плана:** 26 ноября 2025  
**Статус:** Готов к реализации

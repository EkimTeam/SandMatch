from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from django.utils import timezone

from .models import Tournament, SchedulePattern

@api_view(["POST"])
@permission_classes([AllowAny])
@authentication_classes([])
def new_king(request):
    data = request.data or {}
    required = ["name", "date", "participant_mode", "set_format_id", "ruleset_id"]
    missing = [k for k in required if not data.get(k)]
    if missing:
        return Response({"ok": False, "error": f"Не заполнены поля: {', '.join(missing)}"}, status=400)

    try:
        groups_count = int(data.get("groups_count") or 1)
        planned_participants = int(data.get("participants") or 0) or None
        schedule_pattern_id = data.get("schedule_pattern_id")
        
        # Валидация: для Кинг должно быть от 4 до 16 участников в группе
        if planned_participants and groups_count:
            per_group = planned_participants // groups_count
            if per_group < 4:
                return Response({"ok": False, "error": "Для Кинг должно быть минимум 4 участника в группе"}, status=400)
            if per_group > 16:
                return Response({"ok": False, "error": "Для Кинг должно быть максимум 16 участников в группе"}, status=400)
        
        # Вычисляем размеры групп для верификации кастомных шаблонов
        group_schedule_patterns = {}
        if schedule_pattern_id:
            try:
                pattern = SchedulePattern.objects.get(pk=int(schedule_pattern_id))
                
                # Верификация для кастомных шаблонов
                if pattern.pattern_type == SchedulePattern.PatternType.CUSTOM and pattern.participants_count and planned_participants:
                    # Вычисляем размеры групп
                    base = planned_participants // groups_count
                    remainder = planned_participants % groups_count
                    
                    # Проверяем каждую группу
                    for gi in range(1, groups_count + 1):
                        group_size = base + (1 if gi <= remainder else 0)
                        
                        # Кастомный шаблон подходит если group_size = participants_count или participants_count - 1
                        if group_size != pattern.participants_count and group_size != pattern.participants_count - 1:
                            # Не подходит - используем Балансированный Американо
                            balanced = SchedulePattern.objects.filter(
                                name='Балансированный Американо',
                                tournament_system=SchedulePattern.TournamentSystem.KING
                            ).first()
                            if balanced:
                                group_schedule_patterns[f"Группа {gi}"] = balanced.id
                        else:
                            # Подходит - используем выбранный
                            group_schedule_patterns[f"Группа {gi}"] = pattern.id
                else:
                    # Системный шаблон - применяем ко всем группам
                    for gi in range(1, groups_count + 1):
                        group_schedule_patterns[f"Группа {gi}"] = pattern.id
                        
            except SchedulePattern.DoesNotExist:
                pass  # Игнорируем, если шаблон не найден
        
        tournament = Tournament.objects.create(
            name=data["name"],
            date=data["date"],
            participant_mode=data["participant_mode"],
            set_format_id=int(data["set_format_id"]),
            system=Tournament.System.KING,
            ruleset_id=int(data["ruleset_id"]),
            groups_count=groups_count,
            planned_participants=planned_participants,
            status=Tournament.Status.CREATED,
            group_schedule_patterns=group_schedule_patterns if group_schedule_patterns else None,
            king_calculation_mode='g_minus',  # Режим по умолчанию
        )
    except Exception as e:
        return Response({"ok": False, "error": str(e)}, status=400)

    return Response({"ok": True, "id": tournament.id, "redirect": f"/tournaments/{tournament.id}/king"})

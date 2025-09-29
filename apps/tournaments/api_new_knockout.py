from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from django.db import transaction
import math

from .models import Tournament, KnockoutBracket, DrawPosition, Ruleset
from apps.matches.models import Match
from .services.knockout import generate_initial_matches


@api_view(["POST"])
@permission_classes([AllowAny])
@authentication_classes([])
def new_knockout(request):
    """Создать олимпийский турнир по шагам пользователя.

    Важно: создаём турнир, N сеток, позиции жеребьёвки и матчи для всех раундов.
    В конце редиректим на страницу первой сетки. При любой ошибке возвращаем ok=False и деталь.
    """
    data = request.data or {}

    # 1) Входные параметры
    required = ["name", "date", "participant_mode", "set_format_id"]
    missing = [k for k in required if not data.get(k)]
    if missing:
        return Response({"ok": False, "error": f"Не заполнены поля: {', '.join(missing)}"}, status=400)

    try:
        planned_participants = int(data.get("ko_participants") or data.get("planned_participants") or 0)
        brackets_count = int(data.get("brackets_count") or 1)
        if planned_participants < 1:
            return Response({"ok": False, "error": "ko_participants (planned_participants) должен быть >= 1"}, status=400)
        if brackets_count < 1:
            return Response({"ok": False, "error": "brackets_count должен быть >= 1"}, status=400)
    except Exception:
        return Response({"ok": False, "error": "Некорректные значения ko_participants/brackets_count"}, status=400)

    # 2-5) Создание в транзакции
    try:
        with transaction.atomic():
            # ruleset_id = 5, если нет — любой существующий
            desired_ruleset_id = 5
            if not Ruleset.objects.filter(id=desired_ruleset_id).exists():
                any_ruleset = Ruleset.objects.order_by("id").first()
                if not any_ruleset:
                    return Response({"ok": False, "error": "Нет доступных правил (Ruleset)"}, status=400)
                desired_ruleset_id = any_ruleset.id

            tournament = Tournament.objects.create(
                name=data["name"],
                date=data["date"],
                participant_mode=data["participant_mode"],
                set_format_id=int(data["set_format_id"]),
                system=Tournament.System.KNOCKOUT,
                ruleset_id=int(desired_ruleset_id),
                brackets_count=brackets_count,
                planned_participants=planned_participants,
                status=Tournament.Status.CREATED,
            )

            # размер сетки на одну сетку: ближайшая степень двойки >= ceil(planned_participants / brackets_count)
            per_bracket = math.ceil(planned_participants / brackets_count)
            def next_power_of_two(n: int) -> int:
                if n <= 1:
                    return 1
                return 1 << (n - 1).bit_length()
            size_per_bracket = next_power_of_two(per_bracket)

            brackets = []
            for i in range(brackets_count):
                b = KnockoutBracket.objects.create(
                    tournament=tournament,
                    index=i + 1,
                    size=size_per_bracket,
                    has_third_place=True,
                )
                brackets.append(b)

            # 4) Позиции жеребьёвки
            for b in brackets:
                for pos in range(1, size_per_bracket + 1):
                    DrawPosition.objects.create(
                        bracket=b,
                        position=pos,
                        source=DrawPosition.Source.MAIN if hasattr(DrawPosition, 'Source') else 'MAIN',
                        entry=None,
                        seed=None,
                    )

            # 5) Матчи всех раундов — используем сервис генерации
            for b in brackets:
                generate_initial_matches(b)

            # Всё успешно — редирект на min(bracket_id)
            first_bracket_id = min(b.id for b in brackets)
            return Response({
                "ok": True,
                "id": tournament.id,
                "redirect": f"/tournaments/{tournament.id}/knockout?bracket={first_bracket_id}",
            })
    except Exception as e:
        return Response({"ok": False, "error": f"Ошибка создания олимпийского турнира: {str(e)}"}, status=400)

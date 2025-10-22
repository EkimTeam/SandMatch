from rest_framework.decorators import api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from django.utils import timezone

from .models import Tournament

@api_view(["POST"])
@permission_classes([AllowAny])
@authentication_classes([])
def new_round_robin(request):
    data = request.data or {}
    required = ["name", "date", "participant_mode", "set_format_id", "ruleset_id"]
    missing = [k for k in required if not data.get(k)]
    if missing:
        return Response({"ok": False, "error": f"Не заполнены поля: {', '.join(missing)}"}, status=400)

    try:
        tournament = Tournament.objects.create(
            name=data["name"],
            date=data["date"],
            participant_mode=data["participant_mode"],
            set_format_id=int(data["set_format_id"]),
            system=Tournament.System.ROUND_ROBIN,
            ruleset_id=int(data["ruleset_id"]),
            groups_count=int(data.get("groups_count") or 1),
            planned_participants=int(data.get("participants") or 0) or None,
            status=Tournament.Status.CREATED,
        )
    except Exception as e:
        return Response({"ok": False, "error": str(e)}, status=400)

    return Response({"ok": True, "id": tournament.id, "redirect": f"/tournaments/{tournament.id}/round_robin"})

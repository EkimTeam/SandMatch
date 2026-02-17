from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from apps.accounts.permissions import IsAuthenticatedAndRoleIn, IsTournamentCreatorOrAdmin, Role

from .models import Schedule
from .serializers import ScheduleSerializer


class ScheduleViewSet(viewsets.ModelViewSet):
    queryset = Schedule.objects.all()
    serializer_class = ScheduleSerializer
    permission_classes = [AllowAny]

    def get_permissions(self):
        if self.action in {"create", "update", "partial_update", "destroy"}:
            return [IsAuthenticated()]
        return super().get_permissions()

    @action(detail=True, methods=["get"], url_path="export/pdf", permission_classes=[IsAuthenticated])
    def export_pdf(self, request, pk=None):
        return Response({"ok": False, "error": "not_implemented"}, status=status.HTTP_501_NOT_IMPLEMENTED)

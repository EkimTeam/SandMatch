from django.contrib import admin
from django.urls import path, include, re_path
from django.views.generic import RedirectView, TemplateView
from django.conf import settings
from django.http import JsonResponse
from rest_framework_simplejwt.views import (
    TokenObtainPairView,
    TokenRefreshView,
)

from apps.tournaments.views import (
    TournamentsListView,
    create_tournament,
    TournamentDetailView,
    complete_tournament,
    delete_tournament,
    save_participants,
    save_score,
    get_score,
    start_match,
    cancel_start_match,
    cancel_score,
    get_group_stats,
    brackets_json,
    generate_knockout,
)
from apps.players.views import search_players, create_player
from apps.players.views import PlayersListView

# SPA View для React приложения
class SPAView(TemplateView):
    template_name = "spa.html"

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        # debug flag controls whether vite dev server is used in template
        ctx["debug"] = settings.DEBUG
        return ctx

# Health-check с проверкой готовности
def health(request):
    """
    Health check endpoint с проверкой:
    - Django работает
    - БД доступна
    - Frontend ассеты на месте (опционально)
    """
    from pathlib import Path
    from django.db import connection
    
    checks = {
        "django": True,
        "database": False,
        "frontend_assets": False,
    }
    
    # Проверка БД
    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        checks["database"] = True
    except Exception:
        pass
    
    # Проверка frontend ассетов (не критично)
    try:
        manifest_path = Path(settings.STATIC_ROOT) / "frontend" / "manifest.json"
        checks["frontend_assets"] = manifest_path.exists()
    except Exception:
        pass
    
    # Сервис считается здоровым если Django и БД работают
    is_healthy = checks["django"] and checks["database"]
    
    return JsonResponse({
        "ok": is_healthy,
        "status": "healthy" if is_healthy else "unhealthy",
        "checks": checks
    }, status=200 if is_healthy else 503)

urlpatterns = [
    # Django Admin
    path("sm-admin/", admin.site.urls),
    
    # API endpoints
    path("api/", include("apps.tournaments.api_urls")),
    # Health check
    path("api/health/", health, name="health"),
    # Auth (JWT)
    path("api/auth/token/", TokenObtainPairView.as_view(), name="token_obtain_pair"),
    path("api/auth/token/refresh/", TokenRefreshView.as_view(), name="token_refresh"),
    
    # Legacy endpoints (временно сохраняем для совместимости)
    path("legacy/tournaments/", TournamentsListView.as_view(), name="tournaments_legacy"),
    path("legacy/tournaments/new/", create_tournament, name="tournament_create_legacy"),
    path("legacy/tournaments/<int:pk>/", TournamentDetailView.as_view(), name="tournament_detail_legacy"),
    path("legacy/tournaments/<int:pk>/complete/", complete_tournament, name="tournament_complete_legacy"),
    path("legacy/tournaments/<int:pk>/delete/", delete_tournament, name="tournament_delete_legacy"),
    path("legacy/tournaments/<int:pk>/save-participants/", save_participants, name="tournament_save_participants_legacy"),
    path("legacy/tournaments/<int:pk>/save-score/", save_score, name="tournament_save_score_legacy"),
    path("legacy/tournaments/<int:pk>/get-score/", get_score, name="tournament_get_score_legacy"),
    path("legacy/tournaments/<int:pk>/start-match/", start_match, name="tournament_start_match_legacy"),
    path("legacy/tournaments/<int:pk>/cancel-start-match/", cancel_start_match, name="tournament_cancel_start_match_legacy"),
    path("legacy/tournaments/<int:pk>/cancel-score/", cancel_score, name="tournament_cancel_score_legacy"),
    path("legacy/tournaments/<int:pk>/group-stats/", get_group_stats, name="tournament_group_stats_legacy"),
    path("legacy/tournaments/<int:pk>/generate/knockout/", generate_knockout, name="tournament_generate_knockout_legacy"),
    path("legacy/tournaments/<int:pk>/brackets.json", brackets_json, name="tournament_brackets_json_legacy"),
    path("legacy/players/", PlayersListView.as_view(), name="players_legacy"),
    path("legacy/players/search/", search_players, name="players_search_legacy"),
    path("legacy/players/create/", create_player, name="players_create_legacy"),
    path("legacy/stats/", TemplateView.as_view(template_name="stats/index.html"), name="stats_legacy"),
    
    # SPA - все остальные маршруты направляем в React
    re_path(r"^.*$", SPAView.as_view(), name="spa"),
]

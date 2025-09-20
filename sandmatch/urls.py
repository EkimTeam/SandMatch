from django.contrib import admin
from django.urls import path
from django.views.generic import RedirectView, TemplateView

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
)
from apps.players.views import search_players, create_player
from apps.players.views import PlayersListView

urlpatterns = [
    path("sm-admin/", admin.site.urls),
    path("", RedirectView.as_view(pattern_name="tournaments", permanent=False)),
    path("tournaments/", TournamentsListView.as_view(), name="tournaments"),
    path("tournaments/new/", create_tournament, name="tournament_create"),
    path("tournaments/<int:pk>/", TournamentDetailView.as_view(), name="tournament_detail"),
    path("tournaments/<int:pk>/complete/", complete_tournament, name="tournament_complete"),
    path("tournaments/<int:pk>/delete/", delete_tournament, name="tournament_delete"),
    path("tournaments/<int:pk>/save-participants/", save_participants, name="tournament_save_participants"),
    path("tournaments/<int:pk>/save-score/", save_score, name="tournament_save_score"),
    path("tournaments/<int:pk>/get-score/", get_score, name="tournament_get_score"),
    path("tournaments/<int:pk>/start-match/", start_match, name="tournament_start_match"),
    path("tournaments/<int:pk>/cancel-start-match/", cancel_start_match, name="tournament_cancel_start_match"),
    path("players/", PlayersListView.as_view(), name="players"),
    path("players/search/", search_players, name="players_search"),
    path("players/create/", create_player, name="players_create"),
    path("stats/", TemplateView.as_view(template_name="stats/index.html"), name="stats"),
]

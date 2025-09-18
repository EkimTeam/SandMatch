from django.contrib import admin
from django.urls import path
from django.views.generic import RedirectView, TemplateView

from apps.tournaments.views import (
    TournamentsListView,
    create_tournament,
    TournamentDetailView,
    complete_tournament,
    delete_tournament,
)
from apps.players.views import PlayersListView

urlpatterns = [
    path("sm-admin/", admin.site.urls),
    path("", RedirectView.as_view(pattern_name="tournaments", permanent=False)),
    path("tournaments/", TournamentsListView.as_view(), name="tournaments"),
    path("tournaments/new/", create_tournament, name="tournament_create"),
    path("tournaments/<int:pk>/", TournamentDetailView.as_view(), name="tournament_detail"),
    path("tournaments/<int:pk>/complete/", complete_tournament, name="tournament_complete"),
    path("tournaments/<int:pk>/delete/", delete_tournament, name="tournament_delete"),
    path("players/", PlayersListView.as_view(), name="players"),
    path("stats/", TemplateView.as_view(template_name="stats/index.html"), name="stats"),
]

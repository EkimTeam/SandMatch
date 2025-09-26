from django.urls import path, include
from rest_framework.routers import DefaultRouter
from . import api_views

router = DefaultRouter()
router.register(r'tournaments', api_views.TournamentViewSet)
router.register(r'participants', api_views.ParticipantViewSet)
router.register(r'matches', api_views.MatchViewSet)

urlpatterns = [
    # ВАЖНО: кастомные пути выше router.urls, чтобы не конфликтовать с tournaments/<pk>
    path('tournaments/overview/', api_views.tournament_list, name='api_tournaments_overview'),
    path('set-formats/', api_views.set_formats_list, name='api_set_formats'),
    path('rulesets/', api_views.rulesets_list, name='api_rulesets'),
    path('tournaments/new/', api_views.tournament_create, name='api_tournament_create'),
    # Управляющие действия без CSRF
    path('tournaments/<int:pk>/complete/', api_views.tournament_complete, name='api_tournament_complete'),
    path('tournaments/<int:pk>/remove/', api_views.tournament_remove, name='api_tournament_remove'),

    # роутер DRF
    path('', include(router.urls)),

    # игроки
    path('players/', api_views.PlayerListView.as_view(), name='api_players'),
    path('players/search/', api_views.PlayerSearchView.as_view(), name='api_players_search'),
    path('players/create/', api_views.PlayerCreateView.as_view(), name='api_players_create'),
]

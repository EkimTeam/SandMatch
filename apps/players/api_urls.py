from django.urls import path
from .api_rating import leaderboard, player_history, player_briefs, h2h, player_relations, player_top_wins
from .api_stats import summary_stats

urlpatterns = [
    path('leaderboard/', leaderboard, name='rating_leaderboard'),
    path('player/<int:player_id>/history/', player_history, name='rating_player_history'),
    path('players/briefs/', player_briefs, name='rating_player_briefs'),
    path('h2h/', h2h, name='rating_h2h'),
    path('player/<int:player_id>/relations/', player_relations, name='rating_player_relations'),
    path('player/<int:player_id>/top_wins/', player_top_wins, name='rating_player_top_wins'),
    path('stats/summary/', summary_stats, name='stats_summary'),
]

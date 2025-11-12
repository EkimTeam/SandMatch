from django.urls import path
from .api_rating import leaderboard, player_history

urlpatterns = [
    path('leaderboard/', leaderboard, name='rating_leaderboard'),
    path('player/<int:player_id>/history/', player_history, name='rating_player_history'),
]

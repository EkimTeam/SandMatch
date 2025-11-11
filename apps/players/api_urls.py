from django.urls import path
from . import api_views

urlpatterns = [
    path("ratings/", api_views.ratings_leaderboard, name="ratings_leaderboard"),
    path("ratings/debug/", api_views.ratings_debug, name="ratings_debug"),
    path("players/<int:player_id>/rating_history/", api_views.player_rating_history, name="player_rating_history"),
]



"""
URL маршруты для API BTR.
"""
from django.urls import path
from apps.btr import api_rating

urlpatterns = [
    # Таблица лидеров BTR
    path('leaderboard/', api_rating.btr_leaderboard, name='btr_leaderboard'),
    
    # Детальная информация об игроке
    path('player/<int:player_id>/', api_rating.btr_player_detail, name='btr_player_detail'),
    
    # История рейтинга игрока
    path('player/<int:player_id>/history/', api_rating.btr_player_history, name='btr_player_history'),
    
    # Информация о BTR рейтингах по BP player ID
    path('player/by-bp-id/<int:bp_player_id>/', api_rating.btr_player_by_bp_id, name='btr_player_by_bp_id'),
    
    # Краткая информация об игроке (публичный)
    path('player/<int:player_id>/brief/', api_rating.btr_player_brief, name='btr_player_brief'),
    
    # Список категорий
    path('categories/', api_rating.btr_categories, name='btr_categories'),
]

"""
URL маршруты для Telegram Mini App API
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .api_views import MiniAppTournamentViewSet, mini_app_profile

router = DefaultRouter()
router.register(r'tournaments', MiniAppTournamentViewSet, basename='mini-app-tournament')

urlpatterns = [
    path('', include(router.urls)),
    path('profile/', mini_app_profile, name='mini-app-profile'),
]

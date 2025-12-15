"""
URL маршруты для Telegram Mini App API
"""
from django.urls import path, include
from rest_framework.routers import DefaultRouter

from .api_views import (
    MiniAppTournamentViewSet,
    mini_app_profile,
    tournament_participants,
    register_single,
    register_looking_for_partner,
    register_with_partner,
    send_pair_invitation,
    my_invitations,
    accept_invitation,
    decline_invitation,
    cancel_registration,
)

router = DefaultRouter()
router.register(r'tournaments', MiniAppTournamentViewSet, basename='mini-app-tournament')

urlpatterns = [
    path('', include(router.urls)),
    path('profile/', mini_app_profile, name='mini-app-profile'),
    
    # Регистрация на турниры
    path('tournaments/<int:tournament_id>/participants/', tournament_participants, name='tournament-participants'),
    path('tournaments/<int:tournament_id>/register-single/', register_single, name='register-single'),
    path('tournaments/<int:tournament_id>/register-looking-for-partner/', register_looking_for_partner, name='register-looking-for-partner'),
    path('tournaments/<int:tournament_id>/register-with-partner/', register_with_partner, name='register-with-partner'),
    path('tournaments/<int:tournament_id>/send-invitation/', send_pair_invitation, name='send-pair-invitation'),
    path('tournaments/<int:tournament_id>/cancel-registration/', cancel_registration, name='cancel-registration'),
    
    # Приглашения
    path('invitations/', my_invitations, name='my-invitations'),
    path('invitations/<int:invitation_id>/accept/', accept_invitation, name='accept-invitation'),
    path('invitations/<int:invitation_id>/decline/', decline_invitation, name='decline-invitation'),
]

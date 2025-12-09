from django.urls import path
from .api_views import (
    register, me, password_reset, password_reset_confirm, 
    users_list, set_user_role,
    get_profile, update_profile, change_password,
    search_players_for_link, link_player
)

urlpatterns = [
    path("register/", register, name="auth_register"),
    path("me/", me, name="auth_me"),
    path("password/reset/", password_reset, name="auth_password_reset"),
    path("password/reset/confirm/", password_reset_confirm, name="auth_password_reset_confirm"),
    # Profile endpoints
    path("profile/", get_profile, name="auth_get_profile"),
    path("profile/update/", update_profile, name="auth_update_profile"),
    path("profile/change-password/", change_password, name="auth_change_password"),
    path("profile/search-players/", search_players_for_link, name="auth_search_players"),
    path("profile/link-player/", link_player, name="auth_link_player"),
    # Admin endpoints
    path("users/", users_list, name="auth_users_list"),
    path("users/<int:user_id>/set_role/", set_user_role, name="auth_set_user_role"),
]

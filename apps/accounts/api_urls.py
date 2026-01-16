from django.urls import path
from .api_views import (
    register,
    me,
    export_me,
    password_reset,
    password_reset_confirm,
    get_profile,
    update_profile,
    change_password,
    profile_player_candidates,
    search_players_for_link,
    link_player,
    unlink_player,
    create_player_and_link,
    create_player_and_link,
    users_list,
    set_user_role,
    delete_user,
    unlink_user_telegram,
)

urlpatterns = [
    path("register/", register, name="auth_register"),
    path("me/", me, name="auth_me"),
    path("profile/export/", export_me, name="auth_export_me"),
    path("password/reset/", password_reset, name="auth_password_reset"),
    path("password/reset/confirm/", password_reset_confirm, name="auth_password_reset_confirm"),
    # Profile endpoints
    path("profile/", get_profile, name="auth_get_profile"),
    path("profile/update/", update_profile, name="auth_update_profile"),
    path("profile/change-password/", change_password, name="auth_change_password"),
    path("profile/player-candidates/", profile_player_candidates, name="auth_profile_player_candidates"),
    path("profile/search-players/", search_players_for_link, name="auth_search_players"),
    path("profile/link-player/", link_player, name="auth_link_player"),
    path("profile/unlink-player/", unlink_player, name="auth_unlink_player"),
    path("profile/create-player-and-link/", create_player_and_link, name="auth_create_player_and_link"),
    path("profile/create-player-and-link/", create_player_and_link, name="auth_create_player_and_link"),
    # Admin endpoints
    path("users/", users_list, name="auth_users_list"),
    path("users/<int:user_id>/set_role/", set_user_role, name="auth_set_user_role"),
    path("users/<int:user_id>/delete/", delete_user, name="auth_delete_user"),
    path("users/<int:user_id>/unlink_telegram/", unlink_user_telegram, name="auth_unlink_user_telegram"),
]

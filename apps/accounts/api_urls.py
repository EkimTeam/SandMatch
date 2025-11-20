from django.urls import path
from .api_views import register, me, password_reset, password_reset_confirm, users_list, set_user_role

urlpatterns = [
    path("register/", register, name="auth_register"),
    path("me/", me, name="auth_me"),
    path("password/reset/", password_reset, name="auth_password_reset"),
    path("password/reset/confirm/", password_reset_confirm, name="auth_password_reset_confirm"),
    # Admin endpoints
    path("users/", users_list, name="auth_users_list"),
    path("users/<int:user_id>/set_role/", set_user_role, name="auth_set_user_role"),
]

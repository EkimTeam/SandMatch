from django.contrib import admin
from .models import UserProfile

from django.utils import timezone
from django.utils.http import urlsafe_base64_encode
from django.utils.encoding import force_bytes
from django.contrib.auth.tokens import default_token_generator
from django.conf import settings


@admin.register(UserProfile)
class UserProfileAdmin(admin.ModelAdmin):
    list_display = ('user', 'role', 'created_at')
    list_filter = ('role',)
    search_fields = ('user__username', 'user__email')


from .models import PasswordResetSupportRequest


@admin.action(description="Сгенерировать одноразовую ссылку для сброса пароля")
def generate_password_reset_link(modeladmin, request, queryset):
    selected = list(queryset)
    if len(selected) != 1:
        modeladmin.message_user(request, "Выберите ровно одну заявку.")
        return

    req = selected[0]
    if not req.user:
        modeladmin.message_user(request, "У заявки нет привязанного пользователя (user).")
        return

    uid = urlsafe_base64_encode(force_bytes(req.user.pk))
    token = default_token_generator.make_token(req.user)
    base = (getattr(settings, "FRONTEND_URL", "") or "").rstrip("/")
    if not base:
        modeladmin.message_user(request, f"uid={uid} token={token}")
        return

    link = f"{base}/reset-password/confirm?uid={uid}&token={token}"
    req.status = PasswordResetSupportRequest.Status.IN_PROGRESS
    req.processed_at = timezone.now()
    req.processed_by = request.user
    req.save(update_fields=["status", "processed_at", "processed_by"])
    modeladmin.message_user(request, link)


@admin.register(PasswordResetSupportRequest)
class PasswordResetSupportRequestAdmin(admin.ModelAdmin):
    list_display = ("email", "user", "status", "created_at", "processed_at", "processed_by")
    list_filter = ("status", "created_at")
    search_fields = ("email", "user__username", "user__email")
    readonly_fields = ("created_at", "processed_at", "processed_by", "ip_address", "user_agent")
    actions = [generate_password_reset_link]

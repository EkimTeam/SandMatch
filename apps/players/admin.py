from django.contrib import admin
from .models import Player, SocialLink, PlayerRatingHistory


@admin.register(Player)
class PlayerAdmin(admin.ModelAdmin):
    list_display = ("last_name", "first_name", "patronymic", "display_name", "current_rating", "phone")
    list_filter = ("current_rating",)
    search_fields = ("last_name", "first_name", "patronymic", "display_name", "phone")


@admin.register(SocialLink)
class SocialLinkAdmin(admin.ModelAdmin):
    list_display = ("player", "kind", "handle_or_url")
    list_filter = ("kind",)
    search_fields = ("player__last_name", "player__first_name", "handle_or_url")


@admin.register(PlayerRatingHistory)
class PlayerRatingHistoryAdmin(admin.ModelAdmin):
    list_display = ("player", "value", "tournament", "match", "created_at")
    list_filter = ("created_at",)
    search_fields = ("player__last_name", "player__first_name")

from django.contrib import admin
from .models import Team


@admin.register(Team)
class TeamAdmin(admin.ModelAdmin):
    list_display = ("player_1", "player_2", "created_at")
    search_fields = (
        "player_1__last_name",
        "player_1__first_name",
        "player_2__last_name",
        "player_2__first_name",
    )

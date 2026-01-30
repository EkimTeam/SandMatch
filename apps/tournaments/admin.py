from django.contrib import admin
from .models import Ruleset, SetFormat, Tournament, TournamentEntry, TournamentAnnouncementSettings
from .registration_models import TournamentRegistration, PairInvitation
from .services.round_robin import generate_round_robin_matches, persist_generated_matches


@admin.register(Ruleset)
class RulesetAdmin(admin.ModelAdmin):
    list_display = ("name",)
    search_fields = ("name",)


@admin.register(SetFormat)
class SetFormatAdmin(admin.ModelAdmin):
    list_display = ("name", "games_to", "tiebreak_at", "allow_tiebreak_only_set", "max_sets")
    list_filter = ("games_to", "max_sets")
    search_fields = ("name",)


@admin.register(Tournament)
class TournamentAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "date",
        "status",
        "system",
        "participant_mode",
        "groups_count",
        "set_format",
        "ruleset",
    )
    list_filter = ("status", "system", "participant_mode", "date")
    search_fields = ("name",)
    actions = ["action_generate_round_robin"]

    def action_generate_round_robin(self, request, queryset):
        total_created = 0
        for tournament in queryset:
            if tournament.system != Tournament.System.ROUND_ROBIN:
                continue
            gen = generate_round_robin_matches(tournament)
            total_created += persist_generated_matches(tournament, gen)
        self.message_user(request, f"Создано матчей: {total_created}")

    action_generate_round_robin.short_description = "Сгенерировать расписание (круговая)"


@admin.register(TournamentEntry)
class TournamentEntryAdmin(admin.ModelAdmin):
    list_display = ("tournament", "team", "is_out_of_competition")
    list_filter = ("is_out_of_competition",)
    search_fields = ("tournament__name", "team__player_1__last_name", "team__player_2__last_name")


@admin.register(TournamentRegistration)
class TournamentRegistrationAdmin(admin.ModelAdmin):
    list_display = ("tournament", "player", "partner", "status", "registered_at", "registration_order")
    list_filter = ("status", "tournament__date")
    search_fields = ("player__last_name", "partner__last_name", "tournament__name")
    readonly_fields = ("registered_at", "updated_at", "registration_order")
    ordering = ("tournament", "registration_order", "registered_at")


@admin.register(PairInvitation)
class PairInvitationAdmin(admin.ModelAdmin):
    list_display = ("tournament", "sender", "receiver", "status", "created_at", "responded_at")
    list_filter = ("status", "tournament__date")
    search_fields = ("sender__last_name", "receiver__last_name", "tournament__name")
    readonly_fields = ("created_at", "responded_at")
    ordering = ("-created_at",)


@admin.register(TournamentAnnouncementSettings)
class TournamentAnnouncementSettingsAdmin(admin.ModelAdmin):
    list_display = (
        "tournament",
        "telegram_chat_id",
        "announcement_mode",
        "send_on_creation",
        "send_72h_before",
        "send_48h_before",
        "send_24h_before",
        "send_2h_before",
        "send_on_roster_change",
    )
    list_filter = (
        "announcement_mode",
        "send_on_creation",
        "send_72h_before",
        "send_48h_before",
        "send_24h_before",
        "send_2h_before",
        "send_on_roster_change",
    )
    search_fields = ("tournament__name", "telegram_chat_id")
    readonly_fields = (
        "last_announcement_message_id",
        "sent_on_creation",
        "sent_72h_before",
        "sent_48h_before",
        "sent_24h_before",
        "sent_2h_before",
        "last_roster_change_sent",
        "roster_hash",
        "created_at",
        "updated_at",
    )
    fieldsets = (
        ("Основные настройки", {
            "fields": ("tournament", "telegram_chat_id", "announcement_mode")
        }),
        ("Триггеры отправки", {
            "fields": (
                "send_on_creation",
                "send_72h_before",
                "send_48h_before",
                "send_24h_before",
                "send_2h_before",
                "send_on_roster_change",
            )
        }),
        ("История отправок", {
            "fields": (
                "sent_on_creation",
                "sent_72h_before",
                "sent_48h_before",
                "sent_24h_before",
                "sent_2h_before",
                "last_roster_change_sent",
            ),
            "classes": ("collapse",)
        }),
        ("Служебная информация", {
            "fields": ("last_announcement_message_id", "roster_hash", "created_at", "updated_at"),
            "classes": ("collapse",)
        }),
    )

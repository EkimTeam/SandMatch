from django.contrib import admin
from .models import Ruleset, SetFormat, Tournament, TournamentEntry
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

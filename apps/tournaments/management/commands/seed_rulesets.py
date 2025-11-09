from django.core.management.base import BaseCommand
from apps.tournaments.models import Ruleset

# Ключи критериев сортировки (для дальнейшей реализации логики):
# - wins: количество побед
# - h2h: личные встречи между участниками с равными очками
# - sets_ratio_between: соотношение выигранных сетов к общему числу сетов между собой
# - games_ratio_between: соотношение выигранных геймов к общему числу геймов между собой
# - games_ratio_between_tb3_as_1_0: как выше, но тай-брейк в 3-м сете считать как 1:0 по геймам
# - sets_ratio_all: соотношение выигранных сетов к общему числу сетов среди всех матчей
# - games_ratio_all: соотношение выигранных геймов к общему числу геймов среди всех матчей
# При необходимости легко расширить список токенов, не меняя схему БД.

PRESETS = [
    # Круговая система (по умолчанию tournament_system = round_robin)
    {
        "name": "победы > личные встречи > разница сетов между собой > разница геймов между собой > разница сетов между всеми > разница геймов между всеми",
        "ordering_priority": [
            "wins",
            "h2h",
            "sets_ratio_between",
            "games_ratio_between_tb3_as_1_0",
            "sets_ratio_all",
            "games_ratio_all",
        ],
        "tournament_system": Ruleset.TournamentSystem.ROUND_ROBIN,
    },
    {
        "name": "победы > разница сетов между всеми > разница геймов между всеми > разница сетов между собой > разница геймов между собой",
        "ordering_priority": [
            "wins",
            "sets_ratio_all",
            "games_ratio_all",
            "sets_ratio_between",
            "games_ratio_between",
        ],
        "tournament_system": Ruleset.TournamentSystem.ROUND_ROBIN,
    },
    {
        "name": "разница сетов между всеми > разница геймов между всеми > разница сетов между собой > разница геймов между собой",
        "ordering_priority": [
            "sets_ratio_all",
            "games_ratio_all",
            "sets_ratio_between",
            "games_ratio_between",
        ],
        "tournament_system": Ruleset.TournamentSystem.ROUND_ROBIN,
    },
    {
        "name": "разница геймов между всеми > разница геймов между собой",
        "ordering_priority": [
            "games_ratio_all",
            "games_ratio_between",
        ],
        "tournament_system": Ruleset.TournamentSystem.ROUND_ROBIN,
    },

    # Кинг — новые пресеты
    {
        "name": "победы > разница геймов между всеми > разница геймов между собой > личные встречи",
        "ordering_priority": ["wins", "games_ratio_all", "games_ratio_between", "h2"],
        "tournament_system": Ruleset.TournamentSystem.KING,
    },
    {
        "name": "разница сетов между всеми > разница геймов между всеми > разница сетов между собой > разница геймов между собой > личные встречи",
        "ordering_priority": ["sets_ratio_all", "games_ratio_all", "sets_ratio_between", "games_ratio_between", "h2"],
        "tournament_system": Ruleset.TournamentSystem.KING,
    },
    {
        "name": "разница геймов между всеми > разница геймов между собой > личные встречи",
        "ordering_priority": ["games_ratio_all", "games_ratio_between", "h2"],
        "tournament_system": Ruleset.TournamentSystem.KING,
    },
]


class Command(BaseCommand):
    help = "Заполняет пресеты регламентов (Ruleset)"

    def handle(self, *args, **options):
        created, updated = 0, 0
        for preset in PRESETS:
            defaults = {
                "ordering_priority": preset["ordering_priority"],
                "tournament_system": preset.get("tournament_system", Ruleset.TournamentSystem.ROUND_ROBIN),
            }
            obj, is_created = Ruleset.objects.update_or_create(
                name=preset["name"], defaults=defaults
            )
            if is_created:
                created += 1
            else:
                updated += 1
        self.stdout.write(
            self.style.SUCCESS(
                f"Готово. Создано: {created}, обновлено: {updated}. Всего: {Ruleset.objects.count()}"
            )
        )

from django.core.management.base import BaseCommand
from apps.tournaments.models import SetFormat, Ruleset

SETFORMAT_PRESETS = [
    {
        "name": "один полноценный сет",
        "games_to": 6,
        "tiebreak_at": 6,
        "tiebreak_points": 7,
        "decider_tiebreak_points": 10,
        "allow_tiebreak_only_set": False,
        "max_sets": 1,
    },
    {
        "name": "полноценный матч с тайбрейком в 3м сете",
        "games_to": 6,
        "tiebreak_at": 6,
        "tiebreak_points": 7,
        "decider_tiebreak_points": 10,
        "allow_tiebreak_only_set": True,
        "max_sets": 3,
    },
    {
        "name": "полноценный матч из 3х сетов",
        "games_to": 6,
        "tiebreak_at": 6,
        "tiebreak_points": 7,
        "decider_tiebreak_points": 10,
        "allow_tiebreak_only_set": False,
        "max_sets": 3,
    },
    {
        "name": "только тайбрейк",
        "games_to": 0,
        "tiebreak_at": 0,
        "tiebreak_points": 10,
        "decider_tiebreak_points": 10,
        "allow_tiebreak_only_set": True,
        "max_sets": 1,
    },
    {
        "name": "один укороченный сет",
        "games_to": 4,
        "tiebreak_at": 4,
        "tiebreak_points": 7,
        "decider_tiebreak_points": 10,
        "allow_tiebreak_only_set": False,
        "max_sets": 1,
    },
    {
        "name": "укороченный матч с тайбрейком в 3м сете",
        "games_to": 4,
        "tiebreak_at": 4,
        "tiebreak_points": 7,
        "decider_tiebreak_points": 10,
        "allow_tiebreak_only_set": True,
        "max_sets": 3,
    },
    {
        "name": "укороченный матч из 3х сетов",
        "games_to": 4,
        "tiebreak_at": 4,
        "tiebreak_points": 7,
        "decider_tiebreak_points": 10,
        "allow_tiebreak_only_set": False,
        "max_sets": 3,
    },
]

RULESET_PRESETS = [
    {
        "name": "победы > личные встречи > разница сетов между собой > разница геймов между собой (тайбрейк в 3м сете считается как один гейм 1:0) > разница сетов между всеми > разница геймов между всеми",
        "ordering_priority": [
            "wins",
            "h2h",
            "sets_ratio_between",
            "games_ratio_between_tb3_as_1_0",
            "sets_ratio_all",
            "games_ratio_all",
        ],
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
    },
    {
        "name": "разница сетов между всеми > разница геймов между всеми > разница сетов между собой > разница геймов между собой",
        "ordering_priority": [
            "sets_ratio_all",
            "games_ratio_all",
            "sets_ratio_between",
            "games_ratio_between",
        ],
    },
    {
        "name": "разница геймов между всеми > разница геймов между собой",
        "ordering_priority": [
            "games_ratio_all",
            "games_ratio_between",
        ],
    },
]


class Command(BaseCommand):
    help = "Очищает и заполняет пресеты SetFormat и Ruleset"

    def handle(self, *args, **options):
        # Чистим
        SetFormat.objects.all().delete()
        Ruleset.objects.all().delete()

        # Создаем SetFormat
        for preset in SETFORMAT_PRESETS:
            SetFormat.objects.update_or_create(name=preset["name"], defaults=preset)

        # Создаем Ruleset
        for preset in RULESET_PRESETS:
            Ruleset.objects.update_or_create(
                name=preset["name"], defaults={"ordering_priority": preset["ordering_priority"]}
            )

        self.stdout.write(self.style.SUCCESS("Пресеты SetFormat и Ruleset успешно пересозданы."))

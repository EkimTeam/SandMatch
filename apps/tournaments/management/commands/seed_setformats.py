from django.core.management.base import BaseCommand
from apps.tournaments.models import SetFormat


PRESETS = [
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
        "allow_tiebreak_only_set": True,  # решающий сет — тайбрейк до 10
        "max_sets": 3,
    },
    {
        "name": "полноценный матч из 3х сетов",
        "games_to": 6,
        "tiebreak_at": 6,
        "tiebreak_points": 7,
        "decider_tiebreak_points": 10,
        "allow_tiebreak_only_set": False,  # третий сет — обычный сет
        "max_sets": 3,
    },
    {
        "name": "только тайбрейк",
        "games_to": 0,  # не используется
        "tiebreak_at": 0,  # не используется
        "tiebreak_points": 10,  # по умолчанию TB до 10
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
        "allow_tiebreak_only_set": True,  # решающий — тайбрейк до 10
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


class Command(BaseCommand):
    help = "Заполняет пресеты форматов сетов (SetFormat)"

    def handle(self, *args, **options):
        created, updated = 0, 0
        for preset in PRESETS:
            obj, is_created = SetFormat.objects.update_or_create(
                name=preset["name"], defaults=preset
            )
            if is_created:
                created += 1
            else:
                updated += 1
        self.stdout.write(
            self.style.SUCCESS(
                f"Готово. Создано: {created}, обновлено: {updated}. Всего: {SetFormat.objects.count()}"
            )
        )

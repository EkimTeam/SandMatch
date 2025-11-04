from django.core.management.base import BaseCommand

from apps.tournaments.models import SchedulePattern


class Command(BaseCommand):
    help = "Загружает кастомные шаблоны расписания"

    def handle(self, *args, **options):
        schedules = [
            # 4 участника - вариант 1
            {
                "name": "Кастомный 4 участника (вариант 1)",
                "pattern_type": SchedulePattern.PatternType.CUSTOM,
                "tournament_system": SchedulePattern.TournamentSystem.ROUND_ROBIN,
                "description": "Порядок: 1-3,2-4 / 1-4,2-3 / 1-2,3-4",
                "participants_count": 4,
                "is_system": False,
                "custom_schedule": {
                    "rounds": [
                        {"round": 1, "pairs": [[1, 3], [2, 4]]},
                        {"round": 2, "pairs": [[1, 4], [2, 3]]},
                        {"round": 3, "pairs": [[1, 2], [3, 4]]},
                    ]
                },
            },
            # 4 участника - вариант 2
            {
                "name": "Кастомный 4 участника (вариант 2)",
                "pattern_type": SchedulePattern.PatternType.CUSTOM,
                "tournament_system": SchedulePattern.TournamentSystem.ROUND_ROBIN,
                "description": "Порядок: 1-2,3-4 / 1-3,2-4 / 1-4,2-3",
                "participants_count": 4,
                "is_system": False,
                "custom_schedule": {
                    "rounds": [
                        {"round": 1, "pairs": [[1, 2], [3, 4]]},
                        {"round": 2, "pairs": [[1, 3], [2, 4]]},
                        {"round": 3, "pairs": [[1, 4], [2, 3]]},
                    ]
                },
            },
            # 6 участников - вариант 1
            {
                "name": "Кастомный 6 участников (вариант 1)",
                "pattern_type": SchedulePattern.PatternType.CUSTOM,
                "tournament_system": SchedulePattern.TournamentSystem.ROUND_ROBIN,
                "description": "Порядок: 1-6,2-5,3-4 / 1-2,5-3,6-4 / 3-1,2-6,4-5 / 6-5,1-4,2-3 / 5-1,4-2,3-6",
                "participants_count": 6,
                "is_system": False,
                "custom_schedule": {
                    "rounds": [
                        {"round": 1, "pairs": [[1, 6], [2, 5], [3, 4]]},
                        {"round": 2, "pairs": [[1, 2], [5, 3], [6, 4]]},
                        {"round": 3, "pairs": [[3, 1], [2, 6], [4, 5]]},
                        {"round": 4, "pairs": [[6, 5], [1, 4], [2, 3]]},
                        {"round": 5, "pairs": [[5, 1], [4, 2], [3, 6]]},
                    ]
                },
            },
            # 6 участников - вариант 2
            {
                "name": "Кастомный 6 участников (вариант 2)",
                "pattern_type": SchedulePattern.PatternType.CUSTOM,
                "tournament_system": SchedulePattern.TournamentSystem.ROUND_ROBIN,
                "description": "Порядок: 1-5,2-4,3-6 / 1-4,2-6,3-5 / 1-3,2-5,4-6 / 1-6,2-3,4-5 / 1-2,3-4,5-6",
                "participants_count": 6,
                "is_system": False,
                "custom_schedule": {
                    "rounds": [
                        {"round": 1, "pairs": [[1, 5], [2, 4], [3, 6]]},
                        {"round": 2, "pairs": [[1, 4], [2, 6], [3, 5]]},
                        {"round": 3, "pairs": [[1, 3], [2, 5], [4, 6]]},
                        {"round": 4, "pairs": [[1, 6], [2, 3], [4, 5]]},
                        {"round": 5, "pairs": [[1, 2], [3, 4], [5, 6]]},
                    ]
                },
            },
            # 8 участников - вариант 1
            {
                "name": "Кастомный 8 участников (вариант 1)",
                "pattern_type": SchedulePattern.PatternType.CUSTOM,
                "tournament_system": SchedulePattern.TournamentSystem.ROUND_ROBIN,
                "description": "Порядок: 1-8,2-7,3-6,4-5 / 1-2,7-3,6-4,8-5 / 3-1,4-7,5-6,2-8 / 1-4,2-3,7-5,8-6 / 5-1,4-2,6-7,3-8 / 1-6,2-5,3-4,8-7 / 7-1,6-2,5-3,4-8",
                "participants_count": 8,
                "is_system": False,
                "custom_schedule": {
                    "rounds": [
                        {"round": 1, "pairs": [[1, 8], [2, 7], [3, 6], [4, 5]]},
                        {"round": 2, "pairs": [[1, 2], [7, 3], [6, 4], [8, 5]]},
                        {"round": 3, "pairs": [[3, 1], [4, 7], [5, 6], [2, 8]]},
                        {"round": 4, "pairs": [[1, 4], [2, 3], [7, 5], [8, 6]]},
                        {"round": 5, "pairs": [[5, 1], [4, 2], [6, 7], [3, 8]]},
                        {"round": 6, "pairs": [[1, 6], [2, 5], [3, 4], [8, 7]]},
                        {"round": 7, "pairs": [[7, 1], [6, 2], [5, 3], [4, 8]]},
                    ]
                },
            },
            # 8 участников - вариант 2
            {
                "name": "Кастомный 8 участников (вариант 2)",
                "pattern_type": SchedulePattern.PatternType.CUSTOM,
                "tournament_system": SchedulePattern.TournamentSystem.ROUND_ROBIN,
                "description": "Порядок: 1-7,2-6,3-5,4-8 / 1-6,2-5,3-8,4-7 / 1-5,2-8,3-7,4-6 / 1-8,2-7,3-6,4-5 / 1-3,2-4,5-7,6-8 / 1-4,2-3,5-8,6-7 / 1-2,3-4,5-6,7-8",
                "participants_count": 8,
                "is_system": False,
                "custom_schedule": {
                    "rounds": [
                        {"round": 1, "pairs": [[1, 7], [2, 6], [3, 5], [4, 8]]},
                        {"round": 2, "pairs": [[1, 6], [2, 5], [3, 8], [4, 7]]},
                        {"round": 3, "pairs": [[1, 5], [2, 8], [3, 7], [4, 6]]},
                        {"round": 4, "pairs": [[1, 8], [2, 7], [3, 6], [4, 5]]},
                        {"round": 5, "pairs": [[1, 3], [2, 4], [5, 7], [6, 8]]},
                        {"round": 6, "pairs": [[1, 4], [2, 3], [5, 8], [6, 7]]},
                        {"round": 7, "pairs": [[1, 2], [3, 4], [5, 6], [7, 8]]},
                    ]
                },
            },
        ]

        # Также создаем системные шаблоны (Berger и Snake)
        system_patterns = [
            {
                "name": "Алгоритм Бергера",
                "pattern_type": SchedulePattern.PatternType.BERGER,
                "tournament_system": SchedulePattern.TournamentSystem.ROUND_ROBIN,
                "description": "Классический алгоритм круговой ротации с фиксированной позицией и вращением остальных участников. Справедливое распределение нагрузки.",
                "is_system": True,
            },
            {
                "name": "Змейка",
                "pattern_type": SchedulePattern.PatternType.SNAKE,
                "tournament_system": SchedulePattern.TournamentSystem.ROUND_ROBIN,
                "description": "Последовательное составление пар: 1-2, 3-4, затем 1-3, 2-4 и т.д. Простой для понимания.",
                "is_system": True,
            },
        ]

        created_count = 0
        updated_count = 0
        error_count = 0

        # Создаем системные шаблоны
        for pattern_data in system_patterns:
            try:
                pattern, created = SchedulePattern.objects.update_or_create(
                    name=pattern_data["name"],
                    tournament_system=pattern_data["tournament_system"],
                    defaults=pattern_data,
                )

                if created:
                    created_count += 1
                    self.stdout.write(self.style.SUCCESS(f"✓ Создан системный: {pattern.name}"))
                else:
                    updated_count += 1
                    self.stdout.write(self.style.WARNING(f"↻ Обновлен системный: {pattern.name}"))

            except Exception as e:
                error_count += 1
                self.stderr.write(self.style.ERROR(f"✗ Ошибка для '{pattern_data['name']}': {e}"))

        # Создаем кастомные шаблоны
        for schedule_data in schedules:
            try:
                pattern, created = SchedulePattern.objects.update_or_create(
                    name=schedule_data["name"],
                    tournament_system=schedule_data["tournament_system"],
                    participants_count=schedule_data["participants_count"],
                    defaults=schedule_data,
                )

                if created:
                    created_count += 1
                    self.stdout.write(self.style.SUCCESS(f"✓ Создан: {pattern.name}"))
                else:
                    updated_count += 1
                    self.stdout.write(self.style.WARNING(f"↻ Обновлен: {pattern.name}"))

            except Exception as e:
                error_count += 1
                self.stderr.write(self.style.ERROR(f"✗ Ошибка для '{schedule_data['name']}': {e}"))

        self.stdout.write(
            self.style.SUCCESS(f"\nИтого: создано {created_count}, обновлено {updated_count}, ошибок {error_count}")
        )

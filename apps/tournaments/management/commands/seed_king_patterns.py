"""
Management команда для создания шаблонов расписания для турниров Кинг.
Создает системный алгоритм "Балансированный Американо" и кастомные шаблоны для 5, 6, 7 участников.
"""
from django.core.management.base import BaseCommand
from apps.tournaments.models import SchedulePattern


class Command(BaseCommand):
    help = 'Создать шаблоны расписания для турниров Кинг'

    def handle(self, *args, **options):
        created_count = 0

        # 1. Системный шаблон "Балансированный Американо"
        pattern, created = SchedulePattern.objects.get_or_create(
            name="Балансированный Американо",
            tournament_system=SchedulePattern.TournamentSystem.KING,
            defaults={
                'pattern_type': SchedulePattern.PatternType.BERGER,
                'description': 'Сбалансированный алгоритм генерации пар для турнира Кинг. '
                              'Работает для 4-16 участников. Каждый игрок играет примерно одинаковое '
                              'количество матчей с разными партнерами и против разных соперников.',
                'is_system': True,
            }
        )
        if created:
            created_count += 1
            self.stdout.write(self.style.SUCCESS(f'✓ Создан системный шаблон: {pattern.name}'))
        else:
            self.stdout.write(f'  Шаблон уже существует: {pattern.name}')

        # 2. Кастомный шаблон для 5 участников
        # Расписание на 5:
        # B+E vs D+C
        # E+C vs A+B
        # C+A vs D+E
        # A+D vs B+C
        # D+B vs E+A
        pattern, created = SchedulePattern.objects.get_or_create(
            name="Кинг 5 участников",
            tournament_system=SchedulePattern.TournamentSystem.KING,
            participants_count=5,
            defaults={
                'pattern_type': SchedulePattern.PatternType.CUSTOM,
                'description': 'Кастомное расписание для 5 участников. 5 туров, каждый игрок отдыхает 1 раз.',
                'is_system': False,
                'custom_schedule': {
                    'rounds': [
                        {
                            'round': 1,
                            'matches': [
                                {'team1': [2, 5], 'team2': [4, 3]},  # B+E vs D+C
                            ],
                            'resting': [1]  # A отдыхает
                        },
                        {
                            'round': 2,
                            'matches': [
                                {'team1': [5, 3], 'team2': [1, 2]},  # E+C vs A+B
                            ],
                            'resting': [4]  # D отдыхает
                        },
                        {
                            'round': 3,
                            'matches': [
                                {'team1': [3, 1], 'team2': [4, 5]},  # C+A vs D+E
                            ],
                            'resting': [2]  # B отдыхает
                        },
                        {
                            'round': 4,
                            'matches': [
                                {'team1': [1, 4], 'team2': [2, 3]},  # A+D vs B+C
                            ],
                            'resting': [5]  # E отдыхает
                        },
                        {
                            'round': 5,
                            'matches': [
                                {'team1': [4, 2], 'team2': [5, 1]},  # D+B vs E+A
                            ],
                            'resting': [3]  # C отдыхает
                        },
                    ]
                }
            }
        )
        if created:
            created_count += 1
            self.stdout.write(self.style.SUCCESS(f'✓ Создан кастомный шаблон: {pattern.name}'))
        else:
            self.stdout.write(f'  Шаблон уже существует: {pattern.name}')

        # 3. Кастомный шаблон для 6 участников
        # Расписание на 6:
        # A+F vs B+E
        # C+D vs A+B
        # E+C vs F+D
        # C+A vs B+F
        # D+E vs B+C
        # A+D vs F+E
        # E+A vs D+B
        # C+F vs A+B
        pattern, created = SchedulePattern.objects.get_or_create(
            name="Кинг 6 участников",
            tournament_system=SchedulePattern.TournamentSystem.KING,
            participants_count=6,
            defaults={
                'pattern_type': SchedulePattern.PatternType.CUSTOM,
                'description': 'Кастомное расписание для 6 участников. 8 туров, все играют одинаковое количество матчей.',
                'is_system': False,
                'custom_schedule': {
                    'rounds': [
                        {
                            'round': 1,
                            'matches': [
                                {'team1': [1, 6], 'team2': [2, 5]},  # A+F vs B+E
                            ],
                            'resting': [3, 4]  # C, D отдыхают
                        },
                        {
                            'round': 2,
                            'matches': [
                                {'team1': [3, 4], 'team2': [1, 2]},  # C+D vs A+B
                            ],
                            'resting': [5, 6]  # E, F отдыхают
                        },
                        {
                            'round': 3,
                            'matches': [
                                {'team1': [5, 3], 'team2': [6, 4]},  # E+C vs F+D
                            ],
                            'resting': [1, 2]  # A, B отдыхают
                        },
                        {
                            'round': 4,
                            'matches': [
                                {'team1': [3, 1], 'team2': [2, 6]},  # C+A vs B+F
                            ],
                            'resting': [4, 5]  # D, E отдыхают
                        },
                        {
                            'round': 5,
                            'matches': [
                                {'team1': [4, 5], 'team2': [2, 3]},  # D+E vs B+C
                            ],
                            'resting': [1, 6]  # A, F отдыхают
                        },
                        {
                            'round': 6,
                            'matches': [
                                {'team1': [1, 4], 'team2': [6, 5]},  # A+D vs F+E
                            ],
                            'resting': [2, 3]  # B, C отдыхают
                        },
                        {
                            'round': 7,
                            'matches': [
                                {'team1': [5, 1], 'team2': [4, 2]},  # E+A vs D+B
                            ],
                            'resting': [3, 6]  # C, F отдыхают
                        },
                        {
                            'round': 8,
                            'matches': [
                                {'team1': [3, 6], 'team2': [1, 2]},  # C+F vs A+B
                            ],
                            'resting': [4, 5]  # D, E отдыхают
                        },
                    ]
                }
            }
        )
        if created:
            created_count += 1
            self.stdout.write(self.style.SUCCESS(f'✓ Создан кастомный шаблон: {pattern.name}'))
        else:
            self.stdout.write(f'  Шаблон уже существует: {pattern.name}')

        # 4. Кастомный шаблон для 7 участников
        # Расписание на 7:
        # B+G vs C+F
        # D+E vs G+C
        # F+D vs A+B
        # C+A vs D+G
        # E+F vs A+D
        # G+E vs B+C
        # D+B vs E+A
        # F+G vs B+E
        # A+F vs C+D
        # E+C vs F+B
        # G+A vs D+E
        pattern, created = SchedulePattern.objects.get_or_create(
            name="Кинг 7 участников",
            tournament_system=SchedulePattern.TournamentSystem.KING,
            participants_count=7,
            defaults={
                'pattern_type': SchedulePattern.PatternType.CUSTOM,
                'description': 'Кастомное расписание для 7 участников. 11 туров, каждый игрок отдыхает несколько раз.',
                'is_system': False,
                'custom_schedule': {
                    'rounds': [
                        {
                            'round': 1,
                            'matches': [
                                {'team1': [2, 7], 'team2': [3, 6]},  # B+G vs C+F
                            ],
                            'resting': [1, 4, 5]  # A, D, E отдыхают
                        },
                        {
                            'round': 2,
                            'matches': [
                                {'team1': [4, 5], 'team2': [7, 3]},  # D+E vs G+C
                            ],
                            'resting': [1, 2, 6]  # A, B, F отдыхают
                        },
                        {
                            'round': 3,
                            'matches': [
                                {'team1': [6, 4], 'team2': [1, 2]},  # F+D vs A+B
                            ],
                            'resting': [3, 5, 7]  # C, E, G отдыхают
                        },
                        {
                            'round': 4,
                            'matches': [
                                {'team1': [3, 1], 'team2': [4, 7]},  # C+A vs D+G
                            ],
                            'resting': [2, 5, 6]  # B, E, F отдыхают
                        },
                        {
                            'round': 5,
                            'matches': [
                                {'team1': [5, 6], 'team2': [1, 4]},  # E+F vs A+D
                            ],
                            'resting': [2, 3, 7]  # B, C, G отдыхают
                        },
                        {
                            'round': 6,
                            'matches': [
                                {'team1': [7, 5], 'team2': [2, 3]},  # G+E vs B+C
                            ],
                            'resting': [1, 4, 6]  # A, D, F отдыхают
                        },
                        {
                            'round': 7,
                            'matches': [
                                {'team1': [4, 2], 'team2': [5, 1]},  # D+B vs E+A
                            ],
                            'resting': [3, 6, 7]  # C, F, G отдыхают
                        },
                        {
                            'round': 8,
                            'matches': [
                                {'team1': [6, 7], 'team2': [2, 5]},  # F+G vs B+E
                            ],
                            'resting': [1, 3, 4]  # A, C, D отдыхают
                        },
                        {
                            'round': 9,
                            'matches': [
                                {'team1': [1, 6], 'team2': [3, 4]},  # A+F vs C+D
                            ],
                            'resting': [2, 5, 7]  # B, E, G отдыхают
                        },
                        {
                            'round': 10,
                            'matches': [
                                {'team1': [5, 3], 'team2': [6, 2]},  # E+C vs F+B
                            ],
                            'resting': [1, 4, 7]  # A, D, G отдыхают
                        },
                        {
                            'round': 11,
                            'matches': [
                                {'team1': [7, 1], 'team2': [4, 5]},  # G+A vs D+E
                            ],
                            'resting': [2, 3, 6]  # B, C, F отдыхают
                        },
                    ]
                }
            }
        )
        if created:
            created_count += 1
            self.stdout.write(self.style.SUCCESS(f'✓ Создан кастомный шаблон: {pattern.name}'))
        else:
            self.stdout.write(f'  Шаблон уже существует: {pattern.name}')

        # Итог
        if created_count > 0:
            self.stdout.write(self.style.SUCCESS(f'\n✓ Создано {created_count} новых шаблонов для турниров Кинг'))
        else:
            self.stdout.write(self.style.WARNING('\n  Все шаблоны уже существуют'))

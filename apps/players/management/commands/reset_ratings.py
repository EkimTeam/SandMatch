"""
Management-команда для управления рейтинговой системой.

Позволяет выполнять три независимые операции:
1. Очистка всей истории рейтинга и сброс текущих рейтингов до 0
2. Присвоение стартовых рейтингов игрокам с BTR
3. Пересчёт рейтинга по всем турнирам

Примеры использования:
    # Полный сброс и пересчёт с BTR
    python manage.py reset_ratings --clear-history --assign-btr --recompute

    # Только очистка истории
    python manage.py reset_ratings --clear-history

    # Только присвоение BTR-рейтингов
    python manage.py reset_ratings --assign-btr

    # Только пересчёт рейтинга
    python manage.py reset_ratings --recompute
"""

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.players.models import Player, PlayerRatingHistory, PlayerRatingDynamic
from apps.players.services.initial_rating_service import get_initial_bp_rating
from apps.players.services.rating_service import recompute_history, RecomputeOptions


class Command(BaseCommand):
    help = 'Управление рейтинговой системой: очистка, присвоение BTR, пересчёт'

    def add_arguments(self, parser):
        parser.add_argument(
            '--clear-history',
            action='store_true',
            help='Очистить всю историю рейтинга (PlayerRatingHistory, PlayerRatingDynamic) и установить всем игрокам рейтинг 0'
        )
        parser.add_argument(
            '--assign-btr',
            action='store_true',
            help='Присвоить стартовый рейтинг всем игрокам с BTR'
        )
        parser.add_argument(
            '--recompute',
            action='store_true',
            help='Пересчитать рейтинг по всем турнирам (с учётом multi-stage логики)'
        )
        parser.add_argument(
            '--dry-run',
            action='store_true',
            help='Сухая прогонка: показать все действия без сохранения в БД'
        )

    def handle(self, *args, **options):
        clear_history = options['clear_history']
        assign_btr = options['assign_btr']
        recompute = options['recompute']
        self.dry_run = options['dry_run']

        if not any([clear_history, assign_btr, recompute]):
            self.stdout.write(self.style.WARNING(
                'Не указано ни одного действия. Используйте --clear-history, --assign-btr или --recompute'
            ))
            return

        if self.dry_run:
            self.stdout.write(self.style.WARNING('\n🔍 РЕЖИМ СУХОЙ ПРОГОНКИ: изменения НЕ будут сохранены в БД\n'))

        # Шаг 1: Очистка истории
        if clear_history:
            self.clear_rating_history()

        # Шаг 2: Присвоение BTR-рейтингов
        if assign_btr:
            self.assign_btr_ratings()

        # Шаг 3: Пересчёт рейтинга
        if recompute:
            self.recompute_ratings()

        if self.dry_run:
            self.stdout.write(self.style.SUCCESS('\n✓ Сухая прогонка завершена (изменения НЕ сохранены)'))
        else:
            self.stdout.write(self.style.SUCCESS('\n✓ Все операции завершены'))

    def clear_rating_history(self):
        """Очистить всю историю рейтинга и установить всем игрокам рейтинг 0"""
        self.stdout.write(self.style.WARNING('\n=== ШАГ 1: Очистка истории рейтинга ==='))
        
        # Получаем количество записей для отчёта
        history_count = PlayerRatingHistory.objects.count()
        dynamic_count = PlayerRatingDynamic.objects.count()
        players_count = Player.objects.count()
        
        self.stdout.write(f'  Будет удалено записей PlayerRatingHistory: {history_count}')
        self.stdout.write(f'  Будет удалено записей PlayerRatingDynamic: {dynamic_count}')
        self.stdout.write(f'  Будет сброшен рейтинг для {players_count} игроков (установлен 0)')
        
        if not self.dry_run:
            with transaction.atomic():
                PlayerRatingHistory.objects.all().delete()
                PlayerRatingDynamic.objects.all().delete()
                Player.objects.all().update(current_rating=0)
            
            self.stdout.write(self.style.SUCCESS('✓ История очищена, рейтинги сброшены'))
        else:
            self.stdout.write(self.style.WARNING('  [DRY-RUN] Изменения не применены'))

    def assign_btr_ratings(self):
        """Присвоить стартовый рейтинг всем игрокам с BTR"""
        self.stdout.write(self.style.WARNING('\n=== ШАГ 2: Присвоение BTR-рейтингов ==='))
        
        players_with_btr = Player.objects.exclude(btr_player__isnull=True)
        total_count = players_with_btr.count()
        
        if total_count == 0:
            self.stdout.write('  Нет игроков с BTR')
            return
        
        self.stdout.write(f'  Найдено игроков с BTR: {total_count}')
        
        assigned_count = 0
        skipped_count = 0
        
        if not self.dry_run:
            with transaction.atomic():
                for player in players_with_btr:
                    initial_rating = get_initial_bp_rating(player)
                    
                    if initial_rating > 0:
                        player.current_rating = initial_rating
                        player.save(update_fields=['current_rating'])
                        
                        self.stdout.write(
                            f'  [{player.id}] {player.first_name} {player.last_name}: '
                            f'BTR_ID={player.btr_player_id} → рейтинг={initial_rating}'
                        )
                        assigned_count += 1
                    else:
                        self.stdout.write(
                            self.style.WARNING(
                                f'  [{player.id}] {player.first_name} {player.last_name}: '
                                f'BTR_ID={player.btr_player_id} → не удалось определить рейтинг (пропущен)'
                            )
                        )
                        skipped_count += 1
        else:
            # Dry-run режим
            for player in players_with_btr:
                initial_rating = get_initial_bp_rating(player)
                
                if initial_rating > 0:
                    self.stdout.write(
                        f'  [DRY-RUN] [{player.id}] {player.first_name} {player.last_name}: '
                        f'BTR_ID={player.btr_player_id} → рейтинг={initial_rating}'
                    )
                    assigned_count += 1
                else:
                    self.stdout.write(
                        self.style.WARNING(
                            f'  [DRY-RUN] [{player.id}] {player.first_name} {player.last_name}: '
                            f'BTR_ID={player.btr_player_id} → не удалось определить рейтинг (пропущен)'
                        )
                    )
                    skipped_count += 1
        
        if not self.dry_run:
            self.stdout.write(self.style.SUCCESS(
                f'✓ BTR-рейтинги присвоены: {assigned_count}, пропущено: {skipped_count}'
            ))
        else:
            self.stdout.write(self.style.WARNING(
                f'  [DRY-RUN] Было бы присвоено: {assigned_count}, пропущено: {skipped_count}'
            ))

    def recompute_ratings(self):
        """Пересчитать рейтинг по всем турнирам"""
        self.stdout.write(self.style.WARNING('\n=== ШАГ 3: Пересчёт рейтинга по турнирам ==='))
        
        if self.dry_run:
            from apps.tournaments.models import Tournament
            masters = Tournament.objects.filter(parent_tournament__isnull=True).order_by('date', 'id')
            total_count = masters.count()
            
            self.stdout.write(f'  [DRY-RUN] Будет обработано мастер-турниров: {total_count}')
            
            for master in masters[:5]:  # Показываем первые 5 для примера
                children_count = master.child_tournaments.count()
                if children_count > 0:
                    self.stdout.write(
                        f'  [DRY-RUN] Турнир #{master.id} "{master.name}" ({master.date}): '
                        f'multi-stage, стадий={children_count + 1}'
                    )
                else:
                    self.stdout.write(
                        f'  [DRY-RUN] Турнир #{master.id} "{master.name}" ({master.date}): single-stage'
                    )
            
            if total_count > 5:
                self.stdout.write(f'  [DRY-RUN] ... и ещё {total_count - 5} турниров')
            
            self.stdout.write(self.style.WARNING('  [DRY-RUN] Пересчёт не выполнен'))
        else:
            # Используем существующую логику из rating_service
            # wipe_history=False, так как мы уже очистили историю на шаге 1 (если нужно)
            # Если --recompute вызван без --clear-history, то история не очищается
            options = RecomputeOptions(
                wipe_history=False,  # История уже очищена на шаге 1, если был --clear-history
                start_date=None,
                end_date=None,
                tournament_ids=None,
                start_ratings_per_player=None
            )
            
            self.stdout.write('  Запуск recompute_history...\n')
            recompute_history(options)
            
            self.stdout.write(self.style.SUCCESS('✓ Пересчёт рейтинга завершён'))

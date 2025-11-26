"""
Скрипт для пересчета коэффициентов турниров.
Рассчитывает коэффициент для всех турниров в статусе ACTIVE и COMPLETED.
"""
import os
import sys
import django

# Настройка Django
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

from apps.tournaments.models import Tournament
from apps.tournaments.services.coefficient_calculator import auto_calculate_tournament_coefficient


def recalculate_coefficients(status_filter=None, dry_run=False):
    """
    Пересчитывает коэффициенты турниров.
    
    Args:
        status_filter: Фильтр по статусу ('active', 'completed', None для всех)
        dry_run: Если True, только показывает что будет сделано
    """
    # Получаем турниры
    qs = Tournament.objects.all()
    
    if status_filter == 'active':
        qs = qs.filter(status=Tournament.Status.ACTIVE)
    elif status_filter == 'completed':
        qs = qs.filter(status=Tournament.Status.COMPLETED)
    elif status_filter is None:
        # Пересчитываем для active и completed
        qs = qs.filter(status__in=[Tournament.Status.ACTIVE, Tournament.Status.COMPLETED])
    
    qs = qs.order_by('-date', 'name')
    
    total = qs.count()
    print(f"{'[DRY RUN] ' if dry_run else ''}Найдено турниров для пересчета: {total}\n")
    
    success_count = 0
    error_count = 0
    
    for tournament in qs:
        status_display = tournament.get_status_display()
        old_coef = tournament.rating_coefficient
        
        try:
            if not dry_run:
                new_coef = auto_calculate_tournament_coefficient(tournament.id)
            else:
                # В dry-run режиме не сохраняем, но показываем что будет
                from apps.tournaments.services.coefficient_calculator import (
                    get_tournament_avg_rating,
                    calculate_tournament_coefficient
                )
                from apps.tournaments.models import TournamentEntry
                
                avg_rating = get_tournament_avg_rating(tournament.id)
                if avg_rating is None or avg_rating == 0:
                    avg_rating = 1000.0
                
                participants_count = TournamentEntry.objects.filter(tournament=tournament).count()
                has_prize_fund = bool(tournament.prize_fund and tournament.prize_fund.strip())
                
                new_coef = calculate_tournament_coefficient(
                    avg_rating=avg_rating,
                    participants_count=participants_count,
                    has_prize_fund=has_prize_fund
                )
            
            change_marker = "→" if old_coef != new_coef else "="
            print(f"✅ {tournament.name} ({status_display})")
            print(f"   Коэффициент: {old_coef:.2f} {change_marker} {new_coef:.2f}")
            print(f"   Дата: {tournament.date}")
            print()
            
            success_count += 1
            
        except Exception as e:
            print(f"❌ ОШИБКА: {tournament.name} ({status_display})")
            print(f"   {str(e)}")
            print()
            error_count += 1
    
    print("\n" + "="*60)
    print(f"{'[DRY RUN] ' if dry_run else ''}Итого:")
    print(f"  Успешно: {success_count}")
    print(f"  Ошибок: {error_count}")
    print(f"  Всего: {total}")
    print("="*60)


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Пересчет коэффициентов турниров')
    parser.add_argument(
        '--status',
        choices=['active', 'completed', 'all'],
        default='all',
        help='Статус турниров для пересчета (по умолчанию: all - active и completed)'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Тестовый режим (не сохранять изменения)'
    )
    
    args = parser.parse_args()
    
    status_filter = None if args.status == 'all' else args.status
    
    print("="*60)
    print("ПЕРЕСЧЕТ КОЭФФИЦИЕНТОВ ТУРНИРОВ")
    print("="*60)
    print(f"Статус: {args.status}")
    print(f"Режим: {'DRY RUN (без изменений)' if args.dry_run else 'РЕАЛЬНЫЙ ЗАПУСК'}")
    print("="*60)
    print()
    
    if not args.dry_run:
        confirm = input("Вы уверены? Это изменит коэффициенты турниров. (yes/no): ")
        if confirm.lower() != 'yes':
            print("Отменено.")
            sys.exit(0)
        print()
    
    recalculate_coefficients(status_filter=status_filter, dry_run=args.dry_run)

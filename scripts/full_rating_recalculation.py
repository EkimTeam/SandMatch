"""
Полный пересчет рейтинговой системы BP с нуля.

Этот скрипт выполняет полный пересчет всей рейтинговой системы:
1. Очистка всех данных рейтинга
2. Установка стартовых рейтингов на основе BTR
3. Установка стартовых рейтингов для игроков без BTR
4. Пересчет коэффициентов турниров
5. Последовательный пересчет рейтинга по всем турнирам

ВНИМАНИЕ: Это деструктивная операция! Создайте резервную копию БД перед запуском!

Использование:
    python scripts/full_rating_recalculation.py [--dry-run]
    
    --dry-run: Показать что будет сделано без реального изменения данных
"""

import os
import sys
import django
from datetime import datetime
from typing import Dict, Set

# Настройка Django окружения
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'sandmatch.settings.base')
django.setup()

from django.db import transaction
from django.db.models import Q, Count
from apps.players.models import Player, PlayerRatingDynamic, PlayerRatingHistory
from apps.tournaments.models import Tournament
from apps.matches.models import Match
from apps.players.services.initial_rating_service import get_initial_bp_rating
from apps.players.services import rating_service
from apps.tournaments.services.coefficient_calculator import auto_calculate_and_save_coefficient


def print_section(title: str):
    """Красивый вывод заголовка секции"""
    print("\n" + "=" * 80)
    print(f"  {title}")
    print("=" * 80 + "\n")


def step1_clear_all_ratings(dry_run: bool = False):
    """
    Шаг 1: Очистка всех данных рейтинга
    """
    print_section("ШАГ 1: Очистка всех данных рейтинга")
    
    # Подсчет записей для удаления
    rating_dynamic_count = PlayerRatingDynamic.objects.count()
    rating_history_count = PlayerRatingHistory.objects.count()
    players_with_rating = Player.objects.filter(current_rating__gt=0).count()
    
    print(f"📊 Статистика перед очисткой:")
    print(f"   - PlayerRatingDynamic записей: {rating_dynamic_count}")
    print(f"   - PlayerRatingHistory записей: {rating_history_count}")
    print(f"   - Игроков с рейтингом > 0: {players_with_rating}")
    
    if dry_run:
        print("\n⚠️  DRY RUN: Данные НЕ будут удалены")
        return
    
    print("\n🗑️  Удаление данных...")
    
    with transaction.atomic():
        # Удаляем все записи рейтинга
        PlayerRatingDynamic.objects.all().delete()
        PlayerRatingHistory.objects.all().delete()
        
        # Обнуляем рейтинг у всех игроков
        Player.objects.all().update(current_rating=0)
    
    print("✅ Все данные рейтинга очищены")


def step2_set_btr_based_ratings(dry_run: bool = False):
    """
    Шаг 2: Установка стартовых рейтингов на основе BTR
    """
    print_section("ШАГ 2: Установка стартовых рейтингов на основе BTR")
    
    # Находим всех игроков с BTR связью
    players_with_btr = Player.objects.filter(
        btr_id__isnull=False
    ).select_related('btr_player')
    
    print(f"📊 Найдено игроков с BTR связью: {players_with_btr.count()}")
    
    if dry_run:
        print("\n⚠️  DRY RUN: Рейтинги НЕ будут установлены")
        print("\nПримеры установки рейтинга:")
        for player in players_with_btr[:10]:
            btr_rating = player.btr_player.rating if player.btr_player else None
            bp_rating = get_initial_bp_rating(player, None)
            print(f"   {player.last_name} {player.first_name}: BTR={btr_rating} → BP={bp_rating}")
        if players_with_btr.count() > 10:
            print(f"   ... и ещё {players_with_btr.count() - 10} игроков")
        return
    
    print("\n🎯 Установка рейтингов...")
    
    updated_count = 0
    with transaction.atomic():
        for player in players_with_btr:
            initial_rating = get_initial_bp_rating(player, None)
            player.current_rating = initial_rating
            player.save(update_fields=['current_rating'])
            updated_count += 1
            
            if updated_count % 100 == 0:
                print(f"   Обработано: {updated_count}/{players_with_btr.count()}")
    
    print(f"✅ Установлены рейтинги для {updated_count} игроков на основе BTR")


def step3_set_non_btr_ratings(dry_run: bool = False):
    """
    Шаг 3: Установка стартовых рейтингов для игроков без BTR
    """
    print_section("ШАГ 3: Установка стартовых рейтингов для игроков без BTR")
    
    # Находим игроков без BTR связи, которые играли хотя бы один матч
    players_without_btr = Player.objects.filter(
        Q(btr_id__isnull=True) | Q(btr_id=0)
    ).filter(
        current_rating=0
    )
    
    print(f"📊 Найдено игроков без BTR связи: {players_without_btr.count()}")
    
    # Для каждого игрока анализируем турниры
    rating_assignments = {}
    
    for player in players_without_btr:
        # Находим все матчи игрока
        matches = Match.objects.filter(
            Q(team_1__player_1=player) | Q(team_1__player_2=player) |
            Q(team_2__player_1=player) | Q(team_2__player_2=player)
        ).select_related('tournament')
        
        if not matches.exists():
            continue
        
        # Анализируем турниры
        hard_count = 0
        medium_count = 0
        
        for match in matches:
            tournament_name = (match.tournament.name or '').lower()
            if 'hard' in tournament_name:
                hard_count += 1
            elif 'medium' in tournament_name:
                medium_count += 1
        
        # Определяем рейтинг
        if hard_count > medium_count and hard_count >= 3:
            rating = 1050
            reason = f"HARD турниры ({hard_count})"
        elif medium_count >= 3:
            rating = 950
            reason = f"MEDIUM турниры ({medium_count})"
        else:
            rating = 1000
            reason = "По умолчанию"
        
        rating_assignments[player.id] = {
            'player': player,
            'rating': rating,
            'reason': reason,
            'matches': matches.count()
        }
    
    print(f"\n📊 Распределение рейтингов:")
    rating_1050 = sum(1 for v in rating_assignments.values() if v['rating'] == 1050)
    rating_1000 = sum(1 for v in rating_assignments.values() if v['rating'] == 1000)
    rating_950 = sum(1 for v in rating_assignments.values() if v['rating'] == 950)
    
    print(f"   - 1050 (HARD): {rating_1050} игроков")
    print(f"   - 1000 (по умолчанию): {rating_1000} игроков")
    print(f"   - 950 (MEDIUM): {rating_950} игроков")
    
    if dry_run:
        print("\n⚠️  DRY RUN: Рейтинги НЕ будут установлены")
        print("\nПримеры установки рейтинга:")
        for i, (pid, data) in enumerate(list(rating_assignments.items())[:10]):
            player = data['player']
            print(f"   {player.last_name} {player.first_name}: {data['rating']} ({data['reason']}, матчей: {data['matches']})")
        if len(rating_assignments) > 10:
            print(f"   ... и ещё {len(rating_assignments) - 10} игроков")
        return
    
    print("\n🎯 Установка рейтингов...")
    
    updated_count = 0
    with transaction.atomic():
        for pid, data in rating_assignments.items():
            player = data['player']
            player.current_rating = data['rating']
            player.save(update_fields=['current_rating'])
            updated_count += 1
            
            if updated_count % 50 == 0:
                print(f"   Обработано: {updated_count}/{len(rating_assignments)}")
    
    print(f"✅ Установлены рейтинги для {updated_count} игроков без BTR")


def step4_recalculate_tournament_coefficients(dry_run: bool = False):
    """
    Шаг 4: Пересчет коэффициентов турниров
    """
    print_section("ШАГ 4: Пересчет коэффициентов турниров")
    
    # Находим все активные и завершенные турниры
    tournaments = Tournament.objects.filter(
        status__in=[Tournament.Status.ACTIVE, Tournament.Status.COMPLETED]
    ).order_by('date', 'id')
    
    print(f"📊 Найдено турниров для пересчета: {tournaments.count()}")
    
    if dry_run:
        print("\n⚠️  DRY RUN: Коэффициенты НЕ будут пересчитаны")
        print("\nПримеры пересчета:")
        for tournament in tournaments[:5]:
            print(f"   {tournament.name} ({tournament.date}): текущий коэф = {tournament.rating_coefficient}")
        if tournaments.count() > 5:
            print(f"   ... и ещё {tournaments.count() - 5} турниров")
        return
    
    print("\n🎯 Пересчет коэффициентов...")
    
    updated_count = 0
    for tournament in tournaments:
        try:
            old_coef = tournament.rating_coefficient
            auto_calculate_and_save_coefficient(tournament)
            tournament.refresh_from_db()
            new_coef = tournament.rating_coefficient
            
            updated_count += 1
            
            if updated_count % 10 == 0:
                print(f"   Обработано: {updated_count}/{tournaments.count()}")
            
            if old_coef != new_coef:
                print(f"   ℹ️  {tournament.name}: {old_coef} → {new_coef}")
        
        except Exception as e:
            print(f"   ⚠️  Ошибка при пересчете коэффициента для турнира {tournament.id}: {e}")
    
    print(f"✅ Пересчитаны коэффициенты для {updated_count} турниров")


def step5_recalculate_ratings_for_all_tournaments(dry_run: bool = False):
    """
    Шаг 5: Последовательный пересчет рейтинга по всем турнирам
    """
    print_section("ШАГ 5: Последовательный пересчет рейтинга по всем турнирам")
    
    # Находим все завершенные турниры в хронологическом порядке
    tournaments = Tournament.objects.filter(
        status=Tournament.Status.COMPLETED,
        is_rating_calc=True  # Только турниры с расчетом рейтинга
    ).order_by('date', 'id')
    
    print(f"📊 Найдено завершенных турниров с расчетом рейтинга: {tournaments.count()}")
    
    if dry_run:
        print("\n⚠️  DRY RUN: Рейтинги НЕ будут пересчитаны")
        print("\nПорядок пересчета:")
        for i, tournament in enumerate(tournaments[:10], 1):
            print(f"   {i}. {tournament.name} ({tournament.date})")
        if tournaments.count() > 10:
            print(f"   ... и ещё {tournaments.count() - 10} турниров")
        return
    
    print("\n🎯 Пересчет рейтингов по турнирам...")
    print("   (это может занять некоторое время)\n")
    
    processed_count = 0
    error_count = 0
    
    for tournament in tournaments:
        try:
            print(f"   [{processed_count + 1}/{tournaments.count()}] {tournament.name} ({tournament.date})...", end=" ")
            
            # Пересчитываем рейтинг для турнира
            rating_service.compute_ratings_for_tournament(tournament.id)
            
            print("✅")
            processed_count += 1
            
        except Exception as e:
            print(f"❌ Ошибка: {e}")
            error_count += 1
    
    print(f"\n✅ Обработано турниров: {processed_count}")
    if error_count > 0:
        print(f"⚠️  Ошибок: {error_count}")


def main():
    """Главная функция скрипта"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Полный пересчет рейтинговой системы BP с нуля'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Показать что будет сделано без реального изменения данных'
    )
    parser.add_argument(
        '--skip-step',
        type=int,
        action='append',
        help='Пропустить указанный шаг (можно указать несколько раз)'
    )
    
    args = parser.parse_args()
    
    skip_steps = set(args.skip_step or [])
    
    print("\n" + "=" * 80)
    print("  ПОЛНЫЙ ПЕРЕСЧЕТ РЕЙТИНГОВОЙ СИСТЕМЫ BP")
    print("=" * 80)
    
    if args.dry_run:
        print("\n⚠️  РЕЖИМ DRY RUN: Данные НЕ будут изменены")
    else:
        print("\n⚠️  ВНИМАНИЕ: Это деструктивная операция!")
        print("   Убедитесь, что создали резервную копию БД!")
        
        response = input("\n   Продолжить? (yes/no): ")
        if response.lower() != 'yes':
            print("\n❌ Операция отменена")
            return
    
    start_time = datetime.now()
    
    try:
        # Шаг 1: Очистка
        if 1 not in skip_steps:
            step1_clear_all_ratings(dry_run=args.dry_run)
        else:
            print_section("ШАГ 1: ПРОПУЩЕН")
        
        # Шаг 2: BTR рейтинги
        if 2 not in skip_steps:
            step2_set_btr_based_ratings(dry_run=args.dry_run)
        else:
            print_section("ШАГ 2: ПРОПУЩЕН")
        
        # Шаг 3: Не-BTR рейтинги
        if 3 not in skip_steps:
            step3_set_non_btr_ratings(dry_run=args.dry_run)
        else:
            print_section("ШАГ 3: ПРОПУЩЕН")
        
        # Шаг 4: Коэффициенты турниров
        if 4 not in skip_steps:
            step4_recalculate_tournament_coefficients(dry_run=args.dry_run)
        else:
            print_section("ШАГ 4: ПРОПУЩЕН")
        
        # Шаг 5: Рейтинги по турнирам
        if 5 not in skip_steps:
            step5_recalculate_ratings_for_all_tournaments(dry_run=args.dry_run)
        else:
            print_section("ШАГ 5: ПРОПУЩЕН")
        
        end_time = datetime.now()
        duration = end_time - start_time
        
        print_section("ЗАВЕРШЕНО")
        print(f"⏱️  Время выполнения: {duration}")
        
        if args.dry_run:
            print("\n⚠️  Это был DRY RUN - данные не изменены")
            print("   Запустите без --dry-run для реального выполнения")
        else:
            print("\n✅ Все операции выполнены успешно!")
            print("   Рейтинговая система полностью пересчитана")
    
    except Exception as e:
        print(f"\n❌ КРИТИЧЕСКАЯ ОШИБКА: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()

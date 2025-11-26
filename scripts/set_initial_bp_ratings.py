#!/usr/bin/env python
"""
Скрипт для установки стартового BP рейтинга игрокам на основе BTR.

Логика:
1. Для всех игроков с current_rating = 0 и связью с BTR → рассчитывает BP рейтинг по формуле
2. Для всех игроков с current_rating = 0 без связи с BTR → устанавливает 1000

Запуск:
    docker compose exec web python scripts/set_initial_bp_ratings.py
    docker compose exec web python scripts/set_initial_bp_ratings.py --dry-run  # Только показать, без изменений
    docker compose exec web python scripts/set_initial_bp_ratings.py --verbose  # Подробный вывод
    docker compose exec web python scripts/set_initial_bp_ratings.py --force    # Обновить рейтинг даже если он уже установлен
"""
import os
import sys
import django

# Настройка Django окружения
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'sandmatch.settings.base')
django.setup()

from apps.players.models import Player
from apps.players.services.initial_rating_service import get_initial_bp_rating


def set_initial_bp_ratings(dry_run: bool = False, verbose: bool = False, force: bool = False):
    """
    Устанавливает стартовый BP рейтинг игрокам на основе BTR или дефолтного значения.
    
    Args:
        dry_run: Если True, только показывает результаты без изменений
        verbose: Если True, выводит подробную информацию
        force: Если True, обновляет рейтинг даже если он уже установлен
    """
    print("=" * 80)
    print("Скрипт установки стартового BP рейтинга")
    print("=" * 80)
    
    if dry_run:
        print("⚠️  РЕЖИМ ТЕСТИРОВАНИЯ (изменения не будут сохранены)")
    
    if force:
        print("⚠️  РЕЖИМ FORCE (обновление всех игроков)")
    
    print()
    
    # Получаем игроков
    if force:
        players = Player.objects.all()
        print(f"📊 Всего игроков: {players.count()}")
    else:
        players = Player.objects.filter(current_rating=0)
        print(f"📊 Игроков с рейтингом = 0: {players.count()}")
    
    print()
    
    # Статистика
    stats = {
        'from_btr': 0,           # Рейтинг установлен из BTR
        'default': 0,            # Установлен дефолтный рейтинг 1000
        'skipped': 0,            # Пропущены (уже есть рейтинг)
        'errors': 0,             # Ошибки
    }
    
    # Детальная информация
    from_btr_players = []
    
    print("🔄 Начинаем обработку...")
    print("-" * 80)
    
    for player in players:
        # Пропускаем если рейтинг уже установлен (и не force режим)
        if not force and player.current_rating and player.current_rating > 0:
            stats['skipped'] += 1
            if verbose:
                print(f"⏭️  {player.last_name} {player.first_name} - уже есть рейтинг {player.current_rating}")
            continue
        
        try:
            # Определяем стартовый рейтинг
            initial_rating = get_initial_bp_rating(player)
            
            # Проверяем, был ли использован BTR
            is_from_btr = player.btr_player_id is not None
            
            if is_from_btr:
                stats['from_btr'] += 1
                from_btr_players.append({
                    'bp_id': player.id,
                    'bp_name': f"{player.last_name} {player.first_name}",
                    'btr_id': player.btr_player_id,
                    'old_rating': player.current_rating,
                    'new_rating': initial_rating,
                })
                
                print(f"✅ {player.last_name} {player.first_name} (BP #{player.id}) → "
                      f"BP рейтинг: {initial_rating} (из BTR #{player.btr_player_id})")
            else:
                stats['default'] += 1
                if verbose:
                    print(f"📝 {player.last_name} {player.first_name} (BP #{player.id}) → "
                          f"BP рейтинг: {initial_rating} (дефолт)")
            
            # Сохраняем
            if not dry_run:
                player.current_rating = initial_rating
                player.save(update_fields=['current_rating'])
        
        except Exception as e:
            stats['errors'] += 1
            print(f"❗ ОШИБКА при обработке {player.last_name} {player.first_name}: {e}")
    
    # Итоговый отчёт
    print()
    print("=" * 80)
    print("📊 ИТОГОВАЯ СТАТИСТИКА")
    print("=" * 80)
    print(f"Всего игроков обработано:        {players.count()}")
    print(f"✅ Рейтинг из BTR:               {stats['from_btr']}")
    print(f"📝 Дефолтный рейтинг (1000):     {stats['default']}")
    print(f"⏭️  Пропущены (уже есть рейтинг): {stats['skipped']}")
    print(f"❗ Ошибки:                        {stats['errors']}")
    print()
    
    # Детальный отчёт по игрокам с BTR
    if from_btr_players:
        print("=" * 80)
        print("✅ ИГРОКИ С РЕЙТИНГОМ ИЗ BTR")
        print("=" * 80)
        
        # Группируем по диапазонам рейтинга
        rating_ranges = {
            '1000-1100': [],
            '1100-1200': [],
            '1200-1300': [],
            '1300-1400': [],
            '1400-1500': [],
            '1500-1600': [],
            '1600-1700': [],
            '1700-1800': [],
            '1800-1900': [],
            '1900-2000': [],
        }
        
        for item in from_btr_players:
            rating = item['new_rating']
            if rating < 1100:
                rating_ranges['1000-1100'].append(item)
            elif rating < 1200:
                rating_ranges['1100-1200'].append(item)
            elif rating < 1300:
                rating_ranges['1200-1300'].append(item)
            elif rating < 1400:
                rating_ranges['1300-1400'].append(item)
            elif rating < 1500:
                rating_ranges['1400-1500'].append(item)
            elif rating < 1600:
                rating_ranges['1500-1600'].append(item)
            elif rating < 1700:
                rating_ranges['1600-1700'].append(item)
            elif rating < 1800:
                rating_ranges['1700-1800'].append(item)
            elif rating < 1900:
                rating_ranges['1800-1900'].append(item)
            else:
                rating_ranges['1900-2000'].append(item)
        
        for range_name, items in rating_ranges.items():
            if items:
                print(f"\n{range_name}: {len(items)} игроков")
                for item in items:
                    print(f"  - {item['bp_name']} (BP #{item['bp_id']}, BTR #{item['btr_id']}): {item['new_rating']}")
        
        print()
    
    # Сохранение результатов в файл
    if not dry_run and from_btr_players:
        import json
        from datetime import datetime
        
        report_file = f"set_initial_bp_ratings_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        report_data = {
            'timestamp': datetime.now().isoformat(),
            'stats': stats,
            'from_btr_players': from_btr_players,
        }
        
        with open(report_file, 'w', encoding='utf-8') as f:
            json.dump(report_data, f, ensure_ascii=False, indent=2)
        
        print(f"📄 Детальный отчёт сохранён в: {report_file}")
        print()
    
    if dry_run:
        print("⚠️  Это был тестовый запуск. Изменения НЕ сохранены.")
        print("    Для применения изменений запустите без флага --dry-run")
    else:
        print("✅ Установка рейтингов завершена!")
    
    print("=" * 80)


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Установка стартового BP рейтинга игрокам на основе BTR'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Тестовый режим: показать результаты без сохранения изменений'
    )
    parser.add_argument(
        '--verbose', '-v',
        action='store_true',
        help='Подробный вывод (показывать все операции)'
    )
    parser.add_argument(
        '--force', '-f',
        action='store_true',
        help='Обновить рейтинг даже если он уже установлен'
    )
    
    args = parser.parse_args()
    
    try:
        set_initial_bp_ratings(dry_run=args.dry_run, verbose=args.verbose, force=args.force)
    except KeyboardInterrupt:
        print("\n\n⚠️  Прервано пользователем")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❗ КРИТИЧЕСКАЯ ОШИБКА: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

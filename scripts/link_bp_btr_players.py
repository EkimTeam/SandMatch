#!/usr/bin/env python
"""
Скрипт для автоматической связки игроков BP с игроками BTR.

Логика:
1. Ищет совпадения по комбинации Фамилия+Имя
2. Если для BP игрока найден ровно один BTR игрок - устанавливает связь через поле btr_player_id
3. Если найдено несколько BTR игроков - пропускает (требуется ручная проверка)
4. Если связь уже установлена - пропускает

Запуск:
    python scripts/link_bp_btr_players.py
    python scripts/link_bp_btr_players.py --dry-run  # Только показать, без изменений
    python scripts/link_bp_btr_players.py --verbose  # Подробный вывод
"""
import os
import sys
import django
from collections import defaultdict

# Настройка Django окружения
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'sandmatch.settings')
django.setup()

from apps.players.models import Player as BpPlayer
from apps.btr.models import BtrPlayer
from apps.players.services.initial_rating_service import get_initial_bp_rating


def normalize_name(first_name: str, last_name: str) -> str:
    """Нормализует имя и фамилию для сравнения."""
    return f"{last_name.strip().lower()}_{first_name.strip().lower()}"


def link_bp_btr_players(dry_run: bool = False, verbose: bool = False):
    """
    Связывает игроков BP с игроками BTR по совпадению Фамилия+Имя.
    Устанавливает связь через поле Player.btr_player_id.
    
    Args:
        dry_run: Если True, только показывает результаты без изменений
        verbose: Если True, выводит подробную информацию
    """
    print("=" * 80)
    print("Скрипт связывания игроков BP с BTR")
    print("=" * 80)
    
    if dry_run:
        print("⚠️  РЕЖИМ ТЕСТИРОВАНИЯ (изменения не будут сохранены)")
    
    print()
    
    # Получаем всех BP игроков
    bp_players = BpPlayer.objects.all()
    total_bp = bp_players.count()
    print(f"📊 Всего игроков BP: {total_bp}")
    
    # Получаем всех BTR игроков
    btr_players = BtrPlayer.objects.all()
    total_btr = btr_players.count()
    print(f"📊 Всего игроков BTR: {total_btr}")
    print()
    
    # Создаём индекс BTR игроков по нормализованному имени
    btr_index = defaultdict(list)
    for btr_player in btr_players:
        key = normalize_name(btr_player.first_name, btr_player.last_name)
        btr_index[key].append(btr_player)
    
    print(f"📋 Уникальных комбинаций Фамилия+Имя в BTR: {len(btr_index)}")
    print()
    
    # Статистика
    stats = {
        'already_linked': 0,      # Уже связаны (btr_player_id установлен)
        'linked': 0,              # Успешно связаны
        'multiple_matches': 0,    # Несколько совпадений
        'no_match': 0,            # Нет совпадений
        'errors': 0,              # Ошибки
    }
    
    # Списки для детального отчёта
    linked_players = []
    multiple_matches = []
    
    print("🔄 Начинаем обработку...")
    print("-" * 80)
    
    for bp_player in bp_players:
        # Пропускаем, если связь с BTR уже установлена
        if bp_player.btr_player_id:
            stats['already_linked'] += 1
            if verbose:
                print(f"⏭️  {bp_player.last_name} {bp_player.first_name} - уже связан с BTR игроком #{bp_player.btr_player_id}")
            continue
        
        # Ищем совпадения в BTR
        key = normalize_name(bp_player.first_name, bp_player.last_name)
        btr_matches = btr_index.get(key, [])
        
        if len(btr_matches) == 0:
            # Нет совпадений
            stats['no_match'] += 1
            if verbose:
                print(f"❌ {bp_player.last_name} {bp_player.first_name} - не найден в BTR")
        
        elif len(btr_matches) == 1:
            # Ровно одно совпадение - устанавливаем связь
            btr_player = btr_matches[0]
            
            try:
                if not dry_run:
                    bp_player.btr_player_id = btr_player.id
                    
                    # Если у игрока нет рейтинга, устанавливаем стартовый из BTR
                    if not bp_player.current_rating or bp_player.current_rating == 0:
                        initial_rating = get_initial_bp_rating(bp_player)
                        bp_player.current_rating = initial_rating
                        bp_player.save(update_fields=['btr_player_id', 'current_rating'])
                        rating_info = f", BP рейтинг: {initial_rating}"
                    else:
                        bp_player.save(update_fields=['btr_player_id'])
                        rating_info = ""
                else:
                    # В dry-run режиме тоже показываем какой был бы рейтинг
                    if not bp_player.current_rating or bp_player.current_rating == 0:
                        bp_player.btr_player_id = btr_player.id  # Временно для расчета
                        initial_rating = get_initial_bp_rating(bp_player)
                        bp_player.btr_player_id = None  # Откатываем
                        rating_info = f", BP рейтинг: {initial_rating}"
                    else:
                        rating_info = ""
                
                stats['linked'] += 1
                linked_players.append({
                    'bp_id': bp_player.id,
                    'bp_name': f"{bp_player.last_name} {bp_player.first_name}",
                    'btr_id': btr_player.id,
                    'btr_name': f"{btr_player.last_name} {btr_player.first_name}",
                    'rni': btr_player.rni,
                })
                
                print(f"✅ {bp_player.last_name} {bp_player.first_name} (BP #{bp_player.id}) → "
                      f"{btr_player.last_name} {btr_player.first_name} (BTR #{btr_player.id}, РНИ: {btr_player.rni}){rating_info}")
            
            except Exception as e:
                stats['errors'] += 1
                print(f"❗ ОШИБКА при связывании {bp_player.last_name} {bp_player.first_name}: {e}")
        
        else:
            # Несколько совпадений - пропускаем
            stats['multiple_matches'] += 1
            multiple_matches.append({
                'bp_id': bp_player.id,
                'bp_name': f"{bp_player.last_name} {bp_player.first_name}",
                'btr_matches': [
                    {
                        'id': btr.id,
                        'name': f"{btr.last_name} {btr.first_name}",
                        'rni': btr.rni,
                        'city': btr.city,
                        'birth_date': str(btr.birth_date) if btr.birth_date else None,
                    }
                    for btr in btr_matches
                ]
            })
            
            if verbose:
                print(f"⚠️  {bp_player.last_name} {bp_player.first_name} (BP #{bp_player.id}) - "
                      f"найдено {len(btr_matches)} совпадений в BTR:")
                for btr in btr_matches:
                    print(f"    - BTR #{btr.id}: {btr.last_name} {btr.first_name}, "
                          f"РНИ: {btr.rni}, Город: {btr.city or '—'}, "
                          f"Дата рождения: {btr.birth_date or '—'}")
    
    # Итоговый отчёт
    print()
    print("=" * 80)
    print("📊 ИТОГОВАЯ СТАТИСТИКА")
    print("=" * 80)
    print(f"Всего BP игроков обработано:     {total_bp}")
    print(f"Уже связаны (btr_player_id):     {stats['already_linked']}")
    print(f"✅ Успешно связаны:              {stats['linked']}")
    print(f"❌ Не найдены в BTR:             {stats['no_match']}")
    print(f"⚠️  Несколько совпадений:         {stats['multiple_matches']}")
    print(f"❗ Ошибки:                        {stats['errors']}")
    print()
    
    # Детальный отчёт по множественным совпадениям
    if multiple_matches:
        print("=" * 80)
        print("⚠️  ИГРОКИ С НЕСКОЛЬКИМИ СОВПАДЕНИЯМИ (требуется ручная проверка)")
        print("=" * 80)
        for item in multiple_matches:
            print(f"\n{item['bp_name']} (BP #{item['bp_id']}):")
            for match in item['btr_matches']:
                print(f"  - BTR #{match['id']}: {match['name']}, РНИ: {match['rni']}, "
                      f"Город: {match['city'] or '—'}, Дата рождения: {match['birth_date'] or '—'}")
        print()
    
    # Сохранение результатов в файл
    if not dry_run and (linked_players or multiple_matches):
        import json
        from datetime import datetime
        
        report_file = f"link_bp_btr_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        report_data = {
            'timestamp': datetime.now().isoformat(),
            'stats': stats,
            'linked_players': linked_players,
            'multiple_matches': multiple_matches,
        }
        
        with open(report_file, 'w', encoding='utf-8') as f:
            json.dump(report_data, f, ensure_ascii=False, indent=2)
        
        print(f"📄 Детальный отчёт сохранён в: {report_file}")
        print()
    
    if dry_run:
        print("⚠️  Это был тестовый запуск. Изменения НЕ сохранены.")
        print("    Для применения изменений запустите без флага --dry-run")
    else:
        print("✅ Связывание завершено!")
    
    print("=" * 80)


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Автоматическая связка игроков BP с BTR по совпадению Фамилия+Имя'
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
    
    args = parser.parse_args()
    
    try:
        link_bp_btr_players(dry_run=args.dry_run, verbose=args.verbose)
    except KeyboardInterrupt:
        print("\n\n⚠️  Прервано пользователем")
        sys.exit(1)
    except Exception as e:
        print(f"\n\n❗ КРИТИЧЕСКАЯ ОШИБКА: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

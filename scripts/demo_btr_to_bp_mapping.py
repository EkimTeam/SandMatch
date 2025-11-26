"""
Демонстрация маппинга BTR → BP рейтинга со скошенным распределением.
"""
import os
import sys
import django

# Настройка Django
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'sandmatch.settings.base')
django.setup()

from apps.players.services.btr_rating_mapper import calculate_bp_from_btr_value


def demo_mapping():
    """Демонстрирует маппинг BTR → BP на примерах."""
    
    print("=" * 80)
    print("МАППИНГ BTR → BP РЕЙТИНГА (ДВУХУРОВНЕВОЕ СКОШЕННОЕ РАСПРЕДЕЛЕНИЕ)")
    print("=" * 80)
    print()
    print("Формулы:")
    print("  • Профессионалы (80-1500): BP = 1000 + 600 * ((BTR - 80) / 1420) ^ 0.7")
    print("  • Элита (1500-4000):        BP = 1600 + 400 * ((BTR - 1500) / 2500) ^ 1.05")
    print()
    print("Правила:")
    print("  • BTR < 80 (любители) → BP = 1000")
    print("  • 80 ≤ BTR < 1500 (профессионалы) → быстрый рост в начале")
    print("  • BTR ≥ 1500 (элита) → штраф растет по мере удаления от 1500")
    print("  • BTR ≥ 4000 → BP = 2000 (максимум)")
    print()
    print("=" * 80)
    print()
    
    # Примеры для демонстрации
    examples = [
        (50, "Любитель"),
        (80, "Начало профессионального уровня"),
        (100, "Начинающий профессионал"),
        (150, "Развивающийся профессионал"),
        (200, "Уверенный профессионал"),
        (300, "Сильный профессионал"),
        (500, "Очень сильный профессионал"),
        (750, "Высокий уровень"),
        (1000, "Очень высокий уровень"),
        (1173, "Топ-10% (мужчины, 90-й процентиль)"),
        (1310, "Топ-10% (женщины, 90-й процентиль)"),
        (1500, "Элита (порог)"),
        (1750, "Элита (начальный уровень)"),
        (2000, "Элита (средний уровень)"),
        (2250, "Элита (высокий уровень)"),
        (2461, "Максимум мужчины (Бурмакин)"),
        (2750, "Элита (очень высокий уровень)"),
        (3000, "Абсолютная элита"),
        (3500, "Супер-элита"),
        (4000, "Максимум (потолок)"),
        (4246, "Максимум женщины (Семенова/Кудинова)"),
    ]
    
    print(f"{'BTR':>6} → {'BP':>6}  │  Описание")
    print("─" * 80)
    
    for btr, description in examples:
        bp = calculate_bp_from_btr_value(btr)
        print(f"{btr:>6} → {bp:>6}  │  {description}")
    
    print()
    print("=" * 80)
    print("АНАЛИЗ РАСПРЕДЕЛЕНИЯ")
    print("=" * 80)
    print()
    
    # Показываем распределение по диапазонам
    print("Распределение по диапазонам BTR:")
    print()
    
    ranges = [
        (0, 80, "< 80"),
        (80, 100, "80-100"),
        (100, 150, "100-150"),
        (150, 200, "150-200"),
        (200, 300, "200-300"),
        (300, 500, "300-500"),
        (500, 750, "500-750"),
        (750, 1000, "750-1000"),
        (1000, 1500, "1000-1500"),
        (1500, 2000, "1500-2000"),
        (2000, 2500, "2000-2500"),
        (2500, 3000, "2500-3000"),
        (3000, 4000, "3000-4000"),
        (4000, 5000, "≥ 4000"),
    ]
    
    print(f"{'BTR диапазон':>15} │ {'BP диапазон':>15} │ {'Разница BP':>12}")
    print("─" * 80)
    
    for min_btr, max_btr, label in ranges:
        bp_min = calculate_bp_from_btr_value(min_btr)
        bp_max = calculate_bp_from_btr_value(max_btr - 1)
        bp_diff = bp_max - bp_min
        
        if min_btr == 0:
            bp_range = f"{bp_min}"
        elif max_btr >= 5000:
            bp_range = f"{bp_max}"
        else:
            bp_range = f"{bp_min}-{bp_max}"
        
        print(f"{label:>15} │ {bp_range:>15} │ {bp_diff:>12}")
    
    print()
    print("=" * 80)
    print("КЛЮЧЕВЫЕ НАБЛЮДЕНИЯ")
    print("=" * 80)
    print()
    print("1. ПРОФЕССИОНАЛЫ (80-1500): Быстрый рост в начале")
    print(f"   BTR 80 → 100 (+20): BP +{calculate_bp_from_btr_value(100) - calculate_bp_from_btr_value(80)}")
    print(f"   BTR 100 → 150 (+50): BP +{calculate_bp_from_btr_value(150) - calculate_bp_from_btr_value(100)}")
    print(f"   BTR 500 → 750 (+250): BP +{calculate_bp_from_btr_value(750) - calculate_bp_from_btr_value(500)}")
    print(f"   BTR 1000 → 1250 (+250): BP +{calculate_bp_from_btr_value(1250) - calculate_bp_from_btr_value(1000)}")
    print()
    print("2. ЭЛИТА (1500-4000): Штраф растет по мере удаления от 1500")
    print(f"   BTR 1500 → 1750 (+250): BP +{calculate_bp_from_btr_value(1750) - calculate_bp_from_btr_value(1500)}")
    print(f"   BTR 1750 → 2000 (+250): BP +{calculate_bp_from_btr_value(2000) - calculate_bp_from_btr_value(1750)}")
    print(f"   BTR 2000 → 2250 (+250): BP +{calculate_bp_from_btr_value(2250) - calculate_bp_from_btr_value(2000)}")
    print(f"   BTR 2500 → 2750 (+250): BP +{calculate_bp_from_btr_value(2750) - calculate_bp_from_btr_value(2500)}")
    print(f"   BTR 3000 → 3250 (+250): BP +{calculate_bp_from_btr_value(3250) - calculate_bp_from_btr_value(3000)}")
    print(f"   BTR 3500 → 3750 (+250): BP +{calculate_bp_from_btr_value(3750) - calculate_bp_from_btr_value(3500)}")
    print()
    print("3. КЛЮЧЕВЫЕ ТОЧКИ:")
    print(f"   BTR 1500 → BP {calculate_bp_from_btr_value(1500)} (порог элиты)")
    print(f"   BTR 2750 → BP {calculate_bp_from_btr_value(2750)} (цель ~1900)")
    print(f"   BTR 4000 → BP {calculate_bp_from_btr_value(4000)} (цель ~2000, максимум)")
    print()
    print("4. Все BTR ≥ 4000 получают максимальный BP = 2000")
    print()
    print("=" * 80)


if __name__ == '__main__':
    demo_mapping()

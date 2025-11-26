"""
Скрипт для анализа распределения BTR рейтингов и определения порогов для стартового BP рейтинга.
"""
import os
import sys
import django

# Настройка Django
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'sandmatch.settings.base')
django.setup()

from django.db.models import Max, Min, Avg, Count, Q
from apps.btr.models import BtrRatingSnapshot, BtrPlayer


def analyze_btr_ratings():
    """Анализирует распределение BTR рейтингов для категорий M и W."""
    
    print("=" * 80)
    print("АНАЛИЗ BTR РЕЙТИНГОВ (категории M и W)")
    print("=" * 80)
    
    # Категории для анализа (только взрослые мужчины и женщины)
    categories = {
        'men_double': 'Мужчины, парный',
        'women_double': 'Женщины, парный',
    }
    
    for cat_code, cat_label in categories.items():
        print(f"\n{'=' * 80}")
        print(f"КАТЕГОРИЯ: {cat_label} ({cat_code})")
        print(f"{'=' * 80}")
        
        # Получаем последнюю дату рейтинга
        latest_date = BtrRatingSnapshot.objects.filter(
            category=cat_code
        ).aggregate(max_date=Max('rating_date'))['max_date']
        
        if not latest_date:
            print(f"Нет данных для категории {cat_code}")
            continue
        
        print(f"Последняя дата рейтинга: {latest_date}")
        
        # Получаем все снимки на последнюю дату
        snapshots = BtrRatingSnapshot.objects.filter(
            category=cat_code,
            rating_date=latest_date
        ).order_by('-rating_value')
        
        total_count = snapshots.count()
        print(f"Всего игроков: {total_count}")
        
        # Фильтруем только профессиональный уровень (>= 80)
        pro_snapshots = snapshots.filter(rating_value__gte=80)
        pro_count = pro_snapshots.count()
        print(f"Игроков с рейтингом >= 80: {pro_count}")
        
        # Статистика по всем игрокам
        stats = snapshots.aggregate(
            max_rating=Max('rating_value'),
            min_rating=Min('rating_value'),
            avg_rating=Avg('rating_value')
        )
        print(f"\nОбщая статистика:")
        print(f"  Максимум: {stats['max_rating']}")
        print(f"  Минимум: {stats['min_rating']}")
        print(f"  Среднее: {stats['avg_rating']:.2f}")
        
        # Статистика по профессионалам (>= 80)
        if pro_count > 0:
            pro_stats = pro_snapshots.aggregate(
                max_rating=Max('rating_value'),
                min_rating=Min('rating_value'),
                avg_rating=Avg('rating_value')
            )
            print(f"\nСтатистика профессионалов (>= 80):")
            print(f"  Максимум: {pro_stats['max_rating']}")
            print(f"  Минимум: 80")
            print(f"  Среднее: {pro_stats['avg_rating']:.2f}")
        
        # Процентили для профессионалов
        if pro_count > 0:
            print(f"\nПроцентили (только >= 80):")
            percentiles = [10, 25, 50, 75, 90, 95, 99]
            pro_ratings = list(pro_snapshots.values_list('rating_value', flat=True))
            pro_ratings.sort()
            
            for p in percentiles:
                idx = int(len(pro_ratings) * p / 100)
                if idx >= len(pro_ratings):
                    idx = len(pro_ratings) - 1
                print(f"  {p}%: {pro_ratings[idx]}")
        
        # Распределение по диапазонам
        print(f"\nРаспределение по диапазонам:")
        ranges = [
            (0, 80, "< 80 (любители)"),
            (80, 100, "80-100"),
            (100, 120, "100-120"),
            (120, 140, "120-140"),
            (140, 160, "140-160"),
            (160, 180, "160-180"),
            (180, 200, "180-200"),
            (200, 250, "200-250"),
            (250, 300, "250-300"),
            (300, 10000, "> 300"),
        ]
        
        for min_val, max_val, label in ranges:
            count = snapshots.filter(
                rating_value__gte=min_val,
                rating_value__lt=max_val
            ).count()
            percentage = (count / total_count * 100) if total_count > 0 else 0
            print(f"  {label:20s}: {count:4d} ({percentage:5.1f}%)")
        
        # Топ-10 игроков
        print(f"\nТоп-10 игроков:")
        top_10 = snapshots[:10]
        for idx, snapshot in enumerate(top_10, 1):
            player = snapshot.player
            print(f"  {idx:2d}. {player.last_name} {player.first_name:15s} - {snapshot.rating_value}")


def suggest_bp_rating_formula():
    """Предлагает формулу для расчета стартового BP рейтинга на основе BTR."""
    
    print("\n" + "=" * 80)
    print("ПРЕДЛАГАЕМАЯ ФОРМУЛА ДЛЯ СТАРТОВОГО BP РЕЙТИНГА")
    print("=" * 80)
    
    print("""
Анализ показывает, что BTR рейтинг >= 80 соответствует профессиональному уровню.
Предлагаемая формула для стартового BP рейтинга:

1. Если BTR < 80 (любители):
   BP = 1000 (стандартный стартовый рейтинг)

2. Если BTR >= 80 (профессионалы):
   BP = 1000 + (BTR - 80) * K
   
   где K - коэффициент масштабирования
   
Варианты коэффициента K:

a) Консервативный (K = 3.0):
   BTR 80  → BP 1000
   BTR 100 → BP 1060
   BTR 150 → BP 1210
   BTR 200 → BP 1360
   BTR 300 → BP 1660

b) Умеренный (K = 4.0):
   BTR 80  → BP 1000
   BTR 100 → BP 1080
   BTR 150 → BP 1280
   BTR 200 → BP 1480
   BTR 300 → BP 1880

c) Агрессивный (K = 5.0):
   BTR 80  → BP 1000
   BTR 100 → BP 1100
   BTR 150 → BP 1350
   BTR 200 → BP 1600
   BTR 300 → BP 2100

РЕКОМЕНДАЦИЯ: Использовать умеренный коэффициент K = 4.0

Формула: BP = max(1000, 1000 + (max(BTR_M, BTR_W) - 80) * 4.0)

где BTR_M и BTR_W - рейтинги в категориях men_double и women_double
""")


if __name__ == '__main__':
    analyze_btr_ratings()
    suggest_bp_rating_formula()

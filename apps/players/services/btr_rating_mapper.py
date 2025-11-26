"""
Сервис для расчета стартового BP рейтинга на основе BTR рейтинга.
"""
from typing import Optional
from apps.btr.models import BtrPlayer, BtrRatingSnapshot
from django.db.models import Max


def calculate_initial_bp_rating_from_btr(btr_player_id: int) -> int:
    """
    Рассчитывает стартовый BP рейтинг на основе BTR рейтинга игрока.
    
    Логика со скошенным распределением:
    1. Берем максимальный рейтинг из категорий men_double и women_double
    2. Если BTR < 80 (любители) → BP = 1000
    3. Если 80 <= BTR < 1500 (профессионалы) → скошенное распределение (быстрый рост)
    4. Если BTR >= 1500 (элита) → обратное скошенное распределение (штраф растет)
    
    Формула для диапазона 80-1500:
    BP = 1000 + 600 * ((BTR - 80) / 1420) ^ 0.7
    
    Формула для диапазона 1500-4000 (элита):
    BP = 1600 + 400 * ((BTR - 1500) / 2500) ^ 1.05
    
    Это дает:
    - BTR 80 → BP 1000
    - BTR 1500 → BP 1600
    - BTR 2750 → BP ~1900
    - BTR 4000 → BP ~2000
    
    Args:
        btr_player_id: ID игрока в системе BTR
    
    Returns:
        Стартовый BP рейтинг (целое число, от 1000 до 2000)
    """
    try:
        btr_player = BtrPlayer.objects.get(id=btr_player_id)
    except BtrPlayer.DoesNotExist:
        return 1000  # Дефолтный стартовый рейтинг
    
    # Получаем последние рейтинги в категориях men_double и women_double
    relevant_categories = ['men_double', 'women_double']
    
    max_btr_rating = 0
    
    for category in relevant_categories:
        # Получаем последний снимок в этой категории
        latest_snapshot = BtrRatingSnapshot.objects.filter(
            player_id=btr_player_id,
            category=category
        ).order_by('-rating_date').first()
        
        if latest_snapshot and latest_snapshot.rating_value > max_btr_rating:
            max_btr_rating = latest_snapshot.rating_value
    
    # Если нет рейтинга в BTR или он меньше 80 (любители)
    if max_btr_rating < 80:
        return 1000
    
    # Элита: обратное скошенное распределение (штраф растет)
    if max_btr_rating >= 1500:
        # Ограничиваем максимум на уровне BTR 4000
        capped_btr = min(max_btr_rating, 4000)
        normalized = (capped_btr - 1500) / 2500.0  # Нормализуем в диапазон [0, 1]
        skewed = normalized ** 1.05  # Применяем степень > 1 для обратного скоса
        bp_rating = 1600 + 400 * skewed
        return min(2000, max(1600, int(round(bp_rating))))
    
    # Профессиональный уровень: скошенное распределение
    # Используем степенную функцию для более быстрого роста в начале
    normalized = (max_btr_rating - 80) / 1420.0  # Нормализуем в диапазон [0, 1]
    skewed = normalized ** 0.7  # Применяем степень < 1 для скоса влево
    bp_rating = 1000 + 600 * skewed
    
    # Округляем до целого и ограничиваем диапазон
    return min(1600, max(1000, int(round(bp_rating))))


def get_btr_rating_info(btr_player_id: int) -> dict:
    """
    Получает информацию о BTR рейтингах игрока для отладки и логирования.
    
    Returns:
        Словарь с информацией о рейтингах в разных категориях
    """
    try:
        btr_player = BtrPlayer.objects.get(id=btr_player_id)
    except BtrPlayer.DoesNotExist:
        return {}
    
    info = {
        'btr_player_id': btr_player_id,
        'full_name': f"{btr_player.last_name} {btr_player.first_name}".strip(),
        'ratings': {}
    }
    
    # Получаем рейтинги по всем категориям
    for cat_choice in BtrRatingSnapshot.Category.choices:
        cat_code = cat_choice[0]
        latest_snapshot = BtrRatingSnapshot.objects.filter(
            player_id=btr_player_id,
            category=cat_code
        ).order_by('-rating_date').first()
        
        if latest_snapshot:
            info['ratings'][cat_code] = {
                'rating': latest_snapshot.rating_value,
                'date': str(latest_snapshot.rating_date),
                'rank': latest_snapshot.rank,
            }
    
    return info


def suggest_initial_bp_rating(btr_player_id: int) -> dict:
    """
    Предлагает стартовый BP рейтинг на основе BTR.
    
    Returns:
        Словарь с информацией о BTR рейтингах и рассчитанным BP рейтингом
    """
    btr_info = get_btr_rating_info(btr_player_id)
    
    if not btr_info:
        return {
            'btr_found': False,
            'suggested_rating': 1000,
        }
    
    # Получаем максимальный рейтинг из men_double и women_double
    max_btr = 0
    max_category = None
    
    for cat_code in ['men_double', 'women_double']:
        if cat_code in btr_info['ratings']:
            rating = btr_info['ratings'][cat_code]['rating']
            if rating > max_btr:
                max_btr = rating
                max_category = cat_code
    
    # Рассчитываем BP рейтинг
    bp_rating = calculate_initial_bp_rating_from_btr(btr_player_id)
    
    return {
        'btr_found': True,
        'btr_info': btr_info,
        'max_btr_rating': max_btr,
        'max_category': max_category,
        'is_professional': max_btr >= 80,
        'is_top_level': max_btr >= 1500,
        'suggested_rating': bp_rating,
    }


def calculate_bp_from_btr_value(btr_value: int) -> int:
    """
    Рассчитывает BP рейтинг напрямую из значения BTR (без обращения к БД).
    Полезно для тестирования и демонстрации формулы.
    
    Args:
        btr_value: Значение BTR рейтинга
    
    Returns:
        BP рейтинг (от 1000 до 2000)
    """
    if btr_value < 80:
        return 1000
    
    # Элита: обратное скошенное распределение (штраф растет)
    if btr_value >= 1500:
        capped_btr = min(btr_value, 4000)
        normalized = (capped_btr - 1500) / 2500.0
        skewed = normalized ** 1.05
        bp_rating = 1600 + 400 * skewed
        return min(2000, max(1600, int(round(bp_rating))))
    
    # Профессионалы: скошенное распределение (быстрый рост)
    normalized = (btr_value - 80) / 1420.0
    skewed = normalized ** 0.7
    bp_rating = 1000 + 600 * skewed
    
    return min(1600, max(1000, int(round(bp_rating))))


# Примеры использования
if __name__ == '__main__':
    """
    Примеры расчета стартового BP рейтинга:
    
    1. Любитель (BTR < 80):
       BTR 50 → BP 1000
    
    2. Начинающий профессионал (BTR 80-150):
       BTR 80  → BP 1000
       BTR 100 → BP 1080
       BTR 150 → BP 1280
    
    3. Средний профессионал (BTR 150-300):
       BTR 200 → BP 1480
       BTR 250 → BP 1680
       BTR 300 → BP 1880
    
    4. Сильный профессионал (BTR 300-1000):
       BTR 500  → BP 2680
       BTR 1000 → BP 4680
    
    5. Топ-уровень (BTR > 1000):
       BTR 1500 → BP 6680
       BTR 2000 → BP 8680
       BTR 2461 → BP 10524 (максимум в мужчинах)
       BTR 4246 → BP 17664 (максимум в женщинах)
    """
    pass

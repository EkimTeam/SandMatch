"""
Сервис для определения стартового BP рейтинга игрока.
"""
from typing import Optional
from apps.players.services.btr_rating_mapper import calculate_initial_bp_rating_from_btr


def get_initial_bp_rating(player, tournament=None) -> int:
    """
    Определяет стартовый BP рейтинг для игрока.
    
    Логика:
    1. Если у игрока есть связь с BTR → рассчитываем по формуле BTR → BP
    2. Если связи нет и передан турнир → определяем по названию турнира:
       - "hard" или "ПроАм" → 1050
       - "medium" → 950
       - остальные → 1000
    3. Если связи нет и турнир не передан → 1000 (дефолт)
    
    Args:
        player: Объект Player
        tournament: Объект Tournament (опционально)
    
    Returns:
        Стартовый BP рейтинг (целое число)
    """
    # 1. Проверяем связь с BTR
    if player.btr_player_id:
        try:
            bp_rating = calculate_initial_bp_rating_from_btr(player.btr_player_id)
            return bp_rating
        except Exception:
            # Если что-то пошло не так с BTR, продолжаем дальше
            pass
    
    # 2. Если есть турнир, определяем по названию
    if tournament and tournament.name:
        tournament_name_lower = tournament.name.lower()
        
        # Проверяем на "hard" или "ПроАм"
        if "hard" in tournament_name_lower or "проам" in tournament_name_lower:
            return 1050
        
        # Проверяем на "medium"
        if "medium" in tournament_name_lower:
            return 950
    
    # 3. Дефолтный рейтинг
    return 1000


def get_initial_rating_for_player_without_btr(tournament_name: Optional[str] = None) -> int:
    """
    Определяет стартовый BP рейтинг для игрока без связи с BTR.
    
    Args:
        tournament_name: Название турнира (опционально)
    
    Returns:
        Стартовый BP рейтинг (целое число)
    """
    if tournament_name:
        tournament_name_lower = tournament_name.lower()
        
        # Проверяем на "hard" или "ПроАм"
        if "hard" in tournament_name_lower or "проам" in tournament_name_lower:
            return 1050
        
        # Проверяем на "medium"
        if "medium" in tournament_name_lower:
            return 950
    
    return 1000

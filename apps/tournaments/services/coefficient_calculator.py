"""
Сервис для расчета коэффициента турнира на основе среднего рейтинга участников и их количества.
"""
from typing import Optional


def calculate_tournament_coefficient(
    avg_rating: float,
    participants_count: int,
    has_prize_fund: bool = False
) -> float:
    """
    Рассчитывает коэффициент турнира на основе среднего рейтинга и количества участников.
    
    Таблица коэффициентов:
    
    Средний рейтинг | <=8  | 9-12 | 12-16 | 17-24 | >24
    ----------------|------|------|-------|-------|-----
    <=800           | 0.6  | 0.7  | 0.8   | 0.9   | 1.0
    801-950         | 0.7  | 0.8  | 0.9   | 1.0   | 1.1
    951-1050        | 0.8  | 0.9  | 1.0   | 1.1   | 1.2
    1051-1200       | 0.9  | 1.0  | 1.1   | 1.2   | 1.3
    >1200           | 1.0  | 1.1  | 1.2   | 1.3   | 1.4
    
    Дополнительно:
    - Если турнир с призовым фондом: +0.2 к коэффициенту
    
    Args:
        avg_rating: Средний рейтинг участников турнира
        participants_count: Количество участников
        has_prize_fund: Наличие призового фонда
        
    Returns:
        Коэффициент турнира (float)
    """
    # Определяем строку таблицы (по среднему рейтингу)
    if avg_rating <= 800:
        rating_row = [0.6, 0.7, 0.8, 0.9, 1.0]
    elif avg_rating <= 950:
        rating_row = [0.7, 0.8, 0.9, 1.0, 1.1]
    elif avg_rating <= 1050:
        rating_row = [0.8, 0.9, 1.0, 1.1, 1.2]
    elif avg_rating <= 1200:
        rating_row = [0.9, 1.0, 1.1, 1.2, 1.3]
    else:  # >1200
        rating_row = [1.0, 1.1, 1.2, 1.3, 1.4]
    
    # Определяем столбец таблицы (по количеству участников)
    if participants_count <= 8:
        col_index = 0
    elif participants_count <= 12:
        col_index = 1
    elif participants_count <= 16:
        col_index = 2
    elif participants_count <= 24:
        col_index = 3
    else:  # >24
        col_index = 4
    
    # Базовый коэффициент из таблицы
    base_coefficient = rating_row[col_index]
    
    # Добавляем бонус за призовой фонд
    if has_prize_fund:
        base_coefficient += 0.2
    
    return base_coefficient


def get_tournament_avg_rating(tournament_id: int) -> Optional[float]:
    """
    Рассчитывает средний рейтинг участников турнира.
    
    Args:
        tournament_id: ID турнира
        
    Returns:
        Средний рейтинг участников или None, если нет участников
    """
    from apps.tournaments.models import Tournament, TournamentEntry
    from apps.players.models import Player
    from django.db.models import Avg, Q
    
    tournament = Tournament.objects.get(id=tournament_id)
    
    # Получаем всех игроков, участвующих в турнире
    entries = TournamentEntry.objects.filter(tournament=tournament).select_related('team')
    
    player_ids = set()
    for entry in entries:
        team = entry.team
        if team.player_1_id:
            player_ids.add(team.player_1_id)
        if team.player_2_id:
            player_ids.add(team.player_2_id)
    
    if not player_ids:
        return None
    
    # Рассчитываем средний рейтинг
    avg_data = Player.objects.filter(id__in=player_ids).aggregate(
        avg_rating=Avg('current_rating')
    )
    
    return avg_data.get('avg_rating')


def auto_calculate_tournament_coefficient(tournament_id: int) -> float:
    """
    Автоматически рассчитывает и устанавливает коэффициент турнира.
    
    Args:
        tournament_id: ID турнира
        
    Returns:
        Рассчитанный коэффициент
    """
    from apps.tournaments.models import Tournament, TournamentEntry
    
    tournament = Tournament.objects.get(id=tournament_id)
    
    # Получаем средний рейтинг участников
    avg_rating = get_tournament_avg_rating(tournament_id)
    
    # Если нет участников или рейтингов, используем дефолтный коэффициент
    if avg_rating is None or avg_rating == 0:
        avg_rating = 1000.0  # Дефолтный средний рейтинг
    
    # Получаем количество участников (команд/пар)
    participants_count = TournamentEntry.objects.filter(tournament=tournament).count()
    
    # Проверяем наличие призового фонда
    has_prize_fund = bool(tournament.prize_fund and tournament.prize_fund.strip())
    
    # Рассчитываем коэффициент
    coefficient = calculate_tournament_coefficient(
        avg_rating=avg_rating,
        participants_count=participants_count,
        has_prize_fund=has_prize_fund
    )
    
    # Сохраняем коэффициент в турнир
    tournament.rating_coefficient = coefficient
    tournament.save(update_fields=['rating_coefficient'])
    
    return coefficient

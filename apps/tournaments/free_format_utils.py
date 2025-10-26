"""
Вспомогательные функции для работы с форматом турнира "Свободный формат"
"""
from typing import Dict, List, Tuple, Optional
from apps.matches.models import Match, MatchSet
from apps.tournaments.models import TournamentEntry


def is_free_format(set_format) -> bool:
    """Проверить, является ли формат свободным"""
    return set_format.games_to == 0 and set_format.max_sets == 0


def calculate_tb_winner_points(loser_points: int, tiebreak_points: int = 7, is_champion_tb: bool = False) -> int:
    """
    Рассчитать очки победителя в тайбрейке.
    
    Args:
        loser_points: Очки проигравшего
        tiebreak_points: Стандартное количество очков в TB (из SetFormat)
        is_champion_tb: Является ли это чемпионским тайбрейком
    
    Returns:
        Очки победителя
    """
    # Для чемпионского TB минимум 10 очков
    if is_champion_tb:
        if loser_points < 8:
            return 10
        else:
            return loser_points + 2
    
    # Для обычного TB минимум 7 очков (или значение из SetFormat)
    if loser_points < (tiebreak_points - 2):
        return tiebreak_points
    else:
        return loser_points + 2


def process_free_format_set(set_data: Dict, tiebreak_points: int = 7, decider_tiebreak_points: int = 10) -> Dict:
    """
    Обработать данные сета свободного формата.
    Автоматически рассчитывает очки победителя в TB.
    
    Args:
        set_data: Данные сета от фронтенда
        tiebreak_points: Стандартное количество очков в TB
        decider_tiebreak_points: Количество очков в чемпионском TB
    
    Returns:
        Обработанные данные сета с полными данными TB
    """
    games_1 = set_data.get('games_1', 0)
    games_2 = set_data.get('games_2', 0)
    tb_loser_points = set_data.get('tb_loser_points')
    is_tiebreak_only = set_data.get('is_tiebreak_only', False)
    
    result = {
        'index': set_data.get('index', 1),
        'games_1': games_1,
        'games_2': games_2,
        'is_tiebreak_only': is_tiebreak_only
    }
    
    if is_tiebreak_only:
        # Чемпионский тайбрейк - используем games_1 и games_2 как очки TB
        result['tb_1'] = games_1
        result['tb_2'] = games_2
        result['games_1'] = 0
        result['games_2'] = 0
    elif tb_loser_points is not None:
        # Обычный тайбрейк - нужно рассчитать очки победителя
        winner_points = calculate_tb_winner_points(tb_loser_points, tiebreak_points, is_champion_tb=False)
        
        # Определить победителя по геймам
        if games_1 > games_2:
            result['tb_1'] = winner_points
            result['tb_2'] = tb_loser_points
        elif games_2 > games_1:
            result['tb_1'] = tb_loser_points
            result['tb_2'] = winner_points
        else:
            # Ничья по геймам - невозможно определить победителя TB
            raise ValueError(f"Невозможно определить победителя тайбрейка при счете {games_1}:{games_2}")
    else:
        result['tb_1'] = None
        result['tb_2'] = None
    
    return result


def validate_knockout_winner(sets_data: List[Dict]) -> Tuple[bool, Optional[str], Optional[int]]:
    """
    Валидация победителя для олимпийской системы.
    Победитель определяется по разнице геймов.
    
    Args:
        sets_data: Список обработанных сетов
    
    Returns:
        (valid, error_message, winner_index)
        - valid: True если можно определить победителя
        - error_message: Сообщение об ошибке (если valid=False)
        - winner_index: 1 или 2 (если valid=True)
    """
    total_games_1 = 0
    total_games_2 = 0
    
    for set_data in sets_data:
        if set_data.get('is_tiebreak_only'):
            # Чемпионский TB считается как 1:0 или 0:1
            tb_1 = set_data.get('tb_1', 0)
            tb_2 = set_data.get('tb_2', 0)
            if tb_1 > tb_2:
                total_games_1 += 1
            else:
                total_games_2 += 1
        else:
            # Обычный сет - считаем геймы
            total_games_1 += set_data.get('games_1', 0)
            total_games_2 += set_data.get('games_2', 0)
    
    if total_games_1 == total_games_2:
        return False, "Нельзя однозначно определить победителя, измените счет", None
    
    winner = 1 if total_games_1 > total_games_2 else 2
    return True, None, winner


def calculate_free_format_stats(entry: TournamentEntry, matches: List[Match]) -> Dict:
    """
    Подсчет статистики для участника в круговой системе со свободным форматом.
    
    Args:
        entry: Участник турнира
        matches: Список матчей участника
    
    Returns:
        Словарь со статистикой
    """
    sets_won = 0
    sets_lost = 0
    sets_total = 0
    games_won = 0
    games_lost = 0
    
    for match in matches:
        # Пропускаем незавершенные матчи
        if match.status != Match.Status.COMPLETED:
            continue
        
        # Определяем, какая команда - наша
        is_team_1 = (match.team_1_id == entry.team_id)
        
        for match_set in match.sets.all():
            sets_total += 1
            
            if match_set.is_tiebreak_only:
                # Чемпионский TB считается как 1:0 или 0:1
                if match_set.tb_1 > match_set.tb_2:
                    if is_team_1:
                        games_won += 1
                        sets_won += 1
                    else:
                        games_lost += 1
                        sets_lost += 1
                else:
                    if is_team_1:
                        games_lost += 1
                        sets_lost += 1
                    else:
                        games_won += 1
                        sets_won += 1
            else:
                # Обычный сет
                g1 = match_set.games_1
                g2 = match_set.games_2
                
                if is_team_1:
                    games_won += g1
                    games_lost += g2
                    if g1 > g2:
                        sets_won += 1
                    elif g1 < g2:
                        sets_lost += 1
                    # Если g1 == g2 - ничья, не учитывается в выигранных/проигранных
                else:
                    games_won += g2
                    games_lost += g1
                    if g2 > g1:
                        sets_won += 1
                    elif g2 < g1:
                        sets_lost += 1
    
    games_total = games_won + games_lost
    
    return {
        'wins': 0,  # Всегда 0 для свободного формата
        'sets_won': sets_won,
        'sets_lost': sets_lost,
        'sets_ratio': sets_won / sets_total if sets_total > 0 else 0,
        'games_won': games_won,
        'games_lost': games_lost,
        'games_ratio': games_won / games_total if games_total > 0 else 0
    }

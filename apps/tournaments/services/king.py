"""
Сервис для генерации и управления матчами турниров Кинг (Americano).
"""
from typing import List, Dict, Any, Tuple
from django.db import transaction
from apps.tournaments.models import Tournament, SchedulePattern, TournamentEntry
from apps.teams.models import Team
from apps.matches.models import Match, MatchSet


class KingMatchGenerator:
    """Генератор матчей для турнира Кинг"""
    
    def __init__(self, participants_count: int):
        self.participants_count = participants_count
        self.validate_participant_count()
    
    def validate_participant_count(self):
        """Валидация количества участников"""
        if not (4 <= self.participants_count <= 16):
            raise ValueError("Количество участников должно быть от 4 до 16")
    
    def generate_balanced_americano(self) -> List[Dict[str, Any]]:
        """
        Генерация сбалансированного расписания Американо.
        Основано на алгоритме из KingTournament.py
        
        Returns:
            List[Dict]: Список туров с матчами и отдыхающими
            [
                {
                    'round': 1,
                    'matches': [
                        {'team1': [0, 1], 'team2': [2, 3]}  # 0-based индексы
                    ],
                    'resting': []
                }
            ]
        """
        n = self.participants_count
        
        # Специальные случаи для малого количества участников
        if n == 4:
            return self._generate_for_4()
        elif n == 5:
            return self._generate_for_5()
        elif n == 6:
            return self._generate_for_6()
        else:
            # Для 7+ используем комбинаторный подход
            return self._generate_round_robin_based(n)
    
    def _generate_for_4(self) -> List[Dict[str, Any]]:
        """4 игрока - 3 раунда"""
        return [
            {
                'round': 1,
                'matches': [{'team1': [0, 1], 'team2': [2, 3]}],
                'resting': []
            },
            {
                'round': 2,
                'matches': [{'team1': [0, 2], 'team2': [1, 3]}],
                'resting': []
            },
            {
                'round': 3,
                'matches': [{'team1': [0, 3], 'team2': [1, 2]}],
                'resting': []
            },
        ]
    
    def _generate_for_5(self) -> List[Dict[str, Any]]:
        """5 игроков - 5 раундов"""
        return [
            {
                'round': 1,
                'matches': [{'team1': [0, 1], 'team2': [2, 3]}],
                'resting': [4]
            },
            {
                'round': 2,
                'matches': [{'team1': [0, 2], 'team2': [3, 4]}],
                'resting': [1]
            },
            {
                'round': 3,
                'matches': [{'team1': [0, 3], 'team2': [1, 4]}],
                'resting': [2]
            },
            {
                'round': 4,
                'matches': [{'team1': [0, 4], 'team2': [1, 2]}],
                'resting': [3]
            },
            {
                'round': 5,
                'matches': [{'team1': [1, 3], 'team2': [2, 4]}],
                'resting': [0]
            },
        ]
    
    def _generate_for_6(self) -> List[Dict[str, Any]]:
        """6 игроков - 8 раундов, сбалансированно"""
        return [
            {'round': 1, 'matches': [{'team1': [0, 1], 'team2': [2, 3]}], 'resting': [4, 5]},
            {'round': 2, 'matches': [{'team1': [1, 5], 'team2': [3, 4]}], 'resting': [0, 2]},
            {'round': 3, 'matches': [{'team1': [0, 2], 'team2': [4, 5]}], 'resting': [1, 3]},
            {'round': 4, 'matches': [{'team1': [2, 4], 'team2': [1, 3]}], 'resting': [0, 5]},
            {'round': 5, 'matches': [{'team1': [0, 4], 'team2': [2, 5]}], 'resting': [1, 3]},
            {'round': 6, 'matches': [{'team1': [0, 3], 'team2': [1, 4]}], 'resting': [2, 5]},
            {'round': 7, 'matches': [{'team1': [3, 5], 'team2': [2, 4]}], 'resting': [0, 1]},
            {'round': 8, 'matches': [{'team1': [0, 5], 'team2': [1, 2]}], 'resting': [3, 4]},
        ]
    
    def _generate_round_robin_based(self, n: int) -> List[Dict[str, Any]]:
        """
        Генерация для 7+ игроков на основе кругового алгоритма.
        Пары из round-robin объединяются в матчи 2x2.
        """
        # Генерируем пары round-robin
        if n % 2 == 0:
            rr_pairs = self._generate_even_round_robin(n)
        else:
            rr_pairs = self._generate_odd_round_robin(n)
        
        rounds_data = []
        for round_num, pairs in enumerate(rr_pairs, start=1):
            matches = []
            resting = []
            used_players = set()
            
            # Формируем матчи из пар (каждые 2 пары = 1 матч)
            i = 0
            while i < len(pairs) - 1:
                team1 = list(pairs[i])
                team2 = list(pairs[i + 1])
                matches.append({'team1': team1, 'team2': team2})
                used_players.update(team1 + team2)
                i += 2
            
            # Определяем отдыхающих
            all_players = set(range(n))
            resting = list(all_players - used_players)
            
            rounds_data.append({
                'round': round_num,
                'matches': matches,
                'resting': resting
            })
        
        return rounds_data
    
    def _generate_even_round_robin(self, n: int) -> List[List[Tuple[int, int]]]:
        """Генерация round-robin для четного количества игроков"""
        rounds = []
        players = list(range(n))
        
        for _ in range(n - 1):
            round_pairs = []
            for i in range(n // 2):
                round_pairs.append((players[i], players[n - 1 - i]))
            rounds.append(round_pairs)
            # Вращаем список игроков (первый фиксирован)
            players = [players[0]] + [players[-1]] + players[1:-1]
        
        return rounds
    
    def _generate_odd_round_robin(self, n: int) -> List[List[Tuple[int, int]]]:
        """Генерация round-robin для нечетного количества игроков"""
        rounds = []
        players = list(range(n))
        
        for _ in range(n):
            round_pairs = []
            # Добавляем виртуального игрока для создания пар
            extended_players = players + [None]
            
            for i in range(len(extended_players) // 2):
                pair = (extended_players[i], extended_players[-(i + 1)])
                if None not in pair:  # Исключаем пары с виртуальным игроком
                    round_pairs.append(pair)
            
            rounds.append(round_pairs)
            # Вращаем список игроков
            players = [players[-1]] + players[:-1]
        
        return rounds


def generate_king_matches(tournament: Tournament) -> List[Dict[str, Any]]:
    """
    Генерация матчей для турнира Кинг.
    
    Args:
        tournament: Турнир Кинг
    
    Returns:
        List[Dict]: Список матчей с информацией о парах и отдыхающих
        [
            {
                'round': 1,
                'group_index': 1,
                'team1_indices': [0, 3],  # 0-based индексы участников в группе
                'team2_indices': [1, 2],
                'resting_indices': [4],
                'team1_entry_ids': [1, 4],  # ID из TournamentEntry
                'team2_entry_ids': [2, 3]
            }
        ]
    """
    if tournament.system != Tournament.System.KING:
        raise ValueError("Турнир должен быть системы Кинг")
    
    groups_count = max(1, tournament.groups_count or 1)
    all_matches = []
    
    for group_idx in range(1, groups_count + 1):
        # Получаем участников группы, отсортированных по row_index
        entries = list(
            tournament.entries.filter(group_index=group_idx)
            .select_related('team', 'team__player_1', 'team__player_2')
            .order_by('row_index')
        )
        
        if not entries:
            continue
        
        participants_count = len(entries)
        
        # Валидация: 4-16 участников
        if not (4 <= participants_count <= 16):
            raise ValueError(f"Группа {group_idx}: должно быть от 4 до 16 участников, найдено {participants_count}")
        
        # Получаем шаблон расписания для группы
        group_name = f"Группа {group_idx}"
        patterns = tournament.group_schedule_patterns or {}
        pattern_id = patterns.get(group_name)
        
        if pattern_id:
            # Используем выбранный шаблон
            try:
                pattern = SchedulePattern.objects.get(pk=pattern_id, tournament_system=SchedulePattern.TournamentSystem.KING)
                rounds_data = _generate_from_pattern(pattern, participants_count)
            except SchedulePattern.DoesNotExist:
                # Fallback на Балансированный Американо
                generator = KingMatchGenerator(participants_count)
                rounds_data = generator.generate_balanced_americano()
        else:
            # По умолчанию используем Балансированный Американо
            generator = KingMatchGenerator(participants_count)
            rounds_data = generator.generate_balanced_americano()
        
        # Преобразуем в формат с entry_ids
        for round_data in rounds_data:
            for match_data in round_data['matches']:
                team1_indices = match_data['team1']
                team2_indices = match_data['team2']
                
                all_matches.append({
                    'round': round_data['round'],
                    'group_index': group_idx,
                    'team1_indices': team1_indices,
                    'team2_indices': team2_indices,
                    'resting_indices': round_data.get('resting', []),
                    'team1_entry_ids': [entries[i].id for i in team1_indices],
                    'team2_entry_ids': [entries[i].id for i in team2_indices],
                })
    
    return all_matches


def _generate_from_pattern(pattern: SchedulePattern, participants_count: int) -> List[Dict[str, Any]]:
    """Генерация расписания из кастомного шаблона"""
    if pattern.pattern_type == SchedulePattern.PatternType.BERGER:
        # Системный алгоритм
        generator = KingMatchGenerator(participants_count)
        return generator.generate_balanced_americano()
    
    elif pattern.pattern_type == SchedulePattern.PatternType.CUSTOM:
        # Кастомный шаблон
        custom_schedule = pattern.custom_schedule or {}
        custom_rounds = custom_schedule.get('rounds', [])
        
        rounds_data = []
        for round_data in custom_rounds:
            matches = []
            for match in round_data.get('matches', []):
                # Конвертируем 1-based в 0-based индексы
                team1 = [idx - 1 for idx in match['team1']]
                team2 = [idx - 1 for idx in match['team2']]
                matches.append({'team1': team1, 'team2': team2})
            
            # Конвертируем resting в 0-based
            resting = [idx - 1 for idx in round_data.get('resting', [])]
            
            rounds_data.append({
                'round': round_data['round'],
                'matches': matches,
                'resting': resting
            })
        
        return rounds_data
    
    else:
        # Fallback
        generator = KingMatchGenerator(participants_count)
        return generator.generate_balanced_americano()


@transaction.atomic
def persist_king_matches(tournament: Tournament, generated: List[Dict[str, Any]]) -> int:
    """
    Сохранение матчей Кинг в БД.
    Создает виртуальные Team для каждой пары игроков.
    
    Args:
        tournament: Турнир
        generated: Список сгенерированных матчей
    
    Returns:
        int: Количество созданных матчей
    """
    created = 0

    # Загружаем все существующие групповые матчи этого турнира (для King)
    existing_qs = Match.objects.filter(
        tournament=tournament,
        stage=Match.Stage.GROUP,
    )

    # Индекс по паре команд (team_low_id, team_high_id)
    existing_by_pair: Dict[tuple[int, int], Match] = {}
    for m in existing_qs.select_related("team_1", "team_2"):
        if m.team_low_id and m.team_high_id:
            key = (int(m.team_low_id), int(m.team_high_id))
            # Если по какой-то причине несколько матчей с одинаковой парой,
            # оставляем первый, остальные будут удалены как "лишние" ниже.
            if key not in existing_by_pair:
                existing_by_pair[key] = m

    used_match_ids: set[int] = set()

    for match_data in generated:
        round_num = match_data['round']
        group_idx = match_data['group_index']
        team1_entry_ids = match_data['team1_entry_ids']
        team2_entry_ids = match_data['team2_entry_ids']

        # Получаем TournamentEntry для каждого игрока
        team1_entries = TournamentEntry.objects.filter(id__in=team1_entry_ids).select_related('team__player_1')
        team2_entries = TournamentEntry.objects.filter(id__in=team2_entry_ids).select_related('team__player_1')

        # Извлекаем player_1_id (для турниров Кинг всегда singles)
        team1_player_ids = sorted([e.team.player_1_id for e in team1_entries])
        team2_player_ids = sorted([e.team.player_1_id for e in team2_entries])

        # Создаем или получаем виртуальные Team для пар
        team1, _ = Team.objects.get_or_create(
            player_1_id=team1_player_ids[0],
            player_2_id=team1_player_ids[1]
        )
        team2, _ = Team.objects.get_or_create(
            player_1_id=team2_player_ids[0],
            player_2_id=team2_player_ids[1]
        )

        # Нормализация для пары команд
        team_low_id = min(team1.id, team2.id)
        team_high_id = max(team1.id, team2.id)
        key = (int(team_low_id), int(team_high_id))

        # Нумерация: 1, 101, 201, ... (как и раньше)
        order_in_round = (round_num - 1) * 100 + 1

        existing_match = existing_by_pair.get(key)
        if existing_match:
            # Пара уже существует в БД — сохраняем матч, только обновляем метаданные тура/группы.
            changed = False
            if existing_match.group_index != group_idx:
                existing_match.group_index = group_idx
                changed = True
            if existing_match.round_index != round_num:
                existing_match.round_index = round_num
                changed = True
            # Для King round_name всегда "Группа X"
            new_round_name = f'Группа {group_idx}'
            if existing_match.round_name != new_round_name:
                existing_match.round_name = new_round_name
                changed = True
            if existing_match.order_in_round != order_in_round:
                existing_match.order_in_round = order_in_round
                changed = True

            if changed:
                existing_match.save(update_fields=[
                    'group_index', 'round_index', 'round_name', 'order_in_round'
                ])

            used_match_ids.add(existing_match.id)
        else:
            # Новая пара команд — создаем матч с нуля
            match = Match.objects.create(
                tournament=tournament,
                stage=Match.Stage.GROUP,
                group_index=group_idx,
                team_low_id=team_low_id,
                team_high_id=team_high_id,
                team_1=team1,
                team_2=team2,
                round_index=round_num,
                round_name=f'Группа {group_idx}',
                order_in_round=order_in_round,
                status=Match.Status.SCHEDULED,
            )
            created += 1
            used_match_ids.add(match.id)

    # Все матчи, для которых больше нет соответствующей пары team_low/team_high в новом расписании,
    # удаляем вместе с сетами.
    if used_match_ids:
        to_delete_qs = existing_qs.exclude(id__in=used_match_ids)
    else:
        to_delete_qs = existing_qs

    if to_delete_qs.exists():
        MatchSet.objects.filter(match__in=to_delete_qs).delete()
        to_delete_qs.delete()

    return created

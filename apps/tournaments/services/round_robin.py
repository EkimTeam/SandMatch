from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Optional, Sequence, Tuple
import json

from django.db import transaction

from apps.matches.models import Match
from apps.tournaments.models import SchedulePattern, Tournament, TournamentEntry


@dataclass
class GeneratedMatch:
    team1_id: int
    team2_id: int
    round_name: str
    order_in_round: int


def _get_groups_by_rows(tournament: Tournament) -> List[List[int]]:
    """Возвращает команды, распределённые по группам в порядке строк (row_index).

    Используем именно row_index и group_index, чтобы расписание (индексы 1..N)
    совпадало с расположением участников в таблице UI.
    """
    groups_count = max(1, tournament.groups_count or 1)
    groups: List[List[int]] = [[] for _ in range(groups_count)]
    entries = (
        TournamentEntry.objects
        .filter(tournament=tournament, group_index__isnull=False, row_index__isnull=False)
        .values("team_id", "group_index", "row_index")
        .order_by("group_index", "row_index", "team_id")
    )
    for e in entries:
        gi = max(1, int(e.get("group_index") or 1)) - 1
        gi = min(gi, groups_count - 1)
        groups[gi].append(int(e["team_id"]))
    return groups


def _berger_pairings(team_ids: Sequence[int]) -> List[List[Tuple[int, int]]]:
    """Формирует туры круговой системы (алгоритм Бергера) с балансировкой порядка.

    - Чётное N: ровно N-1 туров, каждая команда играет 1 матч за тур.
    - Нечётное N: добавляется BYE (None), получаем N туров; пары с BYE пропускаем.
    - Баланс: чередуем порядок пар (условно дом/гости) по чётности тура и индекса пары.
    """
    ids = list(team_ids)
    n = len(ids)
    if n < 2:
        return []

    bye = None
    if n % 2 != 0:
        ids.append(bye)
        n += 1

    fixed = ids[0]
    rotating = ids[1:]

    rounds: List[List[Tuple[int, int]]] = []
    for round_num in range(n - 1):
        pairs: List[Tuple[int, int]] = []

        # Пара с фиксированной командой
        if fixed is not None and rotating[-1] is not None:
            if round_num % 2 == 0:
                pairs.append((fixed, rotating[-1]))
            else:
                pairs.append((rotating[-1], fixed))

        # Остальные пары симметрично из rotating
        for i in range((n - 2) // 2):
            a = rotating[i]
            b = rotating[n - 3 - i]
            if a is None or b is None:
                continue
            if (round_num + i) % 2 == 0:
                pairs.append((a, b))
            else:
                pairs.append((b, a))

        rounds.append(pairs)
        # Вращаем список (кроме фиксированного)
        rotating = [rotating[-1]] + rotating[:-1]

    return rounds


def _snake_pairings(team_ids: Sequence[int]) -> List[List[Tuple[int, int]]]:
    """Алгоритм Змейка: последовательное составление пар.
    
    Для участников [1, 2, 3, 4]:
    Тур 1: 1-2
    Тур 2: 1-3, 2-4
    Тур 3: 1-4, 2-3
    Тур 4: 3-4
    
    Простой для понимания, но менее сбалансирован для больших групп.
    """
    ids = list(team_ids)
    n = len(ids)
    if n < 2:
        return []
    
    rounds: List[List[Tuple[int, int]]] = []
    
    # Генерируем все пары
    for i in range(n - 1):
        pairs: List[Tuple[int, int]] = []
        for j in range(i + 1, n):
            pairs.append((ids[i], ids[j]))
        if pairs:
            rounds.append(pairs)
    
    return rounds


def _custom_pattern_pairings(
    team_ids: Sequence[int], 
    pattern: SchedulePattern
) -> List[List[Tuple[int, int]]]:
    """Применяет кастомный шаблон к реальным ID команд.
    
    Args:
        team_ids: список ID команд (упорядоченный)
        pattern: объект SchedulePattern с кастомным расписанием
    
    Returns:
        Список туров, каждый тур - список пар (team_id1, team_id2)
    
    Raises:
        ValueError: если количество команд не совпадает с ожидаемым в шаблоне
    """
    # Разрешаем использовать шаблон для N или N-1 участников (нечетное количество)
    if len(team_ids) != pattern.participants_count and len(team_ids) != pattern.participants_count - 1:
        raise ValueError(
            f"Количество команд {len(team_ids)} != "
            f"ожидаемому в шаблоне {pattern.participants_count} или {pattern.participants_count - 1}"
        )
    
    # Маппинг: позиция в шаблоне (1-based) -> team_id
    position_to_team = {i + 1: team_id for i, team_id in enumerate(team_ids)}
    
    rounds: List[List[Tuple[int, int]]] = []
    max_position = len(team_ids)
    
    for round_data in pattern.custom_schedule['rounds']:
        pairs: List[Tuple[int, int]] = []
        
        for pair_positions in round_data['pairs']:
            pos1, pos2 = pair_positions
            
            # Пропускаем пары с участником, которого нет (при нечетном количестве)
            if pos1 > max_position or pos2 > max_position:
                continue
            
            team1_id = position_to_team[pos1]
            team2_id = position_to_team[pos2]
            pairs.append((team1_id, team2_id))
        
        # Добавляем тур только если в нем есть пары
        if pairs:
            rounds.append(pairs)
    
    return rounds


# Для обратной совместимости
def _round_robin_pairings(team_ids: Sequence[int]) -> List[List[Tuple[int, int]]]:
    """Алиас для _berger_pairings для обратной совместимости."""
    return _berger_pairings(team_ids)


def generate_round_robin_matches(tournament: Tournament) -> List[GeneratedMatch]:
    """Генерирует матчи круговой системы с учетом выбранных шаблонов для групп."""
    if tournament.system != Tournament.System.ROUND_ROBIN:
        raise ValueError("Турнир не в режимe круговой системы")

    # Получаем группы согласно расположению в таблице (group_index/row_index)
    groups = _get_groups_by_rows(tournament)
    if all(len(g) == 0 for g in groups):
        return []

    existing = set(
        Match.objects.filter(tournament=tournament).values_list("team_1_id", "team_2_id", "round_name")
    )

    generated: List[GeneratedMatch] = []
    
    for gi, group in enumerate(groups):
        round_name = f"Группа {gi + 1}"
        
        # Проверяем, есть ли выбранный шаблон для этой группы (совместимость с None/"{}")
        patterns = tournament.group_schedule_patterns
        if not patterns:
            patterns = {}
        elif isinstance(patterns, str):
            try:
                patterns = json.loads(patterns) or {}
            except Exception:
                patterns = {}
        pattern_id = patterns.get(round_name)
        
        if pattern_id:
            try:
                pattern = SchedulePattern.objects.get(pk=pattern_id)
                
                # Выбираем алгоритм в зависимости от типа шаблона
                if pattern.pattern_type == SchedulePattern.PatternType.BERGER:
                    rr = _berger_pairings(group)
                elif pattern.pattern_type == SchedulePattern.PatternType.SNAKE:
                    rr = _snake_pairings(group)
                elif pattern.pattern_type == SchedulePattern.PatternType.CUSTOM:
                    rr = _custom_pattern_pairings(group, pattern)
                else:
                    # Fallback на Бергера
                    rr = _berger_pairings(group)
            except SchedulePattern.DoesNotExist:
                # Если шаблон не найден, используем Бергера
                rr = _berger_pairings(group)
        else:
            # По умолчанию используем алгоритм Бергера
            rr = _berger_pairings(group)
        
        # Нумерация order_in_round: пары тура 1 -> 1, 2; тура 2 -> 101, 102; ...
        for tour_idx, tour_pairs in enumerate(rr, start=1):
            base = (tour_idx - 1) * 100
            for pair_idx, (t1, t2) in enumerate(tour_pairs, start=1):
                key = (t1, t2, round_name)
                key_rev = (t2, t1, round_name)
                if key in existing or key_rev in existing:
                    continue
                generated.append(GeneratedMatch(t1, t2, round_name, base + pair_idx))

    return generated


def generate_matches_for_group(
    tournament: Tournament, 
    group_name: str, 
    pattern: SchedulePattern
) -> List[GeneratedMatch]:
    """Генерирует матчи для конкретной группы с использованием указанного шаблона.
    
    Args:
        tournament: турнир
        group_name: название группы (например, "Группа 1")
        pattern: шаблон расписания
    
    Returns:
        Список сгенерированных матчей
    """
    # Получаем участников группы в порядке строк
    group_index = int(group_name.split()[-1])  # Извлекаем номер группы
    team_ids = list(
        TournamentEntry.objects.filter(
            tournament=tournament,
            group_index=group_index,
            row_index__isnull=False
        )
        .values_list("team_id", flat=True)
        .order_by("row_index", "team_id")
    )
    
    if not team_ids:
        return []
    
    # Выбираем алгоритм генерации
    if pattern.pattern_type == SchedulePattern.PatternType.BERGER:
        rr = _berger_pairings(team_ids)
    elif pattern.pattern_type == SchedulePattern.PatternType.SNAKE:
        rr = _snake_pairings(team_ids)
    elif pattern.pattern_type == SchedulePattern.PatternType.CUSTOM:
        rr = _custom_pattern_pairings(team_ids, pattern)
    else:
        rr = _berger_pairings(team_ids)
    
    # Формируем список матчей с нужной нумерацией order_in_round
    generated: List[GeneratedMatch] = []
    for tour_idx, tour_pairs in enumerate(rr, start=1):
        base = (tour_idx - 1) * 100
        for pair_idx, (t1, t2) in enumerate(tour_pairs, start=1):
            generated.append(GeneratedMatch(t1, t2, group_name, base + pair_idx))
    
    return generated


@transaction.atomic
def persist_generated_matches(tournament: Tournament, matches: Iterable[GeneratedMatch]) -> int:
    created = 0
    for m in matches:
        # Определяем group_index из round_name вида "Группа X"
        group_index: Optional[int] = None
        if m.round_name:
            try:
                if isinstance(m.round_name, str) and m.round_name.strip().lower().startswith("группа"):
                    group_index = int(str(m.round_name).split()[-1])
            except Exception:
                group_index = None

        # Определяем round_index из order_in_round (1.. для тура 1, 101.. для тура 2 и т.д.)
        round_index = 1
        try:
            round_index = int((int(m.order_in_round) - 1) // 100) + 1
        except Exception:
            round_index = 1

        # Нормализованные команды
        low_id = min(m.team1_id, m.team2_id)
        high_id = max(m.team1_id, m.team2_id)

        # Уникальность в БД по (tournament, stage, group_index, team_low, team_high)
        obj, was_created = Match.objects.get_or_create(
            tournament=tournament,
            stage=Match.Stage.GROUP,
            group_index=group_index,
            team_low_id=low_id,
            team_high_id=high_id,
            defaults={
                "team_1_id": m.team1_id,
                "team_2_id": m.team2_id,
                "round_name": m.round_name,
                "round_index": round_index,
                "order_in_round": m.order_in_round,
                "status": Match.Status.SCHEDULED,
            },
        )
        if was_created:
            created += 1
        else:
            # Обновляем недостающие поля у существующего матча при необходимости
            need_save = False
            if not obj.team_1_id:
                obj.team_1_id = m.team1_id; need_save = True
            if not obj.team_2_id:
                obj.team_2_id = m.team2_id; need_save = True
            if not obj.round_name and m.round_name:
                obj.round_name = m.round_name; need_save = True
            if not obj.round_index and round_index:
                obj.round_index = round_index; need_save = True
            if obj.order_in_round != m.order_in_round:
                obj.order_in_round = m.order_in_round; need_save = True
            if need_save:
                obj.save(update_fields=[
                    "team_1", "team_2", "round_name", "round_index", "order_in_round"
                ])
    return created

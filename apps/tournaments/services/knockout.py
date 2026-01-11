from __future__ import annotations

import math
import random
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from django.db import transaction

from apps.matches.models import Match
from apps.tournaments.models import DrawPosition, KnockoutBracket, TournamentEntry


# ----------------------
# Вспомогательные сущности
# ----------------------

ROUND_NAMES: Dict[int, str] = {
    1: "Финал",
    2: "Полуфинал",
    4: "1/4 финала",
    8: "1/8 финала",
    16: "1/16 финала",
    32: "1/32 финала",
    64: "1/64 финала",
}


def _get_round_name(matches_in_round: int) -> str:
    return ROUND_NAMES.get(matches_in_round, f"Раунд на {matches_in_round * 2}")


def validate_bracket_size(size: int) -> bool:
    """Размер сетки должен быть степенью двойки (8/16/32/...)."""
    return size > 0 and (size & (size - 1) == 0)


def calculate_bye_positions(bracket_size: int, num_participants: int) -> List[int]:
    """Рассчитать позиции BYE согласно правилам ITF.
    
    Args:
        bracket_size: размер сетки (степень двойки: 8, 16, 32...)
        num_participants: количество реальных участников
    
    Returns:
        Список позиций (1-based) для размещения BYE
    """
    if num_participants >= bracket_size:
        return []
    
    num_byes = bracket_size - num_participants
    
    # Стандартный порядок ITF для распределения BYE
    # Позиции распределяются равномерно по верхней и нижней половинам
    itf_order = []
    
    # Для сетки на 8: [1, 8, 4, 5, 2, 7, 3, 6]
    # Для сетки на 16: [1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]
    # Общий принцип: чередование верхней и нижней половин
    
    def generate_itf_positions(size: int) -> List[int]:
        """Генерация позиций в порядке ITF."""
        if size == 2:
            return [1, 2]
        
        positions = []
        half = size // 2
        
        # Рекурсивно генерируем для половины
        sub_positions = generate_itf_positions(half)
        
        for pos in sub_positions:
            positions.append(pos)  # Верхняя половина
            positions.append(size - pos + 1)  # Нижняя половина (зеркально)
        
        return positions
    
    itf_order = generate_itf_positions(bracket_size)
    
    # Берём первые num_byes позиций из ITF порядка
    opponent_positions = itf_order[:num_byes]
    
    # Преобразовать позиции противников в реальные позиции BYE
    # Если позиция нечетная → BYE на позиции +1
    # Если позиция четная → BYE на позиции -1
    bye_positions = []
    for pos in opponent_positions:
        if pos % 2 == 1:  # Нечетная
            bye_positions.append(pos + 1)
        else:  # Четная
            bye_positions.append(pos - 1)
    
    return sorted(bye_positions)


@dataclass
class RoundInfo:
    round_index: int
    matches_count: int
    round_name: str
    is_final: bool = False
    is_third_place: bool = False


def calculate_rounds_structure(size: int, has_third_place: bool) -> List[RoundInfo]:
    if not validate_bracket_size(size):
        raise ValueError(f"Размер сетки должен быть степенью двойки: {size}")

    rounds: List[RoundInfo] = []
    matches_in_round = size // 2
    round_index = 0
    while matches_in_round >= 1:
        rounds.append(
            RoundInfo(
                round_index=round_index,
                matches_count=matches_in_round,
                round_name=_get_round_name(matches_in_round),
                is_final=(matches_in_round == 1),
            )
        )
        matches_in_round //= 2
        round_index += 1

    if has_third_place and size >= 4:
        rounds.append(
            RoundInfo(
                round_index=round_index,
                matches_count=1,
                round_name="Матч за 3-е место",
                is_third_place=True,
            )
        )

    return rounds


# ----------------------
# Генерация матчей
# ----------------------

@transaction.atomic
def generate_initial_matches(bracket: KnockoutBracket) -> int:
    """Сгенерировать пустые матчи для всех раундов указанной сетки.

    Возвращает количество созданных матчей.
    """
    if Match.objects.filter(bracket=bracket).exists():
        raise ValueError("Матчи для этой сетки уже существуют")

    total_created = 0
    for info in calculate_rounds_structure(bracket.size, bracket.has_third_place):
        for order_in_round in range(1, info.matches_count + 1):
            Match.objects.create(
                tournament=bracket.tournament,
                bracket=bracket,
                stage=Match.Stage.PLAYOFF,
                round_index=info.round_index,
                round_name=info.round_name,
                order_in_round=order_in_round,
                is_third_place=info.is_third_place,
                status=Match.Status.SCHEDULED,
                # team_1/team_2 назначаются позже по позициям жеребьёвки
            )
            total_created += 1
    return total_created


@transaction.atomic
def create_bye_positions(bracket: KnockoutBracket, num_participants: int) -> int:
    """Создать DrawPosition записи для BYE в неполной сетке.
    
    Args:
        bracket: сетка турнира
        num_participants: количество реальных участников
    
    Returns:
        Количество созданных BYE позиций
    """
    bye_positions = calculate_bye_positions(bracket.size, num_participants)
    
    created_count = 0
    for position in bye_positions:
        DrawPosition.objects.create(
            bracket=bracket,
            position=position,
            entry=None,  # NULL для BYE
            source=DrawPosition.Source.BYE,
            seed=None
        )
        created_count += 1
    
    return created_count


# ----------------------
# Посев и назначение участников в 1-м раунде
# ----------------------

# Количество сеянных игроков по размеру сетки
SEEDS_COUNT_MAP: Dict[int, int] = {
    4: 2,
    8: 2,
    16: 4,
    32: 8,
    64: 16,
    128: 32,
    256: 64,
    512: 128,
}

# Позиции для сеянных игроков
# Формат: размер_сетки -> список групп позиций
# Seed 1 и 2 всегда на позициях [1] и [size]
# Остальные сеянные распределяются случайно внутри своих групп
SEED_POSITIONS_GROUPS: Dict[int, List[List[int]]] = {
    4: [[1], [4]],
    8: [[1], [8]],
    16: [[1], [16], [9, 8]],
    32: [[1], [32], [17, 16], [9, 24, 25, 8]],
    64: [[1], [64], [33, 32], [17, 48, 49, 16], [9, 56, 41, 24, 25, 40, 57, 8]],
    128: [[1], [128], [65, 64], [33, 96, 97, 32], [17, 112, 81, 48, 49, 80, 113, 16], [9, 120, 73, 56, 41, 88, 105, 24, 25, 104, 89, 40, 57, 72, 121, 8]],
}

SEED_POSITIONS_MAP: Dict[int, Dict[int, int]] = {
    # seed -> position (позиция от 1 до size)
    8: {1: 1, 2: 8, 3: 5, 4: 4},
    16: {1: 1, 2: 16, 3: 9, 4: 8, 5: 5, 6: 12, 7: 13, 8: 4},
    32: {
        1: 1, 2: 32, 3: 16, 4: 17, 5: 8, 6: 25, 7: 9, 8: 24,
        9: 4, 10: 29, 11: 13, 12: 20, 13: 5, 14: 28, 15: 12, 16: 21,
    },
}


def _get_seed_positions(size: int) -> Dict[int, int]:
    if size in SEED_POSITIONS_MAP:
        return SEED_POSITIONS_MAP[size]
    # универсальная простая схема для прочих размеров
    result: Dict[int, int] = {}
    for s in range(1, size // 2 + 1):
        if s == 1:
            result[s] = 1
        elif s == 2:
            result[s] = size
        else:
            result[s] = max(1, min(size, (s - 1) * 2))
    return result


def _pair_index_for_position(pos: int) -> Tuple[int, str]:
    """Вернуть (номер_матча, слот) первого раунда для позиции жеребьёвки.
    Позиции (1,2) → матч 1 (team_1, team_2), (3,4) → матч 2 и т.д.
    """
    match_order = (pos + 1) // 2
    slot = "team_1" if pos % 2 == 1 else "team_2"
    return match_order, slot


def auto_seed_participants(bracket: KnockoutBracket, entries: List[TournamentEntry]) -> None:
    """Автоматический посев участников согласно правилам ITF.
    
    Шаги:
    1. Сортировка по рейтингу (случайно при равных)
    2. Определение сеянных игроков
    3. Специальная обработка для участников с нулевым рейтингом
    4. Расстановка сеянных по ITF позициям
    5. Случайное распределение остальных (учитывая BYE)
    """
    size = bracket.size
    if not validate_bracket_size(size):
        raise ValueError("Некорректный размер сетки")
    
    # Получить количество сеянных для данного размера сетки
    seeds_count = SEEDS_COUNT_MAP.get(size, 0)
    
    # 1. Сортировка участников по рейтингу
    # Группируем по рейтингу для случайного распределения внутри группы
    from collections import defaultdict
    rating_groups = defaultdict(list)
    
    for entry in entries:
        # Получаем рейтинг команды
        rating = _get_team_rating(entry)
        rating_groups[rating].append(entry)
    
    # Сортируем группы по рейтингу (убывание) и перемешиваем внутри каждой группы
    sorted_entries = []
    for rating in sorted(rating_groups.keys(), reverse=True):
        group = rating_groups[rating]
        random.shuffle(group)
        sorted_entries.extend(group)
    
    # 2. Специальная обработка для участников с нулевым рейтингом
    # Если среди сеянных больше одного с рейтингом 0, применяем специальное правило
    if seeds_count > 0 and len(sorted_entries) >= seeds_count:
        seeded = sorted_entries[:seeds_count]
        zero_rating_count = sum(1 for e in seeded if _get_team_rating(e) == 0)
        
        if zero_rating_count > 1:
            # Ищем специального участника в списке
            special_entry_index = None
            for i, entry in enumerate(sorted_entries):
                if _is_special_participant(entry):
                    special_entry_index = i
                    break
            
            # Если найден и не на последней сеянной позиции
            if special_entry_index is not None and special_entry_index != seeds_count - 1:
                special_entry = sorted_entries.pop(special_entry_index)
                # Если он уже в сеянных, меняем местами с последним сеянным
                if special_entry_index < seeds_count:
                    sorted_entries.insert(seeds_count - 1, special_entry)
                else:
                    # Если он не в сеянных, меняем с последним сеянным
                    last_seeded = sorted_entries[seeds_count - 1]
                    sorted_entries[seeds_count - 1] = special_entry
                    sorted_entries.insert(special_entry_index, last_seeded)
    
    # 3. Обновить/проставить BYE позиции для неполной сетки
    from apps.tournaments.models import DrawPosition as DP
    total_positions = set(range(1, size + 1))
    # Убедимся, что все позиции существуют
    existing_positions = set(DP.objects.filter(bracket=bracket).values_list('position', flat=True))
    missing_positions = [p for p in total_positions if p not in existing_positions]
    if missing_positions:
        DP.objects.bulk_create([DP(bracket=bracket, position=p) for p in missing_positions])

    num_participants = len([e for e in entries if e.team_id or getattr(e, 'team', None)])
    computed_bye_positions = set(calculate_bye_positions(size, num_participants))
    # Сбросим все BYE, затем выставим по рассчитанному набору
    DP.objects.filter(bracket=bracket, source='BYE').update(source=DP.Source.MAIN)
    if computed_bye_positions:
        DP.objects.filter(bracket=bracket, position__in=computed_bye_positions).update(entry=None, source=DP.Source.BYE, seed=None)

    # 4. Получить позиции для сеянных игроков
    seed_positions = _get_itf_seed_positions(size, seeds_count)
    
    # 5. Получить позиции BYE
    bye_positions = set(DrawPosition.objects.filter(
        bracket=bracket,
        source='BYE'
    ).values_list('position', flat=True))
    
    # 6. Создать список всех позиций и разделить на сеянные и свободные
    all_positions = set(range(1, size + 1))
    available_positions = all_positions - bye_positions - set(seed_positions.values())
    available_positions = list(available_positions)
    random.shuffle(available_positions)
    
    # 7. Очистить текущие привязки (кроме BYE)
    DrawPosition.objects.filter(
        bracket=bracket
    ).exclude(source='BYE').update(entry=None, seed=None)
    
    # 8. Расставить сеянных игроков
    for seed_num, position in seed_positions.items():
        if seed_num <= len(sorted_entries):
            entry = sorted_entries[seed_num - 1]
            DrawPosition.objects.update_or_create(
                bracket=bracket,
                position=position,
                defaults={
                    'entry': entry,
                    'source': DrawPosition.Source.MAIN,
                    'seed': seed_num
                }
            )
    
    # 9. Расставить остальных участников случайно
    unseeded_entries = sorted_entries[seeds_count:]
    for i, entry in enumerate(unseeded_entries):
        if i < len(available_positions):
            position = available_positions[i]
            DrawPosition.objects.update_or_create(
                bracket=bracket,
                position=position,
                defaults={
                    'entry': entry,
                    'source': DrawPosition.Source.MAIN,
                    'seed': None
                }
            )
    
    # 10. Назначить участников в матчи первого раунда
    _assign_draw_to_matches(bracket)


def _get_team_rating(entry: TournamentEntry) -> int:
    """Получить рейтинг команды для сортировки.
    Для пар - среднее арифметическое с округлением.
    Для одиночек - рейтинг игрока.
    """
    team = entry.team
    rating = 0
    if team:
        if team.player_1 and team.player_2:
            r1 = team.player_1.current_rating or 0
            r2 = team.player_2.current_rating or 0
            rating = round((r1 + r2) / 2)
        elif team.player_1:
            rating = team.player_1.current_rating or 0
    return rating


def _is_special_participant(entry: TournamentEntry) -> bool:
    """Проверить, является ли участник специальным (для внутренней логики)."""
    team = entry.team
    if not team:
        return False
    
    # Проверяем имя игрока или пары
    team_name = str(team)
    return "Петров Михаил" in team_name


def _get_itf_seed_positions(size: int, seeds_count: int) -> Dict[int, int]:
    """Получить позиции для сеянных игроков согласно ITF правилам.
    
    Returns:
        Dict[seed_number, position]
    """
    if size not in SEED_POSITIONS_GROUPS or seeds_count == 0:
        return {}
    
    groups = SEED_POSITIONS_GROUPS[size]
    result = {}
    seed_num = 1
    
    for group in groups:
        # Перемешиваем позиции внутри группы (кроме первых двух)
        if len(result) >= 2:  # После seed 1 и 2
            positions = group.copy()
            random.shuffle(positions)
        else:
            positions = group
        
        for position in positions:
            if seed_num <= seeds_count:
                result[seed_num] = position
                seed_num += 1
            else:
                break
        
        if seed_num > seeds_count:
            break
    
    return result


def _assign_draw_to_matches(bracket: KnockoutBracket) -> None:
    """Назначить участников из DrawPosition в матчи первого раунда.
    
    Важно: НЕ выполняет автопродвижение BYE - это должно происходить только при фиксации.
    """
    first_round_matches = Match.objects.filter(
        bracket=bracket,
        round_index=0
    ).order_by('order_in_round')
    
    for match in first_round_matches:
        # Определить позиции для этого матча
        pos1 = ((match.order_in_round - 1) * 2) + 1
        pos2 = ((match.order_in_round - 1) * 2) + 2
        
        # Получить участников из DrawPosition
        dp1 = DrawPosition.objects.filter(bracket=bracket, position=pos1).first()
        dp2 = DrawPosition.objects.filter(bracket=bracket, position=pos2).first()
        
        match.team_1 = dp1.entry.team if dp1 and dp1.entry else None
        match.team_2 = dp2.entry.team if dp2 and dp2.entry else None
        
        # Очистить winner и статус - автопродвижение произойдёт только при фиксации
        match.winner = None
        match.status = Match.Status.SCHEDULED
        
        match.save(update_fields=['team_1', 'team_2', 'winner', 'status'])


@transaction.atomic
def seed_participants(bracket: KnockoutBracket, entries: List[TournamentEntry]) -> None:
    """Расставить участников по позициям жеребьёвки и назначить их в матчи первого раунда.

    - Посевы раскладываются по фиксированным позициям
    - Непосеянные — случайно по оставшимся позициям
    - BYE остаются пустыми позициями (entry=None, source=BYE)
    """
    # Используем новую функцию автопосева
    auto_seed_participants(bracket, entries)
    return
    
    # Старый код (оставлен для совместимости)
    size = bracket.size
    if not validate_bracket_size(size):
        raise ValueError("Некорректный размер сетки")

    # 1) Очистим текущие привязки позиций
    DrawPosition.objects.filter(bracket=bracket).update(entry=None, source=DrawPosition.Source.MAIN, seed=None)

    # 2) Убедимся, что позиции существуют
    existing_pos = set(
        DrawPosition.objects.filter(bracket=bracket).values_list("position", flat=True)
    )
    missing = [p for p in range(1, size + 1) if p not in existing_pos]
    for p in missing:
        DrawPosition.objects.create(bracket=bracket, position=p)

    # 3) Разделим на посевы/непосевы
    seeded = [e for e in entries if hasattr(e, "seed") and getattr(e, "seed")]
    unseeded = [e for e in entries if not (hasattr(e, "seed") and getattr(e, "seed"))]

    # 4) Разложим посевы по позициям
    seed_positions = _get_seed_positions(size)
    for e in seeded:
        s = int(getattr(e, "seed"))
        if s in seed_positions:
            pos_num = seed_positions[s]
            DrawPosition.objects.filter(bracket=bracket, position=pos_num).update(entry=e, seed=s)

    # 5) Остальных распределим по пустым позициям
    empty_positions = list(
        DrawPosition.objects.filter(bracket=bracket, entry__isnull=True).order_by("position")
    )
    random.shuffle(unseeded)
    for pos, e in zip(empty_positions, unseeded):
        pos.entry = e
        pos.save(update_fields=["entry"])

    # Остальные пустые позиции считаем BYE
    DrawPosition.objects.filter(bracket=bracket, entry__isnull=True).update(source=DrawPosition.Source.BYE)

    # 6) Назначим команды в матчи 1-го раунда
    _apply_positions_to_first_round(bracket)


def _apply_positions_to_first_round(bracket: KnockoutBracket) -> None:
    """Обновить team_1/team_2 для матчей первого раунда на основе DrawPosition."""
    first_round = Match.objects.filter(
        bracket=bracket,
        round_index=0,
        is_third_place=False,
    )
    pos_by_number: Dict[int, Optional[int]] = {
        p.position: (p.entry.team_id if p.entry_id else None)
        for p in DrawPosition.objects.filter(bracket=bracket).select_related("entry__team")
    }

    for m in first_round.order_by("order_in_round"):
        pos1 = (m.order_in_round - 1) * 2 + 1
        pos2 = pos1 + 1
        team1_id = pos_by_number.get(pos1)
        team2_id = pos_by_number.get(pos2)
        m.team_1_id = team1_id
        m.team_2_id = team2_id
        # Нормализованные поля
        if team1_id and team2_id:
            low, high = sorted([team1_id, team2_id])
            m.team_low_id = low
            m.team_high_id = high
        else:
            m.team_low_id = None
            m.team_high_id = None
        m.save(update_fields=["team_1", "team_2", "team_low", "team_high"])


# ----------------------
# Продвижение победителей
# ----------------------

def _find_next_match(bracket: KnockoutBracket, current: Match) -> Optional[Match]:
    if current.is_third_place:
        return None
    # финал дальше не ведёт
    # следующий матч имеет round_index + 1 и order = ceil(order/2)
    next_round_index = (current.round_index or 0) + 1
    next_order = (current.order_in_round + 1) // 2
    return (
        Match.objects.filter(
            bracket=bracket, round_index=next_round_index, order_in_round=next_order, is_third_place=False
        ).first()
    )


def _ensure_third_place_match(bracket: KnockoutBracket) -> Optional[Match]:
    return Match.objects.filter(bracket=bracket, is_third_place=True).first()


def _loser_of(m: Match) -> Optional[int]:
    if not m.winner_id:
        return None
    if m.team_1_id and m.team_2_id:
        return m.team_1_id if m.winner_id == m.team_2_id else m.team_2_id
    return None


@transaction.atomic
def advance_winner(match: Match) -> None:
    """Продвинуть победителя завершенного матча в следующий раунд.
    Для полуфиналов дополнительно заполнить участников матча за 3‑е место проигравшими.
    """
    if match.status != Match.Status.COMPLETED or not match.winner_id:
        return

    # 1) Победитель -> следующий матч
    nxt = _find_next_match(match.bracket, match)
    if nxt is not None:
        # Определим целевой слот в следующем матче: нечетные -> team_1, четные -> team_2
        target_slot = "team_1" if (match.order_in_round % 2 == 1) else "team_2"
        if target_slot == "team_1":
            nxt.team_1_id = match.winner_id
        else:
            nxt.team_2_id = match.winner_id
        # Обновим нормализованные поля
        if nxt.team_1_id and nxt.team_2_id:
            low, high = sorted([nxt.team_1_id, nxt.team_2_id])
            nxt.team_low_id = low
            nxt.team_high_id = high
        else:
            nxt.team_low_id = None
            nxt.team_high_id = None
        nxt.save(update_fields=["team_1", "team_2", "team_low", "team_high"])

    # 2) Полуфинал -> матч за 3‑е место проигравшими
    # round_index последнего обычного раунда перед финалом = финал_index - 1 → это полуфинал
    # но мы надёжно сверимся по имени раунда
    if (match.round_name or "").lower().startswith("полуфинал"):
        third = _ensure_third_place_match(match.bracket)
        if third is not None:
            loser_id = _loser_of(match)
            if loser_id:
                if match.order_in_round == 1:
                    third.team_1_id = loser_id
                else:
                    third.team_2_id = loser_id
                if third.team_1_id and third.team_2_id:
                    low, high = sorted([third.team_1_id, third.team_2_id])
                    third.team_low_id = low
                    third.team_high_id = high
                else:
                    third.team_low_id = None
                    third.team_high_id = None
                third.save(update_fields=["team_1", "team_2", "team_low", "team_high"]) 

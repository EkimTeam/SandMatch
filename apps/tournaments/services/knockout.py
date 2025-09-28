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


# ----------------------
# Посев и назначение участников в 1-м раунде
# ----------------------

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


@transaction.atomic
def seed_participants(bracket: KnockoutBracket, entries: List[TournamentEntry]) -> None:
    """Расставить участников по позициям жеребьёвки и назначить их в матчи первого раунда.

    - Посевы раскладываются по фиксированным позициям
    - Непосеянные — случайно по оставшимся позициям
    - BYE остаются пустыми позициями (entry=None, source=BYE)
    """
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

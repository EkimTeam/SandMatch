from __future__ import annotations

from dataclasses import dataclass
from typing import List, Dict, Optional

from django.db import transaction

from apps.tournaments.models import Tournament, KnockoutBracket as BracketModel
from apps.matches.models import Match


@dataclass
class KnockoutRound:
    name: str
    matches: List[dict]


@dataclass
class KnockoutBracket:
    index: int
    rounds: List[KnockoutRound]


def _round_name(size: int, round_idx: int) -> str:
    # Простейшие подписи раундов по размеру сетки
    # round_idx: 1 = первый раунд
    left = size >> (round_idx - 1)
    if left == 2:
        return "Финал"
    if left == 4:
        return "1/2 финала"
    if left == 8:
        return "1/4 финала"
    if left == 16:
        return "1/8 финала"
    return f"Раунд {round_idx}"


def _next_power_of_two(n: int) -> int:
    p = 1
    while p < n:
        p <<= 1
    return p


def build_knockout_context(t: Tournament) -> Dict:
    """Возвращает минимальный контекст для отображения пустой олимпийской сетки
    с кнопками управления внизу. Участники пока не заполняются.
    """
    planned = int(t.planned_participants or 0)
    brackets = int(t.brackets_count or 1)
    per_bracket = planned // brackets if brackets else planned
    per_bracket = max(per_bracket, 2)  # хотя бы 2

    brackets_ctx: List[KnockoutBracket] = []

    for bi in range(1, brackets + 1):
        size = _next_power_of_two(per_bracket)
        rounds: List[KnockoutRound] = []
        # Количество раундов — log2(size)
        r = 0
        x = size
        while x > 1:
            r += 1
            x //= 2
        for ri in range(1, r + 1):
            matches_in_round = size >> ri
            round_name = _round_name(size, ri)
            rounds.append(KnockoutRound(
                name=round_name,
                matches=[{"team1": None, "team2": None} for _ in range(matches_in_round)]
            ))
        brackets_ctx.append(KnockoutBracket(index=bi, rounds=rounds))

    # Классификационные матчи за все места (минимальный каркас)
    placement_rounds = []  # Для MVP0 оставим пустым; добавим позже при заполнении логики

    return {
        "brackets": brackets_ctx,
        "placements": placement_rounds,
    }


# === Генерация матчей олимпийки ===
def _rounds_count(size: int) -> int:
    r = 0
    x = size
    while x > 1:
        r += 1
        x //= 2
    return r


@transaction.atomic
def generate_brackets(
    tournament: Tournament,
    brackets_count: Optional[int] = None,
    has_third_place: bool = True,
) -> List[BracketModel]:
    """Создаёт каркас сеток и пустые матчи для всех раундов.

    На этом этапе участники и посев не распределяются — это следующий шаг.
    """
    if tournament.system != Tournament.System.KNOCKOUT:
        raise ValueError("tournament is not knockout")

    planned = int(tournament.planned_participants or 0)
    brackets = int(brackets_count or tournament.brackets_count or 1)
    brackets = max(1, brackets)

    # Грубое распределение участников по сеткам
    per_bracket = planned // brackets if planned else 0
    per_bracket = max(per_bracket, 2)

    created: List[BracketModel] = []

    # Удалять старое в MVP не будем — предполагаем одноразовую генерацию.
    for bi in range(1, brackets + 1):
        size = _next_power_of_two(per_bracket)
        b = BracketModel.objects.create(
            tournament=tournament,
            index=bi,
            size=size,
            has_third_place=has_third_place,
        )
        created.append(b)

        rounds_total = _rounds_count(size)
        # Создаём пустые матчи всех раундов
        for ri in range(1, rounds_total + 1):
            matches_in_round = size >> ri
            for order in range(1, matches_in_round + 1):
                Match.objects.create(
                    tournament=tournament,
                    bracket=b,
                    stage=Match.Stage.PLAYOFF,
                    round_index=ri,
                    round_name=_round_name(size, ri),
                    order_in_round=order,
                )

        # Матч за 3-е место
        if has_third_place:
            Match.objects.create(
                tournament=tournament,
                bracket=b,
                stage=Match.Stage.PLACEMENT,
                round_index=rounds_total + 1,
                round_name="Матч за 3-е место",
                order_in_round=1,
                is_third_place=True,
            )

    return created


def progress_winner(match: Match) -> None:
    """Проталкивает победителя в следующий раунд в нужный слот.

    Предполагает, что следующий матч уже создан при генерации.
    """
    if not match.bracket_id or not match.winner_id:
        return
    if match.stage != Match.Stage.PLAYOFF:
        return

    size = match.bracket.size if match.bracket else None
    if not size:
        return

    # Найти родительский матч
    next_round = (match.round_index or 1) + 1
    parent_order = (match.order_in_round or 1 + 1) // 2
    # Чётность определяет слот (1 или 2)
    is_first_slot = ((match.order_in_round or 1) % 2) == 1

    parent = (
        Match.objects.filter(
            tournament_id=match.tournament_id,
            bracket_id=match.bracket_id,
            stage=Match.Stage.PLAYOFF,
            round_index=next_round,
            order_in_round=parent_order,
        ).first()
    )
    if not parent:
        return

    # Заполняем соответствующий слот
    if is_first_slot:
        if parent.team_1_id != match.winner_id:
            parent.team_1_id = match.winner_id
            parent.save(update_fields=["team_1"])
    else:
        if parent.team_2_id != match.winner_id:
            parent.team_2_id = match.winner_id
            parent.save(update_fields=["team_2"])


def serialize_brackets(tournament: Tournament) -> Dict:
    """Сериализация сеток и матчей для фронтенда."""
    res = {
        "tournament": {"id": tournament.id, "name": tournament.name},
        "brackets": [],
    }

    qs = (
        Match.objects.filter(tournament=tournament, bracket__isnull=False)
        .select_related("bracket", "team_1__player_1", "team_1__player_2", "team_2__player_1", "team_2__player_2")
        .order_by("bracket__index", "round_index", "order_in_round")
    )

    by_bracket: Dict[int, Dict] = {}
    for m in qs:
        b = m.bracket
        if b.id not in by_bracket:
            by_bracket[b.id] = {
                "id": b.id,
                "index": b.index,
                "size": b.size,
                "has_third_place": b.has_third_place,
                "rounds": {},
                "third_place": None,
            }
        # Третий место
        if m.is_third_place:
            by_bracket[b.id]["third_place"] = _serialize_match(m)
            continue
        r = m.round_index or 0
        by_bracket[b.id]["rounds"].setdefault(r, {"index": r, "name": m.round_name or f"Раунд {r}", "matches": []})
        by_bracket[b.id]["rounds"][r]["matches"].append(_serialize_match(m))

    # Преобразуем словари раундов в списки
    for b in sorted(by_bracket.values(), key=lambda x: x["index"]):
        rounds = [b["rounds"][k] for k in sorted(b["rounds"].keys())]
        res["brackets"].append({
            "id": b["id"],
            "index": b["index"],
            "size": b["size"],
            "has_third_place": b["has_third_place"],
            "rounds": rounds,
            "third_place": b["third_place"],
        })

    return res


def _team_short(team) -> Optional[str]:
    if not team:
        return None
    p1 = team.player_1
    p2 = team.player_2
    if p2 is None:
        return p1.display_name or p1.first_name or str(p1)
    return f"{p1.display_name or p1.first_name} / {p2.display_name or p2.first_name}"


def _serialize_match(m: Match) -> Dict:
    sets = [
        {
            "index": s.index,
            "g1": s.games_1,
            "g2": s.games_2,
            "tb1": s.tb_1,
            "tb2": s.tb_2,
            "is_tb_only": s.is_tiebreak_only,
        }
        for s in m.sets.all().order_by("index")
    ]
    return {
        "id": m.id,
        "round_index": m.round_index,
        "order": m.order_in_round,
        "status": m.status,
        "team1": {"id": m.team_1_id, "name": _team_short(m.team_1)} if m.team_1_id else None,
        "team2": {"id": m.team_2_id, "name": _team_short(m.team_2)} if m.team_2_id else None,
        "sets": sets,
        "time": m.scheduled_time.isoformat() if m.scheduled_time else None,
    }

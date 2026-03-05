from __future__ import annotations

from typing import Optional

from apps.players.models import Player
from apps.teams.models import Team
from apps.tournaments.models import Tournament


def _gender_rank(gender: Optional[str]) -> int:
    # В обоих профи-парах: female -> male -> null (null должен быть вторым/последним)
    if gender == "female":
        return 0
    if gender == "male":
        return 1
    return 2


def _player_visible_rating_value(tournament: Optional[Tournament], player: Player) -> int:
    if tournament is not None:
        from apps.tournaments.services.rating_visible import get_player_visible_rating

        try:
            res = get_player_visible_rating(tournament, player)
            return int(res.rating or 0)
        except Exception:
            return int(getattr(player, "current_rating", 0) or 0)

    return int(getattr(player, "current_rating", 0) or 0)


def order_pair_players(
    tournament: Optional[Tournament],
    player_1: Optional[Player],
    player_2: Optional[Player],
) -> list[Player]:
    """Возвращает игроков пары в порядке отображения по правилу п.7."""
    players = [p for p in (player_1, player_2) if p is not None]
    if len(players) <= 1:
        return players

    both_profi = bool(getattr(players[0], "is_profi", False) and getattr(players[1], "is_profi", False))

    def key(p: Player):
        is_profi = 1 if bool(getattr(p, "is_profi", False)) else 0
        gender = getattr(p, "gender", None) or getattr(getattr(p, "btr_player", None), "gender", None)
        gender_key = _gender_rank(gender) if both_profi else 9
        visible_rating = _player_visible_rating_value(tournament, p)
        last_name = (getattr(p, "last_name", "") or "").strip().lower()
        first_name = (getattr(p, "first_name", "") or "").strip().lower()
        return (-is_profi, gender_key, -visible_rating, last_name, first_name, int(getattr(p, "id", 0) or 0))

    return sorted(players, key=key)


def team_players_in_display_order(tournament: Optional[Tournament], team: Optional[Team]) -> list[Player]:
    if not team:
        return []
    p1 = getattr(team, "player_1", None)
    p2 = getattr(team, "player_2", None)
    if p2 is None:
        return [p1] if p1 is not None else []
    return order_pair_players(tournament, p1, p2)


def build_team_display_name(tournament: Optional[Tournament], team: Optional[Team]) -> str:
    players = team_players_in_display_order(tournament, team)
    if not players:
        return ""
    if len(players) == 1:
        p = players[0]
        return (getattr(p, "display_name", None) or getattr(p, "first_name", "") or str(p)).strip()

    p1, p2 = players[0], players[1]
    left = (getattr(p1, "display_name", None) or getattr(p1, "first_name", "") or str(p1)).strip()
    right = (getattr(p2, "display_name", None) or getattr(p2, "first_name", "") or str(p2)).strip()
    return f"{left} / {right}".strip()


def build_team_full_name(tournament: Optional[Tournament], team: Optional[Team]) -> str:
    players = team_players_in_display_order(tournament, team)
    if not players:
        return ""

    def full(p: Player) -> str:
        return f"{(getattr(p, 'last_name', '') or '').strip()} {(getattr(p, 'first_name', '') or '').strip()}".strip()

    if len(players) == 1:
        return full(players[0])
    return f"{full(players[0])} / {full(players[1])}".strip()

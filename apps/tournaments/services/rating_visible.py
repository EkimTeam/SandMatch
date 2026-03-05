from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Optional

from apps.players.models import Player
from apps.teams.models import Team
from apps.tournaments.models import Tournament


@dataclass(frozen=True)
class VisibleRatingResult:
    rating: int
    place: Optional[int]


def _bp_place(player: Player) -> Optional[int]:
    if not player or player.current_rating is None:
        return None
    return Player.objects.filter(current_rating__gt=player.current_rating).count() + 1


def _btr_category_for_player(tournament: Tournament, player: Player) -> Optional[str]:
    gender = getattr(player, "gender", None) or getattr(getattr(player, "btr_player", None), "gender", None)

    if tournament.rating_visible == Tournament.RatingVisible.BTR_MW:
        if gender == "male":
            return "men_double"
        if gender == "female":
            return "women_double"
        return None

    if tournament.rating_visible == Tournament.RatingVisible.BTR_MIXED:
        if gender == "male":
            return "men_mixed"
        if gender == "female":
            return "women_mixed"
        return None

    if tournament.rating_visible == Tournament.RatingVisible.BTR_UNDER:
        if gender == "male":
            return "junior_male"
        if gender == "female":
            return "junior_female"
        return None

    return None


def _btr_valid_since(tournament: Tournament) -> date:
    base = tournament.date if getattr(tournament, "date", None) else date.today()
    return base - timedelta(days=365)


def get_player_visible_rating(tournament: Tournament, player: Optional[Player]) -> VisibleRatingResult:
    if not tournament or not player:
        return VisibleRatingResult(rating=0, place=None)

    if tournament.rating_visible == Tournament.RatingVisible.BEACHPLAY:
        rating = int(player.current_rating or 0)
        return VisibleRatingResult(rating=rating, place=_bp_place(player))

    btr_player = getattr(player, "btr_player", None)
    if not btr_player:
        return VisibleRatingResult(rating=0, place=None)

    category = _btr_category_for_player(tournament, player)
    if not category:
        return VisibleRatingResult(rating=0, place=None)

    from apps.btr.models import BtrRatingSnapshot

    valid_since = _btr_valid_since(tournament)
    snapshot = (
        BtrRatingSnapshot.objects.filter(
            player=btr_player,
            category=category,
            rating_date__gte=valid_since,
            rating_date__lte=tournament.date,
        )
        .order_by("-rating_date")
        .first()
    )

    if not snapshot:
        return VisibleRatingResult(rating=0, place=None)

    return VisibleRatingResult(rating=int(snapshot.rating_value or 0), place=snapshot.rank)


def get_team_visible_rating(tournament: Tournament, team: Optional[Team]) -> int:
    if not tournament or not team:
        return 0

    p1 = getattr(team, "player_1", None)
    p2 = getattr(team, "player_2", None)

    r1 = get_player_visible_rating(tournament, p1).rating if p1 else 0
    r2 = get_player_visible_rating(tournament, p2).rating if p2 else 0

    if p1 and p2:
        if tournament.rating_visible == Tournament.RatingVisible.BEACHPLAY:
            return int(round((r1 + r2) / 2))
        return int(r1 + r2)

    return int(r1)


def get_entry_visible_rating(tournament: Tournament, entry) -> int:
    team = getattr(entry, "team", None)
    return get_team_visible_rating(tournament, team)

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass

from django.core.management.base import BaseCommand
from django.db.models import Count, Q

from apps.accounts.models import UserProfile
from apps.btr.models import BtrPlayer
from apps.matches.models import Match
from apps.players.models import Player, PlayerRatingDynamic, PlayerRatingHistory, SocialLink
from apps.teams.models import Team
from apps.tournaments.registration_models import PairInvitation, TournamentRegistration


def _norm(s: str) -> str:
    return (s or "").strip().lower()


@dataclass
class PlayerUsage:
    player_id: int
    has_btr: bool
    btr_id: int | None
    rating: int
    teams_count: int
    matches_count: int
    rating_hist_count: int
    rating_dyn_count: int
    registrations_count: int
    invitations_count: int
    user_profiles_count: int


class Command(BaseCommand):
    help = (
        "Найти потенциальные дубликаты игроков (обычно после импорта BTR). "
        "Группировка по ФИО (и опционально по дате рождения). "
        "Выводит сводку использования игрока (матчи/рейтинг/регистрация/связь с BTR)."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--by-birth-date",
            action="store_true",
            help="Учитывать дату рождения при группировке (ФИО+birth_date)",
        )
        parser.add_argument(
            "--only-with-btr",
            action="store_true",
            help="Показывать только группы, где хотя бы у одного игрока есть btr_player",
        )
        parser.add_argument(
            "--min-group-size",
            type=int,
            default=2,
            help="Минимальный размер группы (по умолчанию 2)",
        )
        parser.add_argument(
            "--limit-groups",
            type=int,
            default=None,
            help="Ограничить количество выводимых групп",
        )

    def handle(self, *args, **options):
        by_birth_date: bool = bool(options.get("by_birth_date"))
        only_with_btr: bool = bool(options.get("only_with_btr"))
        min_group_size: int = int(options.get("min_group_size") or 2)
        limit_groups = options.get("limit_groups")

        players = list(
            Player.objects.all().only(
                "id",
                "last_name",
                "first_name",
                "birth_date",
                "current_rating",
                "btr_player_id",
            )
        )

        groups: dict[tuple[str, str, str | None], list[Player]] = defaultdict(list)
        for p in players:
            key = (
                _norm(p.last_name),
                _norm(p.first_name),
                str(p.birth_date) if (by_birth_date and p.birth_date) else ("" if by_birth_date else None),
            )
            groups[key].append(p)

        dup_groups = [
            (k, ps)
            for k, ps in groups.items()
            if len(ps) >= min_group_size and k[0] and k[1]
        ]

        # optional filter
        if only_with_btr:
            dup_groups = [(k, ps) for k, ps in dup_groups if any(getattr(p, "btr_player_id", None) for p in ps)]

        dup_groups.sort(key=lambda x: (-len(x[1]), x[0][0], x[0][1]))
        if limit_groups:
            dup_groups = dup_groups[: int(limit_groups)]

        self.stdout.write(self.style.SUCCESS("=" * 100))
        self.stdout.write(self.style.SUCCESS("Поиск дубликатов игроков"))
        self.stdout.write(self.style.SUCCESS("=" * 100))
        self.stdout.write(f"Группировка: ФИО{' + birth_date' if by_birth_date else ''}")
        self.stdout.write(f"Найдено групп с дубликатами: {len(dup_groups)}")
        self.stdout.write("")

        if not dup_groups:
            self.stdout.write(self.style.SUCCESS("Готово"))
            return

        # Preload usage counts in batch
        player_ids = [p.id for _k, ps in dup_groups for p in ps]
        player_ids_set = set(player_ids)

        teams_by_player: dict[int, int] = defaultdict(int)
        for row in (
            Team.objects.filter(Q(player_1_id__in=player_ids_set) | Q(player_2_id__in=player_ids_set))
            .values("player_1_id", "player_2_id")
        ):
            p1 = row.get("player_1_id")
            p2 = row.get("player_2_id")
            if p1 in player_ids_set:
                teams_by_player[int(p1)] += 1
            if p2 in player_ids_set:
                teams_by_player[int(p2)] += 1

        matches_by_player: dict[int, int] = defaultdict(int)
        # count via teams -> matches
        team_ids = set(
            Team.objects.filter(Q(player_1_id__in=player_ids_set) | Q(player_2_id__in=player_ids_set)).values_list("id", flat=True)
        )
        if team_ids:
            # aggregate per team occurrence in matches
            match_qs = Match.objects.filter(
                Q(team_1_id__in=team_ids) | Q(team_2_id__in=team_ids) | Q(team_low_id__in=team_ids) | Q(team_high_id__in=team_ids) | Q(winner_id__in=team_ids)
            ).values("team_1_id", "team_2_id")
            team_to_players: dict[int, tuple[int, int | None]] = {
                t.id: (t.player_1_id, t.player_2_id) for t in Team.objects.filter(id__in=team_ids).only("id", "player_1_id", "player_2_id")
            }
            for row in match_qs:
                for tid in [row.get("team_1_id"), row.get("team_2_id")]:
                    if not tid:
                        continue
                    p1, p2 = team_to_players.get(int(tid), (None, None))
                    if p1 in player_ids_set:
                        matches_by_player[int(p1)] += 1
                    if p2 in player_ids_set:
                        matches_by_player[int(p2)] += 1

        rating_hist = dict(
            PlayerRatingHistory.objects.filter(player_id__in=player_ids_set)
            .values("player_id")
            .annotate(c=Count("id"))
            .values_list("player_id", "c")
        )
        rating_dyn = dict(
            PlayerRatingDynamic.objects.filter(player_id__in=player_ids_set)
            .values("player_id")
            .annotate(c=Count("id"))
            .values_list("player_id", "c")
        )
        registrations = dict(
            TournamentRegistration.objects.filter(Q(player_id__in=player_ids_set) | Q(partner_id__in=player_ids_set))
            .values("player_id")
            .annotate(c=Count("id"))
            .values_list("player_id", "c")
        )
        invitations = dict(
            PairInvitation.objects.filter(Q(sender_id__in=player_ids_set) | Q(receiver_id__in=player_ids_set))
            .values("sender_id")
            .annotate(c=Count("id"))
            .values_list("sender_id", "c")
        )
        user_profiles = dict(
            UserProfile.objects.filter(player_id__in=player_ids_set)
            .values("player_id")
            .annotate(c=Count("id"))
            .values_list("player_id", "c")
        )

        # Player.btr_player имеет related_name='linked_player', поэтому на стороне BtrPlayer это обратная связь
        # (btr_player.linked_player -> Player). На разных версиях Django/ORM может не быть *_id поля.
        btr_map = dict(
            BtrPlayer.objects.filter(linked_player__id__in=player_ids_set).values_list("linked_player", "id")
        )

        shown = 0
        for key, ps in dup_groups:
            ln, fn, bd = key
            title = f"{ln} {fn}".strip()
            if by_birth_date:
                title += f" ({bd or '-'})"

            self.stdout.write(self.style.SUCCESS(f"--- {title}  [count={len(ps)}]"))

            rows: list[PlayerUsage] = []
            for p in sorted(ps, key=lambda x: x.id):
                pid = int(p.id)
                has_btr = bool(getattr(p, "btr_player_id", None))
                rows.append(
                    PlayerUsage(
                        player_id=pid,
                        has_btr=has_btr,
                        btr_id=int(getattr(p, "btr_player_id", None) or (btr_map.get(pid) or 0)) or None,
                        rating=int(getattr(p, "current_rating", 0) or 0),
                        teams_count=int(teams_by_player.get(pid, 0)),
                        matches_count=int(matches_by_player.get(pid, 0)),
                        rating_hist_count=int(rating_hist.get(pid, 0)),
                        rating_dyn_count=int(rating_dyn.get(pid, 0)),
                        registrations_count=int(registrations.get(pid, 0)),
                        invitations_count=int(invitations.get(pid, 0)),
                        user_profiles_count=int(user_profiles.get(pid, 0)),
                    )
                )

            for r in rows:
                self.stdout.write(
                    "  "
                    f"player_id={r.player_id} "
                    f"btr={'Y' if r.has_btr else 'n'}(id={r.btr_id or '-'}) "
                    f"rating={r.rating} "
                    f"teams={r.teams_count} matches~={r.matches_count} "
                    f"hist={r.rating_hist_count} dyn={r.rating_dyn_count} "
                    f"regs={r.registrations_count} invites={r.invitations_count} profiles={r.user_profiles_count}"
                )

            self.stdout.write("")
            shown += 1

        self.stdout.write(self.style.SUCCESS(f"Готово. Выведено групп: {shown}"))

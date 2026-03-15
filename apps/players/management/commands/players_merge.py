from __future__ import annotations

from dataclasses import dataclass

from django.core.management.base import BaseCommand, CommandError
from django.db import IntegrityError, transaction
from django.db.models import Q

from apps.accounts.models import UserProfile
from apps.btr.models import BtrPlayer
from apps.matches.models import Match
from apps.players.models import Player, PlayerRatingDynamic, PlayerRatingHistory, SocialLink
from apps.teams.models import Team
from apps.tournaments.models import DrawPosition, TournamentEntry, TournamentPlacement
from apps.tournaments.registration_models import PairInvitation, TournamentRegistration


@dataclass
class MergeStats:
    teams_replaced: int = 0
    teams_deduped: int = 0
    matches_updated: int = 0
    entries_updated: int = 0
    registrations_updated: int = 0
    invitations_updated: int = 0
    profiles_updated: int = 0
    social_links_updated: int = 0
    rating_history_updated: int = 0
    rating_dynamic_updated: int = 0
    entries_deduped: int = 0
    registrations_deduped: int = 0
    rating_dynamic_deduped: int = 0


def _canonical_pair(a: int | None, b: int | None) -> tuple[int | None, int | None]:
    if a is None and b is None:
        return None, None
    if b is None:
        return int(a), None
    a_i = int(a) if a is not None else None
    b_i = int(b) if b is not None else None
    if a_i is None:
        return int(b_i), None
    if b_i is None:
        return int(a_i), None
    if a_i <= b_i:
        return a_i, b_i
    return b_i, a_i


class Command(BaseCommand):
    help = (
        "Слить одного игрока в другого (дедупликация), сохранив сыгранные матчи и историю рейтинга. "
        "Производит замену player_id во всех сущностях: Team, TournamentEntry, Match (через Team), "
        "TournamentRegistration/PairInvitation, UserProfile, SocialLink, PlayerRatingHistory/Dynamic. "
        "С опцией --dry-run только покажет план действий."
    )

    def add_arguments(self, parser):
        parser.add_argument("source_player_id", type=int, help="ID игрока-дубликата (будет удалён)")
        parser.add_argument("target_player_id", type=int, help="ID канонического игрока (останется)")
        parser.add_argument("--dry-run", action="store_true", help="Только показать изменения")
        parser.add_argument(
            "--prefer-btr-target",
            action="store_true",
            help="Если target без BTR, а source с BTR — перенести BTR связь на target",
        )
        parser.add_argument(
            "--delete-old-teams",
            action="store_true",
            help=(
                "После перелинковки удалить команды (teams.Team), в которых участвовал source игрок, "
                "если они были заменены на другие team_id. По умолчанию команды НЕ удаляются."
            ),
        )

    def _get_or_reuse_team(self, p1_id: int, p2_id: int | None) -> Team:
        a, b = _canonical_pair(p1_id, p2_id)
        if a is None:
            raise ValueError("team without players")
        obj, _ = Team.objects.get_or_create(player_1_id=a, player_2_id=b)
        return obj

    def _update_match_normalized(self, match: Match) -> None:
        t1 = match.team_1_id
        t2 = match.team_2_id
        if t1 and t2:
            low, high = sorted([int(t1), int(t2)])
            match.team_low_id = low
            match.team_high_id = high
        else:
            match.team_low_id = None
            match.team_high_id = None

    @transaction.atomic
    def handle(self, *args, **options):
        source_id: int = int(options["source_player_id"])
        target_id: int = int(options["target_player_id"])
        dry_run: bool = bool(options.get("dry_run"))
        prefer_btr_target: bool = bool(options.get("prefer_btr_target"))
        delete_old_teams: bool = bool(options.get("delete_old_teams"))

        if source_id == target_id:
            raise CommandError("source_player_id и target_player_id должны быть разными")

        try:
            src = Player.objects.select_for_update().get(id=source_id)
        except Player.DoesNotExist:
            raise CommandError(f"source игрок не найден: {source_id}")

        try:
            tgt = Player.objects.select_for_update().get(id=target_id)
        except Player.DoesNotExist:
            raise CommandError(f"target игрок не найден: {target_id}")

        self.stdout.write(self.style.SUCCESS("=" * 100))
        self.stdout.write(self.style.SUCCESS(f"Merge players: source={src.id} '{src}' -> target={tgt.id} '{tgt}'"))
        self.stdout.write(self.style.SUCCESS("=" * 100))

        if getattr(src, "btr_player_id", None) and getattr(tgt, "btr_player_id", None):
            if int(src.btr_player_id) != int(tgt.btr_player_id):
                raise CommandError(
                    f"Оба игрока связаны с разными BTR профилями: source.btr={src.btr_player_id}, target.btr={tgt.btr_player_id}"
                )

        if prefer_btr_target and (not getattr(tgt, "btr_player_id", None)) and getattr(src, "btr_player_id", None):
            self.stdout.write(
                self.style.WARNING(
                    f"BTR связь будет перенесена: target.btr_player = {src.btr_player_id}"
                )
            )
            if not dry_run:
                btr_obj = BtrPlayer.objects.get(id=int(src.btr_player_id))
                tgt.btr_player = btr_obj
                tgt.save(update_fields=["btr_player"])
                src.btr_player = None
                src.save(update_fields=["btr_player"])

        if (int(tgt.current_rating or 0) == 0) and (int(src.current_rating or 0) > 0):
            self.stdout.write(
                self.style.WARNING(
                    f"target.current_rating будет поднят: {tgt.current_rating} -> {src.current_rating}"
                )
            )
            if not dry_run:
                tgt.current_rating = int(src.current_rating or 0)
                tgt.save(update_fields=["current_rating"])

        stats = MergeStats()

        teams_qs = Team.objects.select_for_update().filter(Q(player_1_id=source_id) | Q(player_2_id=source_id))

        teams = list(teams_qs)
        self.stdout.write(f"Команд с source игроком: {len(teams)}")

        team_map: dict[int, int] = {}

        for team in teams:
            other = team.player_2_id if int(team.player_1_id) == source_id else team.player_1_id
            is_singles = team.player_2_id is None
            if is_singles:
                new_team = self._get_or_reuse_team(target_id, None)
            else:
                if other == source_id:
                    raise CommandError(f"Некорректная команда (оба игрока source): team_id={team.id}")
                if int(other) == target_id:
                    raise CommandError(
                        f"Нельзя смержить: существует команда source+target, после слияния получится пара с одинаковыми игроками: team_id={team.id}"
                    )
                new_team = self._get_or_reuse_team(target_id, int(other))

            if int(new_team.id) != int(team.id):
                team_map[int(team.id)] = int(new_team.id)
                stats.teams_replaced += 1

        if team_map:
            self.stdout.write(f"Команд к замене: {len(team_map)}")

        def _bulk_update_team_fk(model_qs, field: str) -> int:
            updated_total = 0
            for old_team_id, new_team_id in team_map.items():
                qs = model_qs.filter(**{f"{field}_id": old_team_id})
                cnt = qs.count()
                if cnt:
                    updated_total += cnt
                    if not dry_run:
                        qs.update(**{f"{field}_id": new_team_id})
            return updated_total

        if team_map:
            # TournamentEntry может сколлапсировать по unique_entry_team_in_tournament.
            # Поэтому обновляем по-турнирно с дедупликацией.
            affected_tournament_ids = list(
                TournamentEntry.objects.filter(team_id__in=list(team_map.keys())).values_list("tournament_id", flat=True).distinct()
            )
            for tid in affected_tournament_ids:
                entries = list(
                    TournamentEntry.objects.select_for_update().filter(tournament_id=tid, team_id__in=list(team_map.keys()))
                )
                for e in entries:
                    new_team_id = team_map.get(int(e.team_id))
                    if not new_team_id:
                        continue

                    # Если в этом турнире уже есть entry на new_team_id — дедуп.
                    existing = TournamentEntry.objects.select_for_update().filter(
                        tournament_id=tid, team_id=new_team_id
                    ).first()
                    if existing and int(existing.id) != int(e.id):
                        stats.entries_deduped += 1
                        stats.entries_updated += 1
                        self.stdout.write(
                            self.style.WARNING(
                                f"TournamentEntry collision: tournament_id={tid} old_entry={e.id} -> keep_entry={existing.id} (team_id={new_team_id})"
                            )
                        )
                        if not dry_run:
                            # Обновим ссылки на entry
                            DrawPosition.objects.filter(entry_id=e.id).update(entry_id=existing.id)
                            TournamentPlacement.objects.filter(entry_id=e.id).update(entry_id=existing.id)
                            # Турнирная статистика (OneToOne) удалится каскадом при удалении entry
                            e.delete()
                        continue

                    # Без коллизий — можно апдейтнуть
                    if not dry_run:
                        TournamentEntry.objects.filter(id=e.id).update(team_id=new_team_id)
                    stats.entries_updated += 1

            # Matches
            stats.matches_updated += _bulk_update_team_fk(Match.objects.select_for_update(), "team_1")
            stats.matches_updated += _bulk_update_team_fk(Match.objects.select_for_update(), "team_2")
            stats.matches_updated += _bulk_update_team_fk(Match.objects.select_for_update(), "team_low")
            stats.matches_updated += _bulk_update_team_fk(Match.objects.select_for_update(), "team_high")
            stats.matches_updated += _bulk_update_team_fk(Match.objects.select_for_update(), "winner")

            # Registrations
            stats.registrations_updated += _bulk_update_team_fk(TournamentRegistration.objects.select_for_update(), "team")

            # Normalize match low/high
            affected_matches = Match.objects.select_for_update().filter(
                Q(team_1_id__in=list(team_map.keys()))
                | Q(team_2_id__in=list(team_map.keys()))
                | Q(team_low_id__in=list(team_map.keys()))
                | Q(team_high_id__in=list(team_map.keys()))
                | Q(winner_id__in=list(team_map.keys()))
                | Q(team_1_id__in=list(team_map.values()))
                | Q(team_2_id__in=list(team_map.values()))
            )
            if affected_matches.exists():
                self.stdout.write(f"Матчей для нормализации team_low/team_high: {affected_matches.count()}")
                if not dry_run:
                    for m in affected_matches:
                        self._update_match_normalized(m)
                        m.save(update_fields=["team_low", "team_high"])

        # Update direct FKs to player
        def _bulk_update_player_fk(model_qs, field: str) -> int:
            qs = model_qs.filter(**{f"{field}_id": source_id})
            cnt = qs.count()
            if cnt and not dry_run:
                qs.update(**{f"{field}_id": target_id})
            return cnt

        stats.social_links_updated = _bulk_update_player_fk(SocialLink.objects.select_for_update(), "player")
        stats.rating_history_updated = _bulk_update_player_fk(PlayerRatingHistory.objects.select_for_update(), "player")
        # PlayerRatingDynamic имеет uniq_player_tournament_dynamic.
        # Если у target уже есть запись по тому же tournament_id, удалим source запись.
        dyn_qs = PlayerRatingDynamic.objects.select_for_update().filter(player_id=source_id)
        for dyn in list(dyn_qs):
            if PlayerRatingDynamic.objects.filter(player_id=target_id, tournament_id=dyn.tournament_id).exists():
                stats.rating_dynamic_deduped += 1
                if not dry_run:
                    dyn.delete()
            else:
                stats.rating_dynamic_updated += 1
                if not dry_run:
                    dyn.player_id = target_id
                    dyn.save(update_fields=["player"])
        stats.profiles_updated = _bulk_update_player_fk(UserProfile.objects.select_for_update(), "player")

        # TournamentRegistration: unique_player_registration_per_tournament (tournament, player)
        reg_qs = TournamentRegistration.objects.select_for_update().filter(player_id=source_id)
        for reg in list(reg_qs):
            if TournamentRegistration.objects.filter(tournament_id=reg.tournament_id, player_id=target_id).exists():
                stats.registrations_deduped += 1
                if not dry_run:
                    reg.delete()
            else:
                stats.registrations_updated += 1
                if not dry_run:
                    reg.player_id = target_id
                    reg.save(update_fields=["player"])

        # partner замена коллизии не имеет уникального ограничения, но защита от partner==player валидацией.
        # Если partner указывает на target и player станет target — получится self-partner, удалим запись.
        reg_partner_qs = TournamentRegistration.objects.select_for_update().filter(partner_id=source_id)
        for reg in list(reg_partner_qs):
            next_partner = target_id
            if int(reg.player_id) == int(next_partner):
                stats.registrations_deduped += 1
                if not dry_run:
                    reg.delete()
            else:
                stats.registrations_updated += 1
                if not dry_run:
                    reg.partner_id = next_partner
                    reg.save(update_fields=["partner"])

        stats.invitations_updated += _bulk_update_player_fk(PairInvitation.objects.select_for_update(), "sender")
        stats.invitations_updated += _bulk_update_player_fk(PairInvitation.objects.select_for_update(), "receiver")

        # Cleanup / delete old teams if fully replaced
        if delete_old_teams and team_map and not dry_run:
            for old_team_id in team_map.keys():
                try:
                    Team.objects.filter(id=old_team_id).delete()
                    stats.teams_deduped += 1
                except Exception:
                    # Если команда всё ещё где-то используется, просто пропустим
                    pass

        self.stdout.write(self.style.SUCCESS("\nСводка:"))
        self.stdout.write(f"  teams_replaced={stats.teams_replaced} teams_deleted={stats.teams_deduped}")
        self.stdout.write(f"  entries_updated={stats.entries_updated}")
        self.stdout.write(f"  matches_updated={stats.matches_updated}")
        self.stdout.write(f"  registrations_updated={stats.registrations_updated}")
        self.stdout.write(f"  invitations_updated={stats.invitations_updated}")
        self.stdout.write(f"  profiles_updated={stats.profiles_updated}")
        self.stdout.write(f"  social_links_updated={stats.social_links_updated}")
        self.stdout.write(f"  rating_history_updated={stats.rating_history_updated}")
        self.stdout.write(f"  rating_dynamic_updated={stats.rating_dynamic_updated}")
        self.stdout.write(f"  entries_deduped={stats.entries_deduped}")
        self.stdout.write(f"  registrations_deduped={stats.registrations_deduped}")
        self.stdout.write(f"  rating_dynamic_deduped={stats.rating_dynamic_deduped}")

        if dry_run:
            self.stdout.write(self.style.WARNING("\nDRY-RUN: изменений в БД не делали"))
            return

        # Finally delete source player
        try:
            Player.objects.filter(id=source_id).delete()
        except IntegrityError as e:
            raise CommandError(f"Не удалось удалить source игрока из-за связей: {e}")

        self.stdout.write(self.style.SUCCESS("\nГотово: игрок слит и source удалён"))

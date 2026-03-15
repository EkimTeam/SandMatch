from __future__ import annotations

from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from apps.tournaments.models import Tournament


class Command(BaseCommand):
    help = (
        "Откатить завершение турнира (включая multi-stage). "
        "Эквивалентно API /tournaments/<id>/rollback_complete/, но как management command."
    )

    def add_arguments(self, parser):
        parser.add_argument("tournament_id", type=int, help="ID турнира (мастер или стадия)")
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Только показать, что будет сделано (без изменений)",
        )

    @transaction.atomic
    def handle(self, *args, **options):
        tournament_id: int = int(options["tournament_id"])
        dry_run: bool = bool(options.get("dry_run"))

        try:
            t = Tournament.objects.select_for_update().get(id=tournament_id)
        except Tournament.DoesNotExist:
            raise CommandError(f"Турнир id={tournament_id} не найден")

        if t.status != Tournament.Status.COMPLETED:
            raise CommandError("Откат возможен только для турнира в статусе COMPLETED")

        from apps.players.models import Player, PlayerRatingDynamic, PlayerRatingHistory

        # Определяем master и стадии
        master = t if t.is_master() else t.get_master_tournament()
        all_stages = master.get_all_stages()
        stage_ids = [s.id for s in all_stages]

        self.stdout.write(self.style.SUCCESS("=" * 100))
        self.stdout.write(self.style.SUCCESS(f"Rollback complete: tournament_id={t.id} master_id={master.id} stages={stage_ids}"))
        self.stdout.write(self.style.SUCCESS("=" * 100))

        dyn_qs = PlayerRatingDynamic.objects.select_for_update().filter(tournament_id=master.id)
        changes = list(dyn_qs.values("player_id", "total_change"))

        self.stdout.write(f"PlayerRatingDynamic master rows: {len(changes)}")
        affected_players = {int(row["player_id"]) for row in changes if row.get("player_id")}
        self.stdout.write(f"Affected players: {len(affected_players)}")

        # откат рейтингов
        for row in changes:
            pid = int(row["player_id"])
            delta = int(round(row.get("total_change") or 0))
            if delta == 0:
                continue
            p = Player.objects.select_for_update().get(id=pid)
            before = int(p.current_rating or 0)
            after = before - delta
            if after < 0:
                after = 0
            if dry_run:
                self.stdout.write(f"DRY-RUN: Player {pid}: {before} -> {after} (delta -{delta})")
            else:
                p.current_rating = after
                p.save(update_fields=["current_rating"])

        hist_qs = PlayerRatingHistory.objects.filter(tournament_id__in=stage_ids)
        self.stdout.write(f"PlayerRatingHistory rows to delete (stages): {hist_qs.count()}")
        self.stdout.write(f"PlayerRatingDynamic rows to delete (master): {dyn_qs.count()}")

        if not dry_run:
            hist_qs.delete()
            dyn_qs.delete()

            # placements
            try:
                from apps.tournaments.models import TournamentPlacement

                TournamentPlacement.objects.filter(tournament_id__in=stage_ids).delete()
            except Exception:
                pass

            # status back to active
            for stage in all_stages:
                stage.status = Tournament.Status.ACTIVE
                stage.save(update_fields=["status"])

        self.stdout.write(self.style.SUCCESS("Готово" if not dry_run else "DRY-RUN завершён"))

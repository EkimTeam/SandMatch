from __future__ import annotations
from typing import Dict, List, Optional
from django.core.management.base import BaseCommand, CommandParser

from apps.players.services.rating_service import RecomputeOptions, recompute_history


class Command(BaseCommand):
    help = "Полный пересчёт рейтинга: период/турниры, стартовые рейтинги, wipe/no-wipe."

    def add_arguments(self, parser: CommandParser) -> None:
        parser.add_argument('--from-date', type=str, default=None, help="Начальная дата (YYYY-MM-DD)")
        parser.add_argument('--to-date', type=str, default=None, help="Конечная дата (YYYY-MM-DD)")
        parser.add_argument('--tournaments', type=str, default=None, help="Список ID турниров через запятую")
        parser.add_argument('--start-rating', type=float, default=1000.0, help="Глобальный стартовый рейтинг")
        parser.add_argument('--start-player', action='append', default=[], help="Индивидуальный старт игрока: <player_id>=<rating>, можно указывать несколько раз")
        parser.add_argument('--wipe-history', action='store_true', help="Очистить историю перед пересчётом")

    def handle(self, *args, **options):
        from_date = options.get('from_date')
        to_date = options.get('to_date')
        tournaments_opt = options.get('tournaments')
        start_rating = float(options.get('start_rating') or 1000.0)
        start_player_opts: List[str] = options.get('start_player') or []
        wipe_history = bool(options.get('wipe_history'))

        tournaments: Optional[List[int]] = None
        if tournaments_opt:
            tournaments = [int(x) for x in tournaments_opt.split(',') if x.strip().isdigit()]

        start_ratings_per_player: Dict[int, float] = {}
        for item in start_player_opts:
            try:
                pid_str, val_str = str(item).split('=', 1)
                pid = int(pid_str.strip())
                val = float(val_str.strip())
                start_ratings_per_player[pid] = val
            except Exception:
                self.stderr.write(self.style.WARNING(f"Игнорирую некорректный --start-player: {item}"))

        opts = RecomputeOptions(
            from_date=from_date,
            to_date=to_date,
            tournaments=tournaments,
            start_rating=start_rating,
            start_ratings_per_player=start_ratings_per_player or None,
            wipe_history=wipe_history,
        )

        self.stdout.write(self.style.NOTICE("Запускаю пересчёт рейтинга..."))
        recompute_history(opts)
        self.stdout.write(self.style.SUCCESS("Готово: пересчёт завершён."))

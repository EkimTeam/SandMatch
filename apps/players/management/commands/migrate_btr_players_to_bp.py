from django.core.management.base import BaseCommand
from django.db import transaction

from apps.btr.models import BtrPlayer
from apps.players.models import Player


class Command(BaseCommand):
    help = (
        "Создаёт отсутствующих BP-игроков для всех BTR-игроков и связывает "
        "их через поле Player.btr_player. Новым BP-игрокам выставляется "
        "current_rating = 0 и display_name = first_name."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Только показать, какие игроки будут созданы, без записи в БД",
        )
        parser.add_argument(
            "--limit",
            type=int,
            default=None,
            help=(
                "Ограничить количество BTR-игроков для миграции. "
                "По умолчанию мигрируются все отсутствующие."
            ),
        )

    def handle(self, *args, **options):
        dry_run = options.get("dry_run", False)
        limit = options.get("limit")

        self.stdout.write(self.style.SUCCESS("=" * 80))
        self.stdout.write(self.style.SUCCESS("Миграция игроков BTR -> BP"))
        self.stdout.write(self.style.SUCCESS("=" * 80))
        self.stdout.write("")

        # 1. Все уникальные BTR-игроки (id_из_btr)
        all_btr_ids = set(BtrPlayer.objects.values_list("id", flat=True))
        total_btr = len(all_btr_ids)
        self.stdout.write(f"Всего BTR-игроков: {total_btr}")

        if total_btr == 0:
            self.stdout.write(self.style.WARNING("BTR-игроки не найдены, делать нечего"))
            return

        # 2. Все id из players_player.btr_player_id (id_btr_из_bp)
        linked_btr_ids = set(
            Player.objects.filter(btr_player__isnull=False).values_list("btr_player_id", flat=True)
        )
        self.stdout.write(f"BTR-игроков уже связанных с BP: {len(linked_btr_ids)}")

        # 3. Убрать уже связанные: получим id_нужные_btr
        missing_btr_ids = sorted(all_btr_ids - linked_btr_ids)
        missing_count_total = len(missing_btr_ids)
        self.stdout.write(
            self.style.WARNING(
                f"BTR-игроков без BP-профиля (всего): {missing_count_total}"
            )
        )

        if missing_count_total == 0:
            self.stdout.write(self.style.SUCCESS("Все BTR-игроки уже имеют BP-профиль"))
            return

        # Применяем лимит, если он задан
        if limit is not None and limit > 0:
            limited_btr_ids = missing_btr_ids[:limit]
        else:
            limited_btr_ids = missing_btr_ids

        to_process_count = len(limited_btr_ids)
        self.stdout.write(
            self.style.WARNING(
                f"BTR-игроков, запланированных к миграции с учётом limit: {to_process_count}"
            )
        )

        if to_process_count == 0:
            self.stdout.write(
                self.style.WARNING(
                    "После применения limit нет игроков для миграции (ничего делать не будем)"
                )
            )
            return

        # Для информативности покажем первые несколько кандидатов
        preview_limit = 20
        btr_preview_qs = (
            BtrPlayer.objects.filter(id__in=limited_btr_ids)
            .order_by("id")[:preview_limit]
        )

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Примеры игроков, для которых будет создан BP-профиль:"))
        for bp in btr_preview_qs:
            self.stdout.write(
                f"  - BTR id={bp.id} external_id={bp.external_id}: "
                f"{bp.last_name} {bp.first_name} (город: {bp.city or '-'}, пол: {bp.gender or '-'})"
            )

        if dry_run:
            self.stdout.write("")
            self.stdout.write(self.style.WARNING("[DRY RUN] Создание BP-игроков НЕ будет выполнено"))
            self.stdout.write(
                self.style.WARNING(
                    f"Будет создано BP-игроков: {to_process_count} (при реальном запуске)"
                )
            )
            return

        created_count = 0

        self.stdout.write("")
        self.stdout.write("Создание BP-игроков...")

        with transaction.atomic():
            for btr_id in limited_btr_ids:
                btr_player = BtrPlayer.objects.get(id=btr_id)

                # Создаём нового BP-игрока по данным из BTR:
                # - Имя / фамилия / город / gender
                # - btr_player_id указывает на исходного BtrPlayer
                # - current_rating = 0
                # - display_name = first_name
                player = Player(
                    first_name=btr_player.first_name or "",
                    last_name=btr_player.last_name or "",
                    patronymic=None,
                    city=btr_player.city or "",
                    gender=btr_player.gender,
                    current_rating=0,
                    display_name=btr_player.first_name or "",
                    btr_player=btr_player,
                )
                player.save()
                created_count += 1

        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS("Готово"))
        self.stdout.write(
            self.style.SUCCESS(
                f"Создано новых BP-игроков и связанных с BTR-профилем: {created_count}"
            )
        )
        self.stdout.write(self.style.SUCCESS("=" * 80))

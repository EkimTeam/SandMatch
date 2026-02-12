from __future__ import annotations

from datetime import date, time
from typing import Iterable, Optional

from django.db import transaction

from apps.tournaments.models import Tournament, TournamentEntry


class MultiStageService:
    """Сервисы для работы с многостадийными турнирами.

    ВАЖНО: все публичные методы либо атомарные (transaction.atomic), либо
    только читают данные.
    """

    @staticmethod
    @transaction.atomic
    def create_next_stage(
        parent_tournament_id: int,
        stage_name: str,
        system: str,
        participant_mode: str,
        groups_count: int = 1,
        copy_participants: bool = True,
        selected_participant_ids: Optional[Iterable[int]] = None,
        created_by_user=None,
        participants_count: Optional[int] = None,
        date_value: Optional[date] = None,
        start_time: Optional[time] = None,
        is_rating_calc: Optional[bool] = None,
        set_format_id: Optional[int] = None,
    ) -> Tournament:
        """Создает новую стадию турнира.

        Args:
            parent_tournament_id: ID родительского турнира (мастер или предыдущая стадия)
            stage_name: Название стадии ("Предварительная", "Плей-офф" и т.п.)
            system: Система турнира ('round_robin', 'knockout', 'king')
            participant_mode: Режим участников ('singles', 'doubles')
            groups_count: Количество групп (для round_robin)
            copy_participants: Копировать всех участников из parent
            selected_participant_ids: Явный список team_id для копирования
            created_by_user: Пользователь-создатель (иначе берем из мастера)

        Raises:
            ValueError: Если нарушены правила создания стадий
        """

        parent = Tournament.objects.select_related("parent_tournament", "venue", "set_format", "ruleset").get(id=parent_tournament_id)
        master = parent.get_master_tournament()

        # Валидация системы турнира для новой стадии
        master.validate_stage_system(system)

        # Валидация количества участников
        parent_count = parent.planned_participants or 0
        if participants_count is not None and parent_count > 0 and participants_count > parent_count:
            raise ValueError(
                f"Количество участников стадии ({participants_count}) не может превышать "
                f"planned_participants родительского турнира ({parent_count})"
            )

        # Определяем порядковый номер новой стадии: 0 - мастер, далее 1, 2, 3...
        all_stages = master.get_all_stages()
        next_order = len(all_stages)

        # Полное имя стадии: "{мастер} - {стадия}"
        full_name = f"{master.name} - {stage_name}" if stage_name else master.name

        # Для олимпийки всегда одна группа
        if system == Tournament.System.KNOCKOUT:
            groups_count = 1

        # Создаем новую стадию, часть полей копируем от мастера
        new_stage = Tournament.objects.create(
            name=full_name,
            parent_tournament=master,
            stage_name=stage_name or "",
            stage_order=next_order,
            system=system,
            participant_mode=participant_mode,
            groups_count=groups_count,
            date=date_value or master.date,
            start_time=start_time if start_time is not None else master.start_time,
            is_rating_calc=is_rating_calc if is_rating_calc is not None else master.is_rating_calc,
            prize_fund=master.prize_fund,
            ruleset=master.ruleset,
            set_format_id=set_format_id or master.set_format_id,
            planned_participants=participants_count if participants_count is not None else master.planned_participants,
            rating_coefficient=master.rating_coefficient,
            venue=master.venue,
            created_by=created_by_user or master.created_by,
            status=Tournament.Status.CREATED,
        )

        # Копируем участников
        if copy_participants:
            entries = TournamentEntry.objects.filter(tournament=parent).select_related("team")
            TournamentEntry.objects.bulk_create(
                [
                    TournamentEntry(
                        tournament=new_stage,
                        team=entry.team,
                        is_out_of_competition=entry.is_out_of_competition,
                        group_index=None,
                        row_index=None,
                    )
                    for entry in entries
                ]
            )
        elif selected_participant_ids:
            TournamentEntry.objects.bulk_create(
                [
                    TournamentEntry(
                        tournament=new_stage,
                        team_id=team_id,
                        is_out_of_competition=False,
                        group_index=None,
                        row_index=None,
                    )
                    for team_id in selected_participant_ids
                ]
            )

        return new_stage

    @staticmethod
    def get_master_tournament_data(tournament_id: int) -> dict:
        """Возвращает данные мастер-турнира со всеми стадиями.

        Формат возвращаемого словаря согласован с планом в
        docs/MULTI_STAGE_TOURNAMENTS_PLAN.md.
        """

        tournament = Tournament.objects.select_related("parent_tournament").get(id=tournament_id)
        master = tournament.get_master_tournament()
        stages = master.get_all_stages()

        return {
            "master": {
                "id": master.id,
                "name": master.name,
                "date": str(master.date) if master.date else "",
                "status": master.status,
                "system": master.system,
                "is_rating_calc": master.is_rating_calc,
                "prize_fund": master.prize_fund or "",
            },
            "stages": [
                {
                    "id": stage.id,
                    "stage_name": stage.stage_name or "Основная стадия",
                    "stage_order": stage.get_stage_number(),
                    "system": stage.system,
                    "participant_mode": stage.participant_mode,
                    "groups_count": stage.groups_count,
                    "status": stage.status,
                    "participants_count": stage.entries.count(),
                    "matches_count": stage.matches.count() if hasattr(stage, "matches") else 0,
                    "is_current": stage.id == tournament_id,
                    "can_delete": stage.can_delete_stage(),
                    "can_edit": stage.can_edit_stage_settings(),
                }
                for stage in stages
            ],
            "current_stage_id": tournament_id,
            "can_add_stage": True,
        }

    @staticmethod
    @transaction.atomic
    def delete_stage(stage_id: int) -> None:
        """Удаляет стадию турнира, если это разрешено правилами.

        Raises:
            ValueError: Если стадию нельзя удалить.
        """

        stage = Tournament.objects.get(id=stage_id)

        if not stage.can_delete_stage():
            raise ValueError("Можно удалить только последнюю стадию в статусе CREATED")

        stage.delete()

    @staticmethod
    @transaction.atomic
    def update_stage_settings(
        stage_id: int,
        system: Optional[str] = None,
        groups_count: Optional[int] = None,
        participant_mode: Optional[str] = None,
    ) -> Tournament:
        """Обновляет настройки стадии (только для CREATED).

        Может менять: систему турнира, количество групп (кроме knockout),
        режим участников.
        """

        stage = Tournament.objects.get(id=stage_id)

        if not stage.can_edit_stage_settings():
            raise ValueError("Можно редактировать только стадию в статусе CREATED")

        if system:
            # Валидация системы через мастер-турнир
            stage.get_master_tournament().validate_stage_system(system)
            stage.system = system

            # Для олимпийки всегда одна группа
            if system == Tournament.System.KNOCKOUT:
                stage.groups_count = 1

        if groups_count is not None and stage.system != Tournament.System.KNOCKOUT:
            stage.groups_count = groups_count

        if participant_mode:
            stage.participant_mode = participant_mode

        stage.save(update_fields=[
            "system",
            "groups_count",
            "participant_mode",
        ])

        return stage

    @staticmethod
    @transaction.atomic
    def complete_master_tournament(master_tournament_id: int, force: bool = False) -> None:
        """Завершает мастер-турнир и считает рейтинг по всем стадиям.

        Если force=False, проверяет наличие незавершенных матчей во всех стадиях.
        Если force=True, завершает все стадии независимо от статуса матчей.
        """
        from apps.matches.models import Match

        master = Tournament.objects.get(id=master_tournament_id)
        if not master.is_master():
            master = master.get_master_tournament()

        all_stages = master.get_all_stages()

        # Если force=False, проверяем незавершенные матчи
        if not force:
            incomplete_matches = []
            for stage in all_stages:
                matches = Match.objects.filter(tournament=stage).exclude(status='cancelled')
                for match in matches:
                    has_winner = match.winner_id is not None
                    has_score = match.sets.exists()
                    if not has_winner and not has_score:
                        incomplete_matches.append(match)
            
            if incomplete_matches:
                raise ValueError(f"Пока ещё не все матчи в турнире сыграны. Вы всё равно хотите завершить турнир?")

        # Расчёт рейтинга для многостадийного турнира
        try:
            from apps.players.services.rating_service import compute_ratings_for_multi_stage_tournament
        except ImportError:
            compute_ratings_for_multi_stage_tournament = None

        if compute_ratings_for_multi_stage_tournament is not None:
            stage_ids = [s.id for s in all_stages]
            compute_ratings_for_multi_stage_tournament(master.id, stage_ids)

        # Помечаем все стадии как завершенные
        for stage in all_stages:
            if stage.status != Tournament.Status.COMPLETED:
                stage.status = Tournament.Status.COMPLETED
                stage.save(update_fields=["status"])

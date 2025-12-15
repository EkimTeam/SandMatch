from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.exceptions import PermissionDenied
from apps.accounts.permissions import (
    IsAdminOrReadOnly,
    IsAdmin,
    IsAuthenticatedAndRoleIn,
    IsTournamentCreatorOrAdmin,
    IsTournamentCreatorOrAdminForDeletion,
    IsRefereeForTournament,
    Role,
    _get_user_role,
)
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from django.db import transaction
from typing import Optional
from rest_framework_simplejwt.authentication import JWTAuthentication

from .models import Tournament, TournamentEntry, SetFormat, Ruleset, KnockoutBracket, DrawPosition, SchedulePattern
from apps.players.services import rating_service
from apps.teams.models import Team
from apps.matches.models import Match, MatchSet
from apps.players.models import Player, PlayerRatingDynamic
from .serializers import (
    TournamentSerializer,
    ParticipantSerializer,
    MatchSerializer,
    PlayerSerializer,
    SchedulePatternSerializer,
)
from apps.tournaments.services.knockout import (
    validate_bracket_size,
    calculate_rounds_structure,
    generate_initial_matches,
    seed_participants,
    advance_winner,
)
from apps.tournaments.services.round_robin import (
    generate_matches_for_group,
    persist_generated_matches,
    generate_round_robin_matches,
)


@method_decorator(csrf_exempt, name='dispatch')
class TournamentViewSet(viewsets.ModelViewSet):
    queryset = Tournament.objects.all().order_by("-created_at")
    serializer_class = TournamentSerializer
    # Просмотр турниров доступен всем, но completed требуют аутентификации
    permission_classes = [AllowAny]
    authentication_classes = [JWTAuthentication]

    def get_permissions(self):
        if self.action == "create":
            return [IsAuthenticatedAndRoleIn(Role.ADMIN, Role.ORGANIZER)]

        if self.action in {
            "update",
            "partial_update",
            "set_ruleset",
            "set_participant",
            "save_participants",
            "create_knockout_bracket",
            "seed_bracket",
            "lock_participants",
            "unlock_participants",
            "complete",
        }:
            return [IsTournamentCreatorOrAdmin()]

        if self.action in {"destroy", "remove"}:
            return [IsTournamentCreatorOrAdminForDeletion()]

        if self.action in {
            "match_start",
            "match_save_score_full",
            "match_cancel",
            "match_delete_score",
            "match_reset",
        }:
            return [IsAuthenticated()]

        return super().get_permissions()

    def perform_create(self, serializer):
        user = self.request.user if getattr(self.request, "user", None) and self.request.user.is_authenticated else None
        serializer.save(created_by=user)

    def _ensure_can_view_tournament(self, request, tournament: Tournament) -> None:
        """Ограничение просмотра турнира для гостей.

        - ANONYMOUS: может смотреть турниры в статусах CREATED/ACTIVE,
          а также завершённые турниры круговой и олимпийской систем.
          Завершённые турниры Кинг доступны только аутентифицированным пользователям.
        - Аутентифицированные пользователи (REGISTERED и выше): без ограничений,
          кроме черновиков для роли REGISTERED.
        """

        user = getattr(request, "user", None)
        if not user or not user.is_authenticated:
            # Гостям разрешаем смотреть завершённые турниры круговой и олимпийской систем,
            # но завершённые турниры Кинг по-прежнему требуют аутентификации.
            if (
                tournament.status == Tournament.Status.COMPLETED
                and tournament.system == Tournament.System.KING
            ):
                raise PermissionDenied("Authentication required to view completed King tournaments")
            return

        # Аутентифицированный пользователь
        role = _get_user_role(user)
        # REGISTERED-пользователь не должен видеть черновики турниров
        if role == Role.REGISTERED and tournament.status == Tournament.Status.CREATED:
            raise PermissionDenied("Authentication required to view this tournament")

    def retrieve(self, request, *args, **kwargs):
        tournament = self.get_object()
        self._ensure_can_view_tournament(request, tournament)
        serializer = self.get_serializer(tournament)
        return Response(serializer.data)

    def _ensure_can_manage_match(self, request, tournament: Tournament) -> None:
        """Проверка права на матчевые действия.

        Разрешено, если пользователь:
        - создатель турнира / ADMIN / staff/superuser (IsTournamentCreatorOrAdmin);
        - или назначенный рефери турнира (IsRefereeForTournament).
        """

        user = request.user
        if not user or not user.is_authenticated:
            raise PermissionDenied("Authentication required")

        # ADMIN / staff / creator
        creator_perm = IsTournamentCreatorOrAdmin()
        if creator_perm.has_object_permission(request, self, tournament):
            return

        # REFEREE для этого турнира
        referee_perm = IsRefereeForTournament()
        if referee_perm.has_object_permission(request, self, tournament):
            return

        raise PermissionDenied("You do not have permission to manage matches for this tournament")

    def destroy(self, request, *args, **kwargs):
        """Переопределяем стандартное удаление для корректной обработки олимпийских турниров."""
        tournament = self.get_object()
        
        # Правильный порядок удаления для олимпийских турниров:
        # 1. tournaments_drawposition
        # 2. tournaments_tournamententry
        # 3. matches_matchset
        # 4. players_playerratinghistory
        # 5. matches_matchspecialoutcome
        # 6. matches_match
        # 7. tournaments_knockoutbracket
        # 8. tournaments_tournament
        if tournament.system == Tournament.System.KNOCKOUT:
            from apps.tournaments.models import DrawPosition
            from apps.players.models import PlayerRatingHistory
            from apps.matches.models import MatchSpecialOutcome
            from django.db import transaction
            
            with transaction.atomic():
                # 1. Удаляем позиции в сетках
                DrawPosition.objects.filter(bracket__tournament=tournament).delete()
                
                # 2. Удаляем участников турнира
                TournamentEntry.objects.filter(tournament=tournament).delete()
                
                # 3. Удаляем сеты матчей
                MatchSet.objects.filter(match__tournament=tournament).delete()
                
                # 4. Удаляем историю рейтингов игроков
                PlayerRatingHistory.objects.filter(match__tournament=tournament).delete()
                
                # 5. Удаляем специальные исходы матчей
                MatchSpecialOutcome.objects.filter(match__tournament=tournament).delete()
                
                # 6. Удаляем матчи
                Match.objects.filter(tournament=tournament).delete()
                
                # 7. Удаляем сетки
                tournament.knockout_brackets.all().delete()
                
                # 8. Удаляем турнир
                tournament.delete()
        else:
            # Для круговых турниров стандартное каскадное удаление работает
            tournament.delete()
        
        return Response(status=status.HTTP_204_NO_CONTENT)

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="edit_settings", permission_classes=[IsAuthenticated])
    def edit_settings(self, request, pk=None):
        """Изменить базовые настройки турнира в статусе CREATED.

        Позволяет организатору скорректировать параметры турнира до старта:
        - name, date
        - system (round_robin / knockout)
        - set_format, ruleset
        - groups_count, planned_participants
        - is_rating_calc, prize_fund

        При смене системы:
        - round_robin: обнуляем позиции всех участников (group_index=row_index=None)
        - knockout: всем участникам выставляем group_index=1 и row_index=1..N по возрастанию id
        """

        tournament: Tournament = self.get_object()

        # Разрешаем редактирование только для черновиков
        if tournament.status != Tournament.Status.CREATED:
            return Response({"ok": False, "error": "Настройки можно изменять только для турниров в статусе CREATED"}, status=400)

        # Проверка прав организатора/админа уже выполняется через get_permissions (update/partial_update)

        data = request.data or {}

        # Обновляем базовые поля
        name = data.get("name")
        if isinstance(name, str) and name.strip():
            tournament.name = name.strip()

        from datetime import date as _date
        date_raw = data.get("date")
        if isinstance(date_raw, str) and date_raw:
            try:
                tournament.date = _date.fromisoformat(date_raw)
            except Exception:
                return Response({"ok": False, "error": "Некорректная дата"}, status=400)

        # Система проведения: round_robin/knockout/king
        system = data.get("system") or tournament.system
        if system not in {Tournament.System.ROUND_ROBIN, Tournament.System.KNOCKOUT, Tournament.System.KING}:
            return Response({"ok": False, "error": "Недопустимая система турнира"}, status=400)

        # Формат и регламент
        set_format_id = data.get("set_format_id")
        ruleset_id = data.get("ruleset_id")

        if set_format_id:
            try:
                sf = SetFormat.objects.get(pk=int(set_format_id))
                tournament.set_format = sf
            except (SetFormat.DoesNotExist, ValueError, TypeError):
                return Response({"ok": False, "error": "Формат сетов не найден"}, status=400)

        if ruleset_id:
            try:
                rs = Ruleset.objects.get(pk=int(ruleset_id))
                tournament.ruleset = rs
            except (Ruleset.DoesNotExist, ValueError, TypeError):
                return Response({"ok": False, "error": "Регламент не найден"}, status=400)

        # Количество групп и участников
        groups_count = data.get("groups_count")
        if groups_count is not None:
            try:
                tournament.groups_count = int(groups_count) or 1
            except Exception:
                return Response({"ok": False, "error": "Некорректное число групп"}, status=400)

        planned_participants = data.get("participants") or data.get("ko_participants")
        if planned_participants is not None:
            try:
                pp = int(planned_participants)
                tournament.planned_participants = pp if pp > 0 else None
            except Exception:
                return Response({"ok": False, "error": "Некорректное число участников"}, status=400)

        # Рейтинг и призовой фонд
        is_rating_calc = data.get("is_rating_calc")
        if isinstance(is_rating_calc, bool):
            tournament.is_rating_calc = is_rating_calc

        has_prize_fund = data.get("has_prize_fund")
        prize_fund = data.get("prize_fund")
        if has_prize_fund:
            tournament.prize_fund = (prize_fund or "").strip() or None
        else:
            tournament.prize_fund = None

        # Обработка смены системы, расписания и переразметка участников
        from django.db import transaction

        with transaction.atomic():
            old_system = tournament.system
            tournament.system = system
            # Обновляем group_schedule_patterns в зависимости от системы
            if system == Tournament.System.KNOCKOUT:
                # Для олимпийки шаблоны расписания групп не используются
                tournament.group_schedule_patterns = {}
            elif system == Tournament.System.ROUND_ROBIN:
                # Для круговой системы заполняем шаблоны по системному расписанию
                groups_value = tournament.groups_count or 1
                try:
                    base_pattern = SchedulePattern.objects.filter(
                        tournament_system=SchedulePattern.TournamentSystem.ROUND_ROBIN,
                        is_system=True,
                    ).order_by("id").first()
                except Exception:
                    base_pattern = None

                if base_pattern and groups_value > 0:
                    tournament.group_schedule_patterns = {
                        f"Группа {gi}": base_pattern.id for gi in range(1, groups_value + 1)
                    }
                else:
                    # Если нет подходящего системного шаблона — оставляем пустым
                    tournament.group_schedule_patterns = {}
            elif system == Tournament.System.KING:
                # Для King системы заполняем шаблоны по системному расписанию King
                groups_value = tournament.groups_count or 1
                try:
                    base_pattern = SchedulePattern.objects.filter(
                        tournament_system=SchedulePattern.TournamentSystem.KING,
                        is_system=True,
                    ).order_by("id").first()
                except Exception:
                    base_pattern = None

                if base_pattern and groups_value > 0:
                    tournament.group_schedule_patterns = {
                        f"Группа {gi}": base_pattern.id for gi in range(1, groups_value + 1)
                    }
                else:
                    # Если нет подходящего системного шаблона — оставляем пустым
                    tournament.group_schedule_patterns = {}

            tournament.save()

            entries_qs = TournamentEntry.objects.filter(tournament=tournament).order_by("id")

            if system == Tournament.System.ROUND_ROBIN or system == Tournament.System.KING:
                # Обнуляем позиции — участники останутся зарегистрированными, но не расставленными по таблицам
                entries_qs.update(group_index=None, row_index=None)
            elif system == Tournament.System.KNOCKOUT:
                # Линеаризуем участников: все в группе 1, позиции 1..N
                row = 1
                for e in entries_qs:
                    TournamentEntry.objects.filter(pk=e.pk).update(group_index=1, row_index=row)
                    row += 1

        serializer = self.get_serializer(tournament)
        return Response(serializer.data)

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="set_ruleset", permission_classes=[IsAuthenticated])
    def set_ruleset(self, request, pk=None):
        """Установить регламент турнира (ruleset_id)."""
        tournament = self.get_object()
        data = request.data or {}
        try:
            ruleset_id = int(data.get("ruleset_id"))
        except Exception:
            return Response({"ok": False, "error": "Некорректный ruleset_id"}, status=400)
        try:
            rs = Ruleset.objects.get(pk=ruleset_id)
        except Ruleset.DoesNotExist:
            return Response({"ok": False, "error": "Регламент не найден"}, status=404)
        tournament.ruleset = rs
        tournament.save(update_fields=["ruleset"])
        return Response({"ok": True})

    @action(detail=True, methods=["post"])
    def save_participants(self, request, pk=None):
        tournament = self.get_object()
        participants_data = request.data.get("participants", [])

        # Очищаем текущие записи
        TournamentEntry.objects.filter(tournament=tournament).delete()

        # Добавляем новые команды по team_id
        for participant_data in participants_data:
            team_id = participant_data.get("team_id")
            group_index = participant_data.get("group", 1)
            row_index = participant_data.get("row", 1)

            if team_id:
                TournamentEntry.objects.create(
                    tournament=tournament,
                    team_id=team_id,
                    group_index=group_index,
                    row_index=row_index,
                )

        return Response({"status": "success"})

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="set_participant", permission_classes=[IsAuthenticated])
    def set_participant(self, request, pk=None):
        """Создать/обновить участника в конкретной позиции таблицы.

        Body (JSON):
        {
          "group_index": 1,
          "row_index": 1,
          // Для одиночки
          "player_id": 123,
          // Для пары
          "player1_id": 1,
          "player2_id": 2
        }
        """
        tournament: Tournament = self.get_object()

        self._ensure_can_manage_match(request, tournament)
        data = request.data or {}
        try:
            group_index = int(data.get("group_index"))
            row_index = int(data.get("row_index"))
        except Exception:
            return Response({"ok": False, "error": "Некорректная позиция (group_index/row_index)"}, status=400)

        # Определяем одиночка/пара
        is_doubles = tournament.participant_mode == Tournament.ParticipantMode.DOUBLES

        # Соберём целевых игроков
        p1_id = None
        p2_id = None
        if is_doubles:
            p1_id = data.get("player1_id")
            p2_id = data.get("player2_id")
            if not p1_id or not p2_id:
                return Response({"ok": False, "error": "Для пары необходимо выбрать двух разных игроков"}, status=400)
            if str(p1_id) == str(p2_id):
                return Response({"ok": False, "error": "Игроки в паре должны быть разными"}, status=400)
            # Нормализуем порядок (по возрастанию id)
            try:
                a, b = int(p1_id), int(p2_id)
                if a > b:
                    a, b = b, a
                p1_id, p2_id = a, b
            except Exception:
                return Response({"ok": False, "error": "Некорректные идентификаторы игроков"}, status=400)
        else:
            p1_id = data.get("player_id")
            if not p1_id:
                return Response({"ok": False, "error": "Не выбран игрок"}, status=400)

        # Проверка: игрок(и) не должны уже участвовать в этом турнире
        used_player_ids = set()
        entries = TournamentEntry.objects.filter(tournament=tournament).select_related("team", "team__player_1", "team__player_2")
        for e in entries:
            if e.team and getattr(e.team, "player_1_id", None):
                used_player_ids.add(e.team.player_1_id)
            if e.team and getattr(e.team, "player_2_id", None):
                used_player_ids.add(e.team.player_2_id)

        if is_doubles:
            if int(p1_id) in used_player_ids or int(p2_id) in used_player_ids:
                return Response({"ok": False, "error": "Один из выбранных игроков уже участвует в турнире"}, status=400)
        else:
            if int(p1_id) in used_player_ids:
                return Response({"ok": False, "error": "Игрок уже участвует в турнире"}, status=400)

        # Создадим/найдём команду
        if is_doubles:
            team, _created = Team.objects.get_or_create(player_1_id=int(p1_id), player_2_id=int(p2_id))
        else:
            team, _created = Team.objects.get_or_create(player_1_id=int(p1_id), player_2_id=None)

        # Создадим/обновим запись участника на позиции
        entry, _ = TournamentEntry.objects.update_or_create(
            tournament=tournament,
            group_index=group_index,
            row_index=row_index,
            defaults={"team": team},
        )

        return Response({"ok": True, "entry_id": entry.id})

    # --- ПЛЕЙ-ОФФ (ОЛИМПИЙКА) ---
    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="create_knockout_bracket", permission_classes=[IsAuthenticated])
    def create_knockout_bracket(self, request, pk=None):
        """Создать сетку плей-офф для турнира: позиции жеребьёвки и пустые матчи всех раундов.

        Body: { size: 8|16|32|..., has_third_place: bool }
        """
        tournament: Tournament = self.get_object()
        size = int(request.data.get("size", 16))
        has_third_place = bool(request.data.get("has_third_place", True))
        if not validate_bracket_size(size):
            return Response({"ok": False, "error": "Размер сетки должен быть степенью двойки"}, status=400)

        # Политика создания: если достигнут лимит (brackets_count) — не создаём новую, возвращаем первую (для редактирования)
        planned = tournament.brackets_count or 1
        existing_count = tournament.knockout_brackets.count()
        if existing_count >= planned:
            existing = tournament.knockout_brackets.order_by("id").first()
            if existing:
                created = 0
                if not existing.matches.exists():
                    created = generate_initial_matches(existing)
                return Response({
                    "ok": True,
                    "bracket": {
                        "id": existing.id,
                        "index": existing.index,
                        "size": existing.size,
                        "has_third_place": existing.has_third_place,
                    },
                    "matches_created": created,
                })

        next_index = existing_count + 1
        with transaction.atomic():
            bracket = KnockoutBracket.objects.create(
                tournament=tournament,
                index=next_index,
                size=size,
                has_third_place=has_third_place,
            )
            # Создадим все позиции жеребьёвки
            from apps.tournaments.models import DrawPosition
            for pos in range(1, size + 1):
                DrawPosition.objects.create(bracket=bracket, position=pos)
            # Сгенерируем пустые матчи
            created = generate_initial_matches(bracket)

        return Response({
            "ok": True,
            "bracket": {
                "id": bracket.id,
                "index": bracket.index,
                "size": bracket.size,
                "has_third_place": bracket.has_third_place,
            },
            "matches_created": created,
        })

    @action(detail=True, methods=["get"], url_path="default_bracket", permission_classes=[AllowAny])
    def default_bracket(self, request, pk=None):
        """Вернуть первую существующую сетку плей-офф для турнира.

        Используется для read-only просмотра олимпийки пользователями без прав
        управления структурой (REGISTERED и гости).
        """
        tournament: Tournament = self.get_object()
        self._ensure_can_view_tournament(request, tournament)
        if tournament.system != Tournament.System.KNOCKOUT:
            return Response({"ok": False, "error": "Турнир не является олимпийской системой"}, status=400)

        bracket = tournament.knockout_brackets.order_by("id").first()
        if not bracket:
            return Response({"ok": False, "error": "Сетка не найдена"}, status=404)

        return Response({
            "ok": True,
            "bracket": {
                "id": bracket.id,
                "index": bracket.index,
                "size": bracket.size,
                "has_third_place": bracket.has_third_place,
            },
        })

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="seed_bracket", permission_classes=[IsAuthenticated])
    def seed_bracket(self, request, pk=None):
        """Автоматическая расстановка участников в сетке (посевы + случайная раскладка)."""
        tournament: Tournament = self.get_object()
        bracket_id = request.data.get("bracket_id")
        if not bracket_id:
            return Response({"ok": False, "error": "Не указан bracket_id"}, status=400)
        try:
            bracket = tournament.knockout_brackets.get(id=int(bracket_id))
        except KnockoutBracket.DoesNotExist:
            return Response({"ok": False, "error": "Сетка не найдена"}, status=404)

        entries = list(tournament.entries.select_related("team"))
        seed_participants(bracket, entries)
        return Response({"ok": True})

    @action(detail=True, methods=["get"], url_path="brackets/(?P<bracket_id>[^/.]+)/draw", permission_classes=[AllowAny])
    def bracket_draw(self, request, pk=None, bracket_id=None):
        """Получить данные для отрисовки сетки с информацией о соединениях (для SVG)."""
        tournament: Tournament = self.get_object()
        self._ensure_can_view_tournament(request, tournament)
        try:
            bracket = tournament.knockout_brackets.get(id=int(bracket_id))
        except KnockoutBracket.DoesNotExist:
            return Response({"ok": False, "error": "Сетка не найдена"}, status=404)

        rounds_info = calculate_rounds_structure(bracket.size, bracket.has_third_place)

        # Для завершённых турниров используем рейтинг ДО турнира (PlayerRatingDynamic.rating_before),
        # для всех остальных — текущий рейтинг игрока (Player.current_rating).
        use_before_rating = tournament.status == Tournament.Status.COMPLETED
        before_map: dict[int, float] = {}
        if use_before_rating:
            dyn_qs = PlayerRatingDynamic.objects.filter(tournament_id=tournament.id)
            before_map = {int(d.player_id): float(d.rating_before) for d in dyn_qs}

        def _player_base_rating(p: Player) -> float:
            pid = getattr(p, "id", None)
            if use_before_rating and pid is not None:
                # Если есть запись динамики — используем её, иначе падаем обратно на current_rating
                if pid in before_map:
                    return before_map[pid]
            return float(getattr(p, "current_rating", 0) or 0)

        def serialize_team(team):
            if not team:
                return None
            name = str(team)
            # Получить display_name и full_name для игроков
            display_name = name
            full_name = name
            rating = 0

            if team.player_1:
                p1 = team.player_1
                p1_rating = _player_base_rating(p1)
                if team.player_2:
                    # Пара: считаем средний рейтинг двух игроков
                    p2 = team.player_2
                    p2_rating = _player_base_rating(p2)
                    try:
                        rating = int(round((float(p1_rating) + float(p2_rating)) / 2.0))
                    except Exception:
                        rating = int(p1_rating) if p1_rating is not None else 0
                    display_name = f"{p1.display_name or p1.first_name} / {p2.display_name or p2.first_name}"
                    full_name = f"{p1.last_name} {p1.first_name} / {p2.last_name} {p2.first_name}"
                else:
                    # Одиночка: используем рейтинг единственного игрока
                    try:
                        rating = int(p1_rating)
                    except Exception:
                        rating = 0
                    display_name = p1.display_name or p1.first_name
                    full_name = f"{p1.last_name} {p1.first_name}"

            return {
                "id": team.id,
                "name": name,
                "display_name": display_name,
                "full_name": full_name,
                "rating": rating,
            }

        def serialize_team_by_id(team_id: Optional[int]):
            if not team_id:
                return None
            try:
                t = Team.objects.select_related('player_1', 'player_2').get(id=team_id)
                return serialize_team(t)
            except Team.DoesNotExist:
                return None

        def get_connection_info(m: Match) -> Optional[dict]:
            # финал не имеет целевых связей
            if m.is_third_place:
                # для матча за 3-е место истоки — из двух полуфиналов (проигравшие)
                semis = Match.objects.filter(bracket=bracket, round_name__icontains="Полуфинал").order_by("order_in_round")
                if semis.count() == 2:
                    return {
                        "type": "third_place",
                        "sources": [
                            {"match_id": semis[0].id, "slot": "loser"},
                            {"match_id": semis[1].id, "slot": "loser"},
                        ],
                    }
                return None

            # обычный матч: целевой следующий матч и слот
            # последний раунд (финал) не имеет следующий матч
            if (m.round_index or 0) is None:
                return None
            next_order = (m.order_in_round + 1) // 2
            next_round = (m.round_index or 0) + 1
            next_match = Match.objects.filter(
                bracket=bracket, round_index=next_round, order_in_round=next_order, is_third_place=False
            ).first()
            if not next_match:
                return None
            return {
                "type": "normal",
                "target_match_id": next_match.id,
                "target_slot": "team_1" if (m.order_in_round % 2 == 1) else "team_2",
                "source_slot": "top" if (m.order_in_round % 2 == 1) else "bottom",
            }

        draw_data = []
        for info in rounds_info:
            matches_qs = bracket.matches.filter(
                round_index=info.round_index, is_third_place=info.is_third_place
            ).order_by("order_in_round").select_related("team_1", "team_2", "winner")

            round_payload = {
                "round_name": info.round_name,
                "round_index": info.round_index,
                "is_third_place": info.is_third_place,
                "matches_count": info.matches_count,
                "matches": [],
            }
            for m in matches_qs:
                # Сериализуем команды: если team_1/team_2 = None, возвращаем None (не пытаемся искать по ID)
                t1 = serialize_team(m.team_1) if m.team_1_id else None
                t2 = serialize_team(m.team_2) if m.team_2_id else None
                
                # Получить счёт матча
                score_str = None
                if m.status == Match.Status.COMPLETED and m.winner_id:
                    sets = m.sets.all().order_by('index')
                    if sets:
                        # Формат: "6:4" для обычного сета, "10:5TB" для чемпионского тайбрейка
                        score_parts = []
                        for s in sets:
                            if s.is_tiebreak_only:
                                # Чемпионский тайбрейк: показываем очки TB, а не games (1:0)
                                score_parts.append(f"{s.tb_1}:{s.tb_2}TB")
                            else:
                                # Обычный сет
                                score_parts.append(f"{s.games_1}:{s.games_2}")
                        score_str = " ".join(score_parts)
                
                round_payload["matches"].append({
                    "id": m.id,
                    "order_in_round": m.order_in_round,
                    "team_1": t1,
                    "team_2": t2,
                    "winner_id": m.winner_id,
                    "status": m.status,
                    "is_third_place": m.is_third_place,
                    "connection_info": get_connection_info(m),
                    "position_data": {
                        "round_index": info.round_index,
                        "match_order": m.order_in_round,
                        "total_matches_in_round": info.matches_count,
                    },
                    "score": score_str,
                })
            draw_data.append(round_payload)

        # Увеличить расстояние между матчами для парных турниров
        match_gap = 80 if tournament.participant_mode == Tournament.ParticipantMode.DOUBLES else 40
        
        return Response({
            "ok": True,
            "bracket": {"id": bracket.id, "index": bracket.index, "size": bracket.size, "has_third_place": bracket.has_third_place},
            "rounds": draw_data,
            "visual_config": {"match_width": 250, "match_height": 100, "round_gap": 80, "match_gap": match_gap},
        })

    @action(detail=True, methods=["get"], url_path="brackets/(?P<bracket_id>[^/.]+)/bye_positions", permission_classes=[AllowAny])
    def bracket_bye_positions(self, request, pk=None, bracket_id=None):
        """Вернуть список позиций жеребьёвки, помеченных как BYE, для указанной сетки турнира."""
        tournament: Tournament = self.get_object()
        self._ensure_can_view_tournament(request, tournament)
        try:
            bracket = tournament.knockout_brackets.get(id=int(bracket_id))
        except KnockoutBracket.DoesNotExist:
            return Response({"ok": False, "error": "Сетка не найдена"}, status=404)

        from apps.tournaments.models import DrawPosition
        bye_positions = list(
            DrawPosition.objects.filter(bracket=bracket, source='BYE').values_list('position', flat=True)
        )
        return Response({"ok": True, "bye_positions": bye_positions})

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], permission_classes=[AllowAny], authentication_classes=[])
    def complete(self, request, pk=None):
        tournament = self.get_object()
        tournament.status = Tournament.Status.COMPLETED
        tournament.save(update_fields=["status"])
        # Триггер пересчета рейтинга после завершения турнира
        try:
            from apps.players.services.rating_service import compute_ratings_for_tournament
            compute_ratings_for_tournament(tournament.id)
        except Exception as e:
            # Логируем, но не роняем ответ клиенту
            import logging
            logging.getLogger(__name__).exception("Rating recompute failed for tournament %s: %s", tournament.id, e)
        return Response({"ok": True})

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="remove", permission_classes=[AllowAny], authentication_classes=[])
    def remove(self, request, pk=None):
        tournament = self.get_object()
        
        # Правильный порядок удаления для олимпийских турниров:
        # 1. tournaments_drawposition
        # 2. tournaments_tournamententry
        # 3. matches_matchset
        # 4. players_playerratinghistory
        # 5. matches_matchspecialoutcome
        # 6. matches_match
        # 7. tournaments_knockoutbracket
        # 8. tournaments_tournament
        if tournament.system == Tournament.System.KNOCKOUT:
            from apps.tournaments.models import DrawPosition
            from apps.players.models import PlayerRatingHistory
            from apps.matches.models import MatchSpecialOutcome
            from django.db import transaction
            
            with transaction.atomic():
                # 1. Удаляем позиции в сетках
                DrawPosition.objects.filter(bracket__tournament=tournament).delete()
                
                # 2. Удаляем участников турнира
                TournamentEntry.objects.filter(tournament=tournament).delete()
                
                # 3. Удаляем сеты матчей
                MatchSet.objects.filter(match__tournament=tournament).delete()
                
                # 4. Удаляем историю рейтингов игроков
                PlayerRatingHistory.objects.filter(match__tournament=tournament).delete()
                
                # 5. Удаляем специальные исходы матчей
                MatchSpecialOutcome.objects.filter(match__tournament=tournament).delete()
                
                # 6. Удаляем матчи
                Match.objects.filter(tournament=tournament).delete()
                
                # 7. Удаляем сетки
                tournament.knockout_brackets.all().delete()
                
                # 8. Удаляем турнир
                tournament.delete()
        else:
            # Для круговых турниров стандартное каскадное удаление работает
            tournament.delete()
        
        return Response({"ok": True})

    # --- ГРУППОВОЕ РАСПИСАНИЕ И ФИКСАЦИЯ ---
    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["get"], url_path="group_schedule", permission_classes=[AllowAny])
    def group_schedule(self, request, pk=None):
        """Сформировать расписание круговых матчей по группам на основе group_schedule_patterns.
        Возвращает для каждой группы массив туров, каждый тур — пары позиций (индексы 1..N).
        Использует выбранные шаблоны расписания для каждой группы.
        """
        tournament: Tournament = self.get_object()
        self._ensure_can_view_tournament(request, tournament)
        if tournament.system != Tournament.System.ROUND_ROBIN:
            return Response({"ok": False, "error": "Турнир не круговой системы"}, status=400)

        groups_count = max(1, tournament.groups_count or 1)
        planned_total = int(tournament.planned_participants or 0)
        # равномерно распределим план по группам
        base = planned_total // groups_count
        remainder = planned_total % groups_count
        sizes = [base + (1 if i < remainder else 0) for i in range(groups_count)]

        schedule = {}
        import json
        # Безопасно разбираем group_schedule_patterns (совместимость со старыми турнирами)
        patterns = tournament.group_schedule_patterns
        if not patterns:
            patterns = {}
        elif isinstance(patterns, str):
            try:
                patterns = json.loads(patterns) or {}
            except Exception:
                patterns = {}

        for gi, size in enumerate(sizes, start=1):
            group_name = f"Группа {gi}"
            
            # Получаем шаблон для этой группы
            pattern_id = patterns.get(group_name)
            
            if pattern_id:
                try:
                    pattern = SchedulePattern.objects.get(pk=pattern_id)
                    
                    # Генерируем расписание по выбранному шаблону
                    if pattern.pattern_type == SchedulePattern.PatternType.BERGER:
                        from apps.tournaments.services.round_robin import _berger_pairings
                        rounds = _berger_pairings(list(range(1, size + 1)))
                    elif pattern.pattern_type == SchedulePattern.PatternType.SNAKE:
                        from apps.tournaments.services.round_robin import _snake_pairings
                        rounds = _snake_pairings(list(range(1, size + 1)))
                    elif pattern.pattern_type == SchedulePattern.PatternType.CUSTOM and pattern.custom_schedule:
                        # Для кастомного шаблона используем его расписание
                        custom_rounds = pattern.custom_schedule.get('rounds', [])
                        rounds = []
                        
                        # Если участников меньше чем participants_count - фильтруем пары
                        max_participant = pattern.participants_count
                        for round_data in custom_rounds:
                            pairs = []
                            for pair in round_data.get('pairs', []):
                                # Пропускаем пары с участником = participants_count при нечетном количестве
                                if size < max_participant and (pair[0] == max_participant or pair[1] == max_participant):
                                    continue
                                pairs.append(tuple(pair))
                            if pairs:  # Добавляем тур только если в нем есть пары
                                rounds.append(pairs)
                    else:
                        # Fallback на Бергера
                        from apps.tournaments.services.round_robin import _berger_pairings
                        rounds = _berger_pairings(list(range(1, size + 1)))
                        
                except SchedulePattern.DoesNotExist:
                    # Если шаблон не найден - используем Бергера
                    from apps.tournaments.services.round_robin import _berger_pairings
                    rounds = _berger_pairings(list(range(1, size + 1)))
            else:
                # Если шаблон не выбран - используем Бергера по умолчанию
                from apps.tournaments.services.round_robin import _berger_pairings
                rounds = _berger_pairings(list(range(1, size + 1)))
            
            schedule[str(gi)] = rounds

        return Response({"ok": True, "groups": schedule})

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="lock_participants", permission_classes=[IsAuthenticated])
    def lock_participants(self, request, pk=None):
        """Зафиксировать участников: создать матчи в группах по выбранным шаблонам расписания.
        Использует group_schedule_patterns для определения алгоритма каждой группы.
        Поддерживает круговую систему и King.
        """
        tournament: Tournament = self.get_object()
        
        # Блокировка для завершённых турниров
        if tournament.status == Tournament.Status.COMPLETED:
            return Response({"error": "Турнир завершён, изменения запрещены"}, status=400)
        
        if tournament.system not in [Tournament.System.ROUND_ROBIN, Tournament.System.KING]:
            return Response({"ok": False, "error": "Турнир не круговой системы и не King"}, status=400)

        try:
            # Генерируем расписание в зависимости от системы
            if tournament.system == Tournament.System.KING:
                # Валидация для King: 4-16 участников в каждой группе
                groups_count = max(1, tournament.groups_count or 1)
                for group_idx in range(1, groups_count + 1):
                    entries_count = tournament.entries.filter(group_index=group_idx).count()
                    if not (4 <= entries_count <= 16):
                        return Response({
                            'error': f'Группа {group_idx}: должно быть от 4 до 16 участников, найдено {entries_count}'
                        }, status=400)
                
                from apps.tournaments.services.king import generate_king_matches, persist_king_matches
                generated = generate_king_matches(tournament)
                created = persist_king_matches(tournament, generated)
            else:
                # Round Robin
                generated = generate_round_robin_matches(tournament)
                created = persist_generated_matches(tournament, generated)
            
            # Изменить статус турнира на active при фиксации
            if tournament.status == Tournament.Status.CREATED:
                # Автоматически рассчитываем коэффициент турнира
                from apps.tournaments.services.coefficient_calculator import auto_calculate_tournament_coefficient
                try:
                    auto_calculate_tournament_coefficient(tournament.id)
                except Exception as e:
                    import logging
                    logging.getLogger(__name__).warning(f"Не удалось рассчитать коэффициент турнира {tournament.id}: {e}")
                
                tournament.status = Tournament.Status.ACTIVE
                tournament.save(update_fields=['status'])
            
            return Response({"ok": True, "created": created})
            
        except Exception as e:
            return Response(
                {"ok": False, "error": f"Ошибка при создании расписания: {str(e)}"}, 
                status=500
            )

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="unlock_participants", permission_classes=[IsAuthenticated])
    def unlock_participants(self, request, pk=None):
        """Снять фиксацию участников в круговой системе или King - изменить статус турнира на created."""
        tournament: Tournament = self.get_object()
        
        if tournament.system not in [Tournament.System.ROUND_ROBIN, Tournament.System.KING]:
            return Response({"ok": False, "error": "Турнир не круговой системы и не King"}, status=400)
        
        # Изменить статус турнира на created при снятии фиксации
        if tournament.status == Tournament.Status.ACTIVE:
            tournament.status = Tournament.Status.CREATED
            tournament.save(update_fields=['status'])
        
        return Response({"ok": True})

    # --- ТУРНИРЫ КИНГ ---
    @method_decorator(csrf_exempt)
    @action(detail=True, methods=['post'], url_path='lock_participants_king', permission_classes=[IsAuthenticated])
    def lock_participants_king(self, request, pk=None):
        """Фиксация участников для турнира Кинг и генерация матчей"""
        tournament = self.get_object()
        
        if tournament.system != Tournament.System.KING:
            return Response({'error': 'Не турнир Кинг'}, status=400)
        
        if tournament.status == Tournament.Status.COMPLETED:
            return Response({'error': 'Турнир завершён, изменения запрещены'}, status=400)
        
        # Валидация: 4-16 участников в каждой группе
        groups_count = max(1, tournament.groups_count or 1)
        for group_idx in range(1, groups_count + 1):
            entries_count = tournament.entries.filter(group_index=group_idx).count()
            if not (4 <= entries_count <= 16):
                return Response({
                    'error': f'Группа {group_idx}: должно быть от 4 до 16 участников, найдено {entries_count}'
                }, status=400)
        
        try:
            # Генерация и сохранение матчей.
            # Старые матчи теперь обрабатываются внутри persist_king_matches:
            # существующие пары команд сохраняются, "лишние" матчи и их сеты удаляются.
            from apps.tournaments.services.king import generate_king_matches, persist_king_matches
            generated = generate_king_matches(tournament)
            created = persist_king_matches(tournament, generated)
            
            # Изменить статус турнира на active
            if tournament.status == Tournament.Status.CREATED:
                # Автоматически рассчитываем коэффициент турнира
                from apps.tournaments.services.coefficient_calculator import auto_calculate_tournament_coefficient
                try:
                    auto_calculate_tournament_coefficient(tournament.id)
                except Exception as e:
                    import logging
                    logging.getLogger(__name__).warning(f"Не удалось рассчитать коэффициент турнира {tournament.id}: {e}")
                
                tournament.status = Tournament.Status.ACTIVE
                tournament.save(update_fields=['status'])
            
            return Response({'ok': True, 'created': created})
            
        except Exception as e:
            return Response(
                {'ok': False, 'error': f'Ошибка при создании расписания: {str(e)}'}, 
                status=500
            )

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=['get'], url_path='king_schedule', permission_classes=[AllowAny])
    def king_schedule(self, request, pk=None):
        """Получить расписание турнира Кинг для отображения"""
        tournament = self.get_object()
        self._ensure_can_view_tournament(request, tournament)
        
        if tournament.system != Tournament.System.KING:
            return Response({'error': 'Не турнир Кинг'}, status=400)
        
        groups_count = max(1, tournament.groups_count or 1)
        schedule = {}
        
        for group_idx in range(1, groups_count + 1):
            # Получаем участников группы
            entries = list(
                tournament.entries.filter(group_index=group_idx)
                .select_related('team__player_1', 'team__player_2')
                .order_by('row_index')
            )
            
            # Получаем матчи группы
            matches = Match.objects.filter(
                tournament=tournament,
                stage=Match.Stage.GROUP,
                group_index=group_idx
            ).select_related('team_1__player_1', 'team_1__player_2', 'team_2__player_1', 'team_2__player_2', 'winner').prefetch_related('sets').order_by('round_index', 'order_in_round')
            
            # Группируем по турам
            rounds_dict = {}
            for match in matches:
                round_num = match.round_index or 1
                if round_num not in rounds_dict:
                    rounds_dict[round_num] = []
                
                # Определяем игроков в парах
                team1_players = []
                team2_players = []
                
                if match.team_1 and match.team_1.player_1:
                    team1_players.append({
                        'id': match.team_1.player_1.id,
                        'name': f"{match.team_1.player_1.last_name} {match.team_1.player_1.first_name}",
                        'display_name': match.team_1.player_1.display_name or match.team_1.player_1.first_name
                    })
                if match.team_1 and match.team_1.player_2:
                    team1_players.append({
                        'id': match.team_1.player_2.id,
                        'name': f"{match.team_1.player_2.last_name} {match.team_1.player_2.first_name}",
                        'display_name': match.team_1.player_2.display_name or match.team_1.player_2.first_name
                    })
                
                if match.team_2 and match.team_2.player_1:
                    team2_players.append({
                        'id': match.team_2.player_1.id,
                        'name': f"{match.team_2.player_1.last_name} {match.team_2.player_1.first_name}",
                        'display_name': match.team_2.player_1.display_name or match.team_2.player_1.first_name
                    })
                if match.team_2 and match.team_2.player_2:
                    team2_players.append({
                        'id': match.team_2.player_2.id,
                        'name': f"{match.team_2.player_2.last_name} {match.team_2.player_2.first_name}",
                        'display_name': match.team_2.player_2.display_name or match.team_2.player_2.first_name
                    })
                
                # Получить счёт
                score_str = None
                if match.status == Match.Status.COMPLETED and match.winner_id:
                    sets = match.sets.all().order_by('index')
                    if sets:
                        score_parts = []
                        for s in sets:
                            if s.is_tiebreak_only:
                                score_parts.append(f"{s.tb_1}:{s.tb_2}TB")
                            else:
                                score_parts.append(f"{s.games_1}:{s.games_2}")
                        score_str = " ".join(score_parts)
                
                rounds_dict[round_num].append({
                    'id': match.id,
                    'team1_players': team1_players,
                    'team2_players': team2_players,
                    'score': score_str,
                    'status': match.status,
                    'sets': [
                        {
                            'index': s.index,
                            'games_1': s.games_1,
                            'games_2': s.games_2,
                            'tb_1': s.tb_1,
                            'tb_2': s.tb_2,
                            'is_tiebreak_only': s.is_tiebreak_only,
                        }
                        for s in match.sets.all().order_by('index')
                    ],
                })
            
            # Формируем итоговый список туров
            rounds_list = []
            for round_num in sorted(rounds_dict.keys()):
                rounds_list.append({
                    'round': round_num,
                    'matches': rounds_dict[round_num]
                })
            
            schedule[str(group_idx)] = {
                'participants': [
                    {
                        'id': e.id,
                        'team_id': e.team_id,
                        # базовый игрок в группе (team.player_1)
                        'player_id': e.team.player_1_id if e.team and e.team.player_1_id is not None else None,
                        'name': f"{e.team.player_1.last_name} {e.team.player_1.first_name}" if e.team and e.team.player_1 else '',
                        'display_name': (e.team.player_1.display_name or e.team.player_1.first_name) if e.team and e.team.player_1 else '',
                        'row_index': e.row_index,
                    }
                    for e in entries
                ],
                'rounds': rounds_list,
            }
        
        return Response({'ok': True, 'schedule': schedule})

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=['get'], url_path='king_stats', permission_classes=[AllowAny])
    def king_stats(self, request, pk=None):
        """
        Получить статистику по всем группам King турнира.
        Возвращает агрегаты и ранжирование для каждой группы.
        """
        tournament = self.get_object()
        self._ensure_can_view_tournament(request, tournament)
        
        if tournament.system != Tournament.System.KING:
            return Response({'error': 'Не турнир Кинг'}, status=400)
        
        from apps.tournaments.services.king_stats import (
            _aggregate_for_king_group,
            compute_king_group_ranking
        )
        
        # Получаем расписание для всех групп (используем ту же логику, что в king_schedule)
        groups_count = max(1, tournament.groups_count or 1)
        calculation_mode = getattr(tournament, 'king_calculation_mode', 'no') or 'no'
        
        result = {'groups': {}}
        
        for group_idx in range(1, groups_count + 1):
            # Получаем участников группы
            entries = list(
                tournament.entries.filter(group_index=group_idx)
                .select_related('team__player_1', 'team__player_2')
                .order_by('row_index')
            )
            
            if not entries:
                continue
            
            # Получаем матчи группы
            matches = Match.objects.filter(
                tournament=tournament,
                stage=Match.Stage.GROUP,
                group_index=group_idx
            ).prefetch_related('sets').order_by('round_index', 'order_in_round')
            
            # Формируем структуру group_data для передачи в king_stats
            rounds_dict = {}
            for m in matches:
                round_idx = m.round_index or 1
                if round_idx not in rounds_dict:
                    rounds_dict[round_idx] = []
                
                team1_players = []
                team2_players = []
                # Для King туров матч содержит временные пары: берем игроков напрямую из m.team_1/m.team_2
                if m.team_1:
                    if m.team_1.player_1:
                        team1_players.append({
                            'id': m.team_1.player_1.id,
                            'name': f"{m.team_1.player_1.last_name} {m.team_1.player_1.first_name}"
                        })
                    if m.team_1.player_2:
                        team1_players.append({
                            'id': m.team_1.player_2.id,
                            'name': f"{m.team_1.player_2.last_name} {m.team_1.player_2.first_name}"
                        })

                if m.team_2:
                    if m.team_2.player_1:
                        team2_players.append({
                            'id': m.team_2.player_1.id,
                            'name': f"{m.team_2.player_1.last_name} {m.team_2.player_1.first_name}"
                        })
                    if m.team_2.player_2:
                        team2_players.append({
                            'id': m.team_2.player_2.id,
                            'name': f"{m.team_2.player_2.last_name} {m.team_2.player_2.first_name}"
                        })
                
                rounds_dict[round_idx].append({
                    'id': m.id,
                    'team1_players': team1_players,
                    'team2_players': team2_players,
                })
            
            rounds_list = [{'round': r, 'matches': rounds_dict[r]} for r in sorted(rounds_dict.keys())]
            
            participants_data = []
            for e in entries:
                participants_data.append({
                    'row_index': e.row_index,
                    'team': {
                        'player_1': e.team.player_1_id if e.team else None,
                        'player_2': e.team.player_2_id if e.team else None,
                    },
                    'display_name': e.team.player_1.display_name if e.team and e.team.player_1 else '',
                    'name': f"{e.team.player_1.last_name} {e.team.player_1.first_name}" if e.team and e.team.player_1 else '',
                })
            
            group_data = {
                'participants': participants_data,
                'rounds': rounds_list
            }
            
            # Рассчитываем агрегаты для всех трёх режимов (NO, G-, M+)
            stats, compute_stats_fn = _aggregate_for_king_group(tournament, group_idx, group_data)
            
            # Рассчитываем ранжирование для текущего режима
            placements = compute_king_group_ranking(
                tournament, group_idx, calculation_mode, group_data, stats, compute_stats_fn
            )
            
            # Формируем результат для группы (включаем все поля для всех режимов)
            result['groups'][str(group_idx)] = {
                'stats': {
                    str(row_idx): s  # Возвращаем все поля (NO, G-, M+)
                    for row_idx, s in stats.items()
                },
                'placements': {str(row_idx): rank for row_idx, rank in placements.items()}
            }
        
        return Response({'ok': True, 'groups': result['groups']})

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=['post'], url_path='set_king_calculation_mode', permission_classes=[IsAuthenticated])
    def set_king_calculation_mode(self, request, pk=None):
        """Изменить режим подсчета G-/M+/NO для турнира Кинг"""
        tournament = self.get_object()
        
        if tournament.system != Tournament.System.KING:
            return Response({'error': 'Не турнир Кинг'}, status=400)
        
        mode = request.data.get('mode')
        
        if mode not in ['g_minus', 'm_plus', 'no']:
            return Response({'error': 'Неверный режим. Допустимые: g_minus, m_plus, no'}, status=400)
        
        tournament.king_calculation_mode = mode
        tournament.save(update_fields=['king_calculation_mode'])
        
        return Response({'ok': True, 'mode': mode})

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="match_start", permission_classes=[IsAuthenticated])
    def match_start(self, request, pk=None):
        tournament: Tournament = self.get_object()
        self._ensure_can_manage_match(request, tournament)
        match_id = request.data.get("match_id")
        if not match_id:
            return Response({"ok": False, "error": "match_id обязателен"}, status=400)
        try:
            m = Match.objects.get(id=int(match_id), tournament=tournament)
        except Match.DoesNotExist:
            return Response({"ok": False, "error": "Матч не найден"}, status=404)
        from django.utils import timezone
        m.started_at = timezone.now()
        m.status = Match.Status.LIVE
        m.save(update_fields=["started_at", "status", "updated_at"])
        # Если это групповой матч — пересчитаем агрегаты группы сразу
        if m.stage == Match.Stage.GROUP and m.group_index is not None:
            try:
                from apps.tournaments.services.stats import recalc_group_stats
                recalc_group_stats(tournament, m.group_index)
            except Exception:
                pass

        return Response({"ok": True, "match": MatchSerializer(m).data})

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="match_save_score_full", permission_classes=[IsAuthenticated])
    def match_save_score_full(self, request, pk=None):
        """Сохранить ПОЛНЫЙ счёт матча (все сеты) и завершить матч.
        Ожидает JSON: { match_id: int, sets: [ {index, games_1, games_2, tb_1?, tb_2?, is_tiebreak_only?} ] }
        games_1/games_2 — очки геймов для team_1 / team_2.
        Для обычного тай-брейка допускается указывать только очки победителя и проигравшего,
        но предпочтительно передавать tb_1/tb_2 как очки тай-брейка для каждой стороны.
        """
        tournament: Tournament = self.get_object()

        if tournament.status == Tournament.Status.COMPLETED:
            return Response({"error": "Турнир завершён, изменения запрещены"}, status=400)

        match_id = request.data.get("match_id")
        sets_payload = request.data.get("sets")
        if not match_id or not isinstance(sets_payload, list) or len(sets_payload) == 0:
            return Response({"ok": False, "error": "match_id и непустой массив sets обязательны"}, status=400)

        try:
            m = Match.objects.get(id=int(match_id), tournament=tournament)
        except Match.DoesNotExist:
            return Response({"ok": False, "error": "Матч не найден"}, status=404)

        # Очистим старые сеты и создадим новые
        m.sets.all().delete()

        team1_sets_won = 0
        team2_sets_won = 0

        def decide_set_winner(g1: int, g2: int, tb1: int | None, tb2: int | None, is_tb_only: bool) -> int:
            # Возвращает 1 если выиграл team_1, 2 если team_2
            if is_tb_only:
                # Чемпионский тай‑брейк — сравниваем tb1/tb2
                return 1 if (tb1 or 0) > (tb2 or 0) else 2
            # Обычный сет: сравниваем games
            if g1 == g2:
                # На практике такого не должно быть — защита на всякий
                return 1
            return 1 if g1 > g2 else 2

        created = []
        sf = getattr(tournament, 'set_format', None)
        only_tiebreak_mode = False
        if sf is not None:
            try:
                only_tiebreak_mode = bool(getattr(sf, 'allow_tiebreak_only_set', False)) and int(getattr(sf, 'max_sets', 1)) == 1
            except Exception:
                only_tiebreak_mode = False

        for i, s in enumerate(sets_payload, start=1):
            idx = int(s.get("index") or i)
            g1 = int(s.get("games_1") or 0)
            g2 = int(s.get("games_2") or 0)
            tb1 = s.get("tb_1")
            tb2 = s.get("tb_2")
            tb1 = int(tb1) if tb1 is not None else None
            tb2 = int(tb2) if tb2 is not None else None
            is_tb_only = bool(s.get("is_tiebreak_only") or False)

            if is_tb_only:
                if only_tiebreak_mode:
                    # В режиме "только тай-брейк" сохраняем TB очки в games
                    g1 = int(tb1 or 0)
                    g2 = int(tb2 or 0)
                else:
                    # Чемпионский TB как 1:0/0:1
                    if int(tb1 or 0) > int(tb2 or 0):
                        g1, g2 = 1, 0
                    else:
                        g1, g2 = 0, 1

            created.append(MatchSet(match=m, index=idx, games_1=g1, games_2=g2, tb_1=tb1, tb_2=tb2, is_tiebreak_only=is_tb_only))
            w = decide_set_winner(g1, g2, tb1, tb2, is_tb_only)
            if w == 1:
                team1_sets_won += 1
            else:
                team2_sets_won += 1

        MatchSet.objects.bulk_create(created)

        # Определяем победителя по числу выигранных сетов
        if team1_sets_won == team2_sets_won:
            # На всякий случай — выбираем по последнему сету
            last = created[-1]
            w = 1 if (last.games_1 > last.games_2) or ((last.tb_1 or 0) > (last.tb_2 or 0)) else 2
        else:
            w = 1 if team1_sets_won > team2_sets_won else 2

        winner_team = m.team_1 if w == 1 else m.team_2
        if not winner_team:
            return Response({"ok": False, "error": "Нельзя определить победителя: в паре отсутствует команда"}, status=400)

        from django.utils import timezone
        m.finished_at = timezone.now()
        m.winner = winner_team
        m.status = Match.Status.COMPLETED
        m.save(update_fields=["finished_at", "winner", "status", "updated_at"])

        # Продвинем победителя в плей-офф (если матч относится к сетке)
        if m.bracket:
            try:
                from apps.tournaments.services.knockout import advance_winner
                advance_winner(m)
            except Exception as e:
                import logging, traceback
                logger = logging.getLogger(__name__)
                logger.error(f"Failed to advance winner for match {m.id}: {e}")
                logger.error(traceback.format_exc())
                return Response({"ok": False, "error": f"Не удалось продвинуть победителя: {str(e)}"}, status=500)

        return Response({"ok": True, "match": MatchSerializer(m).data})

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="match_cancel", permission_classes=[IsAuthenticated])
    def match_cancel(self, request, pk=None):
        """Отменить матч (вернуть в статус scheduled, очистить время начала)."""
        tournament: Tournament = self.get_object()
        self._ensure_can_manage_match(request, tournament)
        
        # Блокировка для завершённых турниров
        if tournament.status == Tournament.Status.COMPLETED:
            return Response({"error": "Турнир завершён, изменения запрещены"}, status=400)
        match_id = request.data.get("match_id")
        
        if not match_id:
            return Response({"ok": False, "error": "match_id обязателен"}, status=400)
        
        try:
            m = Match.objects.get(id=int(match_id), tournament=tournament)
        except Match.DoesNotExist:
            return Response({"ok": False, "error": "Матч не найден"}, status=404)
        
        m.started_at = None
        m.status = Match.Status.SCHEDULED
        m.save(update_fields=["started_at", "status", "updated_at"])
        
        return Response({"ok": True, "match": {"id": m.id, "status": m.status}})

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="match_delete_score", permission_classes=[IsAuthenticated])
    def match_delete_score(self, request, pk=None):
        """Удалить счет матча (очистить сеты и winner_id) для круговой системы."""
        tournament: Tournament = self.get_object()
        self._ensure_can_manage_match(request, tournament)
        # Блокировка для завершённых турниров
        if tournament.status == Tournament.Status.COMPLETED:
            return Response({"error": "Турнир завершён, изменения запрещены"}, status=400)
        
        match_id = request.data.get("match_id")
        if not match_id:
            return Response({"ok": False, "error": "match_id обязателен"}, status=400)
        
        try:
            m = Match.objects.get(id=int(match_id), tournament=tournament)
        except Match.DoesNotExist:
            return Response({"ok": False, "error": "Матч не найден"}, status=404)
        
        # Удалить все сеты матча
        m.sets.all().delete()
        
        # Очистить winner_id и статус
        m.winner = None
        m.status = Match.Status.SCHEDULED
        m.started_at = None
        m.finished_at = None
        m.save(update_fields=["winner", "status", "started_at", "finished_at", "updated_at"])
        
        return Response({"ok": True})

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="match_reset", permission_classes=[IsAuthenticated])
    def match_reset(self, request, pk=None):
        """Сбросить результат матча (удалить счёт, победителя, каскадно очистить все последующие раунды)."""
        tournament: Tournament = self.get_object()
        self._ensure_can_manage_match(request, tournament)
        # Блокировка для завершённых турниров
        if tournament.status == Tournament.Status.COMPLETED:
            return Response({"error": "Турнир завершён, изменения запрещены"}, status=400)
        match_id = request.data.get("match_id")
        
        if not match_id:
            return Response({"ok": False, "error": "match_id обязателен"}, status=400)
        
        try:
            m = Match.objects.get(id=int(match_id), tournament=tournament)
        except Match.DoesNotExist:
            return Response({"ok": False, "error": "Матч не найден"}, status=404)
        
        # Каскадная очистка всех последующих раундов
        if m.winner_id and m.bracket:
            self._cascade_reset_matches(m)
        
        # Удалить сеты текущего матча
        m.sets.all().delete()
        
        # Очистить результат текущего матча
        m.winner = None
        m.started_at = None
        m.finished_at = None
        m.status = Match.Status.SCHEDULED
        m.save(update_fields=["winner", "started_at", "finished_at", "status", "updated_at"])
        
        return Response({"ok": True})
    
    def _cascade_reset_matches(self, match: Match):
        """
        Каскадно сбросить все последующие раунды после данного матча.
        Включает обработку матча за 3-е место для полуфиналов.
        """
        if not match.bracket or not match.winner_id:
            return
        
        # Список матчей для сброса
        matches_to_reset = []
        
        # 1. Обработка обычного следующего раунда
        if not match.is_third_place:
            next_round = (match.round_index or 0) + 1
            next_order = (match.order_in_round + 1) // 2
            target_slot = 'team_1' if (match.order_in_round % 2 == 1) else 'team_2'
            
            next_match = Match.objects.filter(
                bracket=match.bracket,
                round_index=next_round,
                order_in_round=next_order,
                is_third_place=False
            ).first()
            
            if next_match:
                # Очистить слот победителя
                setattr(next_match, target_slot, None)
                next_match.save(update_fields=[target_slot, 'updated_at'])
                
                # Если следующий матч был завершен, добавить его в список для сброса
                if next_match.status == Match.Status.COMPLETED:
                    matches_to_reset.append(next_match)
        
        # 2. Обработка матча за 3-е место для полуфиналов
        if (match.round_name or "").lower().startswith("полуфинал"):
            third_place_match = Match.objects.filter(
                bracket=match.bracket,
                is_third_place=True
            ).first()
            
            if third_place_match:
                # Определить, какой слот очищать (проигравший из этого полуфинала)
                # Полуфинал 1 -> team_1 матча за 3-е место
                # Полуфинал 2 -> team_2 матча за 3-е место
                semis = Match.objects.filter(
                    bracket=match.bracket,
                    round_name__icontains="Полуфинал"
                ).order_by("order_in_round")
                
                if semis.count() == 2:
                    if match.id == semis[0].id:
                        # Первый полуфинал -> очистить team_1
                        third_place_match.team_1 = None
                        third_place_match.save(update_fields=['team_1', 'updated_at'])
                    elif match.id == semis[1].id:
                        # Второй полуфинал -> очистить team_2
                        third_place_match.team_2 = None
                        third_place_match.save(update_fields=['team_2', 'updated_at'])
                
                # Если матч за 3-е место был завершен, добавить его в список для сброса
                if third_place_match.status == Match.Status.COMPLETED:
                    matches_to_reset.append(third_place_match)
        
        # 3. Рекурсивно сбросить все найденные матчи
        for m in matches_to_reset:
            # Сначала каскадно очистить следующие раунды (до удаления сетов текущего)
            self._cascade_reset_matches(m)
            
            # Удалить сеты текущего матча
            m.sets.all().delete()
            
            # Очистить результат текущего матча
            m.winner = None
            m.started_at = None
            m.finished_at = None
            m.status = Match.Status.SCHEDULED
            m.save(update_fields=["winner", "started_at", "finished_at", "status", "updated_at"])

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="match_save_score", permission_classes=[IsAuthenticated])
    def match_save_score(self, request, pk=None):
        """Сохранить счёт одного сета и завершить матч.
        Ожидает JSON: { match_id, id_team_first, id_team_second, games_first, games_second }
        games_1/games_2 — очки геймов для team_1 / team_2.
        Для обычного тай-брейка допускается указывать только очки победителя и проигравшего,
        но предпочтительно передавать tb_1/tb_2 как очки тай-брейка для каждой стороны.
        """
        tournament: Tournament = self.get_object()
        
        # Блокировка для завершённых турниров
        if tournament.status == Tournament.Status.COMPLETED:
            return Response({"error": "Турнир завершён, изменения запрещены"}, status=400)
        match_id = request.data.get("match_id")
        id_team_first = request.data.get("id_team_first")
        id_team_second = request.data.get("id_team_second")
        games_first = request.data.get("games_first")
        games_second = request.data.get("games_second")
        if not all(v is not None for v in [match_id, id_team_first, id_team_second, games_first, games_second]):
            return Response({"ok": False, "error": "match_id, id_team_first, id_team_second, games_first, games_second обязательны"}, status=400)
        try:
            m = Match.objects.get(id=int(match_id), tournament=tournament)
        except Match.DoesNotExist:
            return Response({"ok": False, "error": "Матч не найден"}, status=404)
        id_team_first = int(id_team_first); id_team_second = int(id_team_second)
        games_first = int(games_first); games_second = int(games_second)

        # Победитель
        if games_first == games_second:
            return Response({"ok": False, "error": "Нельзя сохранить ничью. Исправьте счёт."}, status=400)
        winner_id = id_team_first if games_first > games_second else id_team_second
        
        # Определяем, какая команда матча (team_1 или team_2) победила
        # winner_id — это ID команды-победителя (реальный ID из БД)
        # Нужно определить, это team_1 или team_2 матча
        team1_is_winner = (winner_id == m.team_1_id)
        
        # games_1 и games_2 должны соответствовать team_1 и team_2 матча
        # id_team_first/games_first — это победитель и его очки
        # id_team_second/games_second — это проигравший и его очки
        if team1_is_winner:
            # team_1 победил → games_1 = очки победителя, games_2 = очки проигравшего
            games_1_value = games_first
            games_2_value = games_second
        else:
            # team_2 победил → games_1 = очки проигравшего, games_2 = очки победителя
            games_1_value = games_second
            games_2_value = games_first

        sf = getattr(tournament, 'set_format', None)
        only_tiebreak_mode = False
        if sf is not None:
            try:
                only_tiebreak_mode = bool(getattr(sf, 'allow_tiebreak_only_set', False)) and int(getattr(sf, 'max_sets', 1)) == 1
            except Exception:
                only_tiebreak_mode = False

        # Обновляем/создаём первый сет
        s, _ = MatchSet.objects.get_or_create(match=m, index=1, defaults={"games_1": 0, "games_2": 0})
        if s.is_tiebreak_only:
            if only_tiebreak_mode:
                # В режиме "только тай-брейк" сохраняем TB очки в games
                s.games_1 = games_1_value
                s.games_2 = games_2_value
            else:
                # Чемпионский TB как 1:0/0:1
                if team1_is_winner:
                    s.games_1, s.games_2 = 1, 0
                else:
                    s.games_1, s.games_2 = 0, 1
        else:
            s.games_1 = games_1_value
            s.games_2 = games_2_value
        s.tb_1 = None
        s.tb_2 = None
        s.is_tiebreak_only = False
        s.save()

        # Завершаем матч
        from django.utils import timezone
        m.finished_at = timezone.now()
        m.winner_id = winner_id
        m.status = Match.Status.COMPLETED
        m.save(update_fields=["finished_at", "winner", "status", "updated_at"])
        # Продвинем победителя в плей-офф (если матч относится к сетке)
        if m.bracket:
            try:
                from apps.tournaments.services.knockout import advance_winner
                advance_winner(m)
            except Exception as e:
                # Логируем ошибку, но не прерываем основной поток
                import logging
                import traceback
                logger = logging.getLogger(__name__)
                logger.error(f"Failed to advance winner for match {m.id}: {e}")
                logger.error(traceback.format_exc())
                # Возвращаем ошибку в ответе для отладки
                return Response({"ok": False, "error": f"Не удалось продвинуть победителя: {str(e)}"}, status=500)
        return Response({"ok": True, "match": MatchSerializer(m).data})

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="match_save_score_free_format", permission_classes=[IsAuthenticated])
    def match_save_score_free_format(self, request, pk=None):
        """
        Сохранить счёт матча в свободном формате.
        
        Ожидает JSON:
        {
            "match_id": int,
            "sets": [
                {
                    "index": 1,
                    "games_1": 5,
                    "games_2": 4,
                    "tb_loser_points": 3,  // Опционально, только очки проигравшего
                    "is_tiebreak_only": false  // Для чемпионского TB
                },
                ...
            ]
        }
        
        Backend автоматически рассчитывает очки победителя в TB.
        Для олимпийской системы валидирует возможность определения победителя.
        """
        from apps.tournaments.free_format_utils import (
            process_free_format_set,
            validate_knockout_winner,
            is_free_format
        )
        from django.utils import timezone
        from django.db import transaction as db_transaction
        
        tournament: Tournament = self.get_object()
        
        # Блокировка для завершённых турниров
        if tournament.status == Tournament.Status.COMPLETED:
            return Response({"error": "Турнир завершён, изменения запрещены"}, status=400)
        
        # Проверка формата турнира
        if not is_free_format(tournament.set_format):
            return Response({
                "error": "Этот endpoint только для турниров со свободным форматом"
            }, status=400)
        
        match_id = request.data.get("match_id")
        sets_data = request.data.get("sets", [])
        
        if not match_id:
            return Response({"error": "match_id обязателен"}, status=400)
        
        if not sets_data:
            return Response({"error": "Необходимо указать хотя бы один сет"}, status=400)
        
        try:
            m = Match.objects.get(id=int(match_id), tournament=tournament)
        except Match.DoesNotExist:
            return Response({"error": "Матч не найден"}, status=404)
        
        # Обработка сетов с автозаполнением TB
        try:
            processed_sets = []
            tiebreak_points = tournament.set_format.tiebreak_points
            decider_tiebreak_points = tournament.set_format.decider_tiebreak_points
            
            for set_data in sets_data:
                processed_set = process_free_format_set(set_data, tiebreak_points, decider_tiebreak_points)
                processed_sets.append(processed_set)
        except ValueError as e:
            return Response({"error": str(e)}, status=400)
        
        # Валидация победителя для олимпийской системы
        if tournament.system == Tournament.System.KNOCKOUT:
            valid, error_msg, winner_index = validate_knockout_winner(processed_sets)
            if not valid:
                return Response({"error": error_msg}, status=400)
        else:
            # Для круговой системы ничьи разрешены
            winner_index = None
            # Определяем победителя по разнице геймов (если есть)
            total_games_1 = sum(
                1 if s.get('is_tiebreak_only') and s.get('tb_1', 0) > s.get('tb_2', 0)
                else s.get('games_1', 0)
                for s in processed_sets
            )
            total_games_2 = sum(
                1 if s.get('is_tiebreak_only') and s.get('tb_2', 0) > s.get('tb_1', 0)
                else s.get('games_2', 0)
                for s in processed_sets
            )
            if total_games_1 > total_games_2:
                winner_index = 1
            elif total_games_2 > total_games_1:
                winner_index = 2
        
        # Сохранение в БД
        with db_transaction.atomic():
            # Удаляем старые сеты
            MatchSet.objects.filter(match=m).delete()
            
            # Создаём новые сеты
            for set_data in processed_sets:
                MatchSet.objects.create(
                    match=m,
                    index=set_data['index'],
                    games_1=set_data['games_1'],
                    games_2=set_data['games_2'],
                    tb_1=set_data.get('tb_1'),
                    tb_2=set_data.get('tb_2'),
                    is_tiebreak_only=set_data.get('is_tiebreak_only', False)
                )
            
            # Обновляем матч
            m.finished_at = timezone.now()
            m.status = Match.Status.COMPLETED
            
            if winner_index == 1:
                m.winner = m.team_1
            elif winner_index == 2:
                m.winner = m.team_2
            else:
                m.winner = None  # Ничья
            
            m.save(update_fields=["finished_at", "winner", "status", "updated_at"])
            
            # Продвинуть победителя в плей-офф (только для олимпийской)
            if m.bracket and winner_index:
                try:
                    from apps.tournaments.services.knockout import advance_winner
                    advance_winner(m)
                except Exception as e:
                    import logging
                    logger = logging.getLogger(__name__)
                    logger.error(f"Failed to advance winner for match {m.id}: {e}")
                    return Response({
                        "error": f"Не удалось продвинуть победителя: {str(e)}"
                    }, status=500)
        
        return Response({"ok": True, "match": MatchSerializer(m).data})

    @action(detail=True, methods=["get"])
    def group_stats(self, request, pk=None):
        tournament: Tournament = self.get_object()
        # Соберём список групп из участников (исключаем None для участников без позиции)
        from apps.tournaments.models import TournamentEntry
        group_indices = (
            TournamentEntry.objects.filter(tournament=tournament, group_index__isnull=False)
            .values_list("group_index", flat=True)
            .distinct()
        )

        from apps.tournaments.services.stats import _aggregate_for_group, rank_group_with_ruleset
        payload = {"ok": True, "groups": {}}
        for gi in group_indices:
            try:
                agg = _aggregate_for_group(tournament, gi)
                # Преобразуем defaultdict в обычный dict с int ключами
                group_block = {
                    int(team_id): {
                        "wins": data.get("wins", 0),
                        "sets_won": data.get("sets_won", 0),
                        "sets_lost": data.get("sets_lost", 0),
                        "sets_drawn": data.get("sets_drawn", 0),
                        "games_won": data.get("games_won", 0),
                        "games_lost": data.get("games_lost", 0),
                    }
                    for team_id, data in agg.items()
                }
                # Ранжирование согласно правилам Ruleset
                order = rank_group_with_ruleset(tournament, int(gi), agg)
                placements = { int(team_id): (idx + 1) for idx, team_id in enumerate(order) }
                payload["groups"][int(gi)] = { "stats": group_block, "placements": placements }
            except Exception:
                payload["groups"][int(gi)] = { "stats": {}, "placements": {} }
        return Response(payload)

    @method_decorator(csrf_exempt)
    @action(
        detail=False,
        methods=["post"],
        url_path="new",
        permission_classes=[IsAuthenticated],
    )
    def create_new(self, request):
        data = request.data or {}
        required = ["name", "date", "participant_mode", "set_format_id", "system", "ruleset_id"]
        missing = [k for k in required if not data.get(k)]
        if missing:
            return Response({"ok": False, "error": f"Не заполнены поля: {', '.join(missing)}"}, status=400)

        try:
            system = data["system"]
            # brackets_count только для олимпийки, иначе None
            brackets_count = None
            if system == Tournament.System.KNOCKOUT:
                brackets_count = int(data.get("brackets_count")) if data.get("brackets_count") else None

            tournament = Tournament.objects.create(
                name=data["name"],
                date=data["date"],
                participant_mode=data["participant_mode"],
                set_format_id=int(data["set_format_id"]),
                system=system,
                ruleset_id=int(data["ruleset_id"]),
                groups_count=int(data.get("groups_count") or 1),
                planned_participants=int(data.get("participants") or 0) or None,
                brackets_count=brackets_count,
                status=Tournament.Status.CREATED,
                is_rating_calc=bool(data.get("is_rating_calc", True)),
                prize_fund=data.get("prize_fund") or None,
            )
        except Exception as e:
            return Response({"ok": False, "error": str(e)}, status=400)

        return Response({"ok": True, "redirect": f"/tournaments/{tournament.id}/"})

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["get"], url_path="participants", permission_classes=[AllowAny])
    def get_participants(self, request, pk=None):
        """Получить список участников турнира для Drag-and-Drop."""
        tournament: Tournament = self.get_object()
        entries = tournament.entries.select_related('team__player_1', 'team__player_2').all()
        
        participants = []
        for entry in entries:
            team = entry.team
            name = str(team)
            
            # Получить full_name для отображения в списке участников
            full_name = name
            if team.player_1:
                p1 = team.player_1
                if team.player_2:
                    # Пара
                    p2 = team.player_2
                    full_name = f"{p1.last_name} {p1.first_name} / {p2.last_name} {p2.first_name}"
                else:
                    # Одиночка
                    full_name = f"{p1.last_name} {p1.first_name}"
            
            # Текущий рейтинг: для пар - средний, для одиночек - рейтинг игрока
            rating = 0
            try:
                if team.player_1 and team.player_2:
                    # Для пар - средний рейтинг
                    r1 = int(team.player_1.current_rating or 0)
                    r2 = int(team.player_2.current_rating or 0)
                    rating = round((r1 + r2) / 2) if (r1 > 0 or r2 > 0) else 0
                elif team.player_1:
                    # Для одиночек - рейтинг игрока
                    rating = int(team.player_1.current_rating or 0)
            except Exception:
                rating = 0
            
            participants.append({
                'id': entry.id,
                'name': full_name,  # Всегда полное ФИО для списка участников
                'team_id': team.id,
                'rating': rating,
                'isInBracket': False
            })
        
        return Response({'participants': participants})
    
    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["get"], url_path="brackets/(?P<bracket_id>[^/.]+)/bye_positions", permission_classes=[AllowAny])
    def get_bye_positions(self, request, pk=None, bracket_id=None):
        """Получить список позиций BYE для сетки."""
        tournament: Tournament = self.get_object()
        
        try:
            bracket = tournament.knockout_brackets.get(id=int(bracket_id))
            bye_positions = DrawPosition.objects.filter(
                bracket=bracket,
                source='BYE'
            ).values_list('position', flat=True)
            
            return Response({'bye_positions': list(bye_positions)})
        except KnockoutBracket.DoesNotExist:
            return Response({'ok': False, 'error': 'Сетка не найдена'}, status=404)
    
    @method_decorator(csrf_exempt)
    @action(detail=True, methods=['post'], url_path='regenerate_group_schedule', permission_classes=[AllowAny])
    def regenerate_group_schedule(self, request, pk=None):
        """POST /api/tournaments/{id}/regenerate_group_schedule/
        
        Обновляет шаблон расписания для указанной группы.
        Если турнир не зафиксирован - только сохраняет выбор в group_schedule_patterns.
        Если турнир зафиксирован - пересоздает матчи с новым шаблоном.
        
        Body: {
            "group_name": "Группа 1",
            "pattern_id": 5
        }
        """
        tournament: Tournament = self.get_object()
        
        # Блокировка для завершённых турниров
        if tournament.status == Tournament.Status.COMPLETED:
            return Response(
                {'error': 'Турнир завершён, изменения запрещены'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Проверка системы турнира
        if tournament.system not in [Tournament.System.ROUND_ROBIN, Tournament.System.KING]:
            return Response(
                {'error': 'Этот endpoint только для круговой системы и King'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        group_name = request.data.get('group_name')
        pattern_id = request.data.get('pattern_id')
        
        if not group_name:
            return Response(
                {'error': 'Параметр group_name обязателен'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        if not pattern_id:
            return Response(
                {'error': 'Параметр pattern_id обязателен'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Получаем шаблон
        try:
            pattern = SchedulePattern.objects.get(pk=int(pattern_id))
        except SchedulePattern.DoesNotExist:
            return Response(
                {'error': 'Шаблон расписания не найден'},
                status=status.HTTP_404_NOT_FOUND
            )
        
        # Проверка системы турнира в шаблоне
        expected_system = SchedulePattern.TournamentSystem.KING if tournament.system == Tournament.System.KING else SchedulePattern.TournamentSystem.ROUND_ROBIN
        if pattern.tournament_system != expected_system:
            system_name = 'King' if tournament.system == Tournament.System.KING else 'круговой системы'
            return Response(
                {'error': f'Шаблон не предназначен для {system_name}'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Получаем количество участников в группе
        group_index = int(group_name.split()[-1])
        if tournament.status == Tournament.Status.ACTIVE:
            # Для активного турнира сверяемся с фактическими участниками
            participants_count = TournamentEntry.objects.filter(
                tournament=tournament,
                group_index=group_index
            ).count()
        else:
            # Для неактивного турнира используем плановый размер группы
            groups_count = max(1, tournament.groups_count or 1)
            planned_total = int(tournament.planned_participants or 0)
            base = planned_total // groups_count
            remainder = planned_total % groups_count
            # Индексы групп 1..groups_count, первые 'remainder' групп получают +1
            participants_count = base + (1 if group_index <= remainder else 0)
        
        # Проверка количества участников для кастомных шаблонов (± 1)
        if pattern.pattern_type == SchedulePattern.PatternType.CUSTOM and pattern.participants_count:
            if participants_count != pattern.participants_count and participants_count != pattern.participants_count - 1:
                return Response(
                    {
                        'error': f'Шаблон рассчитан на {pattern.participants_count} или {pattern.participants_count - 1} участников, '
                                f'а в группе {participants_count}'
                    },
                    status=status.HTTP_400_BAD_REQUEST
                )
        
        try:
            with transaction.atomic():
                # Сохраняем выбор шаблона
                if not tournament.group_schedule_patterns:
                    tournament.group_schedule_patterns = {}
                tournament.group_schedule_patterns[group_name] = pattern_id
                tournament.save(update_fields=['group_schedule_patterns'])
                
                # Если турнир зафиксирован (статус ACTIVE) - пересоздаем матчи
                if tournament.status == Tournament.Status.ACTIVE:
                    # Удаляем старые незавершенные матчи группы
                    deleted_count = Match.objects.filter(
                        tournament=tournament,
                        round_name=group_name,
                        status=Match.Status.SCHEDULED
                    ).delete()[0]
                    
                    # Генерируем новое расписание
                    generated = generate_matches_for_group(tournament, group_name, pattern)
                    created_count = persist_generated_matches(tournament, generated)
                    
                    return Response({
                        'ok': True,
                        'deleted': deleted_count,
                        'created': created_count,
                        'pattern': SchedulePatternSerializer(pattern).data
                    })
                else:
                    # Турнир не зафиксирован - только сохраняем выбор
                    return Response({
                        'ok': True,
                        'deleted': 0,
                        'created': 0,
                        'pattern': SchedulePatternSerializer(pattern).data
                    })
                
        except Exception as e:
            return Response(
                {'error': f'Ошибка при обновлении расписания: {str(e)}'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR
            )

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="brackets/(?P<bracket_id>[^/.]+)/assign_participant", permission_classes=[IsAuthenticated])
    def assign_participant(self, request, pk=None, bracket_id=None):
        """Назначить участника в слот сетки."""
        tournament: Tournament = self.get_object()
        
        # Блокировка для завершённых турниров
        if tournament.status == Tournament.Status.COMPLETED:
            return Response({"error": "Турнир завершён, изменения запрещены"}, status=400)
        match_id = request.data.get('match_id')
        slot = request.data.get('slot')
        participant_id = request.data.get('participant_id')
        
        if not all([match_id, slot, participant_id]):
            return Response({'ok': False, 'error': 'Недостаточно параметров'}, status=400)
        
        if slot not in ['team_1', 'team_2']:
            return Response({'ok': False, 'error': 'Неверный слот'}, status=400)
        
        try:
            bracket = tournament.knockout_brackets.get(id=int(bracket_id))
            match = Match.objects.get(id=match_id, bracket=bracket)
            entry = TournamentEntry.objects.get(id=participant_id, tournament=tournament)
            
            current_team_id = getattr(match, slot + '_id')
            if current_team_id:
                return Response({'ok': False, 'error': 'Слот уже занят'}, status=400)
            
            setattr(match, slot, entry.team)
            match.save(update_fields=[slot])

            # Обновить DrawPosition для конкретной позиции первого раунда
            # Позиции считаются так же, как на фронте: (order_in_round - 1) * 2 + (1/2)
            from apps.tournaments.models import DrawPosition

            order_in_round = match.order_in_round or 1
            base_pos = (order_in_round - 1) * 2
            position = base_pos + (1 if slot == 'team_1' else 2)

            draw_pos, _ = DrawPosition.objects.get_or_create(
                bracket=bracket,
                position=position,
                defaults={
                    'entry': entry,
                    'source': DrawPosition.Source.MAIN,
                },
            )
            if draw_pos.entry_id != entry.id:
                draw_pos.entry = entry
                # При ручном назначении сбрасываем посев, чтобы не оставлять "висячие" seed-значения
                draw_pos.seed = None
                if draw_pos.source == DrawPosition.Source.BYE:
                    draw_pos.source = DrawPosition.Source.MAIN
                draw_pos.save(update_fields=['entry', 'seed', 'source'])
            
            return Response({'ok': True})
            
        except (KnockoutBracket.DoesNotExist, Match.DoesNotExist, TournamentEntry.DoesNotExist) as e:
            return Response({'ok': False, 'error': str(e)}, status=404)
        except Exception as e:
            return Response({'ok': False, 'error': str(e)}, status=500)

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["delete"], url_path="brackets/(?P<bracket_id>[^/.]+)/remove_participant", permission_classes=[IsAuthenticated])
    def remove_participant(self, request, pk=None, bracket_id=None):
        """Удалить участника из слота сетки."""
        tournament: Tournament = self.get_object()
        match_id = request.data.get('match_id')
        slot = request.data.get('slot')
        
        if not all([match_id, slot]):
            return Response({'ok': False, 'error': 'Недостаточно параметров'}, status=400)
        
        if slot not in ['team_1', 'team_2']:
            return Response({'ok': False, 'error': 'Неверный слот'}, status=400)
        
        try:
            bracket = tournament.knockout_brackets.get(id=int(bracket_id))
            match = Match.objects.get(id=match_id, bracket=bracket)
            
            setattr(match, slot, None)
            match.save(update_fields=[slot])

            # Очистить соответствующую позицию в DrawPosition, чтобы entry_id стал NULL
            from apps.tournaments.models import DrawPosition

            order_in_round = match.order_in_round or 1
            base_pos = (order_in_round - 1) * 2
            position = base_pos + (1 if slot == 'team_1' else 2)

            DrawPosition.objects.filter(bracket=bracket, position=position).update(
                entry=None,
                seed=None,
                source=DrawPosition.Source.MAIN,
            )
            
            return Response({'ok': True})
            
        except (KnockoutBracket.DoesNotExist, Match.DoesNotExist) as e:
            return Response({'ok': False, 'error': str(e)}, status=404)
        except Exception as e:
            return Response({'ok': False, 'error': str(e)}, status=500)

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="add_participant", permission_classes=[IsAuthenticated])
    def add_participant(self, request, pk=None):
        """Добавить нового участника в турнир."""
        tournament: Tournament = self.get_object()
        
        # Блокировка для завершённых турниров
        if tournament.status == Tournament.Status.COMPLETED:
            return Response({"error": "Турнир завершён, изменения запрещены"}, status=400)
        
        # Проверка максимального количества участников (только предупреждение, не блокировка)
        # Организатор может добавлять участников сверх лимита при необходимости
        
        name = request.data.get('name')
        player_id = request.data.get('player_id')
        player1_id = request.data.get('player1_id')
        player2_id = request.data.get('player2_id')
        
        if not name and not (player1_id and player2_id):
            return Response({'ok': False, 'error': 'Не указано имя или игроки'}, status=400)
        
        try:
            with transaction.atomic():
                # Проверка, не участвует ли уже игрок в турнире
                existing_entries = tournament.entries.select_related('team').all()
                
                if player_id:
                    # Одиночный игрок
                    player = Player.objects.get(id=player_id)
                    
                    # Проверка дубликата
                    for entry in existing_entries:
                        if entry.team.player_1_id == player.id and not entry.team.player_2_id:
                            return Response({
                                'ok': False, 
                                'error': f'{player.display_name} уже участвует в турнире'
                            }, status=400)
                    
                    # Найти или создать команду для этого игрока
                    team = Team.objects.filter(player_1=player, player_2__isnull=True).first()
                    if not team:
                        team = Team.objects.create(player_1=player)
                    
                elif player1_id and player2_id:
                    # Пара игроков
                    player1 = Player.objects.get(id=player1_id)
                    player2 = Player.objects.get(id=player2_id)
                    
                    # Проверка дубликата
                    for entry in existing_entries:
                        team_players = {entry.team.player_1_id, entry.team.player_2_id}
                        if team_players == {player1.id, player2.id}:
                            return Response({
                                'ok': False, 
                                'error': f'Пара {player1.display_name}/{player2.display_name} уже участвует'
                            }, status=400)
                    
                    # Найти или создать команду для этой пары
                    team = Team.objects.filter(
                        player_1=player1, player_2=player2
                    ).first() or Team.objects.filter(
                        player_1=player2, player_2=player1
                    ).first()
                    
                    if not team:
                        team = Team.objects.create(player_1=player1, player_2=player2)
                else:
                    # Создание нового игрока
                    names = name.split(maxsplit=1)
                    player = Player.objects.create(
                        last_name=names[0] if names else name,
                        first_name=names[1] if len(names) > 1 else '',
                        display_name=name,
                        current_rating=1000
                    )
                    team = Team.objects.create(player_1=player)
                
                # Для круговой системы и King в статусе created участники добавляются БЕЗ позиции
                # (они попадут в левый список для drag-and-drop)
                if tournament.system in [Tournament.System.ROUND_ROBIN, Tournament.System.KING] and tournament.status == Tournament.Status.CREATED:
                    entry = TournamentEntry.objects.create(
                        tournament=tournament,
                        team=team,
                        group_index=None,
                        row_index=None,
                        is_out_of_competition=False
                    )
                else:
                    # Для других систем или статусов - найти первый свободный row_index
                    existing_entries = tournament.entries.all()
                    used_positions = set(existing_entries.values_list('row_index', flat=True))
                    
                    # Найти первую свободную позицию от 1 до planned_participants
                    max_participants = tournament.planned_participants or 32
                    row_index = 1
                    for i in range(1, max_participants + 1):
                        if i not in used_positions:
                            row_index = i
                            break
                    
                    # Создать запись участника
                    entry = TournamentEntry.objects.create(
                        tournament=tournament,
                        team=team,
                        group_index=1,
                        row_index=row_index,
                        is_out_of_competition=False
                    )
                
                return Response({
                    'ok': True,
                    'id': entry.id,
                    'name': str(team),
                    'team_id': team.id
                })
                
        except Player.DoesNotExist:
            return Response({'ok': False, 'error': 'Игрок не найден'}, status=404)
        except Exception as e:
            return Response({'ok': False, 'error': str(e)}, status=500)

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="brackets/(?P<bracket_id>[^/.]+)/lock_participants", permission_classes=[IsAuthenticated])
    def lock_bracket_participants(self, request, pk=None, bracket_id=None):
        """Зафиксировать участников в сетке."""
        from apps.tournaments.models import DrawPosition
        tournament: Tournament = self.get_object()
        
        # Блокировка для завершённых турниров
        if tournament.status == Tournament.Status.COMPLETED:
            return Response({"error": "Турнир завершён, изменения запрещены"}, status=400)
        slots_data = request.data.get('slots', [])
        
        if not slots_data:
            return Response({'ok': False, 'error': 'Не указаны слоты'}, status=400)
        
        try:
            bracket = tournament.knockout_brackets.get(id=int(bracket_id))
            
            with transaction.atomic():
                # Собрать текущее состояние матчей для проверки изменений
                existing_matches = {}
                for match in Match.objects.filter(bracket=bracket, round_index=0):
                    existing_matches[match.id] = {
                        'team_1_id': match.team_1_id,
                        'team_2_id': match.team_2_id
                    }
                
                # Обновить матчи первого раунда
                changes_detected = False
                for slot_info in slots_data:
                    match_id = slot_info.get('match_id')
                    slot = slot_info.get('slot')
                    participant_id = slot_info.get('participant_id')
                    
                    if not match_id or not slot:
                        continue
                    
                    try:
                        match = Match.objects.get(id=match_id, bracket=bracket)
                        
                        # Получить команду из TournamentEntry
                        team = None
                        if participant_id:
                            entry = TournamentEntry.objects.get(id=participant_id, tournament=tournament)
                            team = entry.team
                        
                        # Проверить изменения
                        old_team_id = existing_matches.get(match_id, {}).get(f'{slot}_id')
                        new_team_id = team.id if team else None
                        
                        if old_team_id != new_team_id:
                            changes_detected = True
                            
                            # Если участник изменился - очистить победителя и следующие раунды
                            if old_team_id:
                                # Очистить winner если это был старый участник
                                if match.winner_id == old_team_id:
                                    match.winner = None
                                    match.status = Match.Status.SCHEDULED
                                
                                # Убрать старого участника из следующего раунда
                                next_order = (match.order_in_round + 1) // 2
                                next_round = (match.round_index or 0) + 1
                                target_slot = 'team_1' if (match.order_in_round % 2 == 1) else 'team_2'
                                next_match = Match.objects.filter(
                                    bracket=match.bracket,
                                    round_index=next_round,
                                    is_third_place=False,
                                    order_in_round=next_order,
                                ).first()
                                if next_match:
                                    setattr(next_match, target_slot, None)
                                    next_match.save(update_fields=[target_slot])
                            
                            # Также очистить winner если это был другой участник из этого матча
                            other_slot = 'team_2' if slot == 'team_1' else 'team_1'
                            other_team_id = getattr(match, other_slot + '_id')
                            if match.winner_id and match.winner_id in [old_team_id, other_team_id]:
                                match.winner = None
                                match.status = Match.Status.SCHEDULED
                        
                        # Установить команду
                        setattr(match, slot, team)
                        
                        # Проверить автопродвижение для BYE
                        # Если один из слотов NULL (BYE), автоматически продвинуть другого участника
                        other_slot = 'team_2' if slot == 'team_1' else 'team_1'
                        other_team = getattr(match, other_slot)

                        # Автопродвижение допускается только в первом раунде и только если противоположная позиция — BYE
                        is_bye_counterpart = False
                        if (match.round_index or 0) == 0:
                            # Определяем позиции team_1/team_2 в первом раунде
                            current_pos = ((match.order_in_round - 1) * 2) + (1 if slot == 'team_1' else 2)
                            other_pos = ((match.order_in_round - 1) * 2) + (2 if slot == 'team_1' else 1)
                            is_bye_counterpart = DrawPosition.objects.filter(
                                bracket=match.bracket,
                                position=other_pos,
                                source='BYE',
                            ).exists()

                        if is_bye_counterpart and (team is None or other_team is None):
                            # Противоположная позиция — BYE, автоматически продвигаем другого
                            winner = team if team else other_team
                            if winner:
                                match.winner = winner
                                match.status = Match.Status.COMPLETED

                                # Продвинуть в следующий раунд
                                next_order = (match.order_in_round + 1) // 2
                                next_round = (match.round_index or 0) + 1
                                target_slot = 'team_1' if (match.order_in_round % 2 == 1) else 'team_2'
                                next_match = Match.objects.filter(
                                    bracket=match.bracket,
                                    round_index=next_round,
                                    is_third_place=False,
                                    order_in_round=next_order,
                                ).first()
                                if next_match:
                                    setattr(next_match, target_slot, winner)
                                    next_match.save(update_fields=[target_slot])
                        
                        match.save(update_fields=[slot, 'winner', 'status'])
                        
                        # Обновить DrawPosition (по позиции в сетке)
                        if participant_id:
                            from apps.tournaments.models import DrawPosition
                            # Определить позицию: для первого раунда позиция начинается с 1
                            # order_in_round начинается с 1 (не с 0)
                            # Для матча 1: team_1 → position=1, team_2 → position=2
                            # Для матча 2: team_1 → position=3, team_2 → position=4
                            position = ((match.order_in_round - 1) * 2) + (1 if slot == 'team_1' else 2)
                            
                            # Удалить старые записи для этой позиции перед созданием новой
                            DrawPosition.objects.filter(bracket=bracket, position=position).delete()
                            
                            draw_pos, created = DrawPosition.objects.get_or_create(
                                bracket=bracket,
                                position=position,
                                defaults={'entry': entry, 'source': DrawPosition.Source.MAIN}
                            )
                            
                            if not created and draw_pos.entry != entry:
                                draw_pos.entry = entry
                                draw_pos.save(update_fields=['entry'])
                            
                    except (Match.DoesNotExist, TournamentEntry.DoesNotExist):
                        continue
                
                # Изменить статус турнира на active при фиксации
                if tournament.status == Tournament.Status.CREATED:
                    # Автоматически рассчитываем коэффициент турнира
                    from apps.tournaments.services.coefficient_calculator import auto_calculate_tournament_coefficient
                    try:
                        auto_calculate_tournament_coefficient(tournament.id)
                    except Exception as e:
                        import logging
                        logging.getLogger(__name__).warning(f"Не удалось рассчитать коэффициент турнира {tournament.id}: {e}")
                    
                    tournament.status = Tournament.Status.ACTIVE
                    tournament.save(update_fields=['status'])
                
                return Response({'ok': True, 'changes_detected': changes_detected})
                
        except KnockoutBracket.DoesNotExist:
            return Response({'ok': False, 'error': 'Сетка не найдена'}, status=404)
        except Exception as e:
            return Response({'ok': False, 'error': str(e)}, status=500)

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="brackets/(?P<bracket_id>[^/.]+)/unlock_participants", permission_classes=[IsAuthenticated])
    def unlock_bracket_participants(self, request, pk=None, bracket_id=None):
        """Снять фиксацию участников в сетке - изменить статус турнира на created."""
        tournament: Tournament = self.get_object()
        
        try:
            bracket = tournament.knockout_brackets.get(id=int(bracket_id))
            
            # Изменить статус турнира на created при снятии фиксации
            if tournament.status == Tournament.Status.ACTIVE:
                tournament.status = Tournament.Status.CREATED
                tournament.save(update_fields=['status'])
            
            return Response({'ok': True})
            
        except KnockoutBracket.DoesNotExist:
            return Response({'ok': False, 'error': 'Сетка не найдена'}, status=404)
        except Exception as e:
            return Response({'ok': False, 'error': str(e)}, status=500)

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["delete"], url_path="brackets/(?P<bracket_id>[^/.]+)/remove_from_slot", permission_classes=[IsAuthenticated])
    def remove_from_slot(self, request, pk=None, bracket_id=None):
        """Удалить участника из слота матча."""
        tournament: Tournament = self.get_object()
        match_id = request.data.get('match_id')
        slot = request.data.get('slot')
        
        if not match_id or not slot:
            return Response({'ok': False, 'error': 'Не указаны match_id или slot'}, status=400)
        
        if slot not in ['team_1', 'team_2']:
            return Response({'ok': False, 'error': 'Неверный слот'}, status=400)
        
        try:
            bracket = tournament.knockout_brackets.get(id=int(bracket_id))
            match = Match.objects.get(id=match_id, bracket=bracket)
            
            # Очистить слот
            setattr(match, slot, None)
            match.save(update_fields=[slot])
            
            return Response({'ok': True})
            
        except (KnockoutBracket.DoesNotExist, Match.DoesNotExist) as e:
            return Response({'ok': False, 'error': str(e)}, status=404)
        except Exception as e:
            return Response({'ok': False, 'error': str(e)}, status=500)

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="set_participant_position", permission_classes=[IsAuthenticated])
    def set_participant_position(self, request, pk=None):
        """Установить позицию существующего участника в группе.
        
        Body (JSON):
        {
          "entry_id": 123,
          "group_index": 1,
          "row_index": 0
        }
        """
        tournament: Tournament = self.get_object()
        self._ensure_can_manage_match(request, tournament)
        
        entry_id = request.data.get('entry_id')
        group_index = request.data.get('group_index')
        row_index = request.data.get('row_index')
        
        if not entry_id or group_index is None or row_index is None:
            return Response({'ok': False, 'error': 'Не указаны обязательные параметры'}, status=400)
        
        try:
            entry = TournamentEntry.objects.get(id=entry_id, tournament=tournament)
            
            # Проверить, не занята ли позиция
            existing = TournamentEntry.objects.filter(
                tournament=tournament,
                group_index=group_index,
                row_index=row_index
            ).exclude(id=entry_id).first()
            
            if existing:
                return Response({'ok': False, 'error': 'Позиция уже занята'}, status=400)
            
            # Установить позицию
            entry.group_index = group_index
            entry.row_index = row_index
            entry.save(update_fields=['group_index', 'row_index'])
            
            return Response({'ok': True})
        except TournamentEntry.DoesNotExist:
            return Response({'ok': False, 'error': 'Участник не найден'}, status=404)
        except Exception as e:
            return Response({'ok': False, 'error': str(e)}, status=500)

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="clear_participant_position", permission_classes=[IsAuthenticated])
    def clear_participant_position(self, request, pk=None):
        """Очистить позицию участника (убрать из таблицы, но оставить в турнире).
        
        Body (JSON):
        {
          "entry_id": 123
        }
        """
        tournament: Tournament = self.get_object()
        self._ensure_can_manage_match(request, tournament)
        
        entry_id = request.data.get('entry_id')
        
        if not entry_id:
            return Response({'ok': False, 'error': 'Не указан entry_id'}, status=400)
        
        try:
            entry = TournamentEntry.objects.get(id=entry_id, tournament=tournament)
            
            # Очистить позицию (установить в None или -1)
            entry.group_index = None
            entry.row_index = None
            entry.save(update_fields=['group_index', 'row_index'])
            
            return Response({'ok': True})
        except TournamentEntry.DoesNotExist:
            return Response({'ok': False, 'error': 'Участник не найден'}, status=404)
        except Exception as e:
            return Response({'ok': False, 'error': str(e)}, status=500)

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["delete"], url_path="remove_participant", permission_classes=[IsAuthenticated])
    def remove_participant_from_tournament(self, request, pk=None):
        """Удалить участника из турнира."""
        tournament: Tournament = self.get_object()
        entry_id = request.data.get('entry_id')
        
        if not entry_id:
            return Response({'ok': False, 'error': 'Не указан entry_id'}, status=400)
        
        try:
            entry = TournamentEntry.objects.get(id=entry_id, tournament=tournament)
            entry.delete()
            return Response({'ok': True})
        except TournamentEntry.DoesNotExist:
            return Response({'ok': False, 'error': 'Участник не найден'}, status=404)
        except Exception as e:
            return Response({'ok': False, 'error': str(e)}, status=500)

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="auto_seed", permission_classes=[IsAuthenticated])
    def auto_seed(self, request, pk=None):
        """Автоматический посев участников по группам с учетом рейтинга.
        
        Алгоритм:
        1. Сортировка участников по убыванию рейтинга (с учетом is_profi, rating_btr)
        2. Если группа одна - проставляем по порядку
        3. Если групп несколько - распределяем отрезками:
           - Первый отрезок (размер = кол-во групп) - по одному в каждую группу на 1-е место
           - Второй отрезок - по одному в каждую группу на 2-е место (случайный порядок групп)
           - И т.д.
        """
        tournament: Tournament = self.get_object()
        
        # Блокировка для завершённых турниров
        if tournament.status == Tournament.Status.COMPLETED:
            return Response({"error": "Турнир завершён, изменения запрещены"}, status=400)
        
        if tournament.system not in [Tournament.System.ROUND_ROBIN, Tournament.System.KING]:
            return Response({'ok': False, 'error': 'Автопосев доступен только для круговой системы и King'}, status=400)
        
        try:
            import random
            from django.db.models import Q
            
            # Сначала очищаем все позиции (аналог "Очистить таблицы")
            tournament.entries.filter(
                group_index__isnull=False
            ).update(
                group_index=None,
                row_index=None
            )
            
            # Получаем всех участников (теперь все без позиции) с prefetch для BTR
            entries = list(tournament.entries.select_related(
                'team__player_1__btr_player', 
                'team__player_2__btr_player'
            ).prefetch_related(
                'team__player_1__btr_player__snapshots',
                'team__player_2__btr_player__snapshots'
            ).all())
            
            if not entries:
                return Response({'ok': False, 'error': 'Нет участников для посева'}, status=400)
            
            # Функция для вычисления рейтинга участника (BP)
            def get_entry_rating(entry):
                team = entry.team
                if not team:
                    return 0
                
                # Для одиночек
                if team.player_1 and not team.player_2:
                    return team.player_1.current_rating or 0
                
                # Для пар - средний рейтинг
                if team.player_1 and team.player_2:
                    r1 = team.player_1.current_rating or 0
                    r2 = team.player_2.current_rating or 0
                    return (r1 + r2) / 2
                
                return 0
            
            # Функция для подсчета профи в команде
            def count_profi(entry):
                team = entry.team
                if not team:
                    return 0
                
                count = 0
                if team.player_1 and hasattr(team.player_1, 'is_profi') and team.player_1.is_profi:
                    count += 1
                if team.player_2 and hasattr(team.player_2, 'is_profi') and team.player_2.is_profi:
                    count += 1
                
                return count
            
            # Функция для получения рейтинга BTR
            def get_btr_rating(entry):
                team = entry.team
                if not team:
                    return 0
                
                def get_player_btr(player):
                    """Получить последний BTR рейтинг игрока в категории men_double или women_double"""
                    if not player or not hasattr(player, 'btr_player') or not player.btr_player:
                        return 0
                    
                    # Определяем категорию по полу игрока
                    if player.gender == 'male':
                        category = 'men_double'
                    elif player.gender == 'female':
                        category = 'women_double'
                    else:
                        return 0
                    
                    # Получаем последний снимок рейтинга в нужной категории
                    try:
                        from apps.btr.models import BtrRatingSnapshot
                        snapshot = BtrRatingSnapshot.objects.filter(
                            player=player.btr_player,
                            category=category
                        ).order_by('-rating_date').first()
                        
                        return snapshot.rating_value if snapshot else 0
                    except Exception:
                        return 0
                
                # Для одиночек
                if team.player_1 and not team.player_2:
                    return get_player_btr(team.player_1)
                
                # Для пар - средний рейтинг BTR
                if team.player_1 and team.player_2:
                    r1 = get_player_btr(team.player_1)
                    r2 = get_player_btr(team.player_2)
                    return (r1 + r2) / 2
                
                return 0
            
            # Сортировка участников
            def sort_key(entry):
                rating = get_entry_rating(entry)
                profi_count = count_profi(entry)
                btr = get_btr_rating(entry)
                rand = random.random()  # Для случайного порядка при равных показателях
                
                # Сортируем по убыванию: (-rating, -profi_count, -btr, rand)
                return (-rating, -profi_count, -btr, rand)
            
            sorted_entries = sorted(entries, key=sort_key)
            
            # Логирование для отладки
            import logging
            logger = logging.getLogger(__name__)
            logger.info(f"Auto-seed: {len(sorted_entries)} entries")
            for idx, entry in enumerate(sorted_entries[:5]):  # Первые 5 для примера
                rating = get_entry_rating(entry)
                profi = count_profi(entry)
                btr = get_btr_rating(entry)
                logger.info(f"  {idx+1}. {entry.team} - Rating: {rating}, Profi: {profi}, BTR: {btr}")
            
            groups_count = tournament.groups_count or 1
            
            if groups_count == 1:
                # Одна группа - просто проставляем по порядку
                for idx, entry in enumerate(sorted_entries):
                    entry.group_index = 1
                    entry.row_index = idx + 1  # 1-based индексация (1, 2, 3...)
                    entry.save(update_fields=['group_index', 'row_index'])
            else:
                # Несколько групп - распределяем отрезками
                segment_size = groups_count
                segments = []
                
                # Разбиваем на отрезки
                for i in range(0, len(sorted_entries), segment_size):
                    segments.append(sorted_entries[i:i + segment_size])
                
                # Распределяем по группам
                for row_idx, segment in enumerate(segments):
                    # Создаем список доступных групп
                    available_groups = list(range(1, groups_count + 1))
                    
                    # Для первого отрезка - по порядку
                    if row_idx == 0:
                        for i, entry in enumerate(segment):
                            entry.group_index = available_groups[i]
                            entry.row_index = row_idx + 1  # 1-based индексация (1, 2, 3...)
                            entry.save(update_fields=['group_index', 'row_index'])
                    else:
                        # Для остальных отрезков - случайный порядок групп
                        random.shuffle(available_groups)
                        
                        for i, entry in enumerate(segment):
                            if i < len(available_groups):
                                entry.group_index = available_groups[i]
                                entry.row_index = row_idx + 1  # 1-based индексация (1, 2, 3...)
                                entry.save(update_fields=['group_index', 'row_index'])
            
            return Response({'ok': True, 'seeded_count': len(sorted_entries)})
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            return Response({'ok': False, 'error': str(e)}, status=500)

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="clear_tables", permission_classes=[IsAuthenticated])
    def clear_tables(self, request, pk=None):
        """Очистить таблицы - убрать всех участников из позиций (group_index=None, row_index=None)."""
        tournament: Tournament = self.get_object()
        
        # Блокировка для завершённых турниров
        if tournament.status == Tournament.Status.COMPLETED:
            return Response({"error": "Турнир завершён, изменения запрещены"}, status=400)
        
        if tournament.system not in [Tournament.System.ROUND_ROBIN, Tournament.System.KING]:
            return Response({'ok': False, 'error': 'Очистка таблиц доступна только для круговой системы и King'}, status=400)
        
        try:
            # Обновляем всех участников - убираем позиции
            updated_count = tournament.entries.filter(
                group_index__isnull=False
            ).update(
                group_index=None,
                row_index=None
            )
            
            return Response({'ok': True, 'cleared_count': updated_count})
            
        except Exception as e:
            import traceback
            traceback.print_exc()
            return Response({'ok': False, 'error': str(e)}, status=500)

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="assign_participant", permission_classes=[IsAuthenticated])
    def assign_participant_to_table(self, request, pk=None):
        """Назначить участника в позицию таблицы (для круговой системы и King)."""
        tournament: Tournament = self.get_object()
        
        # Блокировка для завершённых турниров
        if tournament.status == Tournament.Status.COMPLETED:
            return Response({"error": "Турнир завершён, изменения запрещены"}, status=400)
        
        if tournament.system not in [Tournament.System.ROUND_ROBIN, Tournament.System.KING]:
            return Response({'ok': False, 'error': 'Этот эндпоинт доступен только для круговой системы и King'}, status=400)
        
        entry_id = request.data.get('entry_id')
        group_index = request.data.get('group_index')
        row_index = request.data.get('row_index')
        
        if not all([entry_id, group_index is not None, row_index is not None]):
            return Response({'ok': False, 'error': 'Недостаточно параметров'}, status=400)
        
        try:
            entry = TournamentEntry.objects.get(id=entry_id, tournament=tournament)
            
            # Проверяем, не занята ли позиция
            existing = TournamentEntry.objects.filter(
                tournament=tournament,
                group_index=group_index,
                row_index=row_index
            ).exclude(id=entry_id).first()
            
            if existing:
                return Response({'ok': False, 'error': 'Эта позиция уже занята'}, status=400)
            
            # Назначаем позицию
            entry.group_index = group_index
            entry.row_index = row_index
            entry.save(update_fields=['group_index', 'row_index'])
            
            return Response({'ok': True})
            
        except TournamentEntry.DoesNotExist:
            return Response({'ok': False, 'error': 'Участник не найден'}, status=404)
        except Exception as e:
            import traceback
            traceback.print_exc()
            return Response({'ok': False, 'error': str(e)}, status=500)

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="remove_participant_from_slot", permission_classes=[IsAuthenticated])
    def remove_participant_from_slot(self, request, pk=None):
        """Удалить участника из позиции таблицы (для круговой системы и King)."""
        tournament: Tournament = self.get_object()
        
        # Блокировка для завершённых турниров
        if tournament.status == Tournament.Status.COMPLETED:
            return Response({"error": "Турнир завершён, изменения запрещены"}, status=400)
        
        if tournament.system not in [Tournament.System.ROUND_ROBIN, Tournament.System.KING]:
            return Response({'ok': False, 'error': 'Этот эндпоинт доступен только для круговой системы и King'}, status=400)
        
        entry_id = request.data.get('entry_id')
        
        if not entry_id:
            return Response({'ok': False, 'error': 'Не указан entry_id'}, status=400)
        
        try:
            entry = TournamentEntry.objects.get(id=entry_id, tournament=tournament)
            
            # Убираем позицию
            entry.group_index = None
            entry.row_index = None
            entry.save(update_fields=['group_index', 'row_index'])
            
            return Response({'ok': True})
            
        except TournamentEntry.DoesNotExist:
            return Response({'ok': False, 'error': 'Участник не найден'}, status=404)
        except Exception as e:
            import traceback
            traceback.print_exc()
            return Response({'ok': False, 'error': str(e)}, status=500)


class ParticipantViewSet(viewsets.ModelViewSet):
    queryset = TournamentEntry.objects.all()
    serializer_class = ParticipantSerializer


class MatchViewSet(viewsets.ModelViewSet):
    queryset = Match.objects.all()
    serializer_class = MatchSerializer

    # Заглушка для сохранения счёта — в текущей модели счёт детализирован по сетам,
    # поэтому этот метод будет реализован отдельно. Пока просто возвращаем объект.
    @action(detail=True, methods=["post"])
    def save_score(self, request, pk=None):
        match = self.get_object()
        return Response(MatchSerializer(match).data)


class PlayerListView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        players = Player.objects.all().order_by("last_name", "first_name")
        serializer = PlayerSerializer(players, many=True)
        return Response({"players": serializer.data})


class PlayerSearchView(APIView):
    permission_classes = [IsAuthenticated]
    def get(self, request):
        query = request.GET.get("q", "")
        if query:
            players = (
                Player.objects.filter(
                    Q(first_name__icontains=query)
                    | Q(last_name__icontains=query)
                    | Q(display_name__icontains=query)
                )
                .order_by("last_name", "first_name")
                .all()[:10]
            )
        else:
            players = Player.objects.none()

        serializer = PlayerSerializer(players, many=True)
        return Response({"players": serializer.data})


@method_decorator(csrf_exempt, name='dispatch')
class PlayerCreateView(APIView):
    permission_classes = [IsAuthenticated]
    def post(self, request):
        serializer = PlayerSerializer(data=request.data)
        if serializer.is_valid():
            player = serializer.save()
            return Response(PlayerSerializer(player).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


# --- Function-based endpoints для страницы списка турниров (overview) ---


@api_view(["GET"])
@authentication_classes([JWTAuthentication])
@permission_classes([AllowAny])
def tournament_list(request):
    """Сводный список турниров: активные и история с пагинацией и фильтрацией."""
    today = timezone.now().date()
    
    # Параметры пагинации для завершенных турниров
    history_offset = int(request.GET.get('history_offset', 0))
    history_limit = int(request.GET.get('history_limit', 20))
    
    # Параметры фильтрации
    name_filter = request.GET.get('name', '').strip()
    system_filter = request.GET.get('system', '').strip()  # 'round_robin' или 'knockout'
    mode_filter = request.GET.get('participant_mode', '').strip()  # 'singles' или 'doubles'
    date_from = request.GET.get('date_from', '').strip()
    date_to = request.GET.get('date_to', '').strip()
    
    # Базовые запросы
    active_qs = Tournament.objects.filter(status__in=[Tournament.Status.CREATED, Tournament.Status.ACTIVE])
    history_qs = Tournament.objects.filter(status=Tournament.Status.COMPLETED)

    # Ограничение для гостей: показываем только завершённые турниры круговой и олимпийской систем.
    # Завершённые турниры Кинг оставляем только для аутентифицированных пользователей.
    user = getattr(request, "user", None)
    if not user or not user.is_authenticated:
        history_qs = history_qs.filter(system__in=[Tournament.System.ROUND_ROBIN, Tournament.System.KNOCKOUT])
    
    # Применяем фильтры (поиск по имени без учета регистра)
    if name_filter:
        active_qs = active_qs.filter(name__icontains=name_filter)
        history_qs = history_qs.filter(name__icontains=name_filter)
    
    if system_filter in ['round_robin', 'knockout', 'king']:
        active_qs = active_qs.filter(system=system_filter)
        history_qs = history_qs.filter(system=system_filter)
    
    if mode_filter in ['singles', 'doubles']:
        active_qs = active_qs.filter(participant_mode=mode_filter)
        history_qs = history_qs.filter(participant_mode=mode_filter)
    
    if date_from:
        try:
            from datetime import datetime
            date_from_obj = datetime.strptime(date_from, '%Y-%m-%d').date()
            active_qs = active_qs.filter(date__gte=date_from_obj)
            history_qs = history_qs.filter(date__gte=date_from_obj)
        except ValueError:
            pass
    
    if date_to:
        try:
            from datetime import datetime
            date_to_obj = datetime.strptime(date_to, '%Y-%m-%d').date()
            active_qs = active_qs.filter(date__lte=date_to_obj)
            history_qs = history_qs.filter(date__lte=date_to_obj)
        except ValueError:
            pass
    
    # Сортировка: по дате, затем по имени
    active_qs = active_qs.order_by("date", "name")
    history_qs = history_qs.order_by("-date", "name")
    
    # Подсчет общего количества завершенных турниров
    history_total = history_qs.count()
    
    # Пагинация для завершенных турниров
    history_page = history_qs[history_offset:history_offset + history_limit]
    history_has_more = (history_offset + history_limit) < history_total

    def serialize_t(t: Tournament):
        # Количество участников турнира
        participants_count = t.entries.count()

        # Средний рейтинг BP по игрокам турнира (current_rating из Player)
        from apps.players.models import Player

        avg_rating = None
        if participants_count > 0:
            player_ids: set[int] = set()
            for e in t.entries.select_related("team").only("team_id").all():
                team = getattr(e, "team", None)
                if not team:
                    continue
                p1_id = getattr(team, "player_1_id", None)
                p2_id = getattr(team, "player_2_id", None)
                if p1_id:
                    player_ids.add(p1_id)
                if p2_id:
                    player_ids.add(p2_id)
            if player_ids:
                qs = Player.objects.filter(id__in=player_ids).only("id", "current_rating")
                total = 0.0
                cnt = 0
                for p in qs:
                    cr = getattr(p, "current_rating", None)
                    if cr is not None:
                        total += float(cr)
                        cnt += 1
                if cnt > 0:
                    avg_rating = round(total / cnt, 1)

        return {
            "id": t.id,
            "name": t.name,
            "date": t.date.strftime("%Y-%m-%d"),
            "system": t.system,
            "participant_mode": t.participant_mode,
            "status": t.status,
            "get_system_display": t.get_system_display(),
            "get_participant_mode_display": t.get_participant_mode_display(),
            "participants_count": participants_count,
            "planned_participants": t.planned_participants,
            "avg_rating_bp": avg_rating,
            "groups_count": getattr(t, "groups_count", None),
            "rating_coefficient": t.rating_coefficient,
            "prize_fund": t.prize_fund,
        }

    return Response({
        "active": [serialize_t(t) for t in active_qs],
        "history": [serialize_t(t) for t in history_page],
        "history_total": history_total,
        "history_has_more": history_has_more,
        "history_offset": history_offset,
        "history_limit": history_limit,
    })


@api_view(["GET"])
@permission_classes([IsAuthenticatedAndRoleIn(Role.REFEREE, Role.ADMIN)])
def referee_my_tournaments(request):
    """Список активных турниров, где текущий пользователь назначен рефери.

    Используется для интерфейса судьи: показывает только турниры со статусом ACTIVE,
    в которых пользователь входит в tournament.referees.
    """

    user = request.user
    qs = Tournament.objects.filter(
        status=Tournament.Status.ACTIVE,
        referees=user,
    ).order_by("date", "name")

    def serialize_t(t: Tournament):
        return {
            "id": t.id,
            "name": t.name,
            "date": t.date.strftime("%Y-%m-%d") if t.date else None,
            "system": t.system,
            "participant_mode": t.participant_mode,
            "status": t.status,
            "get_system_display": t.get_system_display(),
            "get_participant_mode_display": t.get_participant_mode_display(),
        }

    return Response({"tournaments": [serialize_t(t) for t in qs]})


@api_view(["GET"])
def set_formats_list(request):
    formats = SetFormat.objects.all()
    return Response({
        "set_formats": [{"id": sf.id, "name": sf.name} for sf in formats]
    })


@api_view(["GET"])
def rulesets_list(request):
    qs = Ruleset.objects.all()
    system = request.GET.get("system")
    if system:
        qs = qs.filter(tournament_system=system)
    return Response({
        "rulesets": [{"id": rs.id, "name": rs.name} for rs in qs]
    })


@csrf_exempt
@api_view(["POST", "OPTIONS"])
@permission_classes([IsAuthenticated])
def tournament_complete(request, pk: int):
    """Завершить турнир и выполнить расчёт рейтинга по его матчам.

    Логика:
    0. Проверить все ли матчи завершены. Если есть незавершенные - вернуть предупреждение.
    1. Установить начальные рейтинги игрокам с рейтингом=0 или NULL.
    2. Проверить нужно ли считать рейтинг (is_rating_calc).
    3. Рассчитать рейтинг с учетом is_out_of_competition.
    4. Завершить турнир.
    """
    t = get_object_or_404(Tournament, pk=pk)
    
    from apps.players.models import PlayerRatingDynamic, Player
    from apps.matches.models import Match
    from apps.players.services.initial_rating_service import get_initial_bp_rating
    
    # Если турнир уже завершен, удаляем старые данные рейтинга для пересчета
    if t.status == Tournament.Status.COMPLETED:
        # Удаляем старые записи рейтинга для пересчета
        PlayerRatingDynamic.objects.filter(tournament_id=t.id).delete()
        from apps.players.models import PlayerRatingHistory
        PlayerRatingHistory.objects.filter(tournament_id=t.id).delete()
    
    # 0. Проверка незавершенных матчей
    total_matches = Match.objects.filter(tournament_id=t.id).count()
    completed_matches = Match.objects.filter(tournament_id=t.id, status=Match.Status.COMPLETED).count()
    
    # Если есть незавершенные матчи, проверяем параметр force
    if completed_matches < total_matches:
        force = request.data.get('force', False)
        if not force:
            return Response({
                "ok": False,
                "error": "incomplete_matches",
                "message": "Пока ещё не все матчи в турнире сыграны. Вы всё равно хотите завершить турнир?",
                "completed": completed_matches,
                "total": total_matches
            }, status=400)
    
    with transaction.atomic():
        # 1. Установить начальные рейтинги игрокам с рейтингом=0 или NULL
        # Соберём всех игроков, участвовавших в турнире (из всех матчей)
        all_matches = Match.objects.filter(tournament_id=t.id).select_related('team_1', 'team_2')
        player_ids: set[int] = set()
        for m in all_matches:
            for pid in [getattr(m.team_1, 'player_1_id', None), getattr(m.team_1, 'player_2_id', None),
                        getattr(m.team_2, 'player_1_id', None), getattr(m.team_2, 'player_2_id', None)]:
                if pid:
                    player_ids.add(pid)
        
        # Установим начальные рейтинги для игроков с рейтингом 0 или NULL
        if player_ids:
            players_to_update = Player.objects.filter(
                id__in=player_ids
            ).filter(
                Q(current_rating__isnull=True) | Q(current_rating=0)
            )
            
            for player in players_to_update:
                initial_rating = get_initial_bp_rating(player, t)
                player.current_rating = initial_rating
                player.save(update_fields=['current_rating'])
        
        # 2. Проверить нужно ли считать рейтинг для этого турнира
        if t.is_rating_calc:
            # 3. Выполним расчёт рейтинга по турниру с учетом is_out_of_competition
            rating_service.compute_ratings_for_tournament(t.id)
        
        # 4. Переведём турнир в статус COMPLETED
        t.status = Tournament.Status.COMPLETED
        t.save(update_fields=["status"])
    
    return Response({"ok": True})


@csrf_exempt
@api_view(["POST", "OPTIONS"])
@permission_classes([IsAuthenticated])
def tournament_remove(request, pk: int):
    t = get_object_or_404(Tournament, pk=pk)
    t.delete()
    return Response({"ok": True})


@csrf_exempt
@api_view(["POST", "OPTIONS"])
@permission_classes([IsAuthenticated])
def tournament_create(request):
    """Создание турнира по данным из модального окна."""
    data = request.data or {}
    required = ["name", "date", "participant_mode", "set_format_id", "system", "ruleset_id"]
    missing = [k for k in required if not data.get(k)]
    if missing:
        return Response({"ok": False, "error": f"Не заполнены поля: {', '.join(missing)}"}, status=400)

    try:
        system = data["system"]
        brackets_count = None
        if system == Tournament.System.KNOCKOUT:
            brackets_count = int(data.get("brackets_count")) if data.get("brackets_count") else None

        tournament = Tournament.objects.create(
            name=data["name"],
            date=data["date"],
            participant_mode=data["participant_mode"],
            set_format_id=int(data["set_format_id"]),
            system=system,
            ruleset_id=int(data["ruleset_id"]),
            groups_count=int(data.get("groups_count") or 1),
            planned_participants=int(data.get("participants") or 0) or None,
            brackets_count=brackets_count,
            status=Tournament.Status.CREATED,
        )
    except Exception as e:
        return Response({"ok": False, "error": str(e)}, status=400)

    return Response({"ok": True, "redirect": f"/tournaments/{tournament.id}/"})


class SchedulePatternViewSet(viewsets.ReadOnlyModelViewSet):
    """ViewSet для шаблонов расписания (только чтение)"""
    queryset = SchedulePattern.objects.all()
    serializer_class = SchedulePatternSerializer
    permission_classes = [AllowAny]
    
    @action(detail=False, methods=['get'])
    def by_participants(self, request):
        """GET /api/schedule-patterns/by_participants/?count=4&system=round_robin
        
        Возвращает шаблоны для указанного количества участников и системы турнира.
        """
        count = request.query_params.get('count')
        system = request.query_params.get('system', SchedulePattern.TournamentSystem.ROUND_ROBIN)
        
        if not count:
            return Response(
                {'error': 'Параметр count обязателен'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        try:
            count = int(count)
        except ValueError:
            return Response(
                {'error': 'Параметр count должен быть числом'},
                status=status.HTTP_400_BAD_REQUEST
            )
        
        # Системные шаблоны (Berger, Snake) + кастомные для нужного количества
        patterns = SchedulePattern.objects.filter(
            tournament_system=system
        ).filter(
            Q(is_system=True) | 
            Q(participants_count=count, pattern_type=SchedulePattern.PatternType.CUSTOM)
        ).order_by('is_system', 'name')
        
        serializer = self.get_serializer(patterns, many=True)
        return Response(serializer.data)

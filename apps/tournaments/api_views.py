from rest_framework import viewsets, status
from rest_framework.decorators import action, api_view, permission_classes, authentication_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from django.db.models import Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator

from .models import Tournament, TournamentEntry, SetFormat, Ruleset
from apps.teams.models import Team
from apps.matches.models import Match, MatchSet
from apps.players.models import Player
from .serializers import (
    TournamentSerializer,
    ParticipantSerializer,
    MatchSerializer,
    PlayerSerializer,
)


@method_decorator(csrf_exempt, name='dispatch')
class TournamentViewSet(viewsets.ModelViewSet):
    queryset = Tournament.objects.all().order_by("-created_at")
    serializer_class = TournamentSerializer

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
    @action(detail=True, methods=["post"], url_path="set_participant", permission_classes=[AllowAny], authentication_classes=[])
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

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], permission_classes=[AllowAny], authentication_classes=[])
    def complete(self, request, pk=None):
        tournament = self.get_object()
        tournament.status = Tournament.Status.COMPLETED
        tournament.save(update_fields=["status"])
        return Response({"ok": True})

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="remove", permission_classes=[AllowAny], authentication_classes=[])
    def remove(self, request, pk=None):
        tournament = self.get_object()
        tournament.delete()
        return Response({"ok": True})

    # --- ГРУППОВОЕ РАСПИСАНИЕ И ФИКСАЦИЯ ---
    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["get"], url_path="group_schedule", permission_classes=[AllowAny], authentication_classes=[])
    def group_schedule(self, request, pk=None):
        """Сформировать расписание круговых матчей по группам на основе planned_participants.
        Возвращает для каждой группы массив туров, каждый тур — пары позиций (индексы 1..N).
        Расписание зависит только от планового размера групп и не привязано к фактическим участникам.
        """
        tournament: Tournament = self.get_object()
        if tournament.system != Tournament.System.ROUND_ROBIN:
            return Response({"ok": False, "error": "Турнир не круговой системы"}, status=400)

        groups_count = max(1, tournament.groups_count or 1)
        planned_total = int(tournament.planned_participants or 0)
        # равномерно распределим план по группам
        base = planned_total // groups_count
        remainder = planned_total % groups_count
        sizes = [base + (1 if i < remainder else 0) for i in range(groups_count)]

        # локальный генератор пар по алгоритму round-robin
        def round_robin_indices(n: int):
            ids = list(range(1, n + 1))
            if n < 2:
                return []
            # добавим BYE при нечетном
            bye = None
            if n % 2 != 0:
                ids.append(bye)
            fixed = ids[0]
            rotating = ids[1:]
            rounds = []
            total = len(ids)
            for r in range(total - 1):
                pairs = []
                if fixed is not None and rotating[-1] is not None:
                    pairs.append((fixed, rotating[-1]) if r % 2 == 0 else (rotating[-1], fixed))
                for i in range((total - 2) // 2):
                    a = rotating[i]
                    b = rotating[total - 3 - i]
                    if a is None or b is None:
                        continue
                    pairs.append((a, b) if ((r + i) % 2 == 0) else (b, a))
                rounds.append(pairs)
                rotating = [rotating[-1]] + rotating[:-1]
            return rounds

        schedule = {}
        for gi, size in enumerate(sizes, start=1):
            schedule[str(gi)] = round_robin_indices(size)

        return Response({"ok": True, "groups": schedule})

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="lock_participants", permission_classes=[AllowAny], authentication_classes=[])
    def lock_participants(self, request, pk=None):
        """Зафиксировать участников: создать/актуализировать матчи в группах по расписанию.
        Повторный вызов удаляет неактуальные матчи и добавляет недостающие.
        """
        tournament: Tournament = self.get_object()
        if tournament.system != Tournament.System.ROUND_ROBIN:
            return Response({"ok": False, "error": "Турнир не круговой системы"}, status=400)

        groups_count = max(1, tournament.groups_count or 1)
        planned_total = int(tournament.planned_participants or 0)
        base = planned_total // groups_count
        remainder = planned_total % groups_count
        sizes = [base + (1 if i < remainder else 0) for i in range(groups_count)]

        # Расписание по индексам позиций (1..N) для каждой группы
        def rr(n: int):
            ids = list(range(1, n + 1))
            if n < 2:
                return []
            bye = None
            if n % 2 != 0:
                ids.append(bye)
            fixed = ids[0]
            rotating = ids[1:]
            rounds = []
            total = len(ids)
            for r in range(total - 1):
                pairs = []
                if fixed is not None and rotating[-1] is not None:
                    pairs.append((fixed, rotating[-1]) if r % 2 == 0 else (rotating[-1], fixed))
                for i in range((total - 2) // 2):
                    a = rotating[i]
                    b = rotating[total - 3 - i]
                    if a is None or b is None:
                        continue
                    pairs.append((a, b) if ((r + i) % 2 == 0) else (b, a))
                rounds.append(pairs)
                rotating = [rotating[-1]] + rotating[:-1]
            return rounds

        # Соберём соответствие позиция -> команда по группам
        entries = TournamentEntry.objects.filter(tournament=tournament)
        pos_to_team = {gi: {} for gi in range(1, groups_count + 1)}
        for e in entries:
            if e.team_id and e.group_index and e.row_index:
                pos_to_team.setdefault(e.group_index, {})[e.row_index] = e.team_id

        desired_pairs_per_group = {}
        rounds_per_group = {}
        for gi, size in enumerate(sizes, start=1):
            rounds = rr(size)
            rounds_per_group[gi] = rounds
            pairs = []  # множество желаемых пар (team_low, team_high, round_index)
            for r_index, tour_pairs in enumerate(rounds, start=1):
                k = 1
                for a_pos, b_pos in tour_pairs:
                    ta = pos_to_team.get(gi, {}).get(a_pos)
                    tb = pos_to_team.get(gi, {}).get(b_pos)
                    if not ta or not tb:
                        # По условиям UI, фиксация возможна только при полном составе, но на всякий случай пропустим
                        k += 1
                        continue
                    low, high = (ta, tb) if ta < tb else (tb, ta)
                    pairs.append((low, high, r_index, k))  # k — порядковый номер игры в туре
                    k += 1
            desired_pairs_per_group[gi] = pairs

        # Текущие матчи группового этапа
        existing = Match.objects.filter(tournament=tournament, stage=Match.Stage.GROUP)
        keep_keys = set()
        # Удалим неактуальные пары (те, которых больше нет среди желаемых, или команды вышли из группы)
        for m in existing:
            gi = m.group_index or 0
            low = m.team_low_id or min(m.team_1_id, m.team_2_id)
            high = m.team_high_id or max(m.team_1_id, m.team_2_id)
            if gi in desired_pairs_per_group:
                # есть ли такая пара в желаемых для этой группы?
                if any((low == dlow and high == dhigh) for dlow, dhigh, _r, _k in desired_pairs_per_group[gi]):
                    keep_keys.add((gi, low, high))
                    continue
            # иначе удаляем
            m.delete()

        # Создадим недостающие матчи и актуализируем поля
        created = 0
        for gi, pairs in desired_pairs_per_group.items():
            round_name = f"Группа {gi}"
            for low, high, r_index, k in pairs:
                order_in_round = (r_index - 1) * 100 + k
                team_1_id, team_2_id = low, high  # порядок отображения можно оставить low/high
                obj, _created = Match.objects.get_or_create(
                    tournament=tournament,
                    stage=Match.Stage.GROUP,
                    group_index=gi,
                    team_low_id=low,
                    team_high_id=high,
                    defaults={
                        "team_1_id": team_1_id,
                        "team_2_id": team_2_id,
                        "round_index": r_index,
                        "round_name": round_name,
                        "order_in_round": order_in_round,
                    },
                )
                if _created:
                    created += 1
                else:
                    # обновим на случай изменения порядка
                    upd = False
                    if obj.round_index != r_index:
                        obj.round_index = r_index; upd = True
                    if obj.round_name != round_name:
                        obj.round_name = round_name; upd = True
                    if obj.order_in_round != order_in_round:
                        obj.order_in_round = order_in_round; upd = True
                    if obj.team_1_id != team_1_id or obj.team_2_id != team_2_id:
                        obj.team_1_id = team_1_id; obj.team_2_id = team_2_id; upd = True
                    if upd:
                        obj.save(update_fields=["round_index", "round_name", "order_in_round", "team_1", "team_2"])

        return Response({"ok": True, "created": created})

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="match_start", permission_classes=[AllowAny], authentication_classes=[])
    def match_start(self, request, pk=None):
        tournament: Tournament = self.get_object()
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
        return Response({"ok": True, "match": MatchSerializer(m).data})

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="match_save_score", permission_classes=[AllowAny], authentication_classes=[])
    def match_save_score(self, request, pk=None):
        """Сохранить счёт одного сета и завершить матч.
        Ожидает JSON: { match_id, id_team_first, id_team_second, games_first, games_second }
        """
        tournament: Tournament = self.get_object()
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
        # Счёт от победителя: games_1 — очки победителя, games_2 — очки проигравшего
        winner_games = max(games_first, games_second)
        loser_games = min(games_first, games_second)

        # Обновляем/создаём первый сет
        s, _ = MatchSet.objects.get_or_create(match=m, index=1, defaults={"games_1": 0, "games_2": 0})
        s.games_1 = winner_games
        s.games_2 = loser_games
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
        return Response({"ok": True, "match": MatchSerializer(m).data})

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="match_cancel", permission_classes=[AllowAny], authentication_classes=[])
    def match_cancel(self, request, pk=None):
        tournament: Tournament = self.get_object()
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
        return Response({"ok": True, "match": MatchSerializer(m).data})

    @action(detail=True, methods=["get"])
    def group_stats(self, request, pk=None):
        # Заглушка, будет реализовано позже
        return Response({"groups": []})

    @method_decorator(csrf_exempt)
    @action(
        detail=False,
        methods=["post"],
        url_path="new",
        permission_classes=[AllowAny],
        authentication_classes=[],
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
            )
        except Exception as e:
            return Response({"ok": False, "error": str(e)}, status=400)

        return Response({"ok": True, "redirect": f"/tournaments/{tournament.id}/"})


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
    def get(self, request):
        players = Player.objects.all().order_by("last_name", "first_name")
        serializer = PlayerSerializer(players, many=True)
        return Response({"players": serializer.data})


class PlayerSearchView(APIView):
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
    permission_classes = [AllowAny]
    authentication_classes = []
    def post(self, request):
        serializer = PlayerSerializer(data=request.data)
        if serializer.is_valid():
            player = serializer.save()
            return Response(PlayerSerializer(player).data, status=status.HTTP_201_CREATED)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


# --- Function-based endpoints для страницы списка турниров (overview) ---


@api_view(["GET"])
def tournament_list(request):
    """Сводный список турниров: активные и история."""
    today = timezone.now().date()
    active_qs = Tournament.objects.filter(status__in=[Tournament.Status.CREATED, Tournament.Status.ACTIVE]).order_by(
        "date"
    )
    history_qs = Tournament.objects.filter(status=Tournament.Status.COMPLETED).order_by("-date")[:20]

    def serialize_t(t: Tournament):
        return {
            "id": t.id,
            "name": t.name,
            "date": t.date.strftime("%Y-%m-%d"),
            "system": t.system,
            "participant_mode": t.participant_mode,
            "status": t.status,
            "get_system_display": t.get_system_display(),
            "get_participant_mode_display": t.get_participant_mode_display(),
        }

    return Response({
        "active": [serialize_t(t) for t in active_qs],
        "history": [serialize_t(t) for t in history_qs],
    })


@api_view(["GET"])
def set_formats_list(request):
    formats = SetFormat.objects.all()
    return Response({
        "set_formats": [{"id": sf.id, "name": sf.name} for sf in formats]
    })


@api_view(["GET"])
def rulesets_list(request):
    rulesets = Ruleset.objects.all()
    return Response({
        "rulesets": [{"id": rs.id, "name": rs.name} for rs in rulesets]
    })


@csrf_exempt
@api_view(["POST", "OPTIONS"])
@authentication_classes([])
@permission_classes([AllowAny])
def tournament_complete(request, pk: int):
    t = get_object_or_404(Tournament, pk=pk)
    t.status = Tournament.Status.COMPLETED
    t.save(update_fields=["status"]) 
    return Response({"ok": True})


@csrf_exempt
@api_view(["POST", "OPTIONS"])
@authentication_classes([])
@permission_classes([AllowAny])
def tournament_remove(request, pk: int):
    t = get_object_or_404(Tournament, pk=pk)
    t.delete()
    return Response({"ok": True})


@csrf_exempt
@api_view(["POST", "OPTIONS"])
@authentication_classes([])
@permission_classes([AllowAny])
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

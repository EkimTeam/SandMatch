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
from django.db import transaction
from typing import Optional

from .models import Tournament, TournamentEntry, SetFormat, Ruleset, KnockoutBracket, DrawPosition
from apps.teams.models import Team
from apps.matches.models import Match, MatchSet
from apps.players.models import Player
from .serializers import (
    TournamentSerializer,
    ParticipantSerializer,
    MatchSerializer,
    PlayerSerializer,
)
from apps.tournaments.services.knockout import (
    validate_bracket_size,
    calculate_rounds_structure,
    generate_initial_matches,
    seed_participants,
    advance_winner,
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

    # --- ПЛЕЙ-ОФФ (ОЛИМПИЙКА) ---
    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="create_knockout_bracket", permission_classes=[AllowAny], authentication_classes=[])
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

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="seed_bracket", permission_classes=[AllowAny], authentication_classes=[])
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

    @action(detail=True, methods=["get"], url_path="brackets/(?P<bracket_id>[^/.]+)/draw", permission_classes=[AllowAny], authentication_classes=[])
    def bracket_draw(self, request, pk=None, bracket_id=None):
        """Получить данные для отрисовки сетки с информацией о соединениях (для SVG)."""
        tournament: Tournament = self.get_object()
        try:
            bracket = tournament.knockout_brackets.get(id=int(bracket_id))
        except KnockoutBracket.DoesNotExist:
            return Response({"ok": False, "error": "Сетка не найдена"}, status=404)

        rounds_info = calculate_rounds_structure(bracket.size, bracket.has_third_place)

        def serialize_team(team):
            if not team:
                return None
            name = str(team)
            # Получить display_name и full_name для игроков
            display_name = name
            full_name = name
            
            if team.player_1:
                p1 = team.player_1
                if team.player_2:
                    # Пара
                    p2 = team.player_2
                    display_name = f"{p1.display_name or p1.first_name} / {p2.display_name or p2.first_name}"
                    full_name = f"{p1.last_name} {p1.first_name} / {p2.last_name} {p2.first_name}"
                else:
                    # Одиночка
                    display_name = p1.display_name or p1.first_name
                    full_name = f"{p1.last_name} {p1.first_name}"
            
            return {
                "id": team.id, 
                "name": name,
                "display_name": display_name,
                "full_name": full_name
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
                # Надёжно сериализуем команды: сначала пробуем related, затем по *_id, затем по low/high id
                t1 = serialize_team(m.team_1) or serialize_team_by_id(getattr(m, "team_1_id", None)) or serialize_team_by_id(getattr(m, "team_low_id", None))
                t2 = serialize_team(m.team_2) or serialize_team_by_id(getattr(m, "team_2_id", None)) or serialize_team_by_id(getattr(m, "team_high_id", None))
                
                # Получить счёт матча
                score_str = None
                if m.status == Match.Status.COMPLETED and m.winner_id:
                    sets = m.sets.all().order_by('index')
                    if sets:
                        # Формат: "6:4" для одного сета
                        score_parts = []
                        for s in sets:
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
        
        # Блокировка для завершённых турниров
        if tournament.status == Tournament.Status.COMPLETED:
            return Response({"error": "Турнир завершён, изменения запрещены"}, status=400)
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

        # Изменить статус турнира на active при фиксации
        if tournament.status == Tournament.Status.CREATED:
            tournament.status = Tournament.Status.ACTIVE
            tournament.save(update_fields=['status'])

        return Response({"ok": True, "created": created})

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="unlock_participants", permission_classes=[AllowAny], authentication_classes=[])
    def unlock_participants(self, request, pk=None):
        """Снять фиксацию участников в круговой системе - изменить статус турнира на created."""
        tournament: Tournament = self.get_object()
        
        if tournament.system != Tournament.System.ROUND_ROBIN:
            return Response({"ok": False, "error": "Турнир не круговой системы"}, status=400)
        
        # Изменить статус турнира на created при снятии фиксации
        if tournament.status == Tournament.Status.ACTIVE:
            tournament.status = Tournament.Status.CREATED
            tournament.save(update_fields=['status'])
        
        return Response({"ok": True})

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
    @action(detail=True, methods=["post"], url_path="match_save_score_full", permission_classes=[AllowAny], authentication_classes=[])
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
        for i, s in enumerate(sets_payload, start=1):
            idx = int(s.get("index") or i)
            g1 = int(s.get("games_1") or 0)
            g2 = int(s.get("games_2") or 0)
            tb1 = s.get("tb_1")
            tb2 = s.get("tb_2")
            tb1 = int(tb1) if tb1 is not None else None
            tb2 = int(tb2) if tb2 is not None else None
            is_tb_only = bool(s.get("is_tiebreak_only") or False)

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
    @action(detail=True, methods=["post"], url_path="match_start", permission_classes=[AllowAny], authentication_classes=[])
    def match_start(self, request, pk=None):
        """Начать матч (установить статус live и время начала)."""
        tournament: Tournament = self.get_object()
        
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
        
        from django.utils import timezone
        m.started_at = timezone.now()
        m.status = Match.Status.LIVE
        m.save(update_fields=["started_at", "status", "updated_at"])
        
        return Response({"ok": True, "match": {"id": m.id, "status": m.status}})

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="match_cancel", permission_classes=[AllowAny], authentication_classes=[])
    def match_cancel(self, request, pk=None):
        """Отменить матч (вернуть в статус scheduled, очистить время начала)."""
        tournament: Tournament = self.get_object()
        
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
    @action(detail=True, methods=["post"], url_path="match_reset", permission_classes=[AllowAny], authentication_classes=[])
    def match_reset(self, request, pk=None):
        """Сбросить результат матча (удалить счёт, победителя, убрать из следующего раунда)."""
        tournament: Tournament = self.get_object()
        
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
        
        # Удалить победителя из следующего раунда
        if m.winner_id and m.bracket:
            next_round = (m.round_index or 0) + 1
            next_order = (m.order_in_round + 1) // 2
            target_slot = 'team_1' if (m.order_in_round % 2 == 1) else 'team_2'
            
            next_match = Match.objects.filter(
                bracket=m.bracket,
                round_index=next_round,
                order_in_round=next_order
            ).first()
            
            if next_match:
                setattr(next_match, target_slot, None)
                next_match.save(update_fields=[target_slot, 'updated_at'])
        
        # Удалить сеты
        m.sets.all().delete()
        
        # Очистить результат матча
        m.winner = None
        m.started_at = None
        m.finished_at = None
        m.status = Match.Status.SCHEDULED
        m.save(update_fields=["winner", "started_at", "finished_at", "status", "updated_at"])
        
        return Response({"ok": True})

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="match_save_score", permission_classes=[AllowAny], authentication_classes=[])
    def match_save_score(self, request, pk=None):
        """Сохранить счёт одного сета и завершить матч.
        Ожидает JSON: { match_id, id_team_first, id_team_second, games_first, games_second }
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

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["get"], url_path="participants", permission_classes=[AllowAny], authentication_classes=[])
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
            
            participants.append({
                'id': entry.id,
                'name': full_name,  # Всегда полное ФИО для списка участников
                'team_id': team.id,
                'isInBracket': False
            })
        
        return Response({'participants': participants})
    
    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["get"], url_path="brackets/(?P<bracket_id>[^/.]+)/bye_positions", permission_classes=[AllowAny], authentication_classes=[])
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
        except Exception as e:
            return Response({'ok': False, 'error': str(e)}, status=500)

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="brackets/(?P<bracket_id>[^/.]+)/assign_participant", permission_classes=[AllowAny], authentication_classes=[])
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
            
            from apps.tournaments.models import DrawPosition
            draw_pos = DrawPosition.objects.filter(bracket=bracket, entry=None).first()
            if draw_pos:
                draw_pos.entry = entry
                draw_pos.save(update_fields=['entry'])
            
            return Response({'ok': True})
            
        except (KnockoutBracket.DoesNotExist, Match.DoesNotExist, TournamentEntry.DoesNotExist) as e:
            return Response({'ok': False, 'error': str(e)}, status=404)
        except Exception as e:
            return Response({'ok': False, 'error': str(e)}, status=500)

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["delete"], url_path="brackets/(?P<bracket_id>[^/.]+)/remove_participant", permission_classes=[AllowAny], authentication_classes=[])
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
            
            return Response({'ok': True})
            
        except (KnockoutBracket.DoesNotExist, Match.DoesNotExist) as e:
            return Response({'ok': False, 'error': str(e)}, status=404)
        except Exception as e:
            return Response({'ok': False, 'error': str(e)}, status=500)

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="add_participant", permission_classes=[AllowAny], authentication_classes=[])
    def add_participant(self, request, pk=None):
        """Добавить нового участника в турнир."""
        tournament: Tournament = self.get_object()
        
        # Блокировка для завершённых турниров
        if tournament.status == Tournament.Status.COMPLETED:
            return Response({"error": "Турнир завершён, изменения запрещены"}, status=400)
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
                
                # Найти первый свободный row_index
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
    @action(detail=True, methods=["post"], url_path="brackets/(?P<bracket_id>[^/.]+)/lock_participants", permission_classes=[AllowAny], authentication_classes=[])
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
                    tournament.status = Tournament.Status.ACTIVE
                    tournament.save(update_fields=['status'])
                
                return Response({'ok': True, 'changes_detected': changes_detected})
                
        except KnockoutBracket.DoesNotExist:
            return Response({'ok': False, 'error': 'Сетка не найдена'}, status=404)
        except Exception as e:
            return Response({'ok': False, 'error': str(e)}, status=500)

    @method_decorator(csrf_exempt)
    @action(detail=True, methods=["post"], url_path="brackets/(?P<bracket_id>[^/.]+)/unlock_participants", permission_classes=[AllowAny], authentication_classes=[])
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
    @action(detail=True, methods=["delete"], url_path="brackets/(?P<bracket_id>[^/.]+)/remove_from_slot", permission_classes=[AllowAny], authentication_classes=[])
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
    @action(detail=True, methods=["delete"], url_path="remove_participant", permission_classes=[AllowAny], authentication_classes=[])
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

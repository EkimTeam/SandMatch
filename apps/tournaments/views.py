from __future__ import annotations

from django.db.models import Q
from django.http import JsonResponse, HttpRequest, HttpResponseBadRequest, HttpResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST
from django.views.generic import TemplateView, DetailView

from apps.tournaments.models import Tournament, SetFormat, Ruleset, TournamentEntry
from apps.teams.models import Team
from apps.players.models import Player
from apps.tournaments.services.round_robin import _round_robin_pairings
import json


class TournamentsListView(TemplateView):
    template_name = "tournaments/list.html"

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        # Активные = не завершённые
        active = Tournament.objects.filter(~Q(status=Tournament.Status.COMPLETED)).order_by("-date", "name")
        history = Tournament.objects.filter(status=Tournament.Status.COMPLETED).order_by("-date", "name")
        ctx.update({
            "active": active,
            "history": history,
            "set_formats": SetFormat.objects.order_by("name"),
            "rulesets": Ruleset.objects.order_by("name"),
        })
        return ctx


@require_POST
def create_tournament(request: HttpRequest):
    # Поддержка application/x-www-form-urlencoded и application/json
    data = request.POST or None
    if not data and request.content_type == "application/json":
        import json
        try:
            data = json.loads(request.body.decode("utf-8"))
        except Exception:
            return HttpResponseBadRequest("invalid json")

    name = data.get("name")
    date = data.get("date")
    participant_mode = data.get("participant_mode")
    system = data.get("system")
    set_format_id = data.get("set_format_id")
    ruleset_id = data.get("ruleset_id")
    groups_count = int(data.get("groups_count") or 1)
    planned_participants = int(data.get("participants") or 0)
    # поля для олимпийки
    ko_participants_raw = data.get("ko_participants")
    brackets_count_raw = data.get("brackets_count")
    ko_participants = int(ko_participants_raw or 0)
    brackets_count = int(brackets_count_raw or 0) if brackets_count_raw is not None else None

    if not all([name, date, participant_mode, system, set_format_id, ruleset_id]):
        return HttpResponseBadRequest("missing fields")

    # Валидации
    # Круговая
    if system == Tournament.System.ROUND_ROBIN and planned_participants and groups_count:
        if planned_participants <= groups_count * 2:
            return JsonResponse(
                {
                    "ok": False,
                    "error": "Слишком мало участников для такого количества групп. Уменьшите количество групп или увеличьте количество участников или выберите другую систему проведения",
                },
                status=400,
            )

    # Олимпийка
    if system == Tournament.System.KNOCKOUT:
        if not ko_participants or ko_participants < 1:
            return JsonResponse({"ok": False, "error": "Укажите число участников для олимпийки"}, status=400)
        if not brackets_count or brackets_count < 1:
            return JsonResponse({"ok": False, "error": "Число сеток должно быть не менее 1"}, status=400)
        if ko_participants <= brackets_count * 2:
            return JsonResponse({"ok": False, "error": "Слишком мало участников для такого количества сеток. Уменьшите число сеток или увеличьте количество участников."}, status=400)

    # Кинг
    if system == Tournament.System.KING and planned_participants and groups_count:
        per_group = planned_participants // groups_count
        if per_group < 4:
            return JsonResponse({"ok": False, "error": "Для Кинг должно быть минимум 4 участника в группе"}, status=400)
        if per_group > 16:
            return JsonResponse({"ok": False, "error": "Для Кинг должно быть максимум 16 участников в группе"}, status=400)

    t = Tournament.objects.create(
        name=name,
        date=date,
        participant_mode=participant_mode,
        system=system,
        groups_count=groups_count,
        set_format_id=set_format_id,
        ruleset_id=ruleset_id,
        planned_participants=(ko_participants if system == Tournament.System.KNOCKOUT else (planned_participants or None)),
        brackets_count=(brackets_count if system == Tournament.System.KNOCKOUT else None),
    )

    # Ответ для fetch и для обычной формы
    if request.headers.get("x-requested-with") == "XMLHttpRequest" or request.content_type == "application/json":
        return JsonResponse({"ok": True, "id": t.id, "redirect": f"/tournaments/{t.id}/"})
    return redirect("tournament_detail", pk=t.id)


class TournamentDetailView(DetailView):
    model = Tournament
    template_name = "tournaments/detail.html"

    def get_template_names(self):
        t: Tournament = self.get_object()
        if t.system == Tournament.System.KNOCKOUT:
            return ["tournaments/knockout.html"]
        return [self.template_name]

    def _split(self, total: int, groups: int):
        if total <= 0:
            return [0 for _ in range(groups)]
        base = total // groups
        rem = total % groups
        arr = [base] * groups
        for i in range(rem):
            arr[i] += 1
        return arr

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        t: Tournament = self.object
        planned = t.planned_participants or 0

        # Ветка круговой системы — готовим группы как раньше
        if t.system == Tournament.System.ROUND_ROBIN:
            groups = max(1, t.groups_count)
            group_sizes = self._split(planned, groups) if planned else []

        # Готовим контекст групп, чтобы в шаблоне не вызывать range()
            groups_ctx = []
            for idx, sz in enumerate(group_sizes, start=1):
                cols = list(range(1, sz + 1))
                rows = list(range(1, sz + 1))
                if sz >= 2:
                    tours = _round_robin_pairings(cols)
                    orders_text = [", ".join(f"{a}-{b}" for a, b in tour) for tour in tours]
                else:
                    orders_text = []
                groups_ctx.append({
                    "idx": idx,
                    "size": sz,
                    "cols": cols,
                    "rows": rows,
                    "orders": orders_text,
                })

        # Для олимпийки формируем другой контекст и завершаем
        if t.system == Tournament.System.KNOCKOUT:
            from apps.tournaments.services.knockout import build_knockout_context
            ko_ctx = build_knockout_context(t)
            ctx.update({
                "planned": planned,
                "knockout": ko_ctx,
                "participant_label": (
                    "Участник" if t.participant_mode == Tournament.ParticipantMode.SINGLES else "Пара"
                ),
            })
            return ctx

        # Получаем текущих участников из БД с их точными позициями (круговая)
        from apps.tournaments.models import TournamentEntry
        entries = (
            TournamentEntry.objects.filter(tournament=t)
            .select_related("team__player_1", "team__player_2")
            .order_by("group_index", "row_index")
        )

        # Соберём участников в словарь по позициям для точного восстановления
        participants_map = {}
        for e in entries:
            team = e.team
            p1 = team.player_1
            p2 = team.player_2
            if p2 is None:
                display = p1.display_name or p1.first_name
                title = str(p1)
            else:
                display = f"{p1.display_name or p1.first_name} / {p2.display_name or p2.first_name}"
                title = f"{p1} / {p2}"
            
            participants_map[(e.group_index, e.row_index)] = {
                "display": display,
                "title": title,
                "p1": p1.id,
                "p2": p2.id if p2 else None,
                "group_index": e.group_index,
                "row_index": e.row_index,
            }

        # Формируем список для фронтенда: все участники в порядке их позиций
        items = list(participants_map.values())

        # Готовим счёты для инициализации таблицы при загрузке
        # Карта: team_id -> (group_index, row_index)
        team_pos: dict[int, tuple[int, int]] = {}
        for e in entries:
            team_pos[e.team_id] = (e.group_index, e.row_index)

        from apps.matches.models import Match
        initial_scores: list[dict] = []
        matches = (
            Match.objects.filter(tournament=t, stage=Match.Stage.GROUP)
            .prefetch_related("sets")
        )
        for m in matches:
            pos1 = team_pos.get(m.team_1_id)
            pos2 = team_pos.get(m.team_2_id)
            if not pos1 or not pos2:
                continue
            gi1, ri = pos1
            gi2, ci = pos2
            if gi1 != gi2:
                # Разные группы в круговой таблице не рисуем тут
                continue
            gi = gi1
            # Сводка сетов в порядке team_1 vs team_2
            sets = list(m.sets.all().order_by("index"))
            summary_parts = []
            for s in sets:
                if s.is_tiebreak_only:
                    summary_parts.append(f"{s.games_1}:{s.games_2}")
                elif s.tb_1 is not None and s.tb_2 is not None:
                    summary_parts.append(f"{s.games_1}:{s.games_2} ({s.tb_1}:{s.tb_2})")
                else:
                    summary_parts.append(f"{s.games_1}:{s.games_2}")
            summary = ", ".join(summary_parts)

            # Текст для зеркальной ячейки (меняем местами)
            mirror_parts = []
            for s in sets:
                if s.is_tiebreak_only:
                    mirror_parts.append(f"{s.games_2}:{s.games_1}")
                elif s.tb_1 is not None and s.tb_2 is not None:
                    mirror_parts.append(f"{s.games_2}:{s.games_1} ({s.tb_2}:{s.tb_1})")
                else:
                    mirror_parts.append(f"{s.games_2}:{s.games_1}")
            summary_mirror = ", ".join(mirror_parts)

            # Если матч LIVE и без сетов — показываем пометку
            if not summary and m.status == Match.Status.LIVE:
                initial_scores.append({
                    "group_index": gi,
                    "row_index": ri,
                    "col_index": ci,
                    "text": "идет",
                    "live": True,
                })
                initial_scores.append({
                    "group_index": gi,
                    "row_index": ci,
                    "col_index": ri,
                    "text": "идет",
                    "live": True,
                })
            elif summary:
                initial_scores.append({
                    "group_index": gi,
                    "row_index": ri,
                    "col_index": ci,
                    "text": summary,
                    "live": False,
                })
                initial_scores.append({
                    "group_index": gi,
                    "row_index": ci,
                    "col_index": ri,
                    "text": summary_mirror,
                    "live": False,
                })

        ctx.update({
            "planned": planned,
            "groups_ctx": groups_ctx,
            # Список участников в порядке заполнения таблицы (для фронта)
            "initial_entries": json.dumps(items, ensure_ascii=False),
            # Счёты для отрисовки в матрице
            "initial_scores": json.dumps(initial_scores, ensure_ascii=False),
            "participant_label": (
                "Участник" if t.participant_mode == Tournament.ParticipantMode.SINGLES else "Пара"
            ),
        })
        return ctx


@require_POST
def complete_tournament(request: HttpRequest, pk: int):
    t = get_object_or_404(Tournament, pk=pk)
    if t.status == Tournament.Status.COMPLETED:
        return HttpResponseBadRequest("tournament is completed")
    # TODO: проверить, что все матчи сыграны; пока пропускаем проверку
    
    # Расчёт рейтинга при завершении турнира
    try:
        from apps.players.services.rating import recalculate_ratings_for_tournament
        recalculate_ratings_for_tournament(t.id)
    except Exception as e:
        # Логируем ошибку, но не блокируем завершение турнира
        import logging
        logger = logging.getLogger(__name__)
        logger.error(f"Ошибка расчета рейтинга для турнира {t.id}: {e}")
    
    t.status = Tournament.Status.COMPLETED
    t.save(update_fields=["status"])
    
    if request.headers.get("x-requested-with") == "XMLHttpRequest" or request.content_type == "application/json":
        return JsonResponse({"ok": True})
    return redirect("tournament_detail", pk=t.id)


@require_POST
def delete_tournament(request: HttpRequest, pk: int):
    t = get_object_or_404(Tournament, pk=pk)
    # Запрещаем удалять завершённый турнир через HTTP-обработчик
    if t.status == Tournament.Status.COMPLETED:
        return HttpResponseBadRequest("tournament is completed")
    # Каскадное удаление произойдёт по FK связям (Match, TournamentEntry, пр.)
    t.delete()
    return redirect("tournaments")


@require_POST
def save_participants(request: HttpRequest, pk: int):
    """Сохраняет текущих участников турнира (создаёт команды и TournamentEntry).

    Ожидает JSON вида:
    {
      "entries": [
        {"p1": <int>, "p2": <int|null>},
        ...
      ]
    }
    """
    import json

    t = get_object_or_404(Tournament, pk=pk)

    if request.content_type != "application/json":
        return HttpResponseBadRequest("expected application/json")

    try:
        payload = json.loads(request.body.decode("utf-8"))
    except Exception:
        return HttpResponseBadRequest("invalid json")

    entries = payload.get("entries")
    if not isinstance(entries, list):
        return HttpResponseBadRequest("entries must be a list")

    # Очищаем прежние участия (пересобираем с нуля)
    TournamentEntry.objects.filter(tournament=t).delete()

    created_entries = 0
    for item in entries:
        if not isinstance(item, dict):
            continue
        p1_id = item.get("p1")
        p2_id = item.get("p2")
        group_index = item.get("group_index")
        row_index = item.get("row_index")
        if not p1_id:
            continue
        try:
            gi = int(group_index)
            ri = int(row_index)
        except (TypeError, ValueError):
            continue

        try:
            p1 = Player.objects.get(pk=int(p1_id))
        except (Player.DoesNotExist, ValueError, TypeError):
            continue

        p2 = None
        if p2_id is not None:
            try:
                p2 = Player.objects.get(pk=int(p2_id))
            except (Player.DoesNotExist, ValueError, TypeError):
                p2 = None

        # Нормализуем порядок для пар: меньший id первым, чтобы не плодить дубликаты команд
        if p2 is not None and p2.id == p1.id:
            # запрещаем одинакового игрока в паре
            continue
        if p2 is not None and p2.id < p1.id:
            p1, p2 = p2, p1

        # Создаём/получаем команду
        team, _ = Team.objects.get_or_create(player_1=p1, player_2=p2)

        # Создаём участие в турнире
        TournamentEntry.objects.update_or_create(
            tournament=t,
            group_index=gi,
            row_index=ri,
            defaults={"team": team},
        )
        created_entries += 1

    # Генерация матчей для круговой системы по группам
    from apps.matches.models import Match
    # ВАЖНО: пары матчей не удаляем. Только создаём недостающие и обновляем порядок.

    # Собираем участников по группам
    group_map: dict[int, dict[int, int]] = {}
    qs = TournamentEntry.objects.filter(tournament=t).select_related("team")
    for e in qs:
        group_map.setdefault(e.group_index, {})[e.row_index] = e.team_id

    # Для каждой группы строим пары по _round_robin_pairings
    # 1) Сначала собираем множество актуальных пар (нормализованных), чтобы затем удалить устаревшие.
    new_pairs: set[tuple[int, int]] = set()
    for g_index, rows_dict in group_map.items():
        # индексы строк, отсортированные
        row_ids = sorted(rows_dict.keys())
        if len(row_ids) < 2:
            continue
        tours = _round_robin_pairings(row_ids)
        for tour in tours:
            for a, b in tour:
                team1_id = rows_dict.get(a)
                team2_id = rows_dict.get(b)
                if not team1_id or not team2_id:
                    continue
                pair = (team1_id, team2_id)
                pair_norm = (min(pair), max(pair))
                new_pairs.add(pair_norm)

    # 2) Создаём недостающие матчи и обновляем порядок для существующих
    for g_index, rows_dict in group_map.items():
        row_ids = sorted(rows_dict.keys())
        if len(row_ids) < 2:
            continue
        tours = _round_robin_pairings(row_ids)
        for tour_idx, tour in enumerate(tours, start=1):
            for order_in_round, (a, b) in enumerate(tour, start=1):
                team1_id = rows_dict.get(a)
                team2_id = rows_dict.get(b)
                if not team1_id or not team2_id:
                    continue
                # Ищем существующий матч (в любом порядке команд)
                m = (
                    Match.objects.filter(tournament=t, team_1_id=team1_id, team_2_id=team2_id).first()
                    or Match.objects.filter(tournament=t, team_1_id=team2_id, team_2_id=team1_id).first()
                )
                if m is None:
                    # Создаём новый матч (пары пишем в данном порядке). round_name и order_in_round задаём при создании
                    low_id, high_id = (team1_id, team2_id) if team1_id < team2_id else (team2_id, team1_id)
                    Match.objects.create(
                        tournament=t,
                        team_1_id=team1_id,
                        team_2_id=team2_id,
                        # Структурированные поля стадии
                        stage=Match.Stage.GROUP,
                        group_index=g_index,
                        round_index=tour_idx,
                        round_name=f"Группа {g_index}",
                        team_low_id=low_id,
                        team_high_id=high_id,
                        order_in_round=order_in_round + (tour_idx - 1) * 100,
                    )
                else:
                    # Пару не меняем, только обновляем порядок в туре
                    new_order = order_in_round + (tour_idx - 1) * 100
                    if m.order_in_round != new_order:
                        m.order_in_round = new_order
                        m.save(update_fields=["order_in_round"])

    # 3) Удаляем устаревшие матчи (их пары не присутствуют в new_pairs)
    # Сужаемся только на матчи группового этапа этого турнира, чтобы не трогать другие стадии
    to_check = Match.objects.filter(tournament=t, stage=Match.Stage.GROUP).only("id", "team_1_id", "team_2_id")
    removed = 0
    for m in to_check:
        pair_norm = (min(m.team_1_id, m.team_2_id), max(m.team_1_id, m.team_2_id))
        if pair_norm not in new_pairs:
            m.delete()
            removed += 1

    return JsonResponse({"ok": True, "saved": created_entries})


def brackets_json(request: HttpRequest, pk: int) -> JsonResponse:
    """JSON‑представление текущего состояния сеток олимпийки.

    Используется инлайновым JS в шаблоне `templates/tournaments/knockout.html`.
    """
    t = get_object_or_404(Tournament, pk=pk)
    if t.system != Tournament.System.KNOCKOUT:
        return HttpResponseBadRequest("tournament is not knockout")
    from apps.tournaments.services.knockout import serialize_brackets
    payload = serialize_brackets(t)
    return JsonResponse(payload)


@require_POST
def generate_knockout(request: HttpRequest, pk: int) -> HttpResponse:
    """Генерация каркаса сетки плей‑офф для турнира.

    Тело (опционально JSON): {"brackets_count": int, "has_third_place": bool}
    """
    t = get_object_or_404(Tournament, pk=pk)
    if t.system != Tournament.System.KNOCKOUT:
        return HttpResponseBadRequest("tournament is not knockout")

    brackets_count = None
    has_third_place = True
    if request.content_type == "application/json":
        try:
            data = json.loads(request.body.decode("utf-8"))
            brackets_count = data.get("brackets_count")
            has_third_place = bool(data.get("has_third_place", True))
        except Exception:
            return HttpResponseBadRequest("invalid json")

    from apps.tournaments.services.knockout import generate_brackets
    generate_brackets(t, brackets_count=brackets_count, has_third_place=has_third_place)

    if request.headers.get("x-requested-with") == "XMLHttpRequest" or request.content_type == "application/json":
        return JsonResponse({"ok": True})
    return redirect("tournament_detail", pk=t.id)


def _find_match_for_cell(tournament, group_index: int, row_index: int, col_index: int):
    """Находит матч для ячейки матрицы [group,row,col]."""
    from apps.matches.models import Match
    
    try:
        e1 = TournamentEntry.objects.get(tournament=tournament, group_index=group_index, row_index=row_index)
        e2 = TournamentEntry.objects.get(tournament=tournament, group_index=group_index, row_index=col_index)
    except TournamentEntry.DoesNotExist:
        return None, None, None
    
    team1_id = e1.team_id
    team2_id = e2.team_id
    
    # Ищем матч в любом порядке команд
    match = (
        Match.objects.filter(tournament=tournament, team_1_id=team1_id, team_2_id=team2_id).first()
        or Match.objects.filter(tournament=tournament, team_1_id=team2_id, team_2_id=team1_id).first()
    )
    
    # Определяем, нужно ли зеркалить счёт (если матч хранится в обратном порядке)
    mirror_score = False
    if match and match.team_1_id != team1_id:
        mirror_score = True
    
    return match, team1_id, team2_id, mirror_score


def _validate_sets(sets_data):
    """Валидирует данные сетов."""
    if not isinstance(sets_data, list):
        return False, "Sets must be a list"
    
    for i, set_data in enumerate(sets_data):
        if not isinstance(set_data, dict):
            return False, f"Set {i+1} must be an object"
        
        games_1 = set_data.get('games_1')
        games_2 = set_data.get('games_2')
        tb_1 = set_data.get('tb_1')
        tb_2 = set_data.get('tb_2')
        is_tb_only = set_data.get('is_tb_only', False)
        
        # Проверяем обязательные поля
        if not isinstance(games_1, int) or not isinstance(games_2, int):
            return False, f"Set {i+1}: games_1 and games_2 must be integers"
        
        if games_1 < 0 or games_2 < 0:
            return False, f"Set {i+1}: games cannot be negative"
        
        # Проверяем тайбрейки
        if tb_1 is not None or tb_2 is not None:
            if not isinstance(tb_1, int) or not isinstance(tb_2, int):
                return False, f"Set {i+1}: if tiebreak is specified, both tb_1 and tb_2 must be integers"
            if tb_1 < 0 or tb_2 < 0:
                return False, f"Set {i+1}: tiebreak points cannot be negative"
    
    return True, None


def _calculate_match_winner(match):
    """Вычисляет победителя матча на основе сетов."""
    sets = match.sets.all().order_by('index')
    if not sets:
        return None
    
    team1_sets = 0
    team2_sets = 0
    
    for match_set in sets:
        if match_set.is_tiebreak_only:
            # Сет-тайбрейк: побеждает тот, у кого больше очков
            if match_set.games_1 > match_set.games_2:
                team1_sets += 1
            else:
                team2_sets += 1
        else:
            # Обычный сет с возможным тайбрейком
            if match_set.games_1 > match_set.games_2:
                team1_sets += 1
            elif match_set.games_2 > match_set.games_1:
                team2_sets += 1
            # При равенстве геймов смотрим на тайбрейк
            elif match_set.tb_1 is not None and match_set.tb_2 is not None:
                if match_set.tb_1 > match_set.tb_2:
                    team1_sets += 1
                else:
                    team2_sets += 1
    
    # Определяем победителя (лучший из 3 или 5 сетов)
    sets_to_win = (len(sets) + 1) // 2
    if team1_sets >= sets_to_win:
        return match.team_1_id
    elif team2_sets >= sets_to_win:
        return match.team_2_id
    else:
        return None  # Матч не завершён


@require_POST
def save_score(request: HttpRequest, pk: int):
    """Сохранение счёта для ячейки [group,row,col] круговой матрицы.

    Ожидает JSON:
    {
      "group_index": int,
      "row_index": int,
      "col_index": int,
      "sets": [
        {
          "games_1": int,
          "games_2": int,
          "tb_1": int|null,
          "tb_2": int|null,
          "is_tb_only": boolean
        }
      ],
      "finalize": boolean  // опционально
    }
    """
    import json
    from apps.matches.models import Match, MatchSet
    from django.utils import timezone

    t = get_object_or_404(Tournament, pk=pk)
    if request.content_type != "application/json":
        return HttpResponseBadRequest("expected application/json")
    
    try:
        payload = json.loads(request.body.decode("utf-8"))
    except Exception:
        return HttpResponseBadRequest("invalid json")

    try:
        gi = int(payload.get("group_index"))
        ri = int(payload.get("row_index"))
        ci = int(payload.get("col_index"))
    except (TypeError, ValueError):
        return HttpResponseBadRequest("invalid indices")

    sets_data = payload.get("sets", [])
    finalize = payload.get("finalize", False)
    
    # Валидация сетов
    is_valid, error_msg = _validate_sets(sets_data)
    if not is_valid:
        return HttpResponseBadRequest(error_msg)
    
    # Находим матч
    result = _find_match_for_cell(t, gi, ri, ci)
    if result[0] is None:
        return HttpResponseBadRequest("entries not found")
    
    match, team1_id, team2_id, mirror_score = result
    
    if not match:
        # Создаём матч, если его нет
        low_id, high_id = (team1_id, team2_id) if team1_id < team2_id else (team2_id, team1_id)
        match = Match.objects.create(
            tournament=t,
            team_1_id=team1_id,
            team_2_id=team2_id,
            stage=Match.Stage.GROUP,
            group_index=gi,
            round_index=None,
            round_name=f"Группа {gi}",
            team_low_id=low_id,
            team_high_id=high_id,
        )
        mirror_score = False
    
    # Удаляем старые сеты и создаём новые
    match.sets.all().delete()
    
    for i, set_data in enumerate(sets_data, start=1):
        games_1 = set_data['games_1']
        games_2 = set_data['games_2']
        tb_1 = set_data.get('tb_1')
        tb_2 = set_data.get('tb_2')
        is_tb_only = set_data.get('is_tb_only', False)
        
        # Зеркалим счёт, если нужно
        if mirror_score:
            games_1, games_2 = games_2, games_1
            if tb_1 is not None and tb_2 is not None:
                tb_1, tb_2 = tb_2, tb_1
        
        MatchSet.objects.create(
            match=match,
            index=i,
            games_1=games_1,
            games_2=games_2,
            tb_1=tb_1,
            tb_2=tb_2,
            is_tiebreak_only=is_tb_only,
        )
    
    # Обновляем статус матча
    if not match.started_at and sets_data:
        match.started_at = timezone.now()
    
    if finalize or sets_data:
        winner = _calculate_match_winner(match)
        if winner:
            match.winner_id = winner
            if finalize:
                match.finished_at = timezone.now()
                # При подтверждении счёта помечаем матч завершённым
                from apps.matches.models import Match as MatchModel
                match.status = MatchModel.Status.COMPLETED
    
    match.save()
    # Пересчитываем статистику по группе
    try:
        from apps.tournaments.services.stats import recalc_group_stats
        recalc_group_stats(t, gi)
    except Exception as e:
        # Не роняем запрос, если пересчёт не удался; логирование можно добавить позже
        pass
    
    # Формируем резюме для ответа
    sets_summary = []
    for match_set in match.sets.all().order_by('index'):
        if mirror_score:
            # Зеркалим обратно для отображения
            g1, g2 = match_set.games_2, match_set.games_1
            tb1, tb2 = match_set.tb_2, match_set.tb_1
        else:
            g1, g2 = match_set.games_1, match_set.games_2
            tb1, tb2 = match_set.tb_1, match_set.tb_2
        
        if match_set.is_tiebreak_only:
            sets_summary.append(f"{g1}:{g2}")
        elif tb1 is not None and tb2 is not None:
            sets_summary.append(f"{g1}:{g2} ({tb1}:{tb2})")
        else:
            sets_summary.append(f"{g1}:{g2}")
    
    summary = ", ".join(sets_summary)
    
    return JsonResponse({
        "ok": True,
        "summary": summary,
        "winner": winner if not mirror_score else (team2_id if winner == team1_id else team1_id if winner == team2_id else None),
        "mirror_row_index": ci,
        "mirror_col_index": ri,
    })


def get_score(request: HttpRequest, pk: int):
    """Получение счёта для ячейки [group,row,col] круговой матрицы.
    
    Параметры GET:
    - group_index: int
    - row_index: int
    - col_index: int
    """
    t = get_object_or_404(Tournament, pk=pk)
    
    try:
        gi = int(request.GET.get("group_index"))
        ri = int(request.GET.get("row_index"))
        ci = int(request.GET.get("col_index"))
    except (TypeError, ValueError):
        return HttpResponseBadRequest("invalid indices")
    
    # Находим матч
    result = _find_match_for_cell(t, gi, ri, ci)
    if result[0] is None:
        return HttpResponseBadRequest("entries not found")
    
    match, team1_id, team2_id, mirror_score = result
    
    if not match:
        return JsonResponse({
            "ok": True,
            "sets": [],
            "summary": "",
            "winner": None
        })
    
    # Формируем данные сетов
    sets_data = []
    sets_summary = []
    
    for match_set in match.sets.all().order_by('index'):
        if mirror_score:
            # Зеркалим для отображения в UI
            g1, g2 = match_set.games_2, match_set.games_1
            tb1, tb2 = match_set.tb_2, match_set.tb_1
        else:
            g1, g2 = match_set.games_1, match_set.games_2
            tb1, tb2 = match_set.tb_1, match_set.tb_2
        
        sets_data.append({
            "games_1": g1,
            "games_2": g2,
            "tb_1": tb1,
            "tb_2": tb2,
            "is_tb_only": match_set.is_tiebreak_only
        })
        
        if match_set.is_tiebreak_only:
            sets_summary.append(f"{g1}:{g2}")
        elif tb1 is not None and tb2 is not None:
            sets_summary.append(f"{g1}:{g2} ({tb1}:{tb2})")
        else:
            sets_summary.append(f"{g1}:{g2}")
    
    summary = ", ".join(sets_summary)
    
    # Определяем победителя с учётом зеркалирования
    winner = None
    if match.winner_id:
        if mirror_score:
            winner = team2_id if match.winner_id == team1_id else team1_id if match.winner_id == team2_id else None
        else:
            winner = match.winner_id
    
    return JsonResponse({
        "ok": True,
        "sets": sets_data,
        "summary": summary,
        "winner": winner
    })


def _safe_ratio(w: int, l: int) -> float:
    if l == 0:
        return float(w) if w > 0 else 0.0
    return round(w / l, 3)


def _diff(w: int, l: int) -> int:
    return int(w - l)


def _team_display_name(team) -> str:
    p1 = team.player_1
    p2 = team.player_2
    if p2 is None:
        return p1.display_name or p1.first_name or str(p1)
    return f"{p1.display_name or p1.first_name} / {p2.display_name or p2.first_name}"


def _build_group_table(t: Tournament, gi: int):
    from apps.tournaments.services.stats import _aggregate_for_group
    from apps.matches.models import Match
    from apps.players.models import Player
    agg = _aggregate_for_group(t, gi)

    # Служебные функции
    def _roman(n: int) -> str:
        vals = [1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1]
        syms = ["M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"]
        res = []
        i = 0
        while n > 0:
            for _ in range(n // vals[i]):
                res.append(syms[i])
                n -= vals[i]
            i += 1
        return "".join(res) if res else ""

    def _team_has_petrov(team) -> bool:
        p1 = team.player_1
        p2 = team.player_2
        def is_petrov(p: Player | None) -> bool:
            return bool(p and p.last_name == "Петров" and p.first_name == "Михаил")
        return is_petrov(p1) or is_petrov(p2)

    def _team_rating(team) -> int:
        p1 = team.player_1
        p2 = team.player_2
        # Для пар — суммарный рейтинг, для одиночки — рейтинг игрока
        if p1 is None and p2 is None:
            return 0
        if p2 is not None:
            return int((p1.current_rating if p1 else 0) + (p2.current_rating if p2 else 0))
        return int(p1.current_rating if p1 else 0)

    def _head_to_head(a_team_id: int, b_team_id: int) -> int:
        """Возвращает -1 если A выше B по личной встрече, 1 если ниже, 0 если нельзя определить."""
        m = (
            Match.objects.filter(tournament=t, stage=Match.Stage.GROUP, group_index=gi)
            .filter(
                (
                    (Q(team_1_id=a_team_id) & Q(team_2_id=b_team_id)) |
                    (Q(team_1_id=b_team_id) & Q(team_2_id=a_team_id))
                )
            )
            .only("winner_id", "team_1_id", "team_2_id")
            .first()
        )
        if not m or not m.winner_id:
            return 0
        if m.winner_id == a_team_id:
            return -1
        if m.winner_id == b_team_id:
            return 1
        return 0

    # Собираем список участников с координатами строк и метриками
    entries = (
        TournamentEntry.objects.filter(tournament=t, group_index=gi)
        .select_related("team__player_1", "team__player_2")
        .order_by("row_index")
    )
    items = []
    for e in entries:
        data = agg.get(e.team_id, {"wins": 0, "sets_won": 0, "sets_lost": 0, "games_won": 0, "games_lost": 0})
        sets_won = int(data["sets_won"]) ; sets_lost = int(data["sets_lost"]) ; games_won = int(data["games_won"]) ; games_lost = int(data["games_lost"]) ; wins = int(data["wins"])
        items.append({
            "row_index": e.row_index,
            "team_name": _team_display_name(e.team),
            "wins": wins,
            "sets": f"{sets_won}-{sets_lost}",
            "sets_diff": _diff(sets_won, sets_lost),
            "sets_ratio": _safe_ratio(sets_won, sets_lost),
            "games": f"{games_won}-{games_lost}",
            "games_diff": _diff(games_won, games_lost),
            "games_ratio": _safe_ratio(games_won, games_lost),
            "team_id": e.team_id,
            "team": e.team,
            "has_petrov": _team_has_petrov(e.team),
            "rating": _team_rating(e.team),
        })

    # Группировка и ранжирование с поэтапными правилами
    def group_by(arr, key_fn):
        groups = {}
        for it in arr:
            k = key_fn(it)
            groups.setdefault(k, []).append(it)
        # порядок по ключу убыв/возр управляем самим key_fn
        return groups

    # Этап 1: по победам (desc)
    buckets1 = group_by(items, lambda r: r["wins"])
    ordered_wins = sorted(buckets1.keys(), reverse=True)
    ranked: list[dict] = []
    for w in ordered_wins:
        g1 = buckets1[w]
        if len(g1) == 1:
            ranked.extend(g1)
            continue
        # Этап 2: по разнице сетов (desc)
        buckets2 = group_by(g1, lambda r: r["sets_diff"])
        for sd in sorted(buckets2.keys(), reverse=True):
            g2 = buckets2[sd]
            if len(g2) == 2:
                a, b = g2[0], g2[1]
                h2h = _head_to_head(a["team_id"], b["team_id"])
                if h2h == -1:
                    ranked.extend([a, b])
                    continue
                elif h2h == 1:
                    ranked.extend([b, a])
                    continue
                # иначе продолжаем следующими правилами
            # Этап 3: по разнице геймов (desc)
            buckets3 = group_by(g2, lambda r: r["games_diff"])
            for gd in sorted(buckets3.keys(), reverse=True):
                g3 = buckets3[gd]
                if len(g3) == 2:
                    a, b = g3[0], g3[1]
                    h2h = _head_to_head(a["team_id"], b["team_id"])
                    if h2h == -1:
                        ranked.extend([a, b])
                        continue
                    elif h2h == 1:
                        ranked.extend([b, a])
                        continue
                # Этап 4: спец-правила для оставшихся групп (>=2)
                # 4.1 Петров Михаил в паре/у игрока
                g_petrov = [x for x in g3 if x["has_petrov"]]
                g_others = [x for x in g3 if not x["has_petrov"]]
                # 4.2 Рейтинг по убыванию
                g_petrov.sort(key=lambda r: (-r["rating"], r["team_name"]))
                g_others.sort(key=lambda r: (-r["rating"], r["team_name"]))
                ranked.extend(g_petrov + g_others)

    # Присвоение мест римскими цифрами по итоговому порядку
    place_map: dict[int, str] = {}
    for idx, r in enumerate(ranked, start=1):
        place_map[r["row_index"]] = _roman(idx)

    # Формируем финальную структуру (в порядке исходных строк)
    result = []
    for r in items:
        result.append({
            "row_index": r["row_index"],
            "wins": r["wins"],
            "sets": r["sets"],
            "sets_ratio": r["sets_ratio"],
            "games": r["games"],
            "games_ratio": r["games_ratio"],
            "place": place_map.get(r["row_index"], None),
        })
    return result


def get_group_stats(request: HttpRequest, pk: int):
    t = get_object_or_404(Tournament, pk=pk)
    try:
        gi = int(request.GET.get("group_index"))
    except (TypeError, ValueError):
        return HttpResponseBadRequest("invalid group_index")
    data = _build_group_table(t, gi)
    return JsonResponse({"ok": True, "stats": data})


@require_POST
def start_match(request: HttpRequest, pk: int):
    """Помечает матч как начатый: status=live, started_at=now.

    Ожидает JSON:
    {
      "group_index": int,
      "row_index": int,
      "col_index": int
    }
    """
    import json
    from django.utils import timezone
    from apps.matches.models import Match

    t = get_object_or_404(Tournament, pk=pk)

    if request.content_type != "application/json":
        return HttpResponseBadRequest("expected application/json")

    try:
        payload = json.loads(request.body.decode("utf-8"))
    except Exception:
        return HttpResponseBadRequest("invalid json")

    try:
        gi = int(payload.get("group_index"))
        ri = int(payload.get("row_index"))
        ci = int(payload.get("col_index"))
    except (TypeError, ValueError):
        return HttpResponseBadRequest("invalid indices")

    match, team1_id, team2_id, _mirror = _find_match_for_cell(t, gi, ri, ci)

    if not match:
        # создаём скелет матча, если ещё не был создан
        low_id, high_id = (team1_id, team2_id) if team1_id < team2_id else (team2_id, team1_id)
        match = Match.objects.create(
            tournament=t,
            team_1_id=team1_id,
            team_2_id=team2_id,
            stage=Match.Stage.GROUP,
            group_index=gi,
            round_index=None,
            round_name=f"Группа {gi}",
            team_low_id=low_id,
            team_high_id=high_id,
        )

    # Обновляем статус и время начала, если ещё не стартовал
    if not match.started_at:
        match.started_at = timezone.now()
    match.status = Match.Status.LIVE
    match.save(update_fields=["started_at", "status"])

    # Для фронтенда сообщаем координаты зеркальной ячейки
    return JsonResponse({
        "ok": True,
        "group_index": gi,
        "row_index": ri,
        "col_index": ci,
        "mirror_row_index": ci,
        "mirror_col_index": ri,
    })


@require_POST
def cancel_score(request: HttpRequest, pk: int):
    """Отменяет введённый счёт: удаляет MatchSet, сбрасывает winner/started_at/finished_at и статус.

    Ожидает JSON:
    {
      "group_index": int,
      "row_index": int,
      "col_index": int
    }
    """
    from apps.matches.models import Match

    t = get_object_or_404(Tournament, pk=pk)

    if request.content_type != "application/json":
        return HttpResponseBadRequest("expected application/json")

    try:
        payload = json.loads(request.body.decode("utf-8"))
    except Exception:
        return HttpResponseBadRequest("invalid json")

    try:
        gi = int(payload.get("group_index"))
        ri = int(payload.get("row_index"))
        ci = int(payload.get("col_index"))
    except (TypeError, ValueError):
        return HttpResponseBadRequest("invalid indices")

    match, _t1, _t2, _mirror = _find_match_for_cell(t, gi, ri, ci)
    if not match:
        # Нечего отменять, но на фронте надо очистить обе ячейки
        return JsonResponse({"ok": True, "mirror_row_index": ci, "mirror_col_index": ri})

    # Удаляем все сеты и сбрасываем поля матча
    match.sets.all().delete()
    match.winner_id = None
    match.started_at = None
    match.finished_at = None
    match.status = Match.Status.SCHEDULED
    match.save(update_fields=["winner_id", "started_at", "finished_at", "status"])

    # Пересчитываем статистику по группе
    try:
        from apps.tournaments.services.stats import recalc_group_stats
        recalc_group_stats(t, gi)
    except Exception:
        pass

    return JsonResponse({
        "ok": True,
        "mirror_row_index": ci,
        "mirror_col_index": ri,
    })


@require_POST
def cancel_start_match(request: HttpRequest, pk: int):
    """Отменяет начало матча: started_at=NULL, статус возвращаем в scheduled (если не завершён).

    Ожидает JSON:
    {
      "group_index": int,
      "row_index": int,
      "col_index": int
    }
    """
    import json
    from apps.matches.models import Match

    t = get_object_or_404(Tournament, pk=pk)

    if request.content_type != "application/json":
        return HttpResponseBadRequest("expected application/json")

    try:
        payload = json.loads(request.body.decode("utf-8"))
    except Exception:
        return HttpResponseBadRequest("invalid json")

    try:
        gi = int(payload.get("group_index"))
        ri = int(payload.get("row_index"))
        ci = int(payload.get("col_index"))
    except (TypeError, ValueError):
        return HttpResponseBadRequest("invalid indices")

    match, _t1, _t2, _mirror = _find_match_for_cell(t, gi, ri, ci)

    if not match:
        return HttpResponseBadRequest("match not found")

    # Обнуляем started_at и возвращаем статус, если матч не завершён
    match.started_at = None
    if match.finished_at is None:
        match.status = Match.Status.SCHEDULED
        match.save(update_fields=["started_at", "status"])
    else:
        match.save(update_fields=["started_at"])  # если завершён — статус не трогаем

    return JsonResponse({
        "ok": True,
        "group_index": gi,
        "row_index": ri,
        "col_index": ci,
        "mirror_row_index": ci,
        "mirror_col_index": ri,
    })

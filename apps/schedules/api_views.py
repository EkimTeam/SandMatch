from io import BytesIO
from datetime import datetime, time, timedelta
from typing import Any

from rest_framework import status, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response

from apps.matches.models import Match
from apps.tournaments.serializers import MatchSerializer
from apps.tournaments.models import Tournament
from apps.accounts.permissions import IsTournamentCreatorOrAdmin, Role, _get_user_role

from django.db import transaction

from .models import Schedule
from .serializers import ScheduleSerializer


class ScheduleViewSet(viewsets.ModelViewSet):
    queryset = Schedule.objects.all()
    serializer_class = ScheduleSerializer
    permission_classes = [AllowAny]

    def _scoped_tournaments(self, schedule: Schedule):
        return [s.tournament for s in schedule.scopes.select_related("tournament").all() if s.tournament]

    def _ensure_can_view_schedule(self, request, schedule: Schedule) -> None:
        tournaments = self._scoped_tournaments(schedule)

        user = getattr(request, "user", None)
        if not user or not getattr(user, "is_authenticated", False):
            for t in tournaments:
                if t.status == Tournament.Status.COMPLETED and t.system == Tournament.System.KING:
                    raise PermissionDenied("Authentication required to view completed King tournaments")

    def _ensure_can_manage_schedule(self, request, schedule: Schedule) -> None:
        user = getattr(request, "user", None)
        if not user or not getattr(user, "is_authenticated", False):
            raise PermissionDenied("Authentication required")

        role = _get_user_role(user)
        if role == Role.ADMIN or getattr(user, "is_staff", False) or getattr(user, "is_superuser", False):
            return

        perm = IsTournamentCreatorOrAdmin()
        tournaments = self._scoped_tournaments(schedule)
        for t in tournaments:
            if not perm.has_object_permission(request, self, t):
                raise PermissionDenied("You do not have permission to manage this schedule")

    def get_permissions(self):
        if self.action in {"create", "update", "partial_update", "destroy", "save"}:
            return [IsAuthenticated()]
        return super().get_permissions()

    @action(detail=True, methods=["post"], url_path="save", permission_classes=[IsAuthenticated])
    def save(self, request, pk=None):
        """Сохранить расписание одним запросом.

        MVP-реализация: полная перезапись дочерних сущностей (courts/runs/slots/global_breaks).

        Payload:
        - match_duration_minutes?: int
        - courts: [{ index:int, name:str, first_start_time?:"HH:MM"|null }]
        - runs: [{ index:int, start_mode:"fixed"|"then"|"not_earlier", start_time?:"HH:MM"|null, not_earlier_time?:"HH:MM"|null }]
        - slots: [{ run_index:int, court_index:int, slot_type:"match"|"text", match_id?:int|null,
                   text_title?:str|null, text_subtitle?:str|null, override_title?:str|null, override_subtitle?:str|null }]
        - global_breaks: [{ position:int, time:"HH:MM", text:str }]
        """

        schedule: Schedule = self.get_object()
        self._ensure_can_manage_schedule(request, schedule)
        payload = request.data or {}

        def parse_time(v):
            if v is None or v == "":
                return None
            if isinstance(v, time):
                return v
            if isinstance(v, str):
                parts = v.split(":")
                if len(parts) >= 2:
                    hh = parts[0]
                    mm = parts[1]
                    ss = parts[2] if len(parts) >= 3 else "0"
                    try:
                        return time(int(hh), int(mm), int(ss))
                    except Exception:
                        return time(int(hh), int(mm))
                return None
            return None

        courts_in = payload.get("courts") or []
        runs_in = payload.get("runs") or []
        slots_in = payload.get("slots") or []
        breaks_in = payload.get("global_breaks") or []

        try:
            mdm = payload.get("match_duration_minutes")
            if mdm is not None:
                schedule.match_duration_minutes = int(mdm)
        except Exception:
            return Response(
                {"ok": False, "error": "bad_params", "detail": "match_duration_minutes должен быть числом"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        from .models import ScheduleCourt, ScheduleGlobalBreak, ScheduleRun, ScheduleSlot

        with transaction.atomic():
            schedule.save(update_fields=["match_duration_minutes", "updated_at"])

            # очищаем дочерние записи
            ScheduleSlot.objects.filter(schedule=schedule).delete()
            ScheduleGlobalBreak.objects.filter(schedule=schedule).delete()
            ScheduleRun.objects.filter(schedule=schedule).delete()
            ScheduleCourt.objects.filter(schedule=schedule).delete()

            # создаём корты
            court_by_index = {}
            for item in courts_in:
                idx = int(item.get("index"))
                name = item.get("name") or f"Корт {idx}"
                fst = parse_time(item.get("first_start_time"))
                court = ScheduleCourt.objects.create(
                    schedule=schedule,
                    index=idx,
                    name=str(name)[:128],
                    first_start_time=fst,
                )
                court_by_index[idx] = court

            # создаём запуски
            run_by_index = {}
            for item in runs_in:
                idx = int(item.get("index"))
                start_mode = item.get("start_mode") or "fixed"
                st = parse_time(item.get("start_time"))
                ne = parse_time(item.get("not_earlier_time"))
                run = ScheduleRun.objects.create(
                    schedule=schedule,
                    index=idx,
                    start_mode=start_mode,
                    start_time=st,
                    not_earlier_time=ne,
                )
                run_by_index[idx] = run

            # глобальные паузы
            for item in breaks_in:
                pos = int(item.get("position"))
                t = parse_time(item.get("time"))
                txt = str(item.get("text") or "")[:256]
                if not t or not txt:
                    continue
                ScheduleGlobalBreak.objects.create(schedule=schedule, position=pos, time=t, text=txt)

            # слоты
            for item in slots_in:
                run_idx = int(item.get("run_index"))
                court_idx = int(item.get("court_index"))
                run = run_by_index.get(run_idx)
                court = court_by_index.get(court_idx)
                if not run or not court:
                    continue
                slot_type = item.get("slot_type")
                match_id = item.get("match_id")
                if match_id is not None:
                    try:
                        match_id = int(match_id)
                    except Exception:
                        match_id = None

                ScheduleSlot.objects.create(
                    schedule=schedule,
                    run=run,
                    court=court,
                    slot_type=slot_type,
                    match_id=match_id,
                    text_title=item.get("text_title"),
                    text_subtitle=item.get("text_subtitle"),
                    override_title=item.get("override_title"),
                    override_subtitle=item.get("override_subtitle"),
                )

        schedule.refresh_from_db()
        return Response({"ok": True, "schedule": ScheduleSerializer(schedule).data})

    @action(detail=True, methods=["get"], url_path="matches_pool", permission_classes=[AllowAny])
    def matches_pool(self, request, pk=None):
        schedule: Schedule = self.get_object()
        self._ensure_can_view_schedule(request, schedule)

        tournament_ids = list(schedule.scopes.values_list("tournament_id", flat=True))
        if not tournament_ids:
            return Response({"ok": True, "matches": []})

        assigned_ids = set(
            schedule.slots.exclude(match_id__isnull=True).values_list("match_id", flat=True)
        )

        # Пул матчей:
        # - все НЕ завершенные матчи турниров/стадий из scope (кроме placement)
        # - плюс завершенные матчи, если они уже назначены в расписание (для таймлайна/просмотра счёта)
        base_qs = Match.objects.filter(tournament_id__in=tournament_ids).exclude(stage=Match.Stage.PLACEMENT)
        pool_qs = (
            base_qs.exclude(status=Match.Status.COMPLETED)
            | base_qs.filter(id__in=assigned_ids, status=Match.Status.COMPLETED)
        )
        pool_qs = (
            pool_qs.select_related("tournament", "team_1", "team_2", "winner")
            .prefetch_related("sets")
            .order_by("tournament_id", "stage", "round_index", "order_in_round", "id")
        )

        results: list[dict[str, Any]] = []
        for m in pool_qs:
            dto = MatchSerializer(m).data
            dto["is_assigned"] = m.id in assigned_ids
            results.append(dto)

        return Response({"ok": True, "matches": results})

    @action(detail=True, methods=["get"], url_path="live_state", permission_classes=[AllowAny])
    def live_state(self, request, pk=None):
        schedule: Schedule = self.get_object()
        self._ensure_can_view_schedule(request, schedule)
        match_ids = list(
            schedule.slots.exclude(match_id__isnull=True).values_list("match_id", flat=True).distinct()
        )
        if not match_ids:
            return Response({"ok": True, "matches": []})

        qs = Match.objects.filter(id__in=match_ids).only("id", "status", "started_at", "finished_at")
        items = []
        for m in qs:
            items.append(
                {
                    "id": m.id,
                    "status": m.status,
                    "started_at": m.started_at,
                    "finished_at": m.finished_at,
                }
            )
        return Response({"ok": True, "matches": items})

    @action(detail=True, methods=["get"], url_path="export/pdf", permission_classes=[IsAuthenticated])
    def export_pdf(self, request, pk=None):
        schedule: Schedule = self.get_object()
        self._ensure_can_manage_schedule(request, schedule)

        # Prefer HTML/CSS -> PDF rendering via headless Chromium (maximally identical to browser).
        # If Playwright/Chromium is unavailable on the server, fall back to legacy ReportLab renderer.
        try:
            from playwright.sync_api import sync_playwright

            courts = list(schedule.courts.all().order_by("index"))
            dense_mode = len(courts) >= 9
            runs = list(schedule.runs.all().order_by("index"))
            slots_qs = schedule.slots.select_related(
                "run",
                "court",
                "match",
                "match__tournament",
                "match__team_1",
                "match__team_2",
            )
            slots_map: dict[tuple[int, int], Any] = {}
            for s in slots_qs:
                slots_map[(s.run_id, s.court_id)] = s

            # Precompute row indices for RR meta label: "гр.X • a-b"
            rr_row_by_team: dict[tuple[int, int, int], int] = {}
            try:
                from apps.tournaments.models import TournamentEntry

                t_ids: set[int] = set()
                team_ids: set[int] = set()
                for s in slots_qs:
                    if getattr(s, "slot_type", None) != "match":
                        continue
                    m = getattr(s, "match", None)
                    if not m or not getattr(m, "tournament_id", None):
                        continue
                    t_ids.add(int(m.tournament_id))
                    if getattr(m, "team_1_id", None):
                        team_ids.add(int(m.team_1_id))
                    if getattr(m, "team_2_id", None):
                        team_ids.add(int(m.team_2_id))

                if t_ids and team_ids:
                    qs = TournamentEntry.objects.filter(tournament_id__in=list(t_ids), team_id__in=list(team_ids)).only(
                        "tournament_id", "team_id", "group_index", "row_index"
                    )
                    for e in qs:
                        gi = int(e.group_index) if e.group_index is not None else 0
                        if gi <= 0 or e.row_index is None:
                            continue
                        rr_row_by_team[(int(e.tournament_id), gi, int(e.team_id))] = int(e.row_index)
            except Exception:
                rr_row_by_team = {}

            tournament_names = []
            for scope in schedule.scopes.select_related("tournament").all():
                if scope.tournament and scope.tournament.name:
                    tournament_names.append(str(scope.tournament.name))
            title = " + ".join(tournament_names) if tournament_names else "Расписание"

            def esc(v: Any) -> str:
                import html

                return html.escape("" if v is None else str(v))

            def _raw_team_label(team: Any) -> str:
                if not team:
                    return ""
                return (
                    getattr(team, "display_name", None)
                    or getattr(team, "name", None)
                    or str(team)
                )

            def _split_players(label: str) -> list[tuple[str, str]]:
                import re

                s = (label or "").strip()
                if not s or s.upper() == "TBD":
                    return []

                parts = [p.strip() for p in re.split(r"\s*/\s*", s) if p.strip()]
                out: list[tuple[str, str]] = []
                for p in parts:
                    tokens = [t for t in p.split() if t]
                    if not tokens:
                        continue
                    surname = tokens[0]
                    initial = ""
                    if len(tokens) >= 2 and tokens[1]:
                        initial = tokens[1][0].upper()
                    out.append((surname, initial))
                return out

            def _players_unique_key(surname: str, initial: str) -> str:
                return f"{surname}|{initial}" if initial else surname

            surname_to_keys: dict[str, set[str]] = {}
            for s in slots_qs:
                if getattr(s, "slot_type", None) != "match":
                    continue
                m = getattr(s, "match", None)
                if not m:
                    continue
                for team in [getattr(m, "team_1", None), getattr(m, "team_2", None)]:
                    raw = _raw_team_label(team)
                    for (sn, ini) in _split_players(raw):
                        surname_to_keys.setdefault(sn, set()).add(_players_unique_key(sn, ini))

            def team_label(team: Any) -> str:
                if not team:
                    return "TBD"

                raw = _raw_team_label(team)
                if not raw:
                    return "TBD"

                players = _split_players(raw)
                if not players:
                    return raw

                labels: list[str] = []
                for (sn, ini) in players:
                    if len(surname_to_keys.get(sn, set())) > 1 and ini:
                        labels.append(f"{sn} {ini}.")
                    else:
                        labels.append(sn)
                return "\n".join(labels)

            def run_top_label(run_obj: Any) -> str:
                try:
                    mode = getattr(run_obj, "start_mode", "")
                    if mode == "then":
                        return "Затем"
                    if mode == "not_earlier":
                        t = getattr(run_obj, "not_earlier_time", None)
                        if t:
                            return f"не ранее {t.strftime('%H:%M')}"
                        return "не ранее"
                    t = getattr(run_obj, "start_time", None)
                    if t:
                        return t.strftime("%H:%M")
                except Exception:
                    pass
                return ""

            def match_meta_label(m: Any) -> str:
                if not m:
                    return ""

                gi = getattr(m, "group_index", None)
                group = f"гр.{gi}" if gi is not None else ""

                try:
                    system = getattr(getattr(m, "tournament", None), "system", "")
                except Exception:
                    system = ""

                if system == "knockout":
                    rn = str(getattr(m, "round_name", "") or "").strip()
                    if rn:
                        return rn
                    ri = getattr(m, "round_index", None)
                    return f"Раунд {ri}".strip() if ri is not None else ""

                if system == "round_robin":
                    try:
                        gi_int = int(gi) if gi is not None else 0
                        t_id = int(getattr(m, "tournament_id", 0) or 0)
                        a_id = int(getattr(m, "team_1_id", 0) or 0)
                        b_id = int(getattr(m, "team_2_id", 0) or 0)
                        r1 = rr_row_by_team.get((t_id, gi_int, a_id))
                        r2 = rr_row_by_team.get((t_id, gi_int, b_id))
                        pair = f"{r1}-{r2}" if (r1 is not None and r2 is not None) else ""
                        return " • ".join([p for p in [group, pair] if p])
                    except Exception:
                        return group

                # king / other systems
                return group

            def slot_class(slot: Any) -> str:
                try:
                    if slot and slot.match and slot.match.status == Match.Status.LIVE:
                        return " cellLive"
                    if slot and slot.match and slot.match.status == Match.Status.COMPLETED:
                        return " cellCompleted"
                except Exception:
                    pass
                return ""

            def slot_html(run_obj: Any, slot: Any) -> str:
                if not slot:
                    return ""
                if getattr(slot, "slot_type", None) == "text":
                    return f'<div class="cellText">{esc(getattr(slot, "text_title", "") or "")}</div>'
                if getattr(slot, "slot_type", None) == "match" and getattr(slot, "match_id", None):
                    if getattr(slot, "override_title", None):
                        return f'<div class="cellText">{esc(slot.override_title)}</div>'
                    m = getattr(slot, "match", None)
                    if not m:
                        return f'<div class="cellText">Матч #{esc(slot.match_id)}</div>'
                    t0 = run_top_label(run_obj)
                    meta = match_meta_label(m)
                    t1 = team_label(getattr(m, "team_1", None))
                    t2 = team_label(getattr(m, "team_2", None))
                    t1_lines = [ln for ln in str(t1).split("\n") if ln]
                    t2_lines = [ln for ln in str(t2).split("\n") if ln]
                    t1_html = "".join([f'<div class="player">{esc(ln)}</div>' for ln in t1_lines])
                    t2_html = "".join([f'<div class="player">{esc(ln)}</div>' for ln in t2_lines])
                    return (
                        '<div class="matchTile">'
                        + (f'<div class="matchTop">{esc(t0)}</div>' if t0 else '')
                        + (f'<div class="matchMeta">{esc(meta)}</div>' if meta else '')
                        + f'<div class="teamBlock">{t1_html}</div>'
                        '<div class="vs">против</div>'
                        f'<div class="teamBlock">{t2_html}</div>'
                        "</div>"
                    )
                return ""

            court_headers = "".join(
                [
                    "<th>"
                    + (
                        f"<div class=\"courtName\">{esc((c.name or '').replace('Корт ', 'Корт') or f'Корт{c.index}')}</div>"
                        if dense_mode
                        else f"<div class=\"courtName\">{esc(c.name or f'Корт {c.index}')}</div>"
                    )
                    + "</th>"
                    for c in courts
                ]
            )

            body_rows: list[str] = []
            for r in runs:
                left = (
                    f"<td class=\"runCol\">"
                    f"<div class=\"runTitle\">Запуск {esc(r.index)}</div>"
                    + (
                        f"<div class=\"runPlan\">План: {esc(r.start_time.strftime('%H:%M'))}</div>"
                        if getattr(r, "start_time", None)
                        else ""
                    )
                    + "</td>"
                )
                cells = []
                for c in courts:
                    slot = slots_map.get((r.id, c.id))
                    cells.append(f"<td class=\"cell{slot_class(slot)}\">{slot_html(r, slot)}</td>")
                body_rows.append("<tr>" + left + "".join(cells) + "</tr>")

            html_doc = f"""<!doctype html>
<html lang=\"ru\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
  <title>{esc(title)}</title>
  <style>
    @page {{ size: A4 portrait; margin: 10mm; }}
    * {{ box-sizing: border-box; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, 'Noto Sans', 'DejaVu Sans', sans-serif;
      color: #111827;
    }}

    body.dense {{ font-size: 11px; }}
    body.dense thead th {{ padding: 4px 4px; }}
    body.dense tbody td {{ padding: 4px; }}
    .pageHeader {{ display:flex; align-items:flex-start; justify-content:space-between; margin-bottom: 6px; }}
    .pageHeader .h1 {{ font-size: 16px; font-weight: 700; line-height: 1.15; }}
    .pageHeader .h2 {{ font-size: 11px; color: #374151; margin-top: 2px; }}
    .pageHeader .date {{ font-size: 11px; color: #111827; }}

    table {{ width: 100%; border-collapse: collapse; table-layout: {'auto' if dense_mode else 'fixed'}; }}
    thead th {{
      background: #F3F4F6;
      border-bottom: 1px solid #D1D5DB;
      padding: 6px 6px;
      text-align: left;
      vertical-align: bottom;
    }}
    thead th:first-child {{ width: {'72px' if dense_mode else '88px'}; }}
    tbody td {{
      border-bottom: 1px solid #E5E7EB;
      border-right: 1px solid #E5E7EB;
      padding: 6px;
      vertical-align: middle;
    }}
    tbody td:last-child {{ border-right: 0; }}
    tbody tr td:first-child {{ border-right: 1px solid #D1D5DB; }}

    .courtName {{ font-weight: 700; }}
    .runCol .runTitle {{ font-weight: 700; }}
    .runCol .runPlan {{ font-size: 10px; color: #6B7280; margin-top: 1px; }}

    .cell {{ text-align: center; }}
    .matchTile {{ display:flex; flex-direction:column; align-items:center; justify-content:flex-start; }}
    .matchTop {{ font-size: 10px; color: #6B7280; margin-bottom: 2px; }}
    .matchMeta {{ font-size: 10px; color: #374151; margin-bottom: 2px; width: 100%; text-align: right; }}
    .teamBlock {{ display:flex; flex-direction:column; align-items:center; justify-content:flex-start; }}
    .player {{ font-size: {'11px' if dense_mode else '12px'}; line-height: 1.12; }}
    .vs {{ font-weight: 700; font-size: {'10px' if dense_mode else '11px'}; margin: 2px 0; }}
    .cellText {{ font-size: {'11px' if dense_mode else '12px'}; line-height: 1.15; }}

    .cellLive {{ background: #D1FAE5; }}
    .cellCompleted {{ background: #E5E7EB; }}
  </style>
</head>
<body class="{'dense' if dense_mode else ''}">
  <div class="pageHeader">
    <div>
      <div class="h1">Расписание</div>
      <div class="h2">{esc(title)}</div>
    </div>
    <div class=\"date\">{esc(schedule.date)}</div>
  </div>

  <table>
    <thead>
      <tr>
        <th>Запуск</th>
        {court_headers}
      </tr>
    </thead>
    <tbody>
      {''.join(body_rows)}
    </tbody>
  </table>
</body>
</html>"""

            with sync_playwright() as p:
                browser = p.chromium.launch()
                page = browser.new_page(viewport={"width": 900, "height": 1400})
                page.set_content(html_doc, wait_until="load")
                page.emulate_media(media="screen")
                pdf_bytes = page.pdf(format="A4", landscape=False, print_background=True)
                browser.close()

            from django.http import HttpResponse

            resp = HttpResponse(pdf_bytes, content_type="application/pdf")
            resp["Content-Disposition"] = f'attachment; filename="schedule_{schedule.id}.pdf"'
            return resp
        except Exception:
            pass

        try:
            from reportlab.lib import colors
            from reportlab.lib.pagesizes import A4, landscape
            from reportlab.pdfbase import pdfmetrics
            from reportlab.pdfbase.ttfonts import TTFont
            from reportlab.pdfgen.canvas import Canvas
        except Exception:
            return Response(
                {
                    "ok": False,
                    "error": "pdf_export_unavailable",
                    "detail": "PDF export is unavailable on this server (missing dependency: reportlab or playwright)",
                },
                status=status.HTTP_501_NOT_IMPLEMENTED,
            )

        # Подготовим данные (все runs/courts + mapping слотов)
        courts = list(schedule.courts.all().order_by("index"))
        runs = list(schedule.runs.all().order_by("index"))
        slots_qs = schedule.slots.select_related("run", "court", "match", "match__tournament", "match__team_1", "match__team_2")
        slots_map: dict[tuple[int, int], Any] = {}
        for s in slots_qs:
            slots_map[(s.run_id, s.court_id)] = s

        breaks = list(schedule.global_breaks.all().order_by("position"))
        breaks_by_pos: dict[int, list[Any]] = {}
        for br in breaks:
            breaks_by_pos.setdefault(int(br.position), []).append(br)

        tournament_names = []
        for scope in schedule.scopes.select_related("tournament").all():
            if scope.tournament and scope.tournament.name:
                tournament_names.append(str(scope.tournament.name))
        title = " + ".join(tournament_names) if tournament_names else "Расписание"

        # --- PDF canvas ---
        buf = BytesIO()
        page_size = landscape(A4)
        c = Canvas(buf, pagesize=page_size)

        # Регистрируем шрифт с кириллицей. Если не найден, используем стандартный.
        font_name = "Helvetica"
        try:
            import os

            candidates = [
                ("DejaVuSans", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
                ("Arial", r"C:\\Windows\\Fonts\\arial.ttf"),
                ("Arial", r"C:\\Windows\\Fonts\\ARIAL.TTF"),
            ]

            for name, path in candidates:
                if path and os.path.exists(path):
                    pdfmetrics.registerFont(TTFont(name, path))
                    font_name = name
                    break
        except Exception:
            pass

        page_w, page_h = page_size
        margin_x = 24
        margin_y = 24

        header_h = 48
        col_header_h = 34
        run_row_h = 110
        break_row_h = 24

        # Доступная высота под таблицу (без шапки)
        table_top_y = page_h - margin_y - header_h
        table_bottom_y = margin_y
        table_h = table_top_y - table_bottom_y

        # Ширины колонок
        run_col_w = 110

        def split_courts_evenly(items: list[Any], max_per_page: int = 10) -> list[list[Any]]:
            n = len(items)
            if n <= max_per_page:
                return [items]
            # Равномерное разбиение на k страниц
            import math

            k = int(math.ceil(n / max_per_page))
            per = int(math.ceil(n / k))
            chunks = []
            i = 0
            while i < n:
                chunks.append(items[i : i + per])
                i += per
            return chunks

        court_chunks = split_courts_evenly(courts, max_per_page=10)

        def draw_page_header():
            c.setFillColor(colors.black)
            c.setFont(font_name, 14)
            c.drawString(margin_x, page_h - margin_y - 18, "Расписание")
            c.setFont(font_name, 11)
            c.drawString(margin_x, page_h - margin_y - 36, f"{title}")
            c.drawRightString(page_w - margin_x, page_h - margin_y - 18, str(schedule.date))

        def draw_table_header(courts_subset: list[Any], x0: float, y0: float, col_w: float):
            # фон
            c.setFillColor(colors.HexColor("#F3F4F6"))
            c.rect(x0, y0 - col_header_h, run_col_w + col_w * len(courts_subset), col_header_h, fill=1, stroke=0)

            c.setFillColor(colors.black)
            c.setFont(font_name, 10)
            c.drawString(x0 + 6, y0 - 18, "Запуск")
            for idx, court in enumerate(courts_subset):
                cx = x0 + run_col_w + idx * col_w
                name = court.name or f"Корт {court.index}"
                c.drawString(cx + 6, y0 - 16, name[:24])
                try:
                    if getattr(court, "first_start_time", None):
                        c.setFont(font_name, 9)
                        c.setFillColor(colors.HexColor("#4B5563"))
                        c.drawString(cx + 6, y0 - 29, f"Начало {court.first_start_time.strftime('%H:%M')}")
                        c.setFillColor(colors.black)
                        c.setFont(font_name, 10)
                except Exception:
                    pass

            c.setStrokeColor(colors.HexColor("#D1D5DB"))
            c.line(x0, y0 - col_header_h, x0 + run_col_w + col_w * len(courts_subset), y0 - col_header_h)

        def slot_text(slot: Any) -> str:
            if not slot:
                return ""
            if slot.slot_type == "text":
                return (slot.text_title or "")[:40]
            if slot.slot_type == "match" and slot.match_id:
                # основной текст: override_title или display team names
                if slot.override_title:
                    return str(slot.override_title)[:40]
                m = slot.match
                if not m:
                    return f"Матч #{slot.match_id}"
                t1 = getattr(m.team_1, "display_name", None) or getattr(m.team_1, "name", None) or str(m.team_1) if m.team_1 else "TBD"
                t2 = getattr(m.team_2, "display_name", None) or getattr(m.team_2, "name", None) or str(m.team_2) if m.team_2 else "TBD"
                return f"{t1}\nпротив\n{t2}"
            return ""

        def slot_status_color(slot: Any):
            try:
                if slot and slot.match and slot.match.status == Match.Status.LIVE:
                    return colors.HexColor("#D1FAE5")
                if slot and slot.match and slot.match.status == Match.Status.COMPLETED:
                    return colors.HexColor("#E5E7EB")
            except Exception:
                pass
            return None

        def draw_run_row(courts_subset: list[Any], run_obj: Any, x0: float, y_top: float, col_w: float):
            # левая колонка
            c.setFont(font_name, 10)
            c.setFillColor(colors.black)
            label = f"Запуск {run_obj.index}"
            time_str = ""
            if run_obj.start_time:
                time_str = run_obj.start_time.strftime("%H:%M")
            c.drawString(x0 + 6, y_top - 18, (label)[:24])
            if time_str:
                c.setFont(font_name, 9)
                c.setFillColor(colors.HexColor("#4B5563"))
                c.drawString(x0 + 6, y_top - 34, f"План: {time_str}")
                c.setFillColor(colors.black)
                c.setFont(font_name, 10)

            # ячейки
            for idx, court in enumerate(courts_subset):
                cx = x0 + run_col_w + idx * col_w
                slot = slots_map.get((run_obj.id, court.id))

                fill = slot_status_color(slot)
                if fill is not None:
                    c.setFillColor(fill)
                    c.rect(cx, y_top - run_row_h, col_w, run_row_h, fill=1, stroke=0)

                c.setFillColor(colors.black)
                txt = slot_text(slot)
                if txt:
                    lines = [ln.strip() for ln in str(txt).split("\n") if ln.strip()]
                    # вертикальное размещение ближе к центру ячейки
                    c.setFont(font_name, 10)
                    start_y = y_top - 42
                    line_h = 14
                    for i, ln in enumerate(lines[:5]):
                        # грубое центрирование по ширине
                        w = pdfmetrics.stringWidth(ln, font_name, 10)
                        tx = cx + max(4, (col_w - w) / 2.0)
                        c.drawString(tx, start_y - i * line_h, ln[:60])

            # линии сетки
            c.setStrokeColor(colors.HexColor("#E5E7EB"))
            c.line(x0, y_top - run_row_h, x0 + run_col_w + col_w * len(courts_subset), y_top - run_row_h)

        def draw_break_row(courts_subset: list[Any], br: Any, x0: float, y_top: float, col_w: float):
            w = run_col_w + col_w * len(courts_subset)
            c.setFillColor(colors.HexColor("#DBEAFE"))
            c.rect(x0, y_top - break_row_h, w, break_row_h, fill=1, stroke=0)
            c.setFillColor(colors.HexColor("#1E3A8A"))
            c.setFont(font_name, 10)
            t = br.time.strftime("%H:%M") if br.time else ""
            c.drawString(x0 + 6, y_top - 17, f"{t} — {br.text}"[:80])
            c.setStrokeColor(colors.HexColor("#93C5FD"))
            c.line(x0, y_top - break_row_h, x0 + w, y_top - break_row_h)

        # Рендер страниц
        for courts_subset in court_chunks:
            # ширина под корты
            usable_w = page_w - 2 * margin_x
            col_w = max(60.0, (usable_w - run_col_w) / max(1, len(courts_subset)))

            # сколько строк помещается по высоте
            # (грубая оценка: шапка колонок + строки запусков + строки пауз)
            y = table_top_y
            draw_page_header()
            draw_table_header(courts_subset, margin_x, y, col_w)
            y -= col_header_h

            # Печатаем с разбиением по высоте
            # В position 0 допускаем паузу "перед первым запуском"
            run_index_to_obj = {r.index: r for r in runs}

            current_run_idx = 1
            while current_run_idx <= len(runs):
                # Паузы перед запуском current_run_idx
                for br in breaks_by_pos.get(current_run_idx - 1, []):
                    if y - break_row_h < table_bottom_y:
                        c.showPage()
                        draw_page_header()
                        y = table_top_y
                        draw_table_header(courts_subset, margin_x, y, col_w)
                        y -= col_header_h
                    draw_break_row(courts_subset, br, margin_x, y, col_w)
                    y -= break_row_h

                run_obj = run_index_to_obj.get(current_run_idx)
                if run_obj is None:
                    current_run_idx += 1
                    continue

                if y - run_row_h < table_bottom_y:
                    c.showPage()
                    draw_page_header()
                    y = table_top_y
                    draw_table_header(courts_subset, margin_x, y, col_w)
                    y -= col_header_h

                draw_run_row(courts_subset, run_obj, margin_x, y, col_w)
                y -= run_row_h
                current_run_idx += 1

            # Паузы после последнего запуска — position == len(runs)
            for br in breaks_by_pos.get(len(runs), []):
                if y - break_row_h < table_bottom_y:
                    c.showPage()
                    draw_page_header()
                    y = table_top_y
                    draw_table_header(courts_subset, margin_x, y, col_w)
                    y -= col_header_h
                draw_break_row(courts_subset, br, margin_x, y, col_w)
                y -= break_row_h

            c.showPage()

        c.save()
        pdf = buf.getvalue()
        buf.close()

        from django.http import HttpResponse

        resp = HttpResponse(pdf, content_type="application/pdf")
        resp["Content-Disposition"] = f'attachment; filename="schedule_{schedule.id}.pdf"'
        return resp

    @action(detail=True, methods=["get"], url_path="planned_times", permission_classes=[AllowAny])
    def planned_times(self, request, pk=None):
        schedule: Schedule = self.get_object()
        self._ensure_can_view_schedule(request, schedule)

        duration = int(getattr(schedule, "match_duration_minutes", 40) or 40)
        runs = list(schedule.runs.all().order_by("index"))
        if not runs:
            return Response({"ok": True, "runs": []})

        def base_start_time() -> time:
            court = schedule.courts.order_by("index").first()
            if court and court.first_start_time:
                return court.first_start_time
            first = runs[0]
            if first.start_time:
                return first.start_time
            return time(10, 0)

        t0 = base_start_time()
        current_dt = datetime.combine(schedule.date, t0)

        items = []
        for r in runs:
            if r.start_mode == "fixed" and r.start_time:
                current_dt = datetime.combine(schedule.date, r.start_time)
            elif r.start_mode == "not_earlier" and r.not_earlier_time:
                candidate = datetime.combine(schedule.date, r.not_earlier_time)
                if candidate > current_dt:
                    current_dt = candidate
            # then: используем текущее current_dt

            items.append(
                {
                    "index": r.index,
                    "planned_start_time": current_dt.time().strftime("%H:%M"),
                }
            )

            current_dt = current_dt + timedelta(minutes=duration)

        return Response({"ok": True, "runs": items, "match_duration_minutes": duration})

    @action(detail=True, methods=["get"], url_path="conflicts", permission_classes=[AllowAny])
    def conflicts(self, request, pk=None):
        schedule: Schedule = self.get_object()
        self._ensure_can_view_schedule(request, schedule)

        slots = (
            schedule.slots.exclude(match_id__isnull=True)
            .select_related("run", "court", "match", "match__team_1", "match__team_2")
            .order_by("run__index", "court__index")
        )

        by_run: dict[int, list[Any]] = {}
        for s in slots:
            by_run.setdefault(int(s.run.index), []).append(s)

        result_runs = []
        for run_index, run_slots in by_run.items():
            players_map: dict[int, list[dict[str, Any]]] = {}
            for s in run_slots:
                m = s.match
                if not m:
                    continue

                player_ids = []
                t1 = getattr(m, "team_1", None)
                t2 = getattr(m, "team_2", None)
                if t1:
                    if getattr(t1, "player_1_id", None):
                        player_ids.append(int(t1.player_1_id))
                    if getattr(t1, "player_2_id", None):
                        player_ids.append(int(t1.player_2_id))
                if t2:
                    if getattr(t2, "player_1_id", None):
                        player_ids.append(int(t2.player_1_id))
                    if getattr(t2, "player_2_id", None):
                        player_ids.append(int(t2.player_2_id))

                for pid in [p for p in player_ids if p]:
                    players_map.setdefault(pid, []).append(
                        {
                            "court_index": int(s.court.index),
                            "match_id": int(m.id),
                            "slot_id": int(s.id),
                        }
                    )

            conflicts_players = []
            for pid, occ in players_map.items():
                if len(occ) > 1:
                    conflicts_players.append({"player_id": pid, "occurrences": occ})

            if conflicts_players:
                result_runs.append({"run_index": run_index, "players": conflicts_players})

        return Response({"ok": True, "runs": result_runs})

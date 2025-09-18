from __future__ import annotations

from django.db.models import Q
from django.http import JsonResponse, HttpRequest, HttpResponseBadRequest
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST
from django.views.generic import TemplateView, DetailView

from apps.tournaments.models import Tournament, SetFormat, Ruleset
from apps.tournaments.services.round_robin import _round_robin_pairings


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

    if not all([name, date, participant_mode, system, set_format_id, ruleset_id]):
        return HttpResponseBadRequest("missing fields")

    # Валидация ограничения для круговой
    if system == Tournament.System.ROUND_ROBIN and planned_participants and groups_count:
        if planned_participants <= groups_count * 2:
            return JsonResponse(
                {
                    "ok": False,
                    "error": "Слишком мало участников для такого количества групп. Уменьшите количество групп или увеличьте количество участников или выберите другую систему проведения",
                },
                status=400,
            )

    t = Tournament.objects.create(
        name=name,
        date=date,
        participant_mode=participant_mode,
        system=system,
        groups_count=groups_count,
        set_format_id=set_format_id,
        ruleset_id=ruleset_id,
        planned_participants=(planned_participants or None),
    )

    # Ответ для fetch и для обычной формы
    if request.headers.get("x-requested-with") == "XMLHttpRequest" or request.content_type == "application/json":
        return JsonResponse({"ok": True, "id": t.id, "redirect": f"/tournaments/{t.id}/"})
    return redirect("tournament_detail", pk=t.id)


class TournamentDetailView(DetailView):
    model = Tournament
    template_name = "tournaments/detail.html"

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

        ctx.update({
            "planned": planned,
            "groups_ctx": groups_ctx,
        })
        return ctx


@require_POST
def complete_tournament(request: HttpRequest, pk: int):
    t = get_object_or_404(Tournament, pk=pk)
    # TODO: проверить, что все матчи сыграны; пока пропускаем проверку
    # TODO: обсчёт рейтинга
    t.status = Tournament.Status.COMPLETED
    t.save(update_fields=["status"])
    return redirect("tournament_detail", pk=t.id)


@require_POST
def delete_tournament(request: HttpRequest, pk: int):
    t = get_object_or_404(Tournament, pk=pk)
    # Каскадное удаление произойдёт по FK связям (Match, TournamentEntry, пр.)
    t.delete()
    return redirect("tournaments")

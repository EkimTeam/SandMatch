from __future__ import annotations

from django.views.generic import TemplateView

from apps.players.models import Player


class PlayersListView(TemplateView):
    template_name = "players/list.html"

    def get_context_data(self, **kwargs):
        ctx = super().get_context_data(**kwargs)
        players = Player.objects.order_by("last_name", "first_name")
        ctx.update({"players": players})
        return ctx


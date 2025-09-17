from django.db import models
from django.db.models import Q, F

class Team(models.Model):
    player_1 = models.ForeignKey(
        "players.Player", on_delete=models.CASCADE, related_name="teams_as_p1"
    )
    player_2 = models.ForeignKey(
        "players.Player", on_delete=models.CASCADE, related_name="teams_as_p2", blank=True, null=True
    )  # singles: NULL

    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            # запрет одинакового игрока в паре
            models.CheckConstraint(check=~Q(player_1=F("player_2")), name="team_no_same_players"),
            # уникальная команда по паре игроков (для пар)
            models.UniqueConstraint(
                fields=["player_1", "player_2"], name="unique_team_pair", condition=Q(player_2__isnull=False)
            ),
            # уникальная команда-одиночка (один игрок не может иметь дубликаты single-команд)
            models.UniqueConstraint(
                fields=["player_1"], name="unique_single_player_team", condition=Q(player_2__isnull=True)
            ),
        ]
        verbose_name = "Команда"
        verbose_name_plural = "Команды"

    def is_singles(self) -> bool:
        return self.player_2_id is None

    def __str__(self) -> str:
        if self.is_singles():
            return f"{self.player_1}"
        return f"{self.player_1} / {self.player_2}"

from django.db import models

class Match(models.Model):
    tournament = models.ForeignKey(
        "tournaments.Tournament", on_delete=models.CASCADE, related_name="matches"
    )
    team_1 = models.ForeignKey(
        "teams.Team", on_delete=models.PROTECT, related_name="matches_as_team1"
    )
    team_2 = models.ForeignKey(
        "teams.Team", on_delete=models.PROTECT, related_name="matches_as_team2"
    )
    winner = models.ForeignKey(
        "teams.Team", on_delete=models.SET_NULL, null=True, blank=True, related_name="wins"
    )
    round_name = models.CharField(max_length=50, blank=True, null=True)
    order_in_round = models.IntegerField(default=0)
    started_at = models.DateTimeField(blank=True, null=True)
    finished_at = models.DateTimeField(blank=True, null=True)

    class Meta:
        indexes = [
            models.Index(fields=["tournament", "round_name", "order_in_round"]),
        ]
        verbose_name = "Матч"
        verbose_name_plural = "Матчи"

    def __str__(self) -> str:
        return f"{self.tournament}: {self.team_1} vs {self.team_2}"


class MatchSet(models.Model):
    match = models.ForeignKey(Match, on_delete=models.CASCADE, related_name="sets")
    index = models.PositiveSmallIntegerField()  # 1, 2, 3
    games_1 = models.PositiveSmallIntegerField(default=0)
    games_2 = models.PositiveSmallIntegerField(default=0)
    tb_1 = models.PositiveSmallIntegerField(blank=True, null=True)
    tb_2 = models.PositiveSmallIntegerField(blank=True, null=True)
    is_tiebreak_only = models.BooleanField(
        default=False, help_text="Если True — это сет-тайбрейк (например, до 10)"
    )

    class Meta:
        unique_together = (("match", "index"),)
        ordering = ["match", "index"]
        verbose_name = "Сет матча"
        verbose_name_plural = "Сеты матча"

    def __str__(self) -> str:
        if self.is_tiebreak_only:
            if self.tb_1 is not None and self.tb_2 is not None:
                return f"TB({self.tb_1}:{self.tb_2})"
            return "TB"
        s = f"{self.games_1}:{self.games_2}"
        if (self.tb_1 is not None) and (self.tb_2 is not None):
            s += f"({self.tb_1}:{self.tb_2})"
        return s

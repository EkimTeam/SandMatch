from django.db import models

class Player(models.Model):
    last_name = models.CharField("Фамилия", max_length=100)
    first_name = models.CharField("Имя", max_length=100)
    patronymic = models.CharField("Отчество", max_length=100, blank=True, null=True)
    current_rating = models.IntegerField("Текущий рейтинг", default=0)
    level = models.CharField("Уровень игрока", max_length=50, blank=True, null=True)
    birth_date = models.DateField("Дата рождения", blank=True, null=True)
    phone = models.CharField("Телефон", max_length=20, blank=True, null=True)
    display_name = models.CharField("Отображаемое имя", max_length=150, blank=True)
    city = models.CharField("Город", max_length=100, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        indexes = [
            models.Index(fields=["last_name", "first_name"]),
            models.Index(fields=["display_name"]),
        ]
        ordering = ["last_name", "first_name"]
        verbose_name = "Игрок"
        verbose_name_plural = "Игроки"

    def __str__(self) -> str:
        fio = f"{self.last_name} {self.first_name}"
        if self.patronymic:
            fio += f" {self.patronymic}"
        return fio

    def save(self, *args, **kwargs):
        # Если отображаемое имя не задано, используем имя игрока (first_name)
        if not self.display_name:
            self.display_name = self.first_name or ""
        super().save(*args, **kwargs)


class SocialLink(models.Model):
    class Kind(models.TextChoices):
        TELEGRAM = "tg", "Telegram"
        INSTAGRAM = "ig", "Instagram"
        VK = "vk", "VK"
        OTHER = "other", "Другое"

    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="social_links")
    kind = models.CharField(max_length=16, choices=Kind.choices, default=Kind.TELEGRAM)
    handle_or_url = models.CharField(max_length=255)

    class Meta:
        verbose_name = "Соцссылка"
        verbose_name_plural = "Соцссылки"

    def __str__(self) -> str:
        return f"{self.player}: {self.get_kind_display()} - {self.handle_or_url}"


class PlayerRatingHistory(models.Model):
    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="rating_history")
    value = models.IntegerField("Рейтинг")
    reason = models.CharField("Причина", max_length=255, blank=True, null=True)
    tournament = models.ForeignKey(
        "tournaments.Tournament", on_delete=models.SET_NULL, blank=True, null=True
    )
    match = models.ForeignKey("matches.Match", on_delete=models.SET_NULL, blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["player", "-created_at"]),
        ]
        verbose_name = "История рейтинга игрока"
        verbose_name_plural = "Истории рейтинга игроков"

    def __str__(self) -> str:
        return f"{self.player} → {self.value} ({self.created_at:%Y-%m-%d})"


class PlayerRatingDynamic(models.Model):
    """Динамика рейтинга игрока по турнирам (агрегация per tournament).

    Поля:
    - player: игрок
    - tournament: турнир (может быть null для служебных записей)
    - tournament_date: дата проведения турнира (для ускорения графиков)
    - rating_before: рейтинг до турнира
    - rating_after: рейтинг после турнира
    - total_change: изменение за турнир
    - matches_count: количество матчей, учтённых в расчёте
    - meta: произвольные метаданные (JSON), например типы турниров/примечания
    """

    player = models.ForeignKey(Player, on_delete=models.CASCADE, related_name="rating_dynamic")
    tournament = models.ForeignKey(
        "tournaments.Tournament", on_delete=models.SET_NULL, blank=True, null=True, related_name="rating_dynamic"
    )
    tournament_date = models.DateField(blank=True, null=True)

    rating_before = models.FloatField()
    rating_after = models.FloatField()
    total_change = models.FloatField()
    matches_count = models.PositiveIntegerField(default=0)

    meta = models.JSONField(blank=True, null=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        verbose_name = "Динамика рейтинга игрока (по турнирам)"
        verbose_name_plural = "Динамика рейтингов игроков (по турнирам)"
        ordering = ["player", "tournament_date", "id"]
        constraints = [
            models.UniqueConstraint(fields=["player", "tournament"], name="uniq_player_tournament_dynamic"),
        ]
        indexes = [
            models.Index(fields=["player", "tournament_date"]),
            models.Index(fields=["tournament_date"]),
        ]

    def __str__(self) -> str:
        return f"{self.player} Δ{self.total_change:+.1f} ({self.tournament_date})"

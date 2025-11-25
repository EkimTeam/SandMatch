from django.db import models


class BtrPlayer(models.Model):
    """Игрок в системе BTR (BeachTennisRussia).

    Связь с основным игроком осуществляется через поле Player.btr_player.
    """

    external_id = models.IntegerField("ID в BTR", unique=True)
    rni = models.IntegerField("РНИ (номер в BTR)", unique=True)
    last_name = models.CharField("Фамилия", max_length=100)
    first_name = models.CharField("Имя", max_length=100, blank=True)
    middle_name = models.CharField("Отчество/второе имя", max_length=100, blank=True)
    gender = models.CharField(
        "Пол",
        max_length=16,
        choices=(
            ("male", "Мужчина"),
            ("female", "Женщина"),
        ),
        blank=True,
        null=True,
    )
    birth_date = models.DateField("Дата рождения", blank=True, null=True)
    city = models.CharField("Город", max_length=100, blank=True)
    country = models.CharField("Страна", max_length=64, blank=True)

    class Meta:
        verbose_name = "Игрок BTR"
        verbose_name_plural = "Игроки BTR"

    def __str__(self) -> str:
        return f"{self.last_name} {self.first_name}".strip()


class BtrSourceFile(models.Model):
    """Описание исходного файла рейтинга BTR (архивная выгрузка)."""

    url = models.URLField("URL источника")
    filename = models.CharField("Имя файла", max_length=255)
    downloaded_at = models.DateTimeField("Время скачивания", auto_now_add=True)
    applied_at = models.DateTimeField("Время применения", blank=True, null=True)
    file_hash = models.CharField("Хэш содержимого", max_length=128, blank=True)

    class Meta:
        verbose_name = "Файл рейтинга BTR"
        verbose_name_plural = "Файлы рейтинга BTR"

    def __str__(self) -> str:
        return self.filename


class BtrRatingSnapshot(models.Model):
    """Снимок рейтинга BTR для игрока в конкретной категории и на дату."""

    class Category(models.TextChoices):
        MEN_DOUBLE = "men_double", "Взрослые, парный, мужчины"
        MEN_MIXED = "men_mixed", "Взрослые, смешанный, мужчины"
        WOMEN_DOUBLE = "women_double", "Взрослые, парный, женщины"
        WOMEN_MIXED = "women_mixed", "Взрослые, смешанный, женщины"
        JUNIOR_MALE = "junior_male", "До 19, Юноши"
        JUNIOR_FEMALE = "junior_female", "До 19, Девушки"

    player = models.ForeignKey(BtrPlayer, on_delete=models.CASCADE, related_name="snapshots")
    category = models.CharField("Категория", max_length=32, choices=Category.choices)
    rating_date = models.DateField("Дата рейтинга")
    rating_value = models.IntegerField("Значение рейтинга")
    rank = models.IntegerField("Позиция в рейтинге", blank=True, null=True)
    tournaments_total = models.IntegerField("Турниров всего", default=0)
    tournaments_52_weeks = models.IntegerField("Турниров за 52 недели", default=0)
    tournaments_counted = models.IntegerField("Учтённых турниров", default=0)

    class Meta:
        verbose_name = "Снимок рейтинга BTR"
        verbose_name_plural = "Снимки рейтинга BTR"
        indexes = [
            models.Index(fields=["player", "category", "rating_date"]),
        ]

    def __str__(self) -> str:
        return f"{self.player} [{self.category}] {self.rating_date}: {self.rating_value}"

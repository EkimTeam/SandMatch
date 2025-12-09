from django.db import models


class Venue(models.Model):
    """Площадка для проведения турниров"""
    name = models.CharField("Название", max_length=200)
    address = models.CharField("Адрес", max_length=500)
    
    # GIS координаты
    latitude = models.DecimalField(
        "Широта",
        max_digits=9,
        decimal_places=6,
        null=True,
        blank=True
    )
    longitude = models.DecimalField(
        "Долгота",
        max_digits=9,
        decimal_places=6,
        null=True,
        blank=True
    )
    
    # Контакты
    phone = models.CharField("Телефон", max_length=100, blank=True)
    email = models.EmailField("Email", blank=True)
    website = models.URLField("Сайт", blank=True)
    
    # Описание
    description = models.TextField("Описание", blank=True)
    facilities = models.TextField("Удобства", blank=True, help_text="Раздевалки, душ, парковка и т.д.")
    
    # Фото
    photo = models.ImageField(
        "Фото",
        upload_to='venues/',
        null=True,
        blank=True
    )
    
    # Метаданные
    city = models.CharField("Город", max_length=100, db_index=True)
    is_active = models.BooleanField("Активна", default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        verbose_name = "Площадка"
        verbose_name_plural = "Площадки"
        ordering = ['city', 'name']
        indexes = [
            models.Index(fields=['city', 'is_active']),
        ]
    
    def __str__(self):
        return f"{self.name} ({self.city})"

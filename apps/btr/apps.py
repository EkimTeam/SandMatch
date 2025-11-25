from django.apps import AppConfig


class BtrConfig(AppConfig):
    """Конфигурация приложения BTR (BeachTennisRussia)."""
    
    default_auto_field = 'django.db.models.BigAutoField'
    name = 'apps.btr'
    verbose_name = 'BTR Рейтинги'

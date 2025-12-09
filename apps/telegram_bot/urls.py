"""
URL конфигурация для Telegram Bot API
"""
from django.urls import path
from . import api_views

app_name = 'telegram_bot'

urlpatterns = [
    path('generate-code/', api_views.generate_link_code, name='generate_code'),
    path('status/', api_views.telegram_status, name='status'),
    path('unlink/', api_views.unlink_telegram, name='unlink'),
]

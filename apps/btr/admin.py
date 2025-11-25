from django.contrib import admin
from .models import BtrPlayer, BtrRatingSnapshot, BtrSourceFile


@admin.register(BtrPlayer)
class BtrPlayerAdmin(admin.ModelAdmin):
    """Админка для игроков BTR."""
    
    list_display = ['rni', 'last_name', 'first_name', 'gender', 'city', 'birth_date']
    list_filter = ['gender', 'city']
    search_fields = ['rni', 'last_name', 'first_name', 'external_id']
    ordering = ['last_name', 'first_name']


@admin.register(BtrRatingSnapshot)
class BtrRatingSnapshotAdmin(admin.ModelAdmin):
    """Админка для снимков рейтинга BTR."""
    
    list_display = ['player', 'category', 'rating_date', 'rating_value', 'rank']
    list_filter = ['category', 'rating_date']
    search_fields = ['player__last_name', 'player__first_name', 'player__rni']
    ordering = ['-rating_date', 'category', 'rank']
    date_hierarchy = 'rating_date'


@admin.register(BtrSourceFile)
class BtrSourceFileAdmin(admin.ModelAdmin):
    """Админка для файлов-источников BTR."""
    
    list_display = ['filename', 'category', 'downloaded_at', 'applied_at', 'status']
    list_filter = ['category', 'status', 'downloaded_at']
    search_fields = ['filename', 'url']
    ordering = ['-downloaded_at']
    readonly_fields = ['downloaded_at', 'applied_at', 'file_hash']

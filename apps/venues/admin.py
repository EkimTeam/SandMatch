from django.contrib import admin
from .models import Venue


@admin.register(Venue)
class VenueAdmin(admin.ModelAdmin):
    list_display = ('name', 'city', 'address', 'is_active', 'created_at')
    list_filter = ('city', 'is_active', 'created_at')
    search_fields = ('name', 'city', 'address')
    readonly_fields = ('created_at', 'updated_at')
    
    fieldsets = (
        ('Основная информация', {
            'fields': ('name', 'city', 'address', 'is_active')
        }),
        ('Координаты', {
            'fields': ('latitude', 'longitude'),
            'classes': ('collapse',)
        }),
        ('Контакты', {
            'fields': ('phone', 'email', 'website')
        }),
        ('Описание', {
            'fields': ('description', 'facilities', 'photo')
        }),
        ('Метаданные', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )

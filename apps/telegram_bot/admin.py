from django.contrib import admin
from .models import TelegramUser, TournamentSubscription, PairRequest, NotificationLog, LinkCode


@admin.register(TelegramUser)
class TelegramUserAdmin(admin.ModelAdmin):
    list_display = ('telegram_id', 'username', 'first_name', 'user', 'player', 'notifications_enabled', 'created_at')
    list_filter = ('notifications_enabled', 'is_blocked', 'created_at')
    search_fields = ('telegram_id', 'username', 'first_name', 'last_name')
    readonly_fields = ('created_at', 'updated_at', 'last_interaction')
    
    fieldsets = (
        ('Telegram', {
            'fields': ('telegram_id', 'username', 'first_name', 'last_name', 'language_code')
        }),
        ('Связи', {
            'fields': ('user', 'player')
        }),
        ('Уведомления', {
            'fields': (
                'notifications_enabled',
                'notify_tournament_open',
                'notify_tournament_start',
                'notify_match_start',
                'notify_match_result',
                'notify_rating_change',
                'notify_pair_request',
            )
        }),
        ('Метаданные', {
            'fields': ('is_blocked', 'created_at', 'updated_at', 'last_interaction'),
            'classes': ('collapse',)
        }),
    )


@admin.register(TournamentSubscription)
class TournamentSubscriptionAdmin(admin.ModelAdmin):
    list_display = ('telegram_user', 'organizer', 'venue', 'created_at')
    list_filter = ('created_at',)
    search_fields = ('telegram_user__username', 'organizer__username', 'venue__name')
    readonly_fields = ('created_at',)


@admin.register(PairRequest)
class PairRequestAdmin(admin.ModelAdmin):
    list_display = ('tournament', 'from_user', 'to_user', 'status', 'created_at')
    list_filter = ('status', 'created_at')
    search_fields = ('tournament__name', 'from_user__username', 'to_user__username')
    readonly_fields = ('created_at', 'updated_at')
    
    fieldsets = (
        ('Основная информация', {
            'fields': ('tournament', 'from_user', 'to_user', 'status')
        }),
        ('Детали', {
            'fields': ('message',)
        }),
        ('Метаданные', {
            'fields': ('created_at', 'updated_at'),
            'classes': ('collapse',)
        }),
    )


@admin.register(NotificationLog)
class NotificationLogAdmin(admin.ModelAdmin):
    list_display = ('telegram_user', 'notification_type', 'tournament', 'success', 'sent_at')
    list_filter = ('notification_type', 'success', 'sent_at')
    search_fields = ('telegram_user__username', 'tournament__name', 'notification_type')
    readonly_fields = ('sent_at',)
    
    def has_add_permission(self, request):
        # Логи создаются автоматически, не даём добавлять вручную
        return False


@admin.register(LinkCode)
class LinkCodeAdmin(admin.ModelAdmin):
    list_display = ('code', 'user', 'is_used', 'created_at', 'expires_at')
    list_filter = ('is_used', 'created_at')
    search_fields = ('code', 'user__username', 'user__email')
    readonly_fields = ('created_at', 'used_at')
    
    fieldsets = (
        ('Основная информация', {
            'fields': ('code', 'user', 'is_used')
        }),
        ('Временные метки', {
            'fields': ('created_at', 'expires_at', 'used_at')
        }),
    )
    
    def has_add_permission(self, request):
        # Коды генерируются через API, не даём добавлять вручную
        return False

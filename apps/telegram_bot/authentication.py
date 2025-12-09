"""
Аутентификация для Telegram Mini App
"""
import hmac
import hashlib
import json
from urllib.parse import parse_qsl
from datetime import datetime, timedelta

from django.conf import settings
from rest_framework import authentication, exceptions


class TelegramWebAppAuthentication(authentication.BaseAuthentication):
    """
    Аутентификация через Telegram Web App initData
    
    Документация: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
    """
    
    def authenticate(self, request):
        """
        Проверка подлинности данных от Telegram Web App
        """
        # Получаем initData из заголовка или query параметра
        init_data = request.META.get('HTTP_X_TELEGRAM_INIT_DATA') or request.GET.get('initData')
        
        if not init_data:
            return None
        
        # Валидируем данные
        is_valid, user_data = self.validate_init_data(init_data)
        
        if not is_valid:
            raise exceptions.AuthenticationFailed('Invalid Telegram Web App data')
        
        # Получаем или создаём пользователя
        from apps.telegram_bot.models import TelegramUser
        
        telegram_id = user_data.get('id')
        if not telegram_id:
            raise exceptions.AuthenticationFailed('Telegram ID not found')
        
        try:
            telegram_user = TelegramUser.objects.select_related('user', 'player').get(
                telegram_id=telegram_id
            )
        except TelegramUser.DoesNotExist:
            raise exceptions.AuthenticationFailed('Telegram user not linked')
        
        # Возвращаем пользователя Django (если связан)
        if telegram_user.user:
            return (telegram_user.user, telegram_user)
        
        # Если не связан, возвращаем None как user, но передаём telegram_user
        return (None, telegram_user)
    
    def validate_init_data(self, init_data: str) -> tuple[bool, dict]:
        """
        Валидация initData от Telegram
        
        Args:
            init_data: строка с данными от Telegram Web App
            
        Returns:
            (is_valid, user_data)
        """
        try:
            # Парсим данные
            parsed_data = dict(parse_qsl(init_data))
            
            # Извлекаем hash
            received_hash = parsed_data.pop('hash', None)
            if not received_hash:
                return False, {}
            
            # Проверяем auth_date (данные не старше 24 часов)
            auth_date = parsed_data.get('auth_date')
            if auth_date:
                auth_timestamp = int(auth_date)
                now_timestamp = int(datetime.now().timestamp())
                
                # Данные не должны быть старше 24 часов
                if now_timestamp - auth_timestamp > 86400:
                    return False, {}
            
            # Создаём data-check-string
            data_check_arr = [f"{k}={v}" for k, v in sorted(parsed_data.items())]
            data_check_string = '\n'.join(data_check_arr)
            
            # Получаем секретный ключ
            bot_token = settings.TELEGRAM_BOT_TOKEN
            if not bot_token:
                return False, {}
            
            secret_key = hmac.new(
                key=b"WebAppData",
                msg=bot_token.encode(),
                digestmod=hashlib.sha256
            ).digest()
            
            # Вычисляем hash
            calculated_hash = hmac.new(
                key=secret_key,
                msg=data_check_string.encode(),
                digestmod=hashlib.sha256
            ).hexdigest()
            
            # Сравниваем hash
            if calculated_hash != received_hash:
                return False, {}
            
            # Парсим user данные
            user_json = parsed_data.get('user')
            if user_json:
                user_data = json.loads(user_json)
            else:
                user_data = {}
            
            return True, user_data
            
        except Exception as e:
            return False, {}

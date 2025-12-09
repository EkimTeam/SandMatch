"""
API views для Telegram Bot
"""
from rest_framework import status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from .models import LinkCode, TelegramUser
from .serializers import LinkCodeSerializer, TelegramUserSerializer


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def generate_link_code(request):
    """
    Генерация кода для связывания Telegram аккаунта
    
    POST /api/telegram/generate-code/
    """
    user = request.user
    
    # Проверяем, не связан ли уже аккаунт
    try:
        telegram_user = TelegramUser.objects.get(user=user)
        return Response({
            'error': 'Аккаунт уже связан с Telegram',
            'telegram_user': TelegramUserSerializer(telegram_user).data
        }, status=status.HTTP_400_BAD_REQUEST)
    except TelegramUser.DoesNotExist:
        pass
    
    # Деактивируем старые неиспользованные коды этого пользователя
    LinkCode.objects.filter(user=user, is_used=False).update(is_used=True)
    
    # Генерируем новый код
    link_code = LinkCode.generate_code(user, expires_in_minutes=15)
    
    return Response({
        'code': link_code.code,
        'expires_at': link_code.expires_at,
        'instructions': (
            f'Отправь боту команду: /link {link_code.code}\n'
            f'Код действителен 15 минут.'
        )
    }, status=status.HTTP_201_CREATED)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def telegram_status(request):
    """
    Проверка статуса связывания с Telegram
    
    GET /api/telegram/status/
    """
    user = request.user
    
    try:
        telegram_user = TelegramUser.objects.get(user=user)
        return Response({
            'is_linked': True,
            'telegram_user': TelegramUserSerializer(telegram_user).data
        })
    except TelegramUser.DoesNotExist:
        # Проверяем, есть ли активный код
        active_code = LinkCode.objects.filter(
            user=user,
            is_used=False
        ).order_by('-created_at').first()
        
        if active_code and active_code.is_valid():
            return Response({
                'is_linked': False,
                'pending_code': LinkCodeSerializer(active_code).data
            })
        
        return Response({
            'is_linked': False,
            'pending_code': None
        })


@api_view(['POST'])
@permission_classes([IsAuthenticated])
def unlink_telegram(request):
    """
    Отвязка Telegram аккаунта
    
    POST /api/telegram/unlink/
    """
    user = request.user
    
    try:
        telegram_user = TelegramUser.objects.get(user=user)
        telegram_user.user = None
        telegram_user.player = None
        telegram_user.save()
        
        return Response({
            'message': 'Telegram аккаунт успешно отвязан'
        })
    except TelegramUser.DoesNotExist:
        return Response({
            'error': 'Telegram аккаунт не был связан'
        }, status=status.HTTP_400_BAD_REQUEST)

"""
Template tags для загрузки Vite-ассетов с поддержкой manifest.json
"""
import json
import logging
from pathlib import Path
from django import template
from django.conf import settings
from django.templatetags.static import static

register = template.Library()
logger = logging.getLogger(__name__)


def _load_vite_manifest():
    """
    Загружает manifest.json из staticfiles/frontend/.
    Возвращает dict с маппингом entry points на хешированные файлы.
    """
    # В продакшене manifest.json находится в STATIC_ROOT/frontend/
    manifest_path = Path(settings.STATIC_ROOT) / "frontend" / "manifest.json"
    
    if not manifest_path.exists():
        # Fallback для dev окружения или если manifest не найден
        logger.warning(f"Vite manifest.json не найден по пути: {manifest_path}")
        return {}
    
    try:
        with open(manifest_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Ошибка при чтении Vite manifest.json: {e}")
        return {}


@register.simple_tag
def vite_asset(entry_point):
    """
    Возвращает URL для конкретного entry point из Vite manifest.
    
    Использование в шаблоне:
        {% load vite_assets %}
        <script type="module" src="{% vite_asset 'src/main.tsx' %}"></script>
    """
    if settings.DEBUG:
        # В dev режиме используем Vite dev server
        return f"http://localhost:3000/{entry_point}"
    
    manifest = _load_vite_manifest()
    
    if entry_point in manifest:
        file_path = manifest[entry_point].get('file')
        if file_path:
            # Добавляем префикс /static/frontend/ для продакшена
            return f"/static/frontend/{file_path}"
    
    # Fallback если файл не найден в manifest
    logger.warning(f"Entry point '{entry_point}' не найден в Vite manifest")
    return ""


@register.inclusion_tag('vite_assets_tags.html', takes_context=True)
def vite_hmr_client(context):
    """
    Включает Vite HMR client в dev режиме.
    
    Использование в шаблоне:
        {% load vite_assets %}
        {% vite_hmr_client %}
    """
    return {
        'debug': settings.DEBUG,
    }


@register.simple_tag
def vite_css_assets(entry_point='src/main.tsx'):
    """
    Возвращает список CSS файлов для entry point.
    
    Использование в шаблоне:
        {% load vite_assets %}
        {% for css_url in vite_css_assets %}
            <link rel="stylesheet" href="{{ css_url }}">
        {% endfor %}
    """
    if settings.DEBUG:
        # В dev режиме Vite инжектирует CSS автоматически
        return []
    
    manifest = _load_vite_manifest()
    css_files = []
    
    if entry_point in manifest:
        entry = manifest[entry_point]
        # CSS файлы могут быть в поле 'css'
        if 'css' in entry:
            for css_file in entry['css']:
                # Добавляем префикс /static/frontend/ для продакшена
                css_files.append(f"/static/frontend/{css_file}")
    
    return css_files

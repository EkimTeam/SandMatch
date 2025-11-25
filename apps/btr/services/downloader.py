"""
Сервис для скачивания BTR-файлов с официального сайта.
"""
import logging
import re
from datetime import datetime
from pathlib import Path
from typing import List, Tuple
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)


BTR_ARCHIVE_URL = "https://btrussia.com/ru/cl/arkhiv"


def fetch_available_files(url: str = BTR_ARCHIVE_URL) -> List[Tuple[str, str, datetime]]:
    """
    Получает список доступных файлов рейтингов с сайта BTR.
    
    Args:
        url: URL страницы с архивом
        
    Returns:
        Список кортежей (url_файла, имя_файла, дата_рейтинга)
    """
    logger.info(f"Получение списка файлов с {url}")
    
    try:
        response = requests.get(url, timeout=30)
        response.raise_for_status()
    except requests.RequestException as e:
        logger.error(f"Ошибка при получении страницы {url}: {e}")
        raise
    
    soup = BeautifulSoup(response.content, "html.parser")
    files = []
    
    # Ищем все ссылки на файлы
    for link in soup.find_all("a", href=True):
        href = link["href"]
        
        # Ищем ссылки на Excel-файлы
        if any(ext in href.lower() for ext in [".xlsx", ".xls"]):
            file_url = urljoin(url, href)
            
            # Извлекаем имя файла из URL
            filename = href.split("/")[-1]
            
            # Пытаемся извлечь дату из имени файла или текста ссылки
            link_text = link.get_text(strip=True)
            rating_date = _extract_date_from_text(filename) or _extract_date_from_text(link_text)
            
            if rating_date:
                files.append((file_url, filename, rating_date))
                logger.debug(f"Найден файл: {filename} (дата: {rating_date.strftime('%Y-%m-%d')})")
    
    logger.info(f"Найдено {len(files)} файлов рейтингов")
    return files


def _extract_date_from_text(text: str) -> datetime | None:
    """
    Извлекает дату из текста.
    Поддерживает форматы: DD.MM.YYYY, YYYY-MM-DD, DD/MM/YYYY и т.д.
    """
    if not text:
        return None
    
    # Паттерны для поиска дат
    patterns = [
        r"(\d{2})\.(\d{2})\.(\d{4})",  # DD.MM.YYYY
        r"(\d{4})-(\d{2})-(\d{2})",     # YYYY-MM-DD
        r"(\d{2})/(\d{2})/(\d{4})",     # DD/MM/YYYY
        r"(\d{2})_(\d{2})_(\d{4})",     # DD_MM_YYYY
        r"(\d{4})(\d{2})(\d{2})",       # YYYYMMDD
    ]
    
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            groups = match.groups()
            try:
                if len(groups[0]) == 4:  # YYYY first
                    year, month, day = int(groups[0]), int(groups[1]), int(groups[2])
                else:  # DD first
                    day, month, year = int(groups[0]), int(groups[1]), int(groups[2])
                return datetime(year, month, day)
            except ValueError:
                continue
    
    return None


def download_file(file_url: str, destination: Path) -> bool:
    """
    Скачивает файл по URL и сохраняет в указанное место.
    
    Args:
        file_url: URL файла
        destination: Путь для сохранения файла
        
    Returns:
        True если файл успешно скачан, False иначе
    """
    logger.info(f"Скачивание файла: {file_url}")
    
    try:
        response = requests.get(file_url, timeout=60, stream=True)
        response.raise_for_status()
        
        # Создаём директорию, если её нет
        destination.parent.mkdir(parents=True, exist_ok=True)
        
        # Сохраняем файл
        with open(destination, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
        
        logger.info(f"Файл успешно скачан: {destination}")
        return True
        
    except requests.RequestException as e:
        logger.error(f"Ошибка при скачивании файла {file_url}: {e}")
        return False


def download_latest_files(
    output_dir: Path,
    limit: int | None = None,
    skip_existing: bool = True
) -> List[Path]:
    """
    Скачивает последние файлы рейтингов BTR.
    
    Args:
        output_dir: Директория для сохранения файлов
        limit: Максимальное количество файлов для скачивания (None = все)
        skip_existing: Пропускать уже существующие файлы
        
    Returns:
        Список путей к скачанным файлам
    """
    # Получаем список доступных файлов
    available_files = fetch_available_files()
    
    # Сортируем по дате (новые первые)
    available_files.sort(key=lambda x: x[2], reverse=True)
    
    if limit:
        available_files = available_files[:limit]
    
    downloaded_files = []
    
    for file_url, filename, rating_date in available_files:
        destination = output_dir / filename
        
        # Пропускаем уже существующие файлы
        if skip_existing and destination.exists():
            logger.info(f"Файл уже существует, пропускаем: {filename}")
            downloaded_files.append(destination)
            continue
        
        # Скачиваем файл
        if download_file(file_url, destination):
            downloaded_files.append(destination)
    
    logger.info(f"Скачано {len(downloaded_files)} файлов")
    return downloaded_files

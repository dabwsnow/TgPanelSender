"""
config.py — централизованная конфигурация приложения.
Все настройки берутся из .env файла или переменных окружения.
Добавляй новые параметры сюда — не хардкодь в других файлах.
"""
from pathlib import Path
from dotenv import load_dotenv
import os

load_dotenv()

# --- Пути ---
BASE_DIR = Path(__file__).parent
SESSIONS_DIR = BASE_DIR / "sessions"
UPLOADS_DIR = BASE_DIR / "uploads"
DB_PATH = BASE_DIR / "tgpanel.db"

# Создаём папки если нет
SESSIONS_DIR.mkdir(exist_ok=True)
UPLOADS_DIR.mkdir(exist_ok=True)

# --- Сервер ---
HOST = os.getenv("HOST", "0.0.0.0")
PORT = int(os.getenv("PORT", 8000))
DEBUG = os.getenv("DEBUG", "true").lower() == "true"
ADMIN_SECRET_PATH = os.getenv("ADMIN_SECRET_PATH", "/panel")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")

# --- Telegram ---
# Дефолтные API ключи (пользователь может задать свои для каждого аккаунта)
DEFAULT_API_ID = int(os.getenv("TG_API_ID", "0")) or None
DEFAULT_API_HASH = os.getenv("TG_API_HASH", "") or None

# --- Планировщик ---
# Как часто проверять аккаунты на спам-блок (в минутах)
SPAM_CHECK_INTERVAL_MINUTES = int(os.getenv("SPAM_CHECK_INTERVAL", "30"))

# --- Рассылка ---
# Глобальный дефолтный лимит сообщений в день на аккаунт
DEFAULT_DAILY_LIMIT = int(os.getenv("DEFAULT_DAILY_LIMIT", "50"))
DEFAULT_DELAY_MIN = int(os.getenv("DEFAULT_DELAY_MIN", "5"))   # секунды
DEFAULT_DELAY_MAX = int(os.getenv("DEFAULT_DELAY_MAX", "15"))  # секунды

# --- AI (Groq) ---
GROQ_API_KEY = os.getenv("GROKAI", "")
GROQ_MODEL   = os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile")

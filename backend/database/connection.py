"""
database/connection.py — управление подключением к SQLite.
Используй get_db() как FastAPI dependency для получения соединения в роутерах.
"""
import aiosqlite
from pathlib import Path
from config import DB_PATH

SCHEMA_PATH = Path(__file__).parent / "schema.sql"

# Глобальное соединение (переиспользуется между запросами)
_db: aiosqlite.Connection | None = None


async def _run_migrations(db: aiosqlite.Connection) -> None:
    """Идемпотентные ALTER TABLE миграции для обновлений схемы."""
    migrations = [
        # v2: parse_mode и media_url для шаблонов
        "ALTER TABLE templates ADD COLUMN parse_mode TEXT DEFAULT 'markdown'",
        "ALTER TABLE templates ADD COLUMN media_url  TEXT",
        # v3: AI-спинтекст вариации
        "ALTER TABLE templates ADD COLUMN variations TEXT DEFAULT '[]'",
        # v4: циклическая рассылка
        "ALTER TABLE campaigns ADD COLUMN is_looped INTEGER DEFAULT 0",
        "ALTER TABLE campaigns ADD COLUMN loop_delay INTEGER DEFAULT 60",
        # v5: прокси менеджер
        "CREATE TABLE IF NOT EXISTS proxies (id INTEGER PRIMARY KEY AUTOINCREMENT, host TEXT NOT NULL, port INTEGER NOT NULL, protocol TEXT NOT NULL, username TEXT, password TEXT, is_active INTEGER DEFAULT 1, status TEXT DEFAULT 'untested', error_message TEXT, last_check_at TEXT, created_at TEXT DEFAULT (datetime('now')))",
        "ALTER TABLE accounts ADD COLUMN proxy_id INTEGER REFERENCES proxies(id) ON DELETE SET NULL",
        # v6: папки чатов (addlist)
        "ALTER TABLE global_chats ADD COLUMN is_folder INTEGER DEFAULT 0",
        "ALTER TABLE global_chats ADD COLUMN folder_slug TEXT",
        "CREATE TABLE IF NOT EXISTS folders (slug TEXT PRIMARY KEY, link TEXT, title TEXT, chats_count INTEGER DEFAULT 0, fetched_at TEXT DEFAULT (datetime('now')))",
        "CREATE TABLE IF NOT EXISTS folder_chats (id INTEGER PRIMARY KEY AUTOINCREMENT, slug TEXT NOT NULL, chat_title TEXT, username TEXT, chat_type TEXT, is_private INTEGER DEFAULT 0)",
        "CREATE INDEX IF NOT EXISTS idx_folder_chats_slug ON folder_chats(slug)",
    ]
    for sql in migrations:
        try:
            await db.execute(sql)
        except Exception:
            pass  # колонка уже существует — ок
    await db.commit()


async def init_db() -> None:
    """Инициализация БД: создание файла и применение схемы."""
    global _db
    _db = await aiosqlite.connect(DB_PATH)
    _db.row_factory = aiosqlite.Row  # строки как словари
    await _db.execute("PRAGMA journal_mode=DELETE")
    await _db.execute("PRAGMA foreign_keys=ON")

    schema = SCHEMA_PATH.read_text(encoding="utf-8")
    await _db.executescript(schema)
    await _db.commit()

    await _run_migrations(_db)


async def close_db() -> None:
    """Закрытие соединения при остановке сервера."""
    global _db
    if _db:
        await _db.close()
        _db = None


async def get_db() -> aiosqlite.Connection:
    """FastAPI dependency — возвращает активное соединение с БД."""
    if _db is None:
        raise RuntimeError("Database not initialized. Call init_db() first.")
    return _db

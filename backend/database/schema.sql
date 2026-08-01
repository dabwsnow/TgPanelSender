-- schema.sql — схема базы данных TGPanel
-- Все таблицы создаются при первом запуске.

PRAGMA journal_mode=DELETE;
PRAGMA foreign_keys=ON;

-- ─────────────────────────────────────────
-- Аккаунты
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
    id                      INTEGER PRIMARY KEY AUTOINCREMENT,
    phone                   TEXT UNIQUE NOT NULL,
    api_id                  INTEGER NOT NULL,
    api_hash                TEXT NOT NULL,
    session_name            TEXT NOT NULL,          -- имя файла сессии (без .session)
    first_name              TEXT,
    last_name               TEXT,
    username                TEXT,
    bio                     TEXT,
    avatar_path             TEXT,                   -- путь к локальному фото

    -- Статус: inactive | connecting | active | flood_wait | spam_blocked | error
    status                  TEXT DEFAULT 'inactive',
    is_spam_blocked         INTEGER DEFAULT 0,
    spam_checked_at         TEXT,
    flood_wait_until        TEXT,
    error_message           TEXT,

    -- Статистика
    messages_sent           INTEGER DEFAULT 0,
    messages_today          INTEGER DEFAULT 0,
    messages_today_date     TEXT,                   -- дата последнего сброса счётчика

    last_active_at          TEXT,
    created_at              TEXT DEFAULT (datetime('now')),

    -- Настройки автоответчика
    autoresponder_enabled   INTEGER DEFAULT 0,
    autoresponder_message   TEXT DEFAULT '',
    autoresponder_delay     INTEGER DEFAULT 5,       -- задержка перед ответом (сек)
    autoresponder_keywords  TEXT DEFAULT '[]',       -- JSON-массив ключевых слов
    proxy_id                INTEGER REFERENCES proxies(id) ON DELETE SET NULL
);

-- ─────────────────────────────────────────
-- История проверок на спам-блок
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS spam_checks (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    checked_at  TEXT DEFAULT (datetime('now')),
    is_blocked  INTEGER DEFAULT 0,
    details     TEXT
);

-- ─────────────────────────────────────────
-- Шаблоны сообщений
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS templates (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    content     TEXT NOT NULL,
    media_path  TEXT,                               -- путь к прикреплённому медиа
    media_type  TEXT,                               -- photo | video | document | null
    created_at  TEXT DEFAULT (datetime('now')),
    updated_at  TEXT DEFAULT (datetime('now'))
);

-- ─────────────────────────────────────────
-- Кампании рассылки
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS campaigns (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    template_id     INTEGER REFERENCES templates(id) ON DELETE SET NULL,

    -- Статус: draft | running | paused | completed | stopped
    status          TEXT DEFAULT 'draft',

    -- Настройки отправки
    delay_min       INTEGER DEFAULT 5,              -- мин задержка между сообщениями (сек)
    delay_max       INTEGER DEFAULT 15,             -- макс задержка (сек)
    daily_limit     INTEGER DEFAULT 50,             -- лимит в день на аккаунт
    schedule_start  TEXT,                           -- время старта HH:MM (null = немедленно)
    schedule_end    TEXT,                           -- время остановки HH:MM (null = не останавливать)
    is_looped       INTEGER DEFAULT 0,              -- циклическая рассылка (0 - нет, 1 - да)
    loop_delay      INTEGER DEFAULT 60,             -- пауза между кругами в минутах

    -- Статистика
    total_sent      INTEGER DEFAULT 0,
    total_failed    INTEGER DEFAULT 0,
    total_blocked   INTEGER DEFAULT 0,

    created_at      TEXT DEFAULT (datetime('now')),
    started_at      TEXT,
    completed_at    TEXT
);

-- Связь кампания ↔ аккаунты-отправители
CREATE TABLE IF NOT EXISTS campaign_accounts (
    campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    account_id  INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    PRIMARY KEY (campaign_id, account_id)
);

-- Получатели кампании
CREATE TABLE IF NOT EXISTS campaign_recipients (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id     INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
    identifier      TEXT NOT NULL,                  -- username или номер телефона
    custom_vars     TEXT DEFAULT '{}',              -- JSON для переменных {custom1} и т.д.

    -- Статус: pending | sent | failed | blocked | skipped
    status          TEXT DEFAULT 'pending',
    error_message   TEXT,
    sent_at         TEXT,
    sent_by         INTEGER REFERENCES accounts(id) -- какой аккаунт отправил
);

-- ─────────────────────────────────────────
-- Настройки приложения (key-value)
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
    key     TEXT PRIMARY KEY,
    value   TEXT
);

-- Дефолтные настройки
INSERT OR IGNORE INTO settings (key, value) VALUES
    ('spam_check_interval', '30'),
    ('default_daily_limit', '50'),
    ('default_delay_min', '5'),
    ('default_delay_max', '15'),
    ('theme', 'dark');

-- ─────────────────────────────────────────
-- Очереди и базы вступления в чаты
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS account_joins (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id    INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    chat_link     TEXT NOT NULL,
    status        TEXT DEFAULT 'pending',             -- pending | joining | joined | failed
    error_message TEXT,
    joined_at     TEXT
);

CREATE TABLE IF NOT EXISTS global_chats (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    chat_link     TEXT UNIQUE NOT NULL,
    is_folder     INTEGER DEFAULT 0,
    folder_slug   TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
);

-- Папки чатов (t.me/addlist/SLUG): метаданные и закэшированный состав
CREATE TABLE IF NOT EXISTS folders (
    slug          TEXT PRIMARY KEY,
    link          TEXT,
    title         TEXT,
    chats_count   INTEGER DEFAULT 0,
    fetched_at    TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS folder_chats (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    slug          TEXT NOT NULL,
    chat_title    TEXT,
    username      TEXT,
    chat_type     TEXT,                               -- channel | group | private
    is_private    INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_folder_chats_slug ON folder_chats(slug);

-- ─────────────────────────────────────────
-- Прокси
-- ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS proxies (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    host          TEXT NOT NULL,
    port          INTEGER NOT NULL,
    protocol      TEXT NOT NULL,                      -- socks5 | http
    username      TEXT,
    password      TEXT,
    is_active     INTEGER DEFAULT 1,
    status        TEXT DEFAULT 'untested',            -- untested | working | dead
    error_message TEXT,
    last_check_at TEXT,
    created_at    TEXT DEFAULT (datetime('now'))
);

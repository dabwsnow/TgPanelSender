"""
services/join_runner.py — фоновый планировщик автоматического вступления в чаты.

Возможности:
- Запуск авто-вступлений по списку из `account_joins` для каждого аккаунта отдельно.
- Настраиваемые интервалы задержек.
- Автоматический обход/клик по кнопкам-капчам от приветственных ботов.
- Подробное логирование статуса вступления.
"""
import asyncio
import json
import logging
import random
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

import aiosqlite
from telethon import TelegramClient, events, types, errors
from telethon.tl.functions.channels import JoinChannelRequest
from telethon.tl.functions.messages import ImportChatInviteRequest

from services.telegram_service import telegram_manager
from database import get_db

logger = logging.getLogger(__name__)

# account_id -> asyncio.Task
_running_join_tasks: dict[int, asyncio.Task] = {}


def parse_chat_link(link: str):
    """
    Парсит ссылку на чат.
    Возвращает (type, value), где type: 'folder' | 'hash' | 'username',
    или (None, None) если ссылка невалидна.
    """
    link = link.strip()
    
    # 0. Папки чатов вида t.me/addlist/SLUG или https://t.me/addlist/SLUG
    folder_match = re.search(r'(?:t\.me|telegram\.me)/addlist/([a-zA-Z0-9_\-]+)', link)
    if folder_match:
        return 'folder', folder_match.group(1)
        
    # 1. Приватные ссылки вида t.me/joinchat/HASH или t.me/+HASH
    private_match = re.search(r'(?:t\.me|telegram\.me)/(?:\+|joinchat/)([a-zA-Z0-9_\-]+)', link)
    if private_match:
        return 'hash', private_match.group(1)
        
    # 2. Публичные ссылки вида t.me/username или @username
    public_match = re.search(r'(?:t\.me|telegram\.me|@)/?([a-zA-Z0-9_]{5,32})', link)
    if public_match:
        return 'username', public_match.group(1)
        
    # 3. Просто username без @
    if re.match(r'^[a-zA-Z0-9_]{5,32}$', link):
        return 'username', link
        
    return None, None


async def resolve_folder_links(link: str) -> list[str]:
    """
    Папки чатов (t.me/addlist/SLUG) НЕ распаковываются в отдельные чаты —
    они остаются папкой и вступают целиком через JoinChatlistInviteRequest,
    сохраняя структуру папки в Telegram. Для остальных ссылок — passthrough.
    """
    return [link]


async def _get_any_active_client() -> Optional[TelegramClient]:
    """Возвращает подключённого клиента любого живого аккаунта (для запросов к API)."""
    from config import DB_PATH
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM accounts WHERE is_spam_blocked=0 ORDER BY CASE WHEN status='active' THEN 0 ELSE 1 END, id"
        ) as cur:
            accounts = await cur.fetchall()

    for acc in accounts:
        client = telegram_manager.get_client(acc["id"])
        if client and client.is_connected():
            return client
        try:
            ok = await telegram_manager.load_session(acc["id"], acc["api_id"], acc["api_hash"])
            if ok:
                client = telegram_manager.get_client(acc["id"])
                if client:
                    return client
        except Exception as e:
            logger.warning(f"Не удалось поднять клиента {acc['id']} для запроса папки: {e}")
    return None


def _extract_folder_chats(invite_info) -> list[dict]:
    """Достаёт список чатов из ответа CheckChatlistInviteRequest."""
    chats = []
    for chat in (getattr(invite_info, 'chats', None) or []):
        username = getattr(chat, 'username', None)
        raw_title = getattr(chat, 'title', None)
        title = raw_title.text if hasattr(raw_title, 'text') else (str(raw_title) if raw_title else (f"@{username}" if username else "Без названия"))
        # Определяем тип чата
        if getattr(chat, 'broadcast', False):
            ctype = 'channel'
        elif getattr(chat, 'megagroup', False) or getattr(chat, 'gigagroup', False):
            ctype = 'group'
        else:
            ctype = 'group'
        chats.append({
            "chat_title": title,
            "username": username,
            "chat_type": ctype,
            "is_private": 0 if username else 1,
        })
    return chats


async def fetch_folder_contents(slug: str) -> dict:
    """
    Запрашивает состав папки чатов у Telegram.
    Возвращает {"slug", "title", "chats": [...]}.
    Бросает исключение, если нет доступного аккаунта или папка невалидна.
    """
    client = await _get_any_active_client()
    if not client:
        raise RuntimeError("Нет подключённого аккаунта для чтения папки")

    from telethon.tl.functions import chatlists
    invite_info = await client(chatlists.CheckChatlistInviteRequest(slug=slug))
    raw_title = getattr(invite_info, 'title', None)
    title = raw_title.text if hasattr(raw_title, 'text') else (str(raw_title) if raw_title else "Папка")
    chats = _extract_folder_chats(invite_info)
    return {"slug": slug, "title": title, "chats": chats}


async def cache_folder(db: aiosqlite.Connection, link: str) -> Optional[dict]:
    """
    Загружает состав папки и кэширует его в таблицы folders / folder_chats.
    Возвращает данные папки или None, если это не папка / не удалось прочитать.
    """
    link_type, slug = parse_chat_link(link)
    if link_type != 'folder':
        return None

    try:
        data = await fetch_folder_contents(slug)
    except Exception as e:
        logger.warning(f"Не удалось прочитать папку {slug}: {e}")
        return None

    now = datetime.utcnow().isoformat()
    await db.execute(
        """INSERT INTO folders (slug, link, title, chats_count, fetched_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(slug) DO UPDATE SET
             link=excluded.link, title=excluded.title,
             chats_count=excluded.chats_count, fetched_at=excluded.fetched_at""",
        (slug, link, data["title"], len(data["chats"]), now)
    )
    await db.execute("DELETE FROM folder_chats WHERE slug = ?", (slug,))
    for c in data["chats"]:
        await db.execute(
            """INSERT INTO folder_chats (slug, chat_title, username, chat_type, is_private)
               VALUES (?, ?, ?, ?, ?)""",
            (slug, c["chat_title"], c["username"], c["chat_type"], c["is_private"])
        )
    await db.commit()
    data["slug"] = slug
    return data


async def _join_one_chat(client: TelegramClient, link: str) -> str:
    """
    Вступает в один чат или импортирует папку чатов, решает кнопочную капчу.
    Возвращает статус: 'joined' или бросает исключение.
    """
    link_type, val = parse_chat_link(link)
    if not link_type:
        raise ValueError("Некорректная ссылка на чат")

    if link_type == 'folder':
        from telethon.tl.functions import chatlists
        invite_info = await client(chatlists.CheckChatlistInviteRequest(slug=val))
        
        # Собираем все пиры, в которые нужно вступить
        peers_to_join = []
        if hasattr(invite_info, 'peers') and invite_info.peers:
            peers_to_join.extend(invite_info.peers)
        if hasattr(invite_info, 'missing_peers') and invite_info.missing_peers:
            peers_to_join.extend(invite_info.missing_peers)
            
        if not peers_to_join:
            return "folder already joined or empty"
            
        # Преобразуем Peer в InputPeer
        input_peers = []
        for p in peers_to_join:
            try:
                ip = await client.get_input_entity(p)
                input_peers.append(ip)
            except Exception as e:
                logger.warning(f"Не удалось получить input entity для {p}: {e}")
                
        if not input_peers:
            return "folder already joined or empty (нет доступных чатов)"
            
        try:
            await client(chatlists.JoinChatlistInviteRequest(slug=val, peers=input_peers))
            return f"joined folder ({len(input_peers)} чат(ов))"
        except Exception as e:
            if "FilterIncludeEmpty" in type(e).__name__ or "FILTER_INCLUDE_EMPTY" in str(e):
                return "folder already joined or empty"
            raise

    entity = None
    if link_type == 'hash':
        res = await client(ImportChatInviteRequest(val))
        if hasattr(res, 'chats') and res.chats:
            entity = res.chats[0]
    else:
        res = await client(JoinChannelRequest(val))
        if hasattr(res, 'chats') and res.chats:
            entity = res.chats[0]
        else:
            entity = await client.get_entity(val)

    if not entity:
        return "joined"  # вступили, но нет информации по сущности для капчи

    chat_id = entity.id
    captcha_resolved = False
    
    # Пытаемся поймать приветственное сообщение от бота с кнопками в течение 5 секунд
    async def captcha_handler(event):
        nonlocal captcha_resolved
        if event.chat_id == chat_id and event.message.reply_markup:
            buttons = event.message.buttons
            if not buttons:
                return

            import emoji
            msg_text = (event.message.message or "").lower()

            # Собираем все кнопки, содержащие эмодзи
            btn_emojis = []
            for row in buttons:
                for button in row:
                    txt = button.text or ""
                    extracted = [c for c in txt if c in emoji.EMOJI_DATA]
                    if extracted:
                        btn_emojis.append((button, extracted[0], txt))

            # 1. Проверяем прямое совпадение символа эмодзи в тексте сообщения
            for button, emo, label in btn_emojis:
                if emo in event.message.message:
                    try:
                        await button.click()
                        logger.info(f"Эмодзи-капча решена (прямое совпадение '{emo}') в чате {chat_id}")
                        captcha_resolved = True
                        return
                    except Exception as e:
                        logger.warning(f"Не удалось нажать кнопку эмодзи '{emo}': {e}")

            # Словарь маппинга эмодзи для текстовых описаний капчи
            EMOJI_KEYWORDS = {
                "🍎": ["яблоко", "apple"],
                "🐱": ["кошка", "кот", "cat", "kitty", "🐱"],
                "🐶": ["собака", "dog", "puppy", "🐶"],
                "🚗": ["машина", "автомобиль", "car", "auto", "🚗"],
                "🏠": ["дом", "house", "home", "🏠"],
                "✈️": ["самолет", "airplane", "plane", "✈️"],
                "⚽": ["мяч", "футбол", "ball", "soccer", "⚽"],
                "🍌": ["банан", "banana", "🍌"],
                "🔑": ["ключ", "key", "🔑"],
                "🔔": ["колокольчик", "звонок", "bell", "🔔"],
                "🦊": ["лиса", "fox", "🦊"],
                "🐻": ["медведь", "bear", "🐻"],
                "🐼": ["панда", "panda", "🐼"],
                "🐨": ["коала", "koala", "🐨"],
                "🦁": ["лев", "lion", "🦁"],
                "🐯": ["тигр", "tiger", "🐯"],
                "🐰": ["кролик", "rabbit", "bunny", "🐰"],
                "🐒": ["обезьяна", "monkey", "🐒"],
                "🐔": ["курица", "chicken", "🐔"],
                "🐧": ["пингвин", "penguin", "🐧"],
                "🐦": ["птица", "bird", "🐦"],
                "🐸": ["лягушка", "frog", "🐸"],
                "🐢": ["черепаха", "turtle", "🐢"],
                "🐠": ["рыба", "fish", "🐠"],
                "🍉": ["арбуз", "watermelon", "🍉"],
                "🍇": ["виноград", "grape", "🍇"],
                "🍓": ["клубника", "strawberry", "🍓"],
                "🍒": ["вишня", "cherry", "🍒"],
                "🍍": ["ананас", "pineapple", "🍍"],
                "🍑": ["персик", "peach", "🍑"],
            }

            # 2. Проверяем совпадение по ключевым словам описания эмодзи
            for button, emo, label in btn_emojis:
                kws = EMOJI_KEYWORDS.get(emo, [])
                if any(kw in msg_text for kw in kws):
                    try:
                        await button.click()
                        logger.info(f"Эмодзи-капча решена (по ключевому слову '{emo}') в чате {chat_id}")
                        captcha_resolved = True
                        return
                    except Exception as e:
                        logger.warning(f"Не удалось нажать кнопку эмодзи '{emo}' по ключевому слову: {e}")

            # 3. Резервный текстовый кликер верификации
            for row in buttons:
                for button in row:
                    btn_txt = (button.text or "").lower()
                    if any(kw in btn_txt for kw in ["click", "клик", "human", "человек", "verify", "подтвердить", "unmute", "разблок", "start", "старт"]):
                        try:
                            await button.click()
                            logger.info(f"Текстовый кликер нажал кнопку капчи '{button.text}' в чате {chat_id}")
                            captcha_resolved = True
                            return
                        except Exception as e:
                            logger.warning(f"Не удалось нажать текстовую кнопку капчи: {e}")

    client.add_event_handler(captcha_handler, events.NewMessage(chats=chat_id))
    try:
        await asyncio.sleep(5)  # Ожидаем капчу
    finally:
        client.remove_event_handler(captcha_handler)

    if captcha_resolved:
        return "joined (капча решена)"
    return "joined"


async def _run_joins_loop(account_id: int, delay_min: int, delay_max: int):
    """Основной цикл выполнения вступлений для аккаунта."""
    logger.info(f"Запуск воркера авто-вступлений для аккаунта {account_id}")
    
    # Создаём соединение с БД для этой фоновой задачи
    from config import DB_PATH
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        while True:
            # Получаем первый pending чат из очереди
            async with db.execute(
                "SELECT * FROM account_joins WHERE account_id = ? AND status = 'pending' ORDER BY id ASC LIMIT 1",
                (account_id,)
            ) as cur:
                row = await cur.fetchone()

            if not row:
                logger.info(f"Все чаты в очереди аккаунта {account_id} обработаны. Воркер остановлен.")
                break

            join_id = row["id"]
            chat_link = row["chat_link"]

            # Переводим в статус 'joining'
            await db.execute(
                "UPDATE account_joins SET status = 'joining' WHERE id = ?", (join_id,)
            )
            await db.commit()

            client = telegram_manager.get_client(account_id)
            if not client:
                error_msg = "Аккаунт не подключён"
                await db.execute(
                    "UPDATE account_joins SET status = 'failed', error_message = ? WHERE id = ?",
                    (error_msg, join_id)
                )
                await db.commit()
                break

            try:
                # Вступаем
                logger.info(f"Аккаунт {account_id} вступает в {chat_link}...")
                status_desc = await _join_one_chat(client, chat_link)
                
                # Успех
                await db.execute(
                    "UPDATE account_joins SET status = 'joined', error_message = ?, joined_at = datetime('now') WHERE id = ?",
                    (status_desc, join_id)
                )
                await db.commit()
                logger.info(f"Аккаунт {account_id} успешно вступил в {chat_link} ({status_desc})")

            except errors.FloodWaitError as e:
                # Флуд-вейт от Telegram
                error_msg = f"FloodWait: необходимо подождать {e.seconds} сек"
                await db.execute(
                    "UPDATE account_joins SET status = 'pending', error_message = ? WHERE id = ?",
                    (error_msg, join_id)
                )
                await db.commit()
                logger.warning(f"Аккаунт {account_id} словил FloodWait при входе в {chat_link}. Сон {e.seconds} секунд.")
                await asyncio.sleep(e.seconds)
                continue

            except Exception as e:
                # Другая ошибка (PeerFlood, бан ссылки, приватный канал)
                error_msg = str(e)
                await db.execute(
                    "UPDATE account_joins SET status = 'failed', error_message = ? WHERE id = ?",
                    (error_msg, join_id)
                )
                await db.commit()
                logger.error(f"Ошибка вступления {account_id} -> {chat_link}: {e}")

            # Случайная задержка перед следующим чатом
            delay = random.uniform(delay_min, delay_max)
            logger.info(f"Сон {delay:.1f} сек перед следующим вступлением...")
            await asyncio.sleep(delay)

    _running_join_tasks.pop(account_id, None)


def start_joins(account_id: int, delay_min: int = 30, delay_max: int = 60) -> bool:
    """Запускает воркер вступлений в фоне."""
    if account_id in _running_join_tasks:
        return False
    
    task = asyncio.create_task(_run_joins_loop(account_id, delay_min, delay_max))
    _running_join_tasks[account_id] = task
    return True


def stop_joins(account_id: int) -> bool:
    """Останавливает воркер вступлений."""
    task = _running_join_tasks.pop(account_id, None)
    if task:
        task.cancel()
        return True
    return False


def is_running(account_id: int) -> bool:
    """Возвращает статус активности воркера."""
    return account_id in _running_join_tasks

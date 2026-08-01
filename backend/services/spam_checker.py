"""
services/spam_checker.py — проверка аккаунтов на спам-блок.

Логика:
  1. Подключаемся к @SpamBot
  2. Отправляем /start
  3. Ждём ответ и парсим его текст
  4. Сохраняем результат в БД

Добавить другой метод проверки — расширь функцию check_account().
"""
import asyncio
import logging
from datetime import datetime

import aiosqlite
from telethon import TelegramClient, events

from services.telegram_service import telegram_manager

logger = logging.getLogger(__name__)

SPAMBOT_USERNAME = "SpamBot"
SPAMBOT_WAIT_SEC = 10  # максимум ждём ответа


async def check_account(account_id: int, db: aiosqlite.Connection) -> dict:
    """
    Проверяет аккаунт на спам-блок через @SpamBot.
    Возвращает {"is_blocked": bool, "details": str}
    """
    client: TelegramClient = telegram_manager.get_client(account_id)

    # Если клиент не подключён — пробуем поднять сессию из файла.
    if not client or not client.is_connected():
        async with db.execute(
            "SELECT api_id, api_hash FROM accounts WHERE id = ?", (account_id,)
        ) as cur:
            arow = await cur.fetchone()
        if arow:
            await telegram_manager.load_session(account_id, arow["api_id"], arow["api_hash"])
            client = telegram_manager.get_client(account_id)

    # Всё ещё нет живого клиента — проверить нельзя. НЕ считаем это "блока нет".
    if not client or not client.is_connected():
        now = datetime.utcnow().isoformat()
        details = "Не удалось подключить аккаунт — проверка невозможна"
        await db.execute(
            """INSERT INTO spam_checks (account_id, checked_at, is_blocked, details)
               VALUES (?, ?, ?, ?)""",
            (account_id, now, 0, details)
        )
        # Аккаунт дохлый — статус error (спам-флаг не меняем).
        await db.execute(
            "UPDATE accounts SET spam_checked_at = ?, status = CASE WHEN status != 'spam_blocked' THEN 'error' ELSE status END WHERE id = ?",
            (now, account_id)
        )
        await db.commit()
        return {"ok": False, "checked": False, "is_blocked": None, "details": details}

    result = {"ok": True, "checked": True, "is_blocked": False, "details": ""}
    received = asyncio.Event()

    @client.on(events.NewMessage(from_users=SPAMBOT_USERNAME))
    async def handler(event):
        text = event.raw_text.lower()
        result["details"] = event.raw_text
        # Типичные ответы SpamBot когда аккаунт заблокирован
        if any(kw in text for kw in ["limited", "spam", "block", "ограничен", "заблокирован"]):
            result["is_blocked"] = True
        else:
            result["is_blocked"] = False
        received.set()

    try:
        await client.send_message(SPAMBOT_USERNAME, "/start")
        # Ждём ответа
        await asyncio.wait_for(received.wait(), timeout=SPAMBOT_WAIT_SEC)
    except asyncio.TimeoutError:
        result["details"] = "Нет ответа от @SpamBot (timeout)"
        result["is_blocked"] = None
        result["checked"] = False
        logger.warning(f"SpamBot timeout для аккаунта {account_id}")
    except Exception as e:
        result["details"] = f"Ошибка проверки: {e}"
        result["is_blocked"] = None
        result["checked"] = False
        logger.error(f"Ошибка spam check для {account_id}: {e}")
    finally:
        client.remove_event_handler(handler)

    # Сохраняем в историю
    now = datetime.utcnow().isoformat()
    blocked_int = 0 if result["is_blocked"] in (None, False) else 1
    await db.execute(
        """INSERT INTO spam_checks (account_id, checked_at, is_blocked, details)
           VALUES (?, ?, ?, ?)""",
        (account_id, now, blocked_int, result["details"])
    )

    if result.get("checked"):
        # Достоверный результат — обновляем флаг спама и статус.
        await db.execute(
            """UPDATE accounts
               SET is_spam_blocked = ?, spam_checked_at = ?,
                   status = CASE WHEN ? = 1 THEN 'spam_blocked' ELSE status END
               WHERE id = ?""",
            (blocked_int, now, blocked_int, account_id)
        )
    else:
        # Проверка не удалась — только время, флаг спама не трогаем.
        await db.execute(
            "UPDATE accounts SET spam_checked_at = ? WHERE id = ?",
            (now, account_id)
        )
    await db.commit()

    logger.info(
        f"Аккаунт {account_id}: spam_blocked={result['is_blocked']}, "
        f"details={result['details'][:80]}"
    )
    return result


async def check_all_accounts(db: aiosqlite.Connection) -> list[dict]:
    """Проверяет все аккаунты. Вызывается планировщиком и кнопкой 'Проверить все'."""
    async with db.execute(
        "SELECT id FROM accounts"
    ) as cursor:
        rows = await cursor.fetchall()

    results = []
    for row in rows:
        result = await check_account(row["id"], db)
        result["account_id"] = row["id"]
        results.append(result)
        # Небольшая пауза между аккаунтами
        await asyncio.sleep(2)

    return results

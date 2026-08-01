"""
services/campaign_runner.py — движок выполнения кампаний рассылки.

Принцип:
  - Каждая кампания запускается как asyncio Task
  - Сообщения отправляются по очереди через все аккаунты-отправители
  - Между сообщениями случайная задержка [delay_min, delay_max] секунд
  - Дневной лимит: если аккаунт достиг лимита — пропускаем до следующего дня
  - При ошибке FloodWait — ждём, при спам-блоке — пропускаем аккаунт

Расширить логику — добавь новые проверки в _send_one() или _select_account().
"""
import asyncio
import json
import logging
import random
from datetime import datetime, date
from typing import Optional

import aiosqlite
from telethon import errors

from services.telegram_service import telegram_manager

logger = logging.getLogger(__name__)

# campaign_id -> asyncio.Task
_running_tasks: dict[int, asyncio.Task] = {}


def _render_text(template: str, identifier: str, custom_vars: dict) -> str:
    """Подставляет переменные в шаблон сообщения."""
    text = template
    for key, val in custom_vars.items():
        text = text.replace(f"{{{key}}}", str(val))
    # Базовые переменные из идентификатора
    if identifier.startswith("@"):
        text = text.replace("{username}", identifier)
    return text


def _pick_text(template_content: str, variations_json: str, identifier: str, custom_vars: dict) -> str:
    """
    Выбирает текст для отправки:
    - Если у шаблона есть AI-вариации — берёт случайную
    - Иначе — базовый текст шаблона
    Подставляет переменные.
    """
    try:
        variations = json.loads(variations_json or "[]")
    except (json.JSONDecodeError, TypeError):
        variations = []

    base = random.choice(variations) if variations else template_content
    return _render_text(base, identifier, custom_vars)



async def _get_pending_recipients(campaign_id: int, db: aiosqlite.Connection) -> list:
    async with db.execute(
        "SELECT * FROM campaign_recipients WHERE campaign_id = ? AND status = 'pending'",
        (campaign_id,)
    ) as cur:
        return await cur.fetchall()


async def _get_campaign_accounts(campaign_id: int, db: aiosqlite.Connection) -> list:
    async with db.execute(
        """SELECT a.* FROM accounts a
           JOIN campaign_accounts ca ON ca.account_id = a.id
           WHERE ca.campaign_id = ? AND a.status = 'active' AND a.is_spam_blocked = 0""",
        (campaign_id,)
    ) as cur:
        return await cur.fetchall()


async def _send_one(
    account_row, recipient_row, template_content: str,
    media_path: Optional[str], db: aiosqlite.Connection,
    variations_json: str = "[]"
) -> str:
    """
    Отправляет одно сообщение. Возвращает статус: 'sent' | 'failed' | 'blocked'.
    Если у шаблона есть AI-вариации — отправляет случайную из них.
    """
    account_id = account_row["id"]
    identifier = recipient_row["identifier"]
    custom_vars = json.loads(recipient_row["custom_vars"] or "{}")
    text = _pick_text(template_content, variations_json, identifier, custom_vars)

    try:
        await telegram_manager.send_message(account_id, identifier, text, media_path)

        # Обновляем счётчики аккаунта
        today = date.today().isoformat()
        await db.execute(
            """UPDATE accounts SET
                 messages_sent = messages_sent + 1,
                 messages_today = CASE
                   WHEN messages_today_date = ? THEN messages_today + 1
                   ELSE 1
                 END,
                 messages_today_date = ?,
                 last_active_at = datetime('now')
               WHERE id = ?""",
            (today, today, account_id)
        )
        return "sent"

    except errors.FloodWaitError as e:
        logger.warning(f"FloodWait {e.seconds}s на аккаунте {account_id}")
        await db.execute(
            "UPDATE accounts SET status = 'flood_wait' WHERE id = ?",
            (account_id,)
        )
        await asyncio.sleep(e.seconds)
        return "failed"

    except errors.UserPrivacyRestrictedError:
        return "blocked"

    except errors.PeerFloodError:
        await db.execute(
            "UPDATE accounts SET is_spam_blocked = 1, status = 'spam_blocked' WHERE id = ?",
            (account_id,)
        )
        return "blocked"

    except Exception as e:
        logger.error(f"Ошибка отправки {account_id} → {identifier}: {e}")
        return "failed"


async def _run_campaign(campaign_id: int, db: aiosqlite.Connection):
    """Основной цикл выполнения кампании."""
    logger.info(f"Кампания {campaign_id} запущена")

    # Получаем настройки кампании
    async with db.execute(
        """SELECT c.*, t.content as template_content, t.media_path, t.variations as template_variations
           FROM campaigns c LEFT JOIN templates t ON t.id = c.template_id
           WHERE c.id = ?""",
        (campaign_id,)
    ) as cur:
        campaign = await cur.fetchone()

    if not campaign:
        logger.error(f"Кампания {campaign_id} не найдена")
        return

    delay_min = campaign["delay_min"]
    delay_max = campaign["delay_max"]
    daily_limit = campaign["daily_limit"]
    template_content = campaign["template_content"] or ""
    media_path = campaign["media_path"]
    template_variations = campaign["template_variations"]
    is_looped = bool(campaign["is_looped"])
    loop_delay = campaign["loop_delay"]

    # Обновляем статус
    await db.execute(
        "UPDATE campaigns SET status = 'running', started_at = datetime('now') WHERE id = ?",
        (campaign_id,)
    )
    await db.commit()

    try:
        while True:
            recipients = await _get_pending_recipients(campaign_id, db)
            
            # Если нет получателей в статусе pending
            if not recipients:
                if is_looped:
                    logger.info(f"Кампания {campaign_id} (циклическая): круг завершен. Сброс статусов получателей...")
                    await db.execute(
                        "UPDATE campaign_recipients SET status = 'pending', sent_at = NULL, error_message = NULL WHERE campaign_id = ?",
                        (campaign_id,)
                    )
                    await db.commit()
                    
                    # Проверяем, появились ли получатели (вдруг список вообще пуст)
                    recipients = await _get_pending_recipients(campaign_id, db)
                    if not recipients:
                        logger.warning(f"Кампания {campaign_id} (циклическая): получателей не найдено.")
                        break

                    logger.info(f"Кампания {campaign_id} (циклическая): пауза между кругами {loop_delay} мин.")
                    # Спим интервалами по 5 сек, чтобы можно было быстро остановить кампанию
                    for _ in range(int(loop_delay * 60 / 5)):
                        if campaign_id not in _running_tasks:
                            break
                        await asyncio.sleep(5)
                        
                    if campaign_id not in _running_tasks:
                        break
                    continue
                else:
                    # Обычная кампания — выходим из цикла
                    break

            account_index = 0
            for recipient in recipients:
                if campaign_id not in _running_tasks:
                    break  # кампания была остановлена

                # Проверяем расписание
                schedule_start = campaign["schedule_start"]
                schedule_end = campaign["schedule_end"]
                if schedule_start and schedule_end:
                    now_time = datetime.now().strftime("%H:%M")
                    if not (schedule_start <= now_time <= schedule_end):
                        logger.info(f"Вне расписания для кампании {campaign_id}, ждём...")
                        await asyncio.sleep(60)
                        continue

                # Выбираем аккаунт
                accounts = await _get_campaign_accounts(campaign_id, db)
                if not accounts:
                    logger.warning(f"Нет активных аккаунтов для кампании {campaign_id}")
                    await asyncio.sleep(30)
                    continue

                # Ротация аккаунтов по лимиту
                account = None
                today = date.today().isoformat()
                for _ in range(len(accounts)):
                    acc = accounts[account_index % len(accounts)]
                    account_index += 1
                    today_count = acc["messages_today"] if acc["messages_today_date"] == today else 0
                    if today_count < daily_limit:
                        account = acc
                        break

                if not account:
                    logger.info(f"Все аккаунты достигли дневного лимита, ждём...")
                    await asyncio.sleep(3600)
                    continue

                # Отправляем
                status = await _send_one(account, recipient, template_content, media_path, db, template_variations)

                # Обновляем статус получателя
                await db.execute(
                    """UPDATE campaign_recipients
                       SET status = ?, sent_at = datetime('now'), sent_by = ?,
                           error_message = CASE WHEN ? = 'failed' THEN 'Ошибка отправки' ELSE NULL END
                       WHERE id = ?""",
                    (status, account["id"], status, recipient["id"])
                )
                # Обновляем счётчики кампании
                field = {"sent": "total_sent", "blocked": "total_blocked"}.get(status, "total_failed")
                await db.execute(
                    f"UPDATE campaigns SET {field} = {field} + 1 WHERE id = ?",
                    (campaign_id,)
                )
                await db.commit()

                # Задержка между сообщениями
                delay = random.uniform(delay_min, delay_max)
                await asyncio.sleep(delay)

            # Если кампания не зациклена, выходим из бесконечного цикла
            if not is_looped:
                break

        # Завершение
        await db.execute(
            "UPDATE campaigns SET status = 'completed', completed_at = datetime('now') WHERE id = ?",
            (campaign_id,)
        )
        await db.commit()
        logger.info(f"Кампания {campaign_id} завершена")

    except asyncio.CancelledError:
        await db.execute(
            "UPDATE campaigns SET status = 'stopped' WHERE id = ?",
            (campaign_id,)
        )
        await db.commit()
        logger.info(f"Кампания {campaign_id} остановлена")
    finally:
        _running_tasks.pop(campaign_id, None)


def start_campaign(campaign_id: int, db: aiosqlite.Connection):
    """Запускает кампанию в фоне."""
    if campaign_id in _running_tasks:
        return False
    task = asyncio.create_task(_run_campaign(campaign_id, db))
    _running_tasks[campaign_id] = task
    return True


def stop_campaign(campaign_id: int):
    """Останавливает выполняющуюся кампанию."""
    task = _running_tasks.pop(campaign_id, None)
    if task:
        task.cancel()
        return True
    return False


def is_running(campaign_id: int) -> bool:
    return campaign_id in _running_tasks

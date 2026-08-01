"""
services/auto_responder.py — автоответчик для аккаунтов.

Принцип:
  - При активации слушает входящие личные сообщения клиента
  - Если сообщение соответствует ключевым словам (или их нет) — отвечает
  - Хранит множество already_replied чтобы не спамить одному пользователю

Добавить новую логику — расширь метод _should_reply().
"""
import asyncio
import json
import logging
from datetime import datetime
from typing import Optional

from telethon import TelegramClient, events

from services.telegram_service import telegram_manager

logger = logging.getLogger(__name__)

# account_id -> set of user_ids которым уже ответили
_replied_to: dict[int, set] = {}
# account_id -> event handler (чтобы можно было снять)
_handlers: dict[int, object] = {}


def _render_message(template: str, sender) -> str:
    """Подставляет переменные в шаблон автоответа."""
    first_name = getattr(sender, "first_name", "") or ""
    last_name = getattr(sender, "last_name", "") or ""
    username = getattr(sender, "username", "") or ""
    return (
        template
        .replace("{first_name}", first_name)
        .replace("{last_name}", last_name)
        .replace("{username}", f"@{username}" if username else "")
        .replace("{name}", first_name or username)
        .replace("{date}", datetime.now().strftime("%d.%m.%Y"))
        .replace("{time}", datetime.now().strftime("%H:%M"))
    )


def _should_reply(text: str, keywords: list[str]) -> bool:
    """Проверяет нужно ли отвечать на это сообщение."""
    if not keywords:
        return True  # ключевые слова не заданы → отвечаем всегда
    text_lower = text.lower()
    return any(kw.lower() in text_lower for kw in keywords)


async def enable(
    account_id: int,
    message: str,
    delay: int,
    keywords: list[str],
):
    """Включает автоответчик для аккаунта."""
    if account_id in _handlers:
        await disable(account_id)  # перезапускаем если уже был включён

    client: TelegramClient = telegram_manager.get_client(account_id)
    if not client:
        raise ValueError(f"Аккаунт {account_id} не подключён")

    _replied_to[account_id] = set()

    @client.on(events.NewMessage(incoming=True, func=lambda e: e.is_private))
    async def handler(event):
        sender = await event.get_sender()
        sender_id = sender.id

        # Не отвечать ботам
        if getattr(sender, "bot", False):
            return

        # Не спамить одному и тому же пользователю
        if sender_id in _replied_to[account_id]:
            return

        if not _should_reply(event.raw_text, keywords):
            return

        _replied_to[account_id].add(sender_id)

        if delay > 0:
            await asyncio.sleep(delay)

        try:
            reply_text = _render_message(message, sender)
            await event.reply(reply_text)
            logger.info(f"Автоответ от аккаунта {account_id} → {sender_id}")
        except Exception as e:
            logger.error(f"Ошибка автоответа {account_id}: {e}")

    _handlers[account_id] = handler
    logger.info(f"Автоответчик аккаунта {account_id} включён")


async def disable(account_id: int):
    """Выключает автоответчик для аккаунта."""
    handler = _handlers.pop(account_id, None)
    if handler:
        client: TelegramClient = telegram_manager.get_client(account_id)
        if client:
            client.remove_event_handler(handler)
    _replied_to.pop(account_id, None)
    logger.info(f"Автоответчик аккаунта {account_id} выключен")


def clear_replied(account_id: int):
    """Сбросить список ответивших (чтобы снова отвечать всем)."""
    _replied_to[account_id] = set()

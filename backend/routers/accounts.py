"""
routers/accounts.py — все эндпоинты для управления аккаунтами.

Структура:
  POST   /api/accounts/send-code       — запросить код
  POST   /api/accounts/verify-code     — подтвердить код
  POST   /api/accounts/verify-2fa      — 2FA
  GET    /api/accounts                 — список всех аккаунтов
  GET    /api/accounts/{id}            — один аккаунт
  DELETE /api/accounts/{id}            — удалить аккаунт
  PUT    /api/accounts/{id}/profile    — обновить профиль в Telegram
  PUT    /api/accounts/{id}/autoresponder — настройки автоответчика
  POST   /api/accounts/{id}/avatar     — загрузить аватар
  POST   /api/accounts/{id}/spam-check — ручная проверка спама
  POST   /api/accounts/{id}/connect    — переподключить аккаунт
  GET    /api/accounts/{id}/spam-history — история проверок
"""
import json
import logging
from pathlib import Path
from typing import List, Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse

from pydantic import BaseModel
from database import get_db
from models import (
    AccountSendCode, AccountVerifyCode, AccountVerify2FA,
    AccountProfileUpdate, AutoResponderUpdate, AccountOut
)
from services.telegram_service import telegram_manager
from services.spam_checker import check_account, check_all_accounts
from services import auto_responder
from config import UPLOADS_DIR, DEFAULT_API_ID, DEFAULT_API_HASH

router = APIRouter(prefix="/api/accounts", tags=["accounts"])
logger = logging.getLogger(__name__)


def _row_to_account(row) -> dict:
    """Конвертирует sqlite Row в словарь с нужными типами."""
    d = dict(row)
    d["is_spam_blocked"] = bool(d.get("is_spam_blocked", 0))
    d["autoresponder_enabled"] = bool(d.get("autoresponder_enabled", 0))
    try:
        d["autoresponder_keywords"] = json.loads(d.get("autoresponder_keywords") or "[]")
    except Exception:
        d["autoresponder_keywords"] = []
    d["connected"] = telegram_manager.is_connected(d["id"])
    return d


async def _pick_working_proxy(db: aiosqlite.Connection) -> Optional[int]:
    """Выбирает наименее загруженный рабочий прокси для авто-привязки."""
    async with db.execute(
        """SELECT p.id, COUNT(a.id) AS used
             FROM proxies p
             LEFT JOIN accounts a ON a.proxy_id = p.id
            WHERE p.is_active = 1 AND p.status = 'working'
            GROUP BY p.id
            ORDER BY used ASC, p.id ASC
            LIMIT 1"""
    ) as cur:
        row = await cur.fetchone()
    return row["id"] if row else None


# ─────────────────────────────────────────────────────
# Авторизация
# ─────────────────────────────────────────────────────

@router.post("/send-code")
async def send_code(body: AccountSendCode, db: aiosqlite.Connection = Depends(get_db)):
    """Шаг 1: отправить код верификации на телефон. API ключи из .env."""
    if not DEFAULT_API_ID or not DEFAULT_API_HASH:
        raise HTTPException(400, "TG_API_ID и TG_API_HASH не заданы в .env файле")
    try:
        phone = body.phone.replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
        phone_code_hash = await telegram_manager.request_code(
            phone, DEFAULT_API_ID, DEFAULT_API_HASH, body.proxy_id
        )
        return {"ok": True, "phone_code_hash": phone_code_hash}
    except Exception as e:
        raise HTTPException(400, str(e))


@router.post("/verify-code")
async def verify_code(body: AccountVerifyCode, db: aiosqlite.Connection = Depends(get_db)):
    """Шаг 2: ввести код и создать аккаунт в БД. API ключи из .env."""
    api_id   = DEFAULT_API_ID
    api_hash = DEFAULT_API_HASH
    phone = body.phone.replace(" ", "").replace("-", "").replace("(", "").replace(")", "")

    # Проверяем не существует ли уже такой аккаунт
    async with db.execute("SELECT id FROM accounts WHERE phone = ?", (phone,)) as cur:
        existing = await cur.fetchone()

    # Прокси не выбран вручную — подбираем рабочий автоматически.
    proxy_id = body.proxy_id
    if proxy_id is None:
        proxy_id = await _pick_working_proxy(db)

    if existing:
        account_id = existing["id"]
        if proxy_id is not None:
            await db.execute("UPDATE accounts SET proxy_id = ? WHERE id = ?", (proxy_id, account_id))
            await db.commit()
    else:
        # Создаём запись в БД чтобы получить id для имени сессии
        async with db.execute(
            "INSERT INTO accounts (phone, api_id, api_hash, session_name, status, proxy_id) VALUES (?,?,?,?,?,?)",
            (phone, api_id, api_hash, f"acc_{phone.replace('+','')}", "connecting", proxy_id)
        ) as cur:
            account_id = cur.lastrowid
 
        # Обновляем session_name с реальным id
        await db.execute(
            "UPDATE accounts SET session_name = ? WHERE id = ?",
            (str(account_id), account_id)
        )
        await db.commit()

    try:
        await telegram_manager.verify_code(phone, body.code, body.phone_code_hash, account_id)
    except Exception as e:
        if "SessionPasswordNeeded" in type(e).__name__:
          return {"ok": False, "requires_2fa": True}
        raise HTTPException(400, str(e))

    # Получаем данные профиля из Telegram
    me = await telegram_manager.get_me(account_id)
    if me:
        await db.execute(
            """UPDATE accounts SET
                 first_name=?, last_name=?, username=?, status='active'
               WHERE id=?""",
            (me.first_name, me.last_name, me.username, account_id)
        )
        await db.commit()

    return {"ok": True, "account_id": account_id, "requires_2fa": False}


@router.post("/verify-2fa")
async def verify_2fa(body: AccountVerify2FA, db: aiosqlite.Connection = Depends(get_db)):
    """Шаг 3 (если нужен): ввести пароль 2FA."""
    phone = body.phone.replace(" ", "").replace("-", "").replace("(", "").replace(")", "")
    async with db.execute("SELECT id FROM accounts WHERE phone = ?", (phone,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Аккаунт не найден")

    account_id = row["id"]
    try:
        await telegram_manager.verify_2fa(phone, body.password, account_id)
    except Exception as e:
        raise HTTPException(400, str(e))

    me = await telegram_manager.get_me(account_id)
    if me:
        await db.execute(
            "UPDATE accounts SET first_name=?, last_name=?, username=?, status='active' WHERE id=?",
            (me.first_name, me.last_name, me.username, account_id)
        )
        await db.commit()

    return {"ok": True, "account_id": account_id}


@router.post("/import-session")
async def import_session(
    file: UploadFile = File(...),
    db: aiosqlite.Connection = Depends(get_db)
):
    """
    Импорт сессий. Принимает либо один файл .session/StringSession,
    либо .zip архив с НЕСКОЛЬКИМИ .session (папки tdata игнорируются).
    """
    if not DEFAULT_API_ID or not DEFAULT_API_HASH:
        raise HTTPException(400, "TG_API_ID и TG_API_HASH не заданы в .env файле")

    file_content = await file.read()

    # ZIP → массовый импорт всех .session
    if file_content[:4] == b"PK\x03\x04":
        return await _bulk_import_response(db, file_content, mode="session")

    # Одиночный .session / StringSession
    try:
        phone, first_name, last_name, username, session_string = await telegram_manager.import_session_file(
            file_content, DEFAULT_API_ID, DEFAULT_API_HASH
        )
    except Exception as e:
        raise HTTPException(400, f"Ошибка импорта сессии: {e}")

    if not phone:
        phone = f"imported_{username or 'user'}"
    try:
        account_id = await _persist_imported_account(db, phone, first_name, last_name, username, session_string)
    except Exception as e:
        import traceback
        logger.error("Ошибка сохранения сессии (import-session):\n" + traceback.format_exc())
        raise HTTPException(400, f"Сессия распознана, но не удалось её сохранить: {e}")

    return {"ok": True, "account_id": account_id, "phone": phone}


@router.post("/import-tdata")
async def import_tdata(
    file: UploadFile = File(...),
    password: Optional[str] = None,
    db: aiosqlite.Connection = Depends(get_db)
):
    """
    Импорт из архива. Берёт ТОЛЬКО папки tdata (все, что есть в архиве),
    остальные файлы (.session, .json и т.п.) игнорируются.
    """
    if not DEFAULT_API_ID or not DEFAULT_API_HASH:
        raise HTTPException(400, "TG_API_ID и TG_API_HASH не заданы в .env файле")

    file_content = await file.read()
    if file_content[:4] != b"PK\x03\x04":
        raise HTTPException(400, "Ожидается .zip архив (внутри — одна или несколько папок tdata)")

    return await _bulk_import_response(db, file_content, mode="tdata", password=password)


async def _bulk_import_response(db, file_content: bytes, mode: str, password: Optional[str] = None) -> dict:
    """Общий разбор архива + сохранение всех найденных аккаунтов. mode: 'session'|'tdata'|'both'."""
    import traceback
    try:
        accounts, errors = await telegram_manager.parse_bulk_archive(
            file_content, DEFAULT_API_ID, DEFAULT_API_HASH, password, mode=mode
        )
    except Exception as e:
        logger.error(f"Ошибка разбора архива (mode={mode}):\n" + traceback.format_exc())
        raise HTTPException(400, f"Не удалось прочитать архив: {e}")

    imported = []
    for phone, first_name, last_name, username, session_string, source in accounts:
        if not phone:
            phone = f"imported_{username or source}"
        try:
            acc_id = await _persist_imported_account(db, phone, first_name, last_name, username, session_string)
            imported.append({"account_id": acc_id, "phone": phone, "source": source})
        except Exception as e:
            logger.error(f"Ошибка сохранения аккаунта {source}:\n" + traceback.format_exc())
            errors.append(f"{source}: {e}")

    if not imported and not accounts:
        hint = "папок tdata" if mode == "tdata" else "файлов .session"
        raise HTTPException(400, f"В архиве не найдено {hint}." + (f" Ошибки: {errors[0]}" if errors else ""))

    return {"ok": True, "imported": len(imported), "accounts": imported, "errors": errors}


async def _persist_imported_account(db, phone, first_name, last_name, username, session_string) -> int:
    """Сохраняет один импортированный аккаунт (dedupe по телефону) и поднимает сессию."""
    async with db.execute("SELECT id FROM accounts WHERE phone = ?", (phone,)) as cur:
        row = await cur.fetchone()

    if row:
        account_id = row["id"]
        await db.execute(
            """UPDATE accounts SET api_id=?, api_hash=?, first_name=?, last_name=?, username=?,
                 status='active', is_spam_blocked=0 WHERE id=?""",
            (DEFAULT_API_ID, DEFAULT_API_HASH, first_name, last_name, username, account_id)
        )
    else:
        async with db.execute(
            """INSERT INTO accounts (phone, api_id, api_hash, first_name, last_name, username, session_name, status)
               VALUES (?, ?, ?, ?, ?, ?, '', 'active')""",
            (phone, DEFAULT_API_ID, DEFAULT_API_HASH, first_name, last_name, username)
        ) as cur:
            account_id = cur.lastrowid
        await db.execute("UPDATE accounts SET session_name = ? WHERE id = ?", (str(account_id), account_id))

    # Авто-привязка рабочего прокси
    async with db.execute("SELECT proxy_id FROM accounts WHERE id = ?", (account_id,)) as cur:
        prow = await cur.fetchone()
    if prow and prow["proxy_id"] is None:
        auto_pid = await _pick_working_proxy(db)
        if auto_pid is not None:
            await db.execute("UPDATE accounts SET proxy_id = ? WHERE id = ?", (auto_pid, account_id))
    await db.commit()

    telegram_manager.save_session_string_as_sqlite(session_string, account_id, DEFAULT_API_ID, DEFAULT_API_HASH)
    await telegram_manager.load_session(account_id, DEFAULT_API_ID, DEFAULT_API_HASH)
    return account_id


@router.post("/import-bulk")
async def import_bulk(
    file: UploadFile = File(...),
    password: Optional[str] = None,
    db: aiosqlite.Connection = Depends(get_db)
):
    """
    Массовый импорт: один .zip архив с несколькими аккаунтами —
    любыми .session файлами и/или папками tdata внутри.
    """
    if not DEFAULT_API_ID or not DEFAULT_API_HASH:
        raise HTTPException(400, "TG_API_ID и TG_API_HASH не заданы в .env файле")

    import traceback

    content = await file.read()
    try:
        accounts, errors = await telegram_manager.parse_bulk_archive(
            content, DEFAULT_API_ID, DEFAULT_API_HASH, password
        )
    except Exception as e:
        logger.error("Ошибка разбора bulk-архива:\n" + traceback.format_exc())
        raise HTTPException(400, f"Не удалось прочитать архив: {e}")

    imported = []
    for phone, first_name, last_name, username, session_string, source in accounts:
        if not phone:
            phone = f"imported_{username or source}"
        try:
            acc_id = await _persist_imported_account(db, phone, first_name, last_name, username, session_string)
            imported.append({"account_id": acc_id, "phone": phone, "source": source})
        except Exception as e:
            logger.error(f"Ошибка сохранения аккаунта {source}:\n" + traceback.format_exc())
            errors.append(f"{source}: {e}")

    return {"ok": True, "imported": len(imported), "accounts": imported, "errors": errors}


# ─────────────────────────────────────────────────────
# CRUD
# ─────────────────────────────────────────────────────

@router.get("")
async def list_accounts(db: aiosqlite.Connection = Depends(get_db)):
    """Список всех аккаунтов."""
    async with db.execute("SELECT * FROM accounts ORDER BY created_at DESC") as cur:
        rows = await cur.fetchall()
    return [_row_to_account(r) for r in rows]


@router.get("/{account_id}")
async def get_account(account_id: int, db: aiosqlite.Connection = Depends(get_db)):
    """Получить один аккаунт."""
    async with db.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Аккаунт не найден")
    return _row_to_account(row)


@router.delete("/{account_id}")
async def delete_account(account_id: int, db: aiosqlite.Connection = Depends(get_db)):
    """Удалить аккаунт (отключает клиента и удаляет сессию)."""
    await telegram_manager.disconnect(account_id)

    # Удаляем файл сессии
    from config import SESSIONS_DIR
    session_file = SESSIONS_DIR / f"{account_id}.session"
    if session_file.exists():
        session_file.unlink()

    await db.execute("DELETE FROM accounts WHERE id = ?", (account_id,))
    await db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────
# Профиль
# ─────────────────────────────────────────────────────

@router.put("/{account_id}/profile")
async def update_profile(
    account_id: int, body: AccountProfileUpdate,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Обновить имя/фамилию/юзернейм/биографию в Telegram и в БД."""
    try:
        await telegram_manager.update_profile(
            account_id,
            first_name=body.first_name,
            last_name=body.last_name,
            bio=body.bio,
        )
        if body.username is not None:
            await telegram_manager.update_username(account_id, body.username)
    except Exception as e:
        raise HTTPException(400, str(e))

    # Обновляем локальную БД
    updates, vals = [], []
    for field in ["first_name", "last_name", "username", "bio"]:
        val = getattr(body, field)
        if val is not None:
            updates.append(f"{field} = ?")
            vals.append(val)
    if updates:
        vals.append(account_id)
        await db.execute(f"UPDATE accounts SET {', '.join(updates)} WHERE id = ?", vals)
        await db.commit()

    return {"ok": True}


class AccountProxyUpdate(BaseModel):
    proxy_id: Optional[int] = None


@router.put("/{account_id}/proxy")
async def update_account_proxy(
    account_id: int, body: AccountProxyUpdate,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Обновить привязанный прокси для аккаунта."""
    async with db.execute("SELECT id FROM accounts WHERE id = ?", (account_id,)) as cur:
        exists = await cur.fetchone()
    if not exists:
        raise HTTPException(404, "Аккаунт не найден")

    await db.execute("UPDATE accounts SET proxy_id = ? WHERE id = ?", (body.proxy_id, account_id))
    await db.commit()
    return {"ok": True}


class ProxyDistributeBody(BaseModel):
    only_missing: bool = False   # True — только аккаунтам без прокси
    proxy_id: Optional[int] = None  # если задан — назначить этот прокси всем


@router.post("/proxy/distribute")
async def distribute_proxies(
    body: ProxyDistributeBody = ProxyDistributeBody(),
    db: aiosqlite.Connection = Depends(get_db)
):
    """
    Раздать прокси всем аккаунтам сразу.
    Если proxy_id задан — назначает его всем. Иначе раскидывает
    рабочие прокси из списка по кругу (round-robin).
    """
    # Список аккаунтов
    if body.only_missing:
        query = "SELECT id FROM accounts WHERE proxy_id IS NULL ORDER BY id ASC"
    else:
        query = "SELECT id FROM accounts ORDER BY id ASC"
    async with db.execute(query) as cur:
        accounts = [r["id"] for r in await cur.fetchall()]

    if not accounts:
        return {"ok": True, "assigned": 0, "detail": "Нет аккаунтов для назначения"}

    # Одиночный прокси для всех
    if body.proxy_id is not None:
        async with db.execute(
            "SELECT id FROM proxies WHERE id = ?", (body.proxy_id,)
        ) as cur:
            if not await cur.fetchone():
                raise HTTPException(404, "Прокси не найден")
        for aid in accounts:
            await db.execute("UPDATE accounts SET proxy_id = ? WHERE id = ?", (body.proxy_id, aid))
        await db.commit()
        return {"ok": True, "assigned": len(accounts)}

    # Round-robin по рабочим прокси
    async with db.execute(
        "SELECT id FROM proxies WHERE is_active = 1 AND status = 'working' ORDER BY id ASC"
    ) as cur:
        proxies = [r["id"] for r in await cur.fetchall()]

    if not proxies:
        raise HTTPException(400, "Нет рабочих прокси для раздачи")

    for i, aid in enumerate(accounts):
        pid = proxies[i % len(proxies)]
        await db.execute("UPDATE accounts SET proxy_id = ? WHERE id = ?", (pid, aid))
    await db.commit()
    return {"ok": True, "assigned": len(accounts), "proxies_used": len(proxies)}


@router.post("/spam-check-all")
async def spam_check_all(db: aiosqlite.Connection = Depends(get_db)):
    """Проверить спам-блок сразу для всех аккаунтов."""
    results = await check_all_accounts(db)
    return {"ok": True, "results": results, "total": len(results)}


@router.post("/{account_id}/avatar")
async def upload_avatar(
    account_id: int, file: UploadFile = File(...),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Загрузить и установить аватар аккаунта."""
    ext = Path(file.filename).suffix
    save_path = UPLOADS_DIR / f"avatar_{account_id}{ext}"
    content = await file.read()
    save_path.write_bytes(content)

    try:
        await telegram_manager.upload_avatar(account_id, str(save_path))
    except Exception as e:
        raise HTTPException(400, str(e))

    await db.execute("UPDATE accounts SET avatar_path = ? WHERE id = ?", (str(save_path), account_id))
    await db.commit()
    return {"ok": True, "avatar_path": str(save_path)}


# ─────────────────────────────────────────────────────
# Автоответчик
# ─────────────────────────────────────────────────────

@router.put("/{account_id}/autoresponder")
async def update_autoresponder(
    account_id: int, body: AutoResponderUpdate,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Обновить и применить настройки автоответчика."""
    keywords_json = json.dumps(body.keywords, ensure_ascii=False)
    await db.execute(
        """UPDATE accounts SET
             autoresponder_enabled=?, autoresponder_message=?,
             autoresponder_delay=?, autoresponder_keywords=?
           WHERE id=?""",
        (int(body.enabled), body.message, body.delay, keywords_json, account_id)
    )
    await db.commit()

    # Применяем немедленно
    if body.enabled:
        await auto_responder.enable(account_id, body.message, body.delay, body.keywords)
    else:
        await auto_responder.disable(account_id)

    return {"ok": True}


# ─────────────────────────────────────────────────────
# Спам-чек
# ─────────────────────────────────────────────────────

@router.post("/{account_id}/spam-check")
async def manual_spam_check(account_id: int, db: aiosqlite.Connection = Depends(get_db)):
    """Запустить ручную проверку спам-блока."""
    result = await check_account(account_id, db)
    return {"ok": True, **result}


@router.get("/{account_id}/spam-history")
async def get_spam_history(account_id: int, db: aiosqlite.Connection = Depends(get_db)):
    """История проверок аккаунта на спам."""
    async with db.execute(
        "SELECT * FROM spam_checks WHERE account_id = ? ORDER BY checked_at DESC LIMIT 50",
        (account_id,)
    ) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


# ─────────────────────────────────────────────────────
# Подключение
# ─────────────────────────────────────────────────────

@router.post("/{account_id}/connect")
async def connect_account(account_id: int, db: aiosqlite.Connection = Depends(get_db)):
    """Переподключить аккаунт (восстановить сессию из файла)."""
    async with db.execute("SELECT * FROM accounts WHERE id = ?", (account_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Аккаунт не найден")

    ok = await telegram_manager.load_session(account_id, row["api_id"], row["api_hash"])
    if ok:
        await db.execute("UPDATE accounts SET status = 'active' WHERE id = ?", (account_id,))
        await db.commit()

        # Восстанавливаем автоответчик если был включён
        if row["autoresponder_enabled"]:
            keywords = json.loads(row["autoresponder_keywords"] or "[]")
            await auto_responder.enable(
                account_id, row["autoresponder_message"],
                row["autoresponder_delay"], keywords
            )
    else:
        # Подключение не удалось — аккаунт "дохлый", помечаем статусом error.
        # (Спам-блок не трогаем — его определяет отдельная проверка.)
        await db.execute(
            "UPDATE accounts SET status = 'error' WHERE id = ? AND status != 'spam_blocked'",
            (account_id,)
        )
        await db.commit()

    error = None if ok else telegram_manager.get_last_error(account_id)
    return {"ok": ok, "connected": ok, "error": error}


# ─────────────────────────────────────────────────────
# Диалоги и сообщения (Live Chats)
# ─────────────────────────────────────────────────────

@router.get("/{account_id}/chats")
async def get_account_chats(account_id: int):
    """Список последних диалогов для аккаунта."""
    try:
        chats = await telegram_manager.get_chats(account_id)
        return {"ok": True, "chats": chats}
    except Exception as e:
        raise HTTPException(400, str(e))


@router.get("/{account_id}/chats/{chat_id}/messages")
async def get_account_chat_messages(account_id: int, chat_id: int):
    """Список сообщений в диалоге."""
    try:
        messages = await telegram_manager.get_chat_messages(account_id, chat_id)
        return {"ok": True, "messages": messages}
    except Exception as e:
        raise HTTPException(400, str(e))


class SendMessageBody(BaseModel):
    text: str


@router.post("/{account_id}/chats/{chat_id}/send")
async def send_account_chat_message(account_id: int, chat_id: int, body: SendMessageBody):
    """Отправить сообщение от лица аккаунта в указанный чат."""
    try:
        await telegram_manager.send_chat_message(account_id, chat_id, body.text)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(400, str(e))


@router.get("/{account_id}/chats/{chat_id}/messages/{message_id}/media")
async def get_message_media(account_id: int, chat_id: int, message_id: int):
    """Скачать и получить URL медиа-файла сообщения."""
    try:
        url = await telegram_manager.download_message_media(account_id, chat_id, message_id)
        return {"ok": True, "url": url}
    except Exception as e:
        raise HTTPException(400, str(e))


# ─────────────────────────────────────────────────────
# Управление группами и автоматическим вступлением
# ─────────────────────────────────────────────────────

class LinksInput(BaseModel):
    links: str


class StartJoinsBody(BaseModel):
    delay_min: int = 30
    delay_max: int = 60


@router.get("/{account_id}/groups")
async def get_account_groups(account_id: int):
    """Список групп и каналов, в которых состоит аккаунт."""
    try:
        groups = await telegram_manager.get_groups(account_id)
        return {"ok": True, "groups": groups}
    except Exception as e:
        raise HTTPException(400, str(e))


@router.post("/{account_id}/groups/leave")
async def leave_account_group(account_id: int, chat_id: int):
    """Выйти из конкретной группы."""
    try:
        await telegram_manager.leave_group(account_id, chat_id)
        return {"ok": True}
    except Exception as e:
        raise HTTPException(400, str(e))


@router.post("/{account_id}/groups/leave-all")
async def leave_all_account_groups(account_id: int):
    """Выйти из всех групп."""
    try:
        left = await telegram_manager.leave_all_groups(account_id)
        return {"ok": True, "left": left}
    except Exception as e:
        raise HTTPException(400, str(e))


@router.get("/{account_id}/joins")
async def get_account_joins(account_id: int, db: aiosqlite.Connection = Depends(get_db)):
    """Индивидуальная очередь вступления аккаунта."""
    async with db.execute(
        "SELECT * FROM account_joins WHERE account_id = ? ORDER BY id ASC", (account_id,)
    ) as cur:
        rows = await cur.fetchall()
    
    from services.join_runner import is_running
    return {
        "ok": True,
        "joins": [dict(r) for r in rows],
        "is_running": is_running(account_id)
    }


@router.post("/{account_id}/joins")
async def add_account_joins(account_id: int, body: LinksInput, db: aiosqlite.Connection = Depends(get_db)):
    """Добавить ссылки в индивидуальную очередь вступления аккаунта."""
    raw_links = [line.strip() for line in body.links.split("\n") if line.strip()]
    if not raw_links:
        raise HTTPException(400, "Список ссылок пуст")

    from services.join_runner import resolve_folder_links
    links = []
    for link in raw_links:
        resolved = await resolve_folder_links(link)
        links.extend(resolved)

    added = 0
    for link in links:
        # Проверяем на дубликаты у этого аккаунта
        async with db.execute(
            "SELECT id FROM account_joins WHERE account_id = ? AND chat_link = ?", (account_id, link)
        ) as cur:
            if not await cur.fetchone():
                await db.execute(
                    "INSERT INTO account_joins (account_id, chat_link) VALUES (?, ?)", (account_id, link)
                )
                added += 1
    await db.commit()

    # Авто-запуск воркера, чтобы очередь проходилась сама.
    from services.join_runner import start_joins, is_running
    started = False
    if added and not is_running(account_id):
        started = start_joins(account_id)

    return {"ok": True, "added": added, "started": started}


@router.delete("/{account_id}/joins")
async def clear_account_joins(account_id: int, db: aiosqlite.Connection = Depends(get_db)):
    """Очистить индивидуальную очередь вступления аккаунта."""
    await db.execute("DELETE FROM account_joins WHERE account_id = ?", (account_id,))
    await db.commit()
    return {"ok": True}


@router.post("/{account_id}/joins/start")
async def start_account_joins(account_id: int, body: StartJoinsBody):
    """Запустить авто-вступление для аккаунта."""
    from services.join_runner import start_joins
    ok = start_joins(account_id, body.delay_min, body.delay_max)
    return {"ok": ok}


@router.post("/{account_id}/joins/stop")
async def stop_account_joins(account_id: int):
    """Остановить авто-вступление для аккаунта."""
    from services.join_runner import stop_joins
    ok = stop_joins(account_id)
    return {"ok": ok}


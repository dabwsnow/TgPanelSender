"""routers/proxies.py — управление прокси в панели."""
import asyncio
import aiosqlite
import logging
from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException

from pydantic import BaseModel
from database import get_db
from models.proxy import ProxyCreate, ProxyUpdate, ProxyOut

router = APIRouter(prefix="/api/proxies", tags=["proxies"])
logger = logging.getLogger(__name__)

# Несколько стабильных целей: прокси считается рабочим, если достучались хотя бы до одной.
# (Раньше проверялся один хардкод-IP Telegram — рабочие прокси ложно падали в 'dead'.)
_TEST_TARGETS = [
    ("149.154.167.50", 443),   # Telegram DC
    ("91.108.56.130", 443),    # Telegram DC
    ("1.1.1.1", 443),          # Cloudflare
    ("8.8.8.8", 443),          # Google DNS
]
_TEST_TIMEOUT = 8.0


def test_proxy_connection(host: str, port: int, protocol: str,
                          username: Optional[str], password: Optional[str]) -> tuple[bool, Optional[str]]:
    """Синхронная проверка. Вызывать через asyncio.to_thread, чтобы не блокировать event loop."""
    import socks
    ptype = socks.SOCKS5 if str(protocol).lower() == "socks5" else socks.HTTP
    last_err = None
    for target in _TEST_TARGETS:
        try:
            s = socks.socksocket()
            s.set_proxy(ptype, host, int(port),
                        username=username or None, password=password or None)
            s.settimeout(_TEST_TIMEOUT)
            s.connect(target)
            s.close()
            return True, None
        except Exception as e:
            last_err = str(e)
            try:
                s.close()
            except Exception:
                pass
    return False, last_err or "Connection failed"


async def _test_proxy_async(host: str, port: int, protocol: str,
                            username: Optional[str], password: Optional[str]) -> tuple[bool, Optional[str]]:
    """Асинхронная обёртка — тест выполняется в пуле потоков."""
    try:
        return await asyncio.to_thread(test_proxy_connection, host, port, protocol, username, password)
    except Exception as e:
        return False, str(e)


@router.get("", response_model=List[ProxyOut])
async def list_proxies(db: aiosqlite.Connection = Depends(get_db)):
    """Получить список всех прокси."""
    async with db.execute("SELECT * FROM proxies ORDER BY id DESC") as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


@router.post("", response_model=ProxyOut)
async def create_proxy(body: ProxyCreate, db: aiosqlite.Connection = Depends(get_db)):
    """Добавить новый прокси."""
    # Быстрая проверка при добавлении (в пуле потоков, чтобы не блокировать сервер)
    working, err = await _test_proxy_async(body.host, body.port, body.protocol, body.username, body.password)
    status = "working" if working else "dead"
    err_msg = None if working else (err or "Connection timeout")
    now = datetime.now().isoformat()

    async with db.execute(
        """INSERT INTO proxies (host, port, protocol, username, password, is_active, status, error_message, last_check_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (body.host, body.port, body.protocol, body.username, body.password,
         1 if body.is_active else 0, status, err_msg, now)
    ) as cur:
        proxy_id = cur.lastrowid
    await db.commit()

    async with db.execute("SELECT * FROM proxies WHERE id = ?", (proxy_id,)) as cur:
        row = await cur.fetchone()
    return dict(row)


@router.put("/{proxy_id}", response_model=ProxyOut)
async def update_proxy(proxy_id: int, body: ProxyUpdate, db: aiosqlite.Connection = Depends(get_db)):
    """Обновить настройки прокси."""
    async with db.execute("SELECT * FROM proxies WHERE id = ?", (proxy_id,)) as cur:
        existing = await cur.fetchone()
    if not existing:
        raise HTTPException(404, "Прокси не найден")

    updates, vals = [], []
    for field in ["host", "port", "protocol", "username", "password", "is_active"]:
        val = getattr(body, field)
        if val is not None:
            if field == "is_active":
                val = 1 if val else 0
            updates.append(f"{field} = ?")
            vals.append(val)

    if updates:
        vals.append(proxy_id)
        await db.execute(f"UPDATE proxies SET {', '.join(updates)} WHERE id = ?", vals)
        await db.commit()

    async with db.execute("SELECT * FROM proxies WHERE id = ?", (proxy_id,)) as cur:
        row = await cur.fetchone()
    return dict(row)


@router.delete("/{proxy_id}")
async def delete_proxy(proxy_id: int, db: aiosqlite.Connection = Depends(get_db)):
    """Удалить прокси из системы."""
    # Убираем ссылки на этот прокси у аккаунтов
    await db.execute("UPDATE accounts SET proxy_id = NULL WHERE proxy_id = ?", (proxy_id,))
    await db.execute("DELETE FROM proxies WHERE id = ?", (proxy_id,))
    await db.commit()
    return {"ok": True}


@router.post("/{proxy_id}/test")
async def test_proxy(proxy_id: int, db: aiosqlite.Connection = Depends(get_db)):
    """Проверить работоспособность прокси."""
    async with db.execute("SELECT * FROM proxies WHERE id = ?", (proxy_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Прокси не найден")

    working, err = await _test_proxy_async(row["host"], row["port"], row["protocol"], row["username"], row["password"])
    status = "working" if working else "dead"
    err_msg = None if working else (err or "Connection timeout")
    now = datetime.now().isoformat()

    await db.execute(
        "UPDATE proxies SET status = ?, error_message = ?, last_check_at = ? WHERE id = ?",
        (status, err_msg, now, proxy_id)
    )
    await db.commit()

    return {"ok": True, "status": status, "error_message": err_msg}


class ProxyBulkImport(BaseModel):
    proxies: List[ProxyCreate]


@router.post("/bulk")
async def bulk_import_proxies(body: ProxyBulkImport, db: aiosqlite.Connection = Depends(get_db)):
    """
    Массовый импорт прокси. Сначала добавляем ВСЕ прокси (со статусом 'checking'),
    затем проверяем их параллельно — так добавление не подвисает и ничего не теряется.
    """
    now = datetime.now().isoformat()

    # 1. Вставляем все — добавление гарантированно проходит
    ids = []
    for p in body.proxies:
        async with db.execute(
            """INSERT INTO proxies (host, port, protocol, username, password, is_active, status, error_message, last_check_at)
               VALUES (?, ?, ?, ?, ?, ?, 'checking', NULL, ?)""",
            (p.host, p.port, p.protocol, p.username, p.password,
             1 if p.is_active else 0, now)
        ) as cur:
            ids.append((cur.lastrowid, p))
    await db.commit()

    # 2. Проверяем параллельно (в пуле потоков), с ограничением одновременности
    sem = asyncio.Semaphore(20)

    async def check(pid, p):
        async with sem:
            return pid, await _test_proxy_async(p.host, p.port, p.protocol, p.username, p.password)

    results = await asyncio.gather(*(check(pid, p) for pid, p in ids), return_exceptions=True)

    working_count = 0
    now2 = datetime.now().isoformat()
    for res in results:
        if isinstance(res, Exception):
            continue
        pid, (working, err) = res
        status = "working" if working else "dead"
        if working:
            working_count += 1
        await db.execute(
            "UPDATE proxies SET status = ?, error_message = ?, last_check_at = ? WHERE id = ?",
            (status, None if working else (err or "Connection failed"), now2, pid)
        )
    await db.commit()
    return {"ok": True, "added": len(ids), "working": working_count}

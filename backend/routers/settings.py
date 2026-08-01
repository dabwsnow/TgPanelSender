"""
routers/settings.py — настройки приложения.

  GET  /api/settings      — все настройки
  PUT  /api/settings      — обновить одну или несколько настроек
  GET  /api/settings/stats — общая статистика дашборда
"""
import aiosqlite
from fastapi import APIRouter, Depends

from database import get_db

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("")
async def get_settings(db: aiosqlite.Connection = Depends(get_db)):
    async with db.execute("SELECT key, value FROM settings") as cur:
        rows = await cur.fetchall()
    return {r["key"]: r["value"] for r in rows}


@router.put("")
async def update_settings(body: dict, db: aiosqlite.Connection = Depends(get_db)):
    for key, value in body.items():
        await db.execute(
            "INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=?",
            (key, str(value), str(value))
        )
    await db.commit()
    return {"ok": True}


@router.get("/stats")
async def get_stats(db: aiosqlite.Connection = Depends(get_db)):
    """Статистика для дашборда."""
    async with db.execute("SELECT COUNT(*) as total FROM accounts") as cur:
        total_accounts = (await cur.fetchone())["total"]

    async with db.execute(
        "SELECT COUNT(*) as total FROM accounts WHERE status = 'active'"
    ) as cur:
        active_accounts = (await cur.fetchone())["total"]

    async with db.execute(
        "SELECT COUNT(*) as total FROM accounts WHERE is_spam_blocked = 1"
    ) as cur:
        blocked_accounts = (await cur.fetchone())["total"]

    async with db.execute("SELECT COUNT(*) as total FROM campaigns") as cur:
        total_campaigns = (await cur.fetchone())["total"]

    async with db.execute(
        "SELECT COUNT(*) as total FROM campaigns WHERE status = 'running'"
    ) as cur:
        running_campaigns = (await cur.fetchone())["total"]

    async with db.execute(
        "SELECT COALESCE(SUM(messages_sent), 0) as total FROM accounts"
    ) as cur:
        total_sent = (await cur.fetchone())["total"]

    async with db.execute(
        "SELECT COALESCE(SUM(messages_today), 0) as total FROM accounts"
    ) as cur:
        sent_today = (await cur.fetchone())["total"]

    async with db.execute("SELECT COUNT(*) as total FROM templates") as cur:
        total_templates = (await cur.fetchone())["total"]

    return {
        "accounts": {
            "total": total_accounts,
            "active": active_accounts,
            "spam_blocked": blocked_accounts,
            "inactive": total_accounts - active_accounts - blocked_accounts,
        },
        "campaigns": {
            "total": total_campaigns,
            "running": running_campaigns,
        },
        "messages": {
            "total_sent": total_sent,
            "sent_today": sent_today,
        },
        "templates": {
            "total": total_templates,
        },
    }

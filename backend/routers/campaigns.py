"""
routers/campaigns.py — управление кампаниями рассылки.

  GET    /api/campaigns                     — список кампаний
  POST   /api/campaigns                     — создать кампанию
  GET    /api/campaigns/{id}                — получить кампанию
  PUT    /api/campaigns/{id}                — обновить кампанию (только в статусе draft)
  DELETE /api/campaigns/{id}                — удалить кампанию
  POST   /api/campaigns/{id}/start         — запустить кампанию
  POST   /api/campaigns/{id}/stop          — остановить кампанию
  POST   /api/campaigns/{id}/pause         — поставить на паузу
  POST   /api/campaigns/{id}/recipients    — добавить получателей
  POST   /api/campaigns/{id}/recipients/upload — загрузить список из файла
  GET    /api/campaigns/{id}/recipients    — список получателей
  DELETE /api/campaigns/{id}/recipients/{rid} — удалить получателя
  GET    /api/campaigns/{id}/stats         — статистика кампании
"""
import io
import json

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from database import get_db
from models import CampaignCreate, CampaignUpdate, RecipientAdd
from services import campaign_runner

router = APIRouter(prefix="/api/campaigns", tags=["campaigns"])


async def _get_campaign_or_404(campaign_id: int, db: aiosqlite.Connection):
    async with db.execute(
        """SELECT c.*, t.name as template_name
           FROM campaigns c LEFT JOIN templates t ON t.id = c.template_id
           WHERE c.id = ?""",
        (campaign_id,)
    ) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Кампания не найдена")
    return row


async def _enrich_campaign(row, db: aiosqlite.Connection) -> dict:
    """Добавляет account_ids и recipient_count к данным кампании."""
    d = dict(row)
    campaign_id = d["id"]

    async with db.execute(
        "SELECT account_id FROM campaign_accounts WHERE campaign_id = ?", (campaign_id,)
    ) as cur:
        account_rows = await cur.fetchall()
    d["account_ids"] = [r["account_id"] for r in account_rows]

    async with db.execute(
        "SELECT COUNT(*) as cnt FROM campaign_recipients WHERE campaign_id = ?", (campaign_id,)
    ) as cur:
        cnt_row = await cur.fetchone()
    d["recipient_count"] = cnt_row["cnt"] if cnt_row else 0
    d["is_running"] = campaign_runner.is_running(campaign_id)
    d["is_looped"] = bool(d.get("is_looped", 0))
    return d


@router.get("")
async def list_campaigns(db: aiosqlite.Connection = Depends(get_db)):
    async with db.execute(
        """SELECT c.*, t.name as template_name
           FROM campaigns c LEFT JOIN templates t ON t.id = c.template_id
           ORDER BY c.created_at DESC"""
    ) as cur:
        rows = await cur.fetchall()
    return [await _enrich_campaign(r, db) for r in rows]


@router.post("")
async def create_campaign(body: CampaignCreate, db: aiosqlite.Connection = Depends(get_db)):
    async with db.execute(
        """INSERT INTO campaigns
             (name, template_id, delay_min, delay_max, daily_limit, schedule_start, schedule_end, is_looped, loop_delay)
           VALUES (?,?,?,?,?,?,?,?,?)""",
        (body.name, body.template_id, body.delay_min, body.delay_max,
         body.daily_limit, body.schedule_start, body.schedule_end, int(body.is_looped), body.loop_delay)
    ) as cur:
        campaign_id = cur.lastrowid

    # Привязываем аккаунты
    for acc_id in body.account_ids:
        await db.execute(
            "INSERT OR IGNORE INTO campaign_accounts (campaign_id, account_id) VALUES (?,?)",
            (campaign_id, acc_id)
        )
    await db.commit()
    return {"ok": True, "id": campaign_id}


@router.get("/{campaign_id}")
async def get_campaign(campaign_id: int, db: aiosqlite.Connection = Depends(get_db)):
    row = await _get_campaign_or_404(campaign_id, db)
    return await _enrich_campaign(row, db)


@router.put("/{campaign_id}")
async def update_campaign(
    campaign_id: int, body: CampaignUpdate,
    db: aiosqlite.Connection = Depends(get_db)
):
    row = await _get_campaign_or_404(campaign_id, db)
    if row["status"] == "running":
        raise HTTPException(400, "Нельзя изменять запущенную кампанию")

    updates, vals = [], []
    for field in ["name", "template_id", "delay_min", "delay_max",
                  "daily_limit", "schedule_start", "schedule_end", "is_looped", "loop_delay"]:
        val = getattr(body, field)
        if val is not None:
            if field == "is_looped":
                val = int(val)
            updates.append(f"{field} = ?"); vals.append(val)

    if updates:
        vals.append(campaign_id)
        await db.execute(f"UPDATE campaigns SET {', '.join(updates)} WHERE id = ?", vals)

    if body.account_ids is not None:
        await db.execute("DELETE FROM campaign_accounts WHERE campaign_id = ?", (campaign_id,))
        for acc_id in body.account_ids:
            await db.execute(
                "INSERT INTO campaign_accounts (campaign_id, account_id) VALUES (?,?)",
                (campaign_id, acc_id)
            )

    await db.commit()
    return {"ok": True}


@router.delete("/{campaign_id}")
async def delete_campaign(campaign_id: int, db: aiosqlite.Connection = Depends(get_db)):
    campaign_runner.stop_campaign(campaign_id)
    await db.execute("DELETE FROM campaigns WHERE id = ?", (campaign_id,))
    await db.commit()
    return {"ok": True}


# ─────────────────────────────────────────────────────
# Управление выполнением
# ─────────────────────────────────────────────────────

@router.post("/{campaign_id}/start")
async def start_campaign(campaign_id: int, db: aiosqlite.Connection = Depends(get_db)):
    row = await _get_campaign_or_404(campaign_id, db)
    if row["status"] == "running" and campaign_runner.is_running(campaign_id):
        raise HTTPException(400, "Кампания уже запущена")

    ok = campaign_runner.start_campaign(campaign_id, db)
    return {"ok": ok}


@router.post("/{campaign_id}/stop")
async def stop_campaign(campaign_id: int, db: aiosqlite.Connection = Depends(get_db)):
    ok = campaign_runner.stop_campaign(campaign_id)
    if not ok:
        raise HTTPException(400, "Кампания не запущена")
    return {"ok": True}


@router.post("/{campaign_id}/pause")
async def pause_campaign(campaign_id: int, db: aiosqlite.Connection = Depends(get_db)):
    """Ставит на паузу (останавливает task, статус = paused)."""
    ok = campaign_runner.stop_campaign(campaign_id)
    await db.execute(
        "UPDATE campaigns SET status = 'paused' WHERE id = ? AND status = 'running'",
        (campaign_id,)
    )
    await db.commit()
    return {"ok": ok}


# ─────────────────────────────────────────────────────
# Получатели
# ─────────────────────────────────────────────────────

@router.post("/{campaign_id}/recipients")
async def add_recipients(
    campaign_id: int, body: RecipientAdd,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Добавить получателей вручную."""
    await _get_campaign_or_404(campaign_id, db)
    custom_json = json.dumps(body.custom_vars, ensure_ascii=False)
    added = 0
    for identifier in body.identifiers:
        identifier = identifier.strip()
        if not identifier:
            continue
        await db.execute(
            "INSERT INTO campaign_recipients (campaign_id, identifier, custom_vars) VALUES (?,?,?)",
            (campaign_id, identifier, custom_json)
        )
        added += 1
    await db.commit()
    return {"ok": True, "added": added}


class RecipientsFromAccount(BaseModel):
    account_id: int


@router.post("/{campaign_id}/recipients/from-account")
async def add_recipients_from_account(
    campaign_id: int, body: RecipientsFromAccount,
    db: aiosqlite.Connection = Depends(get_db)
):
    """
    Добавить в получатели чаты, в которых состоит аккаунт
    (в т.ч. вступленные через папки). Идентификатор — @username
    для публичных чатов, иначе числовой id диалога.
    """
    await _get_campaign_or_404(campaign_id, db)

    from services.telegram_service import telegram_manager

    # Поднимаем сессию при необходимости
    client = telegram_manager.get_client(body.account_id)
    if not client or not client.is_connected():
        async with db.execute(
            "SELECT api_id, api_hash FROM accounts WHERE id = ?", (body.account_id,)
        ) as cur:
            arow = await cur.fetchone()
        if not arow:
            raise HTTPException(404, "Аккаунт не найден")
        await telegram_manager.load_session(body.account_id, arow["api_id"], arow["api_hash"])

    try:
        groups = await telegram_manager.get_groups(body.account_id)
    except Exception as e:
        raise HTTPException(400, f"Не удалось получить чаты аккаунта: {e}")

    # Уже добавленные идентификаторы — чтобы не плодить дубли
    async with db.execute(
        "SELECT identifier FROM campaign_recipients WHERE campaign_id = ?", (campaign_id,)
    ) as cur:
        existing = {r["identifier"] for r in await cur.fetchall()}

    added = 0
    for g in groups:
        username = (g.get("username") or "").strip()
        identifier = f"@{username}" if username else str(g["id"])
        if identifier in existing:
            continue
        await db.execute(
            "INSERT INTO campaign_recipients (campaign_id, identifier) VALUES (?, ?)",
            (campaign_id, identifier)
        )
        existing.add(identifier)
        added += 1

    await db.commit()
    return {"ok": True, "added": added, "total_chats": len(groups)}


@router.post("/{campaign_id}/recipients/upload")
async def upload_recipients(
    campaign_id: int, file: UploadFile = File(...),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Загрузить список получателей из TXT/CSV файла (один на строку)."""
    await _get_campaign_or_404(campaign_id, db)
    content = (await file.read()).decode("utf-8", errors="ignore")
    lines = [l.strip() for l in content.splitlines() if l.strip()]

    added = 0
    for line in lines:
        # Поддержка CSV: берём первую колонку
        identifier = line.split(",")[0].strip().split(";")[0].strip()
        if not identifier:
            continue
        await db.execute(
            "INSERT INTO campaign_recipients (campaign_id, identifier) VALUES (?,?)",
            (campaign_id, identifier)
        )
        added += 1
    await db.commit()
    return {"ok": True, "added": added, "total_lines": len(lines)}


@router.get("/{campaign_id}/recipients")
async def get_recipients(
    campaign_id: int, status: str = None, limit: int = 100, offset: int = 0,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Список получателей кампании с фильтрацией по статусу."""
    if status:
        async with db.execute(
            "SELECT * FROM campaign_recipients WHERE campaign_id=? AND status=? LIMIT ? OFFSET ?",
            (campaign_id, status, limit, offset)
        ) as cur:
            rows = await cur.fetchall()
    else:
        async with db.execute(
            "SELECT * FROM campaign_recipients WHERE campaign_id=? LIMIT ? OFFSET ?",
            (campaign_id, limit, offset)
        ) as cur:
            rows = await cur.fetchall()
    return [dict(r) for r in rows]


@router.delete("/{campaign_id}/recipients/{recipient_id}")
async def delete_recipient(
    campaign_id: int, recipient_id: int,
    db: aiosqlite.Connection = Depends(get_db)
):
    await db.execute(
        "DELETE FROM campaign_recipients WHERE id=? AND campaign_id=?",
        (recipient_id, campaign_id)
    )
    await db.commit()
    return {"ok": True}


@router.get("/{campaign_id}/stats")
async def get_stats(campaign_id: int, db: aiosqlite.Connection = Depends(get_db)):
    """Детальная статистика кампании."""
    row = await _get_campaign_or_404(campaign_id, db)

    async with db.execute(
        """SELECT status, COUNT(*) as count
           FROM campaign_recipients WHERE campaign_id=? GROUP BY status""",
        (campaign_id,)
    ) as cur:
        status_rows = await cur.fetchall()

    stats = {r["status"]: r["count"] for r in status_rows}
    return {
        "campaign_id": campaign_id,
        "status": row["status"],
        "total_sent": row["total_sent"],
        "total_failed": row["total_failed"],
        "total_blocked": row["total_blocked"],
        "by_status": stats,
        "is_running": campaign_runner.is_running(campaign_id),
    }

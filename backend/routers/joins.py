"""
routers/joins.py — управление общей базой чатов и их распределением по аккаунтам.

  GET    /api/joins/global            — получить список общей базы чатов
  POST   /api/joins/global            — добавить ссылки в общую базу
  DELETE /api/joins/global            — очистить общую базу
  DELETE /api/joins/global/{id}       — удалить конкретную ссылку
  POST   /api/joins/global/distribute — распределить общую базу по аккаунтам
"""
import aiosqlite
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List

from database import get_db

router = APIRouter(prefix="/api/joins", tags=["joins"])


class LinksInput(BaseModel):
    links: str  # список ссылок через перенос строки


class DistributeInput(BaseModel):
    account_ids: List[int]
    mode: str  # "all" (всем одинаково) или "split" (разделить поровну)


@router.get("/global")
async def get_global_chats(db: aiosqlite.Connection = Depends(get_db)):
    """Список ссылок в общей базе. Для папок добавляем title и число чатов."""
    async with db.execute(
        """SELECT gc.*, f.title AS folder_title, f.chats_count AS folder_chats_count
             FROM global_chats gc
             LEFT JOIN folders f ON f.slug = gc.folder_slug
            ORDER BY gc.id DESC"""
    ) as cur:
        rows = await cur.fetchall()
    return [dict(r) for r in rows]


@router.post("/global")
async def add_global_chats(body: LinksInput, db: aiosqlite.Connection = Depends(get_db)):
    """
    Добавить ссылки в общую базу. Папки (t.me/addlist/...) сохраняются как папки
    целиком и их состав кэшируется для отображения.
    """
    raw_links = [line.strip() for line in body.links.split("\n") if line.strip()]
    if not raw_links:
        raise HTTPException(400, "Список ссылок пуст")

    from services.join_runner import parse_chat_link, cache_folder

    added = 0
    folders_read = 0
    for link in raw_links:
        link_type, slug = parse_chat_link(link)
        is_folder = 1 if link_type == 'folder' else 0
        try:
            await db.execute(
                "INSERT INTO global_chats (chat_link, is_folder, folder_slug) VALUES (?, ?, ?)",
                (link, is_folder, slug if is_folder else None)
            )
            added += 1
        except aiosqlite.IntegrityError:
            pass  # Ссылка уже была в базе — пропускаем

        # Для папки подтягиваем и кэшируем состав
        if is_folder:
            data = await cache_folder(db, link)
            if data:
                folders_read += 1

    await db.commit()
    return {"ok": True, "added": added, "total": len(raw_links), "folders_read": folders_read}


@router.get("/folders/{slug}/chats")
async def get_folder_chats(slug: str, db: aiosqlite.Connection = Depends(get_db)):
    """Закэшированный список чатов внутри папки."""
    async with db.execute("SELECT * FROM folders WHERE slug = ?", (slug,)) as cur:
        folder = await cur.fetchone()
    async with db.execute(
        "SELECT * FROM folder_chats WHERE slug = ? ORDER BY id ASC", (slug,)
    ) as cur:
        chats = await cur.fetchall()
    return {
        "ok": True,
        "folder": dict(folder) if folder else None,
        "chats": [dict(c) for c in chats],
    }


class FolderInfoInput(BaseModel):
    link: str


@router.post("/folders/refresh")
async def refresh_folder(body: FolderInfoInput, db: aiosqlite.Connection = Depends(get_db)):
    """Перечитать состав папки из Telegram и обновить кэш."""
    from services.join_runner import parse_chat_link, cache_folder
    link_type, slug = parse_chat_link(body.link)
    if link_type != 'folder':
        raise HTTPException(400, "Это не ссылка на папку (t.me/addlist/...)")
    data = await cache_folder(db, body.link)
    if not data:
        raise HTTPException(400, "Не удалось прочитать папку. Нужен подключённый аккаунт.")
    return {"ok": True, **data}


@router.delete("/global")
async def clear_global_chats(db: aiosqlite.Connection = Depends(get_db)):
    """Очистить всю общую базу, а также убрать её ссылки из очередей аккаунтов."""
    # Ссылки, которые сейчас в базе — их же чистим из очередей
    await db.execute(
        "DELETE FROM account_joins WHERE chat_link IN (SELECT chat_link FROM global_chats)"
    )
    await db.execute("DELETE FROM folder_chats")
    await db.execute("DELETE FROM folders")
    await db.execute("DELETE FROM global_chats")
    await db.commit()
    return {"ok": True}


@router.delete("/global/{chat_id}")
async def delete_global_chat(chat_id: int, db: aiosqlite.Connection = Depends(get_db)):
    """
    Удалить ссылку из общей базы И из очередей всех аккаунтов,
    чтобы она пропала везде (в т.ч. в мониторинге вступлений).
    Для папки чистим и кэш её состава.
    """
    async with db.execute("SELECT chat_link, folder_slug FROM global_chats WHERE id = ?", (chat_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        return {"ok": True, "removed_from_queues": 0}

    link = row["chat_link"]
    slug = row["folder_slug"]

    # Убираем из очередей всех аккаунтов
    async with db.execute("SELECT COUNT(*) AS n FROM account_joins WHERE chat_link = ?", (link,)) as cur:
        removed = (await cur.fetchone())["n"]
    await db.execute("DELETE FROM account_joins WHERE chat_link = ?", (link,))

    # Чистим кэш папки
    if slug:
        await db.execute("DELETE FROM folder_chats WHERE slug = ?", (slug,))
        await db.execute("DELETE FROM folders WHERE slug = ?", (slug,))

    await db.execute("DELETE FROM global_chats WHERE id = ?", (chat_id,))
    await db.commit()
    return {"ok": True, "removed_from_queues": removed}


@router.post("/global/distribute")
async def distribute_global_chats(body: DistributeInput, db: aiosqlite.Connection = Depends(get_db)):
    """Распределить ссылки из общей базы по очередям вступления аккаунтов."""
    if not body.account_ids:
        raise HTTPException(400, "Не выбрано ни одного аккаунта")

    # Получаем все ссылки из общей базы
    async with db.execute("SELECT chat_link FROM global_chats") as cur:
        rows = await cur.fetchall()
    links = [r["chat_link"] for r in rows]

    if not links:
        raise HTTPException(400, "Общая база чатов пуста")

    # Сначала проверяем, что все аккаунты существуют
    for acc_id in body.account_ids:
        async with db.execute("SELECT id FROM accounts WHERE id = ?", (acc_id,)) as cur:
            if not await cur.fetchone():
                raise HTTPException(400, f"Аккаунт с ID {acc_id} не найден")

    added_count = 0

    if body.mode == "all":
        # Копируем весь список каждому аккаунту
        for acc_id in body.account_ids:
            for link in links:
                # Проверяем, нет ли уже этой ссылки в очереди у данного аккаунта
                async with db.execute(
                    "SELECT id FROM account_joins WHERE account_id = ? AND chat_link = ?",
                    (acc_id, link)
                ) as cur:
                    if not await cur.fetchone():
                        await db.execute(
                            "INSERT INTO account_joins (account_id, chat_link) VALUES (?, ?)",
                            (acc_id, link)
                        )
                        added_count += 1
    elif body.mode == "split":
        # Распределяем ссылки поровну
        for i, link in enumerate(links):
            acc_id = body.account_ids[i % len(body.account_ids)]
            # Проверяем на дубликат
            async with db.execute(
                "SELECT id FROM account_joins WHERE account_id = ? AND chat_link = ?",
                (acc_id, link)
            ) as cur:
                if not await cur.fetchone():
                    await db.execute(
                        "INSERT INTO account_joins (account_id, chat_link) VALUES (?, ?)",
                        (acc_id, link)
                    )
                    added_count += 1
    else:
        raise HTTPException(400, f"Неизвестный режим распределения: {body.mode}")

    await db.commit()

    # Авто-запуск воркеров у аккаунтов, которым что-то добавили, —
    # чтобы очередь проходилась дальше сама, без ручного «Запустить».
    started = []
    from services.join_runner import start_joins, is_running
    for acc_id in body.account_ids:
        async with db.execute(
            "SELECT 1 FROM account_joins WHERE account_id = ? AND status = 'pending' LIMIT 1",
            (acc_id,)
        ) as cur:
            has_pending = await cur.fetchone()
        if has_pending and not is_running(acc_id):
            if start_joins(acc_id):
                started.append(acc_id)

    return {"ok": True, "distributed": added_count, "mode": body.mode, "started": started}

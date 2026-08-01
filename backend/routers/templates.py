"""
routers/templates.py — CRUD для шаблонов сообщений.

  GET    /api/templates          — список всех шаблонов
  POST   /api/templates          — создать шаблон
  GET    /api/templates/{id}     — получить шаблон
  PUT    /api/templates/{id}     — обновить шаблон
  DELETE /api/templates/{id}     — удалить шаблон
  POST   /api/templates/{id}/media — загрузить медиа-файл
  DELETE /api/templates/{id}/media — удалить медиа-файл
  POST   /api/templates/preview  — предпросмотр шаблона с переменными
"""
import re
import uuid
from pathlib import Path
from typing import Optional

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from pydantic import BaseModel

from database import get_db
from models import TemplateCreate, TemplateUpdate
from config import UPLOADS_DIR

router = APIRouter(prefix="/api/templates", tags=["templates"])

# Разрешённые MIME-типы медиа (любой файл принимается через catch-all)
MIME_TO_TYPE: dict[str, str] = {
    # Фото
    "image/jpeg":       "photo",
    "image/png":        "photo",
    "image/gif":        "photo",
    "image/webp":       "photo",
    # Видео
    "video/mp4":        "video",
    "video/quicktime":  "video",
    "video/x-msvideo":  "video",
    "video/webm":       "video",
    # Аудио
    "audio/mpeg":       "audio",
    "audio/ogg":        "audio",
    "audio/wav":        "audio",
    "audio/mp4":        "audio",
}

MIME_EXTENSIONS: dict[str, str] = {
    "image/jpeg":       ".jpg",
    "image/png":        ".png",
    "image/gif":        ".gif",
    "image/webp":       ".webp",
    "video/mp4":        ".mp4",
    "video/quicktime":  ".mov",
    "video/x-msvideo":  ".avi",
    "video/webm":       ".webm",
    "audio/mpeg":       ".mp3",
    "audio/ogg":        ".ogg",
    "audio/wav":        ".wav",
    "audio/mp4":        ".m4a",
}


def _media_type_for(mime: str) -> str:
    return MIME_TO_TYPE.get(mime, "document")


def _ext_for(mime: str, original_filename: str) -> str:
    if mime in MIME_EXTENSIONS:
        return MIME_EXTENSIONS[mime]
    suffix = Path(original_filename).suffix
    return suffix if suffix else ".bin"


def _make_media_url(filename: str) -> str:
    return f"/uploads/{filename}"


def _extract_variables(content: str) -> list[str]:
    """Находит переменные вида {name} в тексте шаблона."""
    return list(set(re.findall(r"\{(\w+)\}", content)))


def _row_to_dict(row) -> dict:
    d = dict(row)
    # Добавить публичный URL для медиа, если есть путь
    if d.get("media_path") and not d.get("media_url"):
        p = Path(d["media_path"])
        d["media_url"] = f"/uploads/{p.name}"
    return d


@router.get("")
async def list_templates(db: aiosqlite.Connection = Depends(get_db)):
    async with db.execute("SELECT * FROM templates ORDER BY created_at DESC") as cur:
        rows = await cur.fetchall()
    return [_row_to_dict(r) for r in rows]


@router.post("")
async def create_template(body: TemplateCreate, db: aiosqlite.Connection = Depends(get_db)):
    async with db.execute(
        "INSERT INTO templates (name, content, parse_mode) VALUES (?, ?, ?)",
        (body.name, body.content, body.parse_mode or "markdown")
    ) as cur:
        template_id = cur.lastrowid
    await db.commit()
    return {"ok": True, "id": template_id}


@router.get("/{template_id}")
async def get_template(template_id: int, db: aiosqlite.Connection = Depends(get_db)):
    async with db.execute("SELECT * FROM templates WHERE id = ?", (template_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Шаблон не найден")
    result = _row_to_dict(row)
    result["variables"] = _extract_variables(result.get("content", ""))
    return result


@router.put("/{template_id}")
async def update_template(
    template_id: int, body: TemplateUpdate,
    db: aiosqlite.Connection = Depends(get_db)
):
    updates, vals = [], []
    if body.name is not None:
        updates.append("name = ?"); vals.append(body.name)
    if body.content is not None:
        updates.append("content = ?"); vals.append(body.content)
    if body.parse_mode is not None:
        updates.append("parse_mode = ?"); vals.append(body.parse_mode)
    if not updates:
        return {"ok": True}

    updates.append("updated_at = datetime('now')")
    vals.append(template_id)
    await db.execute(f"UPDATE templates SET {', '.join(updates)} WHERE id = ?", vals)
    await db.commit()
    return {"ok": True}


@router.delete("/{template_id}")
async def delete_template(template_id: int, db: aiosqlite.Connection = Depends(get_db)):
    # Удалить прикреплённый медиа-файл, если есть
    async with db.execute("SELECT media_path FROM templates WHERE id=?", (template_id,)) as cur:
        row = await cur.fetchone()
    if row and row["media_path"]:
        p = Path(row["media_path"])
        if p.exists():
            p.unlink()
    await db.execute("DELETE FROM templates WHERE id = ?", (template_id,))
    await db.commit()
    return {"ok": True}


@router.post("/{template_id}/media")
async def upload_media(
    template_id: int, file: UploadFile = File(...),
    db: aiosqlite.Connection = Depends(get_db)
):
    """Прикрепить медиа-файл к шаблону (любой тип)."""
    # Проверяем, что шаблон существует
    async with db.execute("SELECT id FROM templates WHERE id=?", (template_id,)) as cur:
        if not await cur.fetchone():
            raise HTTPException(404, "Шаблон не найден")

    mime = file.content_type or "application/octet-stream"
    media_type = _media_type_for(mime)
    ext = _ext_for(mime, file.filename or "file")

    # Уникальное имя файла, чтобы не перезаписывать старые
    unique = uuid.uuid4().hex[:8]
    filename = f"tmpl_{template_id}_{unique}{ext}"
    save_path = UPLOADS_DIR / filename

    # Удалить старый файл, если был
    async with db.execute("SELECT media_path FROM templates WHERE id=?", (template_id,)) as cur:
        old = await cur.fetchone()
    if old and old["media_path"]:
        old_p = Path(old["media_path"])
        if old_p.exists():
            old_p.unlink()

    data = await file.read()
    save_path.write_bytes(data)
    media_url = _make_media_url(filename)

    await db.execute(
        "UPDATE templates SET media_path=?, media_url=?, media_type=?, updated_at=datetime('now') WHERE id=?",
        (str(save_path), media_url, media_type, template_id)
    )
    await db.commit()
    return {"ok": True, "media_url": media_url, "media_type": media_type, "filename": file.filename}


@router.delete("/{template_id}/media")
async def delete_media(template_id: int, db: aiosqlite.Connection = Depends(get_db)):
    """Удалить прикреплённый медиа-файл."""
    async with db.execute("SELECT media_path FROM templates WHERE id=?", (template_id,)) as cur:
        row = await cur.fetchone()
    if row and row["media_path"]:
        p = Path(row["media_path"])
        if p.exists():
            p.unlink()
    await db.execute(
        "UPDATE templates SET media_path=NULL, media_url=NULL, media_type=NULL WHERE id=?",
        (template_id,)
    )
    await db.commit()
    return {"ok": True}


@router.post("/preview")
async def preview_template(body: dict):
    """Предпросмотр шаблона с подстановкой переменных."""
    content = body.get("content", "")
    variables = body.get("variables", {})
    for key, val in variables.items():
        content = content.replace(f"{{{key}}}", str(val))
    found_vars = _extract_variables(content)
    return {"preview": content, "unresolved_variables": found_vars}


class SpinBody(BaseModel):
    count: int = 5
    api_key: Optional[str] = None
    model: Optional[str] = None


@router.post("/{template_id}/spin")
async def spin_template(
    template_id: int,
    body: SpinBody,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Сгенерировать AI-вариации шаблона через Groq и сохранить их."""
    from services.ai_spinner import generate_variations

    async with db.execute("SELECT * FROM templates WHERE id=?", (template_id,)) as cur:
        row = await cur.fetchone()
    if not row:
        raise HTTPException(404, "Шаблон не найден")

    content = row["content"]
    if not content.strip():
        raise HTTPException(400, "Шаблон пустой — нечего перефразировать")

    count = max(2, min(body.count, 15))  # ограничим 2–15 вариаций

    try:
        variations = await generate_variations(
            text=content,
            count=count,
            api_key=body.api_key,
            model=body.model,
        )
    except Exception as e:
        import logging
        logging.getLogger(__name__).exception("Error in AI variations generation")
        raise HTTPException(400, f"Ошибка AI: {str(e)}")

    import json as _json
    await db.execute(
        "UPDATE templates SET variations=?, updated_at=datetime('now') WHERE id=?",
        (_json.dumps(variations, ensure_ascii=False), template_id)
    )
    await db.commit()
    return {"ok": True, "variations": variations, "count": len(variations)}


@router.put("/{template_id}/spin")
async def update_spin_variations(
    template_id: int,
    body: dict,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Сохранить вручную отредактированные вариации."""
    import json as _json
    variations = body.get("variations", [])
    if not isinstance(variations, list):
        raise HTTPException(400, "variations должен быть списком")
    await db.execute(
        "UPDATE templates SET variations=?, updated_at=datetime('now') WHERE id=?",
        (_json.dumps(variations, ensure_ascii=False), template_id)
    )
    await db.commit()
    return {"ok": True}


@router.delete("/{template_id}/spin")
async def clear_spin_variations(
    template_id: int,
    db: aiosqlite.Connection = Depends(get_db)
):
    """Очистить все вариации шаблона."""
    await db.execute(
        "UPDATE templates SET variations='[]', updated_at=datetime('now') WHERE id=?",
        (template_id,)
    )
    await db.commit()
    return {"ok": True}

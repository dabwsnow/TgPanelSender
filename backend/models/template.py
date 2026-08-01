"""models/template.py — Pydantic-схемы для шаблонов сообщений."""
from pydantic import BaseModel
from typing import Optional


class TemplateCreate(BaseModel):
    name: str
    content: str
    parse_mode: Optional[str] = "markdown"


class TemplateUpdate(BaseModel):
    name: Optional[str] = None
    content: Optional[str] = None
    parse_mode: Optional[str] = None


class TemplateOut(BaseModel):
    id: int
    name: str
    content: str
    parse_mode: Optional[str] = "markdown"
    media_path: Optional[str] = None
    media_url: Optional[str] = None
    media_type: Optional[str] = None
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True

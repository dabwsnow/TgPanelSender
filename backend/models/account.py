"""models/account.py — Pydantic-схемы для аккаунтов."""
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime


class AccountCreate(BaseModel):
    """Данные для добавления нового аккаунта."""
    phone: str


class AccountSendCode(BaseModel):
    """Запрос на отправку кода подтверждения — API ключи берутся из .env."""
    phone: str
    proxy_id: Optional[int] = None


class AccountVerifyCode(BaseModel):
    """Верификация кода из SMS/Telegram."""
    phone: str
    code: str
    phone_code_hash: str
    proxy_id: Optional[int] = None


class AccountVerify2FA(BaseModel):
    """Ввод пароля двухфакторной аутентификации."""
    phone: str
    password: str


class AccountProfileUpdate(BaseModel):
    """Обновление профиля аккаунта в Telegram."""
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    username: Optional[str] = None
    bio: Optional[str] = None


class AutoResponderUpdate(BaseModel):
    """Настройки автоответчика."""
    enabled: bool = False
    message: str = ""
    delay: int = Field(default=5, ge=0, le=3600)
    keywords: List[str] = []


class AccountOut(BaseModel):
    """Ответ API — данные аккаунта."""
    id: int
    phone: str
    api_id: int
    first_name: Optional[str]
    last_name: Optional[str]
    username: Optional[str]
    bio: Optional[str]
    avatar_path: Optional[str]
    status: str
    is_spam_blocked: bool
    spam_checked_at: Optional[str]
    flood_wait_until: Optional[str]
    error_message: Optional[str]
    messages_sent: int
    messages_today: int
    last_active_at: Optional[str]
    created_at: str
    autoresponder_enabled: bool
    autoresponder_message: str
    autoresponder_delay: int
    autoresponder_keywords: List[str]
    proxy_id: Optional[int]

    class Config:
        from_attributes = True

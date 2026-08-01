"""models/proxy.py — Pydantic-схемы для управления прокси."""
from pydantic import BaseModel, Field
from typing import Optional


class ProxyCreate(BaseModel):
    host: str
    port: int = Field(..., ge=1, le=65535)
    protocol: str = Field(default="socks5")          # socks5 | http
    username: Optional[str] = None
    password: Optional[str] = None
    is_active: bool = True


class ProxyUpdate(BaseModel):
    host: Optional[str] = None
    port: Optional[int] = None
    protocol: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None


class ProxyOut(BaseModel):
    id: int
    host: str
    port: int
    protocol: str
    username: Optional[str]
    password: Optional[str]
    is_active: bool
    status: str
    error_message: Optional[str]
    last_check_at: Optional[str]
    created_at: str

    class Config:
        from_attributes = True

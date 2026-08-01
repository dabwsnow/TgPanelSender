"""models/campaign.py — Pydantic-схемы для кампаний рассылки."""
from pydantic import BaseModel, Field
from typing import Optional, List


class CampaignCreate(BaseModel):
    name: str
    template_id: int
    account_ids: List[int]
    delay_min: int = Field(default=5, ge=1)
    delay_max: int = Field(default=15, ge=1)
    daily_limit: int = Field(default=50, ge=1)
    schedule_start: Optional[str] = None   # "HH:MM"
    schedule_end: Optional[str] = None     # "HH:MM"
    is_looped: bool = False
    loop_delay: int = Field(default=60, ge=1)


class CampaignUpdate(BaseModel):
    name: Optional[str] = None
    template_id: Optional[int] = None
    account_ids: Optional[List[int]] = None
    delay_min: Optional[int] = None
    delay_max: Optional[int] = None
    daily_limit: Optional[int] = None
    schedule_start: Optional[str] = None
    schedule_end: Optional[str] = None
    is_looped: Optional[bool] = None
    loop_delay: Optional[int] = None


class RecipientAdd(BaseModel):
    """Добавить получателей вручную или из текста."""
    identifiers: List[str]               # список username/телефонов
    custom_vars: Optional[dict] = {}     # общие доп. переменные


class CampaignOut(BaseModel):
    id: int
    name: str
    template_id: Optional[int]
    template_name: Optional[str]         # JOIN из templates
    status: str
    delay_min: int
    delay_max: int
    daily_limit: int
    schedule_start: Optional[str]
    schedule_end: Optional[str]
    total_sent: int
    total_failed: int
    total_blocked: int
    account_ids: List[int]
    recipient_count: int
    created_at: str
    started_at: Optional[str]
    completed_at: Optional[str]
    is_looped: bool
    loop_delay: int

    class Config:
        from_attributes = True


class RecipientOut(BaseModel):
    id: int
    identifier: str
    custom_vars: dict
    status: str
    error_message: Optional[str]
    sent_at: Optional[str]
    sent_by: Optional[int]

    class Config:
        from_attributes = True

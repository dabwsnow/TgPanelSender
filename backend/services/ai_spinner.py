"""
services/ai_spinner.py — Генерация вариаций текста через Groq API (Llama 3.3).

Используется для anti-spam спин-текста в рассылках:
каждому получателю отправляется случайная вариация шаблона,
что снижает вероятность блокировки аккаунтов Telegram.
"""
import json
import logging
from typing import Optional
import aiohttp

from config import GROQ_API_KEY, GROQ_MODEL

logger = logging.getLogger(__name__)

GROQ_API_URL = "https://api.groq.com/openai/v1/chat/completions"


async def generate_variations(
    text: str,
    count: int = 5,
    language_hint: str = "auto",
    api_key: Optional[str] = None,
    model: Optional[str] = None,
) -> list[str]:
    """
    Генерирует `count` уникальных перефразировок `text` через Groq API.

    Сохраняет:
    - Смысл и тон исходного сообщения
    - Все переменные вида {first_name}, {username} и т.д.
    - Telegram-форматирование (**bold**, _italic_, ||spoiler|| и т.д.)

    Возвращает список строк (вариаций). При ошибке бросает ValueError.
    """
    key   = api_key or GROQ_API_KEY
    mdl   = model   or GROQ_MODEL

    if not key:
        raise ValueError(
            "Groq API ключ не настроен. "
            "Добавь GROKAI=... в файл .env и перезапусти бэкенд."
        )

    system_prompt = (
        "You are a professional copywriter specializing in message variations. "
        "Your task is to rephrase messages while preserving their meaning, tone, and intent. "
        "CRITICAL RULES:\n"
        "1. Keep ALL template variables exactly as-is: {first_name}, {username}, {date}, etc.\n"
        "2. Keep ALL Telegram formatting markers: **bold**, _italic_, __underline__, "
        "~~strikethrough~~, `mono`, ||spoiler||\n"
        "3. Match the language of the input text\n"
        "4. Each variation must sound natural and human-written\n"
        "5. Vary sentence structure, word order, synonyms — make each genuinely unique\n"
        "6. Return ONLY a valid JSON object with a key 'variations' containing a list of strings.\n"
        "Example output: {\"variations\": [\"Hi {first_name}!\", \"Hey there {first_name}!\"]}"
    )

    user_prompt = (
        f"Rephrase the following message {count} different ways. "
        f"Return ONLY a JSON object with a key 'variations' containing exactly {count} strings.\n\n"
        f"Original message:\n{text}"
    )

    payload = {
        "model": mdl,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user",   "content": user_prompt},
        ],
        "temperature": 0.9,
        "max_tokens": 2048,
        "response_format": {"type": "json_object"},
    }

    headers = {
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }

    async with aiohttp.ClientSession() as session:
        async with session.post(
            GROQ_API_URL, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=30)
        ) as resp:
            if resp.status != 200:
                body = await resp.text()
                logger.error(f"Groq API error {resp.status}: {body}")
                raise ValueError(f"Groq API вернул ошибку {resp.status}: {body[:200]}")

            data = await resp.json()

    raw = data["choices"][0]["message"]["content"]

    # Парсим JSON — Groq вернёт либо {"variations": [...]} либо просто [...]
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"AI вернул невалидный JSON: {e}\nОтвет: {raw[:300]}")

    # Извлекаем массив вариаций
    if isinstance(parsed, list):
        variations = parsed
    elif isinstance(parsed, dict):
        # Ищем первый ключ со списком
        for v in parsed.values():
            if isinstance(v, list):
                variations = v
                break
        else:
            raise ValueError(f"Не нашли массив вариаций в ответе AI: {raw[:300]}")
    else:
        raise ValueError(f"Неожиданный тип ответа AI: {type(parsed)}")

    # Фильтруем пустые строки
    variations = [str(v).strip() for v in variations if str(v).strip()]

    if not variations:
        raise ValueError("AI вернул пустой список вариаций")

    logger.info(f"Groq сгенерировал {len(variations)} вариаций для текста длиной {len(text)}")
    return variations

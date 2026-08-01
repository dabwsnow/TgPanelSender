"""
services/telegram_service.py — менеджер Telethon-клиентов.

Принцип работы:
  - TelegramClientManager хранит словарь {account_id -> TelegramClient}
  - При старте сервера восстанавливает клиентов из существующих .session файлов
  - Предоставляет методы для авторизации, управления профилем и проверки статуса

Чтобы добавить новый функционал — добавь метод в TelegramClientManager.
"""
import asyncio
import json
import logging
import os
import shutil
import tempfile
import zipfile
from pathlib import Path
from typing import Optional

from telethon import TelegramClient, functions, types, errors
from telethon.sessions import StringSession

from opentele.td import TDesktop
from opentele.api import APIData, UseCurrentSession

from config import SESSIONS_DIR

logger = logging.getLogger(__name__)


class TelegramClientManager:
    """Управляет пулом Telethon-клиентов для всех аккаунтов."""

    def __init__(self):
        # account_id -> TelegramClient
        self._clients: dict[int, TelegramClient] = {}
        # Промежуточные данные при авторизации: phone -> {client, phone_code_hash}
        self._pending_auth: dict[str, dict] = {}
        # Последняя ошибка подключения: account_id -> текст
        self._last_errors: dict[int, str] = {}

    async def _get_proxy_for_account(self, account_id: int) -> Optional[dict]:
        from config import DB_PATH
        import aiosqlite
        try:
            async with aiosqlite.connect(DB_PATH) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute(
                    """SELECT p.* FROM proxies p
                       JOIN accounts a ON a.proxy_id = p.id
                       WHERE a.id = ? AND p.is_active = 1""",
                    (account_id,)
                ) as cur:
                    row = await cur.fetchone()
                    if row:
                        return dict(row)
        except Exception as e:
            logger.warning(f"Error fetching proxy for account {account_id}: {e}")
        return None

    async def _get_proxy_by_id(self, proxy_id: int) -> Optional[dict]:
        from config import DB_PATH
        import aiosqlite
        try:
            async with aiosqlite.connect(DB_PATH) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute(
                    "SELECT * FROM proxies WHERE id = ? AND is_active = 1",
                    (proxy_id,)
                ) as cur:
                    row = await cur.fetchone()
                    if row:
                        return dict(row)
        except Exception as e:
            logger.warning(f"Error fetching proxy by id {proxy_id}: {e}")
        return None

    def _format_proxy(self, p_dict: Optional[dict]) -> Optional[tuple]:
        if not p_dict:
            return None
        import socks
        ptype = socks.SOCKS5 if p_dict["protocol"].lower() == "socks5" else socks.HTTP
        return (
            ptype,
            p_dict["host"],
            int(p_dict["port"]),
            True,
            p_dict["username"] or None,
            p_dict["password"] or None
        )

    # ─────────────────────────────────────────────────────────────────
    # Авторизация (шаг 1: запрос кода)
    # ─────────────────────────────────────────────────────────────────

    async def request_code(self, phone: str, api_id: int, api_hash: str, proxy_id: Optional[int] = None) -> str:
        """
        Отправляет код верификации на телефон.
        Возвращает phone_code_hash для передачи в verify_code().
        Принудительно переключается на DC1 для повышения надёжности доставки.
        """
        clean_phone = "".join(c for c in phone if c.isdigit())
        session_name = str(SESSIONS_DIR / f"temp_{clean_phone}")
        print(f"DEBUG: phone={phone}, api_id={api_id} ({type(api_id)}), api_hash={api_hash} ({type(api_hash)})", flush=True)

        proxy = None
        if proxy_id:
            proxy_row = await self._get_proxy_by_id(proxy_id)
            proxy = self._format_proxy(proxy_row)

        client = TelegramClient(
            session_name, api_id=api_id, api_hash=api_hash,
            device_model="Samsung Galaxy S23",
            system_version="Android 14",
            app_version="10.3.2",
            lang_code="ru",
            system_lang_code="ru-RU",
            proxy=proxy
        )
        await client.connect()

        # Принудительно переключаемся на DC1 — повышает надёжность доставки кода
        try:
            dc = getattr(client.session, 'dc_id', None)
            if dc and dc != 1:
                await client._switch_dc(1)
                logger.info(f"Переключились с DC{dc} на DC1 для {phone}")
        except Exception as e:
            logger.warning(f"Не удалось переключить DC для {phone}: {e}")

        try:
            result = await client.send_code_request(phone)
        except errors.FloodWaitError as e:
            await client.disconnect()
            raise Exception(f"FloodWait: подожди {e.seconds} секунд")
        except errors.PhoneNumberBannedError:
            await client.disconnect()
            raise Exception("Номер телефона заблокирован в Telegram")
        except Exception:
            await client.disconnect()
            raise

        logger.info(f"Код отправлен на {phone}, тип: {result.type.__class__.__name__}")
        self._pending_auth[phone] = {
            "client": client,
            "phone_code_hash": result.phone_code_hash,
        }
        return result.phone_code_hash

    # ─────────────────────────────────────────────────────────────────
    # Авторизация (шаг 2: ввод кода)
    # ─────────────────────────────────────────────────────────────────

    async def verify_code(
        self, phone: str, code: str, phone_code_hash: str, account_id: int
    ) -> bool:
        """
        Подтверждает код. При успехе сохраняет сессию и добавляет клиента в пул.
        Возвращает True при успехе, бросает SessionPasswordNeededError если включена 2FA.
        """
        pending = self._pending_auth.get(phone)
        if not pending:
            raise ValueError(f"Нет активного запроса авторизации для {phone}")

        client: TelegramClient = pending["client"]

        try:
            await client.sign_in(phone, code, phone_code_hash=phone_code_hash)
        except errors.PhoneCodeInvalidError:
            raise ValueError("Неверный код подтверждения")
        except errors.PhoneCodeExpiredError:
            raise ValueError("Код истёк — запроси новый")
        except errors.SessionPasswordNeededError:
            # 2FA включена — сохраняем клиента для следующего шага
            self._pending_auth[phone]["awaiting_2fa"] = True
            raise

        await self._finalize_auth(phone, client, account_id)
        return True

    # ─────────────────────────────────────────────────────────────────
    # Авторизация (шаг 3: 2FA, если включена)
    # ─────────────────────────────────────────────────────────────────

    async def verify_2fa(self, phone: str, password: str, account_id: int) -> bool:
        """Вводит пароль 2FA и завершает авторизацию."""
        pending = self._pending_auth.get(phone)
        if not pending or not pending.get("awaiting_2fa"):
            raise ValueError("Нет активного запроса 2FA")

        client: TelegramClient = pending["client"]
        try:
            await client.sign_in(password=password)
        except errors.PasswordHashInvalidError:
            raise ValueError("Неверный пароль 2FA")
        await self._finalize_auth(phone, client, account_id)
        return True

    async def _finalize_auth(self, phone: str, client: TelegramClient, account_id: int):
        """Сохраняет сессию в бинарный SQLite файл и регистрирует клиента в пуле."""
        session_path = SESSIONS_DIR / f"{account_id}.session"

        # Отключаем временного клиента, чтобы освободить замок на файле
        await client.disconnect()

        # Переименовываем временный SQLite файл в постоянный
        clean_phone = "".join(c for c in phone if c.isdigit())
        temp_path = SESSIONS_DIR / f"temp_{clean_phone}.session"
        if temp_path.exists():
            if session_path.exists():
                try:
                    os.remove(session_path)
                except OSError:
                    pass
            temp_path.rename(session_path)

        # Получаем прокси
        proxy_row = await self._get_proxy_for_account(account_id)
        proxy = self._format_proxy(proxy_row)

        # Создаем и подключаем финального клиента на постоянной SQLite сессии
        final_client = TelegramClient(
            str(session_path)[:-8], api_id=client.api_id, api_hash=client.api_hash,
            device_model="Samsung Galaxy S23",
            system_version="Android 14",
            app_version="10.3.2",
            lang_code="ru",
            system_lang_code="ru-RU",
            proxy=proxy
        )
        await final_client.connect()

        self._clients[account_id] = final_client
        self._pending_auth.pop(phone, None)
        logger.info(f"Аккаунт {account_id} ({phone}) успешно авторизован (SQLite сессия)")

    def save_session_string_as_sqlite(self, session_string: str, account_id: int, api_id: int, api_hash: str):
        """Конвертирует текстовую StringSession в бинарный SQLite .session файл или записывает сырой SQLite."""
        session_path = SESSIONS_DIR / f"{account_id}.session"
        if session_path.exists():
            try:
                os.remove(session_path)
            except OSError:
                pass

        if session_string.startswith("sqlite:"):
            import base64
            raw_bytes = base64.b64decode(session_string[7:])
            with open(session_path, "wb") as f:
                f.write(raw_bytes)
        else:
            from telethon.sessions import StringSession
            s = StringSession(session_string)
            sqlite_client = TelegramClient(str(session_path)[:-8], api_id=api_id, api_hash=api_hash)
            sqlite_client.session.set_dc(s.dc_id, s.server_address, s.port)
            sqlite_client.session.auth_key = s.auth_key
            sqlite_client.session.save()

    # ─────────────────────────────────────────────────────────────────
    # Загрузка существующих сессий при старте
    # ─────────────────────────────────────────────────────────────────

    async def load_session(self, account_id: int, api_id: int, api_hash: str) -> bool:
        """Загружает сохранённую сессию из файла (бинарного SQLite или текстового)."""
        session_path = SESSIONS_DIR / f"{account_id}.session"
        if not session_path.exists():
            return False

        proxy_row = await self._get_proxy_for_account(account_id)
        proxy = self._format_proxy(proxy_row)

        try:
            # Проверяем, SQLite это или текстовая строка (SQLite начинается с b"SQLite format 3\x00")
            with open(session_path, "rb") as f:
                header = f.read(16)

            if header == b"SQLite format 3\x00":
                client = TelegramClient(
                    str(session_path)[:-8], api_id=api_id, api_hash=api_hash,
                    device_model="Samsung Galaxy S23",
                    system_version="Android 14",
                    app_version="10.3.2",
                    lang_code="ru",
                    system_lang_code="ru-RU",
                    proxy=proxy
                )
            else:
                session_string = session_path.read_text(encoding="utf-8").strip()
                if not session_string:
                    return False
                client = TelegramClient(
                    StringSession(session_string), api_id=api_id, api_hash=api_hash,
                    device_model="Samsung Galaxy S23",
                    system_version="Android 14",
                    app_version="10.3.2",
                    lang_code="ru",
                    system_lang_code="ru-RU",
                    proxy=proxy
                )

            await client.connect()
            if await client.is_user_authorized():
                self._clients[account_id] = client
                self._last_errors.pop(account_id, None)
                logger.info(f"Сессия аккаунта {account_id} восстановлена")
                return True
            # Подключились, но сессия недействительна (разлогинен / убит на стороне TG)
            self._last_errors[account_id] = (
                "Сессия недействительна: аккаунт разлогинен или сессия отозвана. "
                "Нужно переимпортировать .session/tdata или войти заново по номеру."
            )
            try:
                await client.disconnect()
            except Exception:
                pass
        except Exception as e:
            msg = str(e) or type(e).__name__
            if proxy:
                msg += " (проверь прокси, привязанный к аккаунту)"
            self._last_errors[account_id] = f"Ошибка подключения: {msg}"
            logger.warning(f"Не удалось восстановить сессию {account_id}: {e}")

        return False

    def get_last_error(self, account_id: int) -> Optional[str]:
        return self._last_errors.get(account_id)

    # ─────────────────────────────────────────────────────────────────
    # Получение клиента
    # ─────────────────────────────────────────────────────────────────

    def get_client(self, account_id: int) -> Optional[TelegramClient]:
        return self._clients.get(account_id)

    def is_connected(self, account_id: int) -> bool:
        client = self._clients.get(account_id)
        return client is not None and client.is_connected()

    # ─────────────────────────────────────────────────────────────────
    # Профиль аккаунта
    # ─────────────────────────────────────────────────────────────────

    async def get_me(self, account_id: int) -> Optional[types.User]:
        """Получить информацию о себе из Telegram."""
        client = self.get_client(account_id)
        if not client:
            return None
        return await client.get_me()

    async def update_profile(
        self, account_id: int,
        first_name: str = None, last_name: str = None, bio: str = None
    ) -> bool:
        """Обновить имя/фамилию/биографию в Telegram."""
        client = self.get_client(account_id)
        if not client:
            raise ValueError(f"Аккаунт {account_id} не подключён")

        kwargs = {}
        if first_name is not None:
            kwargs["first_name"] = first_name
        if last_name is not None:
            kwargs["last_name"] = last_name
        if bio is not None:
            kwargs["about"] = bio

        if kwargs:
            await client(functions.account.UpdateProfileRequest(**kwargs))

        return True

    async def update_username(self, account_id: int, username: str) -> bool:
        """Изменить username аккаунта."""
        client = self.get_client(account_id)
        if not client:
            raise ValueError(f"Аккаунт {account_id} не подключён")
        try:
            await client(functions.account.UpdateUsernameRequest(username=username))
        except errors.UsernameNotModifiedError:
            logger.info(f"Имя пользователя для аккаунта {account_id} не изменилось.")
        return True

    async def upload_avatar(self, account_id: int, photo_path: str) -> bool:
        """Загрузить аватар аккаунта."""
        client = self.get_client(account_id)
        if not client:
            raise ValueError(f"Аккаунт {account_id} не подключён")
        await client(functions.photos.UploadProfilePhotoRequest(
            file=await client.upload_file(photo_path)
        ))
        return True

    # ─────────────────────────────────────────────────────────────────
    # Отправка сообщений (для кампаний и автоответчика)
    # ─────────────────────────────────────────────────────────────────

    async def send_message(
        self, account_id: int, recipient: str, text: str,
        media_path: str = None
    ) -> bool:
        """
        Отправить сообщение от аккаунта получателю.
        recipient — username (@user), номер телефона или ID чата.
        """
        client = self.get_client(account_id)
        if not client:
            raise ValueError(f"Аккаунт {account_id} не подключён")

        target = recipient
        if isinstance(recipient, str):
            clean = recipient.strip()
            if clean.isdigit() or (clean.startswith('-') and clean[1:].isdigit()):
                target = int(clean)

        if media_path:
            await client.send_file(target, media_path, caption=text)
        else:
            await client.send_message(target, text)

        return True

    # ─────────────────────────────────────────────────────────────────
    # Импорт сессий и TData
    # ─────────────────────────────────────────────────────────────────

    async def import_session_file(self, file_content: bytes, api_id: int, api_hash: str) -> tuple[str, str, str, str, str]:
        """
        Импортирует сессию из файла (.session).
        Поддерживает:
          1. Текстовый формат (StringSession)
          2. Двоичный формат SQLite
        Возвращает (phone, first_name, last_name, username, session_string)
        """
        # Проверяем, SQLite это или текстовая строка (SQLite начинается с b"SQLite format 3\x00")
        if file_content.startswith(b"SQLite format 3\x00"):
            # Бинарный SQLite файл сессии. Сохраняем во временный файл
            fd, temp_path = tempfile.mkstemp(suffix=".session")
            os.close(fd)
            try:
                with open(temp_path, "wb") as f:
                    f.write(file_content)

                # Имя сессии для Telethon — это путь без расширения .session
                session_name = temp_path[:-8]
                client = TelegramClient(session_name, api_id=api_id, api_hash=api_hash)
                await client.connect()

                if not await client.is_user_authorized():
                    raise ValueError("Сессия не авторизована или недействительна")

                me = await client.get_me()
                if not me:
                    raise ValueError("Не удалось получить информацию о пользователе")

                await client.disconnect()
                with open(temp_path, "rb") as f:
                    verified_bytes = f.read()

                import base64
                session_string = "sqlite:" + base64.b64encode(verified_bytes).decode("utf-8")

                return (
                    me.phone or "",
                    me.first_name or "",
                    me.last_name or "",
                    me.username or "",
                    session_string
                )
            finally:
                # Удаляем временные файлы сессии (.session и .session-journal если есть)
                for ext in ["", "-journal"]:
                    try:
                        os.remove(temp_path + ext)
                    except OSError:
                        pass
        else:
            # Текстовая StringSession строка
            try:
                session_string = file_content.decode("utf-8").strip()
            except Exception:
                raise ValueError("Неверный формат файла сессии")

            client = TelegramClient(StringSession(session_string), api_id=api_id, api_hash=api_hash)
            await client.connect()

            if not await client.is_user_authorized():
                await client.disconnect()
                raise ValueError("Текстовая сессия не авторизована или недействительна")

            me = await client.get_me()
            await client.disconnect()

            if not me:
                raise ValueError("Не удалось получить информацию о пользователе")

            return (
                me.phone or "",
                me.first_name or "",
                me.last_name or "",
                me.username or "",
                session_string
            )

    async def import_tdata_zip(self, zip_content: bytes, api_id: int, api_hash: str, password: str = None) -> tuple[str, str, str, str, str]:
        """
        Импортирует сессию из zip-архива tdata папки.
        Возвращает (phone, first_name, last_name, username, session_string)
        """
        temp_dir = tempfile.mkdtemp()
        zip_path = Path(temp_dir) / "tdata.zip"
        try:
            zip_path.write_bytes(zip_content)

            # Распаковываем
            with zipfile.ZipFile(zip_path, "r") as zip_ref:
                zip_ref.extractall(temp_dir)

            # Ищем папку tdata.
            # Мы ищем папку, в которой лежит файл key_datas или D877F783D5D3EF8C
            tdata_path = None
            for root, dirs, files in os.walk(temp_dir):
                if "key_datas" in files or "D877F783D5D3EF8C" in files:
                    tdata_path = root
                    break

            if not tdata_path:
                # Если сигнатурных файлов не найдено, попробуем поискать директорию tdata
                for root, dirs, files in os.walk(temp_dir):
                    if os.path.basename(root).lower() == "tdata":
                        tdata_path = root
                        break

            if not tdata_path:
                raise ValueError("В архиве не найдена папка tdata (отсутствуют key_datas)")

            # Загружаем tdata через opentele
            tdesk = TDesktop(tdata_path)
            if not tdesk.isLoaded():
                raise ValueError("Не удалось загрузить tdata (возможно, неверный формат)")

            if tdesk.accountsCount == 0:
                raise ValueError("В tdata нет активных аккаунтов")

            # Конвертируем в Telethon с использованием API из .env
            my_api = APIData(api_id=api_id, api_hash=api_hash)
            client = await tdesk.ToTelethon(flag=UseCurrentSession, api=my_api, password=password)

            await client.connect()
            if not await client.is_user_authorized():
                await client.disconnect()
                raise ValueError("Телеграм-клиент из tdata не авторизован")

            me = await client.get_me()
            session_string = client.session.save()
            await client.disconnect()

            if not me:
                raise ValueError("Не удалось получить информацию о пользователе")

            return (
                me.phone or "",
                me.first_name or "",
                me.last_name or "",
                me.username or "",
                session_string
            )

        finally:
            # Очищаем временную папку
            try:
                shutil.rmtree(temp_dir)
            except Exception:
                pass

    # ─────────────────────────────────────────────────────────────────
    # Диалоги/Чаты
    # ─────────────────────────────────────────────────────────────────

    async def get_chats(self, account_id: int):
        """Получить список последних диалогов аккаунта."""
        client = self.get_client(account_id)
        if not client:
            raise ValueError(f"Аккаунт {account_id} не подключён")

        dialogs = await client.get_dialogs(limit=50)
        chats = []
        for d in dialogs:
            chat_type = "user"
            if d.is_group:
                chat_type = "group"
            elif d.is_channel:
                chat_type = "channel"

            username = getattr(d.entity, "username", None) or ""

            last_msg = ""
            if d.message:
                last_msg = d.message.message or "[Медиа/Файл]"

            chats.append({
                "id": d.id,
                "name": d.name,
                "username": username,
                "type": chat_type,
                "unread_count": d.unread_count,
                "last_message": last_msg,
                "date": d.date.isoformat() if d.date else None
            })
        return chats

    async def get_chat_messages(self, account_id: int, chat_id: int, limit: int = 50):
        """Получить историю сообщений конкретного чата."""
        client = self.get_client(account_id)
        if not client:
            raise ValueError(f"Аккаунт {account_id} не подключён")

        # Telethon умеет принимать int ID напрямую
        messages = await client.get_messages(chat_id, limit=limit)
        result = []
        for m in messages:
            sender_name = "Я" if m.out else "Собеседник"
            if m.sender and not m.out:
                first_name = getattr(m.sender, "first_name", "") or ""
                last_name = getattr(m.sender, "last_name", "") or ""
                sender_name = f"{first_name} {last_name}".strip()
                if not sender_name:
                    sender_name = getattr(m.sender, "title", "Группа/Канал")

            media_data = None
            if m.media:
                media_type = "other"
                media_info = {}
                if isinstance(m.media, types.MessageMediaPhoto):
                    media_type = "photo"
                    media_info = {"filename": "photo.jpg", "size": 0}
                elif isinstance(m.media, types.MessageMediaDocument) and m.media.document:
                    mime = m.media.document.mime_type or ""
                    media_info = {"size": m.media.document.size, "mime_type": mime}
                    
                    filename = "file"
                    is_voice = False
                    is_video = mime.startswith("video/")
                    
                    for attr in m.media.document.attributes:
                        if isinstance(attr, types.DocumentAttributeFilename):
                            filename = attr.file_name
                        elif isinstance(attr, types.DocumentAttributeAudio) and attr.voice:
                            is_voice = True
                            
                    media_info["filename"] = filename
                    
                    if is_voice:
                        media_type = "voice"
                    elif is_video:
                        media_type = "video"
                    elif mime.startswith("audio/"):
                        media_type = "audio"
                    else:
                        media_type = "document"
                
                # Проверяем, скачан ли уже файл локально
                from config import UPLOADS_DIR
                cached_filename = None
                if media_type != "other":
                    ext = ""
                    if media_type == "photo":
                        ext = ".jpg"
                    elif media_info.get("filename"):
                        ext = Path(media_info["filename"]).suffix or ".bin"
                    
                    target_name = f"media_{account_id}_{chat_id}_{m.id}{ext}"
                    if (UPLOADS_DIR / target_name).exists():
                        cached_filename = f"/uploads/{target_name}"

                media_data = {
                    "type": media_type,
                    "info": media_info,
                    "url": cached_filename
                }

            result.append({
                "id": m.id,
                "sender_id": m.sender_id,
                "sender_name": sender_name,
                "text": m.message or "",
                "date": m.date.isoformat() if m.date else None,
                "out": bool(m.out),
                "media": media_data
            })
        result.reverse()  # Хронологический порядок
        return result

    async def download_message_media(self, account_id: int, chat_id: int, message_id: int) -> str:
        """Скачать медиа-файл сообщения на сервер и вернуть веб-путь к нему."""
        client = self.get_client(account_id)
        if not client:
            raise ValueError(f"Аккаунт {account_id} не подключён")

        message = await client.get_messages(chat_id, ids=message_id)
        if not message or not message.media:
            raise ValueError("Сообщение не содержит медиа-файлов")

        ext = ".bin"
        if isinstance(message.media, types.MessageMediaPhoto):
            ext = ".jpg"
        elif isinstance(message.media, types.MessageMediaDocument) and message.media.document:
            filename = "file"
            for attr in message.media.document.attributes:
                if isinstance(attr, types.DocumentAttributeFilename):
                    filename = attr.file_name
                    break
            ext = Path(filename).suffix or ".bin"

        from config import UPLOADS_DIR
        target_name = f"media_{account_id}_{chat_id}_{message_id}{ext}"
        target_path = UPLOADS_DIR / target_name

        if not target_path.exists():
            await client.download_media(message, file=str(target_path))

        return f"/uploads/{target_name}"

    async def send_chat_message(self, account_id: int, chat_id: int, text: str):
        """Отправить сообщение в конкретный чат."""
        client = self.get_client(account_id)
        if not client:
            raise ValueError(f"Аккаунт {account_id} не подключён")
        await client.send_message(chat_id, text)
        return True

    async def get_groups(self, account_id: int):
        """Получить список всех групп и каналов, в которых состоит аккаунт."""
        client = self.get_client(account_id)
        if not client:
            raise ValueError(f"Аккаунт {account_id} не подключён")
        dialogs = await client.get_dialogs()
        groups = []
        for d in dialogs:
            if d.is_group or d.is_channel:
                groups.append({
                    "id": d.id,
                    "name": d.name,
                    "username": getattr(d.entity, 'username', None) or "",
                    "is_channel": bool(d.is_channel),
                    "is_group": bool(d.is_group)
                })
        return groups

    async def leave_group(self, account_id: int, chat_id: int):
        """Выйти из группы/канала."""
        client = self.get_client(account_id)
        if not client:
            raise ValueError(f"Аккаунт {account_id} не подключён")
        await client.delete_dialog(chat_id)
        return True

    async def leave_all_groups(self, account_id: int):
        """Выйти из всех групп и каналов."""
        client = self.get_client(account_id)
        if not client:
            raise ValueError(f"Аккаунт {account_id} не подключён")
        dialogs = await client.get_dialogs()
        left_count = 0
        for d in dialogs:
            if d.is_group or d.is_channel:
                try:
                    await client.delete_dialog(d.id)
                    left_count += 1
                except Exception as e:
                    logger.warning(f"Не удалось выйти из {d.id} ({d.name}): {e}")
        return left_count

    # ─────────────────────────────────────────────────────────────────
    # Закрытие клиента
    # ─────────────────────────────────────────────────────────────────

    async def disconnect(self, account_id: int):
        """Отключить клиента аккаунта."""
        client = self._clients.pop(account_id, None)
        if client:
            await client.disconnect()

    async def disconnect_all(self):
        """Отключить всех клиентов (вызывается при остановке сервера)."""
        for account_id, client in list(self._clients.items()):
            try:
                await client.disconnect()
            except Exception:
                pass
        self._clients.clear()


# Синглтон — используется во всём приложении
telegram_manager = TelegramClientManager()

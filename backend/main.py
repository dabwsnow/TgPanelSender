"""
main.py — точка входа FastAPI приложения.

Запуск:
  uvicorn main:app --reload --port 8000

Или через скрипт:
  python main.py
"""
import json
import logging
import sys
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Header, Depends, Cookie, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel

from config import HOST, PORT, DEBUG, BASE_DIR
from database import init_db, close_db, get_db
from routers import accounts, templates, campaigns, settings, joins, proxies
from services.scheduler import setup_scheduler
from services.telegram_service import telegram_manager
from services import auto_responder

logging.basicConfig(
    level=logging.DEBUG if DEBUG else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger(__name__)

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Запуск и остановка приложения."""
    logger.info("═══════════════════════════════")
    logger.info("  TGPanel starting up...")
    logger.info("═══════════════════════════════")

    # Инициализация БД
    await init_db()
    logger.info("Database initialized")

    # Восстанавливаем активные сессии
    db = await get_db()
    async with db.execute(
        "SELECT id, api_id, api_hash, autoresponder_enabled, autoresponder_message, "
        "autoresponder_delay, autoresponder_keywords FROM accounts WHERE status != 'inactive'"
    ) as cur:
        accounts_rows = await cur.fetchall()

    for row in accounts_rows:
        account_id = row["id"]
        ok = await telegram_manager.load_session(account_id, row["api_id"], row["api_hash"])
        if ok:
            await db.execute(
                "UPDATE accounts SET status = 'active' WHERE id = ?", (account_id,)
            )
            # Восстанавливаем автоответчик
            if row["autoresponder_enabled"]:
                try:
                    keywords = json.loads(row["autoresponder_keywords"] or "[]")
                    await auto_responder.enable(
                        account_id, row["autoresponder_message"],
                        row["autoresponder_delay"], keywords
                    )
                except Exception as e:
                    logger.warning(f"Не удалось восстановить автоответчик {account_id}: {e}")
        else:
            await db.execute(
                "UPDATE accounts SET status = 'inactive' WHERE id = ?", (account_id,)
            )
    await db.execute(
        "UPDATE campaigns SET status = 'stopped' WHERE status = 'running'"
    )
    await db.commit()
    logger.info("Stuck running campaigns reset to stopped")
    logger.info(f"Restored {len(accounts_rows)} account session(s)")

    # Запускаем планировщик
    setup_scheduler(get_db)
    logger.info("Scheduler started")

    logger.info(f"✅ TGPanel ready at http://{HOST}:{PORT}")

    yield  # приложение работает

    # Остановка
    logger.info("Shutting down...")
    await telegram_manager.disconnect_all()
    await close_db()
    logger.info("Goodbye!")


app = FastAPI(
    title="TGPanel API",
    description="Панель управления Telegram рассылками",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/api/docs",
    redoc_url="/api/redoc",
)

# CORS (разрешаем "*" только в DEBUG для удобства разработки)
if DEBUG:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[f"http://localhost:{PORT}", f"http://127.0.0.1:{PORT}"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

# Зависимость для проверки токена администратора
async def verify_admin_token(
    x_admin_token: str = Header(None),
    admin_token: str = Cookie(None)
):
    from config import ADMIN_PASSWORD
    if not ADMIN_PASSWORD:
        return
    token = x_admin_token or admin_token
    if token != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Unauthorized")

# Подключаем роутеры с проверкой токена
app.include_router(accounts.router, dependencies=[Depends(verify_admin_token)])
app.include_router(templates.router, dependencies=[Depends(verify_admin_token)])
app.include_router(campaigns.router, dependencies=[Depends(verify_admin_token)])
app.include_router(settings.router, dependencies=[Depends(verify_admin_token)])
app.include_router(joins.router, dependencies=[Depends(verify_admin_token)])
app.include_router(proxies.router, dependencies=[Depends(verify_admin_token)])

# Эндпоинт для авторизации
class LoginRequest(BaseModel):
    password: str

@app.post("/api/login")
async def api_login(body: LoginRequest, response: Response):
    from config import ADMIN_PASSWORD
    if ADMIN_PASSWORD and body.password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="Invalid password")
    
    # Устанавливаем HttpOnly cookie на 30 дней
    response.set_cookie(
        key="admin_token",
        value=body.password,
        max_age=30 * 24 * 60 * 60,
        httponly=True,
        samesite="lax"
    )
    return {"ok": True}

# Раздаём статику фронтенда и загрузки с проверкой куки
if FRONTEND_DIR.exists():
    from config import ADMIN_SECRET_PATH
    secret_prefix = ADMIN_SECRET_PATH.strip("/")

    # Защищенный роут для JS файлов
    @app.get("/js/{file_path:path}", include_in_schema=False)
    async def serve_protected_js(file_path: str, admin_token: str = Cookie(None)):
        from config import ADMIN_PASSWORD
        if ADMIN_PASSWORD and admin_token != ADMIN_PASSWORD:
            raise HTTPException(status_code=404, detail="Not Found")
        file = FRONTEND_DIR / "js" / file_path
        if file.exists() and file.is_file():
            return FileResponse(str(file), media_type="text/javascript")
        raise HTTPException(status_code=404, detail="Not Found")

    # Защищенный роут для CSS/картинок в assets
    @app.get("/assets/{file_path:path}", include_in_schema=False)
    async def serve_protected_assets(file_path: str, admin_token: str = Cookie(None)):
        from config import ADMIN_PASSWORD
        if ADMIN_PASSWORD and admin_token != ADMIN_PASSWORD:
            raise HTTPException(status_code=404, detail="Not Found")
        file = FRONTEND_DIR / "css" / file_path
        if file.exists() and file.is_file():
            return FileResponse(str(file), media_type="text/css")
        raise HTTPException(status_code=404, detail="Not Found")

    # Защищенный роут для загрузок (аватары, медиа)
    @app.get("/uploads/{file_path:path}", include_in_schema=False)
    async def serve_protected_uploads(file_path: str, admin_token: str = Cookie(None)):
        from config import ADMIN_PASSWORD
        if ADMIN_PASSWORD and admin_token != ADMIN_PASSWORD:
            raise HTTPException(status_code=404, detail="Not Found")
        file = BASE_DIR / "uploads" / file_path
        if file.exists() and file.is_file():
            return FileResponse(str(file))
        raise HTTPException(status_code=404, detail="Not Found")

    @app.get("/", include_in_schema=False)
    async def serve_root(admin_token: str = Cookie(None)):
        if not secret_prefix:
            # Если пароль задан, но кука не совпадает — отдаем страницу входа
            from config import ADMIN_PASSWORD
            if ADMIN_PASSWORD and admin_token != ADMIN_PASSWORD:
                login_page = FRONTEND_DIR / "login.html"
                if login_page.exists():
                    return FileResponse(str(login_page))
                return HTMLResponse("<h1>Login Required</h1>")
            return FileResponse(str(FRONTEND_DIR / "index.html"))
        raise HTTPException(status_code=404, detail="Not Found")

    @app.get("/{path:path}", include_in_schema=False)
    async def serve_frontend(path: str, admin_token: str = Cookie(None)):
        if path.startswith("api/"):
            raise HTTPException(status_code=404, detail="Not Found")

        if secret_prefix and (path == secret_prefix or path.startswith(f"{secret_prefix}/")):
            from config import ADMIN_PASSWORD
            # Если пароль задан, но кука не совпадает — отдаем страницу входа
            if ADMIN_PASSWORD and admin_token != ADMIN_PASSWORD:
                login_page = FRONTEND_DIR / "login.html"
                if login_page.exists():
                    return FileResponse(str(login_page))
                return HTMLResponse("<h1>Login Required</h1>")
                
            index = FRONTEND_DIR / "index.html"
            if index.exists():
                return FileResponse(str(index))
            raise HTTPException(status_code=404, detail="Frontend not found")

        raise HTTPException(status_code=404, detail="Not Found")


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=HOST,
        port=PORT,
        reload=DEBUG,
        log_level="debug" if DEBUG else "info",
    )

"""
services/scheduler.py — фоновые задачи на APScheduler.

Задачи:
  1. Каждые N минут — проверка всех аккаунтов на спам-блок
  2. Ежедневно в полночь — сброс счётчика messages_today

Чтобы добавить новую задачу — добавь функцию и зарегистрируй через add_job().
"""
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from config import SPAM_CHECK_INTERVAL_MINUTES

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="UTC")


def setup_scheduler(db_getter):
    """
    Настраивает и запускает планировщик.
    db_getter — callable возвращающий aiosqlite.Connection
    """
    from services.spam_checker import check_all_accounts

    async def _spam_check_job():
        logger.info("Планировщик: запуск проверки спам-блока")
        try:
            db = await db_getter()
            await check_all_accounts(db)
        except Exception as e:
            logger.error(f"Ошибка spam check job: {e}")

    async def _reset_daily_counters():
        """Сбрасывает дневные счётчики сообщений."""
        try:
            db = await db_getter()
            await db.execute(
                "UPDATE accounts SET messages_today = 0, messages_today_date = date('now')"
            )
            await db.commit()
            logger.info("Дневные счётчики сброшены")
        except Exception as e:
            logger.error(f"Ошибка сброса счётчиков: {e}")

    # Проверка спам-блока каждые N минут
    scheduler.add_job(
        _spam_check_job,
        "interval",
        minutes=SPAM_CHECK_INTERVAL_MINUTES,
        id="spam_check",
        replace_existing=True,
    )

    # Сброс дневных счётчиков в полночь UTC
    scheduler.add_job(
        _reset_daily_counters,
        CronTrigger(hour=0, minute=0),
        id="reset_daily",
        replace_existing=True,
    )

    scheduler.start()
    logger.info(
        f"Планировщик запущен. Спам-чек каждые {SPAM_CHECK_INTERVAL_MINUTES} мин."
    )

import asyncio
import os
from telethon import TelegramClient
from dotenv import load_dotenv

# Загружаем переменные из .env
load_dotenv()

API_ID = int(os.getenv("TG_API_ID", "0"))
API_HASH = os.getenv("TG_API_HASH", "")

PHONE = "48792757242"  # Проверяемый номер телефона

async def main():
    if not API_ID or not API_HASH:
        print("Ошибка: Укажи TG_API_ID и TG_API_HASH в файле .env!")
        return

    print(f"Используем API_ID: {API_ID}")
    print(f"Используем API_HASH: {API_HASH}")
    print(f"Отправляем запрос кода на номер: {PHONE}...")

    # Создаем временный клиент в памяти
    client = TelegramClient(
        None, API_ID, API_HASH,
        device_model="TGPanel Test", app_version="1.0"
    )
    
    try:
        await client.connect()
        print("Подключение к серверам Telegram выполнено успешно.")
        
        result = await client.send_code_request(PHONE)
        print("\n--- УСПЕХ! ---")
        print("Код был успешно отправлен Telegram'ом!")
        print(f"Phone code hash: {result.phone_code_hash}")
        print(f"Тип отправки: {type(result.type).__name__}")
        
    except Exception as e:
        print("\n--- ОШИБКА TELEGRAM ---")
        print(f"Имя ошибки: {type(e).__name__}")
        print(f"Детали ошибки: {e}")
    finally:
        await client.disconnect()

if __name__ == "__main__":
    asyncio.run(main())

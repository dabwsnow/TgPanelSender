# TGPanel — Панель для Telegram рассылок

Полноценная веб-панель для управления Telegram аккаунтами и организации рассылок.

## Стек
- **Backend**: Python 3.10+ · FastAPI · Telethon · SQLite
- **Frontend**: Vanilla HTML/CSS/JS (glassmorphism dark theme)

## Структура проекта

```
TGPanel/
├── backend/
│   ├── main.py               ← точка входа (FastAPI app)
│   ├── config.py             ← все настройки (читает .env)
│   ├── requirements.txt
│   ├── .env.example          ← скопируй в .env и заполни
│   │
│   ├── database/
│   │   ├── schema.sql        ← схема БД
│   │   └── connection.py     ← aiosqlite manager
│   │
│   ├── models/               ← Pydantic схемы
│   │   ├── account.py
│   │   ├── template.py
│   │   └── campaign.py
│   │
│   ├── services/             ← бизнес-логика
│   │   ├── telegram_service.py  ← Telethon клиент-пул
│   │   ├── spam_checker.py      ← проверка @SpamBot
│   │   ├── auto_responder.py    ← автоответчик
│   │   ├── campaign_runner.py   ← движок рассылки
│   │   └── scheduler.py         ← фоновые задачи (APScheduler)
│   │
│   ├── routers/              ← API эндпоинты
│   │   ├── accounts.py       ← /api/accounts/*
│   │   ├── templates.py      ← /api/templates/*
│   │   ├── campaigns.py      ← /api/campaigns/*
│   │   └── settings.py       ← /api/settings/*
│   │
│   ├── sessions/             ← .session файлы Telethon (авто-создаётся)
│   └── uploads/              ← аватары, медиа шаблонов (авто-создаётся)
│
└── frontend/
    ├── index.html
    ├── css/style.css
    └── js/
        ├── app.js            ← SPA роутер
        ├── api.js            ← HTTP клиент
        └── pages/
            ├── dashboard.js
            ├── accounts.js
            ├── account-edit.js
            ├── templates.js
            ├── campaigns.js
            └── campaign-new.js
```

## Быстрый старт

```bash
# 1. Клонируй / зайди в папку
cd TGPanel/backend

# 2. Создай виртуальное окружение
python3 -m venv venv
source venv/bin/activate      # Mac/Linux
# venv\Scripts\activate       # Windows

# 3. Установи зависимости
pip install -r requirements.txt

# 4. Создай .env из примера
cp .env.example .env
# (опционально) заполни TG_API_ID и TG_API_HASH

# 5. Запусти сервер
python main.py

# 6. Открой панель
open http://localhost:8000
```

## Модули

### 📱 Аккаунты
- Добавление по номеру телефона (3-шаговый wizard: телефон → код → 2FA)
- Редактирование профиля (имя, фамилия, username, биография, аватар)
- Подключение/отключение аккаунтов
- Статусы: active / flood_wait / spam_blocked / inactive

### 🤖 Автоответчик
- Включить/выключить для каждого аккаунта отдельно
- Шаблон ответа с переменными: `{first_name}`, `{username}`, `{date}`, `{time}`
- Задержка перед ответом (в секундах)
- Фильтр по ключевым словам (отвечать только если в сообщении есть слово)

### 🛡️ Спам-чек
- Автоматическая проверка каждые N минут (настраивается)
- Ручная проверка по кнопке
- История проверок для каждого аккаунта

### 📝 Шаблоны
- Создание/редактирование шаблонов
- Переменные `{first_name}`, `{custom_var}` и любые свои
- Live-предпросмотр с подстановкой значений
- Прикрепление медиа (фото / видео / документ)

### 🚀 Кампании
- Выбор аккаунтов-отправителей
- Выбор шаблона
- Настройка задержки (случайный диапазон мин-макс сек)
- Дневной лимит на аккаунт
- Расписание (время старта и остановки)
- Добавление получателей: вручную или загрузка TXT/CSV файла
- Start / Pause / Stop кампании
- Прогресс-бар и счётчики sent/failed/blocked

## API Документация

После запуска доступна автодокументация:
- **Swagger UI**: http://localhost:8000/api/docs
- **ReDoc**: http://localhost:8000/api/redoc

## Расширение

Каждый слой изолирован — просто добавляй:
- **Новый роутер** → `routers/myfeature.py` + подключи в `main.py`
- **Новый сервис** → `services/myservice.py`
- **Новая страница** → `frontend/js/pages/mypage.js` + добавь в `app.js`
- **Новая таблица** → добавь `CREATE TABLE IF NOT EXISTS` в `database/schema.sql`

## Запуск через Docker

Самый простой и надежный способ запустить всю панель (как бэкенд, так и фронтенд) в едином контейнере с автоматическим сохранением данных.

### Запуск
1. Убедитесь, что файл `backend/.env` настроен (скопирован из `.env.example`).
2. В корневой директории проекта выполните команду:
   ```bash
   docker compose up -d --build
   ```
3. Откройте панель управления в браузере: [http://localhost:8000](http://localhost:8000)

### Остановка
Чтобы остановить контейнер, выполните:
```bash
docker compose down
```

### Сохранение данных
Все данные монтируются на хост-машину и не теряются при перезапусках контейнера:
* База данных SQLite: `backend/tgpanel.db`
* Сессии аккаунтов Telethon: `backend/sessions/`
* Загруженные медиа и аватарки: `backend/uploads/`

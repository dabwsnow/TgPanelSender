# Используем Debian Bookworm Slim, где есть предкомпилированный python3-pyqt5 для ARM64 (Apple Silicon)
FROM debian:bookworm-slim

# Отключаем интерактивные окна при установке apt пакетов
ENV DEBIAN_FRONTEND=noninteractive

# Устанавливаем Python, PIP, dev-пакеты (Python.h) и предкомпилированный PyQt5
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-dev \
    python3-pip \
    python3-pyqt5 \
    build-essential \
    libsqlite3-dev \
    && rm -rf /var/lib/apt/lists/*

# Создаем рабочую директорию
WORKDIR /app

# Копируем requirements.txt
COPY backend/requirements.txt ./backend/requirements.txt

# Устанавливаем зависимости с флагом --break-system-packages (для Debian 12)
RUN pip3 install --no-cache-dir --break-system-packages -r ./backend/requirements.txt

# Устанавливаем opentele и tgcrypto (PyQt5 уже установлен системно, поэтому pip его пропустит)
RUN pip3 install --no-cache-dir --break-system-packages opentele==1.15.1 tgcrypto==1.2.5

# Копируем код фронтенда и бэкенда
COPY frontend ./frontend
COPY backend ./backend

# Переходим в директорию бэкенда
WORKDIR /app/backend

# Создаем директории для данных
RUN mkdir -p sessions uploads

# Открываем порт
EXPOSE 9999

# Запускаем приложение через системный python3
CMD ["python3", "main.py"]

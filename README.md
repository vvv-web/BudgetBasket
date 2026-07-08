# BudgetBasket

BudgetBasket - это прототип системы сбора и утверждения бюджетирования для модулей компании.
MVP собран без PostgreSQL: данные хранятся в JSON-файлах, а загруженные файлы лежат локально на диске.

## Стек

- Backend: FastAPI, Pydantic, JSON-репозитории
- Frontend: React, TypeScript, Vite, Tailwind, MUI
- Хранилище файлов: `backend/uploads/`
- Запуск: Docker Compose

## Что уже есть

- Авторизация для трёх ролей: администратор, экономист, сотрудник
- Оргструктура, подразделения, ответственные и закрепление модулей
- Заявки бюджетирования с wizard-потоком
- Справочники ДДС и инвест-проектов со строками заявки
- Загрузка, привязка, скачивание файлов и архивирование
- Русский интерфейс с ограничением действий по ролям

## Тестовые пользователи

- Администратор: `admin` / `admin`
- Экономист: `economist` / `economist`
- Сотрудник: `employee` / `employee`

## Запуск через Docker

```bash
docker compose up --build
```

После запуска:

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000
- Swagger: http://localhost:8000/docs

## Локальный запуск backend

```bash
cd backend
python -m pip install -r requirements.txt
uvicorn app.main:app --reload
```

## Локальный запуск frontend

```bash
cd frontend
npm install
npm run dev
```

## Проверки

```bash
cd backend
pytest

cd ../frontend
npm run build
npm test
```

## Структура данных

- `backend/db/init.sql` — каноническая PostgreSQL-схема
- `backend/data/current/` — активные JSON-коллекции MVP
- `backend/data/archive/{year}/` — архив заявок по годам
- `storage/` — локальные uploads/exports

## Ограничения MVP

- Пароли хранятся в открытом виде только для прототипа
- Токены живут в памяти backend-процесса и сбрасываются после перезапуска
- JSON-хранилище не рассчитано на высокую конкурентную запись
- PostgreSQL и SeaweedFS пока не подключены; схема готова в `backend/db/init.sql`

## Путь к будущей замене

Архитектура уже разделена так, чтобы позже без большой переделки заменить JSON-репозитории на PostgreSQL, а локальное хранилище - на объектное хранилище.

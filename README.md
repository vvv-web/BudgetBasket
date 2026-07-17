# BudgetBasket

BudgetBasket — система сбора, согласования и утверждения бюджетных заявок по модулям компании. Сотрудник создаёт заявку и её строки, экономист проверяет и утверждает их, администратор управляет пользователями, модулями и справочниками.

## Содержание

- [Архитектура и ограничения](docs/ARCHITECTURE.md)
- [Справочник команд](COMMANDS.md)
- [Настройка окружения](#настройка-окружения)
- [Запуск через Docker Compose](#запуск-через-docker-compose)
- [Запуск тестов](#запуск-тестов)

## Технологии

- Backend: Python, FastAPI, SQLAlchemy 2.x, Alembic, Pydantic.
- Frontend: React, TypeScript, Vite, MUI.
- База данных: PostgreSQL 16.
- Хранилище вложений: SeaweedFS по S3-совместимому API.
- Проверка вложений: отдельный сервис `file_guard`, структурные проверки форматов и ClamAV.
- Локальное развёртывание: Docker Compose.

## Настройка окружения

Все настройки окружения для Docker Compose находятся в `.env`. Перед первым запуском создайте его на основе `.env.example` и при необходимости замените значения для своего окружения:

```powershell
Copy-Item .env.example .env
```

Не добавляйте `.env` с паролями и ключами в Git. В рабочем окружении обязательно замените значения учётных данных PostgreSQL, S3 и pgAdmin.

## Запуск через Docker Compose

Требования: Docker Desktop с включённым Docker Compose.

```powershell
docker compose up -d --build
docker compose ps
```

При запуске backend автоматически применяет миграции Alembic и создаёт начальные данные.

Доступные сервисы:

| Сервис | Адрес | Назначение |
| --- | --- | --- |
| Frontend | http://localhost:5173 | Веб-интерфейс |
| Backend API | http://localhost:8000 | REST API |
| Swagger UI | http://localhost:8000/docs | Интерактивная документация API |
| PostgreSQL | `localhost:5433` | Подключение к БД с хоста |
| pgAdmin | http://localhost:5050 | Администрирование PostgreSQL |
| SeaweedFS S3 API | http://localhost:8333 | S3-совместимое хранилище |

Проверка готовности:

```powershell
docker compose exec postgres pg_isready -U budgetbasket -d budgetbasket
curl http://localhost:8000/health
curl http://localhost:8000/health/db
docker compose exec file_guard curl --fail http://localhost:8080/ready
```

Тестовые учётные записи:

| Роль | Логин | Пароль |
| --- | --- | --- |
| Администратор | `admin` | `admin` |
| Экономист | `economist` | `economist` |
| Сотрудник | `employee` | `employee` |

Это учётные данные только для локального стенда. Пароли в базе хранятся как PBKDF2-хэши.

Остановка сервисов без удаления данных:

```powershell
docker compose down
```

## Локальная разработка без Docker

Для этого режима должны быть отдельно доступны PostgreSQL, SeaweedFS и `file_guard`. Пример переменных приведён в `.env.example`; для сервисов на хосте используйте `localhost` и внешние порты, например PostgreSQL `5433` и SeaweedFS `8333`.

Backend:

```powershell
cd backend
python -m pip install -r requirements.txt
python -m alembic upgrade head
uvicorn app.main:app --reload
```

Frontend:

```powershell
cd frontend
npm install
npm run dev
```

Для запуска `file_guard` вне Compose требуются его системные зависимости (`libmagic`, при включённой антивирусной проверке — ClamAV). Для локальной разработки без ClamAV явно задайте `FILE_GUARD_ANTIVIRUS_ENABLED=false` и `FILE_GUARD_REQUIRE_ANTIVIRUS=false`.

## Запуск тестов

Запуск всех тестов одной командой из корня репозитория:

```powershell
.\scripts\test-all.ps1
```

Скрипт запускает backend-, `file_guard`- и frontend-тесты и завершится с ошибкой при первой неуспешной проверке. API-тесты backend используют изолированное in-memory хранилище, поэтому PostgreSQL и `TEST_DATABASE_URL` для них не требуются. Для ручного запуска отдельных наборов:

```powershell
cd backend
python -m pytest

cd ..
python -m pytest file_guard/tests

cd frontend
npm test
```

Проверка типов и production-сборка фронтенда выполняется отдельно: `cd frontend; npm run build`.

Проверки backend в запущенном контейнере:

```powershell
docker compose exec backend python -m pytest
docker compose exec backend python -m compileall app
docker compose exec backend alembic current
```

Подробные команды для диагностики, миграций и ежедневной работы — в [COMMANDS.md](COMMANDS.md).

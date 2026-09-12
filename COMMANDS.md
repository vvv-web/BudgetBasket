# Команды BudgetBasket

Команды выполняются из корня репозитория, если не указано иное.

Перед миграцией маршрута ЦФО сформировать read-only отчёт:

```powershell
Get-Content backend/db/cfo_workflow_preflight.sql -Raw |
  docker compose exec -T postgres psql -U budgetbasket -d budgetbasket
```

## Развёртывание и запуск

```powershell
# Создать .env при необходимости и собрать/запустить все сервисы.
Copy-Item .env.example .env
docker compose up -d --build

# Проверить состояние и просмотреть журналы.
docker compose ps
docker compose logs -f backend
docker compose logs -f file_guard
```

Повторный запуск без пересборки:

```powershell
docker compose up -d
```

Остановить контейнеры, сохранив тома с данными:

```powershell
docker compose down
```

## Production (VPS + nginx)

На тестовом FQDN `budgetbasket.acom-offer-desk.ru` API и WebSocket идут через префикс `/api` (см. `deploy/nginx/`). В `.env` на сервере:

```bash
VITE_API_URL=/api
```

После изменения — пересоздать frontend: `docker compose up -d --force-recreate frontend`. Nginx: `deploy/vps/apply-nginx.sh`.


```powershell
docker compose exec postgres pg_isready -U budgetbasket -d budgetbasket
curl http://localhost:8000/health
curl http://localhost:8000/health/db
curl http://localhost:8333
docker compose exec file_guard curl --fail http://localhost:8080/health
docker compose exec file_guard curl --fail http://localhost:8080/ready
```

## Миграции базы данных

Backend применяет миграции при старте контейнера. Для ручного управления:

```powershell
docker compose exec backend alembic current
docker compose exec backend alembic upgrade head
```

Data migrations are not started with the application. Run them deliberately after a backup:

```powershell
docker compose exec backend alembic -c alembic-data.ini current
docker compose exec backend alembic -c alembic-data.ini upgrade head
```

## Тесты и сборка

Все тесты одной командой:

```powershell
.\scripts\test-all.ps1
```

В Docker:

```powershell
docker compose exec backend python -m pytest
docker compose exec backend python -m compileall app
docker compose exec backend alembic current
```

На хосте:

```powershell
cd backend
python -m pytest
python -m compileall app

cd ..
python -m pytest file_guard/tests

cd frontend
npm install
npm test
```

Production-сборка фронтенда:

```powershell
cd frontend
npm run build
```

## Локальный запуск без Docker

Перед запуском подготовьте PostgreSQL, SeaweedFS и `file_guard`, затем настройте переменные из `.env.example` для доступа с хоста.

```powershell
cd backend
python -m pip install -r requirements.txt
python -m alembic upgrade head
uvicorn app.main:app --reload
```

В другом терминале:

```powershell
cd frontend
npm install
npm run dev
```

## Полезные адреса

- Frontend: http://localhost:5173
- Backend и Swagger: http://localhost:8000 и http://localhost:8000/docs
- pgAdmin: http://localhost:5050
- SeaweedFS S3 API: http://localhost:8333
- PostgreSQL с хоста: `localhost:5433`

## Production frontend

```powershell
docker compose -f docker-compose.yml -f docker-compose.production.yml up -d --build frontend-production
curl -I http://localhost:5174/
curl http://localhost:5174/api/health
```

## Воспроизводимый аудит производительности

Команды ниже выполняются внутри backend-контейнера и используют только отдельные базы `budgetbasket_perf_*`:

```powershell
docker compose exec backend python -m scripts.performance_audit --label after --new-api --output /tmp/after.jsonl
docker cp bb-backend:/tmp/after.jsonl docs/performance/after.jsonl
docker compose exec backend python -m scripts.performance_plans
docker compose exec backend python -m scripts.register_contract
```

PostgreSQL-интеграционные проверки требуют явного URL тестовой базы:

```powershell
docker compose exec -e PERFORMANCE_DATABASE_URL=postgresql://budgetbasket:budgetbasket@postgres:5432/budgetbasket_perf_100 backend python -m pytest tests/test_performance_postgres.py
```

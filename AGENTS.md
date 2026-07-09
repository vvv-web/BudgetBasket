# BudgetBasket Agent Guide

This file is the working guide for anyone making changes in this repo. Keep it aligned with the actual codebase, not with assumptions from previous tasks.

## Repo layout and important directories

- `backend/` - FastAPI backend, SQLAlchemy models, Alembic migrations, seed data, tests.
- `backend/app/` - application code.
  - `config.py` - env-driven configuration.
  - `database.py` - SQLAlchemy engine/session wiring.
  - `main.py` - app startup, shutdown, health checks, router registration.
  - `models.py` - ORM models.
  - `routers/` - HTTP endpoints.
  - `services/` - business logic.
  - `repositories/` - database access helpers.
  - `storage.py` - SeaweedFS S3 client helpers.
  - `security.py` - auth and password helpers.
  - `seed.py` - bootstrap/test data.
- `backend/alembic/` - migrations and Alembic environment.
- `backend/db/init.sql` - reference SQL schema. Keep it consistent with migrations.
- `backend/tests/` - API/integration tests.
- `frontend/` - React + TypeScript + Vite UI.
  - `frontend/src/pages/` - page-level screens.
  - `frontend/src/components/` - shared UI pieces.
  - `frontend/src/api/` - HTTP client and API helpers.
  - `frontend/src/types.ts` - shared DTO/types.
- `docker-compose.yml` - local runtime for PostgreSQL, SeaweedFS, backend, frontend, pgAdmin.
- `.env.example` - required environment variables.
- `COMMANDS.md` - quick command reference for setup and daily work.
- `README.md` - project overview and user-facing setup notes.

## How to run the project

Primary local setup uses Docker Compose:

```bash
docker compose up -d --build
docker compose ps
```

Useful service URLs:

- Frontend - `http://localhost:5173`
- Backend API - `http://localhost:8000`
- Swagger - `http://localhost:8000/docs`
- PostgreSQL - `localhost:5433`
- pgAdmin - `http://localhost:5050`
- SeaweedFS S3 API - `http://localhost:8333`

Backend connects to PostgreSQL through `DATABASE_URL` and to SeaweedFS only through the S3-compatible endpoint.

Local development without Docker:

```bash
cd backend
python -m pip install -r requirements.txt
python -m alembic upgrade head
uvicorn app.main:app --reload
```

```bash
cd frontend
npm install
npm run dev
```

## Build, test, and lint commands

Backend:

```bash
cd backend
python -m pytest
python -m compileall app
python -m alembic current
```

Frontend:

```bash
cd frontend
npm test
npm run build
```

There is no separate lint command in the current repository stack. Use the build and test commands above as the validation baseline, and keep code style aligned with the surrounding files.

Docker and service checks:

```bash
docker compose exec postgres pg_isready -U budgetbasket -d budgetbasket
curl http://localhost:8000/health
curl http://localhost:8000/health/db
curl http://localhost:8333
```

## Engineering conventions and PR expectations

- Follow the existing FastAPI + SQLAlchemy + Alembic structure. Do not introduce a new data layer unless the codebase already uses it.
- Keep changes narrow and consistent with the current architecture.
- Preserve the existing import style, naming, and module boundaries.
- Keep env-driven configuration in one place and list new variables in `.env.example`.
- Do not hardcode secrets, credentials, access keys, or tokens.
- Do not reintroduce local JSON/data folders or filesystem storage as runtime state.
- Keep schema changes aligned between ORM models, Alembic migrations, and `backend/db/init.sql`.
- Use pgAdmin for database inspection, not Adminer or MinIO.
- Prefer explicit DTOs and validation over loose request bodies.
- For frontend work, keep the UI data-driven and tied to backend DTOs. Remove any local mock persistence that pretends to be the database.

## Constraints and do-not rules

- No commits unless the user explicitly asks.
- Do not use destructive git commands such as `git reset --hard` or `git checkout --`.
- Do not delete or revert user changes unless the user explicitly requests it.
- Do not add extra timestamps or schema fields that are not part of the agreed schema.
- Do not store passwords in plain text in the database.
- Do not expose internal storage keys to users.
- Do not use SeaweedFS internal service ports in business logic. Only use the S3-compatible API.
- Do not add MinIO.
- Do not add heavy abstraction just because it is possible.
- Do not invent a linting stack if the repo does not have one already.

## What done means and how to verify work

A change is done only when the implementation, docs, and runtime wiring all agree.

Verify at minimum:

```bash
docker compose up -d --build
docker compose ps
docker compose exec postgres pg_isready -U budgetbasket -d budgetbasket
docker compose exec backend alembic current
docker compose exec backend python -m pytest
cd frontend
npm test
npm run build
```

Confirm the app still opens and the key endpoints respond:

- `GET /health`
- `GET /health/db`
- `POST /api/...` endpoints used by the feature

If the change touches files or uploads, also confirm:

- the UI uses backend data instead of local file storage or JSON fixtures;
- uploads go to SeaweedFS through S3-compatible API;
- downloads still work without exposing raw storage keys;
- any new env vars are present in `.env.example`;
- any schema changes are reflected in migrations and the SQL reference file.

## Practical notes

- Short container names are intentional:
  - `bb-postgres`
  - `bb-seaweedfs`
  - `bb-backend`
  - `bb-frontend`
  - `bb-pgadmin`
- Seed/test records may use explicit UUIDs when stable references help tests or docs.
- New API-created rows should rely on database generation where the schema expects it.

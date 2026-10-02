# Contributing to OpenSupport

Thanks for helping improve OpenSupport. Changes should keep organization data isolated, preserve the self-hosted path, and avoid making provider credentials available in browser code.

## Local workflow

1. Install Python 3.12+, `uv`, Node.js 20+, `pnpm`, and Docker Compose.
2. Copy `.env.example` to `.env` and start local services with `docker compose up -d postgres redis qdrant minio`.
3. Run `uv sync --group dev` and `corepack pnpm install --frozen-lockfile`.
4. For a fresh or upgraded database, run `uv run alembic upgrade head`.
5. Run the API with `uv run uvicorn backend.app.main:app --reload --port 8000`, start the ingestion worker with `docker compose up --build ingestion-worker`, and start the dashboard with `corepack pnpm --filter @opensupport/dashboard dev`.

Use `uv run ruff check backend/app backend/alembic`, `corepack pnpm typecheck`, and `corepack pnpm build` before opening a pull request. CI runs these static checks and frontend builds.

## Design guidelines

- Every organization-owned query must be scoped by the authenticated user's organization. Public widget endpoints must validate the configured project origin.
- Do not store raw API keys or webhook signing secrets. Show generated credentials once, store only API key hashes, and encrypt webhook secrets.
- Webhook requests must use HTTPS, reject private network targets, disable redirects, and include an HMAC signature. Do not add arbitrary URL proxy endpoints.
- Add new LLM providers through the `opensupport.providers` entry point interface in `backend/app/services/providers.py`.
- Add database changes as forward Alembic migrations. Back up production data before migration; the initial adoption migration cannot be reversed safely.
- Keep external service configuration in environment variables and update `.env.example` and the operations docs when settings change.

## Pull requests

Describe the user-visible change, deployment impact, and any required environment variables. Include screenshots for dashboard changes. Never include secrets, customer content, generated build output, or local `.env` files.

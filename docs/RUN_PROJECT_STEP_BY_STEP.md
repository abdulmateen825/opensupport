# Start OpenSupport: folders, terminals, and commands

This is the Windows PowerShell startup guide. Follow the steps in order. For detailed feature testing, use [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md).

## 1. Understand the folders

Repository root: `C:\Users\Admin\Desktop\opensupport`

| Folder / file | Purpose | Run a separate terminal? |
| --- | --- | --- |
| `backend/app` | FastAPI API, authentication, chat, and platform endpoints | Yes: Terminal 1 |
| `backend/alembic` | Database migrations | No: run migrations from Terminal 0 |
| `backend/app/workers` | Celery tasks for ingestion and webhook delivery | Yes: Terminals 4 and 5 |
| `backend/tests` | Backend automated tests | No: run tests from Terminal 0 |
| `apps/dashboard` | Support dashboard, knowledge management, agent inbox | Yes: Terminal 2 |
| `apps/widget` | Chat widget and preview page | Yes: Terminal 3 |
| `apps/demo-store` | Optional storefront with the embedded widget | Optional: Terminal 6 |
| `packages/sdk` | Server-side TypeScript API client | No standalone server |
| `packages/shared-types` | Shared TypeScript interfaces | No standalone server |
| `packages/ui` | Shared UI package | No standalone server |
| `docs` | Project guides | No server |
| `.env` | Local backend configuration | Edit once; do not run it |
| `docker-compose.yml` | PostgreSQL, Redis, Qdrant, RustFS, optional container worker | Start from Terminal 0 |

**Every command block below runs from the repository root.** You do not need to change into `backend` or `apps`. The pnpm `--filter` flag selects the app for you. Python imports and `.env` loading rely on the root working directory.

## 2. Prepare your tools (first time only)

Install Python 3.12 or newer, Node.js 20 or newer with Corepack, Git, and Docker Desktop. Start Docker Desktop and wait until its Linux engine is running.

Open a PowerShell terminal in your IDE. Name it **Terminal 0 - Setup and checks**. Run:

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
Get-Location
git --version
python --version
node --version
corepack --version
docker --version
docker compose version
```

If `python` is unavailable but the Windows launcher is installed, try `py --version`. Use a compatible interpreter for the fallback in Step 3.

Install `uv` if you do not already have it:

```powershell
winget install --id astral-sh.uv --exact
```

After installation, close and reopen the IDE terminal (restart the IDE if necessary), then run:

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
uv --version
corepack pnpm --version
```

This repository pins pnpm `9.15.4`. Corepack may download that version on its first invocation. You do not need `corepack enable` or a global pnpm installation for these commands. If `corepack` is missing, install Corepack using your Node.js installation's supported method before continuing.

## 3. Create configuration and install dependencies (first time only)

In **Terminal 0**, run:

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
uv sync --group dev
corepack pnpm install --frozen-lockfile
```

The copy command preserves an existing `.env`. `uv sync` creates the root `.venv` and installs backend dependencies and test tools. pnpm installs all frontend workspace dependencies; do not install each folder separately.

If `uv` is not available, replace `uv sync --group dev` with:

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
if (-not (Test-Path .venv\Scripts\python.exe)) { python -m venv .venv }
& .venv\Scripts\python.exe -m pip install -r requirements-dev.txt
```

If your Python command is `py`, use `py -3.12 -m venv .venv` instead, choosing an installed Python version of 3.12 or newer. All remaining backend commands call the virtual environment interpreter directly; activation is not required.

Open the root `.env` in the editor. For local services, the connection settings should match:

```dotenv
APP_ENV=development
DATABASE_URL=postgresql+asyncpg://opensupport:opensupport@localhost:5432/opensupport
REDIS_URL=redis://localhost:6379/0
QDRANT_URL=http://localhost:6333
S3_ENDPOINT_URL=http://localhost:9000
S3_ACCESS_KEY_ID=opensupport
S3_SECRET_ACCESS_KEY=change-me-now
S3_BUCKET=opensupport
CORS_ORIGINS=http://localhost:3000,http://localhost:3001,http://localhost:3002,http://localhost:5173
```

Keep the other settings copied from `.env.example`. LLM credentials are optional: without a configured key and model, you can test retrieval from saved support content. The browser dashboard defaults to the API at `http://localhost:8000`; the widget preview uses that local API by default too.

The root `.env` is loaded by the backend and worker. The optional storefront uses its own `apps/demo-store/.env.local`, described in Step 7. Restart affected processes after editing environment files.

## 4. Start infrastructure and migrate the database

In **Terminal 0**, run:

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
docker compose config --quiet
docker compose up -d --wait --wait-timeout 120 postgres redis qdrant rustfs
docker compose ps
docker compose exec postgres pg_isready -U opensupport -d opensupport
```

Wait for PostgreSQL to report `accepting connections`. If it is still starting, rerun the last command after a few seconds. `up -d` runs the services in the background, so this terminal remains available.

Then create or upgrade the database tables:

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
& .venv\Scripts\python.exe -m alembic upgrade head
```

Continue only after the migration finishes successfully. Run this migration command again after pulling changes that add migrations.

| Service | Local port | Purpose |
| --- | --- | --- |
| PostgreSQL | 5432 | Application database |
| Redis | 6379 | Task queue and related state |
| Qdrant | 6333 (HTTP), 6334 (gRPC) | Knowledge vectors |
| RustFS | 9000 | S3-compatible document storage |
| RustFS console | 9001 | Storage administration UI |

## 5. Open five application terminals

In the IDE terminal panel, use the **+** button to create separate PowerShell terminals. Give each the name listed below. Run each block in its own terminal and leave that process running. These commands are long-running servers; the terminal will not return to a prompt until you stop the process.

### Terminal 1 - API

Working folder: `C:\Users\Admin\Desktop\opensupport`

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
& .venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --port 8000
```

Wait for `Application startup complete`. Check `http://localhost:8000/health`. Interactive API documentation is at `http://localhost:8000/docs`. Keep this terminal open for API logs.

### Terminal 2 - Dashboard

Working folder: repository root. Selected app: `apps/dashboard`.

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
corepack pnpm --filter @opensupport/dashboard dev --port 3000
```

Wait for Next.js to report it is ready. Open `http://localhost:3000`. Keep this terminal running while you use the dashboard.

### Terminal 3 - Widget preview

Working folder: repository root. Selected app: `apps/widget`.

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
corepack pnpm --filter @opensupport/widget dev --host 0.0.0.0 --port 5173 --strictPort
```

Open `http://localhost:5173`. Initially it asks for a project ID; Step 6 provides it. `--strictPort` prevents Vite from silently selecting a different port if 5173 is occupied.

### Terminal 4 - Background worker

Working folder: repository root. Worker code: `backend/app/workers`.

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
& .venv\Scripts\python.exe -m celery -A backend.app.workers.celery_app.celery_app worker --pool=solo --loglevel=INFO
```

Wait for the worker's `ready` message. Windows uses the `solo` pool. This process handles website/PDF ingestion and webhook deliveries. Read this terminal when a source fails or remains queued.

### Terminal 5 - Retry scheduler

Working folder: repository root.

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
& .venv\Scripts\python.exe -m celery -A backend.app.workers.celery_app.celery_app beat --loglevel=INFO --schedule=.venv/celerybeat-schedule
```

Keep it running alongside Terminal 4. Beat schedules webhook retries; the worker executes them. The schedule file is stored under `.venv`.

### Alternative: run the worker and scheduler in Docker

Use this instead of Terminals 4 and 5. Stop both local Celery processes with Ctrl+C first, then run in **Terminal 0**:

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
docker compose up -d --build ingestion-worker
docker compose logs -f ingestion-worker
```

This container runs both the worker and beat. Ctrl+C stops log streaming; the container remains running. Avoid running the local worker/scheduler and this container simultaneously for this setup.

## 6. Configure your first project and open the chat

1. Open `http://localhost:3000`.
2. Select **Create a new organization**. Enter your organization name, display name, email, and a password of at least 12 characters.
3. In **Knowledge base**, create a project, for example `Demo Support`.
4. Under **Allowed website hosts**, enter `localhost:5173` and select **Save allowed hosts**. Use a hostname with its port, without `http://`.
5. Add a title such as `Returns` and an answer such as `Returns are accepted within 30 days of delivery.` Select **Save help content**.
6. Copy the displayed project ID, or select **Open widget preview**.
7. The widget URL should look like `http://localhost:5173/?project=YOUR_PROJECT_ID`. Replace `YOUR_PROJECT_ID` with the real ID; do not include angle brackets.
8. Ask about returns and check the reply. Request a human, open **Agent inbox** in the dashboard, take the conversation, and send a reply.

Use `localhost` consistently. `127.0.0.1:5173` is a different allowed host from `localhost:5173`.

## 7. Optional Terminal 6 - Demo storefront

Keep the dashboard on 3000 and run the storefront on 3002. In **Terminal 0**, create its configuration:

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
if (-not (Test-Path apps/demo-store/.env.local)) { Copy-Item apps/demo-store/.env.local.example apps/demo-store/.env.local }
```

Open `apps/demo-store/.env.local` in the editor and set:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_OPENSUPPORT_PROJECT_ID=YOUR_PROJECT_ID
```

Replace `YOUR_PROJECT_ID` with the project ID from Step 6. In the dashboard, save `localhost:5173, localhost:3002` as the project's allowed hosts. Ensure the root `.env` CORS list includes `http://localhost:3002` as shown in Step 3, then restart Terminal 1 if you changed that setting.

Open **Terminal 6 - Demo storefront**:

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
corepack pnpm --filter @opensupport/demo-store dev --port 3002
```

Open `http://localhost:3002` and try the embedded widget. Restart the storefront after changing its `.env.local`.

## 8. Run checks in Terminal 0

Leave the application terminals running. Run these checks one at a time:

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
& .venv\Scripts\python.exe -m pytest -q
& .venv\Scripts\python.exe -m ruff check backend/app backend/alembic backend/tests
corepack pnpm typecheck
docker compose config --quiet
Invoke-RestMethod http://localhost:8000/health
```

A check should finish successfully before you move to the next. Unit tests and typechecks do not require running service containers. API health requires Terminal 1 and its dependencies.

For production builds, stop the dashboard and storefront dev servers first with Ctrl+C in Terminals 2 and 6. Next.js dev and build processes write into the same `.next` directory. Then run:

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
corepack pnpm build
```

Restart those dev servers using their Step 5 and Step 7 commands after the build finishes. Use the full feature acceptance checklist in [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md) for integration and end-to-end testing.

## 9. Stop the project

Press Ctrl+C in each application terminal: API, dashboard, widget, worker, scheduler, and optional storefront. Then stop Docker services from **Terminal 0**:

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
docker compose down
```

This preserves named-volume database and storage data. `docker compose down -v` deletes those volumes; it is not part of the normal shutdown procedure.

## 10. Start again on another day

You do not need to reinstall dependencies or recreate `.env` on every run.

1. Start Docker Desktop.
2. Open Terminal 0 and run the Step 4 service and migration commands.
3. Start Terminals 1 through 5 using their exact Step 5 blocks (or use the Docker worker alternative).
4. Start Terminal 6 only if you need the storefront.
5. Open the dashboard and your saved widget URL.

After pulling dependency changes, rerun `uv sync --group dev` and `corepack pnpm install --frozen-lockfile` before starting servers.

## Quick diagnosis

| Problem | Action |
| --- | --- |
| `uv` not recognized | Reopen the terminal after installation, or use the Step 3 pip fallback. |
| `.venv\Scripts\python.exe` missing | Complete Step 3 from the repository root. |
| `No module named backend` | Run `Set-Location C:\Users\Admin\Desktop\opensupport` and retry the API command. |
| Docker cannot connect | Open Docker Desktop and wait for its engine; check `docker info`. |
| Database connection refused | Check `docker compose ps` and PostgreSQL readiness, then run migrations. |
| Port already in use | Stop the previous process using that port. If you change ports, update URLs, CORS, and allowed hosts to match. |
| Widget request rejected | Check its real project ID and exact allowed host; ensure API is running. |
| Website/PDF source stays queued | Check Terminal 4 is ready and connected to Redis; reload the dashboard for updated status. |
| Browser uses old environment settings | Restart the affected server and refresh the page. |

Infrastructure logs (run in Terminal 0; Ctrl+C exits log streaming):

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
docker compose logs --tail 100 postgres redis qdrant rustfs
```

### API startup error: connection refused on port 5432

`OSError ... [Errno 10061] ... localhost:5432` means the API could not connect to PostgreSQL. Start the Docker services before launching the API. The startup command below waits for PostgreSQL's health check instead of returning while the database is still starting:

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
docker compose up -d --wait --wait-timeout 120 postgres redis qdrant rustfs
# Continue only if the command above succeeds.
& .venv\Scripts\python.exe -m alembic upgrade head
```

Then stop the failed API process with Ctrl+C in Terminal 1 and rerun:

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
& .venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --port 8000
```

The dashboard command in Terminal 2 does not start PostgreSQL or the API. If the wait command times out, inspect `docker compose logs --tail 100 postgres` before proceeding.

## Groq chat configuration

Configure Groq in the root `.env`, keeping its key out of browser environment files:

```dotenv
LLM_PROVIDER=openai-compatible
LLM_API_KEY=your-groq-api-key
LLM_BASE_URL=https://api.groq.com/openai/v1
LLM_MODEL=qwen/qwen3.8-27b
EMBEDDING_MODEL=
```

Verified against Groq's current model list on 2026-10-03. Qwen 3.8 27B is a preview model listed under [Groq's free-plan limits](https://console.groq.com/docs/rate-limits); availability and quotas can change. The backend uses instruct mode with hidden reasoning and a 512-token output cap for concise support answers. Leave `EMBEDDING_MODEL` blank for this setup; the project uses its lexical retrieval fallback for document chunks.

Restart the API in Terminal 1 and your worker in Terminal 4 after changing `.env`. If using the Docker worker, recreate it with `docker compose up -d --build ingestion-worker` to load the changed configuration. The storefront still needs only its local API URL and project ID.

Add relevant FAQ content or indexed website/PDF content to the selected project's Knowledge base. An API key enables generated answers from that content; it does not bypass the project's knowledge lookup. Groq free-tier requests can return HTTP 429 when organization token/request limits are reached; wait for the quota reset shown by Groq. A key pasted into chat should be rotated in the Groq console, then replaced locally in `.env`.

# Run and test OpenSupport locally

This guide is for a Windows PowerShell checkout. The API, dashboard, widget, and Celery worker run on your machine; Docker Compose runs PostgreSQL, Redis, Qdrant, and RustFS (S3 storage).

## Prerequisites

- Git
- Python 3.12 or newer; use `uv` or the pip fallback below
- Node.js 20 or newer with Corepack
- Docker Desktop with its Linux container engine running

## Step 1: Open the repository root

Open PowerShell and change to the folder containing `pyproject.toml`, `package.json`, and `docker-compose.yml`:

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
Get-Location
```

The displayed path should end in `\opensupport`. The project commands below run from this root folder. You do not need to `cd` into `backend`, `apps`, or `packages`: `uv` reads the root `pyproject.toml`, pnpm reads the root workspace, and Docker Compose reads the root compose file. The API import path also assumes this root working directory.

## Step 2: Set up Python

`uv` is a separate command line program; it is not installed by opening the repository and will not be found just because you are in the root folder. In PowerShell, install it for your Windows user using either method:

```powershell
winget install --id astral-sh.uv --exact
```

Or use Astral's standalone installer:

```powershell
powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
```

Close PowerShell, open a new PowerShell window, return to the repository root, then verify. If you are using an IDE terminal, close the terminal and open a new one; if it still uses the old environment, restart the IDE too.

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
uv --version
```

If you want to refresh PATH in the current PowerShell window instead of reopening it, run:

```powershell
$env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
Get-Command uv
uv --version
```

If PowerShell still says `uv` is not recognized, check the standalone install location. It normally places `uv.exe` in `$HOME\.local\bin`:

```powershell
Test-Path "$HOME\.local\bin\uv.exe"
```

If that returns `True`, run `& "$HOME\.local\bin\uv.exe" --version` to verify it directly, then add that user folder to your Windows user `PATH` or continue using the full path in place of `uv` below. WinGet installations may use a different folder; restarting PowerShell refreshes the PATH that WinGet updated. (In PowerShell, keep the backslash in `$HOME\.local\bin\uv.exe`.)

The repository's `pyproject.toml` requires Python 3.12 or newer. If a compatible Python is not installed, `uv sync` can provision the required interpreter; otherwise install Python 3.12+ first. If `uv` remains unavailable, use the pip commands in Step 3.

The workspace pins pnpm 9.15.4. You do not need to enable Corepack's global shims (which write into the Node.js installation directory). Run pnpm through Corepack from the repository root:

```powershell
corepack pnpm --version
```

The version should be `9.15.4`.

## Step 3: Configure and install dependencies

In the same root PowerShell window, create the local environment file and install the dependencies:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
uv sync --group dev
corepack pnpm install --frozen-lockfile
```

If `uv` is unavailable, use Python and pip instead of `uv sync`:

```powershell
python --version
if (-not (Test-Path .venv\Scripts\python.exe)) { python -m venv .venv }
pip --python .venv install -r requirements-dev.txt
corepack pnpm install --frozen-lockfile
```

The pinned `requirements-dev.txt` comes from `uv.lock`. Both paths use the root `.venv`. The remaining Python commands below call `.venv\Scripts\python.exe` directly, so they work with either setup. `corepack pnpm ...` selects the pinned pnpm release without a global pnpm install.

## Step 4: Start local services and prepare the database

Make sure Docker Desktop is running, then run these from the repository root:

```powershell
docker compose config --quiet
docker compose up -d postgres redis qdrant rustfs
& .venv\Scripts\python.exe -m alembic upgrade head
```

`docker compose config --quiet` checks the Compose file and local environment before starting services. Keep the `.env` defaults for a local run. Add `LLM_API_KEY` and `LLM_MODEL` only if you want generated answers; without them the assistant uses deterministic retrieval from saved support content. The local provider is `openai-compatible` by default.

## Step 5: Start the application

Open five PowerShell terminals. In each terminal, first run `Set-Location C:\Users\Admin\Desktop\opensupport`, then start the indicated process:

```powershell
# Terminal 1: API
& .venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --port 8000
```

```powershell
# Terminal 2: dashboard
corepack pnpm --filter @opensupport/dashboard dev
```

```powershell
# Terminal 3: widget preview
corepack pnpm --filter @opensupport/widget dev --host 0.0.0.0
```

```powershell
# Terminal 4: knowledge and webhook worker (Windows requires the solo pool)
& .venv\Scripts\python.exe -m celery -A backend.app.workers.celery_app.celery_app worker --pool=solo --loglevel=INFO
```

```powershell
# Terminal 5: scheduled webhook retries (separate from the worker on Windows)
& .venv\Scripts\python.exe -m celery -A backend.app.workers.celery_app.celery_app beat --loglevel=INFO --schedule=.venv/celerybeat-schedule
```

If you prefer the worker inside Docker, stop Terminals 4 and 5 and run `docker compose up -d --build ingestion-worker` from the root instead. Do not run two workers and schedulers for the same local stack.

Open `http://localhost:3000`, register an organization, create a project, and add `localhost:5173` under **Allowed website hosts**. Add an answer in the knowledge base, then open the widget preview URL with `?project=<PROJECT_ID>`.

The API health endpoint is `http://localhost:8000/health`; interactive API documentation is at `http://localhost:8000/docs`.

## Step 6: Run the demo storefront (optional)

The dashboard and demo storefront both use port 3000 by default. After configuring the dashboard, stop it or use another port for the store. In the demo app, configure its local environment and start it:

```powershell
if (-not (Test-Path apps/demo-store/.env.local)) { Copy-Item apps/demo-store/.env.local.example apps/demo-store/.env.local }
# Edit .env.local and set NEXT_PUBLIC_OPENSUPPORT_PROJECT_ID to the dashboard project ID.
corepack pnpm --filter @opensupport/demo-store dev --port 3002
```

If using the demo storefront as the widget host, add `localhost:3002` to the project's allowed website hosts.

## Automated checks

Run the backend tests and lint:

```powershell
& .venv\Scripts\python.exe -m pytest -q
& .venv\Scripts\python.exe -m ruff check backend/app backend/alembic backend/tests
```

Run frontend typechecks and production builds:

```powershell
corepack pnpm typecheck
corepack pnpm build
```

Validate Compose configuration:

```powershell
docker compose config --quiet
```

CI runs backend Ruff and pytest, then the frontend typecheck and production build. The focused backend suite covers password hashing, JWT validation, signed widget identities, project domain normalization, and webhook request schema validation. It does not replace the live service walkthrough below.

## End-to-end smoke test

1. **Workspace and project:** Register a new organization in the dashboard. Create a project and allow the exact origin used by your widget page, such as `localhost:5173`.
2. **Knowledge:** Save a clear FAQ answer, for example: “Returns are accepted within 30 days of delivery.” Ask the widget a matching question and confirm the answer cites the saved source.
3. **Human handoff:** In the widget, send “I need to speak to a human.” Open **Agent inbox**, take the escalated conversation, reply, and resolve it. Confirm the reply appears in the widget and the conversation status changes.
4. **PDF or website ingestion:** Add a public HTTPS help page or upload a small text based PDF. Check that the source status changes to `ready` and a last indexed time appears. Ask a question that can only be answered from that source. `docker compose logs -f ingestion-worker` shows ingestion errors.
5. **Freshness:** Change a page you control, select **Refresh** beside its source, wait for the worker to finish, then ask about the changed content.
6. **Developer tools:** Create an API key and copy it when displayed; it is not shown again. Use it only on a trusted machine. Configure an order status integration if you have a compatible company API.
7. **Webhooks:** Add an HTTPS endpoint you control and subscribe to `conversation.created` or `conversation.escalated`. Trigger that event, inspect its delivery history, and verify the HMAC signature as described in [developer platform](developer-platform.md).

For local dependency and worker diagnosis:

```powershell
docker compose ps
docker compose logs -f postgres redis qdrant rustfs ingestion-worker
```

When using the local worker, read its Terminal 4 output instead of `docker compose logs ingestion-worker`.

To stop containers while keeping their database and index data:

```powershell
docker compose down
```

Do not use `docker compose down -v` unless you intend to permanently delete local service data.

## Environment and safety notes

- Browser widget requests require the exact `Origin` host saved on the project. `localhost:5173` and `127.0.0.1:5173` are different hosts.
- Local service credentials in `.env.example` are for development only. Set unique secrets, HTTPS, private service access, and reviewed migrations before deploying.
- Webhook endpoints must be public HTTPS targets; private and local network destinations are rejected. Use a public HTTPS test endpoint for webhook tests.
- The live smoke test needs Docker Desktop running. The backend unit tests and frontend builds can run without the Docker service stack.

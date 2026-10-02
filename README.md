# OpenSupport

OpenSupport is a self-hosted customer support app with an admin dashboard, embeddable chat widget, agent inbox, source-grounded answers, knowledge ingestion, API keys, and signed webhooks.

## Run locally on Windows

Run every command below from the repository root (the folder containing `pyproject.toml`, `package.json`, and `docker-compose.yml`). Use PowerShell and start Docker Desktop before Step 3.

### 1. Open the project and configure the environment

```powershell
Set-Location C:\Users\Admin\Desktop\opensupport
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
```

The example credentials are for local development. The app works without an LLM key by answering from saved help content. To enable generated answers, set `LLM_API_KEY` and `LLM_MODEL` in `.env`.

### 2. Install dependencies

Requires Python 3.12 or newer, Node.js 20 or newer, Corepack, and Docker Desktop. Install Python packages with **one** of these methods:

```powershell
# Option A: uv (uses uv.lock)
uv sync --group dev
```

```powershell
# Option B: pip, if uv is unavailable (uses requirements-dev.txt)
python --version
if (-not (Test-Path .venv\Scripts\python.exe)) { python -m venv .venv }
pip --python .venv install -r requirements-dev.txt
```

Install the frontend workspace packages:

```powershell
corepack pnpm --version
corepack pnpm install --frozen-lockfile
```

The pinned pnpm version is 9.15.4. `corepack pnpm` does not require `corepack enable` or administrator permissions. If `uv` was just installed and PowerShell cannot find it, open a new terminal or use the pip option.

### 3. Start Docker services and migrate the database

```powershell
docker compose config --quiet
docker compose up -d postgres redis qdrant rustfs
& .venv\Scripts\python.exe -m alembic upgrade head
```

Compose runs PostgreSQL, Redis, Qdrant, and RustFS (S3-compatible file storage). It keeps their data in Docker volumes when you stop the containers.

### 4. Start the app

Open five PowerShell terminals. Run `Set-Location C:\Users\Admin\Desktop\opensupport` in **each** terminal, then run one command per terminal:

```powershell
# Terminal 1: FastAPI, http://localhost:8000
& .venv\Scripts\python.exe -m uvicorn backend.app.main:app --reload --port 8000
```

```powershell
# Terminal 2: dashboard, http://localhost:3000
corepack pnpm --filter @opensupport/dashboard dev
```

```powershell
# Terminal 3: widget preview, http://localhost:5173
corepack pnpm --filter @opensupport/widget dev --host 0.0.0.0
```

```powershell
# Terminal 4: ingestion and webhook worker (Windows solo pool)
& .venv\Scripts\python.exe -m celery -A backend.app.workers.celery_app.celery_app worker --pool=solo --loglevel=INFO
```

```powershell
# Terminal 5: scheduled webhook retries
& .venv\Scripts\python.exe -m celery -A backend.app.workers.celery_app.celery_app beat --loglevel=INFO --schedule=.venv/celerybeat-schedule
```

Celery beat runs separately on Windows because the worker's `--beat` option is unavailable there. You can instead run the worker and beat in Docker with `docker compose up -d --build ingestion-worker`; stop the local worker and beat first.

### 5. Create a project and open the widget

1. Open `http://localhost:3000`, register an organization, and create a support project.
2. Add `localhost:5173` to that project's **Allowed website hosts**.
3. Add a knowledge-base answer, then open `http://localhost:5173/?project=<PROJECT_ID>` with the project ID shown in the dashboard.

To run the optional demo storefront at the same time as the dashboard, add `localhost:3002` to the allowed hosts, configure its project ID, and run this in a sixth root PowerShell terminal:

```powershell
if (-not (Test-Path apps/demo-store/.env.local)) { Copy-Item apps/demo-store/.env.local.example apps/demo-store/.env.local }
# Edit apps/demo-store/.env.local and set NEXT_PUBLIC_OPENSUPPORT_PROJECT_ID.
corepack pnpm --filter @opensupport/demo-store dev --port 3002
```

Open the store at `http://localhost:3002`.

## Check and stop

```powershell
Invoke-RestMethod http://localhost:8000/health
docker compose ps
& .venv\Scripts\python.exe -m pytest -q
& .venv\Scripts\python.exe -m ruff check backend/app backend/alembic backend/tests
corepack pnpm typecheck
corepack pnpm build
```

Press `Ctrl+C` in each app terminal to stop its process. Then run `docker compose down` from the repository root to stop the Docker services while keeping their data. See [local development](docs/LOCAL_DEVELOPMENT.md) for a detailed smoke test and troubleshooting steps.

## Project documentation

- [Architecture, workflows, and portfolio guide](docs/PROJECT_PORTFOLIO_GUIDE.md)
- [Developer API and webhooks](docs/developer-platform.md)
- [Operations and deployment notes](docs/phase-3-operations.md)
- [Contributing](CONTRIBUTING.md)

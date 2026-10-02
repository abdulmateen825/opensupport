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

## Full feature acceptance checklist

Use a disposable organization for this checklist. The dashboard exposes knowledge, inbox, integration, API key, and webhook controls. Membership, analytics, audit, retention, export, source deletion, and verified order lookup are API features; test them through `http://localhost:8000/docs`. Expand an endpoint there to see its exact current request schema. No order lookup form or analytics page is currently provided by the dashboard.

### Authenticate API requests

Register through the dashboard first. For repeatable PowerShell checks, obtain a separate login token:

```powershell
$loginBody = @{ email = 'tester@example.com'; password = 'your-test-password' } | ConvertTo-Json
$sessionResult = Invoke-RestMethod -Method Post -Uri http://localhost:8000/api/auth/login -ContentType 'application/json' -Body $loginBody
$authHeaders = @{ Authorization = "Bearer $($sessionResult.access_token)" }
Invoke-RestMethod -Uri http://localhost:8000/api/auth/me -Headers $authHeaders
$projectList = Invoke-RestMethod -Uri http://localhost:8000/api/projects -Headers $authHeaders
$testProjectId = $projectList[0].id
```

Use your registered email and password. In Swagger, select **Authorize** and enter the access token if an authorization control is present; otherwise use PowerShell with `$authHeaders`. Tokens and one-time secrets should remain in your local terminal.

### Accounts, organizations, and permissions

| Feature | Procedure | Expected result |
| --- | --- | --- |
| Registration | Create a workspace with a unique email and a password of at least 12 characters. Repeat with the same email. | First registration opens the workspace; duplicate registration is rejected. |
| Login / logout | Sign out, try an incorrect password, then the correct password. | Incorrect login shows an error; correct login restores access. |
| Refresh | POST `/api/auth/refresh` with the refresh token from login, following the Swagger schema. | New tokens are returned; reuse of the old refresh token fails. |
| Membership | GET and POST `/api/organization/members` as an owner; create a test agent. | The member appears in the organization. An agent cannot create members or API keys. |
| Isolation | Register a second organization and request the first organization's project or conversation using the second token. | The resource is inaccessible; the second workspace lists only its own resources. |
| API keys | Create a key in Developer tools, copy it once, use it as a Bearer token for GET `/api/projects`, then revoke it and repeat. | Key works before revocation; revoked key is rejected. |

### Projects and knowledge

| Feature | Procedure | Expected result |
| --- | --- | --- |
| Projects | Create two named projects and switch between them. | Saved answers and source lists match the selected project. |
| Allowed hosts | Save `localhost:5173`; load the widget from that host, then from an unlisted host. | Allowed origin can start a conversation; unlisted origin is rejected. |
| FAQ | Save a unique answer of at least 10 characters. Ask a matching question in the widget. | Reply uses the saved information and identifies its source. |
| Website ingestion | Add a public help URL, leave the worker running, and reload the knowledge view. | Source progresses to `ready`, or reports a useful failure; indexed content answers a specific question. |
| PDF ingestion | Upload a small text-based PDF, then ask about text unique to it. | Source reaches `ready` and its text is retrievable. Scanned PDFs need OCR before upload. |
| Source refresh | Modify a page you control, click Refresh, then reload the knowledge view after the worker completes. | Indexed timestamp updates and new text is retrievable. Source status does not automatically poll. |
| Source deletion | DELETE `/api/projects/{project_id}/sources/{source_id}` through the API. | Source disappears from the list and its indexed chunks are removed. |
| Validation | Submit an invalid URL, a non-PDF file, and a private-network website URL. | Invalid inputs are rejected or visibly fail indexing; they do not become ready sources. |

### Conversations and realtime support

1. Open `http://localhost:5173/?project=<PROJECT_ID>` with the preview server running.
2. Send a supported question. Confirm your message and the assistant reply appear once, with the source when available.
3. Request a human. Confirm the conversation becomes escalated and appears in Agent inbox.
4. Take the conversation, reply, and verify the widget receives the reply without refreshing.
5. Open another agent session to check online presence and assignment visibility.
6. Resolve the conversation, select the Resolved filter, then reopen it and send another reply.
7. Search for a unique message phrase and test each status filter. Results should match the query and filter.
8. Refresh the widget page. The conversation should resume from local storage. Use its new conversation control to start a separate conversation.
9. Briefly restart the API. Once available, check the inbox reconnects and new replies arrive. Inspect browser Network/WebSocket frames if realtime updates stall.

### Order integration and verified visitors

Configure an order status integration in Developer tools for the active project. The company API must implement `GET /orders/{order_id}`, accept a Bearer integration token and `X-Verified-Customer-ID`, enforce order ownership itself, and return JSON. OpenSupport forwards only `status`, `updated_at`, `estimated_delivery`, `total`, and `currency`. Local HTTP integration URLs are accepted only for `localhost` or `127.0.0.1` in development.

A normal anonymous preview cannot retrieve orders. Generate a signed visitor identity on a trusted server using `backend.app.core.security.create_widget_identity(UUID(project_id), visitor_id)` with the same server configuration as the API, pass it as `identityToken` to `ChatWidget` or the fourth argument of `mountOpenSupportWidget`, and create a new conversation. POST `/api/widget/conversations/{conversation_id}/tools/order-status` using the request fields shown in Swagger, the conversation ID returned on creation and its allowed Origin header. Confirm a matching visitor can see their own order, an anonymous visitor is denied, and another visitor cannot retrieve that order. Remove the integration and confirm lookup no longer succeeds.

### Webhooks, retries, and SDK

- Create a public HTTPS webhook subscribed to `conversation.created`, `conversation.escalated`, `message.created`, and `conversation.resolved`. Copy the signing secret when shown.
- Trigger each event and inspect delivery history in Developer tools. Confirm the receiver sees the event and verifies the signature against the exact raw request bytes using [developer-platform.md](developer-platform.md).
- Make the receiver return a failure, trigger an event, and inspect attempts and errors. Restore a successful response and use Retry; reload Developer tools to verify delivery succeeds. Keep both the worker and beat process running for scheduled retries.
- Delete the endpoint and confirm future events are no longer delivered to it.
- From a server-side TypeScript app, instantiate `OpenSupportClient` from `@opensupport/sdk` with the API base URL and a test API key. Exercise `listProjects`, `listConversations`, `listMessages`, and `reply` against the test conversation. Check an invalid key produces an error. The SDK currently provides these four methods.

### Analytics, audit, export, and retention

```powershell
Invoke-RestMethod -Uri http://localhost:8000/api/analytics/overview -Headers $authHeaders
Invoke-RestMethod -Uri http://localhost:8000/api/audit/events -Headers $authHeaders
Invoke-RestMethod -Uri http://localhost:8000/api/organization/retention -Headers $authHeaders
Invoke-RestMethod -Uri http://localhost:8000/api/organization/export -Headers $authHeaders | ConvertTo-Json -Depth 20 | Set-Content -Encoding utf8 local-test-export.json
```

After creating, assigning, escalating, and resolving test conversations, confirm analytics reflects the available metrics and audit records include performed administrative actions. Inspect the export for only the current organization's data, then delete the local export when finished.

For retention, use a separate disposable organization. PATCH `/api/organization/retention` according to Swagger, create old disposable records in your test database, and POST `/api/organization/retention/prune`. Verify eligible old records are pruned and recent records remain. Pruning deletes data; use test fixtures, never a workspace you need to keep.

### Optional external providers

With no LLM key/model, verify deterministic retrieval and human handoff first. To test generated answers, supply your provider configuration in `.env`, restart the API and worker, and repeat the FAQ and ingestion tests. Confirm unsupported questions do not invent company policy. If configured, trigger an escalation and inspect the notification inbox; external notification delivery requires working Resend credentials and an allowed sender.

## Troubleshooting and test evidence

| Symptom | Check / action |
| --- | --- |
| API will not start | Run from repository root; check `.venv`, `.env`, PostgreSQL availability, and completed migrations. |
| Dashboard cannot reach API | Check `http://localhost:8000/health`, browser Network errors, and CORS origins. Dashboard API configuration is in `apps/dashboard/app/api.ts`. |
| Port already occupied | Stop the previous process or choose a new port and update the corresponding API URL, allowed hosts, and CORS settings. |
| Source remains queued | Check the worker is connected to the same Redis/database/storage configuration as the API. Reload the view to fetch its latest status. |
| PDF fails | Check it contains selectable text; inspect the source error, worker logs, and RustFS availability. |
| Widget gets 403 | Confirm exact allowed host and the correct project ID. Inspect the project ID, conversation ID, and Origin in Network requests. |
| Realtime reply missing | Check WebSocket connections to port 8000 and that the agent belongs to the same organization. |
| Webhook never retries | Check worker and beat, delivery errors, and the public receiver's HTTPS availability. |
| Build cannot fetch fonts | The demo app may need network access during its Next.js build; inspect the first build error. |

Record the commit hash (`git rev-parse HEAD`), command exit codes, service versions, and pass/fail for each checklist item. Automated checks cover only the focused unit suite and frontend compilation; passing them does not prove service-backed flows. Mark external-provider and integration tests as skipped when no configured test service exists.

For a clean restart that preserves data, stop local processes with Ctrl+C, run `docker compose down`, then repeat Steps 4 and 5. To inspect container health use `docker compose ps`; to verify the API use `Invoke-RestMethod http://localhost:8000/health`.

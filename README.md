# OpenSupport

[![CI](https://github.com/abdulmateen825/opensupport/actions/workflows/ci.yml/badge.svg)](https://github.com/abdulmateen825/opensupport/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Self-hosted customer support with a React chat widget, an agent inbox, tenant-scoped knowledge answers, human handoff, and optional store integrations. Licensed under [MIT](LICENSE).

**The default widget is support chat only.** Order tracking, product discovery, cart additions, and product-page navigation are enabled only when the website supplies their SDK callbacks. Searching and previewing never add products to a cart.

## Features

- Organization accounts, project configuration, agent assignment, conversation history, and human handoff.
- Help-content ingestion from text, public web pages, and PDFs; optional embeddings and LLM-generated answers.
- API keys, signed webhooks, retries, and tenant-scoped REST APIs.
- Opt-in discovery: AI extracts intent, the store filters its real catalog, and malformed responses or outages use labeled keyword fallback.
- Opt-in cart additions with quantity checks and duplicate-click protection; the store owns pricing, inventory, authorization, and its existing cart.
- Opt-in tracking and product navigation; protected order lookups require verified customer identity.
- A fictional Northstar store with sample orders, a persisted local bag, product pages, and generated imagery. It processes no real payments.

## Requirements

| Component | Requirement |
| --- | --- |
| Node.js | 24.x LTS; used by CI and native TypeScript shopping tests |
| Package manager | Corepack and pnpm 9.15.4, pinned in `package.json` |
| Python | 3.12 or newer; CI uses 3.12 |
| Python dependencies | `uv` with `uv.lock`, or exported `requirements-dev.txt` |
| Infrastructure | Docker Engine/Desktop with Compose v2; PostgreSQL, Redis, Qdrant, S3-compatible storage |
| Browser | Current browser with native `<dialog>`, Fetch, and WebSocket support |
| React integration | React and ReactDOM 19; a bundler able to load the widget CSS |
| Production | Linux host, public DNS, HTTPS, private infrastructure, backups |

Install Node, Python, Docker and uv first. If `corepack` is unavailable, install it with `npm install --global corepack`. Use pnpm for this workspace; do not mix npm/yarn lockfiles. An LLM account is optional: source retrieval and deterministic shopping fallback work without one.

## Local setup

Run commands from the repository root. Start Docker Desktop first on Windows.

```sh
git clone https://github.com/abdulmateen825/opensupport.git
cd opensupport
corepack pnpm install --frozen-lockfile
uv sync --locked --group dev
```

Configure missing settings without replacing existing values or printing credentials:

```powershell
# Windows PowerShell
& .venv\Scripts\python.exe scripts/configure_env.py
```

```sh
# Linux/macOS
.venv/bin/python scripts/configure_env.py
```

The script creates/fills `.env`, `apps/dashboard/.env.local`, and `apps/demo-store/.env.local` from their examples. It generates signing/encryption secrets only when their keys are absent; existing values are preserved. Edit the files afterwards. Root `.env` configures Python; Next.js reads each app's `.env.local`. Real environment files are ignored by Git and excluded from Docker build contexts.

For legacy files, missing encryption/identity secrets preserve an existing `APP_SECRET_KEY` fallback instead of silently rotating stored credentials. Production requires distinct strong keys; keep the existing encryption key and rotate/reissue signing credentials deliberately. Development credentials must be replaced before production, and encrypted integrations must be reconfigured if their encryption key changes.

If uv is unavailable, use `python -m venv .venv`, then the virtual environment's Python to run `-m pip install -r requirements-dev.txt` and the commands below instead of `uv run`.

```sh
docker compose config --quiet
docker compose up -d --wait postgres redis qdrant rustfs
uv run alembic upgrade head
```

Use a separate terminal for each long-running process:

```sh
# API
uv run uvicorn backend.app.main:app --reload --port 8000
```

```sh
# Dashboard
corepack pnpm --filter @opensupport/dashboard dev --port 3000
```

```sh
# Optional standalone widget preview
corepack pnpm --filter @opensupport/widget dev --port 5173
```

```sh
# Optional fictional store
corepack pnpm --filter @opensupport/demo-store dev --port 3002
```

```sh
# Celery worker: --pool=solo supports Windows; omit it on Linux for concurrency
uv run celery -A backend.app.workers.celery_app.celery_app worker --pool=solo --loglevel=INFO
```

```sh
# Exactly one scheduler
uv run celery -A backend.app.workers.celery_app.celery_app beat --loglevel=INFO --schedule=.venv/celerybeat-schedule
```

Alternatively, run the worker and scheduler together locally with `docker compose up -d --build ingestion-worker`; stop any local worker/beat first. The production configuration separates them.

| Local service | Address |
| --- | --- |
| Dashboard | http://localhost:3000 |
| API / API reference | http://localhost:8000 / http://localhost:8000/docs |
| Widget preview | http://localhost:5173/?project=PROJECT_ID |
| Demo store | http://localhost:3002/?project=PROJECT_ID |

Register an account in the dashboard, create a project, add your exact website hosts (for example `localhost:5173` and `localhost:3002`), and add help content. Set the demo project through its query parameter or `NEXT_PUBLIC_OPENSUPPORT_PROJECT_ID`. Add dashboard origins to `CORS_ORIGINS`; widget access is separately validated against each project's allowed hosts.

Stop app processes with Ctrl+C. `docker compose down` stops local infrastructure while preserving volumes. See [local development](docs/LOCAL_DEVELOPMENT.md) for troubleshooting.

## SDK integration

These are workspace/source packages in this repository; these instructions do not assume an npm release. Build the widget with `corepack pnpm --filter @opensupport/widget build`. Its ESM/UMD bundles and CSS are in `apps/widget/dist`; serve them with your application. React and ReactDOM are external dependencies of the widget bundle. A bundler using the source workspace package can import:

```tsx
import { ChatWidget } from "@opensupport/widget";

// Support chat only: no default tracking, shopping, cart, or redirects.
<ChatWidget projectId={projectId} apiUrl="https://api.example.com" />;
```

Opt in to only the features your website implements:

```tsx
import { ChatWidget, type ShoppingAdapter } from "@opensupport/widget";

const shopping: ShoppingAdapter = {
  searchProducts: (query, signal) => catalogApi.search(query, signal),
  getProduct: (id, signal) => catalogApi.getProduct(id, signal),
  // Optional: omit to make search and previews read-only.
  addToCart: (selection) => existingCart.add(selection),
  // Optional: the host resolves a verified ID to its canonical page.
  navigateToProduct: (id) => router.push(`/products/${encodeURIComponent(id)}`),
};

<ChatWidget
  projectId={projectId}
  apiUrl="https://api.example.com"
  identityToken={shortLivedServerIssuedIdentity}
  orderLookup={(orderId) => yourAuthenticatedOrderApi.lookup(orderId)}
  shoppingAdapter={shopping}
/>;
```

`catalogApi`, `existingCart`, `router`, and `yourAuthenticatedOrderApi` represent your website's implementations, not built-in services. `searchProducts` returns actual `products`, `mode: "ai" | "keyword"`, and optional clarification. `getProduct` returns authoritative details. Cart selections contain only `productId`, integer `quantity`, and an optional real `variantId`; derive price and verify availability/ownership on your server. Return `{ message, itemCount? }` after updating the existing cart.

Matching products are shown before the customer explicitly adds one. Product-page buttons appear only with a navigation callback. “Open the bottle product page” may navigate directly with exactly one verified match; multiple matches stay visible for selection. Search alone never redirects or adds to cart. AI output cannot supply URLs or execute cart actions.

For non-component mounting:

```ts
import { mountOpenSupportWidget } from "@opensupport/widget";

const unmount = mountOpenSupportWidget(
  document.getElementById("support-chat")!, projectId,
  "https://api.example.com", identityToken,
  { shoppingAdapter: shopping, orderLookup: (id) => yourAuthenticatedOrderApi.lookup(id) },
);
```

Do not ship API keys, provider keys, or identity-signing secrets in browser code. For OpenSupport's protected order-status endpoint, configure the server-side integration and issue signed visitor identity on a trusted backend. SDK callbacks are capability opt-ins, not authorization. See [the integration guide](docs/product-discovery.md), [developer APIs](docs/developer-platform.md), and [identity/operations](docs/phase-3-operations.md).

`@opensupport/sdk` is a separate server-side REST client. Its API key stays server-side:

```ts
import { OpenSupportClient } from "@opensupport/sdk";
const client = new OpenSupportClient({ baseUrl: apiUrl, apiKey: serverApiKey });
const projects = await client.listProjects();
```

## Environment configuration

Commented templates: [.env.example](.env.example), [dashboard env](apps/dashboard/.env.local.example), [store env](apps/demo-store/.env.local.example), [.env.production.example](.env.production.example).

| Settings | Purpose |
| --- | --- |
| `APP_ENV` | `development` locally; `production` disables automatic schema changes and validates secrets/origins |
| `APP_SECRET_KEY`, `ENCRYPTION_KEY`, `WIDGET_IDENTITY_SECRET` | Distinct random secrets of at least 32 characters in production |
| `DATABASE_URL`, `REDIS_URL`, `QDRANT_URL` | Backend and worker connections |
| `S3_ENDPOINT_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_BUCKET` | S3-compatible uploads; current client uses `us-east-1` |
| `CORS_ORIGINS` | Exact dashboard origins; explicit HTTPS origins in production |
| `ACCESS_TOKEN_MINUTES`, `REFRESH_TOKEN_DAYS`, `IDENTITY_TOKEN_MINUTES` | Token lifetime settings |
| `PUBLIC_RATE_LIMIT`, `AUTH_RATE_LIMIT`, `INGESTION_MAX_BYTES` | Request and upload limits |
| `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL` | Optional server-side generated answers and shopping intent |
| `EMBEDDING_MODEL` | Optional vector retrieval; otherwise tenant-scoped text matching |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `ESCALATION_NOTIFICATION_EMAIL` | Optional escalation notifications |
| `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_OPENSUPPORT_PROJECT_ID` | Public browser configuration; embedded by Next.js at build time |
| `OPENSUPPORT_API_URL` | Demo store's server-only backend override |

AI shopping sends only the current query and category vocabulary to the provider, without chat history, cart contents, order details, identity tokens, or visitor IDs. The customer may put personal data in the query; apply your provider's privacy terms. Missing configuration and invalid/provider-failure output use explicitly labeled keyword fallback.

## Deployment

Use [the production guide](docs/PRODUCTION_DEPLOYMENT.md) and [compose.production.yml](compose.production.yml) for a single-host HTTPS installation with private service ports, non-root app containers, explicit migrations, a worker, a separate scheduler, and persistent volumes. Copy `.env.production.example` to `.env.production`, configure domains/secrets and exact storage image versions, then follow the guide. Development Compose is not a production deployment.

The demo is a test application, not a payment system. Integrate the SDK with your real storefront and commerce backend for sales. Read [SECURITY.md](SECURITY.md) before exposing the app.

## Validation

```sh
uv run pytest -q
uv run ruff check backend/app backend/alembic backend/tests scripts
corepack pnpm lint
corepack pnpm typecheck
corepack pnpm test:shopping
corepack pnpm build
node --test apps/widget/tests/capabilities.smoke.mjs
```

CI runs these checks with locked dependencies. Tests cover security boundaries, knowledge/support behavior, protected order lookup, intent validation/fallback, catalog filters, quantity/pricing checks, navigation opt-ins, and duplicate additions. Browser smoke testing and restore tests remain deployment acceptance steps; a passing build is not production certification.

Try “Find me a gift under $50”, “Show me bottles under $40”, “Open the bottle product page”, and “I want a human”. Previewing leaves the bag unchanged; explicit additions persist across refresh and page navigation. Generate a fictional order and track it. Remove SDK callbacks to verify their controls disappear.

## Repository and contribution

| Path | Contents |
| --- | --- |
| `backend/` | FastAPI, SQLAlchemy, migrations, Celery, tests |
| `apps/dashboard/` | Dashboard and agent inbox |
| `apps/widget/` | React widget and opt-in contracts |
| `apps/demo-store/` | Fictional catalog, adapters, product pages, sample orders |
| `packages/sdk/`, `packages/shared-types/` | Server client and shared API types |
| `deploy/production/` | Dashboard Dockerfile and HTTPS proxy |
| `scripts/` | Environment setup helpers |

See [CONTRIBUTING.md](CONTRIBUTING.md) and report vulnerabilities privately through [SECURITY.md](SECURITY.md). Third-party dependencies retain their licenses. Generated images are described in [the product guide](docs/product-discovery.md).

Operating limits: one API process/replica for its in-process socket hub, exactly one Celery beat, and browser-local dashboard tokens. No independent security audit, HTTP-only refresh-cookie migration, or live payment/inventory integration has been completed. These constraints and backup/upgrade requirements are documented in the production guide.

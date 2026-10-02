# Task 3: organization and tenant operations

## Tenant setup

Each account belongs to one organization. Owners can add admins and agents with `POST /api/organization/members`; project, conversation, analytics, source, integration, audit, export, and retention queries are scoped to the authenticated user's organization. Widget projects also require exact allowed website hosts in `allowed_domains`.

The dashboard stores access and refresh tokens in browser local storage. Use HTTPS, a restrictive Content Security Policy, and protect dashboard origins from injected scripts. A later browser-auth hardening pass should move refresh credentials to secure, HTTP-only cookies.

## Required services

Run PostgreSQL, Redis, Qdrant, and S3-compatible object storage (RustFS for local development). Run the API and a Celery worker with beat from the same backend image. The worker command is:

```sh
celery -A backend.app.workers.celery_app.celery_app worker --beat --loglevel=INFO
```

The worker ingests text, public HTML pages, and PDFs. Set `LLM_API_KEY`, `LLM_MODEL`, and optionally `EMBEDDING_MODEL` for provider generated answers and vector search; without an embedding model, knowledge retrieval falls back to tenant-scoped PostgreSQL text matching.

## Secrets and migrations

Before production, provide unique random values of at least 32 characters for `APP_SECRET_KEY`, `ENCRYPTION_KEY`, and `WIDGET_IDENTITY_SECRET`; set `APP_ENV=production`, configure private database/cache/storage endpoints, and replace the local RustFS credentials. Do not reuse these keys. Integration tokens are encrypted with AES-GCM under `ENCRYPTION_KEY`.

Local startup runs idempotent additive SQL for legacy MVP columns after `create_all`. In production, startup skips automatic schema changes: back up the database and run `uv run alembic upgrade head` before deploying the API and worker. The schema adoption migration is intentionally irreversible; use backups and forward migrations for rollback. The project organization backfill completes before its non-null constraint is applied.

## Signed customer identity for order lookups

An integrating company's trusted server can create a short lived visitor token using `create_widget_identity(project_id, customer_id)` from `backend.app.core.security`, then pass it to the widget as the `identityToken` prop. Never generate this token in browser code or expose `WIDGET_IDENTITY_SECRET`. The order-status integration calls only the configured HTTPS base URL and returns a small allowlist of order fields.

## Retention and export

Owners can set `PATCH /api/organization/retention`, export organization data with `GET /api/organization/export`, and manually run `POST /api/organization/retention/prune`. Automated scheduling of pruning is an operations responsibility. The current prune endpoint removes expired conversations (and their messages through database cascades) and analytics events. API keys, webhooks, provider plugins, and source refresh are documented in [developer platform](developer-platform.md).

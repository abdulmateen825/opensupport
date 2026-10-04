# Production deployment

This guide describes the single-host Linux Compose deployment. It does not deploy anything automatically. Validate the stack in staging before accepting customer traffic.

## Requirements and boundaries

- Linux with Docker Engine and Compose v2, sufficient disk for database/uploads/images, and public DNS for API/dashboard domains. Measure ingestion and user load before sizing production.
- Ports 80 and 443 reachable for HTTPS; restrict SSH separately. Infrastructure has no published ports in the production file.
- One API process/replica: the WebSocket hub is in-memory. Distribute it before horizontal scaling, or live delivery may miss sockets in other processes.
- Exactly one beat scheduler; adjust worker concurrency to ingestion/provider limits.
- Dashboard tokens use local storage. Protect its origin from injected scripts; a tested restrictive CSP and HTTP-only refresh-cookie implementation remain further hardening work.
- No independent security audit. Demo purchases are fictional, not a commerce backend.

## 1. Configure a tested revision

```sh
git clone https://github.com/abdulmateen825/opensupport.git
cd opensupport
# Check out the release/commit tested in your staging environment.
cp .env.production.example .env.production
chmod 600 .env.production
```

Edit `.env.production`. Set `API_DOMAIN`, `DASHBOARD_DOMAIN`, `ACME_EMAIL`, and matching DNS records. Set `NEXT_PUBLIC_API_URL=https://YOUR_API_DOMAIN` and `CORS_ORIGINS=https://YOUR_DASHBOARD_DOMAIN`; additional exact HTTPS dashboard origins may be comma-separated.

Generate separate random `APP_SECRET_KEY`, `ENCRYPTION_KEY`, and `WIDGET_IDENTITY_SECRET` values, a URL-safe `POSTGRES_PASSWORD`, and unique S3 credentials. Generate each value with `python3 -c 'import secrets; print(secrets.token_urlsafe(48))'`, then store it in the protected file or secret manager. Never commit this file, use development credentials, or reuse keys. Preserve encryption keys across upgrades; changing them can make integration secrets unreadable.

Set `QDRANT_IMAGE` and `RUSTFS_IMAGE` to tested exact tags/digests, not `latest`. Official sources: [Qdrant installation](https://qdrant.tech/documentation/guides/installation/) and [RustFS Docker setup](https://docs.rustfs.com/installation/docker/). Pin PostgreSQL, Redis, Caddy, Python and Node base images to reviewed digests in your release process too. Storage image choices are deliberately blank to require operator selection.

Optional LLM/embedding/email values can stay empty. Review provider privacy, licensing, retention, and limits if enabling them. Never pass secrets as frontend build arguments.

## 2. Validate and build

Run the README's repository checks first, then:

```sh
python3 scripts/check_deployment.py
docker compose --env-file .env.production -f compose.production.yml config --quiet
docker compose --env-file .env.production -f compose.production.yml build api dashboard
docker compose --env-file .env.production -f compose.production.yml up -d postgres redis qdrant rustfs
```

Do not print expanded Compose configuration into shared logs: it contains credentials. Backend dependencies use `uv.lock`, migrations include `alembic.ini`, and the app runs as UID 10001. The dashboard uses `pnpm-lock.yaml` and a non-root user. Changing the public API URL requires rebuilding the dashboard because Next.js embeds it during build.

## 3. Migrate before traffic

Take and verify a backup before migrating an existing database:

```sh
docker compose --env-file .env.production -f compose.production.yml run --rm api alembic upgrade head
docker compose --env-file .env.production -f compose.production.yml up -d api worker beat dashboard proxy
docker compose --env-file .env.production -f compose.production.yml ps
```

Production startup does not alter/create tables. Caddy manages HTTPS and WebSocket proxying for configured domains; it exposes 80/443 only. API/dashboard and infrastructure stay on the private Compose network. Only the trusted proxy should reach the API when using its forwarded-header configuration.

An optional isolated backend acceptance test is `python3 scripts/smoke_backend_container.py --image opensupport-backend:local`. It creates temporary private PostgreSQL/Redis/API containers, applies a fresh migration, exercises registration, projects, tenant isolation and shopping fallback, then cleans up its own containers/network. It does not use your production database or environment. CI runs this test against a freshly built backend image.

## 4. Acceptance checks

1. Check `https://YOUR_API_DOMAIN/health`: PostgreSQL/Redis should be healthy. Check Qdrant/S3 and ingestion separately; this endpoint does not certify their readiness.
2. Register an organization, create a project, set exact website hosts, and confirm another host cannot use it.
3. Ingest text/PDF knowledge, observe the worker, and check a source-grounded answer.
4. Test human handoff, agent replies, reconnect, resolution, and new conversations in desktop/mobile browsers.
5. Verify order lookup with real signed visitor identity: one customer must not read another customer's orders. The store backend must validate cart IDs/variants, pricing, stock, quantity, authorization, and idempotency.
6. Test SDK opt-ins: support only with no callbacks; tracking with `orderLookup`; read-only discovery with search/details; cart only with `addToCart`; navigation only with `navigateToProduct`.
7. Check images, keyboard focus/Escape, cart persistence, and product navigation. Searching/previewing must not add; ordinary search must not redirect.
8. Test your provider connection and failures in staging. Automated provider tests are mocked, not proof of a live connection.

## Backups and upgrades

Back up PostgreSQL, S3/RustFS objects, Qdrant collections, and protected configuration/encryption keys. Named volumes are not backups. Keep encrypted off-host copies on a schedule matching recovery objectives.

Database example without binary shell redirection:

```sh
mkdir -p backups
docker compose --env-file .env.production -f compose.production.yml exec -T postgres pg_dump -U opensupport -d opensupport -Fc -f /tmp/opensupport.dump
docker compose --env-file .env.production -f compose.production.yml cp postgres:/tmp/opensupport.dump ./backups/opensupport.dump
```

Restore with `pg_restore` on an isolated installation and verify login, knowledge, encrypted integrations, and identity boundaries. Use storage-provider backup/snapshot tools, keeping database/storage recovery windows consistent.

Upgrade by backing up, selecting a tested revision, reviewing migrations/settings/SDK changes, rebuilding, migrating once, and recreating app containers. Some adoption migrations are irreversible; rollback may require a database backup and matching images/configuration. Do not delete production volumes during normal upgrades.

Monitor latency/errors, database connections, Redis, disk, queues, workers, webhook retries, provider cost/timeouts, and certificate renewal. Schedule retention pruning as an operator responsibility and verify its scope. See [operations](phase-3-operations.md) and [webhooks](developer-platform.md).

## Other hosting arrangements

Managed databases/cache/storage and existing TLS proxies can replace Compose services. Change backend and worker endpoints/network rules together. Use private endpoints and provider-required TLS/authentication. The current S3 client uses `us-east-1`, and Qdrant has no API-key setting; adapt those clients before using managed services requiring other regions or API keys. This sample is not universal managed-cloud configuration.

Container start, migrations, certificates, restore, and live providers require actual services and cannot be verified by source tests. Perform acceptance checks before declaring a deployment ready.

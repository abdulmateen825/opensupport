# Completed app workflows

## Dashboard

Open http://localhost:3000 with the API and infrastructure running. Register a workspace or sign in.

| Screen | Available workflow |
| --- | --- |
| Overview | Organization-wide conversation/message totals, resolution progress, refresh, and shortcuts. |
| Agent inbox | Active-project filter, message search, status filters, assignment, replies, resolution/reopening, online presence, and realtime updates. |
| Knowledge base | Create/rename projects, configure allowed hosts, add/edit/delete approved answers, search/read answers, upload PDFs, add websites, inspect indexing errors, reindex, and delete sources. |
| Chat widget | Allowed-host checklist, project-specific widget/store links, and copyable React installation snippet. |
| Developer tools | Order integrations, API keys, project-scoped webhooks, delivery history, and retries. |
| Workspace settings | Team account creation/directory, saved retention policy, owner-only JSON export and confirmed cleanup, and audit history. |

Administrators and owners can change settings and content. Agents see the inbox, reporting, read-only knowledge, and widget setup. Backend authorization continues to enforce these roles independently of the UI.

New projects allow `localhost:5173` and `localhost:3002` for local testing. Production website hosts still need to be added explicitly.

## Demo storefront

Open http://localhost:3002. Add products to your bag, adjust quantities, and select **Create demo order**. This creates a fictional processing order and opens its tracking result in the chat widget. Cart contents and created orders persist in the same browser. No payment or address is collected.

The four fixed sample orders cover processing, shipped, delivered, and cancelled states. An unknown number shows an order-not-found message. Click **Track order** on any card, use the tracking tab, or send `Track order NS-1002` in chat.

The dashboard's demo-store link supplies the active project in the URL. Without a configured project, the store can still demonstrate cart, checkout, and order tracking. General AI support and human handoff require the running API and a real project.

## Verification and runtime requirements

- `corepack pnpm typecheck` checks the frontend workspace.
- `corepack pnpm build` builds the dashboard, widget, and store.
- `& .venv\Scripts\python.exe -m pytest -q` checks backend behavior, including knowledge edits/deletion and safe order lookup.
- `& .venv\Scripts\python.exe -m ruff check backend/app backend/tests` checks Python lint.

For a full manual smoke test, follow [LOCAL_DEVELOPMENT.md](LOCAL_DEVELOPMENT.md). Database-backed operations require PostgreSQL and migrations. Indexing and webhook delivery require the background worker; scheduled retries require Celery beat. Production order lookup requires an integration and signed customer identity. External email/provider behavior requires its own credentials.

Builds and unit tests do not replace a browser smoke test or verification of live integrations.

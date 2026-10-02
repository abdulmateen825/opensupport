# Developer platform

## API keys

Create keys in the dashboard's **Developer tools** page or with `POST /api/organization/api-keys`. Keys use the `osk_live_` prefix, are displayed once, stored only as SHA-256 hashes, expire after 90 days by default, and inherit the role of the account that created them. Revoke keys from the dashboard or `DELETE /api/organization/api-keys/{id}`. Send keys in `Authorization: Bearer <key>` and keep them on trusted servers.

The workspace TypeScript SDK is in `packages/sdk`; shared request/response types are in `packages/shared-types`. Example:

```ts
import { OpenSupportClient } from "@opensupport/sdk";

const support = new OpenSupportClient({ baseUrl: process.env.OPENSUPPORT_URL!, apiKey: process.env.OPENSUPPORT_API_KEY! });
const projects = await support.listProjects();
```

## Webhooks

Create HTTPS endpoints on the dashboard's **Developer tools** page or through `POST /api/webhooks`. Supported events are `conversation.created`, `conversation.escalated`, `message.created`, and `conversation.resolved`. A signing secret is returned once. Validate `X-OpenSupport-Signature` by computing HMAC-SHA256 over the exact raw request body, and compare it in constant time. `X-OpenSupport-Delivery` is a stable delivery ID; use it for consumer-side idempotency.

Delivery rows record attempts, HTTP status, last error, and delivery time. The Celery beat scheduler requeues due and abandoned deliveries once a minute. Operators can inspect recent delivery history and request a manual retry from the dashboard. Webhook targets must be public HTTPS hosts; redirects are disabled.

## Provider plugins

The built-in `openai-compatible` provider calls the configured chat completions API. Third-party providers can register an `opensupport.providers` Python entry point whose factory accepts the application settings and returns an object with `async complete(system_prompt, user_prompt) -> str`. Set `LLM_PROVIDER` to the registered entry point name. Treat installed providers as trusted code and keep credentials in server-side settings.

## Source freshness

Website and PDF sources show indexing status and timestamp. Administrators can request `POST /api/projects/{project_id}/sources/{source_id}/refresh`; workers replace the old chunks and vectors when a refresh completes. Website sources are refreshed on demand. Schedule refresh requests from an external job runner if your help site changes regularly.

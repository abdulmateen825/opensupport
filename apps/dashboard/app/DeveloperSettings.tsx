"use client";

import { FormEvent, useEffect, useState } from "react";
import { apiFetch } from "./api";

type APIKey = { id: string; name: string; key_prefix: string; expires_at: string | null; last_used_at: string | null; revoked_at: string | null };
type Webhook = { id: string; project_id: string | null; url: string; events: string[]; enabled: boolean };
type Delivery = { id: string; event_type: string; status: string; attempts: number; response_code: number | null; last_error: string | null };
type Integration = { id: string; kind: string; base_url: string; enabled: boolean };

export default function DeveloperSettings({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState(false);
  const [keys, setKeys] = useState<APIKey[]>([]);
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [deliveries, setDeliveries] = useState<Record<string, Delivery[]>>({});
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [events, setEvents] = useState("conversation.created,conversation.escalated");
  const [integrationUrl, setIntegrationUrl] = useState("");
  const [integrationToken, setIntegrationToken] = useState("");
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function safe(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed. Please try again."); }
    finally { setBusy(false); }
  }

  function detail(result: { detail?: unknown }, fallback: string) { return typeof result.detail === "string" ? result.detail : Array.isArray(result.detail) ? result.detail.map((item: { msg?: string }) => item.msg ?? "Invalid value").join("; ") : fallback; }

  async function refresh() {
    const [keyResponse, hookResponse] = await Promise.all([
      apiFetch("/api/organization/api-keys"), apiFetch("/api/webhooks"),
    ]);
    if (!keyResponse.ok || !hookResponse.ok) throw new Error("Could not load developer settings. Please refresh.");
    setKeys(await keyResponse.json());
    if (projectId) {
      const integrationResponse = await apiFetch(`/api/projects/${projectId}/integrations`);
      if (!integrationResponse.ok) throw new Error("Could not load order integrations");
      setIntegrations(await integrationResponse.json());
    } else setIntegrations([]);
    if (hookResponse.ok) {
      const items: Webhook[] = await hookResponse.json(); setWebhooks(items);
      const records = await Promise.all(items.map(async (hook) => {
        const response = await apiFetch(`/api/webhooks/${hook.id}/deliveries`);
        return [hook.id, response.ok ? await response.json() : []] as const;
      }));
      setDeliveries(Object.fromEntries(records));
    }
  }

  useEffect(() => { void safe(refresh); }, [projectId]);

  async function createKey(event: FormEvent) {
    event.preventDefault();
    const response = await apiFetch("/api/organization/api-keys", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, expires_in_days: 90 }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setNotice(typeof result.detail === "string" ? result.detail : "Could not create key"); return; }
    setSecret(result.secret); setName(""); setNotice("Copy this key now; it will not be shown again."); await refresh();
  }

  async function revokeKey(id: string) {
    const response = await apiFetch(`/api/organization/api-keys/${id}`, { method: "DELETE" });
    setNotice(response.ok ? "API key revoked" : "Could not revoke API key"); await refresh();
  }

  async function createWebhook(event: FormEvent) {
    event.preventDefault();
    const response = await apiFetch("/api/webhooks", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: webhookUrl, project_id: projectId || null, events: events.split(",").map((value) => value.trim()).filter(Boolean) }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(detail(result, "Could not create webhook")); return; }
    setSecret(result.signing_secret); setWebhookUrl(""); setNotice("Copy the signing secret now; it will not be shown again."); await refresh();
  }

  async function retry(hookId: string, deliveryId: string) {
    const response = await apiFetch(`/api/webhooks/${hookId}/deliveries/${deliveryId}/retry`, { method: "POST" });
    setNotice(response.ok ? "Delivery queued again" : "Could not queue delivery"); await refresh();
  }

  async function saveIntegration(event: FormEvent) {
    event.preventDefault();
    if (!projectId) { setNotice("Select a project before configuring an integration"); return; }
    const response = await apiFetch(`/api/projects/${projectId}/integrations`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "order_status", base_url: integrationUrl, token: integrationToken }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(detail(result, "Could not save integration")); return; }
    setIntegrationUrl(""); setIntegrationToken(""); setNotice("Order status integration saved"); await refresh();
  }

  return <fieldset className="panel-fieldset" disabled={busy}>
    <div className="intro panel-intro"><div><h2>Connect your support workspace</h2><p>Manage order integrations, API keys, and signed webhooks.</p></div><button onClick={() => void safe(refresh)}>Refresh</button></div>
    {busy && <p role="status">Updating developer tools...</p>}
    {error && <div className="error-notice" role="alert">{error}</div>}
    {notice && <div className="notice" role="status">{notice}</div>}
    {secret && <section className="card sources"><h3>Secret shown once</h3><code className="one-time-secret">{secret}</code><button onClick={() => { void safe(async () => { await navigator.clipboard.writeText(secret); setNotice("Secret copied"); }); }}>Copy secret</button><button className="secondary" onClick={() => setSecret("")}>Dismiss</button></section>}
    {!projectId && <p className="helper-text">Select a project in the header to configure its order integration.</p>}
    <section className="card sources"><div className="card-heading"><h3>Order status integration</h3><span className="pill">Project scoped</span></div><form onSubmit={(event) => { event.preventDefault(); void safe(() => saveIntegration(event)); }}><label htmlFor="integration-url">Company API base URL</label><input id="integration-url" type="url" value={integrationUrl} onChange={(event) => setIntegrationUrl(event.target.value)} placeholder="https://api.example.com" required /><label htmlFor="integration-token">Bearer token</label><input id="integration-token" type="password" value={integrationToken} onChange={(event) => setIntegrationToken(event.target.value)} autoComplete="new-password" required minLength={8} maxLength={1000} /><button disabled={!projectId}>Save integration</button></form>{integrations.map((integration) => <article className="entry" key={integration.id}><div><h4>{integration.kind}</h4><p>{integration.base_url}</p></div><button onClick={() => { if (window.confirm("Remove this order integration?")) void safe(async () => { const response = await apiFetch(`/api/projects/${projectId}/integrations/${integration.id}`, { method: "DELETE" }); if (!response.ok) throw new Error("Could not remove integration"); await refresh(); setNotice("Integration removed"); }); }}>Remove</button></article>)}</section>
    <section className="card sources"><div className="card-heading"><h3>API keys</h3><span className="pill">Bearer keys</span></div><form className="inline-form" onSubmit={(event) => { event.preventDefault(); void safe(() => createKey(event)); }}><input aria-label="API key name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Key name" required maxLength={120} /><button>Create 90 day key</button></form><div className="entry-list">{keys.map((key) => <article className="entry" key={key.id}><div><h4>{key.name}</h4><p><code>{key.key_prefix}…</code> · {key.revoked_at ? "revoked" : key.expires_at ? `expires ${new Date(key.expires_at).toLocaleDateString()}` : "no expiry"}</p></div>{!key.revoked_at && <button onClick={() => { if (window.confirm("Revoke this API key? Connected clients using it will stop working.")) void safe(() => revokeKey(key.id)); }}>Revoke</button>}</article>)}</div></section>
    <section className="card sources"><div className="card-heading"><h3>Signed webhooks</h3><span className="pill">HTTPS only</span></div><form onSubmit={(event) => { event.preventDefault(); void safe(() => createWebhook(event)); }}><label htmlFor="webhook-url">Endpoint URL</label><input id="webhook-url" type="url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} placeholder="https://your-service.example/hooks" required /><label htmlFor="webhook-events">Events</label><input id="webhook-events" value={events} onChange={(event) => setEvents(event.target.value)} required /><small className="helper-text">Available: conversation.created, conversation.escalated, message.created, conversation.resolved</small><p className="helper-text">This webhook applies to {projectId ? "the active project" : "all projects in this organization"}.</p><button>Create webhook</button></form>{webhooks.map((hook) => <div className="entry-list" key={hook.id}><article className="entry"><div><h4>{hook.url}</h4><p>{hook.events.join(", ")}</p></div><button onClick={() => { if (window.confirm("Delete this webhook?")) void safe(async () => { const response = await apiFetch(`/api/webhooks/${hook.id}`, { method: "DELETE" }); if (!response.ok) throw new Error("Could not delete webhook"); await refresh(); setNotice("Webhook deleted"); }); }}>Delete</button></article>{(deliveries[hook.id] ?? []).map((delivery) => <article className="entry" key={delivery.id}><div><h4>{delivery.event_type} · {delivery.status}</h4><p>{delivery.attempts} attempts{delivery.response_code ? ` · HTTP ${delivery.response_code}` : ""}{delivery.last_error ? ` · ${delivery.last_error}` : ""}</p></div>{delivery.status !== "delivered" && <button onClick={() => void safe(() => retry(hook.id, delivery.id))}>Retry</button>}</article>)}</div>)}</section>
  </fieldset>;
}

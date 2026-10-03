"use client";

import { FormEvent, useEffect, useState } from "react";
import { API, jsonBody, request } from "./api";

export type WorkspaceUser = { id: string; email: string; display_name: string; role: string };
type Analytics = { conversations_total: number; open_conversations: number; escalated_conversations: number; resolved_conversations: number; messages_total: number; ai_resolved: number };
type Audit = { id: string; action: string; target_type: string; target_id: string; created_at: string };

export function Overview({ onNavigate }: { onNavigate: (view: "inbox" | "knowledge" | "widget") => void }) {
  const [data, setData] = useState<Analytics | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true); setError("");
    try { setData(await request<Analytics>("/api/analytics/overview")); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load analytics"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const metrics: [string, number][] = data ? [["Conversations", data.conversations_total], ["Open", data.open_conversations], ["Needs an agent", data.escalated_conversations], ["Resolved", data.resolved_conversations], ["Messages", data.messages_total], ["Resolved without assignment", data.ai_resolved]] : [];
  return <><div className="intro panel-intro"><div><h2>Your support at a glance</h2><p>Live totals across every project in your organization.</p></div><button disabled={loading} onClick={() => void load()}>Refresh</button></div>
    {error && <div className="error-notice" role="alert">{error}</div>}{loading && <p role="status">Loading analytics...</p>}
    <div className="metric-grid">{metrics.map(([label, value]) => <article className="card metric" key={label}><span>{label}</span><strong>{value.toLocaleString()}</strong></article>)}</div>
    {data && <section className="card sources"><h3>Resolution progress</h3><p>{data.resolved_conversations} of {data.conversations_total} conversations resolved</p><progress aria-label="Resolved conversations" value={data.resolved_conversations} max={Math.max(1, data.conversations_total)} /><p className="helper-text">{data.conversations_total ? Math.round(data.resolved_conversations / data.conversations_total * 100) : 0}% resolved. Assigned conversations are included in the total.</p></section>}
    <section className="card sources"><h3>Keep your workspace moving</h3><div className="quick-actions"><button onClick={() => onNavigate("inbox")}>Open agent inbox</button><button onClick={() => onNavigate("knowledge")}>Manage help content</button><button onClick={() => onNavigate("widget")}>Install your widget</button></div>{data?.conversations_total === 0 && <p className="helper-text">No conversations yet. Create a project, add approved help content, and open the widget preview to get started.</p>}</section>
  </>;
}

export function OrganizationSettings({ user }: { user: WorkspaceUser }) {
  const [members, setMembers] = useState<WorkspaceUser[]>([]);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [days, setDays] = useState(365);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("agent");
  const [confirmPrune, setConfirmPrune] = useState(false);
  async function load() {
    setLoading(true); setError("");
    try {
      const [team, retention, events] = await Promise.all([request<WorkspaceUser[]>("/api/organization/members"), request<{ retention_days: number }>("/api/organization/retention"), request<Audit[]>("/api/audit/events")]);
      setMembers(team); setDays(retention.retention_days); setAudit(events);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load settings"); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  async function run(action: () => Promise<void>) {
    if (busy) return; setBusy(true); setNotice(""); setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed"); }
    finally { setBusy(false); }
  }
  function createMember(event: FormEvent) {
    event.preventDefault(); void run(async () => {
      await request("/api/organization/members", jsonBody({ display_name: name.trim(), email, password, role }));
      setName(""); setEmail(""); setPassword(""); await load(); setNotice("Team account created. Share the initial password securely with the teammate.");
    });
  }
  async function exportData() {
    const data = await request<unknown>("/api/organization/export");
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "opensupport-workspace.json"; link.click(); URL.revokeObjectURL(url);
    setNotice("Workspace export downloaded.");
  }
  return <><div className="intro panel-intro"><div><h2>People and workspace settings</h2><p>Signed in as {user.display_name} · {user.role}</p></div><button disabled={loading || busy} onClick={() => void load()}>Refresh</button></div>
    {loading && <p role="status">Loading settings...</p>}{notice && <div className="notice" role="status">{notice}</div>}{error && <div className="error-notice" role="alert">{error}</div>}
    <div className="grid"><section className="card"><h3>Add a teammate</h3><p className="helper-text">Create a sign-in account for an administrator or support agent.</p><form onSubmit={createMember}><label>Name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={120} /></label><label>Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label><label>Initial password<input type="password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={12} maxLength={128} /></label><label>Role<select value={role} onChange={(event) => setRole(event.target.value)}><option value="agent">Agent — inbox and reporting</option><option value="admin">Admin — projects and settings</option></select></label><button disabled={busy || loading}>Create account</button></form></section>
    <section className="card"><h3>Team directory</h3>{members.length ? members.map((member) => <article className="entry" key={member.id}><div><h4>{member.display_name}{member.id === user.id ? " (you)" : ""}</h4><p>{member.email}</p></div><span className="pill">{member.role}</span></article>) : <p className="helper-text">No team members loaded.</p>}</section></div>
    <section className="card sources"><h3>Data retention</h3><p className="helper-text">Choose how long to retain conversations and analytics. Saving this setting does not delete data; the owner can run cleanup below.</p><form className="inline-form" onSubmit={(event) => { event.preventDefault(); void run(async () => { await request("/api/organization/retention", jsonBody({ retention_days: days }, "PATCH")); setConfirmPrune(false); setNotice("Retention policy saved."); }); }}><label>Retention in days<input type="number" min={7} max={3650} value={days} onChange={(event) => { setDays(Number(event.target.value)); setConfirmPrune(false); }} required /></label><button disabled={busy || loading}>Save policy</button></form>
      {user.role === "owner" && <div className="quick-actions"><button disabled={busy || loading} onClick={() => void run(exportData)}>Download workspace export</button><button className="danger" disabled={busy || loading} onClick={() => setConfirmPrune(true)}>Clean up expired data</button></div>}
      {confirmPrune && <div className="confirm-box"><p>This permanently deletes conversations and analytics older than the saved retention policy. Download an export first if you need a copy.</p><button className="danger" disabled={busy} onClick={() => void run(async () => { const result = await request<{ conversations_deleted: number }>("/api/organization/retention/prune", { method: "POST" }); setConfirmPrune(false); setNotice(`Cleanup complete: ${result.conversations_deleted} conversations deleted.`); })}>Confirm cleanup</button><button disabled={busy} onClick={() => setConfirmPrune(false)}>Cancel</button></div>}
    </section>
    <section className="card sources"><h3>Audit history</h3><p className="helper-text">The latest 200 workspace events.</p><div className="table-scroll"><table><thead><tr><th>Action</th><th>Resource</th><th>Time</th></tr></thead><tbody>{audit.map((event) => <tr key={event.id}><td>{event.action.replaceAll(".", " · ").replaceAll("_", " ")}</td><td><span title={event.target_id}>{event.target_type} · {event.target_id.slice(0, 8)}</span></td><td>{new Date(event.created_at).toLocaleString()}</td></tr>)}</tbody></table>{!audit.length && <p className="helper-text">No audit events loaded.</p>}</div></section>
  </>;
}

export function WidgetSetup({ projectId, domains }: { projectId: string; domains: string[] }) {
  const [notice, setNotice] = useState("");
  const snippet = `import { mountOpenSupportWidget } from "@opensupport/widget";\n\nmountOpenSupportWidget(\n  document.getElementById("support-chat"),\n  "${projectId}",\n  "${API}"\n);`;
  return <><div className="intro"><h2>Bring support to your website</h2><p>Connect the selected project, then test a customer conversation.</p></div>{notice && <div className="notice" role="status">{notice}</div>}
    {!projectId ? <section className="card empty"><strong>Select a project first</strong><p>Create one in the Knowledge base to configure its widget.</p></section> : <>
      <div className="grid"><section className="card"><h3>1. Allow your website</h3><p className="helper-text">Widget requests must match an allowed hostname and port. Update these in the project settings on the Knowledge base screen.</p><div className="domain-list">{domains.length ? domains.map((domain) => <code key={domain}>{domain}</code>) : <p className="error-notice">No hosts allowed yet. Add localhost:5173 for the preview and localhost:3002 for the demo store.</p>}</div></section><section className="card"><h3>2. Test your assistant</h3><p className="helper-text">Add approved answers before opening a test conversation.</p><a className="preview-link" href={`http://localhost:5173/?project=${encodeURIComponent(projectId)}`} target="_blank" rel="noreferrer">Open widget preview</a><a className="preview-link secondary-link" href={`http://localhost:3002/?project=${encodeURIComponent(projectId)}`} target="_blank" rel="noreferrer">Open demo store</a></section></div>
      <section className="card sources"><h3>3. Install the React widget</h3><p className="helper-text">Use the widget workspace package in your React app. Mount it into an element such as &lt;div id="support-chat"&gt;&lt;/div&gt;.</p><pre className="code-block">{snippet}</pre><button onClick={async () => { try { await navigator.clipboard.writeText(snippet); setNotice("Install snippet copied."); } catch { setNotice("Clipboard unavailable. Select and copy the snippet above."); } }}>Copy snippet</button><p className="helper-text">For customer order tracking, configure an order-status integration in Developer tools and supply a signed identity token from your trusted backend.</p></section>
    </>}</>;
}

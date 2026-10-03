"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { jsonBody, request } from "./api";
import ConfirmDialog from "./ConfirmDialog";
import type { Project } from "./page";

type Knowledge = { id: string; title: string; content: string };
type Source = { id: string; kind: string; title: string; status: string; error: string | null; source_url: string | null; last_indexed_at: string | null };

export default function KnowledgeManager({ project, isAdmin, onProjectChanged }: { project?: Project; isAdmin: boolean; onProjectChanged: (project: Project) => void }) {
  const [entries, setEntries] = useState<Knowledge[]>([]);
  const [sources, setSources] = useState<Source[]>([]);
  const [projectName, setProjectName] = useState("");
  const [rename, setRename] = useState(project?.name ?? "");
  const [domains, setDomains] = useState(project?.allowed_domains.join(", ") ?? "");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<{ id: string; kind: "knowledge" | "sources"; title: string } | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const base = `/api/projects/${project?.id}`;
  async function load() {
    if (!project) return;
    const [answers, documents] = await Promise.all([request<Knowledge[]>(`${base}/knowledge`), request<Source[]>(`${base}/sources`)]);
    if (mounted.current) { setEntries(answers); setSources(documents); }
  }
  useEffect(() => { setLoading(true); void load().catch((cause) => setError(cause instanceof Error ? cause.message : "Could not load help content")).finally(() => setLoading(false)); }, []);
  useEffect(() => {
    if (!sources.some((source) => ["pending", "processing"].includes(source.status))) return;
    const timer = setInterval(() => { void load().catch(() => {}); }, 5000);
    return () => clearInterval(timer);
  }, [sources]);
  async function run(action: () => Promise<void>) {
    if (busy) return; setBusy(true); setNotice(""); setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Request failed"); }
    finally { setBusy(false); }
  }
  function saveAnswer(event: FormEvent) {
    event.preventDefault(); void run(async () => {
      await request(`${base}/knowledge${editing ? `/${editing}` : ""}`, jsonBody({ title: title.trim(), content: content.trim() }, editing ? "PATCH" : "POST"));
      setTitle(""); setContent(""); setEditing(""); await load(); setNotice("Help content saved. Indexing status appears below.");
    });
  }
  function uploadPdf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const file = (form.elements.namedItem("pdf") as HTMLInputElement).files?.[0];
    if (!file) return;
    void run(async () => { const body = new FormData(); body.append("file", file); await request(`${base}/sources/pdf`, { method: "POST", body }); form.reset(); await load(); setNotice("PDF queued for indexing."); });
  }
  const visible = entries.filter((entry) => `${entry.title} ${entry.content}`.toLowerCase().includes(search.toLowerCase()));
  return <><div className="intro"><h2>Teach your assistant</h2><p>Manage approved answers, websites, and documents for {project?.name ?? "your project"}.</p></div>
    {notice && <div className="notice" role="status">{notice}</div>}{error && <div className="error-notice" role="alert">{error}<button disabled={busy} onClick={() => void run(load)}>Retry</button></div>}{loading && <p role="status">Loading help content...</p>}
    {isAdmin && <div className="grid"><section className="card"><h3>Project settings</h3><form className="inline-form" onSubmit={(event) => { event.preventDefault(); void run(async () => { const result = await request<Project>("/api/projects", jsonBody({ name: projectName.trim(), allowed_domains: ["localhost:5173", "localhost:3002"] })); onProjectChanged(result); setProjectName(""); }); }}><input aria-label="New project name" value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="New project name" required maxLength={160} pattern=".*\S.*" /><button disabled={busy}>Create project</button></form>{project && <form onSubmit={(event) => { event.preventDefault(); void run(async () => { const updated = await request<Project>(base, jsonBody({ name: rename.trim(), allowed_domains: domains.split(",").map((domain) => domain.trim()).filter(Boolean) }, "PATCH")); onProjectChanged(updated); setDomains(updated.allowed_domains.join(", ")); setNotice("Project settings saved."); }); }}><label>Project name<input value={rename} onChange={(event) => setRename(event.target.value)} required maxLength={160} pattern=".*\S.*" disabled={busy} /></label><label>Allowed website hosts<input value={domains} onChange={(event) => setDomains(event.target.value)} placeholder="localhost:5173, localhost:3002" disabled={busy} /></label><small className="helper-text">Comma-separated hostnames with optional ports.</small><p className="project-id">Project ID <code>{project.id}</code></p><button disabled={busy}>Save project</button></form>}</section>
    <section className="card" id="answer-editor"><h3>{editing ? "Edit answer" : "Add an answer"}</h3><form onSubmit={saveAnswer}><label>Title<input value={title} onChange={(event) => setTitle(event.target.value)} required maxLength={200} pattern=".*\S.*" disabled={busy} /></label><label>Approved answer<textarea value={content} onChange={(event) => setContent(event.target.value)} required minLength={10} maxLength={50000} rows={5} disabled={busy} /></label><button disabled={busy || !project}>{busy ? "Saving..." : editing ? "Save changes" : "Save answer"}</button>{editing && <button type="button" disabled={busy} onClick={() => { setEditing(""); setTitle(""); setContent(""); }}>Cancel edit</button>}</form></section></div>}
    <section className="card sources"><div className="card-heading"><h3>Saved answers</h3><span className="pill">{entries.length} entries</span></div><input aria-label="Search help content" placeholder="Search answers..." value={search} onChange={(event) => setSearch(event.target.value)} />{visible.length ? visible.map((entry) => <article className="entry" key={entry.id}><div><h4>{entry.title}</h4><details><summary>Read full answer</summary><p className="full-answer">{entry.content}</p></details></div>{isAdmin && <div className="entry-actions"><button disabled={busy} onClick={() => { setEditing(entry.id); setTitle(entry.title); setContent(entry.content); document.getElementById("answer-editor")?.scrollIntoView({ block: "center" }); }}>Edit</button><button className="danger" disabled={busy} onClick={() => setDeleting({ id: entry.id, kind: "knowledge", title: entry.title })}>Delete</button></div>}</article>) : <div className="empty"><strong>{search ? "No matching answers" : "No help content yet"}</strong><p>{project ? "Add an approved answer to get started." : "Select or create a project first."}</p></div>}</section>
    <section className="card sources"><div className="card-heading"><h3>Knowledge sources</h3><button disabled={busy || !project} onClick={() => void run(load)}>Refresh status</button></div>{isAdmin && <div className="grid"><form onSubmit={(event) => { event.preventDefault(); void run(async () => { await request(`${base}/sources/url`, jsonBody({ url: sourceUrl, title: sourceTitle.trim() || sourceUrl })); setSourceUrl(""); setSourceTitle(""); await load(); setNotice("Website queued for indexing."); }); }}><label>Website URL<input type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} required disabled={busy} /></label><label>Display name<input value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} maxLength={240} disabled={busy} /></label><button disabled={busy || !project}>Add website</button></form><form onSubmit={uploadPdf}><label>PDF document<input name="pdf" type="file" accept="application/pdf,.pdf" required disabled={busy} /></label><button disabled={busy || !project}>Upload PDF</button><p className="helper-text">Indexing requires a running background worker. Status updates automatically.</p></form></div>}
      {sources.map((source) => <article className="entry" key={source.id}><div><h4>{source.title}</h4><p>{source.source_url ?? source.kind} · {source.last_indexed_at ? `Indexed ${new Date(source.last_indexed_at).toLocaleString()}` : "Not indexed yet"}</p>{source.error && <p className="source-error">{source.error}</p>}</div><span className={`status-pill status-pill--${source.status}`}>{source.status}</span>{isAdmin && <div className="entry-actions"><button disabled={busy || ["pending", "processing"].includes(source.status)} onClick={() => void run(async () => { await request(`${base}/sources/${source.id}/refresh`, { method: "POST" }); await load(); setNotice("Source refresh queued."); })}>Reindex</button>{source.kind !== "text" && <button className="danger" disabled={busy || source.status === "processing"} onClick={() => setDeleting({ id: source.id, kind: "sources", title: source.title })}>Delete</button>}</div>}</article>)}{!sources.length && <p className="helper-text">No indexed sources yet.</p>}
    </section>
    {deleting && <ConfirmDialog title={`Delete ${deleting.title}?`} busy={busy} onCancel={() => setDeleting(null)}><p>This removes the content and its indexed chunks from this project.</p><div className="quick-actions"><button autoFocus disabled={busy} onClick={() => setDeleting(null)}>Cancel</button><button className="danger" disabled={busy} onClick={() => void run(async () => { await request(`${base}/${deleting.kind}/${deleting.id}`, { method: "DELETE" }); if (editing === deleting.id) { setEditing(""); setTitle(""); setContent(""); } setDeleting(null); await load(); setNotice("Content deleted."); })}>Delete content</button></div></ConfirmDialog>}
  </>;
}

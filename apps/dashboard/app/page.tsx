"use client";

import { FormEvent, useEffect, useState } from "react";
import Inbox from "./Inbox";
import AuthPanel from "./AuthPanel";
import { apiFetch } from "./api";
import DeveloperSettings from "./DeveloperSettings";

type Project = { id: string; name: string; allowed_domains: string[] };
type Knowledge = { id: string; title: string; content: string };
type Source = { id: string; kind: string; title: string; status: string; error: string | null; source_url: string | null; last_indexed_at: string | null };

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState("");
  const [entries, setEntries] = useState<Knowledge[]>([]);
  const [projectName, setProjectName] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<"knowledge" | "inbox" | "developers">("knowledge");
  const [authReady, setAuthReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [domainText, setDomainText] = useState("");
  const [sources, setSources] = useState<Source[]>([]);
  const [sourceUrl, setSourceUrl] = useState("");
  const [sourceTitle, setSourceTitle] = useState("");

  useEffect(() => {
    setAuthenticated(Boolean(localStorage.getItem("opensupport:access-token")));
    setAuthReady(true);
  }, []);

  async function loadProjects() {
    const response = await apiFetch("/api/projects");
    if (!response.ok) throw new Error("OpenSupport API is unavailable");
    const items: Project[] = await response.json();
    setProjects(items);
    const keep = items.some((item) => item.id === selected) ? selected : items[0]?.id ?? "";
    setSelected(keep);
    setDomainText(items.find((item) => item.id === keep)?.allowed_domains.join(", ") ?? "");
    return keep;
  }

  async function loadKnowledge(projectId: string) {
    if (!projectId) { setEntries([]); return; }
    const response = await apiFetch(`/api/projects/${projectId}/knowledge`);
    if (response.ok) setEntries(await response.json());
    const sourceResponse = await apiFetch(`/api/projects/${projectId}/sources`);
    if (sourceResponse.ok) setSources(await sourceResponse.json());
  }

  async function addUrlSource(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const response = await apiFetch(`/api/projects/${selected}/sources/url`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: sourceUrl, title: sourceTitle || sourceUrl }) });
    if (!response.ok) { const body = await response.json().catch(() => ({})); setNotice(body.detail ?? "Couldn't add website source"); return; }
    setSourceUrl(""); setSourceTitle(""); setNotice("Website source queued for indexing"); await loadKnowledge(selected);
  }

  async function uploadPdf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) return;
    const form = event.currentTarget;
    const file = (form.elements.namedItem("pdf") as HTMLInputElement).files?.[0];
    if (!file) return;
    const body = new FormData(); body.append("file", file);
    const response = await apiFetch(`/api/projects/${selected}/sources/pdf`, { method: "POST", body });
    if (!response.ok) { const result = await response.json().catch(() => ({})); setNotice(result.detail ?? "Couldn't upload PDF"); return; }
    setNotice("PDF queued for indexing"); form.reset(); await loadKnowledge(selected);
  }

  async function refreshSource(sourceId: string) {
    const response = await apiFetch(`/api/projects/${selected}/sources/${sourceId}/refresh`, { method: "POST" });
    if (!response.ok) { setNotice("Couldn't queue the source refresh"); return; }
    setNotice("Source refresh queued"); await loadKnowledge(selected);
  }

  useEffect(() => {
    if (authReady && authenticated) void loadProjects().then(loadKnowledge).catch((error: Error) => setNotice(error.message));
  }, [authReady, authenticated]);
  useEffect(() => { void loadKnowledge(selected); }, [selected]);

  async function createProject(event: FormEvent) {
    event.preventDefault();
    try {
      const response = await apiFetch("/api/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: projectName, allowed_domains: domainText.split(",").map((domain) => domain.trim()).filter(Boolean) }) });
      if (!response.ok) throw new Error("Couldn't create project");
      const project: Project = await response.json();
      setProjects((items) => [project, ...items]); setSelected(project.id); setProjectName(""); setNotice("Project created");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Request failed"); }
  }

  async function addKnowledge(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    try {
      const response = await apiFetch(`/api/projects/${selected}/knowledge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, content }) });
      if (!response.ok) throw new Error("Couldn't save help content");
      const entry: Knowledge = await response.json();
      setEntries((items) => [entry, ...items]); setTitle(""); setContent(""); setNotice("Help content saved");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Request failed"); }
  }

  async function saveDomains(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    const response = await apiFetch(`/api/projects/${selected}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allowed_domains: domainText.split(",").map((domain) => domain.trim()).filter(Boolean) }),
    });
    if (!response.ok) { setNotice("Couldn't save the allowed domains"); return; }
    const updated: Project = await response.json();
    setProjects((items) => items.map((item) => item.id === updated.id ? updated : item));
    setNotice("Allowed domains updated");
  }

  function signOut() {
    void apiFetch("/api/auth/logout", { method: "POST" });
    localStorage.removeItem("opensupport:access-token");
    localStorage.removeItem("opensupport:refresh-token");
    setAuthenticated(false);
  }

  if (!authReady) return <main className="auth-screen"><p>Loading workspace…</p></main>;
  if (!authenticated) return <AuthPanel onAuthenticated={() => setAuthenticated(true)} />;

  return <main className="shell">
    <aside className="sidebar"><div className="brand"><span>O</span> OpenSupport</div><p className="nav-label">WORKSPACE</p><button className={`side-link ${view === "inbox" ? "active" : ""}`} onClick={() => setView("inbox")}>Agent inbox</button><button className={`side-link ${view === "knowledge" ? "active" : ""}`} onClick={() => setView("knowledge")}>Knowledge base</button><button className={`side-link ${view === "developers" ? "active" : ""}`} onClick={() => setView("developers")}>Developer tools</button><a href="#widget">Chat widget</a><div className="sidebar-note">Workspace<br />Local development</div></aside>
    <section className="content">
      <header className="topbar"><div><p className="eyebrow">SUPPORT WORKSPACE</p><h1>{view === "inbox" ? "Agent inbox" : view === "developers" ? "Developer tools" : "Knowledge base"}</h1></div><div className="topbar-actions"><span className="connection"><i /> API connected when service is running</span><button onClick={signOut}>Sign out</button></div></header>
      {view === "inbox" ? <Inbox /> : view === "developers" ? <DeveloperSettings projectId={selected} /> : <>
      <div className="intro"><div><h2>Teach your assistant</h2><p>Add trusted answers. The chat widget uses this content to ground its replies.</p></div></div>
      {notice && <div className="notice" role="status">{notice}</div>}
      <div className="grid">
        <section className="card project-card"><div className="card-heading"><div><span className="step">01</span><h3>Project</h3></div><span className="pill">{projects.length} total</span></div><label htmlFor="project">Active project</label><select id="project" value={selected} onChange={(event) => { const id = event.target.value; setSelected(id); setDomainText(projects.find((project) => project.id === id)?.allowed_domains.join(", ") ?? ""); }}><option value="">Select a project</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select><form className="inline-form" onSubmit={createProject}><input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="New project name" required maxLength={160} /><button>Create project</button></form>{selected && <><p className="project-id">Project key <code>{selected}</code></p><form onSubmit={saveDomains}><label htmlFor="domains">Allowed website hosts</label><input id="domains" value={domainText} onChange={(event) => setDomainText(event.target.value)} placeholder="localhost:3000, shop.example.com" /><small className="helper-text">Comma-separated hostnames with optional ports. Widget requests require an exact match.</small><button>Save allowed hosts</button></form></>}</section>
        <section className="card form-card"><div className="card-heading"><div><span className="step">02</span><h3>Add an answer</h3></div><span className="pill">FAQ / text</span></div><form onSubmit={addKnowledge}><label htmlFor="title">Title</label><input id="title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Shipping and returns" required maxLength={200} /><label htmlFor="answer">Answer content</label><textarea id="answer" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Write the approved information your assistant should use..." required minLength={10} maxLength={50000} rows={5} /><button disabled={!selected}>Save help content</button></form></section>
      </div>
      <section className="card sources" id="knowledge"><div className="card-heading"><div><span className="step">03</span><h3>Saved content</h3></div><span className="pill">{entries.length} entries</span></div>{entries.length ? <div className="entry-list">{entries.map((entry) => <article className="entry" key={entry.id}><div><h4>{entry.title}</h4><p>{entry.content}</p></div><span className="source-tag">TEXT</span></article>)}</div> : <div className="empty"><div className="empty-icon">✦</div><strong>No help content yet</strong><p>Select or create a project, then add an approved answer.</p></div>}</section>
      <section className="card sources"><div className="card-heading"><div><span className="step">04</span><h3>Website and PDF sources</h3></div><span className="pill">{sources.length} sources</span></div><div className="grid"><form onSubmit={addUrlSource}><label htmlFor="source-url">Website URL</label><input id="source-url" type="url" value={sourceUrl} onChange={(event) => setSourceUrl(event.target.value)} placeholder="https://example.com/help" required /><label htmlFor="source-title">Display name</label><input id="source-title" value={sourceTitle} onChange={(event) => setSourceTitle(event.target.value)} placeholder="Help center" /><button disabled={!selected}>Add website</button></form><form onSubmit={uploadPdf}><label htmlFor="source-pdf">PDF document</label><input id="source-pdf" name="pdf" type="file" accept="application/pdf,.pdf" required /><button disabled={!selected}>Upload PDF</button></form></div>{sources.length > 0 && <div className="entry-list">{sources.map((source) => <article className="entry" key={source.id}><div><h4>{source.title}</h4><p>{source.source_url ?? source.kind}{source.last_indexed_at ? ` · indexed ${new Date(source.last_indexed_at).toLocaleString()}` : " · not indexed yet"}{source.error ? ` · ${source.error}` : ""}</p></div><span className="source-tag">{source.status.toUpperCase()}</span><button type="button" onClick={() => void refreshSource(source.id)} disabled={!selected || source.status === "processing"}>Refresh</button></article>)}</div>}</section>
      <section className="card widget-card" id="widget"><div className="card-heading"><div><span className="step">05</span><h3>Try the widget</h3></div><span className="pill">Preview</span></div><p>Run the widget app and paste the active Project ID into its demo page to try grounded answers.</p><code>apps/widget · project ID: {selected || "create a project first"}</code></section>
      </>}
    </section>
  </main>;
}

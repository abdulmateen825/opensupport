"use client";

import { FormEvent, useEffect, useState } from "react";
import Inbox from "./Inbox";

type Project = { id: string; name: string };
type Knowledge = { id: string; title: string; content: string };
const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

export default function Home() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState("");
  const [entries, setEntries] = useState<Knowledge[]>([]);
  const [projectName, setProjectName] = useState("");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [notice, setNotice] = useState("");
  const [view, setView] = useState<"knowledge" | "inbox">("knowledge");

  async function loadProjects() {
    const response = await fetch(`${API}/api/projects`);
    if (!response.ok) throw new Error("OpenSupport API is unavailable");
    const items: Project[] = await response.json();
    setProjects(items);
    const keep = items.some((item) => item.id === selected) ? selected : items[0]?.id ?? "";
    setSelected(keep);
    return keep;
  }

  async function loadKnowledge(projectId: string) {
    if (!projectId) { setEntries([]); return; }
    const response = await fetch(`${API}/api/projects/${projectId}/knowledge`);
    if (response.ok) setEntries(await response.json());
  }

  useEffect(() => { void loadProjects().then(loadKnowledge).catch((error: Error) => setNotice(error.message)); }, []);
  useEffect(() => { void loadKnowledge(selected); }, [selected]);

  async function createProject(event: FormEvent) {
    event.preventDefault();
    try {
      const response = await fetch(`${API}/api/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: projectName }) });
      if (!response.ok) throw new Error("Couldn't create project");
      const project: Project = await response.json();
      setProjects((items) => [project, ...items]); setSelected(project.id); setProjectName(""); setNotice("Project created");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Request failed"); }
  }

  async function addKnowledge(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    try {
      const response = await fetch(`${API}/api/projects/${selected}/knowledge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, content }) });
      if (!response.ok) throw new Error("Couldn't save help content");
      const entry: Knowledge = await response.json();
      setEntries((items) => [entry, ...items]); setTitle(""); setContent(""); setNotice("Help content saved");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Request failed"); }
  }

  return <main className="shell">
    <aside className="sidebar"><div className="brand"><span>O</span> OpenSupport</div><p className="nav-label">WORKSPACE</p><button className={`side-link ${view === "inbox" ? "active" : ""}`} onClick={() => setView("inbox")}>Agent inbox</button><button className={`side-link ${view === "knowledge" ? "active" : ""}`} onClick={() => setView("knowledge")}>Knowledge base</button><a href="#widget">Chat widget</a><div className="sidebar-note">MVP workspace<br />Local development</div></aside>
    <section className="content">
      <header className="topbar"><div><p className="eyebrow">SUPPORT WORKSPACE</p><h1>{view === "inbox" ? "Agent inbox" : "Knowledge base"}</h1></div><span className="connection"><i /> API connected when service is running</span></header>
      {view === "inbox" ? <Inbox /> : <>
      <div className="intro"><div><h2>Teach your assistant</h2><p>Add trusted answers. The chat widget uses this content to ground its replies.</p></div></div>
      {notice && <div className="notice" role="status">{notice}</div>}
      <div className="grid">
        <section className="card project-card"><div className="card-heading"><div><span className="step">01</span><h3>Project</h3></div><span className="pill">{projects.length} total</span></div><label htmlFor="project">Active project</label><select id="project" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Select a project</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select><form className="inline-form" onSubmit={createProject}><input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="New project name" required maxLength={160} /><button>Create project</button></form>{selected && <p className="project-id">Project key <code>{selected}</code></p>}</section>
        <section className="card form-card"><div className="card-heading"><div><span className="step">02</span><h3>Add an answer</h3></div><span className="pill">FAQ / text</span></div><form onSubmit={addKnowledge}><label htmlFor="title">Title</label><input id="title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Shipping and returns" required maxLength={200} /><label htmlFor="answer">Answer content</label><textarea id="answer" value={content} onChange={(event) => setContent(event.target.value)} placeholder="Write the approved information your assistant should use..." required minLength={10} maxLength={50000} rows={5} /><button disabled={!selected}>Save help content</button></form></section>
      </div>
      <section className="card sources" id="knowledge"><div className="card-heading"><div><span className="step">03</span><h3>Saved content</h3></div><span className="pill">{entries.length} entries</span></div>{entries.length ? <div className="entry-list">{entries.map((entry) => <article className="entry" key={entry.id}><div><h4>{entry.title}</h4><p>{entry.content}</p></div><span className="source-tag">TEXT</span></article>)}</div> : <div className="empty"><div className="empty-icon">✦</div><strong>No help content yet</strong><p>Select or create a project, then add an approved answer.</p></div>}</section>
      <section className="card widget-card" id="widget"><div className="card-heading"><div><span className="step">04</span><h3>Try the widget</h3></div><span className="pill">Preview</span></div><p>Run the widget app and paste the active Project ID into its demo page to try grounded answers.</p><code>apps/widget · project ID: {selected || "create a project first"}</code></section>
      </>}
    </section>
  </main>;
}

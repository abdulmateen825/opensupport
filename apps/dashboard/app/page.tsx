"use client";

import { useEffect, useState } from "react";
import Inbox from "./Inbox";
import AuthPanel from "./AuthPanel";
import DeveloperSettings from "./DeveloperSettings";
import KnowledgeManager from "./KnowledgeManager";
import { request } from "./api";
import { OrganizationSettings, Overview, WidgetSetup, type WorkspaceUser } from "./WorkspacePanels";

export type Project = { id: string; name: string; allowed_domains: string[] };
type View = "overview" | "knowledge" | "inbox" | "developers" | "widget" | "settings";
const titles: Record<View, string> = { overview: "Overview", inbox: "Agent inbox", knowledge: "Knowledge base", developers: "Developer tools", widget: "Chat widget", settings: "Workspace settings" };

export default function Home() {
  const [user, setUser] = useState<WorkspaceUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authVersion, setAuthVersion] = useState(0);
  const [sessionError, setSessionError] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [selected, setSelected] = useState("");
  const [view, setView] = useState<View>("overview");
  const [error, setError] = useState("");
  const isAdmin = user?.role === "owner" || user?.role === "admin";
  const currentProject = projects.find((project) => project.id === selected);

  useEffect(() => {
    let cancelled = false; setAuthReady(false); setSessionError("");
    if (!localStorage.getItem("opensupport:access-token")) { setUser(null); setAuthReady(true); return; }
    void request<WorkspaceUser>("/api/auth/me").then((result) => { if (!cancelled) setUser(result); }).catch((cause) => {
      if (!cancelled) { setUser(null); if (localStorage.getItem("opensupport:access-token")) setSessionError(cause instanceof Error ? cause.message : "Cannot reach the API"); }
    }).finally(() => { if (!cancelled) setAuthReady(true); });
    return () => { cancelled = true; };
  }, [authVersion]);
  useEffect(() => {
    const expired = () => { setUser(null); setProjects([]); setSelected(""); setView("overview"); };
    window.addEventListener("opensupport:session-expired", expired);
    return () => window.removeEventListener("opensupport:session-expired", expired);
  }, []);
  async function loadProjects() {
    setError("");
    try {
      const items = await request<Project[]>("/api/projects"); setProjects(items);
      setSelected((id) => items.some((project) => project.id === id) ? id : items[0]?.id ?? "");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load projects"); }
  }
  useEffect(() => { if (user) void loadProjects(); }, [user]);
  function signOut() {
    void request("/api/auth/logout", { method: "POST" }).catch(() => {});
    localStorage.removeItem("opensupport:access-token"); localStorage.removeItem("opensupport:refresh-token"); localStorage.removeItem("opensupport:agent-name");
    setUser(null); setProjects([]); setSelected(""); setError(""); setView("overview");
  }
  if (!authReady) return <main className="auth-screen"><p role="status">Loading workspace...</p></main>;
  if (sessionError) return <main className="auth-screen"><section className="auth-card"><h1>Cannot load your workspace</h1><p role="alert">{sessionError}</p><button onClick={() => setAuthVersion((value) => value + 1)}>Retry connection</button><button onClick={() => { signOut(); setSessionError(""); }}>Back to sign in</button></section></main>;
  if (!user) return <AuthPanel onAuthenticated={() => setAuthVersion((value) => value + 1)} />;
  const views: View[] = isAdmin ? ["overview", "inbox", "knowledge", "widget", "developers", "settings"] : ["overview", "inbox", "knowledge", "widget"];
  return <main className="shell"><aside className="sidebar"><div className="brand"><span>O</span> OpenSupport</div><p className="nav-label">WORKSPACE</p><nav aria-label="Workspace navigation">{views.map((item) => <button key={item} className={`side-link ${view === item ? "active" : ""}`} aria-current={view === item ? "page" : undefined} onClick={() => setView(item)}>{titles[item]}</button>)}</nav><div className="sidebar-note"><span className="user-avatar" aria-hidden="true">{user.display_name.trim().charAt(0).toUpperCase()}</span><span className="user-details"><strong>{user.display_name}</strong><small>{user.role}</small></span></div></aside>
    <section className="content"><header className="topbar"><div><p className="eyebrow">SUPPORT WORKSPACE</p><h1>{titles[view]}</h1></div><div className="topbar-actions"><label className="project-picker">Active project<select aria-label="Active project" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Select a project</option>{projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label><button className="sign-out-button" onClick={signOut}>Sign out</button></div></header>
      {error && <div className="error-notice" role="alert">{error}<button onClick={() => void loadProjects()}>Retry</button></div>}
      {view === "overview" && <Overview onNavigate={setView} />}
      {view === "inbox" && <Inbox projectId={selected} />}
      {view === "developers" && isAdmin && <DeveloperSettings key={selected} projectId={selected} />}
      {view === "settings" && isAdmin && <OrganizationSettings user={user} />}
      {view === "widget" && <WidgetSetup projectId={selected} domains={currentProject?.allowed_domains ?? []} />}
      {view === "knowledge" && <KnowledgeManager key={selected} project={currentProject} isAdmin={isAdmin} onProjectChanged={(project) => { setProjects((items) => [project, ...items.filter((item) => item.id !== project.id)]); setSelected(project.id); }} />}
    </section>
  </main>;
}

"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { API, apiFetch } from "./api";

const WS = API.replace(/^http/, "ws");
type Conversation = { id: string; project_id: string; status: string; assigned_agent: string | null; escalation_reason: string | null; created_at: string };
type Message = { id: string; sender_type: string; sender_name: string | null; content: string; source_title: string | null; created_at: string };

type SocketEvent = { type?: string; online_agents?: string[]; online?: boolean; agent_name?: string; reason?: string; message?: Message };

function connectWithRetry(url: string, onMessage: (data: SocketEvent) => void) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let socket: WebSocket | undefined;
  const connect = () => {
    if (stopped) return;
    socket = new WebSocket(url);
    socket.onmessage = (event) => onMessage(JSON.parse(event.data));
    socket.onclose = () => { if (!stopped) timer = setTimeout(connect, 1500); };
  };
  connect();
  return () => { stopped = true; clearTimeout(timer); socket?.close(); };
}

export default function Inbox({ projectId = "" }: { projectId?: string }) {
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const inboxSequence = useRef(0);
  const messageSequence = useRef(0);
  const messageList = useRef<HTMLDivElement>(null);
  const [agent, setAgent] = useState("Support Agent");
  const [agentIdentity, setAgentIdentity] = useState("Support Agent");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [online, setOnline] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState("active");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState("");

  async function refreshInbox() {
    const sequence = ++inboxSequence.current;
    const params = new URLSearchParams();
    if (statusFilter !== "active") params.set("status", statusFilter);
    if (query.trim()) params.set("q", query.trim());
    if (projectId) params.set("project_id", projectId);
    const queryString = params.toString();
    const response = await apiFetch(`/api/agents/conversations${queryString ? `?${queryString}` : ""}`);
    if (!response.ok) throw new Error("Couldn't load the inbox");
    const items: Conversation[] = await response.json();
    if (sequence !== inboxSequence.current) return;
    setConversations(items);
    setSelected((current) => items.some((item) => item.id === current) ? current : items[0]?.id ?? "");
  }

  async function refreshMessages(id: string) {
    const sequence = ++messageSequence.current;
    setMessages([]); setDraft("");
    if (!id) return;
    setLoadingMessages(true);
    try {
    const response = await apiFetch(`/api/agents/conversations/${id}/messages`);
    if (!response.ok) throw new Error("Couldn't load conversation messages");
    const history: Message[] = await response.json();
    if (sequence === messageSequence.current) setMessages((items) => [...history, ...items.filter((item) => !history.some((message) => message.id === item.id))]);
    } finally { if (sequence === messageSequence.current) setLoadingMessages(false); }
  }

  useEffect(() => {
    void apiFetch("/api/auth/me").then(async (response) => {
      if (!response.ok) return;
      const user = await response.json();
      setAgent(user.display_name); setAgentIdentity(user.display_name);
    }).catch((cause) => setNotice(cause instanceof Error ? cause.message : "Could not load your profile"));
  }, []);

  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => { void refreshInbox().catch((error: Error) => setNotice(error.message)).finally(() => setLoading(false)); }, 250);
    return () => { clearTimeout(timer); inboxSequence.current++; };
  }, [statusFilter, query, projectId]);

  useEffect(() => { if (messageList.current) messageList.current.scrollTop = messageList.current.scrollHeight; }, [messages]);

  async function safe(action: () => Promise<void>) {
    try { await action(); } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Request failed. Please retry."); }
  }

  useEffect(() => {
    const token = localStorage.getItem("opensupport:access-token") ?? "";
    return connectWithRetry(`${WS}/ws/agents?access_token=${encodeURIComponent(token)}`, (data) => {
      if (data.online_agents) setOnline(data.online_agents);
      if (data.type === "agent.presence" && data.agent_name) { const agentName = data.agent_name; setOnline((items) => data.online ? [...new Set([...items, agentName])] : items.filter((name) => name !== agentName)); }
      if (data.type === "conversation.escalated") {
        setNotice(`New escalation: ${data.reason?.replaceAll("_", " ") ?? "needs support"}`);
        void safe(refreshInbox);
      }
    });
  }, [agentIdentity, statusFilter, query, projectId]);

  useEffect(() => { void safe(() => refreshMessages(selected)); return () => { messageSequence.current++; }; }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const token = localStorage.getItem("opensupport:access-token") ?? "";
    return connectWithRetry(`${WS}/ws/conversations/${selected}?access_token=${encodeURIComponent(token)}`, (data) => {
      if (data.type === "message.created" && data.message) { const message = data.message; setMessages((items) => items.some((item) => item.id === message.id) ? items : [...items, message]); }
      if (data.type?.startsWith("conversation.")) void safe(refreshInbox);
    });
  }, [selected]);

  async function action(path: "assign" | "resolve" | "reopen") {
    if (!selected || busy) return;
    setBusy(true);
    try {
    const response = await apiFetch(`/api/agents/conversations/${selected}/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_name: agent }),
    });
    if (!response.ok) { setNotice("That conversation action failed"); return; }
    await refreshInbox();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Conversation action failed"); }
    finally { setBusy(false); }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!selected || !draft.trim() || busy) return;
    setBusy(true);
    try {
    const response = await apiFetch(`/api/agents/conversations/${selected}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_name: agent, content: draft.trim() }),
    });
    if (!response.ok) { setNotice("Message could not be sent"); return; }
    const message: Message = await response.json();
    setMessages((items) => items.some((item) => item.id === message.id) ? items : [...items, message]);
    setDraft("");
    await refreshInbox();
    } catch (cause) { setNotice(cause instanceof Error ? cause.message : "Message could not be sent"); }
    finally { setBusy(false); }
  }

  const current = conversations.find((conversation) => conversation.id === selected);
  return <div className="inbox-layout">
    <aside className="inbox-list"><div className="inbox-list-head"><div><h2>Conversations</h2><span>{conversations.length} {statusFilter}</span></div><button aria-label="Refresh inbox" disabled={loading || busy} onClick={() => void safe(refreshInbox)}>↻</button></div>
      <select className="inbox-filter" aria-label="Filter conversations" disabled={busy} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="active">Active conversations</option><option value="open">Open</option><option value="assigned">Assigned</option><option value="resolved">Resolved conversations</option><option value="escalated">Escalated only</option></select><input className="inbox-filter" aria-label="Search conversations" placeholder="Search messages" value={query} onChange={(event) => setQuery(event.target.value)} />
      <label className="agent-label">Signed in as<input value={agent} readOnly /></label>
      <div className="online-line"><i /> Online now: {online.join(", ") || "you"}</div>
      {loading && <p className="inbox-empty" role="status">Loading conversations...</p>}{!loading && !conversations.length && <div className="inbox-empty">No matching conversations.<small>Conversations that need a person will appear here.</small></div>}
      {conversations.map((conversation) => <button key={conversation.id} className={`conversation-row ${conversation.id === selected ? "selected" : ""}`} disabled={busy} onClick={() => setSelected(conversation.id)}><span className={`status-dot status-${conversation.status}`} /><span className="conversation-meta"><strong>{conversation.status === "escalated" ? "Needs a reply" : conversation.assigned_agent ?? "Unassigned conversation"}</strong><small>{conversation.escalation_reason?.replaceAll("_", " ") ?? conversation.status} · {new Date(conversation.created_at).toLocaleString()}</small></span></button>)}
    </aside>
    <section className="inbox-thread">{current ? <><header className="thread-head"><div><p>PROJECT {current.project_id.slice(0, 8)}</p><h2>{current.status === "escalated" ? "Escalated conversation" : `Conversation ${current.id.slice(0, 8)}`}</h2><small>{current.assigned_agent ? `Assigned to ${current.assigned_agent}` : "Waiting for an agent"}</small></div><div className="thread-actions">{current.status === "resolved" ? <button disabled={busy} onClick={() => void action("reopen")}>Reopen</button> : <><button className="secondary" disabled={busy} onClick={() => void action("assign")}>{current.assigned_agent === agent ? "Assigned to you" : "Take conversation"}</button><button className="primary" disabled={busy} onClick={() => void action("resolve")}>Resolve</button></>}</div></header>
      {current.escalation_reason && <div className="handoff-note">Handed off: {current.escalation_reason.replaceAll("_", " ")}</div>}
      <div className="thread-messages" ref={messageList} aria-live="polite">{loadingMessages && <p role="status">Loading messages...</p>}{messages.map((message) => <article key={message.id} className={`thread-message thread-${message.sender_type}`}><small>{message.sender_name ?? (message.sender_type === "customer" ? "Customer" : message.sender_type === "assistant" ? "AI assistant" : "OpenSupport")}</small><p>{message.content}</p>{message.source_title && <span>Source: {message.source_title}</span>}</article>)}</div>
      {current.status === "resolved" ? <div className="resolved-banner">This conversation is resolved. Reopen it to reply.</div> : <form className="reply-form" onSubmit={send}><textarea disabled={busy || loadingMessages} aria-label="Reply to customer" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Reply to the customer..." rows={2} maxLength={8000} required /><button className="primary" disabled={busy || loadingMessages || !draft.trim()}>{busy ? "Sending..." : "Send reply"}</button></form>}
    </> : <div className="inbox-empty inbox-empty-main"><strong>Select a conversation</strong><small>Escalated conversations and customer replies will show here.</small></div>}</section>
    {notice && <div className="inbox-toast" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}
  </div>;
}

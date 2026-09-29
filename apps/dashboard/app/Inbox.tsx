"use client";

import { FormEvent, useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const WS = API.replace(/^http/, "ws");
type Conversation = { id: string; project_id: string; status: string; assigned_agent: string | null; escalation_reason: string | null; created_at: string };
type Message = { id: string; sender_type: string; sender_name: string | null; content: string; source_title: string | null; created_at: string };

function connectWithRetry(url: string, onMessage: (data: Record<string, any>) => void) {
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

export default function Inbox() {
  const [agent, setAgent] = useState("Support Agent");
  const [agentIdentity, setAgentIdentity] = useState("Support Agent");
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [online, setOnline] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState("active");
  const [notice, setNotice] = useState("");

  async function refreshInbox() {
    const query = statusFilter === "active" ? "" : `?status=${statusFilter}`;
    const response = await fetch(`${API}/api/agents/conversations${query}`);
    if (!response.ok) throw new Error("Couldn't load the inbox");
    const items: Conversation[] = await response.json();
    setConversations(items);
    setSelected((current) => items.some((item) => item.id === current) ? current : items[0]?.id ?? "");
  }

  async function refreshMessages(id: string) {
    if (!id) return;
    const response = await fetch(`${API}/api/agents/conversations/${id}/messages`);
    if (response.ok) setMessages(await response.json());
  }

  useEffect(() => {
    const savedAgent = localStorage.getItem("opensupport:agent-name") ?? "Support Agent";
    setAgent(savedAgent); setAgentIdentity(savedAgent);
  }, []);

  useEffect(() => { void refreshInbox().catch((error: Error) => setNotice(error.message)); }, [statusFilter]);

  useEffect(() => connectWithRetry(`${WS}/ws/agents?agent_name=${encodeURIComponent(agentIdentity)}`, (data) => {
      if (data.online_agents) setOnline(data.online_agents);
      if (data.type === "agent.presence") setOnline((items) => data.online ? [...new Set([...items, data.agent_name])] : items.filter((name) => name !== data.agent_name));
      if (data.type === "conversation.escalated") {
        setNotice(`New escalation: ${data.reason?.replaceAll("_", " ") ?? "needs support"}`);
        void refreshInbox();
      }
    }), [agentIdentity, statusFilter]);

  useEffect(() => { void refreshMessages(selected); }, [selected]);

  useEffect(() => {
    if (!selected) return;
    return connectWithRetry(`${WS}/ws/conversations/${selected}`, (data) => {
      if (data.type === "message.created") setMessages((items) => items.some((item) => item.id === data.message.id) ? items : [...items, data.message]);
      if (data.type?.startsWith("conversation.")) void refreshInbox();
    });
  }, [selected]);

  async function action(path: "assign" | "resolve" | "reopen") {
    if (!selected) return;
    const response = await fetch(`${API}/api/agents/conversations/${selected}/${path}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_name: agent }),
    });
    if (!response.ok) { setNotice("That conversation action failed"); return; }
    await refreshInbox();
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!selected || !draft.trim()) return;
    const response = await fetch(`${API}/api/agents/conversations/${selected}/messages`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ agent_name: agent, content: draft.trim() }),
    });
    if (!response.ok) { setNotice("Message could not be sent"); return; }
    const message: Message = await response.json();
    setMessages((items) => items.some((item) => item.id === message.id) ? items : [...items, message]);
    setDraft("");
    await refreshInbox();
  }

  const current = conversations.find((conversation) => conversation.id === selected);
  return <div className="inbox-layout">
    <aside className="inbox-list"><div className="inbox-list-head"><div><h2>Conversations</h2><span>{conversations.length} {statusFilter}</span></div><button onClick={() => void refreshInbox()}>↻</button></div>
      <select className="inbox-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="active">Active conversations</option><option value="resolved">Resolved conversations</option><option value="escalated">Escalated only</option></select>
      <label className="agent-label">Your agent name<input value={agent} onChange={(event) => setAgent(event.target.value)} onBlur={() => { const name = agent.trim() || "Support Agent"; setAgent(name); setAgentIdentity(name); localStorage.setItem("opensupport:agent-name", name); }} maxLength={120} /></label>
      <div className="online-line"><i /> Online now: {online.join(", ") || "you"}</div>
      {!conversations.length && <div className="inbox-empty">No open conversations yet.<small>Conversations that need a person will appear here.</small></div>}
      {conversations.map((conversation) => <button key={conversation.id} className={`conversation-row ${conversation.id === selected ? "selected" : ""}`} onClick={() => setSelected(conversation.id)}><span className={`status-dot status-${conversation.status}`} /><span className="conversation-meta"><strong>{conversation.status === "escalated" ? "Needs a reply" : conversation.assigned_agent ?? "Unassigned conversation"}</strong><small>{conversation.escalation_reason?.replaceAll("_", " ") ?? conversation.status} · {new Date(conversation.created_at).toLocaleString()}</small></span></button>)}
    </aside>
    <section className="inbox-thread">{current ? <><header className="thread-head"><div><p>PROJECT {current.project_id.slice(0, 8)}</p><h2>{current.status === "escalated" ? "Escalated conversation" : `Conversation ${current.id.slice(0, 8)}`}</h2><small>{current.assigned_agent ? `Assigned to ${current.assigned_agent}` : "Waiting for an agent"}</small></div><div className="thread-actions">{current.status === "resolved" ? <button onClick={() => void action("reopen")}>Reopen</button> : <><button className="secondary" onClick={() => void action("assign")}>{current.assigned_agent === agent ? "Assigned to you" : "Take conversation"}</button><button className="primary" onClick={() => void action("resolve")}>Resolve</button></>}</div></header>
      {current.escalation_reason && <div className="handoff-note">Handed off: {current.escalation_reason.replaceAll("_", " ")}</div>}
      <div className="thread-messages">{messages.map((message) => <article key={message.id} className={`thread-message thread-${message.sender_type}`}><small>{message.sender_name ?? (message.sender_type === "customer" ? "Customer" : message.sender_type === "assistant" ? "AI assistant" : "OpenSupport")}</small><p>{message.content}</p>{message.source_title && <span>Source: {message.source_title}</span>}</article>)}</div>
      {current.status === "resolved" ? <div className="resolved-banner">This conversation is resolved. Reopen it to reply.</div> : <form className="reply-form" onSubmit={send}><textarea value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Reply to the customer..." rows={2} maxLength={8000} required /><button className="primary">Send reply</button></form>}
    </> : <div className="inbox-empty inbox-empty-main"><strong>Select a conversation</strong><small>Escalated conversations and customer replies will show here.</small></div>}</section>
    {notice && <div className="inbox-toast" role="status">{notice}<button onClick={() => setNotice("")}>×</button></div>}
  </div>;
}

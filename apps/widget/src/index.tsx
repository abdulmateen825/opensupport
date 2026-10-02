import React, { FormEvent, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "./widget.css";

type ChatMessage = { id: string; sender_type: string; sender_name?: string | null; content: string; source_title?: string | null };
type ChatWidgetProps = { projectId: string; apiUrl?: string; identityToken?: string };

const defaultApiUrl = "http://localhost:8000";

export function ChatWidget({ projectId, apiUrl = defaultApiUrl, identityToken }: ChatWidgetProps) {
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conversationStatus, setConversationStatus] = useState("open");

  useEffect(() => {
    let cancelled = false;
    const key = `opensupport:${projectId}:conversation`;
    async function start() {
      try {
        let id = localStorage.getItem(key) ?? "";
        if (!id) {
          const response = await fetch(`${apiUrl}/api/widget/${projectId}/conversations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(identityToken ? { identity_token: identityToken } : {}) });
          if (!response.ok) throw new Error("Couldn't start chat");
          const conversation = await response.json();
          id = conversation.id;
          localStorage.setItem(key, id);
        }
        const response = await fetch(`${apiUrl}/api/widget/conversations/${id}/messages`);
        if (!response.ok) throw new Error("Couldn't load chat history");
        const history = await response.json();
        const conversationResponse = await fetch(`${apiUrl}/api/widget/conversations/${id}`);
        const conversation = conversationResponse.ok ? await conversationResponse.json() : { status: "open" };
        if (!cancelled) { setConversationId(id); setMessages(history); setConversationStatus(conversation.status); }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Chat is unavailable");
      }
    }
    void start();
    return () => { cancelled = true; };
  }, [apiUrl, projectId, identityToken]);

  useEffect(() => {
    if (!conversationId) return;
    let stopped = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let socket: WebSocket | undefined;
    const wsBase = apiUrl.replace(/^http/, "ws");
    const connect = () => {
      if (stopped) return;
      socket = new WebSocket(`${wsBase}/ws/conversations/${conversationId}`);
      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === "message.created" && data.message) {
          setMessages((items) => items.some((item) => item.id === data.message.id) ? items : [...items, data.message]);
        }
        if (data.type === "conversation.assigned") setConversationStatus("assigned");
        if (data.type === "conversation.escalated") setConversationStatus("escalated");
        if (data.type === "conversation.resolved") setConversationStatus("resolved");
        if (data.type === "conversation.reopened") setConversationStatus(data.status ?? "open");
      };
      socket.onclose = () => { if (!stopped) retryTimer = setTimeout(connect, 1500); };
    };
    connect();
    return () => { stopped = true; clearTimeout(retryTimer); socket?.close(); };
  }, [apiUrl, conversationId]);

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || !conversationId || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${apiUrl}/api/widget/conversations/${conversationId}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: draft.trim() }),
      });
      if (!response.ok) throw new Error("Message could not be sent");
      const created: ChatMessage[] = await response.json();
      setMessages((current) => [...current, ...created.filter((message) => !current.some((item) => item.id === message.id))]);
      setDraft("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Message could not be sent");
    } finally { setBusy(false); }
  }

  async function startNewConversation() {
    try {
      const response = await fetch(`${apiUrl}/api/widget/${projectId}/conversations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(identityToken ? { identity_token: identityToken } : {}) });
      if (!response.ok) throw new Error("Couldn't start a new conversation");
      const conversation = await response.json();
      localStorage.setItem(`opensupport:${projectId}:conversation`, conversation.id);
      setConversationId(conversation.id); setMessages([]); setConversationStatus("open"); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't start a new conversation"); }
  }

  return <section className="os-chat" aria-label="OpenSupport chat">
    <header className="os-chat__header"><span className="os-chat__dot" /> <div><strong>OpenSupport</strong><small>{conversationStatus === "escalated" || conversationStatus === "assigned" ? "A support agent will reply here" : conversationStatus === "resolved" ? "Conversation resolved" : "Ask us anything"}</small></div></header>
    <div className="os-chat__messages" aria-live="polite">
      {messages.length === 0 && <p className="os-chat__welcome">Hi there! How can we help?</p>}
      {messages.map((message) => <article key={message.id} className={`os-chat__message os-chat__message--${message.sender_type}`}>
        {(message.sender_type === "agent" || message.sender_type === "assistant") && <small>{message.sender_name ?? (message.sender_type === "agent" ? "Support agent" : "AI assistant")}</small>}<p>{message.content}</p>{message.source_title && <small>Source: {message.source_title}</small>}
      </article>)}
      {error && <p className="os-chat__error" role="alert">{error}</p>}
    </div>
    <form className="os-chat__form" onSubmit={send}>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Write a message..." aria-label="Message" maxLength={8000} disabled={conversationStatus === "resolved"} />
      <button disabled={busy || !conversationId || conversationStatus === "resolved"} aria-label="Send message">{busy ? "..." : "Send"}</button>
    </form>
    <footer className="os-chat__footer">{conversationStatus === "resolved" ? <button className="os-chat__new" onClick={() => void startNewConversation()}>Start a new conversation</button> : "Powered by OpenSupport"}</footer>
  </section>;
}

export function mountOpenSupportWidget(element: HTMLElement, projectId: string, apiUrl?: string, identityToken?: string) {
  const root = createRoot(element);
  root.render(<ChatWidget projectId={projectId} apiUrl={apiUrl} identityToken={identityToken} />);
  return () => root.unmount();
}

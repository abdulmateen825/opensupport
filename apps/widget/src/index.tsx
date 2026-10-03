import React, { FormEvent, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./widget.css";
import { OrderTracking, type OrderStatus } from "./OrderTracking";
export type { OrderStatus } from "./OrderTracking";

type ChatMessage = { id: string; sender_type: string; sender_name?: string | null; content: string; source_title?: string | null };
type ChatWidgetProps = { projectId: string; apiUrl?: string; identityToken?: string; orderLookup?: (id: string) => Promise<OrderStatus>; initialOrderId?: string };

const defaultApiUrl = "http://localhost:8000";

export function ChatWidget({ projectId, apiUrl = defaultApiUrl, identityToken, orderLookup, initialOrderId = "" }: ChatWidgetProps) {
  const [attempt, setAttempt] = useState(0);
  const [connecting, setConnecting] = useState(false);
  const [tracking, setTracking] = useState(false);
  const [trackingId, setTrackingId] = useState("");
  const [conversationId, setConversationId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conversationStatus, setConversationStatus] = useState("open");
  const [starting, setStarting] = useState(false);
  const messageList = useRef<HTMLDivElement>(null);
  const waitingForAgent = conversationStatus === "escalated" || conversationStatus === "assigned";
  useEffect(() => { if (initialOrderId) { setTrackingId(initialOrderId); setTracking(true); } }, [initialOrderId]);

  useEffect(() => {
    const list = messageList.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, busy, error, conversationStatus]);

  useEffect(() => {
    let cancelled = false;
    setConversationId(""); setMessages([]); setError(""); setConversationStatus("open");
    if (!projectId) return;
    setConnecting(true);
    const key = `opensupport:${apiUrl}:${projectId}:conversation`;
    async function start() {
      try {
        // Verified sessions always start fresh; never reuse another customer's cached identity.
        let id = identityToken ? "" : localStorage.getItem(key) ?? "";
        if (!id) {
          const response = await fetch(`${apiUrl}/api/widget/${projectId}/conversations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(identityToken ? { identity_token: identityToken } : {}) });
          if (!response.ok) throw new Error("Couldn't start chat");
          const conversation = await response.json();
          id = conversation.id;
          if (!identityToken) localStorage.setItem(key, id);
        }
        const response = await fetch(`${apiUrl}/api/widget/conversations/${id}/messages`);
        if (!response.ok) {
          if (response.status === 404) { localStorage.removeItem(key); if (!cancelled) setAttempt((value) => value + 1); return; }
          throw new Error("Couldn't load chat history");
        }
        const history = await response.json();
        const conversationResponse = await fetch(`${apiUrl}/api/widget/conversations/${id}`);
        const conversation = conversationResponse.ok ? await conversationResponse.json() : { status: "open" };
        if (!cancelled) { setConversationId(id); setMessages(history); setConversationStatus(conversation.status); }
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Chat is unavailable");
      } finally { if (!cancelled) setConnecting(false); }
    }
    void start();
    return () => { cancelled = true; };
  }, [apiUrl, projectId, identityToken, attempt]);

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
    if (!busy && !waitingForAgent && /\b(track(?:ing)?(?:\s+(?:my|an|the))?\s+order|where\s+is\s+my\s+order|NS-\d+)\b/i.test(draft)) {
      setTrackingId(draft.match(/\bNS-\d+\b/i)?.[0]?.toUpperCase() ?? ""); setTracking(true); setDraft(""); return;
    }
    if (!draft.trim() || !conversationId || busy) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`${apiUrl}/api/widget/conversations/${conversationId}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: draft.trim() }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(typeof result.detail === "string" ? result.detail : "Message could not be sent. Please try again.");
      }
      const created: ChatMessage[] = await response.json();
      setMessages((current) => [...current, ...created.filter((message) => !current.some((item) => item.id === message.id))]);
      setDraft("");
      // Refresh status even when the WebSocket is reconnecting or unavailable.
      const statusResponse = await fetch(`${apiUrl}/api/widget/conversations/${conversationId}`).catch(() => null);
      if (statusResponse?.ok) {
        const conversation = await statusResponse.json();
        setConversationStatus(conversation.status);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Message could not be sent");
    } finally { setBusy(false); }
  }

  async function startNewConversation() {
    if (busy || starting) return;
    setStarting(true);
    try {
      const response = await fetch(`${apiUrl}/api/widget/${projectId}/conversations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(identityToken ? { identity_token: identityToken } : {}) });
      if (!response.ok) throw new Error("Couldn't start a new conversation");
      const conversation = await response.json();
      if (!identityToken) localStorage.setItem(`opensupport:${apiUrl}:${projectId}:conversation`, conversation.id);
      setConversationId(conversation.id); setMessages([]); setDraft(""); setConversationStatus("open"); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't start a new conversation"); }
    finally { setStarting(false); }
  }

  return <section className="os-chat" aria-label="OpenSupport chat">
    <header className="os-chat__header"><span className="os-chat__dot" /> <div><strong>OpenSupport</strong><small>{waitingForAgent ? "Waiting for a support agent" : conversationStatus === "resolved" ? "Conversation resolved" : "Ask us anything"}</small></div></header>
    <nav className="os-chat__tabs" aria-label="Support options"><button aria-pressed={!tracking} onClick={() => setTracking(false)}>Chat</button><button aria-pressed={tracking} onClick={() => setTracking(true)}>Track an order</button></nav>
    {tracking ? <OrderTracking initialOrderId={trackingId} lookup={orderLookup ?? (async (id) => {
      if (!conversationId) throw new Error("Start a connected chat before looking up an order.");
      const response = await fetch(`${apiUrl}/api/widget/conversations/${conversationId}/tools/order-status`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ order_id: id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Order lookup failed. Please try again.");
      return data;
    })} /> : <div className="os-chat__messages" ref={messageList} aria-live="polite">
      {!projectId && <p className="os-chat__welcome">Demo tracking is ready. Use Track an order above. Configure a project to enable support chat.</p>}
      {messages.length === 0 && <p className="os-chat__welcome">Hi there! How can we help?</p>}
      {connecting && <p className="os-chat__activity" role="status">Connecting to support...</p>}
      {messages.map((message) => <article key={message.id} className={`os-chat__message os-chat__message--${message.sender_type}`}>
        {(message.sender_type === "agent" || message.sender_type === "assistant") && <small>{message.sender_name ?? (message.sender_type === "agent" ? "Support agent" : "AI assistant")}</small>}<p>{message.content}</p>{message.source_title && <small>Source: {message.source_title}</small>}
      </article>)}
      {busy && <p className="os-chat__activity" role="status">{waitingForAgent ? "Sending to the support team…" : "Preparing your answer…"}</p>}
      {error && <div className="os-chat__error" role="alert"><p>{error}</p>{!conversationId && projectId && <button className="os-chat__new" onClick={() => setAttempt((value) => value + 1)}>Retry connection</button>}</div>}
    </div>}
    {!tracking && waitingForAgent && <div className="os-chat__handoff" role="status">Your messages are going to the support team. An agent will reply here. Start a new chat to ask the assistant another question.</div>}
    {!tracking && <form className="os-chat__form" onSubmit={send}>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={waitingForAgent ? "Message the support team..." : "Write a message..."} aria-label="Message" maxLength={8000} disabled={busy || starting || conversationStatus === "resolved"} />
      <button disabled={busy || starting || (!conversationId && !(orderLookup && /\b(track(?:ing)?(?:\s+(?:my|an|the))?\s+order|where\s+is\s+my\s+order|NS-\d+)\b/i.test(draft))) || !draft.trim() || conversationStatus === "resolved"} aria-label="Send message">{busy ? "Sending…" : "Send"}</button>
    </form>}
    <footer className="os-chat__footer"><span>Powered by OpenSupport</span><button className="os-chat__new" disabled={busy || starting || !projectId} onClick={() => void startNewConversation()}>{starting ? "Starting…" : "New conversation"}</button></footer>
  </section>;
}

export function mountOpenSupportWidget(element: HTMLElement, projectId: string, apiUrl?: string, identityToken?: string) {
  const root = createRoot(element);
  root.render(<ChatWidget projectId={projectId} apiUrl={apiUrl} identityToken={identityToken} />);
  return () => root.unmount();
}

import React, { FormEvent, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "./widget.css";
import { ProductDiscovery } from "./ProductDiscovery";
import { routeCustomerMessage } from "./routing";
import type { ShoppingAdapter } from "./shopping";
import { OrderTracking, type OrderStatus } from "./OrderTracking";
export type { OrderStatus } from "./OrderTracking";
export type { Product, SearchIntent, CatalogSearchResult, CartSelection, CartAddition, ShoppingAdapter } from "./shopping";

type ChatMessage = { id: string; sender_type: string; sender_name?: string | null; content: string; source_title?: string | null };
export type ChatWidgetProps = { projectId: string; apiUrl?: string; identityToken?: string; orderLookup?: (id: string) => Promise<OrderStatus>; initialOrderId?: string; shoppingAdapter?: ShoppingAdapter; brandName?: string; initialShoppingQuery?: string; initialProductId?: string; initialRequestId?: number };

const defaultApiUrl = "http://localhost:8000";

export function ChatWidget({ projectId, apiUrl = defaultApiUrl, identityToken, orderLookup, initialOrderId = "", shoppingAdapter, brandName = "OpenSupport", initialShoppingQuery, initialProductId, initialRequestId }: ChatWidgetProps) {
  const [discovering, setDiscovering] = useState(false);
  const [shoppingQuery, setShoppingQuery] = useState("");
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
  useEffect(() => { if (shoppingAdapter && !waitingForAgent && conversationStatus !== "resolved" && (initialShoppingQuery !== undefined || initialProductId)) { setShoppingQuery(initialShoppingQuery ?? ""); setDiscovering(true); setTracking(false); } }, [initialShoppingQuery, initialProductId, initialRequestId]);
  useEffect(() => { if (!orderLookup) setTracking(false); if (!shoppingAdapter) setDiscovering(false); }, [orderLookup, shoppingAdapter]);
  const draftRoute = routeCustomerMessage(draft, conversationStatus, !!shoppingAdapter, !!orderLookup);
  useEffect(() => { if (waitingForAgent || conversationStatus === "resolved") setDiscovering(false); }, [waitingForAgent, conversationStatus]);
  useEffect(() => { if (orderLookup && initialOrderId) { setTrackingId(initialOrderId); setTracking(true); setDiscovering(false); } }, [initialOrderId, initialRequestId, orderLookup]);
  useEffect(() => { if (initialRequestId !== undefined && initialShoppingQuery === undefined && !initialProductId && !initialOrderId) { setTracking(false); setDiscovering(false); } }, [initialRequestId, initialShoppingQuery, initialProductId, initialOrderId]);

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
    if (busy || starting || !draft.trim()) return;
    if (draftRoute === "shopping" && shoppingAdapter) { setShoppingQuery(draft.trim()); setDiscovering(true); setTracking(false); setDraft(""); return; }
    if (draftRoute === "order" && orderLookup) {
      setTrackingId(draft.match(/\bNS-\d+\b/i)?.[0]?.toUpperCase() ?? ""); setTracking(true); setDiscovering(false); setDraft(""); return;
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
      setDiscovering(false); setTracking(false); setShoppingQuery(""); setConversationId(conversation.id); setMessages([]); setDraft(""); setConversationStatus("open"); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Couldn't start a new conversation"); }
    finally { setStarting(false); }
  }

  return <section className="os-chat" aria-label="OpenSupport chat">
    <header className="os-chat__header"><span className="os-chat__dot" /> <div><strong>{brandName}</strong><small>{waitingForAgent ? "Waiting for a support agent" : conversationStatus === "resolved" ? "Conversation resolved" : "Ask us anything"}</small></div></header>
    <nav className="os-chat__tabs" aria-label="Support options"><button aria-pressed={!tracking && !discovering} onClick={() => { setTracking(false); setDiscovering(false); }}>Chat</button>{shoppingAdapter && <button aria-pressed={discovering} disabled={waitingForAgent || conversationStatus === "resolved"} onClick={() => { setDiscovering(true); setTracking(false); }}>Find products</button>}{orderLookup && <button aria-pressed={tracking} onClick={() => { setTracking(true); setDiscovering(false); }}>Track order</button>}</nav>
    {discovering && shoppingAdapter ? <ProductDiscovery adapter={shoppingAdapter} initialQuery={shoppingQuery} initialProductId={initialProductId} requestId={initialRequestId} /> : tracking && orderLookup ? <OrderTracking key={initialRequestId} initialOrderId={trackingId} lookup={orderLookup} /> : <div className="os-chat__messages" ref={messageList} aria-live="polite">
      {!projectId && <p className="os-chat__welcome">General support needs a connected project. Website-enabled tools are available in the tabs above.</p>}
      {messages.length === 0 && <p className="os-chat__welcome">Hi there! How can we help?</p>}
      {connecting && <p className="os-chat__activity" role="status">Connecting to support...</p>}
      {messages.map((message) => <article key={message.id} className={`os-chat__message os-chat__message--${message.sender_type}`}>
        {(message.sender_type === "agent" || message.sender_type === "assistant") && <small>{message.sender_name ?? (message.sender_type === "agent" ? "Support agent" : "AI assistant")}</small>}<p>{message.content}</p>{message.source_title && <small>Source: {message.source_title}</small>}
      </article>)}
      {busy && <p className="os-chat__activity" role="status">{waitingForAgent ? "Sending to the support team…" : "Preparing your answer…"}</p>}
      {error && <div className="os-chat__error" role="alert"><p>{error}</p>{!conversationId && projectId && <button className="os-chat__new" onClick={() => setAttempt((value) => value + 1)}>Retry connection</button>}</div>}
    </div>}
    {!tracking && !discovering && waitingForAgent && <div className="os-chat__handoff" role="status">Your messages are going to the support team. An agent will reply here. Start a new chat to ask the assistant another question.</div>}
    {!tracking && !discovering && <form className="os-chat__form" onSubmit={send}>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={waitingForAgent ? "Message the support team..." : "Write a message..."} aria-label="Message" maxLength={8000} disabled={busy || starting || conversationStatus === "resolved"} />
      <button disabled={busy || starting || (!conversationId && !(draftRoute === "shopping" && shoppingAdapter) && !(draftRoute === "order" && orderLookup)) || !draft.trim() || conversationStatus === "resolved"} aria-label="Send message">{busy ? "Sending…" : "Send"}</button>
    </form>}
    <footer className="os-chat__footer"><span>Powered by OpenSupport</span><button className="os-chat__new" disabled={busy || starting || !projectId} onClick={() => void startNewConversation()}>{starting ? "Starting…" : "New conversation"}</button></footer>
  </section>;
}

export function mountOpenSupportWidget(element: HTMLElement, projectId: string, apiUrl?: string, identityToken?: string, options?: Omit<ChatWidgetProps, "projectId" | "apiUrl" | "identityToken">) {
  const root = createRoot(element);
  root.render(<ChatWidget {...options} projectId={projectId} apiUrl={apiUrl} identityToken={identityToken} />);
  return () => root.unmount();
}

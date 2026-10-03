import { FormEvent, useEffect, useRef, useState } from "react";

export type OrderStatus = { order_id: string; status: string; updated_at?: string; estimated_delivery?: string | null; total?: number; currency?: string };

export function OrderTracking({ lookup, initialOrderId = "" }: { lookup: (id: string) => Promise<OrderStatus>; initialOrderId?: string }) {
  const [id, setId] = useState(initialOrderId);
  const [order, setOrder] = useState<OrderStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const lookupRef = useRef(lookup); lookupRef.current = lookup;
  async function find(orderId: string) {
    const current = ++sequence.current;
    setBusy(true); setOrder(null); setError("");
    try { const result = await lookupRef.current(orderId); if (sequence.current === current) setOrder(result); }
    catch (cause) { if (sequence.current === current) setError(cause instanceof Error ? cause.message : "Order lookup failed. Please try again."); }
    finally { if (sequence.current === current) setBusy(false); }
  }
  useEffect(() => {
    setId(initialOrderId);
    if (initialOrderId) void find(initialOrderId);
    return () => { sequence.current++; };
  }, [initialOrderId]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || !id.trim()) return;
    await find(id.trim());
  }
  return <div className="os-chat__messages"><h3>Where is your order?</h3><p>Enter your order number to check its latest status.</p>
    <form className="os-chat__tracking-form" onSubmit={submit}><label>Order number<input value={id} onChange={(event) => setId(event.target.value)} placeholder="e.g. NS-1002" maxLength={120} disabled={busy} required /></label><button disabled={busy || !id.trim()}>{busy ? "Checking..." : "Track order"}</button></form>
    {busy && <p role="status">Looking up your order...</p>}{error && <p className="os-chat__error" role="alert">{error}</p>}
    {order && <article className="os-chat__order" aria-live="polite"><small>ORDER {order.order_id}</small><h3>{order.status.replace(/_/g, " ")}</h3>
      {["processing", "shipped", "delivered"].includes(order.status.toLowerCase()) && <ol className="os-chat__progress">{["processing", "shipped", "delivered"].map((step, index) => <li key={step} className={index <= ["processing", "shipped", "delivered"].indexOf(order.status.toLowerCase()) ? "complete" : ""}>{step}</li>)}</ol>}
      <dl>{order.estimated_delivery && <><dt>{order.status.toLowerCase() === "delivered" ? "Delivered on" : "Estimated delivery"}</dt><dd>{order.estimated_delivery}</dd></>}{order.updated_at && <><dt>Last updated</dt><dd>{order.updated_at}</dd></>}{order.total != null && <><dt>Total</dt><dd>{order.currency} {order.total.toFixed(2)}</dd></>}</dl>
    </article>}
  </div>;
}

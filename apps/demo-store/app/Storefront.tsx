"use client";

import { useEffect, useRef, useState } from "react";
import { ChatWidget, type OrderStatus } from "@opensupport/widget";
import { demoOrders } from "./orders";

const products = [
  { id: "tote", name: "Everyday Carry Tote", price: 48, description: "A sturdy canvas companion for everyday adventures.", art: "one" },
  { id: "bottle", name: "Weekender Bottle", price: 32, description: "Keep your favorite drink close, wherever the day goes.", art: "two" },
  { id: "notes", name: "Field Notes Set", price: 18, description: "Three pocket notebooks for your next big idea.", art: "three" },
];
type DemoOrder = OrderStatus & { item: string };

export default function Storefront() {
  const bagDialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [bagOpen, setBagOpen] = useState(false);
  const [cart, setCart] = useState<Record<string, number>>({});
  const [orders, setOrders] = useState<DemoOrder[]>([]);
  const [ready, setReady] = useState(false);
  const [trackingId, setTrackingId] = useState("");
  const [notice, setNotice] = useState("");
  const [projectId, setProjectId] = useState(process.env.NEXT_PUBLIC_OPENSUPPORT_PROJECT_ID ?? "");
  useEffect(() => {
    const queryProject = new URLSearchParams(window.location.search).get("project");
    if (queryProject) setProjectId(queryProject);
    try {
      const saved = JSON.parse(localStorage.getItem("northstar:cart") ?? "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) setCart(Object.fromEntries(products.map((product) => [product.id, Math.min(99, Math.max(0, Number.isInteger(saved[product.id]) ? saved[product.id] : 0))])));
      const history = JSON.parse(localStorage.getItem("northstar:orders") ?? "[]");
      if (Array.isArray(history)) setOrders(history.filter((order) => typeof order?.order_id === "string" && typeof order?.status === "string" && typeof order?.total === "number" && typeof order?.item === "string"));
    } catch { /* An empty demo session is valid. */ }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) { try { localStorage.setItem("northstar:cart", JSON.stringify(cart)); localStorage.setItem("northstar:orders", JSON.stringify(orders)); } catch { setNotice("Browser storage is unavailable. Demo changes will last until you refresh."); } } }, [cart, orders, ready]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); setBagOpen(false); } };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, []);
  useEffect(() => { if (bagOpen) bagDialog.current?.showModal(); }, [bagOpen]);
  const count = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
  const total = products.reduce((sum, product) => sum + product.price * (cart[product.id] ?? 0), 0);
  function change(id: string, delta: number) { setCart((items) => ({ ...items, [id]: Math.min(99, Math.max(0, (items[id] ?? 0) + delta)) })); }
  function track(id: string) { setTrackingId(id); setOpen(true); }
  async function lookup(id: string): Promise<OrderStatus> {
    const local = orders.find((order) => order.order_id === id.toUpperCase());
    if (local) return local;
    const response = await fetch(`/api/orders/${encodeURIComponent(id)}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.detail ?? "Order lookup failed");
    return data;
  }
  function checkout() {
    if (!count) return;
    const date = new Date(); const delivery = new Date(date); delivery.setDate(delivery.getDate() + 5);
    const id = `NS-${Date.now()}`;
    const order: DemoOrder = { order_id: id, status: "processing", updated_at: date.toISOString().slice(0, 10), estimated_delivery: delivery.toISOString().slice(0, 10), total, currency: "USD", item: products.filter((product) => cart[product.id]).map((product) => `${cart[product.id]} × ${product.name}`).join(", ") };
    setOrders((items) => [order, ...items]); setCart({}); setBagOpen(false); setNotice(`Demo order ${id} created. No payment was taken.`); track(id);
  }
  return <main className="store"><nav><a className="store-logo" href="#top"><span>N</span> NORTHSTAR <small>SUPPLY CO.</small></a><div className="links"><a href="#collection">Shop</a><a href="#story">Our story</a><a href="#orders">Track orders</a></div><button className="bag" onClick={() => setBagOpen(true)} aria-label={`Open bag, ${count} items`}>Bag <span>{count}</span></button></nav>
    <div className="demo-banner">Demo storefront · Fictional products and orders · No real payments</div>
    {notice && <div className="store-notice" role="status">{notice}<button aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}
    <section className="hero" id="top"><div className="hero-copy"><p className="kicker">MADE FOR THE EVERYDAY</p><h1>Good things<br />for the <em>long run.</em></h1><p>Thoughtful essentials, responsibly made. Designed to be used, loved, and passed along.</p><a className="shop-button" href="#collection">Explore the collection <b>↗</b></a><div className="trust"><span>✳</span> Free shipping over $75 <i /> Easy 30-day returns</div></div><div className="hero-art"><div className="sun" /><div className="bag-art"><div className="bag-handle" /><div className="bag-stamp">N<br /><small>FIELD KIT</small></div></div><div className="orb orb-one" /><div className="orb orb-two" /><span className="art-caption">FIELD KIT · 01</span></div></section>
    <section className="collection" id="collection"><p className="kicker">THE DAILY EDIT</p><h2>Built for wherever.</h2><div className="products">{products.map((product, index) => <article key={product.id}><div className={`product-art ${product.art}`}>{String(index + 1).padStart(2, "0")}</div><strong>{product.name}</strong><small>${product.price}</small><p>{product.description}</p><button className="store-button" disabled={!ready || (cart[product.id] ?? 0) >= 99} onClick={() => { change(product.id, 1); setNotice(`${product.name} added to your bag.`); }}>Add to bag</button></article>)}</div></section>
    <section className="store-story" id="story"><p className="kicker">FEWER THINGS, BETTER MADE</p><h2>Essentials with a little more purpose.</h2><p>Northstar is a fictional shop built to demonstrate OpenSupport. Browse the collection, create a demo order, then ask the widget where it is. Your demo purchases stay in this browser.</p><div className="store-policies"><article><h3>Shipping</h3><p>Sample delivery estimates are shown on each order. Demo checkout creates a processing order with delivery in five days.</p></article><article><h3>Returns</h3><p>The sample store offers easy returns within 30 days. Open chat for support or to test an agent handoff.</p></article></div></section>
    <section className="demo-orders" id="orders"><p className="kicker">ORDER TRACKING DEMO</p><h2>Your orders</h2><p>Click Track order, or type “Track order NS-1002” in the widget. Sample orders cover every delivery state.</p><div className="order-grid">{[...orders, ...demoOrders].map((order) => <article key={order.order_id}><span className={`order-badge ${order.status}`}>{order.status}</span><h3>{order.order_id}</h3><p>{order.item}</p><strong>${order.total?.toFixed(2)}</strong><small>{order.estimated_delivery ? `Delivery: ${order.estimated_delivery}` : "No delivery scheduled"}</small><button onClick={() => track(order.order_id)}>Track order</button></article>)}</div></section>
    <footer>© 2026 Northstar Supply Co. <span>Made to keep.</span><button onClick={() => { setTrackingId(""); setOpen(true); }}>Contact support</button></footer>
    <button className="chat-launcher" aria-expanded={open} onClick={() => setOpen((value) => !value)} aria-label={open ? "Close support chat" : "Open support chat"}>{open ? "×" : "✳"}</button>{open && <div className="chat-panel"><ChatWidget projectId={projectId === "replace-with-project-id" ? "" : projectId} apiUrl={process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"} orderLookup={lookup} initialOrderId={trackingId} /></div>}
    {bagOpen && <dialog ref={bagDialog} className="bag-drawer" aria-labelledby="bag-title" onCancel={() => setBagOpen(false)}><header><h2 id="bag-title">Your bag</h2><button autoFocus aria-label="Close bag" onClick={() => setBagOpen(false)}>×</button></header>{count ? <>{products.filter((product) => cart[product.id]).map((product) => <article className="bag-row" key={product.id}><div><strong>{product.name}</strong><p>${product.price} each</p><div className="quantity"><button aria-label={`Remove one ${product.name}`} onClick={() => change(product.id, -1)}>−</button><span>{cart[product.id]}</span><button disabled={cart[product.id] >= 99} aria-label={`Add one ${product.name}`} onClick={() => change(product.id, 1)}>+</button></div></div><strong>${(product.price * cart[product.id]).toFixed(2)}</strong></article>)}<div className="bag-total"><span>Total</span><strong>${total.toFixed(2)}</strong></div><p className="helper-text">Demo checkout only. No payment or address needed.</p><button className="store-button checkout" onClick={checkout}>Create demo order</button></> : <div className="bag-empty"><h3>Your bag is empty</h3><p>Find something good in the daily edit.</p><button className="store-button" onClick={() => { setBagOpen(false); document.getElementById("collection")?.scrollIntoView(); }}>Browse collection</button></div>}</dialog>}
  </main>;
}

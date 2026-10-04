"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChatWidget, type OrderStatus, type ShoppingAdapter } from "@opensupport/widget";
import { applyCartSelection, cartTotal, catalog, getCatalogProduct } from "./catalog";
import { demoOrders } from "./orders";

type DemoOrder = OrderStatus & { item: string };

export default function Storefront({ productPageId }: { productPageId?: string } = {}) {
  const pageProduct = productPageId ? getCatalogProduct(productPageId) : undefined;
  const bagDialog = useRef<HTMLDialogElement>(null);
  const launcher = useRef<HTMLButtonElement>(null);
  const cartRef = useRef<Record<string, number>>({});
  const [cart, setCart] = useState<Record<string, number>>({});
  const [open, setOpen] = useState(false);
  const [bagOpen, setBagOpen] = useState(false);
  const [orders, setOrders] = useState<DemoOrder[]>([]);
  const [ready, setReady] = useState(false);
  const [requestId, setRequestId] = useState(0);
  const [trackingId, setTrackingId] = useState("");
  const [shoppingQuery, setShoppingQuery] = useState<string | undefined>(undefined);
  const [productId, setProductId] = useState<string | undefined>(undefined);
  const [notice, setNotice] = useState("");
  const [projectId, setProjectId] = useState(process.env.NEXT_PUBLIC_OPENSUPPORT_PROJECT_ID ?? "");

  function commitCart(next: Record<string, number>) { cartRef.current = next; setCart(next); }
  useEffect(() => {
    const queryProject = new URLSearchParams(window.location.search).get("project");
    if (queryProject) setProjectId(queryProject);
    try {
      const saved = JSON.parse(localStorage.getItem("northstar:cart") ?? "{}");
      if (saved && typeof saved === "object" && !Array.isArray(saved)) commitCart(Object.fromEntries(catalog.map((product) => [product.id, Math.min(99, Math.max(0, Number.isInteger(saved[product.id]) ? saved[product.id] : 0))])));
      const history = JSON.parse(localStorage.getItem("northstar:orders") ?? "[]");
      if (Array.isArray(history)) setOrders(history.filter((order) => typeof order?.order_id === "string" && typeof order?.status === "string" && Number.isFinite(order?.total) && typeof order?.item === "string"));
    } catch { /* Empty or unavailable browser storage is a valid demo session. */ }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem("northstar:cart", JSON.stringify(cart)); localStorage.setItem("northstar:orders", JSON.stringify(orders)); }
    catch { setNotice("Browser storage is unavailable. Your bag will last until you refresh."); }
  }, [cart, orders, ready]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      // A native product/bag dialog owns Escape while it is open.
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) { setOpen(false); launcher.current?.focus(); }
    };
    window.addEventListener("keydown", close); return () => window.removeEventListener("keydown", close);
  }, []);
  useEffect(() => {
    const dialog = bagDialog.current;
    if (bagOpen && dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, [bagOpen]);

  const activeProject = projectId === "replace-with-project-id" ? "" : projectId;
  const shopping = useMemo<ShoppingAdapter>(() => ({
    async searchProducts(query, signal) {
      const response = await fetch("/api/catalog/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, projectId: activeProject }), signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail ?? "Search is unavailable. Please try again.");
      return data;
    },
    async getProduct(id, signal) {
      const response = await fetch(`/api/catalog/products/${encodeURIComponent(id)}`, { signal });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail ?? "Product details are unavailable.");
      return data;
    },
    navigateToProduct(id) {
      getCatalogProduct(id);
      const project = activeProject ? `?project=${encodeURIComponent(activeProject)}` : "";
      window.location.assign(`/products/${encodeURIComponent(id)}${project}`);
    },
    async addToCart(selection) {
      if (!ready) throw new Error("Your bag is still loading. Try again in a moment.");
      const next = applyCartSelection(cartRef.current, selection);
      const product = getCatalogProduct(selection.productId);
      commitCart(next);
      const message = `${selection.quantity} × ${product.name} added to your bag.`;
      setNotice(message);
      return { message, itemCount: Object.values(next).reduce((sum, quantity) => sum + quantity, 0) };
    },
  }), [activeProject, ready]);

  const count = Object.values(cart).reduce((sum, quantity) => sum + quantity, 0);
  const total = cartTotal(cart);
  function change(id: string, delta: number) {
    getCatalogProduct(id);
    commitCart({ ...cartRef.current, [id]: Math.min(99, Math.max(0, (cartRef.current[id] ?? 0) + delta)) });
  }
  function shop(query = "", id?: string) { setRequestId((value) => value + 1); setTrackingId(""); setShoppingQuery(query); setProductId(id); setOpen(true); }
  function track(id: string) { setRequestId((value) => value + 1); setShoppingQuery(undefined); setProductId(undefined); setTrackingId(id); setOpen(true); }
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
    const order: DemoOrder = { order_id: id, status: "processing", updated_at: date.toISOString().slice(0, 10), estimated_delivery: delivery.toISOString().slice(0, 10), total: cartTotal(cartRef.current), currency: "USD", item: catalog.filter((product) => cartRef.current[product.id]).map((product) => `${cartRef.current[product.id]} × ${product.name}`).join(", ") };
    setOrders((items) => [order, ...items]); commitCart({}); setBagOpen(false); setNotice(`Demo order ${id} created. No payment was taken.`); track(id);
  }

  return <main className="store" id="top">
    <div className="store-announcement">Considered essentials. Everyday possibilities. <span>Fictional store · Demo checkout only</span></div>
    <nav className="store-nav" aria-label="Store navigation"><a className="store-logo" href="#top"><span aria-hidden="true">N<span>✳</span></span><div>NORTHSTAR<small>SUPPLY CO.</small></div></a><div className="store-nav-links"><a href="#collection">The collection</a><a href="#story">Our approach</a><a href="#orders">Your orders</a></div><button className="bag" onClick={() => setBagOpen(true)} aria-label={`Open bag, ${count} items`}>Bag <span>{count}</span></button></nav>
    {notice && <div className="store-notice" role="status"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice("")}>×</button></div>}
    {pageProduct ? <section className="store-hero" aria-labelledby="product-page-name"><div className="hero-copy"><a className="text-button" href={activeProject ? `/?project=${encodeURIComponent(activeProject)}` : "/"}>Back to collection</a><p className="kicker">{pageProduct.category}</p><h1 id="product-page-name">{pageProduct.name}</h1><strong>${pageProduct.price}</strong><p>{pageProduct.description}</p><dl>{Object.entries(pageProduct.attributes ?? {}).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value}</dd></div>)}</dl><p>{pageProduct.available ? "Available" : "Currently unavailable"}</p><div className="hero-actions"><button className="store-button" disabled={!ready || pageProduct.available === false} onClick={() => { void shopping.addToCart?.({ productId: pageProduct.id, quantity: 1 }).catch((cause) => setNotice(cause instanceof Error ? cause.message : "Could not add item.")); }}>Add to bag</button><button className="text-button" onClick={() => shop("", pageProduct.id)}>Choose quantity and preview</button></div></div><div className="hero-image"><img src={pageProduct.image?.src} alt={pageProduct.image?.alt ?? pageProduct.name} fetchPriority="high" /></div></section> : <section className="store-hero"><div className="hero-copy"><p className="kicker">LESS, BUT BETTER</p><h1>For the everyday.<br /><em>And the days after.</em></h1><p>Simple things, thoughtfully chosen. A small collection of useful companions for wherever life takes you.</p><div className="hero-actions"><a className="store-button" href="#collection">Explore the collection <span>↗</span></a><button className="text-button" onClick={() => shop()}>Help me find something</button></div><div className="hero-footnote"><span>01 — THE EVERYDAY EDIT</span><span>Three essentials. Endless possibilities.</span></div></div><div className="hero-image"><img src="/products/tote.png" alt="Natural canvas Everyday Carry Tote on a warm limestone surface" fetchPriority="high" /><div className="hero-image-caption"><span>EVERYDAY CARRY TOTE</span><strong>$48</strong></div></div></section>}
    <div className="store-values"><span>Thoughtful everyday design</span><span>Free shipping over $75*</span><span>Easy 30-day returns*</span><small>*Sample store policies</small></div>
    <section className="store-collection" id="collection"><div className="section-heading"><div><p className="kicker">THE DAILY EDIT</p><h2>Good company, wherever.</h2></div><button className="text-button" onClick={() => shop("I need a gift under $50")}>Find your perfect match ↗</button></div><div className="store-products">{catalog.map((product, index) => <article className="store-product" key={product.id}><button className="store-product-image" aria-label={`Preview ${product.name}`} onClick={() => shop("", product.id)}><img src={product.image?.src} alt={product.image?.alt ?? product.name} loading="lazy" /><span className="product-number">0{index + 1}</span><span className="product-image-action">Take a closer look ↗</span></button><div className="product-title-row"><h3>{product.name}</h3><strong>${product.price}</strong></div><p>{product.description}</p><div className="product-actions"><button className="text-button" onClick={() => shop("", product.id)}>Explore details ↗</button><button className="product-add" disabled={!ready || (cart[product.id] ?? 0) >= 99} onClick={() => { void shopping.addToCart?.({ productId: product.id, quantity: 1 }).catch((cause) => setNotice(cause instanceof Error ? cause.message : "Could not add item.")); }}>Add to bag +</button></div></article>)}</div></section>
    <section className="store-story" id="story"><div><p className="kicker">A SMALL COLLECTION. A BIGGER IDEA.</p><h2>Make room for<br /><em>the things that matter.</em></h2></div><div><p>We believe the best everyday things are the ones you reach for without thinking. A dependable tote. A bottle that goes everywhere. A place to put your thoughts.</p><p>Northstar is a fictional retail experience for OpenSupport. Try finding an essential with the concierge, preview it, and add it to your bag when you’re ready.</p><button className="store-button" onClick={() => shop("Show me something for carrying my laptop")}>Meet your everyday companion ↗</button></div></section>
    <section className="store-orders" id="orders"><div className="section-heading"><div><p className="kicker">FROM OUR STORE TO YOUR DOOR</p><h2>A little peace of mind.</h2></div><p>Track a sample order below.<br />Your own demo purchases appear here, too.</p></div><div className="order-grid">{[...orders, ...demoOrders].map((order) => <article key={order.order_id}><span className={`order-badge ${order.status}`}>{order.status}</span><h3>{order.order_id}</h3><p>{order.item}</p><div className="order-bottom"><strong>${order.total?.toFixed(2)}</strong><button className="text-button" onClick={() => track(order.order_id)}>Track order ↗</button></div><small>{order.estimated_delivery ? `${order.status === "delivered" ? "Delivered" : "Expected"}: ${order.estimated_delivery}` : "No delivery scheduled"}</small></article>)}</div></section>
    <footer className="store-footer"><div className="footer-brand">NORTHSTAR<small>Good things for the long run.</small></div><div><a href="#collection">Shop the collection</a><button onClick={() => { setRequestId((value) => value + 1); setShoppingQuery(undefined); setProductId(undefined); setTrackingId(""); setOpen(true); }}>Contact support</button><small>© 2026 Northstar Supply Co. · Synthetic product imagery · No real payments</small></div></footer>
    <button ref={launcher} className="chat-launcher" aria-expanded={open} aria-controls="store-concierge" onClick={() => setOpen((value) => !value)} aria-label={open ? "Close concierge" : "Open shopping and support concierge"}>{open ? "×" : <><span aria-hidden="true">✳</span> Concierge</>}</button>{open && <div id="store-concierge" className="chat-panel"><ChatWidget projectId={activeProject} apiUrl={process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"} orderLookup={lookup} initialOrderId={trackingId} shoppingAdapter={shopping} initialShoppingQuery={shoppingQuery} initialProductId={productId} initialRequestId={requestId} brandName="Northstar concierge" /></div>}
    {bagOpen && <dialog ref={bagDialog} className="bag-drawer" aria-labelledby="bag-title" onCancel={() => setBagOpen(false)}><header><div><p className="kicker">YOUR EVERYDAY EDIT</p><h2 id="bag-title">The bag <small>({count})</small></h2></div><button autoFocus aria-label="Close bag" onClick={() => setBagOpen(false)}>×</button></header>{count ? <>{catalog.filter((product) => cart[product.id]).map((product) => <article className="bag-row" key={product.id}><img src={product.image?.src} alt={product.image?.alt ?? product.name} /><div><strong>{product.name}</strong><p>${product.price} each</p><div className="quantity"><button aria-label={`Remove one ${product.name}`} onClick={() => change(product.id, -1)}>−</button><span>{cart[product.id]}</span><button disabled={cart[product.id] >= 99} aria-label={`Add one ${product.name}`} onClick={() => change(product.id, 1)}>+</button></div></div><strong>${(product.price * cart[product.id]).toFixed(2)}</strong></article>)}<div className="bag-total"><span>Subtotal</span><strong>${total.toFixed(2)}</strong></div><p className="bag-note">A fictional checkout. No payment, no address, just a chance to try the experience.</p><button className="store-button checkout" onClick={checkout}>Create demo order ↗</button></> : <div className="bag-empty"><span aria-hidden="true">✳</span><h3>A little room for something good.</h3><p>Your bag is empty. Let’s find an everyday essential.</p><button className="store-button" onClick={() => { setBagOpen(false); shop(); }}>Find something for me</button></div>}</dialog>}
  </main>;
}

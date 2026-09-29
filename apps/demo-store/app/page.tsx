"use client";

import { useState } from "react";
import { ChatWidget } from "@opensupport/widget";

export default function Storefront() {
  const [open, setOpen] = useState(false);
  const projectId = process.env.NEXT_PUBLIC_OPENSUPPORT_PROJECT_ID ?? "";
  return <main className="store"><nav><div className="store-logo"><span>N</span> NORTHSTAR <small>SUPPLY CO.</small></div><div className="links"><a href="#collection">Shop</a><a href="#story">Our story</a><a href="#help">Help</a></div><button className="bag">Bag <span>0</span></button></nav><section className="hero"><div className="hero-copy"><p className="kicker">MADE FOR THE EVERYDAY</p><h1>Good things<br />for the <em>long run.</em></h1><p>Thoughtful essentials, responsibly made. Designed to be used, loved, and passed along.</p><a className="shop-button" href="#collection">Explore the collection <b>↗</b></a><div className="trust"><span>✳</span> Free shipping over $75 <i /> Easy 30-day returns</div></div><div className="hero-art"><div className="sun"/><div className="bag-art"><div className="bag-handle"/><div className="bag-stamp">N<br /><small>FIELD KIT</small></div></div><div className="orb orb-one"/><div className="orb orb-two"/><span className="art-caption">FIELD KIT · 01</span></div></section><section className="collection" id="collection"><p className="kicker">THE DAILY EDIT</p><h2>Built for wherever.</h2><div className="products"><article><div className="product-art one">01</div><strong>Everyday Carry Tote</strong><small>$48</small></article><article><div className="product-art two">02</div><strong>Weekender Bottle</strong><small>$32</small></article><article><div className="product-art three">03</div><strong>Field Notes Set</strong><small>$18</small></article></div></section><footer>© 2026 Northstar Supply Co. <span>Made to keep.</span></footer>
    <button className="chat-launcher" onClick={() => setOpen(!open)} aria-label="Open support chat">{open ? "×" : "✳"}</button>{open && (projectId ? <div className="chat-panel"><ChatWidget projectId={projectId} apiUrl={process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"} /></div> : <div className="chat-panel chat-setup">Add <code>NEXT_PUBLIC_OPENSUPPORT_PROJECT_ID</code> to the demo app environment to connect its support widget.</div>)}
  </main>;
}

import { FormEvent, useEffect, useRef, useState } from "react";
import { createCartActionGuard, openProductPage, requestsProductPage, formatPrice, validateQuantity, type Product, type ShoppingAdapter } from "./shopping";

export function ProductImage({ product, className = "" }: { product: Product; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [product.image?.src]);
  return <div className={`os-product-image ${className}`}>{product.image?.src && !failed
    ? <img src={product.image.src} alt={product.image.alt || product.name} loading="lazy" onError={() => setFailed(true)} />
    : <div className="os-product-image__missing" role="img" aria-label={`${product.name}: image unavailable`}><span>◈</span><small>Image unavailable</small></div>}</div>;
}

function ProductPreview({ product, adapter, onClose }: { product: Product; adapter: ShoppingAdapter; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const guard = useRef(createCartActionGuard());
  const [quantity, setQuantity] = useState(1);
  const [variantId, setVariantId] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const variant = product.variants?.find((item) => item.id === variantId);
  const unavailable = product.available === false || variant?.available === false;
  useEffect(() => { const element = dialog.current; if (element && !element.open) element.showModal(); return () => element?.close(); }, []);
  function add() {
    void guard.current(async () => {
      setAdding(true); setError(""); setSuccess("");
      try {
        validateQuantity(quantity);
        if (unavailable) throw new Error("This selection is unavailable.");
        if (product.variants?.length && !variant) throw new Error("Choose an option before adding to your bag.");
        if (!adapter.addToCart) throw new Error("Cart actions are not enabled by this website.");
        const result = await adapter.addToCart({ productId: product.id, quantity, ...(variant ? { variantId: variant.id } : {}) });
        setSuccess(result.message || "Added to your bag.");
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not add this item. Please try again."); }
      finally { setAdding(false); }
    });
  }
  return <dialog ref={dialog} className="os-product-preview" aria-labelledby="os-preview-name" onCancel={(event) => { event.preventDefault(); if (!adding) onClose(); }}>
    <button className="os-preview-close" autoFocus aria-label="Close product preview" disabled={adding} onClick={onClose}>×</button>
    <ProductImage product={product} className="os-preview-image" />
    <div className="os-preview-copy"><p className="os-eyebrow">{product.category ?? "Product details"}</p><h2 id="os-preview-name">{product.name}</h2><p className="os-preview-price">{formatPrice(variant?.price ?? product.price, product.currency)}</p><p className="os-preview-description">{product.description}</p>
      {product.attributes && <dl className="os-product-attributes">{Object.entries(product.attributes).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}</dl>}
      {product.available !== undefined && <p className={unavailable ? "os-product-unavailable" : "os-product-available"}>{unavailable ? "Currently unavailable" : "Available"}</p>}
      {adapter.addToCart && product.variants?.length ? <label className="os-shopping-label">Option<select value={variantId} disabled={adding} onChange={(event) => { setVariantId(event.target.value); setSuccess(""); }}><option value="">Choose an option</option>{product.variants.map((item) => <option key={item.id} value={item.id} disabled={item.available === false}>{item.name} · {formatPrice(item.price, product.currency)}{item.available === false ? " (unavailable)" : ""}</option>)}</select></label> : null}
      {adapter.addToCart && <div className="os-preview-actions"><label className="os-shopping-label">Quantity<input type="number" min={1} max={99} step={1} value={Number.isNaN(quantity) ? "" : quantity} disabled={adding} onChange={(event) => { setQuantity(event.target.valueAsNumber); setSuccess(""); }} /></label><button className="os-primary" disabled={adding || unavailable || !!(product.variants?.length && !variant)} onClick={add}>{adding ? "Adding..." : "Add to bag"}</button></div>}
      {adapter.navigateToProduct && <button className="os-preview-button" disabled={adding} onClick={() => { void openProductPage(adapter, product.id).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not open product page.")); }}>View product page</button>}
      {adding && <p className="os-shopping-feedback" role="status">Updating your bag...</p>}{error && <p className="os-shopping-error" role="alert">{error}</p>}{success && <div className="os-shopping-success" role="status">✓ {success}<button disabled={adding} onClick={onClose}>Keep browsing</button></div>}
    </div>
  </dialog>;
}

export function ProductDiscovery({ adapter, initialQuery = "", initialProductId, requestId }: { adapter: ShoppingAdapter; initialQuery?: string; initialProductId?: string; requestId?: number }) {
  const [query, setQuery] = useState(initialQuery);
  const [searched, setSearched] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [mode, setMode] = useState<"ai" | "keyword">("keyword");
  const [clarification, setClarification] = useState("");
  const [error, setError] = useState("");
  const [searching, setSearching] = useState(false);
  const [previewing, setPreviewing] = useState("");
  const [preview, setPreview] = useState<Product | null>(null);
  const adapterRef = useRef(adapter); adapterRef.current = adapter;
  const searchController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);

  async function search(value: string) {
    if (!value.trim()) return;
    searchController.current?.abort(); const controller = new AbortController(); searchController.current = controller;
    setSearching(true); setSearched(true); setProducts([]); setClarification(""); setError("");
    try {
      const result = await adapterRef.current.searchProducts(value.trim(), controller.signal);
      if (!controller.signal.aborted) { setProducts(result.products); setMode(result.mode); setClarification(result.clarification ?? "");
        if (adapterRef.current.navigateToProduct && requestsProductPage(value, result.products.length)) await openProductPage(adapterRef.current, result.products[0].id);
      }
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Product search is unavailable. Try again."); }
    finally { if (!controller.signal.aborted) setSearching(false); }
  }
  useEffect(() => { setQuery(initialQuery); if (initialQuery) void search(initialQuery); return () => { searchController.current?.abort(); detailController.current?.abort(); }; }, [initialQuery]);
  async function openPreview(id: string) {
    detailController.current?.abort(); const controller = new AbortController(); detailController.current = controller;
    setPreviewing(id); setError("");
    try {
      const product = await adapterRef.current.getProduct(id, controller.signal);
      if (product.id !== id || !Number.isFinite(product.price) || product.price < 0) throw new Error("Product details could not be verified. Please try again.");
      if (!controller.signal.aborted) setPreview(product);
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Could not load this product."); }
    finally { if (!controller.signal.aborted) setPreviewing(""); }
  }
  useEffect(() => { if (initialProductId) void openPreview(initialProductId); }, [initialProductId, requestId]);
  function submit(event: FormEvent) { event.preventDefault(); void search(query); }
  return <div className="os-discovery"><div className="os-discovery-intro"><p className="os-eyebrow">A little help finding the right thing</p><h2>What do you have in mind?</h2><p>Tell us what you need. Add a budget if you like.</p></div>
    <form className="os-shopping-search" onSubmit={submit}><label className="os-shopping-label">Find products<input value={query} maxLength={500} placeholder="A bottle under $40..." onChange={(event) => setQuery(event.target.value)} required /></label><button className="os-primary" disabled={searching || !query.trim()}>{searching ? "Searching..." : "Find"}</button></form>
    {searching && <p className="os-shopping-feedback" role="status">Finding matches in the store catalog...</p>}{previewing && <p className="os-shopping-feedback" role="status">Loading product details...</p>}{error && <p className="os-shopping-error" role="alert">{error}</p>}
    {!searching && searched && !error && <div aria-live="polite"><p className="os-search-mode">{mode === "ai" ? "AI interpreted your request · Catalog-verified matches" : "Keyword & filter search · No AI generation"}</p>{clarification ? <p className="os-shopping-feedback">{clarification}</p> : products.length ? <p className="os-result-count">{products.length} {products.length === 1 ? "match" : "matches"} for you</p> : <div className="os-no-results"><strong>No catalog matches yet.</strong><p>Try a different product type or a wider budget. Nothing has been added to your bag.</p></div>}</div>}
    <div className="os-product-results">{products.map((product) => <article className="os-product-card" key={product.id}><ProductImage product={product} /><div className="os-product-card__copy"><h3>{product.name}</h3><strong>{formatPrice(product.price, product.currency)}</strong><p>{product.description}</p>{product.available === false && <small>Currently unavailable</small>}<button className="os-preview-button" disabled={!!previewing} onClick={() => void openPreview(product.id)}>Preview product <span aria-hidden="true">↗</span></button>{adapter.navigateToProduct && <button className="os-preview-button" onClick={() => { void openProductPage(adapter, product.id).catch((cause) => setError(cause instanceof Error ? cause.message : "Could not open product page.")); }}>View product page</button>}</div></article>)}</div>
    {preview && <ProductPreview key={preview.id} product={preview} adapter={adapter} onClose={() => setPreview(null)} />}
  </div>;
}

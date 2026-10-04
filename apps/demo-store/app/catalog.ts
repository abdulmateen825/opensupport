import type { CartSelection, Product, SearchIntent } from "@opensupport/widget";

/** Fictional, authoritative store catalog. Product imagery is generated for this catalog. */
export const catalog: Product[] = [
  { id: "tote", name: "Everyday Carry Tote", price: 48, currency: "USD", category: "bags", available: true,
    description: "A roomy, everyday canvas tote with sturdy woven handles. Carry your 13-inch laptop, notebook, and the little things that make a day.",
    image: { src: "/products/tote.png", alt: "Natural canvas Everyday Carry Tote with woven handles" },
    attributes: { Material: "Heavy canvas", Color: "Natural", Fit: "13-inch laptop", Care: "Spot clean" } },
  { id: "bottle", name: "Weekender Bottle", price: 32, currency: "USD", category: "drinkware", available: true,
    description: "A reusable stainless steel bottle with a matte forest finish and a simple screw cap. An easy companion for your desk, commute, or next weekend away.",
    image: { src: "/products/bottle.png", alt: "Matte forest green Weekender Bottle with screw cap" },
    attributes: { Material: "Stainless steel", Color: "Forest", Capacity: "500 ml", Care: "Hand wash" } },
  { id: "notes", name: "Field Notes Set", price: 18, currency: "USD", category: "stationery", available: true,
    description: "Three pocket notebooks for lists, sketches, and ideas worth keeping. Textured paper covers in olive, sand, and terracotta.",
    image: { src: "/products/notes.png", alt: "Three pocket notebooks with olive, sand, and terracotta covers" },
    attributes: { Set: "Three notebooks", Format: "Pocket size", Pages: "Plain paper", Colors: "Olive, sand, terracotta" } },
];

const stopWords = new Set("find show me something for carrying i need want a an the please under below over above between and to than less more up at most least no budget of dollars dollar usd with some product products recommend looking buy get do you have sell can my laptop gift".split(" "));
const aliases: Record<string, string[]> = { bags: ["bag", "bags", "tote", "carry", "carrying", "laptop"], drinkware: ["drinkware", "bottle", "bottles", "water", "drink", "drinks", "flask"], stationery: ["stationery", "notebook", "notebooks", "notes", "note", "paper", "sketch", "writing"] };

export function priceBounds(query: string): Pick<SearchIntent, "min_price" | "max_price"> {
  const between = query.match(/\bbetween\s*\$?(\d+(?:\.\d+)?)\s*(?:and|to|-)\s*\$?(\d+(?:\.\d+)?)/i);
  if (between) { const values = [Number(between[1]), Number(between[2])].sort((a, b) => a - b); return { min_price: values[0], max_price: values[1] }; }
  const upper = query.match(/\b(?:under|below|less than|up to|at most|no more than|budget(?: of)?)\s*\$?(\d+(?:\.\d+)?)/i);
  const lower = query.match(/\b(?:over|above|more than|at least|minimum(?: of)?)\s*\$?(\d+(?:\.\d+)?)/i);
  return { min_price: lower ? Number(lower[1]) : null, max_price: upper ? Number(upper[1]) : null };
}

export function fallbackIntent(query: string): SearchIntent {
  return { search_text: query, category: null, ...priceBounds(query), attributes: [], in_stock: /\b(in stock|available now)\b/i.test(query) };
}

export function validIntent(value: unknown): value is SearchIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as SearchIntent;
  const fields = ["search_text", "category", "min_price", "max_price", "attributes", "in_stock"];
  return Object.keys(value).every((key) => fields.includes(key)) && typeof item.search_text === "string" && item.search_text.length <= 500
    && (item.category === null || Object.keys(aliases).includes(item.category))
    && [item.min_price, item.max_price].every((price) => price === null || (typeof price === "number" && Number.isFinite(price) && price >= 0))
    && (item.min_price === null || item.max_price === null || item.min_price <= item.max_price)
    && Array.isArray(item.attributes) && item.attributes.length <= 8 && item.attributes.every((attribute) => typeof attribute === "string" && attribute.length > 0 && attribute.length <= 80)
    && typeof item.in_stock === "boolean";
}

export function filterCatalog(query: string, intent: SearchIntent, records = catalog): { products: Product[]; clarification?: string } {
  const explicit = priceBounds(query);
  const min = Math.max(intent.min_price ?? 0, explicit.min_price ?? 0);
  const max = Math.min(intent.max_price ?? Infinity, explicit.max_price ?? Infinity);
  const words: string[] = query.toLowerCase().match(/[a-z]+/g) ?? [];
  const explicitCategory = Object.keys(aliases).find((category) => aliases[category].some((word) => words.includes(word)));
  const category = explicitCategory ?? intent.category;
  const gift = words.includes("gift");
  const terms = (intent.search_text.toLowerCase().match(/[a-z]+/g) ?? []).filter((word) => !stopWords.has(word));
  if (!category && !gift && !terms.length && !explicit.max_price && !explicit.min_price && !intent.attributes.length) return { products: [], clarification: "What are you looking for: a bag, a bottle, or a notebook? You can include a budget." };
  const results = records.filter((product) => {
    if (product.price < min || product.price > max || (category && product.category !== category)) return false;
    if ((intent.in_stock || /\b(in stock|available now)\b/i.test(query)) && product.available !== true) return false;
    const searchable = `${product.name} ${product.description} ${product.category} ${Object.values(product.attributes ?? {}).join(" ")}`.toLowerCase();
    if (intent.attributes.some((attribute) => !searchable.includes(attribute.toLowerCase()))) return false;
    return !!category || gift || !terms.length || terms.some((term) => searchable.includes(term));
  });
  return { products: results.slice(0, 12) };
}

export function getCatalogProduct(id: string): Product {
  const product = catalog.find((item) => item.id === id);
  if (!product) throw new Error("This product is no longer in the catalog.");
  return product;
}

export function applyCartSelection(cart: Record<string, number>, selection: CartSelection): Record<string, number> {
  const product = getCatalogProduct(selection.productId);
  if (product.available === false) throw new Error("This product is unavailable.");
  if (!Number.isInteger(selection.quantity) || selection.quantity < 1 || selection.quantity > 99) throw new Error("Choose a whole-number quantity from 1 to 99.");
  if (selection.variantId !== undefined) throw new Error("This product has no selectable variants.");
  const quantity = (cart[product.id] ?? 0) + selection.quantity;
  if (quantity > 99) throw new Error("Your bag can hold at most 99 of this item. Reduce the quantity.");
  return { ...cart, [product.id]: quantity };
}

export function cartTotal(cart: Record<string, number>): number {
  return catalog.reduce((sum, product) => sum + product.price * (cart[product.id] ?? 0), 0);
}

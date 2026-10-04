/** Host-owned capabilities. OpenSupport never owns a second cart or trusts a displayed price. */
export type Product = {
  id: string;
  name: string;
  price: number;
  currency: string;
  description: string;
  image?: { src: string; alt: string };
  category?: string;
  attributes?: Record<string, string>;
  available?: boolean;
  variants?: { id: string; name: string; price: number; available?: boolean }[];
};

export type SearchIntent = {
  search_text: string;
  category: string | null;
  min_price: number | null;
  max_price: number | null;
  attributes: string[];
  in_stock: boolean;
};
export type CatalogSearchResult = { products: Product[]; mode: "ai" | "keyword"; clarification?: string };
export type CartSelection = { productId: string; quantity: number; variantId?: string };
export type CartAddition = { message: string; itemCount?: number };
export type ShoppingAdapter = {
  searchProducts: (query: string, signal?: AbortSignal) => Promise<CatalogSearchResult>;
  getProduct: (id: string, signal?: AbortSignal) => Promise<Product>;
  /** Omit to keep discovery read-only. */
  addToCart?: (selection: CartSelection) => Promise<CartAddition>;
  /** The host resolves the canonical product URL; AI never supplies a URL. */
  navigateToProduct?: (productId: string) => void | Promise<void>;
};

export async function openProductPage(adapter: ShoppingAdapter, productId: string) {
  if (!adapter.navigateToProduct) throw new Error("Product-page navigation is not enabled by this website.");
  const product = await adapter.getProduct(productId);
  if (product.id !== productId) throw new Error("Product details could not be verified.");
  await adapter.navigateToProduct(product.id);
}

export function requestsProductPage(query: string, matchCount: number): boolean {
  return matchCount === 1 && /\b(open|take me|redirect|go to)\b/i.test(query) && /\b(page|website)\b/i.test(query);
}

export function validateQuantity(quantity: number): number {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) throw new Error("Choose a whole-number quantity from 1 to 99.");
  return quantity;
}

/** The latch is synchronous; two clicks in the same render cannot submit twice. */
export function createCartActionGuard() {
  let pending = false;
  return async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    if (pending) return undefined;
    pending = true;
    try { return await action(); } finally { pending = false; }
  };
}

export function formatPrice(price: number, currency: string): string {
  try { return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(price); }
  catch { return `${currency} ${price.toFixed(2)}`; }
}

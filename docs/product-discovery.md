# Product discovery and customer-confirmed bag additions

The Northstar demo now uses one authoritative fictional catalog in `apps/demo-store/app/catalog.ts`. The storefront and widget share the same host-owned bag. Searching and opening previews never add anything. Only an explicit **Add to bag** sends a product ID, quantity, and optional real variant ID to the host callback. The host resolves prices and availability from its catalog; client-supplied prices are ignored. This catalog has no selectable variants.

## Configuration

Keep provider secrets in the backend environment: existing `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_BASE_URL`, and `LLM_MODEL`. No provider key belongs in a `NEXT_PUBLIC_*` variable or widget configuration. Configure `NEXT_PUBLIC_OPENSUPPORT_PROJECT_ID` and `NEXT_PUBLIC_API_URL` in the demo store; `OPENSUPPORT_API_URL` optionally overrides the backend address for server-side catalog requests. Register the demo store's actual origin on the project. Restart affected services after environment changes.

The demo's search route asks `/api/widget/{project_id}/shopping/intent` to interpret a query using the existing configured provider. The backend checks project existence and allowed origin, applies a 12-second provider timeout, validates JSON strictly, and preserves explicit budgets. The demo independently validates the intent and filters actual catalog records. Invalid output, missing configuration, unavailable APIs, or provider failures use clearly labeled **Keyword & filter search · No AI generation**. Only successful provider interpretation is labeled AI. Prices, product IDs, descriptions, images, stock, and attributes always come from the catalog.

## Reuse in another store

Import `ShoppingAdapter`, `Product`, `CartSelection`, and `CatalogSearchResult` from `@opensupport/widget`. Supply `shoppingAdapter` to `ChatWidget`, or pass it in the fifth options argument to `mountOpenSupportWidget`:

```tsx
<ChatWidget projectId={projectId} apiUrl={apiUrl} shoppingAdapter={{
  searchProducts: (query, signal) => yourCatalog.search(query, signal),
  getProduct: (id, signal) => yourCatalog.get(id, signal),
  addToCart: (selection) => yourExistingCart.add(selection),
  navigateToProduct: (id) => yourRouter.openProduct(id),
}} />
```

Return authoritative products and an `ai` or `keyword` search mode. Search and detail callbacks are read-only. The cart callback must validate ID, integer quantity, availability, and optional variant, derive the price server-side for real commerce, update the existing cart, and return a confirmation message. The widget suppresses duplicate clicks while an addition is pending, releases the guard after errors, and allows a later deliberate addition. Production commerce should also enforce server-side idempotency and inventory checks. The public demo uses local storage and fictional checkout for testing only.

The basic widget enables support only. `orderLookup` explicitly enables tracking; without it no tracking tab or automatic order-tool fallback exists. `shoppingAdapter` enables catalog search/details. Its `addToCart` callback is optional: omit it to hide cart/quantity controls and keep previews read-only. Its `navigateToProduct` callback is also optional and receives a verified catalog ID; the host resolves a canonical URL. Product-page actions appear only when this callback exists. An explicit request such as “Open the bottle product page” navigates after exactly one catalog match is verified; multiple matches remain visible for customer selection. AI never supplies a redirect URL. The demo supplies all callbacks and has real local pages at `/products/tote`, `/products/bottle`, and `/products/notes`, sharing the same persisted bag.

Only the current search query and catalog category vocabulary are sent to the intent provider. Chat history, order details, identity tokens, visitor identifiers, and cart contents are not included. Query text may itself contain personal data entered by the customer. Existing provider data-handling terms still apply. Human requests, support/policy questions, and order tracking retain their existing routes; agent-owned conversations do not switch into shopping.

## Checks and manual testing

Use Node 24 (or a Node release supporting native TypeScript stripping) for `corepack pnpm --filter @opensupport/widget test:shopping` and `corepack pnpm --filter @opensupport/demo-store test:shopping`. Run `corepack pnpm typecheck`, `corepack pnpm build`, backend pytest, and Ruff as usual.

1. Open the demo store with a configured project; open the concierge. Try “Find me a gift under $50”, “Show me bottles under $40”, and “I need something for carrying my laptop”. Check that only catalog products appear within the requested budget.
2. Preview a match; check image, price, description, attributes, availability, Escape/close behavior, focus restoration, and mobile scrolling. Merely previewing must leave the bag unchanged.
3. Choose quantity 2, then explicitly add. Check the storefront bag, subtotal, confirmation, and persistence after reload. Rapid clicks during a pending callback should add once; a deliberate later addition should work. Invalid quantities and unknown IDs should fail without changing the bag.
4. Try an unknown product, a vague request, and an unavailable backend/provider. Check empty results, clarification, and the keyword fallback label. Try a broken image URL in a temporary catalog record to check its accessible placeholder.
5. Generate a fictional order through the bag, then track it in the widget. Check existing sample orders, normal support questions, “I want a human”, and an agent-owned conversation. Existing signed identity requirements for protected tracking remain in place.
6. Check keyboard navigation and narrow/desktop screens. Native dialogs handle focus trapping and Escape. No browser was connected in this implementation session, so visual and interactive browser smoke testing must be performed locally.

Limits: a three-product USD catalog, basic keyword fallback and price parsing, no currency conversion, no live inventory or payment integration, and no invented variants. Automated tests mock provider responses; they do not certify a live provider connection.

The README lists the release checks, and CI runs them with locked dependencies. Browser visual/interaction and live provider/handoff checks require a connected browser and running services; automated tests do not replace these acceptance checks.

## Generated imagery

Created with the built-in ImageGen tool, inspected, and copied to `apps/demo-store/public/products/tote.png`, `bottle.png`, and `notes.png`. These are synthetic illustrations of fictional demo products; the storefront discloses this.

Prompt set: premium fictional ecommerce product photographs, square composition, warm off-white limestone backdrop, soft daylight from the left, natural subtle shadows, tactile materials, full product visible with generous margins, no logos, readable text, watermarks, or unrelated props. Tote: natural undyed canvas, wide rectangular body, two woven handles, small olive fabric label, three-quarter front view; no laptop shown. Bottle: one matte forest-green stainless steel cylindrical bottle, rounded shoulder, matching screw cap, no handle. Notebooks: three pocket notebooks with olive, sand, and terracotta textured kraft covers, rounded corners and cream paper edges, overlapping elevated view.

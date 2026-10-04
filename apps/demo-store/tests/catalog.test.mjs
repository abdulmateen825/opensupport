import test from "node:test";
import assert from "node:assert/strict";
import { catalog, fallbackIntent, filterCatalog, validIntent, getCatalogProduct, applyCartSelection, cartTotal } from "../app/catalog.ts";

test("requested examples return actual catalog products within their budgets", () => {
  assert.deepEqual(filterCatalog("Find me a bottle under $40", fallbackIntent("Find me a bottle under $40")).products.map((item) => item.id), ["bottle"]);
  assert.deepEqual(filterCatalog("Show me something for carrying my laptop", fallbackIntent("Show me something for carrying my laptop")).products.map((item) => item.id), ["tote"]);
  assert.equal(filterCatalog("I need a gift under $50", fallbackIntent("I need a gift under $50")).products.length, 3);
});

test("application price and category restrictions cannot be widened by model intent", () => {
  const invented = { ...fallbackIntent("anything"), search_text: "", category: "bags", max_price: 1000 };
  assert.deepEqual(filterCatalog("Find me a bottle under $30", invented).products, []);
  const matches = filterCatalog("a gift between $20 and $40", fallbackIntent("a gift between $20 and $40")).products;
  assert.deepEqual(matches.map((item) => item.id), ["bottle"]);
});

test("availability constraints and attributes use authoritative records", () => {
  const unavailable = catalog.map((item) => ({ ...item, available: false }));
  assert.deepEqual(filterCatalog("bottle in stock", fallbackIntent("bottle in stock"), unavailable).products, []);
  assert.deepEqual(filterCatalog("bottle", { ...fallbackIntent("bottle"), attributes: ["waterproof laptop"] }).products, []);
});

test("vague searches clarify and unmatched products return no results", () => {
  assert.ok(filterCatalog("Find me something", fallbackIntent("Find me something")).clarification);
  assert.deepEqual(filterCatalog("Find me a camera", fallbackIntent("Find me a camera")).products, []);
});

test("hallucinated IDs, malformed filters and unknown categories fail intent validation", () => {
  assert.equal(validIntent({ ...fallbackIntent("bottle"), product_ids: ["imaginary"] }), false);
  assert.equal(validIntent({ ...fallbackIntent("bottle"), max_price: "40" }), false);
  assert.equal(validIntent({ ...fallbackIntent("bottle"), category: "imaginary" }), false);
  assert.equal(validIntent({ ...fallbackIntent("bottle"), min_price: 50, max_price: 10 }), false);
  assert.equal(validIntent(fallbackIntent("bottle")), true);
});

test("unknown IDs, invalid quantities and unsupported options cannot update the bag", () => {
  assert.throws(() => getCatalogProduct("imaginary"));
  for (const quantity of [0, -1, 1.5, 100, NaN]) assert.throws(() => applyCartSelection({}, { productId: "tote", quantity }));
  assert.throws(() => applyCartSelection({}, { productId: "imaginary", quantity: 1 }));
  assert.throws(() => applyCartSelection({}, { productId: "tote", quantity: 1, variantId: "invented" }));
  assert.throws(() => applyCartSelection({ tote: 99 }, { productId: "tote", quantity: 1 }));
});

test("preview and search do not mutate cart; confirmed addition uses actual catalog prices", () => {
  const cart = { bottle: 1 };
  filterCatalog("tote", fallbackIntent("tote")); getCatalogProduct("tote");
  assert.deepEqual(cart, { bottle: 1 });
  const next = applyCartSelection(cart, { productId: "tote", quantity: 2, price: 0.01 });
  assert.deepEqual(next, { bottle: 1, tote: 2 });
  assert.equal(cartTotal(next), 128);
  assert.deepEqual(JSON.parse(JSON.stringify(next)), next);
});

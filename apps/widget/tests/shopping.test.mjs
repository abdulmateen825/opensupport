import test from "node:test";
import assert from "node:assert/strict";
import { createCartActionGuard, validateQuantity, openProductPage, requestsProductPage } from "../src/shopping.ts";
import { routeCustomerMessage } from "../src/routing.ts";

test("shopping requests route to discovery; support, tracking and human requests retain their flows", () => {
  for (const query of ["Find me a bottle under $40", "Show me something for carrying my laptop", "I need a gift under $50"])
    assert.equal(routeCustomerMessage(query, "open", true), "shopping");
  for (const query of ["How do I return a bottle?", "I need help with an order", "Show me your shipping policy", "Find me a human", "I want a refund", "I need to cancel my order"])
    assert.equal(routeCustomerMessage(query, "open", true), "support");
  assert.equal(routeCustomerMessage("Track order NS-1002", "open", true, true), "order");
  assert.equal(routeCustomerMessage("Track order NS-1002", "open", true), "support");
  assert.equal(routeCustomerMessage("Open the bottle product page", "open", true), "shopping");
  assert.equal(routeCustomerMessage("Find me a gift", "open", false), "support");
  for (const status of ["assigned", "escalated", "resolved"]) {
    assert.equal(routeCustomerMessage("Find me a gift", status, true), "support");
    assert.equal(routeCustomerMessage("Track order NS-1002", status, true), "support");
  }
});

test("navigation is opt-in and resolves a catalog ID without accepting AI URLs", async () => {
  const ids = [];
  const adapter = { getProduct: async (id) => ({ id }), navigateToProduct: (id) => ids.push(id) };
  await openProductPage(adapter, "bottle");
  assert.deepEqual(ids, ["bottle"]);
  await assert.rejects(openProductPage({ getProduct: adapter.getProduct }, "bottle"), /not enabled/);
  await assert.rejects(openProductPage({ ...adapter, getProduct: async () => ({ id: "invented" }) }, "bottle"), /verified/);
  await assert.rejects(openProductPage({ ...adapter, getProduct: async () => { throw new Error("Unknown product"); } }, "unknown"));
  assert.deepEqual(ids, ["bottle"]);
});

test("automatic navigation requires an explicit page request and exactly one match", () => {
  assert.equal(requestsProductPage("Take me to the bottle product page", 1), true);
  assert.equal(requestsProductPage("Open the bottle product page", 1), true);
  assert.equal(requestsProductPage("Find me a bottle", 1), false);
  assert.equal(requestsProductPage("Take me to a product page", 3), false);
  assert.equal(requestsProductPage("Take me to the camera page", 0), false);
});

test("quantity rejects zero, fractions, negatives, NaN and excessive quantities", () => {
  for (const quantity of [0, -1, 1.5, NaN, 100, Infinity]) assert.throws(() => validateQuantity(quantity));
  assert.equal(validateQuantity(1), 1);
  assert.equal(validateQuantity(99), 99);
});

test("in-flight duplicate clicks are ignored, but a later deliberate addition is permitted", async () => {
  const guard = createCartActionGuard();
  let release;
  let additions = 0;
  const first = guard(async () => { additions++; await new Promise((resolve) => { release = resolve; }); return "added"; });
  assert.equal(await guard(async () => { additions++; }), undefined);
  assert.equal(additions, 1);
  release(); assert.equal(await first, "added");
  await guard(async () => { additions++; });
  assert.equal(additions, 2);
});

test("a failed cart action releases the guard for a retry", async () => {
  const guard = createCartActionGuard();
  await assert.rejects(guard(async () => { throw new Error("cart unavailable"); }));
  assert.equal(await guard(async () => "retried"), "retried");
});

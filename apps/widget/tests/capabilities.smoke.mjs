import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatWidget } from "../dist/opensupport-widget.js";

const render = (props = {}) => renderToStaticMarkup(React.createElement(ChatWidget, { projectId: "", ...props }));

test("built default widget exposes support only even if an initial order ID is supplied", () => {
  const markup = render({ initialOrderId: "NS-1002" });
  assert.ok(!markup.includes("Track order"));
  assert.ok(!markup.includes("Find products"));
});

test("a host tracking callback explicitly enables the tracking control", () => {
  const markup = render({ orderLookup: async () => ({ order_id: "test", status: "processing" }) });
  assert.ok(markup.includes("Track order"));
  assert.ok(!markup.includes("Find products"));
});

test("discovery can be enabled independently without tracking or a cart callback", () => {
  const markup = render({ shoppingAdapter: { searchProducts: async () => ({ products: [], mode: "keyword" }), getProduct: async () => { throw new Error("missing"); } } });
  assert.ok(markup.includes("Find products"));
  assert.ok(!markup.includes("Track order"));
});

# Test demo order tracking

Run `corepack pnpm --filter @opensupport/demo-store dev --port 3002` from the repository root and open http://localhost:3002.

Open the support chat, choose **Track an order**, enter an order number, and click **Track order**. Alternatively, type `Track order NS-1002` in chat or click **Track order** on a storefront order card to open its tracking result directly.

Add products to your bag and select **Create demo order** to generate another fictional order. New orders and the bag persist in the same browser. No real purchase is made.

| Order | Expected status |
| --- | --- |
| NS-1001 | Processing |
| NS-1002 | Shipped |
| NS-1003 | Delivered |
| NS-1004 | Cancelled |
| NS-9999 | Order not found |

These are public fictional fixtures served by the demo storefront's `/api/orders/[orderId]` route. Dates are fixed sample dates, not live shipping estimates. Demo tracking works without the backend or a project ID. General support chat still requires a configured project and backend.

Outside the demo store, the widget tracking tab uses the existing backend order-status integration and requires a signed customer identity. No production identity checks are bypassed.

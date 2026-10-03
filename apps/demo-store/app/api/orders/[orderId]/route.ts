import { demoOrders } from "../../../orders";

// Public fictional fixtures for the demo storefront only.
export async function GET(_request: Request, context: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await context.params;
  const order = demoOrders.find((item) => item.order_id === orderId.trim().toUpperCase());
  return order ? Response.json(order) : Response.json({ detail: "Order not found. Try NS-1001, NS-1002, NS-1003 or NS-1004." }, { status: 404 });
}

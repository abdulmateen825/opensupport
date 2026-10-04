import { catalog, fallbackIntent, filterCatalog, validIntent } from "../../../catalog";

export async function POST(request: Request) {
  let body: { query?: unknown; projectId?: unknown };
  try { body = await request.json(); } catch { return Response.json({ detail: "Enter a product search." }, { status: 400 }); }
  if (!body || typeof body.query !== "string" || !body.query.trim() || body.query.length > 500) return Response.json({ detail: "Enter a search of 1–500 characters." }, { status: 422 });
  const query = body.query.trim();
  let intent = fallbackIntent(query);
  let mode: "ai" | "keyword" = "keyword";
  if (typeof body.projectId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.projectId)) {
    try {
      // This URL comes only from server configuration, never from request data.
      const base = process.env.OPENSUPPORT_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
      const response = await fetch(`${base.replace(/\/$/, "")}/api/widget/${body.projectId}/shopping/intent`, {
        method: "POST", headers: { "Content-Type": "application/json", Origin: request.headers.get("origin") ?? new URL(request.url).origin },
        body: JSON.stringify({ query, categories: [...new Set(catalog.map((product) => product.category))] }),
        signal: AbortSignal.timeout(14000), cache: "no-store",
      });
      if (response.ok) {
        const data = await response.json();
        if (validIntent(data.intent)) { intent = data.intent; mode = data.mode === "ai" ? "ai" : "keyword"; }
      }
    } catch { /* Public demo catalog remains usable when the support API is unavailable. */ }
  }
  return Response.json({ ...filterCatalog(query, intent), mode });
}

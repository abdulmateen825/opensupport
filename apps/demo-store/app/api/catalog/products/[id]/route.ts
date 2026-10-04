import { getCatalogProduct } from "../../../../catalog";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { return Response.json(getCatalogProduct((await context.params).id)); }
  catch { return Response.json({ detail: "This product is no longer in the catalog." }, { status: 404 }); }
}

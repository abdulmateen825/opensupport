import { notFound } from "next/navigation";
import Storefront from "../../Storefront";
import { catalog } from "../../catalog";

export default async function ProductPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!catalog.some((product) => product.id === id)) notFound();
  return <Storefront productPageId={id} />;
}

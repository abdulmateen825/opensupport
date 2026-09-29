import type { Metadata } from "next";
import "./style.css";

export const metadata: Metadata = { title: "Northstar Supply | Demo Store", description: "OpenSupport demo storefront" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

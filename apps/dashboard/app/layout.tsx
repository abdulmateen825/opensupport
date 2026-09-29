import type { Metadata } from "next";
import "./style.css";

export const metadata: Metadata = { title: "OpenSupport Admin", description: "Manage projects and support knowledge" };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

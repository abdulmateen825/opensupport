import React from "react";
import { createRoot } from "react-dom/client";
import { ChatWidget } from "./index";

function Playground() {
  const projectId = new URLSearchParams(location.search).get("project") ?? "";
  if (!projectId) return <main style={{ font: "14px system-ui", padding: 30 }}><h1>Widget preview</h1><p>Open this page with <code>?project=YOUR_PROJECT_ID</code> after creating a project in the dashboard.</p></main>;
  return <main style={{ display: "grid", placeItems: "center", minHeight: "100vh", background: "#f4f6fa" }}><ChatWidget projectId={projectId} /></main>;
}

createRoot(document.getElementById("root")!).render(<Playground />);

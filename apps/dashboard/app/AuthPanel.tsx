"use client";

import { FormEvent, useState } from "react";
import { API } from "./api";

type AuthResult = { access_token: string; refresh_token: string; user: { display_name: string; role: string } };

export default function AuthPanel({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return; setBusy(true); setError("");
    try {
      const payload = mode === "login" ? { email, password } : {
        email, password, display_name: displayName, organization_name: organizationName,
      };
      const response = await fetch(`${API}/api/auth/${mode}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(typeof result.detail === "string" ? result.detail : Array.isArray(result.detail) ? result.detail.map((item: { msg: string }) => item.msg).join("; ") : "Authentication failed");
      const auth = result as AuthResult;
      localStorage.setItem("opensupport:access-token", auth.access_token);
      localStorage.setItem("opensupport:refresh-token", auth.refresh_token);
      localStorage.setItem("opensupport:agent-name", auth.user.display_name);
      onAuthenticated();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Authentication failed");
    } finally { setBusy(false); }
  }

  return <main className="auth-screen"><form className="auth-card" onSubmit={submit}>
    <div className="brand auth-brand"><span>O</span> OpenSupport</div>
    <p className="eyebrow">SECURE WORKSPACE</p><h1>{mode === "login" ? "Welcome back" : "Create your organization"}</h1>
    <p className="auth-description">{mode === "login" ? "Sign in to manage your support workspace." : "Your projects and conversations will be isolated in a new organization."}</p>
    {mode === "register" && <><label>Organization name<input value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} required maxLength={160} /></label><label>Your name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={120} /></label></>}
    <label>Email<input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
    <label>Password<input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} minLength={mode === "register" ? 12 : 1} required /></label>
    {error && <div className="auth-error" role="alert">{error}</div>}
    <button className="auth-submit" disabled={busy}>{busy ? "Please wait…" : mode === "login" ? "Sign in" : "Create workspace"}</button>
    <button type="button" className="auth-switch" onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>{mode === "login" ? "Create a new organization" : "Already have an account? Sign in"}</button>
  </form></main>;
}

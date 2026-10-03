export const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

let refreshRequest: Promise<string | null> | null = null;

async function refreshAccessToken() {
  if (!refreshRequest) {
    refreshRequest = (async () => {
      const refreshToken = localStorage.getItem("opensupport:refresh-token");
      if (!refreshToken) return null;
      const response = await fetch(`${API}/api/auth/refresh`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      });
      if (!response.ok) return null;
      const result = await response.json();
      localStorage.setItem("opensupport:access-token", result.access_token);
      localStorage.setItem("opensupport:refresh-token", result.refresh_token);
      return result.access_token as string;
    })().finally(() => { refreshRequest = null; });
  }
  return refreshRequest;
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const token = typeof window === "undefined" ? "" : localStorage.getItem("opensupport:access-token") ?? "";
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${API}${path}`, { ...init, headers });
  if (response.status !== 401 || !token || ["/api/auth/login", "/api/auth/register", "/api/auth/refresh"].includes(path)) return response;
  const nextToken = await refreshAccessToken();
  if (!nextToken) {
    localStorage.removeItem("opensupport:access-token");
    localStorage.removeItem("opensupport:refresh-token");
    window.dispatchEvent(new Event("opensupport:session-expired"));
    return response;
  }
  const retryHeaders = new Headers(init.headers);
  retryHeaders.set("Authorization", `Bearer ${nextToken}`);
  return fetch(`${API}${path}`, { ...init, headers: retryHeaders });
}

export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await apiFetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    const detail = typeof body.detail === "string" ? body.detail : Array.isArray(body.detail)
      ? body.detail.map((item: { msg?: string }) => item.msg ?? "Invalid value").join("; ") : `Request failed (${response.status})`;
    throw new Error(detail);
  }
  return response.status === 204 ? undefined as T : response.json();
}

export function jsonBody(body: unknown, method = "POST"): RequestInit {
  return { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
}

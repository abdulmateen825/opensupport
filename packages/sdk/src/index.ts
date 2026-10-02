import type { Conversation, Message, Project } from "@opensupport/shared-types";

export interface OpenSupportClientOptions {
  baseUrl: string;
  apiKey: string;
  fetch?: typeof fetch;
}

/** Server side REST client. Keep its API key out of browser bundles. */
export class OpenSupportClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetcher: typeof fetch;

  constructor(options: OpenSupportClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.apiKey = options.apiKey;
    this.fetcher = options.fetch ?? fetch;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "Authorization": `Bearer ${this.apiKey}`, "Content-Type": "application/json", ...init?.headers },
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({})) as { detail?: string };
      throw new Error(payload.detail ?? `OpenSupport request failed (${response.status})`);
    }
    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
  }

  listProjects(): Promise<Project[]> {
    return this.request("/api/projects");
  }

  listConversations(options: { status?: Conversation["status"]; query?: string } = {}): Promise<Conversation[]> {
    const params = new URLSearchParams();
    if (options.status) params.set("status", options.status);
    if (options.query) params.set("q", options.query);
    const query = params.toString();
    return this.request(`/api/agents/conversations${query ? `?${query}` : ""}`);
  }

  listMessages(conversationId: string): Promise<Message[]> {
    return this.request(`/api/agents/conversations/${encodeURIComponent(conversationId)}/messages`);
  }

  reply(conversationId: string, content: string): Promise<Message> {
    return this.request(`/api/agents/conversations/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST", body: JSON.stringify({ agent_name: "OpenSupport API", content }),
    });
  }
}

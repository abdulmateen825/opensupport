export type ConversationStatus = "open" | "assigned" | "escalated" | "resolved";

export interface Project {
  id: string;
  organization_id: string;
  name: string;
  allowed_domains: string[];
  created_at: string;
}

export interface Conversation {
  id: string;
  project_id: string;
  status: ConversationStatus;
  assigned_agent: string | null;
  escalation_reason: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  sender_type: "customer" | "assistant" | "agent" | "system";
  sender_name: string | null;
  content: string;
  source_title: string | null;
  created_at: string;
}

export interface ApiError {
  detail?: string;
}

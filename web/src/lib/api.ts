import { getUser } from "./user";

export type Severity = "SEV1" | "SEV2" | "SEV3";
export type Status = "investigating" | "identified" | "monitoring" | "resolved";
export type EventKind = "alert" | "error" | "deploy" | "change" | "note" | "status_change" | "recovery";

export interface Postmortem {
  summary: string;
  impact: string;
  rootCause: string;
  detection: string;
  resolution: string;
  timeline: { time: string; description: string }[];
  whatWentWell: string[];
  whatWentWrong: string[];
  actionItems: { title: string; priority: "P0" | "P1" | "P2"; owner: string }[];
  generatedBy: "claude" | "template";
  generatedAt: string;
}

export interface Incident {
  id: string;
  title: string;
  severity: Severity;
  status: Status;
  created_at: string;
  resolved_at: string | null;
  postmortem: Postmortem | null;
}

export interface IncidentSummary extends Incident {
  event_count: number;
  last_event_at: string | null;
}

export interface TimelineEvent {
  id: string;
  incident_id: string | null;
  source: "github" | "sentry" | "uptime" | "manual" | "system";
  kind: EventKind;
  title: string;
  detail: Record<string, unknown>;
  author: string | null;
  occurred_at: string;
  received_at: string;
}

export interface Metrics {
  bucketMs: number;
  buckets: { t: string; errors: number; alerts: number }[];
  markers: { t: string; kind: "deploy" | "change" | "recovery"; title: string }[];
  durationMs: number | null;
}

export type LiveMessage =
  | { type: "event"; incidentId: string; event: TimelineEvent }
  | { type: "incident"; incident: Incident };

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-user-name": getUser()?.name ?? "",
      ...init.headers,
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
  return body as T;
}

export const api = {
  config: () => request<{ aiEnabled: boolean }>("/api/config"),
  listIncidents: () => request<{ incidents: IncidentSummary[] }>("/api/incidents"),
  getIncident: (id: string) => request<{ incident: Incident; events: TimelineEvent[] }>(`/api/incidents/${id}`),
  createIncident: (body: { title: string; severity: Severity }) =>
    request<{ incident: Incident }>("/api/incidents", { method: "POST", body: JSON.stringify(body) }),
  updateIncident: (id: string, body: Partial<Pick<Incident, "status" | "severity" | "title">>) =>
    request<{ incident: Incident }>(`/api/incidents/${id}`, { method: "PATCH", body: JSON.stringify(body) }),
  addNote: (id: string, title: string) =>
    request<{ event: TimelineEvent }>(`/api/incidents/${id}/events`, { method: "POST", body: JSON.stringify({ title }) }),
  metrics: (id: string) => request<Metrics>(`/api/incidents/${id}/metrics`),
  generatePostmortem: (id: string) =>
    request<{ incident: Incident; postmortem: Postmortem }>(`/api/incidents/${id}/postmortem`, { method: "POST" }),
};

export const SEVERITIES = ["SEV1", "SEV2", "SEV3"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const STATUSES = ["investigating", "identified", "monitoring", "resolved"] as const;
export type Status = (typeof STATUSES)[number];

export type EventSource = "github" | "sentry" | "uptime" | "manual" | "system";
export type EventKind = "alert" | "error" | "deploy" | "change" | "note" | "status_change" | "recovery";

/** Provider-agnostic shape every webhook payload is converted into before storage. */
export interface NormalizedEvent {
  source: EventSource;
  kind: EventKind;
  title: string;
  detail: Record<string, unknown>;
  externalId?: string;
  occurredAt: string; // ISO 8601
  author?: string;
  /** Severity to use if this event has to open a new incident. */
  suggestedSeverity?: Severity;
}

export interface Incident {
  id: string;
  title: string;
  severity: Severity;
  status: Status;
  created_at: string;
  resolved_at: string | null;
  postmortem: unknown | null;
}

export interface TimelineEvent {
  id: string;
  incident_id: string | null;
  source: EventSource;
  kind: EventKind;
  title: string;
  detail: Record<string, unknown>;
  author: string | null;
  external_id: string | null;
  occurred_at: string;
  received_at: string;
}

/** Messages pushed to browsers over the /live socket. */
export type LiveMessage =
  | { type: "event"; incidentId: string; event: TimelineEvent }
  | { type: "incident"; incident: Incident };

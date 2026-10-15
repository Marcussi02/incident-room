import { z } from "zod";
import type { NormalizedEvent, Severity } from "../types.js";

// Payload schemas only describe the fields we use; providers send much more.

const DeploymentStatusPayload = z.object({
  deployment_status: z.object({
    id: z.number(),
    state: z.string(),
    environment: z.string().optional(),
    created_at: z.string(),
    target_url: z.string().nullish(),
  }),
  deployment: z.object({ sha: z.string(), ref: z.string().optional(), environment: z.string().optional() }),
  repository: z.object({ full_name: z.string() }),
  sender: z.object({ login: z.string() }).optional(),
});

const WorkflowRunPayload = z.object({
  action: z.string(),
  workflow_run: z.object({
    id: z.number(),
    name: z.string(),
    conclusion: z.string().nullable(),
    head_branch: z.string().nullable(),
    head_sha: z.string(),
    html_url: z.string(),
    updated_at: z.string(),
  }),
  repository: z.object({ full_name: z.string() }),
});

const PushPayload = z.object({
  ref: z.string(),
  after: z.string(),
  commits: z.array(z.object({ id: z.string(), message: z.string() })).default([]),
  head_commit: z.object({ timestamp: z.string() }).nullable().optional(),
  compare: z.string().optional(),
  pusher: z.object({ name: z.string() }).optional(),
  repository: z.object({ full_name: z.string(), default_branch: z.string().optional() }),
});

const short = (sha: string) => sha.slice(0, 7);

/** Converts a GitHub webhook into a timeline event, or null for events we don't track. */
export function normalizeGithub(eventName: string, payload: unknown): NormalizedEvent | null {
  if (eventName === "deployment_status") {
    const p = DeploymentStatusPayload.parse(payload);
    const env = p.deployment_status.environment ?? p.deployment.environment ?? "production";
    const state = p.deployment_status.state;
    if (state !== "success" && state !== "failure" && state !== "error") return null;
    const failed = state !== "success";
    return {
      source: "github",
      kind: failed ? "alert" : "deploy",
      title: failed
        ? `Deploy to ${env} failed (${short(p.deployment.sha)})`
        : `Deployed ${short(p.deployment.sha)} to ${env}`,
      detail: { repo: p.repository.full_name, sha: p.deployment.sha, environment: env, url: p.deployment_status.target_url },
      externalId: `deployment_status:${p.deployment_status.id}`,
      occurredAt: new Date(p.deployment_status.created_at).toISOString(),
      author: p.sender?.login,
      suggestedSeverity: "SEV2",
    };
  }

  if (eventName === "workflow_run") {
    const p = WorkflowRunPayload.parse(payload);
    if (p.action !== "completed" || p.workflow_run.conclusion !== "failure") return null;
    return {
      source: "github",
      kind: "alert",
      title: `CI failed: ${p.workflow_run.name} on ${p.workflow_run.head_branch ?? "unknown branch"}`,
      detail: { repo: p.repository.full_name, sha: p.workflow_run.head_sha, url: p.workflow_run.html_url },
      externalId: `workflow_run:${p.workflow_run.id}`,
      occurredAt: new Date(p.workflow_run.updated_at).toISOString(),
      suggestedSeverity: "SEV3",
    };
  }

  if (eventName === "push") {
    const p = PushPayload.parse(payload);
    const branch = p.ref.replace("refs/heads/", "");
    if (p.repository.default_branch && branch !== p.repository.default_branch) return null;
    const count = p.commits.length;
    return {
      source: "github",
      kind: "change",
      title: `${count} commit${count === 1 ? "" : "s"} pushed to ${branch}`,
      detail: {
        repo: p.repository.full_name,
        sha: p.after,
        url: p.compare,
        messages: p.commits.slice(0, 5).map((c) => c.message.split("\n")[0]),
      },
      externalId: `push:${p.after}`,
      occurredAt: new Date(p.head_commit?.timestamp ?? Date.now()).toISOString(),
      author: p.pusher?.name,
    };
  }

  return null;
}

const SentryEventAlert = z.object({
  data: z.object({
    event: z.object({
      event_id: z.string(),
      title: z.string(),
      datetime: z.string().optional(),
      timestamp: z.number().optional(),
      level: z.string().optional(),
      web_url: z.string().optional(),
      culprit: z.string().nullish(),
    }),
    triggered_rule: z.string().optional(),
  }),
});

const SentryIssue = z.object({
  action: z.string(),
  data: z.object({
    issue: z.object({
      id: z.string(),
      title: z.string(),
      level: z.string().optional(),
      culprit: z.string().nullish(),
      lastSeen: z.string().optional(),
      permalink: z.string().nullish(),
    }),
  }),
});

const SentryMetricAlert = z.object({
  action: z.enum(["critical", "warning", "resolved"]),
  data: z.object({
    description_title: z.string(),
    metric_alert: z.object({ id: z.string(), date_detected: z.string().optional() }),
    web_url: z.string().optional(),
  }),
});

function severityForLevel(level: string | undefined): Severity {
  if (level === "fatal") return "SEV1";
  if (level === "error") return "SEV2";
  return "SEV3";
}

/** Converts a Sentry integration webhook (by its Sentry-Hook-Resource header) into a timeline event. */
export function normalizeSentry(resource: string, payload: unknown, now = new Date()): NormalizedEvent | null {
  if (resource === "event_alert") {
    const { event, triggered_rule } = SentryEventAlert.parse(payload).data;
    const occurred = event.datetime ?? (event.timestamp ? new Date(event.timestamp * 1000).toISOString() : now.toISOString());
    return {
      source: "sentry",
      kind: "error",
      title: event.title,
      detail: { level: event.level, culprit: event.culprit, rule: triggered_rule, url: event.web_url },
      externalId: `event:${event.event_id}`,
      occurredAt: new Date(occurred).toISOString(),
      suggestedSeverity: severityForLevel(event.level),
    };
  }

  if (resource === "issue") {
    const p = SentryIssue.parse(payload);
    if (p.action !== "created" && p.action !== "resolved") return null;
    const { issue } = p.data;
    return {
      source: "sentry",
      kind: p.action === "created" ? "error" : "recovery",
      title: p.action === "created" ? `New issue: ${issue.title}` : `Issue resolved: ${issue.title}`,
      detail: { level: issue.level, culprit: issue.culprit, url: issue.permalink },
      externalId: `issue:${issue.id}:${p.action}`,
      occurredAt: new Date(issue.lastSeen ?? now).toISOString(),
      suggestedSeverity: severityForLevel(issue.level),
    };
  }

  if (resource === "metric_alert") {
    const p = SentryMetricAlert.parse(payload);
    const detected = p.data.metric_alert.date_detected ?? now.toISOString();
    return {
      source: "sentry",
      kind: p.action === "resolved" ? "recovery" : "alert",
      title: p.action === "resolved" ? `Recovered: ${p.data.description_title}` : p.data.description_title,
      detail: { action: p.action, url: p.data.web_url },
      externalId: `metric_alert:${p.data.metric_alert.id}:${p.action}:${detected}`,
      occurredAt: new Date(p.action === "resolved" ? now : detected).toISOString(),
      suggestedSeverity: p.action === "critical" ? "SEV1" : "SEV2",
    };
  }

  return null;
}

export const GenericEventSchema = z.object({
  id: z.string().optional(),
  source: z.enum(["uptime", "system"]).default("uptime"),
  kind: z.enum(["alert", "error", "deploy", "change", "recovery"]),
  title: z.string().min(1).max(300),
  occurredAt: z.string().datetime({ offset: true }).optional(),
  severity: z.enum(["SEV1", "SEV2", "SEV3"]).optional(),
  detail: z.record(z.unknown()).default({}),
});

/** For uptime monitors, cron jobs and scripts that post our own simple format. */
export function normalizeGeneric(payload: unknown, now = new Date()): NormalizedEvent {
  const p = GenericEventSchema.parse(payload);
  return {
    source: p.source,
    kind: p.kind,
    title: p.title,
    detail: p.detail,
    externalId: p.id,
    occurredAt: new Date(p.occurredAt ?? now).toISOString(),
    suggestedSeverity: p.severity,
  };
}

import { describe, expect, it } from "vitest";
import { normalizeGeneric, normalizeGithub, normalizeSentry } from "../src/webhooks/normalize.js";
import { signGithub, signSentry, verifyGithubSignature, verifySentrySignature } from "../src/webhooks/verify.js";

describe("webhook signatures", () => {
  const body = JSON.stringify({ hello: "world" });

  it("accepts a valid GitHub signature and rejects tampering", () => {
    const sig = signGithub(body, "s3cret");
    expect(verifyGithubSignature(Buffer.from(body), sig, "s3cret")).toBe(true);
    expect(verifyGithubSignature(Buffer.from(body + " "), sig, "s3cret")).toBe(false);
    expect(verifyGithubSignature(Buffer.from(body), sig, "other")).toBe(false);
    expect(verifyGithubSignature(Buffer.from(body), undefined, "s3cret")).toBe(false);
    expect(verifyGithubSignature(Buffer.from(body), "sha1=abc", "s3cret")).toBe(false);
  });

  it("accepts a valid Sentry signature", () => {
    const sig = signSentry(body, "client-secret");
    expect(verifySentrySignature(Buffer.from(body), sig, "client-secret")).toBe(true);
    expect(verifySentrySignature(Buffer.from(body), sig.slice(0, -1), "client-secret")).toBe(false);
  });
});

const deployment = (state: string, id = 1) => ({
  deployment_status: { id, state, environment: "production", created_at: "2026-10-15T02:10:00Z" },
  deployment: { sha: "a1b2c3d4e5f6", environment: "production" },
  repository: { full_name: "acme/api" },
  sender: { login: "dana" },
});

describe("normalizeGithub", () => {
  it("turns a successful deployment into a deploy event", () => {
    const event = normalizeGithub("deployment_status", deployment("success"));
    expect(event).toMatchObject({
      source: "github",
      kind: "deploy",
      title: "Deployed a1b2c3d to production",
      externalId: "deployment_status:1",
      occurredAt: "2026-10-15T02:10:00.000Z",
      author: "dana",
    });
  });

  it("turns a failed deployment into an alert", () => {
    expect(normalizeGithub("deployment_status", deployment("failure"))?.kind).toBe("alert");
  });

  it("ignores in-progress deployments and unknown events", () => {
    expect(normalizeGithub("deployment_status", deployment("in_progress"))).toBeNull();
    expect(normalizeGithub("star", {})).toBeNull();
  });

  it("only tracks pushes to the default branch", () => {
    const push = (ref: string) => ({
      ref,
      after: "f00dfeed",
      commits: [{ id: "1", message: "Fix cache key\n\nlong body" }],
      head_commit: { timestamp: "2026-10-15T02:00:00Z" },
      repository: { full_name: "acme/api", default_branch: "main" },
    });
    expect(normalizeGithub("push", push("refs/heads/feature"))).toBeNull();
    const event = normalizeGithub("push", push("refs/heads/main"));
    expect(event?.title).toBe("1 commit pushed to main");
    expect(event?.detail.messages).toEqual(["Fix cache key"]);
  });

  it("only alerts on failed workflow runs", () => {
    const run = (conclusion: string) => ({
      action: "completed",
      workflow_run: {
        id: 9, name: "CI", conclusion, head_branch: "main", head_sha: "abc",
        html_url: "https://github.com/acme/api/actions/runs/9", updated_at: "2026-10-15T02:00:00Z",
      },
      repository: { full_name: "acme/api" },
    });
    expect(normalizeGithub("workflow_run", run("success"))).toBeNull();
    expect(normalizeGithub("workflow_run", run("failure"))?.title).toBe("CI failed: CI on main");
  });

  it("throws on payloads missing required fields", () => {
    expect(() => normalizeGithub("deployment_status", { deployment_status: {} })).toThrow();
  });
});

describe("normalizeSentry", () => {
  it("maps event alerts and derives severity from level", () => {
    const event = normalizeSentry("event_alert", {
      data: {
        event: { event_id: "e1", title: "TypeError: x is undefined", level: "fatal", datetime: "2026-10-15T02:12:00Z" },
        triggered_rule: "High error rate",
      },
    });
    expect(event).toMatchObject({ kind: "error", suggestedSeverity: "SEV1", externalId: "event:e1" });
  });

  it("maps resolved metric alerts to recovery", () => {
    const now = new Date("2026-10-15T03:00:00Z");
    const event = normalizeSentry(
      "metric_alert",
      { action: "resolved", data: { description_title: "p95 latency > 2s", metric_alert: { id: "77" } } },
      now,
    );
    expect(event).toMatchObject({ kind: "recovery", occurredAt: now.toISOString() });
  });

  it("ignores issue actions we don't track", () => {
    expect(normalizeSentry("issue", { action: "assigned", data: { issue: { id: "1", title: "x" } } })).toBeNull();
  });
});

describe("normalizeGeneric", () => {
  it("validates our own simple format", () => {
    expect(normalizeGeneric({ kind: "alert", title: "Checkout is down", id: "u-1" })).toMatchObject({
      source: "uptime",
      kind: "alert",
      externalId: "u-1",
    });
    expect(() => normalizeGeneric({ kind: "explode", title: "x" })).toThrow();
  });
});

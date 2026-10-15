/**
 * Plays a realistic outage against a running IncidentRoom so you can watch the
 * room fill up live: a push, a bad deploy, an error spike (which auto-opens an
 * incident), responders' findings, a rollback and recovery.
 *
 *   npm run simulate                      # against http://localhost:4000
 *   BASE_URL=https://your-app.onrender.com GITHUB_WEBHOOK_SECRET=... npm run simulate
 */
import crypto from "node:crypto";
import { signGithub, signSentry } from "../src/webhooks/verify.js";

const BASE = (process.env.BASE_URL ?? "http://localhost:4000").replace(/\/$/, "");
const GITHUB_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "dev-github-secret";
const SENTRY_SECRET = process.env.SENTRY_WEBHOOK_SECRET ?? "dev-sentry-secret";
const STEP_MS = Number(process.env.STEP_MS ?? 1200);

const run = crypto.randomBytes(3).toString("hex");
const sha = () => crypto.randomBytes(20).toString("hex");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Events are back-dated so the error chart spans ~20 minutes even though the script takes ~30 seconds.
const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

async function post(path: string, body: object, headers: Record<string, string>) {
  const raw = JSON.stringify(body);
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: raw,
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`${path} → ${res.status} ${JSON.stringify(json)}`);
  return json;
}

const github = (event: string, payload: object) =>
  post("/api/webhooks/github", payload, {
    "x-github-event": event,
    "x-hub-signature-256": signGithub(JSON.stringify(payload), GITHUB_SECRET),
  });

const sentry = (resource: string, payload: object) =>
  post("/api/webhooks/sentry", payload, {
    "sentry-hook-resource": resource,
    "sentry-hook-signature": signSentry(JSON.stringify(payload), SENTRY_SECRET),
  });

async function patch(incidentId: string, body: object, user: string) {
  await fetch(`${BASE}/api/incidents/${incidentId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-user-name": user },
    body: JSON.stringify(body),
  });
}

const note = (incidentId: string, title: string, user: string) =>
  post(`/api/incidents/${incidentId}/events`, { title }, { "x-user-name": user });

const repo = { full_name: "acme/checkout-api", default_branch: "main" };

async function main() {
  console.log(`▶ Simulating an outage against ${BASE}`);
  const badSha = sha();

  await github("push", {
    ref: "refs/heads/main",
    after: badSha,
    commits: [
      { id: "1", message: "Cache cart totals in Redis" },
      { id: "2", message: "Bump stripe-node to v17" },
    ],
    head_commit: { timestamp: minutesAgo(22) },
    pusher: { name: "jordan" },
    repository: repo,
  });
  console.log("  pushed 2 commits to main");
  await sleep(STEP_MS);

  await github("deployment_status", {
    deployment_status: { id: Date.now(), state: "success", environment: "production", created_at: minutesAgo(20) },
    deployment: { sha: badSha },
    repository: repo,
    sender: { login: "deploy-bot" },
  });
  console.log("  deployed to production");
  await sleep(STEP_MS);

  // Error spike: the first fatal error opens the incident automatically.
  let incidentId = "";
  const errorMinutes = [18, 17.5, 17, 16, 16, 15.5, 15, 14, 14, 13, 12, 12, 11, 10, 9, 9, 8];
  for (const [i, m] of errorMinutes.entries()) {
    const res = await sentry("event_alert", {
      data: {
        event: {
          event_id: `${run}-${i}`,
          title: "TypeError: Cannot read properties of undefined (reading 'total')",
          level: i === 0 ? "fatal" : "error",
          datetime: minutesAgo(m),
          culprit: "checkout/cart.ts in computeTotals",
        },
        triggered_rule: "Checkout error rate > 2%",
      },
    });
    if (!incidentId && typeof res.incidentId === "string") {
      incidentId = res.incidentId;
      console.log(`  🚨 incident opened → ${BASE}/incidents/${incidentId}`);
    }
    if (i % 4 === 0) await sleep(STEP_MS);
  }

  await note(incidentId, "Errors started ~2 min after the last deploy; cart totals now read from the new Redis cache", "priya");
  await patch(incidentId, { status: "identified" }, "priya");
  console.log("  responders identified the cause");
  await sleep(STEP_MS * 2);

  await github("deployment_status", {
    deployment_status: { id: Date.now() + 1, state: "success", environment: "production", created_at: minutesAgo(7) },
    deployment: { sha: sha() },
    repository: repo,
    sender: { login: "priya" },
  });
  await note(incidentId, "Rolled back to previous release", "priya");
  console.log("  rolled back");
  await sleep(STEP_MS);

  await sentry("metric_alert", {
    action: "resolved",
    data: { description_title: "Checkout error rate > 2%", metric_alert: { id: run } },
  });
  await patch(incidentId, { status: "monitoring" }, "sam");
  console.log("  error rate recovered, now monitoring");
  console.log(`✔ Done. Open ${BASE}/incidents/${incidentId}, resolve it and generate the postmortem.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

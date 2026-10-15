import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { createPool, migrate, type Db } from "../src/db.js";
import { IncidentService } from "../src/incidents.js";
import { signGithub, signSentry } from "../src/webhooks/verify.js";

// Integration tests need a real Postgres. CI provides one; locally:
//   TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/incidentroom_test npm test
const url = process.env.TEST_DATABASE_URL;

const secrets = {
  GITHUB_WEBHOOK_SECRET: "gh-test",
  SENTRY_WEBHOOK_SECRET: "sentry-test",
  INGEST_TOKEN: "ingest-test",
  WEB_DIST: undefined,
};

describe.skipIf(!url)("API (Postgres)", () => {
  let db: Db;
  let app: ReturnType<typeof createApp>;
  const publish = vi.fn(async () => {});

  beforeAll(async () => {
    db = createPool(url!);
    await migrate(db);
    const service = new IncidentService(db, { publish });
    app = createApp({ service, readNotes: async () => "Rolled back the deploy", anthropic: null, config: secrets });
  });

  beforeEach(async () => {
    await db.query("TRUNCATE events, incidents, ydocs CASCADE");
    publish.mockClear();
  });

  afterAll(async () => {
    await db?.end();
  });

  const github = (event: string, payload: object, query = "") => {
    const body = JSON.stringify(payload);
    return request(app)
      .post(`/api/webhooks/github${query}`)
      .set("content-type", "application/json")
      .set("x-github-event", event)
      .set("x-hub-signature-256", signGithub(body, secrets.GITHUB_WEBHOOK_SECRET))
      .send(body);
  };

  const sentryAlert = (id: string, level = "error") => {
    const body = JSON.stringify({
      data: { event: { event_id: id, title: "TypeError in checkout", level, datetime: new Date().toISOString() } },
    });
    return request(app)
      .post("/api/webhooks/sentry")
      .set("content-type", "application/json")
      .set("sentry-hook-resource", "event_alert")
      .set("sentry-hook-signature", signSentry(body, secrets.SENTRY_WEBHOOK_SECRET))
      .send(body);
  };

  const deploy = (id: number) => ({
    deployment_status: { id, state: "success", environment: "production", created_at: new Date().toISOString() },
    deployment: { sha: "a1b2c3d4" },
    repository: { full_name: "acme/api" },
  });

  it("creates an incident and validates input", async () => {
    await request(app).post("/api/incidents").send({ title: "x", severity: "SEV9" }).expect(400);
    const res = await request(app)
      .post("/api/incidents")
      .set("x-user-name", "Dana")
      .send({ title: "Checkout down", severity: "SEV1" })
      .expect(201);
    const { body } = await request(app).get(`/api/incidents/${res.body.incident.id}`).expect(200);
    expect(body.events[0].title).toBe("Incident opened as SEV1 by Dana");
  });

  it("rejects webhooks with a bad signature", async () => {
    await request(app)
      .post("/api/webhooks/github")
      .set("x-github-event", "deployment_status")
      .set("x-hub-signature-256", "sha256=nope")
      .send("{}")
      .expect(401);
  });

  it("stores a redelivered webhook only once", async () => {
    const { body: created } = await request(app).post("/api/incidents").send({ title: "Slow API", severity: "SEV2" });
    const id = created.incident.id;
    await github("deployment_status", deploy(42), `?incident=${id}`).expect(201);
    const retry = await github("deployment_status", deploy(42), `?incident=${id}`).expect(200);
    expect(retry.body.status).toBe("duplicate");
    const { body } = await request(app).get(`/api/incidents/${id}`);
    expect(body.events.filter((e: { kind: string }) => e.kind === "deploy")).toHaveLength(1);
  });

  it("auto-opens an incident on an alert and pulls in the recent deploy", async () => {
    const stored = await github("deployment_status", deploy(7)).expect(201);
    expect(stored.body.status).toBe("stored_unattached");

    const alert = await sentryAlert("evt-1", "fatal").expect(201);
    expect(alert.body.status).toBe("opened_incident");

    const { body } = await request(app).get(`/api/incidents/${alert.body.incidentId}`);
    expect(body.incident.severity).toBe("SEV1");
    expect(body.events.map((e: { kind: string }) => e.kind)).toEqual(
      expect.arrayContaining(["deploy", "status_change", "error"]),
    );

    // Same Sentry event again must not open a second incident.
    expect((await sentryAlert("evt-1")).body.status).toBe("duplicate");
    const { body: list } = await request(app).get("/api/incidents");
    expect(list.incidents).toHaveLength(1);
  });

  it("resolves an incident, charts it and drafts a postmortem", async () => {
    const { body: created } = await request(app).post("/api/incidents").send({ title: "Checkout down", severity: "SEV1" });
    const id = created.incident.id;
    await sentryAlert("evt-9");

    const { body: resolved } = await request(app)
      .patch(`/api/incidents/${id}`)
      .set("x-user-name", "Sam")
      .send({ status: "resolved" })
      .expect(200);
    expect(resolved.incident.resolved_at).not.toBeNull();

    const { body: metrics } = await request(app).get(`/api/incidents/${id}/metrics`).expect(200);
    expect(metrics.buckets.reduce((sum: number, b: { errors: number }) => sum + b.errors, 0)).toBe(1);

    const { body: pm } = await request(app).post(`/api/incidents/${id}/postmortem`).expect(200);
    expect(pm.postmortem.generatedBy).toBe("template");
    expect(pm.incident.postmortem.summary).toContain("Checkout down");
    expect(publish).toHaveBeenCalled();
  });

  it("returns 404 for unknown or malformed ids", async () => {
    await request(app).get("/api/incidents/not-a-uuid").expect(404);
    await request(app).get("/api/incidents/00000000-0000-0000-0000-000000000000").expect(404);
  });
});

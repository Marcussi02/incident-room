import express, { Router, type Request, type Response } from "express";
import { ZodError } from "zod";
import type { Config } from "../config.js";
import type { IncidentService } from "../incidents.js";
import type { NormalizedEvent } from "../types.js";
import { normalizeGeneric, normalizeGithub, normalizeSentry } from "../webhooks/normalize.js";
import { safeEqual, verifyGithubSignature, verifySentrySignature } from "../webhooks/verify.js";

type Secrets = Pick<Config, "GITHUB_WEBHOOK_SECRET" | "SENTRY_WEBHOOK_SECRET" | "INGEST_TOKEN">;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Express 5 leaves req.body undefined when the request has no body.
const rawBody = (req: Request): Buffer => (Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));

function bearerMatches(header: string | undefined, token: string): boolean {
  return safeEqual(header ?? "", `Bearer ${token}`);
}

export function webhookRoutes(service: IncidentService, secrets: Secrets): Router {
  const router = Router();
  // Signatures are computed over the exact bytes received, so keep the raw body.
  router.use(express.raw({ type: "*/*", limit: "1mb" }));

  async function handle(req: Request, res: Response, toEvent: (payload: unknown) => NormalizedEvent | null) {
    let payload: unknown;
    try {
      payload = JSON.parse(rawBody(req).toString("utf8"));
    } catch {
      return void res.status(400).json({ error: "Body must be JSON" });
    }

    let event: NormalizedEvent | null;
    try {
      event = toEvent(payload);
    } catch (err) {
      if (err instanceof ZodError) return void res.status(400).json({ error: "Unrecognised payload", issues: err.issues });
      throw err;
    }
    if (!event) return void res.status(202).json({ status: "ignored" });

    const target = typeof req.query.incident === "string" && UUID.test(req.query.incident) ? req.query.incident : undefined;
    const result = await service.ingest(event, target);
    if (result.status === "duplicate") return void res.status(200).json({ status: "duplicate" });
    res.status(201).json({
      status: result.openedIncident ? "opened_incident" : result.incident ? "attached" : "stored_unattached",
      incidentId: result.incident?.id ?? null,
      eventId: result.event.id,
    });
  }

  router.post("/github", async (req, res) => {
    if (!verifyGithubSignature(rawBody(req), req.header("x-hub-signature-256"), secrets.GITHUB_WEBHOOK_SECRET)) {
      return void res.status(401).json({ error: "Invalid signature" });
    }
    const eventName = req.header("x-github-event") ?? "";
    if (eventName === "ping") return void res.status(200).json({ status: "pong" });
    await handle(req, res, (payload) => normalizeGithub(eventName, payload));
  });

  router.post("/sentry", async (req, res) => {
    if (!verifySentrySignature(rawBody(req), req.header("sentry-hook-signature"), secrets.SENTRY_WEBHOOK_SECRET)) {
      return void res.status(401).json({ error: "Invalid signature" });
    }
    const resource = req.header("sentry-hook-resource") ?? "";
    await handle(req, res, (payload) => normalizeSentry(resource, payload));
  });

  router.post("/ingest", async (req, res) => {
    if (!bearerMatches(req.header("authorization"), secrets.INGEST_TOKEN)) {
      return void res.status(401).json({ error: "Invalid token" });
    }
    await handle(req, res, (payload) => normalizeGeneric(payload));
  });

  return router;
}

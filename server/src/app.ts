import fs from "node:fs";
import path from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import express, { type NextFunction, type Request, type Response } from "express";
import { ZodError } from "zod";
import type { Config } from "./config.js";
import type { IncidentService } from "./incidents.js";
import { incidentRoutes } from "./routes/incidents.js";
import { webhookRoutes } from "./routes/webhooks.js";

export interface AppDeps {
  service: IncidentService;
  readNotes: (incidentId: string) => Promise<string>;
  aiClient: Anthropic | null;
  config: Pick<Config, "GITHUB_WEBHOOK_SECRET" | "SENTRY_WEBHOOK_SECRET" | "INGEST_TOKEN" | "WEB_DIST">;
}

export function createApp({ service, readNotes, aiClient, config }: AppDeps) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.get("/healthz", (_req, res) => void res.json({ ok: true }));
  app.get("/api/config", (_req, res) => void res.json({ aiEnabled: Boolean(aiClient) }));

  // Webhooks parse their own raw body, so mount them before express.json().
  app.use("/api/webhooks", webhookRoutes(service, config));
  app.use("/api/incidents", express.json({ limit: "100kb" }), incidentRoutes({ service, readNotes, aiClient }));
  app.use("/api", (_req, res) => void res.status(404).json({ error: "Not found" }));

  // In production the server also serves the built React app.
  if (config.WEB_DIST && fs.existsSync(config.WEB_DIST)) {
    const dist = path.resolve(config.WEB_DIST);
    app.use(express.static(dist, { maxAge: "1h", index: false }));
    // SPA fallback: client-side routes like /incidents/:id load index.html.
    app.get("/{*path}", (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      return void res.status(400).json({ error: "Invalid request", issues: err.issues });
    }
    console.error(err);
    res.status(500).json({ error: "Something went wrong" });
  });

  return app;
}

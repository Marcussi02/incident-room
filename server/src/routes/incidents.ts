import type Anthropic from "@anthropic-ai/sdk";
import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import {
  generateWithClaude,
  PostmortemRefusedError,
  templatePostmortem,
  type Postmortem,
} from "../ai/postmortem.js";
import type { IncidentService } from "../incidents.js";
import { buildMetrics } from "../metrics.js";
import { SEVERITIES, STATUSES } from "../types.js";

const CreateIncident = z.object({
  title: z.string().trim().min(3).max(120),
  severity: z.enum(SEVERITIES),
});

const UpdateIncident = z
  .object({
    title: z.string().trim().min(3).max(120).optional(),
    severity: z.enum(SEVERITIES).optional(),
    status: z.enum(STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, "Nothing to update");

const CreateNote = z.object({ title: z.string().trim().min(1).max(300) });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Display name the browser sends; there are no accounts in this MVP. */
export function actorFrom(req: Request): string {
  const raw = req.header("x-user-name") ?? "";
  const clean = raw.replace(/[^\p{L}\p{N} ._-]/gu, "").trim().slice(0, 40);
  return clean || "someone";
}

export interface IncidentRouteDeps {
  service: IncidentService;
  readNotes: (incidentId: string) => Promise<string>;
  anthropic: Anthropic | null;
}

export function incidentRoutes({ service, readNotes, anthropic }: IncidentRouteDeps): Router {
  const router = Router();
  const generating = new Set<string>();

  router.param("id", (req: Request, res: Response, next: NextFunction, id: string) => {
    if (!UUID.test(id)) return void res.status(404).json({ error: "Incident not found" });
    next();
  });

  router.get("/", async (_req, res) => {
    res.json({ incidents: await service.list() });
  });

  router.post("/", async (req, res) => {
    const body = CreateIncident.parse(req.body);
    const incident = await service.create(body, actorFrom(req));
    res.status(201).json({ incident });
  });

  router.get("/:id", async (req, res) => {
    const incident = await service.get(req.params.id);
    if (!incident) return void res.status(404).json({ error: "Incident not found" });
    res.json({ incident, events: await service.events(incident.id) });
  });

  router.patch("/:id", async (req, res) => {
    const incident = await service.update(req.params.id, UpdateIncident.parse(req.body), actorFrom(req));
    if (!incident) return void res.status(404).json({ error: "Incident not found" });
    res.json({ incident });
  });

  // Responders pin key findings ("rolled back to v1.4.2") onto the timeline.
  router.post("/:id/events", async (req, res) => {
    const incident = await service.get(req.params.id);
    if (!incident) return void res.status(404).json({ error: "Incident not found" });
    const { title } = CreateNote.parse(req.body);
    const actor = actorFrom(req);
    const event = await service.addEvent(incident.id, {
      source: "manual",
      kind: "note",
      title,
      detail: {},
      author: actor,
      occurredAt: new Date().toISOString(),
    });
    res.status(201).json({ event });
  });

  router.get("/:id/metrics", async (req, res) => {
    const incident = await service.get(req.params.id);
    if (!incident) return void res.status(404).json({ error: "Incident not found" });
    res.json(buildMetrics(await service.events(incident.id)));
  });

  router.post("/:id/postmortem", async (req, res) => {
    const incident = await service.get(req.params.id);
    if (!incident) return void res.status(404).json({ error: "Incident not found" });
    if (generating.has(incident.id)) {
      return void res.status(409).json({ error: "A postmortem is already being generated" });
    }

    generating.add(incident.id);
    try {
      const [events, notes] = await Promise.all([service.events(incident.id), readNotes(incident.id)]);
      const draft = anthropic
        ? await generateWithClaude(anthropic, incident, events, notes)
        : templatePostmortem(incident, events, notes);
      const postmortem: Postmortem = {
        ...draft,
        generatedBy: anthropic ? "claude" : "template",
        generatedAt: new Date().toISOString(),
      };
      const updated = await service.savePostmortem(incident.id, postmortem);
      res.json({ incident: updated, postmortem });
    } catch (err) {
      if (err instanceof PostmortemRefusedError) return void res.status(422).json({ error: err.message });
      throw err;
    } finally {
      generating.delete(incident.id);
    }
  });

  return router;
}

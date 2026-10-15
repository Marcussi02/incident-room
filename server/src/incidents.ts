import type { Db } from "./db.js";
import type { LiveHub } from "./realtime/hub.js";
import type { Incident, NormalizedEvent, Severity, Status, TimelineEvent } from "./types.js";

/** How far back "what changed recently" looks when a new incident opens. */
const RECENT_CHANGES_WINDOW = "60 minutes";

export type IngestResult =
  | { status: "created"; event: TimelineEvent; incident: Incident | null; openedIncident: boolean }
  | { status: "duplicate" };

export interface IncidentSummary extends Incident {
  event_count: number;
  last_event_at: string | null;
}

export class IncidentService {
  constructor(
    private readonly db: Db,
    private readonly hub: Pick<LiveHub, "publish">,
  ) {}

  async list(): Promise<IncidentSummary[]> {
    const { rows } = await this.db.query<IncidentSummary>(
      `SELECT i.*, count(e.id)::int AS event_count, max(e.occurred_at) AS last_event_at
         FROM incidents i LEFT JOIN events e ON e.incident_id = i.id
        GROUP BY i.id
        ORDER BY (i.status = 'resolved'), i.created_at DESC
        LIMIT 200`,
    );
    return rows;
  }

  async get(id: string): Promise<Incident | null> {
    const { rows } = await this.db.query<Incident>("SELECT * FROM incidents WHERE id = $1", [id]);
    return rows[0] ?? null;
  }

  async events(incidentId: string): Promise<TimelineEvent[]> {
    const { rows } = await this.db.query<TimelineEvent>(
      "SELECT * FROM events WHERE incident_id = $1 ORDER BY occurred_at, received_at",
      [incidentId],
    );
    return rows;
  }

  async create(input: { title: string; severity: Severity }, actor: string): Promise<Incident> {
    const client = await this.db.connect();
    let incident: Incident;
    let attached: TimelineEvent[];
    try {
      await client.query("BEGIN");
      ({ rows: [incident] } = await client.query<Incident>(
        "INSERT INTO incidents (title, severity) VALUES ($1, $2) RETURNING *",
        [input.title, input.severity],
      ));
      // Pull in recent deploys/alerts that arrived while no incident was open:
      // "what changed?" is the first question in every incident.
      ({ rows: attached } = await client.query<TimelineEvent>(
        `UPDATE events SET incident_id = $1
          WHERE incident_id IS NULL AND occurred_at > now() - interval '${RECENT_CHANGES_WINDOW}'
          RETURNING *`,
        [incident.id],
      ));
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    await this.addEvent(incident.id, {
      source: "system",
      kind: "status_change",
      title: `Incident opened as ${incident.severity} by ${actor}`,
      detail: { attachedRecentEvents: attached.length },
      occurredAt: incident.created_at,
      author: actor,
    });
    await this.hub.publish({ type: "incident", incident });
    return incident;
  }

  async update(
    id: string,
    changes: { status?: Status; severity?: Severity; title?: string },
    actor: string,
  ): Promise<Incident | null> {
    const before = await this.get(id);
    if (!before) return null;

    const { rows } = await this.db.query<Incident>(
      `UPDATE incidents SET
         status = COALESCE($2, status),
         severity = COALESCE($3, severity),
         title = COALESCE($4, title),
         resolved_at = CASE
           WHEN COALESCE($2, status) = 'resolved' AND resolved_at IS NULL THEN now()
           WHEN COALESCE($2, status) <> 'resolved' THEN NULL
           ELSE resolved_at END
       WHERE id = $1 RETURNING *`,
      [id, changes.status ?? null, changes.severity ?? null, changes.title ?? null],
    );
    const incident = rows[0];

    const notes: string[] = [];
    if (changes.status && changes.status !== before.status) notes.push(`status → ${changes.status}`);
    if (changes.severity && changes.severity !== before.severity) notes.push(`severity → ${changes.severity}`);
    if (notes.length) {
      await this.addEvent(id, {
        source: "system",
        kind: incident.status === "resolved" && changes.status ? "recovery" : "status_change",
        title: `${actor} changed ${notes.join(", ")}`,
        detail: { from: { status: before.status, severity: before.severity } },
        occurredAt: new Date().toISOString(),
        author: actor,
      });
    }
    await this.hub.publish({ type: "incident", incident });
    return incident;
  }

  async savePostmortem(id: string, postmortem: unknown): Promise<Incident | null> {
    const { rows } = await this.db.query<Incident>(
      "UPDATE incidents SET postmortem = $2 WHERE id = $1 RETURNING *",
      [id, JSON.stringify(postmortem)],
    );
    if (rows[0]) await this.hub.publish({ type: "incident", incident: rows[0] });
    return rows[0] ?? null;
  }

  /** Inserts an event (skipping duplicates by provider id) and pushes it to everyone in the room. */
  async addEvent(incidentId: string | null, event: NormalizedEvent): Promise<TimelineEvent | null> {
    const { rows } = await this.db.query<TimelineEvent>(
      `INSERT INTO events (incident_id, source, kind, title, detail, author, external_id, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL DO NOTHING
       RETURNING *`,
      [
        incidentId,
        event.source,
        event.kind,
        event.title,
        JSON.stringify(event.detail),
        event.author ?? null,
        event.externalId ?? null,
        event.occurredAt,
      ],
    );
    const inserted = rows[0] ?? null;
    if (inserted && incidentId) {
      await this.hub.publish({ type: "event", incidentId, event: inserted });
    }
    return inserted;
  }

  /**
   * Routes an incoming webhook event to an incident:
   *  1. the incident named explicitly (e.g. ?incident=<id>), else
   *  2. the most recent open incident, else
   *  3. alerts/errors open a new incident automatically; deploys and pushes are
   *     kept unattached so the next incident can pull them in as context.
   */
  async ingest(event: NormalizedEvent, explicitIncidentId?: string): Promise<IngestResult> {
    let incident: Incident | null = null;
    if (explicitIncidentId) {
      incident = await this.get(explicitIncidentId);
    } else {
      const { rows } = await this.db.query<Incident>(
        "SELECT * FROM incidents WHERE status <> 'resolved' ORDER BY created_at DESC LIMIT 1",
      );
      incident = rows[0] ?? null;
    }

    let openedIncident = false;
    if (!incident && (event.kind === "alert" || event.kind === "error")) {
      // Check for a duplicate delivery first so a retried webhook doesn't open a second incident.
      if (event.externalId && (await this.isDuplicate(event))) return { status: "duplicate" };
      incident = await this.create(
        { title: event.title.slice(0, 120), severity: event.suggestedSeverity ?? "SEV2" },
        `${event.source} (automatic)`,
      );
      openedIncident = true;
    }

    const inserted = await this.addEvent(incident?.id ?? null, event);
    if (!inserted) return { status: "duplicate" };
    return { status: "created", event: inserted, incident, openedIncident };
  }

  private async isDuplicate(event: NormalizedEvent): Promise<boolean> {
    const { rowCount } = await this.db.query(
      "SELECT 1 FROM events WHERE source = $1 AND external_id = $2",
      [event.source, event.externalId],
    );
    return (rowCount ?? 0) > 0;
  }
}

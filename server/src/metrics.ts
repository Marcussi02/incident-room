import type { EventKind, TimelineEvent } from "./types.js";

export interface MetricBucket {
  t: string; // bucket start, ISO 8601
  errors: number;
  alerts: number;
}

export interface Marker {
  t: string;
  kind: Extract<EventKind, "deploy" | "change" | "recovery">;
  title: string;
}

export interface IncidentMetrics {
  bucketMs: number;
  buckets: MetricBucket[];
  markers: Marker[];
  /** First error/alert to recovery (or now), in ms. */
  durationMs: number | null;
}

/** Picks a bucket size so a chart has roughly 20–60 bars whatever the incident length. */
export function chooseBucketMs(spanMs: number): number {
  const options = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
  return options.find((size) => spanMs / size <= 60) ?? options[options.length - 1];
}

/**
 * Turns a timeline into an error-rate series plus deploy/recovery markers, so
 * the UI can show "errors spiked 2 minutes after this deploy".
 */
export function buildMetrics(events: TimelineEvent[], now = new Date()): IncidentMetrics {
  if (events.length === 0) return { bucketMs: 60_000, buckets: [], markers: [], durationMs: null };

  const times = events.map((e) => Date.parse(e.occurred_at));
  const start = Math.min(...times);
  const end = Math.max(Math.max(...times), Math.min(now.getTime(), Math.max(...times) + 10 * 60_000));
  const bucketMs = chooseBucketMs(end - start);
  const first = Math.floor(start / bucketMs) * bucketMs;
  const count = Math.floor((end - first) / bucketMs) + 1;

  const buckets: MetricBucket[] = Array.from({ length: count }, (_, i) => ({
    t: new Date(first + i * bucketMs).toISOString(),
    errors: 0,
    alerts: 0,
  }));

  const markers: Marker[] = [];
  let firstProblem: number | null = null;
  let lastRecovery: number | null = null;

  for (const event of events) {
    const at = Date.parse(event.occurred_at);
    const bucket = buckets[Math.floor((at - first) / bucketMs)];
    if (event.kind === "error") bucket.errors += 1;
    if (event.kind === "alert") bucket.alerts += 1;
    if (event.kind === "error" || event.kind === "alert") firstProblem = Math.min(firstProblem ?? at, at);
    if (event.kind === "recovery") lastRecovery = Math.max(lastRecovery ?? at, at);
    if (event.kind === "deploy" || event.kind === "change" || event.kind === "recovery") {
      markers.push({ t: event.occurred_at, kind: event.kind, title: event.title });
    }
  }

  const durationMs = firstProblem === null ? null : (lastRecovery ?? now.getTime()) - firstProblem;
  return { bucketMs, buckets, markers, durationMs: durationMs !== null && durationMs >= 0 ? durationMs : null };
}

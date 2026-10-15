import { describe, expect, it } from "vitest";
import { buildMetrics, chooseBucketMs } from "../src/metrics.js";
import type { EventKind, TimelineEvent } from "../src/types.js";

let n = 0;
const ev = (kind: EventKind, at: string, title: string = kind): TimelineEvent => ({
  id: String(++n),
  incident_id: "i",
  source: "system",
  kind,
  title,
  detail: {},
  author: null,
  external_id: null,
  occurred_at: at,
  received_at: at,
});

describe("chooseBucketMs", () => {
  it("keeps the chart to at most ~60 bars", () => {
    expect(chooseBucketMs(30 * 60_000)).toBe(60_000);
    expect(chooseBucketMs(3 * 60 * 60_000)).toBe(5 * 60_000);
    expect(chooseBucketMs(2 * 24 * 60 * 60_000)).toBe(60 * 60_000);
  });
});

describe("buildMetrics", () => {
  it("returns an empty series for an empty timeline", () => {
    expect(buildMetrics([]).buckets).toEqual([]);
  });

  it("counts errors per minute and records deploy markers", () => {
    const now = new Date("2026-10-15T02:30:00Z");
    const metrics = buildMetrics(
      [
        ev("deploy", "2026-10-15T02:00:10Z", "Deployed abc"),
        ev("error", "2026-10-15T02:02:05Z"),
        ev("error", "2026-10-15T02:02:40Z"),
        ev("alert", "2026-10-15T02:03:00Z"),
        ev("recovery", "2026-10-15T02:09:00Z"),
      ],
      now,
    );

    expect(metrics.bucketMs).toBe(60_000);
    const at = (iso: string) => metrics.buckets.find((b) => b.t === iso);
    expect(at("2026-10-15T02:02:00.000Z")).toMatchObject({ errors: 2, alerts: 0 });
    expect(at("2026-10-15T02:03:00.000Z")).toMatchObject({ errors: 0, alerts: 1 });
    expect(metrics.markers.map((m) => m.kind)).toEqual(["deploy", "recovery"]);
    // First error 02:02:05 → recovery 02:09:00
    expect(metrics.durationMs).toBe(6 * 60_000 + 55_000);
  });

  it("measures an ongoing incident up to now", () => {
    const now = new Date("2026-10-15T02:05:00Z");
    const metrics = buildMetrics([ev("alert", "2026-10-15T02:00:00Z")], now);
    expect(metrics.durationMs).toBe(5 * 60_000);
    expect(metrics.buckets.length).toBe(6);
  });
});

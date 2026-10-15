import { Bar, BarChart, CartesianGrid, Label, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Metrics } from "../lib/api";
import { clock, duration } from "../lib/format";
import { Card } from "./ui";

const MARKER_COLOR = { deploy: "#a78bfa", change: "#818cf8", recovery: "#34d399" } as const;

/**
 * Error/alert rate per time bucket, with deploys and recoveries drawn as
 * vertical lines: the "did this deploy cause it?" view.
 */
export function ErrorChart({ metrics }: { metrics: Metrics | null }) {
  const data = metrics?.buckets.map((b) => ({ ...b, ts: Date.parse(b.t) })) ?? [];
  const bucketMs = metrics?.bucketMs ?? 60_000;
  // Snap each marker to its bucket so it lines up with a bar.
  const markers =
    metrics?.markers.map((m) => ({ ...m, ts: Math.floor(Date.parse(m.t) / bucketMs) * bucketMs })) ?? [];

  return (
    <Card
      title="Error rate"
      action={
        <div className="flex items-center gap-3 text-xs text-zinc-400">
          <Legend color="#fb923c" label="Errors" />
          <Legend color="#f43f5e" label="Alerts" />
          <Legend color={MARKER_COLOR.deploy} label="Deploys" line />
          <Legend color={MARKER_COLOR.recovery} label="Recovery" line />
          {metrics?.durationMs != null && (
            <span className="rounded bg-zinc-800 px-2 py-0.5 text-zinc-300">Impact {duration(metrics.durationMs)}</span>
          )}
        </div>
      }
    >
      <div className="h-48 px-2 py-3">
        {data.length === 0 ? (
          <p className="flex h-full items-center justify-center text-sm text-zinc-500">
            No errors or alerts yet. Connect GitHub or Sentry webhooks, or run the simulator.
          </p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 18, right: 12, bottom: 0, left: -18 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} stroke="#27272a" />
              <XAxis
                dataKey="ts"
                type="number"
                scale="time"
                domain={["dataMin - " + bucketMs / 2, "dataMax + " + bucketMs / 2]}
                tickFormatter={(v: number) => clock(new Date(v).toISOString())}
                stroke="#52525b"
                fontSize={11}
                tickLine={false}
              />
              <YAxis allowDecimals={false} stroke="#52525b" fontSize={11} tickLine={false} axisLine={false} />
              <Tooltip
                cursor={{ fill: "#27272a" }}
                contentStyle={{ background: "#18181b", border: "1px solid #3f3f46", borderRadius: 8, fontSize: 12 }}
                labelFormatter={(v: number) => clock(new Date(v).toISOString())}
              />
              <Bar dataKey="errors" stackId="a" fill="#fb923c" name="Errors" />
              <Bar dataKey="alerts" stackId="a" fill="#f43f5e" name="Alerts" radius={[3, 3, 0, 0]} />
              {markers.map((m, i) => (
                <ReferenceLine key={`${m.t}-${i}`} x={m.ts} stroke={MARKER_COLOR[m.kind]} strokeDasharray="4 3">
                  <Label value={m.kind === "recovery" ? "✓" : "▲"} position="top" fill={MARKER_COLOR[m.kind]} fontSize={11} />
                </ReferenceLine>
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  );
}

function Legend({ color, label, line }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="hidden items-center gap-1 md:inline-flex">
      <span className="inline-block" style={line ? { width: 10, borderTop: `2px dashed ${color}` } : { width: 8, height: 8, background: color, borderRadius: 2 }} />
      {label}
    </span>
  );
}

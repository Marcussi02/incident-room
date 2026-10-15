import { Flame, Plus, Timer, Zap } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { NewIncidentDialog } from "../components/NewIncidentDialog";
import { Button, LiveDot, SeverityBadge, StatusBadge } from "../components/ui";
import { api, type IncidentSummary, type LiveMessage } from "../lib/api";
import { duration, timeAgo } from "../lib/format";
import { useLive } from "../lib/live";

function Stat({ icon: Icon, label, value }: { icon: typeof Flame; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
        <Icon size={14} /> {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

export function IncidentList() {
  const [incidents, setIncidents] = useState<IncidentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() => {
    api.listIncidents().then((r) => setIncidents(r.incidents), (e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  // New/updated incidents (including ones auto-opened by webhooks) appear without a refresh.
  const status = useLive(
    "all",
    useCallback(
      (msg: LiveMessage) => {
        if (msg.type === "incident") load();
      },
      [load],
    ),
    load,
  );

  const open = incidents?.filter((i) => i.status !== "resolved") ?? [];
  const resolved = incidents?.filter((i) => i.status === "resolved" && i.resolved_at) ?? [];
  const mttr = resolved.length
    ? resolved.reduce((sum, i) => sum + (Date.parse(i.resolved_at!) - Date.parse(i.created_at)), 0) / resolved.length
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Incidents</h1>
          <p className="mt-1 flex items-center gap-3 text-sm text-zinc-400">
            Alerts from GitHub, Sentry and your monitors open incidents here automatically.
            <LiveDot status={status} />
          </p>
        </div>
        <Button variant="danger" onClick={() => setCreating(true)}>
          <Plus size={16} /> Declare incident
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat icon={Flame} label="Open now" value={incidents ? String(open.length) : "–"} />
        <Stat icon={Timer} label="Mean time to resolve" value={mttr != null ? duration(mttr) : "–"} />
        <Stat icon={Zap} label="Total incidents" value={incidents ? String(incidents.length) : "–"} />
      </div>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      <div className="overflow-hidden rounded-xl border border-zinc-800">
        {incidents?.length === 0 && (
          <div className="p-10 text-center text-sm text-zinc-400">
            <p className="text-base text-zinc-200">All quiet. 🎉</p>
            <p className="mt-1">
              Declare an incident, or run <code className="rounded bg-zinc-800 px-1.5 py-0.5">npm run simulate</code> to watch one unfold.
            </p>
          </div>
        )}
        <ul className="divide-y divide-zinc-800">
          {incidents?.map((i) => (
            <li key={i.id}>
              <Link to={`/incidents/${i.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 hover:bg-zinc-900">
                <SeverityBadge severity={i.severity} />
                <span className="min-w-0 flex-1 truncate font-medium text-zinc-100">{i.title}</span>
                <StatusBadge status={i.status} />
                <span className="whitespace-nowrap text-right text-xs text-zinc-500 sm:w-40">
                  {i.event_count} events · {timeAgo(i.last_event_at ?? i.created_at)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {creating && <NewIncidentDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

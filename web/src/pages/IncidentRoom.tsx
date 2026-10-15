import { ArrowLeft, Clock } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ErrorChart } from "../components/ErrorChart";
import { Notes } from "../components/Notes";
import { PostmortemPanel } from "../components/PostmortemPanel";
import { Timeline } from "../components/Timeline";
import { LiveDot, SeverityBadge } from "../components/ui";
import { api, type Incident, type LiveMessage, type Metrics, type Severity, type Status, type TimelineEvent } from "../lib/api";
import { duration, STATUS_ORDER } from "../lib/format";
import { useLive } from "../lib/live";

function useNow(intervalMs: number) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

function StatusStepper({ status, onChange }: { status: Status; onChange: (s: Status) => void }) {
  const current = STATUS_ORDER.indexOf(status);
  return (
    <div className="flex overflow-hidden rounded-lg border border-zinc-800" role="radiogroup" aria-label="Incident status">
      {STATUS_ORDER.map((s, i) => (
        <button
          key={s}
          role="radio"
          aria-checked={s === status}
          onClick={() => s !== status && onChange(s)}
          className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
            s === status
              ? s === "resolved"
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-zinc-100 text-zinc-900"
              : i < current
                ? "bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
                : "bg-zinc-950 text-zinc-500 hover:bg-zinc-800"
          }`}
        >
          {s}
        </button>
      ))}
    </div>
  );
}

export function IncidentRoom() {
  const { id = "" } = useParams();
  const [incident, setIncident] = useState<Incident | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [aiEnabled, setAiEnabled] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const metricsTimer = useRef<ReturnType<typeof setTimeout>>();
  const now = useNow(30_000);

  const refreshMetrics = useCallback(() => {
    // Debounced: an alert storm shouldn't trigger a request per event.
    clearTimeout(metricsTimer.current);
    metricsTimer.current = setTimeout(() => api.metrics(id).then(setMetrics, () => {}), 400);
  }, [id]);

  const load = useCallback(() => {
    api.getIncident(id).then(
      (r) => {
        setIncident(r.incident);
        setEvents(r.events);
        refreshMetrics();
      },
      () => setNotFound(true),
    );
  }, [id, refreshMetrics]);

  useEffect(() => {
    load();
    api.config().then((c) => setAiEnabled(c.aiEnabled), () => {});
  }, [load]);

  const onMessage = useCallback(
    (msg: LiveMessage) => {
      if (msg.type === "incident" && msg.incident.id === id) setIncident(msg.incident);
      if (msg.type === "event" && msg.incidentId === id) {
        setEvents((prev) =>
          prev.some((e) => e.id === msg.event.id)
            ? prev
            : [...prev, msg.event].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at)),
        );
        setFresh((prev) => new Set(prev).add(msg.event.id));
        setTimeout(() => setFresh((prev) => {
          const next = new Set(prev);
          next.delete(msg.event.id);
          return next;
        }), 2500);
        refreshMetrics();
      }
    },
    [id, refreshMetrics],
  );

  const liveStatus = useLive(id, onMessage, load);

  if (notFound) {
    return (
      <div className="py-20 text-center">
        <p className="text-lg">Incident not found.</p>
        <Link to="/" className="mt-2 inline-block text-sm text-zinc-400 hover:text-zinc-100">← Back to incidents</Link>
      </div>
    );
  }
  if (!incident) return <div className="h-96 animate-pulse rounded-xl bg-zinc-900" />;

  const update = (changes: { status?: Status; severity?: Severity }) =>
    api.updateIncident(incident.id, changes).then((r) => setIncident(r.incident));

  const elapsed = (incident.resolved_at ? Date.parse(incident.resolved_at) : now) - Date.parse(incident.created_at);

  return (
    <div className="space-y-4">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-100">
        <ArrowLeft size={14} /> Incidents
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-2">
          <div className="flex items-center gap-3">
            <SeverityBadge severity={incident.severity} />
            <LiveDot status={liveStatus} />
            <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
              <Clock size={12} /> {incident.resolved_at ? "Lasted" : "Open for"} {duration(elapsed)}
            </span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{incident.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={incident.severity}
            onChange={(e) => update({ severity: e.target.value as Severity })}
            className="rounded-lg border border-zinc-800 bg-zinc-950 px-2 py-1.5 text-xs font-medium text-zinc-200"
            aria-label="Severity"
          >
            <option>SEV1</option>
            <option>SEV2</option>
            <option>SEV3</option>
          </select>
          <StatusStepper status={incident.status} onChange={(status) => update({ status })} />
        </div>
      </header>

      <ErrorChart metrics={metrics} />

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <Timeline incidentId={incident.id} events={events} freshIds={fresh} />
        </div>
        <div className="lg:col-span-7">
          <Notes incidentId={incident.id} />
        </div>
      </div>

      <PostmortemPanel incident={incident} aiEnabled={aiEnabled} />
    </div>
  );
}

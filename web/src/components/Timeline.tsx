import {
  AlertTriangle,
  Bug,
  CheckCircle2,
  GitCommitHorizontal,
  Pin,
  Rocket,
  Send,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, type EventKind, type TimelineEvent } from "../lib/api";
import { clock, clockSeconds } from "../lib/format";
import { Card, inputClass } from "./ui";

const KIND: Record<EventKind, { icon: LucideIcon; color: string; label: string }> = {
  alert: { icon: AlertTriangle, color: "text-rose-400 bg-rose-500/10", label: "Alert" },
  error: { icon: Bug, color: "text-orange-400 bg-orange-500/10", label: "Error" },
  deploy: { icon: Rocket, color: "text-violet-400 bg-violet-500/10", label: "Deploy" },
  change: { icon: GitCommitHorizontal, color: "text-indigo-400 bg-indigo-500/10", label: "Change" },
  note: { icon: Pin, color: "text-yellow-300 bg-yellow-500/10", label: "Finding" },
  status_change: { icon: Workflow, color: "text-zinc-300 bg-zinc-500/10", label: "Update" },
  recovery: { icon: CheckCircle2, color: "text-emerald-400 bg-emerald-500/10", label: "Recovery" },
};

/** Consecutive identical errors (same title) collapse into one row with a count, like an alert storm view. */
function groupEvents(events: TimelineEvent[]) {
  const groups: { event: TimelineEvent; count: number; last: string }[] = [];
  for (const event of events) {
    const prev = groups[groups.length - 1];
    if (prev && event.kind === "error" && prev.event.kind === "error" && prev.event.title === event.title) {
      prev.count += 1;
      prev.last = event.occurred_at;
    } else {
      groups.push({ event, count: 1, last: event.occurred_at });
    }
  }
  return groups;
}

export function Timeline({ incidentId, events, freshIds }: { incidentId: string; events: TimelineEvent[]; freshIds: Set<string> }) {
  const [finding, setFinding] = useState("");
  const [posting, setPosting] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const count = events.length;

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [count]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!finding.trim()) return;
    setPosting(true);
    try {
      await api.addNote(incidentId, finding);
      setFinding("");
    } finally {
      setPosting(false);
    }
  };

  return (
    <Card title="Timeline" action={<span className="text-xs text-zinc-500">{count} events</span>} className="flex flex-col">
      <ol className="max-h-[520px] min-h-[200px] flex-1 space-y-1 overflow-y-auto p-3" aria-live="polite">
        {groupEvents(events).map(({ event, count: n, last }) => {
          const { icon: Icon, color, label } = KIND[event.kind];
          const url = typeof event.detail.url === "string" ? event.detail.url : undefined;
          return (
            <li
              key={event.id}
              className={`flex gap-3 rounded-lg px-2 py-2 transition-colors duration-1000 ${freshIds.has(event.id) ? "bg-zinc-800" : ""}`}
            >
              <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${color}`} aria-label={label}>
                <Icon size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm leading-snug text-zinc-100">
                  {url ? (
                    <a href={url} target="_blank" rel="noreferrer" className="hover:underline">
                      {event.title}
                    </a>
                  ) : (
                    event.title
                  )}
                  {n > 1 && <span className="ml-2 rounded bg-orange-500/15 px-1.5 text-xs font-semibold text-orange-300">×{n}</span>}
                </p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  <time dateTime={event.occurred_at} title={clockSeconds(event.occurred_at)}>
                    {clock(event.occurred_at)}
                    {n > 1 && `–${clock(last)}`}
                  </time>
                  {" · "}
                  {event.source}
                  {event.author && ` · ${event.author}`}
                </p>
              </div>
            </li>
          );
        })}
        <div ref={bottom} />
      </ol>
      <form onSubmit={submit} className="flex gap-2 border-t border-zinc-800 p-3">
        <input
          className={inputClass}
          placeholder="Pin a finding, e.g. “Rolled back to v1.4.2”"
          value={finding}
          maxLength={300}
          onChange={(e) => setFinding(e.target.value)}
          aria-label="Pin a finding to the timeline"
        />
        <button
          type="submit"
          disabled={posting || !finding.trim()}
          className="rounded-lg bg-zinc-800 px-3 text-zinc-200 hover:bg-zinc-700 disabled:opacity-40"
          aria-label="Add to timeline"
        >
          <Send size={15} />
        </button>
      </form>
    </Card>
  );
}

import { Check, Copy, FileText, Sparkles } from "lucide-react";
import { useState } from "react";
import { api, type Incident, type Postmortem } from "../lib/api";
import { Button, Card } from "./ui";

export function toMarkdown(incident: Incident, pm: Postmortem): string {
  const list = (items: string[]) => (items.length ? items.map((i) => `- ${i}`).join("\n") : "- _None recorded_");
  return [
    `# Postmortem: ${incident.title}`,
    ``,
    `**Severity:** ${incident.severity} · **Opened:** ${new Date(incident.created_at).toUTCString()}` +
      (incident.resolved_at ? ` · **Resolved:** ${new Date(incident.resolved_at).toUTCString()}` : ""),
    ``,
    `## Summary`, pm.summary, ``,
    `## Impact`, pm.impact, ``,
    `## Root cause`, pm.rootCause, ``,
    `## Detection`, pm.detection, ``,
    `## Resolution`, pm.resolution, ``,
    `## Timeline`, pm.timeline.map((t) => `- **${t.time}**: ${t.description}`).join("\n"), ``,
    `## What went well`, list(pm.whatWentWell), ``,
    `## What went wrong`, list(pm.whatWentWrong), ``,
    `## Action items`,
    pm.actionItems.map((a) => `- [ ] **${a.priority}** ${a.title} (${a.owner})`).join("\n"),
  ].join("\n");
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h3>
      <div className="text-sm leading-relaxed text-zinc-200">{children}</div>
    </div>
  );
}

const PRIORITY = { P0: "bg-rose-500/15 text-rose-300", P1: "bg-amber-500/15 text-amber-300", P2: "bg-zinc-700 text-zinc-300" };

export function PostmortemPanel({ incident, aiEnabled }: { incident: Incident; aiEnabled: boolean }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const pm = incident.postmortem;

  const generate = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.generatePostmortem(incident.id); // the live socket delivers the updated incident
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed");
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!pm) return;
    await navigator.clipboard.writeText(toMarkdown(incident, pm));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <FileText size={15} /> Postmortem
        </span>
      }
      action={
        <div className="flex gap-2">
          {pm && (
            <Button variant="ghost" onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy Markdown"}
            </Button>
          )}
          <Button variant={pm ? "secondary" : "primary"} onClick={generate} disabled={loading}>
            <Sparkles size={14} className={loading ? "animate-pulse" : ""} />
            {loading ? "Drafting…" : pm ? "Regenerate" : aiEnabled ? "Draft with AI" : "Draft postmortem"}
          </Button>
        </div>
      }
    >
      <div className="p-5">
        {error && <p className="mb-3 text-sm text-rose-400">{error}</p>}
        {!pm ? (
          <p className="text-sm text-zinc-400">
            {incident.status === "resolved"
              ? "The incident is resolved. Draft a blameless postmortem from the timeline and shared notes."
              : "When things are stable, draft a postmortem from the timeline and shared notes. You can regenerate it any time."}
            {!aiEnabled && " (No AI_API_KEY set, so this uses a template draft.)"}
          </p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="space-y-4">
              <Section title="Summary">{pm.summary}</Section>
              <Section title="Impact">{pm.impact}</Section>
              <Section title="Root cause">{pm.rootCause}</Section>
              <Section title="Detection">{pm.detection}</Section>
              <Section title="Resolution">{pm.resolution}</Section>
            </div>
            <div className="space-y-4">
              <Section title="Timeline">
                <ol className="space-y-1">
                  {pm.timeline.map((t, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="w-20 shrink-0 font-mono text-xs leading-5 text-zinc-500">{t.time}</span>
                      <span>{t.description}</span>
                    </li>
                  ))}
                </ol>
              </Section>
              <div className="grid gap-4 sm:grid-cols-2">
                <Section title="Went well">
                  <ul className="list-disc space-y-1 pl-4">{pm.whatWentWell.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </Section>
                <Section title="Went wrong">
                  <ul className="list-disc space-y-1 pl-4">{pm.whatWentWrong.map((x, i) => <li key={i}>{x}</li>)}</ul>
                </Section>
              </div>
              <Section title="Action items">
                <ul className="space-y-1.5">
                  {pm.actionItems.map((a, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className={`rounded px-1.5 text-xs font-semibold leading-5 ${PRIORITY[a.priority]}`}>{a.priority}</span>
                      <span className="flex-1">{a.title}</span>
                      <span className="text-xs leading-5 text-zinc-500">{a.owner}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            </div>
            <p className="text-xs text-zinc-500 lg:col-span-2">
              Drafted {new Date(pm.generatedAt).toLocaleString()} by {pm.generatedBy === "ai" ? "AI" : "template"}. Review before sharing.
            </p>
          </div>
        )}
      </div>
    </Card>
  );
}

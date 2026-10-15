import type { Severity, Status } from "./api";

export function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function clockSeconds(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function duration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ${minutes % 60}m`;
  return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

export function timeAgo(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (ms < 60_000) return "just now";
  return `${duration(ms)} ago`;
}

export const severityStyle: Record<Severity, string> = {
  SEV1: "bg-rose-500/15 text-rose-300 ring-rose-500/40",
  SEV2: "bg-amber-500/15 text-amber-300 ring-amber-500/40",
  SEV3: "bg-sky-500/15 text-sky-300 ring-sky-500/40",
};

export const statusStyle: Record<Status, string> = {
  investigating: "bg-rose-500/10 text-rose-300",
  identified: "bg-amber-500/10 text-amber-300",
  monitoring: "bg-sky-500/10 text-sky-300",
  resolved: "bg-emerald-500/10 text-emerald-300",
};

export const STATUS_ORDER: Status[] = ["investigating", "identified", "monitoring", "resolved"];

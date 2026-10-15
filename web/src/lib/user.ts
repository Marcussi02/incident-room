import { useSyncExternalStore } from "react";

export interface LocalUser {
  name: string;
  color: string;
}

const KEY = "incidentroom:user";
const COLORS = ["#f87171", "#fb923c", "#facc15", "#4ade80", "#2dd4bf", "#60a5fa", "#a78bfa", "#f472b6"];
const listeners = new Set<() => void>();

let cached: LocalUser | null | undefined;

export function getUser(): LocalUser | null {
  if (cached !== undefined) return cached;
  try {
    const raw = localStorage.getItem(KEY);
    cached = raw ? (JSON.parse(raw) as LocalUser) : null;
  } catch {
    cached = null;
  }
  return cached;
}

export function setUserName(name: string): void {
  const color = getUser()?.color ?? COLORS[Math.floor(Math.random() * COLORS.length)];
  cached = { name: name.trim().slice(0, 40), color };
  try {
    localStorage.setItem(KEY, JSON.stringify(cached));
  } catch {
    // Private mode: keep the name for this session only.
  }
  listeners.forEach((fn) => fn());
}

export function useUser(): LocalUser | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getUser,
  );
}

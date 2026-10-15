import { useEffect, useRef, useState } from "react";
import type { LiveMessage } from "./api";

export type LiveStatus = "connecting" | "live" | "offline";

export function wsUrl(path: string): string {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}${path}`;
}

/**
 * Subscribes to server pushes for one incident (or "all"), reconnecting with
 * exponential backoff. `onReconnect` lets callers refetch anything missed while offline.
 */
export function useLive(room: string, onMessage: (msg: LiveMessage) => void, onReconnect?: () => void): LiveStatus {
  const [status, setStatus] = useState<LiveStatus>("connecting");
  const handlers = useRef({ onMessage, onReconnect });
  handlers.current = { onMessage, onReconnect };

  useEffect(() => {
    let socket: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let closed = false;

    const connect = () => {
      socket = new WebSocket(wsUrl(`/live?incident=${encodeURIComponent(room)}`));
      socket.onopen = () => {
        if (retry > 0) handlers.current.onReconnect?.();
        retry = 0;
        setStatus("live");
      };
      socket.onmessage = (e) => handlers.current.onMessage(JSON.parse(e.data as string) as LiveMessage);
      socket.onclose = () => {
        if (closed) return;
        setStatus("offline");
        const delay = Math.min(30_000, 500 * 2 ** retry++);
        timer = setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      socket?.close();
    };
  }, [room]);

  return status;
}

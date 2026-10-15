import type { IncomingMessage } from "node:http";
import { Redis } from "ioredis";
import { WebSocket, WebSocketServer } from "ws";
import type { LiveMessage } from "../types.js";

const CHANNEL = "incidentroom:live";

/**
 * Fans live updates (new timeline events, incident changes) out to browsers.
 *
 * Browsers connect to /live?incident=<id> (or incident=all for the dashboard).
 * With REDIS_URL set, every publish goes through Redis pub/sub so that clients
 * connected to *other* server instances receive it too; without Redis it
 * delivers in-process, which is fine for a single instance.
 */
export class LiveHub {
  readonly wss = new WebSocketServer({ noServer: true });
  private readonly rooms = new Map<string, Set<WebSocket>>();
  private pub?: Redis;
  private sub?: Redis;

  constructor(redisUrl?: string) {
    if (redisUrl) {
      this.pub = new Redis(redisUrl);
      this.sub = new Redis(redisUrl);
      void this.sub.subscribe(CHANNEL);
      this.sub.on("message", (_channel, raw: string) => this.deliver(JSON.parse(raw) as LiveMessage));
    }

    this.wss.on("connection", (socket: WebSocket, req: IncomingMessage) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const room = url.searchParams.get("incident") ?? "all";
      this.join(room, socket);
      socket.on("close", () => this.leave(room, socket));
    });

    // Drop dead connections (laptops closing, proxies timing out).
    const heartbeat = setInterval(() => {
      for (const socket of this.wss.clients) {
        if ((socket as WebSocket & { alive?: boolean }).alive === false) {
          socket.terminate();
          continue;
        }
        (socket as WebSocket & { alive?: boolean }).alive = false;
        socket.ping();
      }
    }, 30_000);
    heartbeat.unref();
    this.wss.on("connection", (socket) => {
      (socket as WebSocket & { alive?: boolean }).alive = true;
      socket.on("pong", () => ((socket as WebSocket & { alive?: boolean }).alive = true));
    });
  }

  async publish(message: LiveMessage): Promise<void> {
    if (this.pub) {
      await this.pub.publish(CHANNEL, JSON.stringify(message));
    } else {
      this.deliver(message);
    }
  }

  private deliver(message: LiveMessage): void {
    const incidentId = message.type === "event" ? message.incidentId : message.incident.id;
    const payload = JSON.stringify(message);
    for (const room of [incidentId, "all"]) {
      for (const socket of this.rooms.get(room) ?? []) {
        if (socket.readyState === WebSocket.OPEN) socket.send(payload);
      }
    }
  }

  private join(room: string, socket: WebSocket) {
    if (!this.rooms.has(room)) this.rooms.set(room, new Set());
    this.rooms.get(room)!.add(socket);
  }

  private leave(room: string, socket: WebSocket) {
    const members = this.rooms.get(room);
    members?.delete(socket);
    if (members?.size === 0) this.rooms.delete(room);
  }

  async close(): Promise<void> {
    this.wss.close();
    await Promise.all([this.pub?.quit(), this.sub?.quit()]);
  }
}

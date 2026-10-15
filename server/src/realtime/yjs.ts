import type { IncomingMessage } from "node:http";
import * as decoding from "lib0/decoding";
import * as encoding from "lib0/encoding";
import { WebSocket, WebSocketServer } from "ws";
import * as awarenessProtocol from "y-protocols/awareness";
import * as syncProtocol from "y-protocols/sync";
import * as Y from "yjs";
import type { Db } from "../db.js";

// Wire protocol shared with y-websocket's browser WebsocketProvider.
const MSG_SYNC = 0;
const MSG_AWARENESS = 1;
const MSG_QUERY_AWARENESS = 3;

const SAVE_DEBOUNCE_MS = 1500;

class Room {
  readonly doc = new Y.Doc();
  readonly awareness = new awarenessProtocol.Awareness(this.doc);
  /** Each socket plus the awareness client ids it controls (for cleanup on disconnect). */
  readonly conns = new Map<WebSocket, Set<number>>();
  private saveTimer?: NodeJS.Timeout;

  constructor(readonly name: string, private readonly db: Db) {
    this.awareness.setLocalState(null); // the server itself isn't a participant

    this.doc.on("update", (update: Uint8Array) => {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      this.broadcast(encoding.toUint8Array(encoder));
      this.scheduleSave();
    });

    this.awareness.on("update", ({ added, updated, removed }: AwarenessChange, origin: unknown) => {
      const changed = [...added, ...updated, ...removed];
      if (origin instanceof WebSocket) {
        const owned = this.conns.get(origin);
        added.forEach((id) => owned?.add(id));
        removed.forEach((id) => owned?.delete(id));
      }
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed));
      this.broadcast(encoding.toUint8Array(encoder));
    });
  }

  async load(): Promise<void> {
    const { rows } = await this.db.query<{ state: Buffer }>("SELECT state FROM ydocs WHERE name = $1", [this.name]);
    if (rows[0]) Y.applyUpdate(this.doc, new Uint8Array(rows[0].state));
  }

  async save(): Promise<void> {
    clearTimeout(this.saveTimer);
    this.saveTimer = undefined;
    const state = Buffer.from(Y.encodeStateAsUpdate(this.doc));
    await this.db.query(
      `INSERT INTO ydocs (name, state, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (name) DO UPDATE SET state = EXCLUDED.state, updated_at = now()`,
      [this.name, state],
    );
  }

  private scheduleSave() {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.save().catch((err) => console.error(`[yjs] failed to save ${this.name}`, err));
    }, SAVE_DEBOUNCE_MS);
  }

  broadcast(message: Uint8Array, except?: WebSocket) {
    for (const conn of this.conns.keys()) {
      if (conn !== except && conn.readyState === WebSocket.OPEN) conn.send(message);
    }
  }
}

interface AwarenessChange {
  added: number[];
  updated: number[];
  removed: number[];
}

/**
 * Collaborative-notes server: one Yjs document per incident, synced to every
 * browser in the room and persisted to Postgres (debounced, plus a final save
 * when the last person leaves).
 */
export class NotesServer {
  readonly wss = new WebSocketServer({ noServer: true });
  private readonly rooms = new Map<string, Promise<Room>>();

  constructor(private readonly db: Db) {
    this.wss.on("connection", (socket: WebSocket, _req: IncomingMessage, roomName: string) => {
      void this.handleConnection(socket, roomName);
    });
  }

  private getRoom(name: string): Promise<Room> {
    let room = this.rooms.get(name);
    if (!room) {
      const created = new Room(name, this.db);
      room = created.load().then(() => created);
      this.rooms.set(name, room);
      room.catch(() => this.rooms.delete(name));
    }
    return room;
  }

  private async handleConnection(socket: WebSocket, roomName: string) {
    socket.binaryType = "arraybuffer";
    // Buffer messages that arrive while the document is still loading from Postgres.
    const pending: Uint8Array[] = [];
    const early = (data: ArrayBuffer) => pending.push(new Uint8Array(data));
    socket.on("message", early);

    let room: Room;
    try {
      room = await this.getRoom(roomName);
    } catch (err) {
      console.error(`[yjs] failed to load ${roomName}`, err);
      socket.close(1011, "failed to load document");
      return;
    }

    socket.off("message", early);
    room.conns.set(socket, new Set());
    socket.on("message", (data: ArrayBuffer) => this.handleMessage(room, socket, new Uint8Array(data)));
    socket.on("close", () => void this.handleClose(room, socket));

    // Kick off sync: send our state vector, and the current presence list.
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(encoder, room.doc);
    socket.send(encoding.toUint8Array(encoder));
    this.sendAwareness(room, socket);

    for (const message of pending) this.handleMessage(room, socket, message);
  }

  private handleMessage(room: Room, socket: WebSocket, message: Uint8Array) {
    try {
      const decoder = decoding.createDecoder(message);
      const type = decoding.readVarUint(decoder);
      if (type === MSG_SYNC) {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.readSyncMessage(decoder, encoder, room.doc, socket);
        // Only reply if readSyncMessage wrote something beyond the message type.
        if (encoding.length(encoder) > 1) socket.send(encoding.toUint8Array(encoder));
      } else if (type === MSG_AWARENESS) {
        awarenessProtocol.applyAwarenessUpdate(room.awareness, decoding.readVarUint8Array(decoder), socket);
      } else if (type === MSG_QUERY_AWARENESS) {
        this.sendAwareness(room, socket);
      }
    } catch (err) {
      console.error("[yjs] bad message", err);
    }
  }

  private sendAwareness(room: Room, socket: WebSocket) {
    const states = room.awareness.getStates();
    if (states.size === 0) return;
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, MSG_AWARENESS);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(room.awareness, [...states.keys()]));
    socket.send(encoding.toUint8Array(encoder));
  }

  private async handleClose(room: Room, socket: WebSocket) {
    const owned = room.conns.get(socket);
    room.conns.delete(socket);
    if (owned) awarenessProtocol.removeAwarenessStates(room.awareness, [...owned], null);
    if (room.conns.size === 0) {
      try {
        await room.save();
      } finally {
        // Someone may have rejoined while we were saving.
        if (room.conns.size === 0) {
          this.rooms.delete(room.name);
          room.doc.destroy();
        }
      }
    }
  }

  /** Plain-text version of an incident's notes (used for the AI postmortem). */
  async readNotesText(roomName: string): Promise<string> {
    const live = this.rooms.get(roomName);
    if (live) return docToText((await live).doc);
    const doc = new Y.Doc();
    const { rows } = await this.db.query<{ state: Buffer }>("SELECT state FROM ydocs WHERE name = $1", [roomName]);
    if (rows[0]) Y.applyUpdate(doc, new Uint8Array(rows[0].state));
    return docToText(doc);
  }

  async close(): Promise<void> {
    for (const room of this.rooms.values()) await (await room).save();
    this.wss.close();
  }
}

/** Flattens the TipTap/ProseMirror XML fragment into text, one block per line. */
export function docToText(doc: Y.Doc, field = "default"): string {
  const lines: string[] = [];
  const plain = (node: Y.XmlElement | Y.XmlText) =>
    node instanceof Y.XmlText ? node.toString().replace(/<[^>]+>/g, "") : node.nodeName === "hardBreak" ? " " : "";

  const collect = (node: Y.XmlFragment | Y.XmlElement | Y.XmlText, prefix: string) => {
    if (node instanceof Y.XmlText) {
      const text = plain(node).trim();
      if (text) lines.push(prefix + text);
      return;
    }
    const children = node.toArray() as Array<Y.XmlElement | Y.XmlText>;
    const isTextBlock =
      node instanceof Y.XmlElement &&
      children.every((c) => c instanceof Y.XmlText || c.nodeName === "hardBreak");
    if (isTextBlock) {
      const text = children.map(plain).join("").trim();
      if (text) lines.push(prefix + text);
      return;
    }
    const childPrefix = node instanceof Y.XmlElement && node.nodeName === "listItem" ? "- " : prefix;
    children.forEach((child) => collect(child, childPrefix));
  };

  collect(doc.getXmlFragment(field), "");
  return lines.join("\n");
}

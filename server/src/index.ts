import http from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { createApp } from "./app.js";
import { config } from "./config.js";
import { createPool, migrate } from "./db.js";
import { IncidentService } from "./incidents.js";
import { LiveHub } from "./realtime/hub.js";
import { NotesServer } from "./realtime/yjs.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  const db = createPool(config.DATABASE_URL);
  await migrate(db);

  const hub = new LiveHub(config.REDIS_URL);
  const notes = new NotesServer(db);
  const service = new IncidentService(db, hub);
  const anthropic = config.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: config.ANTHROPIC_API_KEY }) : null;

  const app = createApp({
    service,
    readNotes: (id) => notes.readNotesText(`incident:${id}`),
    anthropic,
    config,
  });

  const server = http.createServer(app);

  // Two WebSocket endpoints share the HTTP server:
  //   /yjs/<incidentId>  collaborative notes (binary Yjs protocol)
  //   /live?incident=..  JSON push of timeline events and incident changes
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const yjsMatch = url.pathname.match(/^\/yjs\/([^/]+)$/);
    if (yjsMatch && UUID.test(yjsMatch[1])) {
      notes.wss.handleUpgrade(req, socket, head, (ws) => notes.wss.emit("connection", ws, req, `incident:${yjsMatch[1]}`));
    } else if (url.pathname === "/live") {
      hub.wss.handleUpgrade(req, socket, head, (ws) => hub.wss.emit("connection", ws, req));
    } else {
      socket.destroy();
    }
  });

  server.listen(config.PORT, () => {
    console.log(`IncidentRoom listening on http://localhost:${config.PORT} (AI postmortems: ${anthropic ? "Claude" : "template"})`);
  });

  const shutdown = async () => {
    console.log("Shutting down…");
    server.close();
    await notes.close(); // flush unsaved notes
    await hub.close();
    await db.end();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

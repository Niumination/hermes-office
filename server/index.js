/**
 * index.js — Hermes Office server entry: HTTP + WS + static host.
 * Event hub per docs/EVENTS.md; auth per docs/SECURITY.md.
 */
import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { config, assertConfig } from "./config.js";
import { authenticate, getBearer, createSession, sessionCookieHeader, requireAuth, requireAny, requireOwner } from "./auth.js";
import { OfficeEventBus } from "./eventbus.js";
import { createChatRouter } from "./chat.js";
import { createGithubPoller } from "./github.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

assertConfig();

// ---------------------------------------------------------------------------
// Core pieces
// ---------------------------------------------------------------------------

const bus = new OfficeEventBus();
const startTime = Date.now();

/** @type {Map<WebSocket, {isGuest: boolean, ip: string}>} */
const wsClients = new Map();

function broadcast(event) {
  const raw = JSON.stringify({ channel: "event", data: event });
  for (const [ws, meta] of wsClients) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    try {
      ws.send(meta.isGuest ? bus.frameFor(event, true) : raw);
    } catch {}
  }
}

bus.on("event", broadcast);

/** Emit an internal (system-sourced) event, e.g. office_chat activity. */
function emitInternal(event) {
  const ev = { source: "system", ts: Date.now(), ...event };
  bus.buffer.push(ev);
  bus.broadcast(ev);
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

// CORS allowlist
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && !config.allowedOrigins.has(origin)) {
    return res.status(403).json({ error: "Forbidden origin" });
  }
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});
app.options("*", (_req, res) => res.sendStatus(204));

// Content-Type enforcement for JSON POSTs (SECURITY.md §4)
app.use((req, res, next) => {
  if (req.method === "POST" && req.path !== "/event") {
    // chat/event handlers enforce their own; event allows any since bridges may post plain
  }
  next();
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    uptimeS: Math.floor((Date.now() - startTime) / 1000),
    wsClients: wsClients.size,
    eventsBuffered: bus.buffer.size,
    now: Date.now(),
  });
});

// Roster — any authenticated identity
app.get("/roster", requireAny, (_req, res) => {
  res.json({
    agents: [
      { name: "cloud", role: "generalist" },
      { name: "mac", role: "generalist" },
      { name: "boss", role: "reviewer" },
    ],
    server: "1.0",
  });
});

// Session bootstrap for browsers (WS can't send headers): POST /auth/session
// with Bearer token → HttpOnly office_session cookie used for WS + /chat.
app.post("/auth/session", (req, res) => {
  const identity = authenticate(req);
  if (!identity) return res.status(401).json({ error: "Unauthorized" });
  const sid = createSession(getBearer(req));
  if (!sid) return res.status(429).json({ error: "Too many sessions" });
  res.setHeader("Set-Cookie", sessionCookieHeader(sid));
  res.json({ ok: true, role: identity.role });
});

// POST /event — bridges only (cloud/mac). Owner intentionally excluded (SECURITY.md §2).
app.post("/event", requireAuth(["bridge"]), (req, res) => {
  if (!req.is("application/json")) {
    return res.status(415).json({ error: "Content-Type: application/json required" });
  }
  const result = bus.ingest(req.body, req.identity);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true, type: result.event.type, ts: result.event.ts });
});

// Debug — owner only
app.get("/debug/events", requireOwner, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  res.json({ events: bus.buffer.recent(limit) });
});

// Presence snapshot — GET /presence (any authenticated identity).
// MUST be registered before the static SPA catch-all below.
// Exposes lastSeenTs so the UI can render "terakhir aktif HH:MM" for away agents.
app.get("/presence", requireAny, (_req, res) => {
  const agents = {};
  for (const [agent, ts] of lastSeenTs) {
    agents[agent] = {
      lastSeenTs: ts,
      online: (lastHeartbeat.get(agent) ?? 0) >= Date.now() - 90_000,
    };
  }
  res.json({ agents, watchdogMs: 90_000 });
});

// Chat routes
app.use("/chat", createChatRouter(broadcast, emitInternal));

// GitHub feed — owner full, guest sanitized
app.get("/github/feed", requireAny, (_req, res) => {
  const events = bus.buffer.recent(200).filter((e) => e.type === "git_push");
  res.json({
    events: _req.identity?.role === "guest" ? events.map(sanitizeEventForGuest) : events,
  });
});

function sanitizeEventForGuest(ev) {
  if (ev.privat) return { type: "git_push", repo: "[private]", privat: true, source: ev.source, ts: ev.ts };
  return ev;
}

// Static frontend build (dist/) when present
const DIST = join(__dirname, "..", "frontend", "dist");
if (existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get(/^\/(?!ws$).*/, (_req, res) => res.sendFile(join(DIST, "index.html")));
} else {
  app.get("/", (_req, res) =>
    res.json({
      service: "hermes-office",
      version: "1.0",
      endpoints: ["/health", "/event", "/chat", "/roster", "/ws", "/github/feed", "/debug/events"],
    })
  );
}

// ---------------------------------------------------------------------------
// WebSocket server
// ---------------------------------------------------------------------------

const httpServer = createServer(app);

const wss = new WebSocketServer({
  server: httpServer,
  path: "/ws",
  verifyClient: (info, done) => {
    const headers = { ...info.req.headers };
    const origin = info.req.headers.origin;
    if (origin && !config.allowedOrigins.has(origin)) {
      done(false, 403, "Forbidden origin");
      return;
    }
    if (!authenticate({ headers })) {
      done(false, 401, "Unauthorized");
      return;
    }
    done(true);
  },
});

wss.on("connection", (ws, req) => {
  const authReq = { headers: req.headers };
  const identity = authenticate(authReq);
  if (!identity) {
    ws.close(1008, "Unauthorized");
    return;
  }

  const meta = {
    isGuest: identity.role === "guest",
    ip: req.socket.remoteAddress ?? "unknown",
    source: identity.source,
  };
  wsClients.set(ws, meta);

  // Handshake (EVENTS.md §7)
  ws.send(JSON.stringify(bus.hello()));

  ws.on("close", () => wsClients.delete(ws));
  ws.on("error", () => wsClients.delete(ws));
  ws.on("message", (raw) => {
    // Clients are read-only; accept only ping/pong-style messages
    try {
      const msg = JSON.parse(raw.toString());
      if (msg?.type === "ping") ws.send(JSON.stringify({ channel: "pong", data: { ts: Date.now() } }));
    } catch {}
  });
});

// ---------------------------------------------------------------------------
// Agent status heartbeat watchdog — mark agents 'away' after 90s of silence
// ---------------------------------------------------------------------------

const lastHeartbeat = new Map(); // agent -> ts
const lastSeenTs = new Map(); // agent -> ts (kept after away, for "terakhir aktif HH:MM")

bus.on("event", (ev) => {
  if (ev.type === "agent_status" && ev.agent) {
    // Watchdog-emitted 'away' events must not count as heartbeats
    // (otherwise offline agents self-revive every 30s sweep).
    if (ev.state === "away") return;
    const ts = ev.ts || Date.now();
    lastHeartbeat.set(ev.agent, ts);
    lastSeenTs.set(ev.agent, ts);
  }
});

setInterval(() => {
  const cutoff = Date.now() - 90_000;
  for (const [agent, ts] of lastHeartbeat) {
    if (ts < cutoff) {
      lastHeartbeat.delete(agent);
      emitInternal({ type: "agent_status", agent, state: "away", lastSeenTs: lastSeenTs.get(agent) });
    }
  }
}, 30_000).unref?.();

// ---------------------------------------------------------------------------
// Chat routes
// ---------------------------------------------------------------------------

const githubPoller = createGithubPoller((ev) => {
  // Internal emit — github source, bypasses bridge rate limit
  const result = bus.ingest(ev, { source: "github", role: "bridge" }, { skipRateLimit: true });
  if (!result.ok) console.error("[github] event rejected:", result.error);
});
if (config.githubToken) githubPoller.start(60_000);

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

httpServer.listen(config.port, config.host, () => {
  console.log(
    JSON.stringify({
      log: "boot",
      service: "hermes-office",
      port: config.port,
      ws: `ws://127.0.0.1:${config.port}/ws`,
      sources: ["cloud", "mac", "github", "system"],
      hermesApi: config.hermesApi,
      githubPoller: config.githubToken ? "on" : "off",
    })
  );
});

httpServer.on("error", (err) => {
  console.error("[error]", err.message);
  process.exit(1);
});

for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => {
    githubPoller.stop();
    bus.close();
    httpServer.close(() => process.exit(0));
  });
}

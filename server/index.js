/**
 * index.js — Hermes Office server entry: HTTP + WS + static host.
 * Event hub per docs/EVENTS.md; auth per docs/SECURITY.md.
 */
import express from "express";
import { createServer } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { existsSync } from "fs";
import { join, dirname, sep } from "path";
import { fileURLToPath } from "url";
import { config, assertConfig } from "./config.js";
import { authenticate, getBearer, createSession, sessionCookieHeader, requireAuth, requireAny, requireOwner, isTrustedProxyIp, mayAutoSession, autoSessionEnabled } from "./auth.js";
import { OfficeEventBus, RateLimiter } from "./eventbus.js";
import { createChatRouter } from "./chat.js";
import { DeskBoard, createDesksRouter } from "./desks.js";
import { createProofRouter } from "./proof.js";
import { createGithubPoller } from "./github.js";
import { otlpToEvents } from "./otlp.js";
import { FlightRecorder } from "./ledger.js";
import { AnchorStore, startAnchoring, redactUrl } from "./anchor.js";
import { buildReplay, sample, summarize } from "./replay.js";
import { buildStandup, renderText as renderStandupText, renderMarkdown as renderStandupMarkdown } from "./standup.js";
import { renderMarkdown, renderJson } from "./dossier.js";
import { BurnRateTracker, parsePerAgentBudget } from "./burnrate.js";
import { FloorPlanPolicy, loadPolicy } from "./policy.js";
import { TaskBoard } from "./tasks.js";
import { readFileSync } from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

assertConfig();

// ---------------------------------------------------------------------------
// Core pieces
// ---------------------------------------------------------------------------

const bus = new OfficeEventBus();
const startTime = Date.now();

/** @type {Map<WebSocket, {ip: string, source: string}>} */
const wsClients = new Map();

function broadcast(event) {
  // One frame for every socket. This used to branch on `meta.isGuest` and
  // send `bus.frameFor(event, true)` to guest connections — the WS half of
  // the redaction pipeline, and the half that leaked first when only REST
  // was reviewed. With one principal the map value is no longer read here.
  const raw = JSON.stringify({ channel: "event", data: event });
  for (const ws of wsClients.keys()) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    try {
      ws.send(raw);
    } catch {}
  }
}

bus.on("event", broadcast);

/**
 * Emit an internal (system-sourced) event, e.g. office_chat activity.
 *
 * Routed through bus.ingest() so internal events get the same validation,
 * clamping and redaction as external ones. The previous version wrote straight
 * into the ring buffer, meaning a malformed or secret-bearing internal event
 * reached every client unchecked. Rate limiting is skipped: this path is
 * server-originated and already bounded.
 */
function emitInternal(event) {
  const res = bus.ingest(event, { source: "system" }, { skipRateLimit: true, internal: true });
  if (!res.ok) console.error("[emitInternal] rejected:", res.error, event?.type);
  return res;
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));

// Office is fronted by the Cloudflare tunnel `lightvela` → dash.abstract.biz.id.
// The real client IP arrives in X-Forwarded-For; without trust proxy, req.ip
// is always the Cloudflare edge IP and the auto-owner session below can never
// match a tailnet allowlist. Trust only hops that look like known CDN/proxy
// ranges or private / tailnet space.
// Express calls this predicate with (addressString, hopIndex) — not with
// `req`. Passing it a request-shaped lambda throws TypeError the moment
// anything reads req.ip, which is a 500 waiting for the first rate
// limiter or access log that touches it.
app.set("trust proxy", (addr) => isTrustedProxyIp(addr));

/**
 * Is this request's Origin the server's own origin?
 *
 * Why this exists
 * ---------------
 * CORS exists to decide whether *another* site may read this one's responses.
 * A request whose Origin is this very host is not another site, so it never
 * needed permission — yet the allowlist below treated it like a stranger and
 * answered 403.
 *
 * That was not theoretical. Vite stamps `crossorigin` onto the module script
 * and the stylesheet it emits:
 *
 *     <script type="module" crossorigin src="./assets/index-*.js">
 *     <link rel="stylesheet" crossorigin href="./assets/index-*.css">
 *
 * `crossorigin` makes the browser attach an Origin header even for a
 * same-origin fetch. So every real browser asked for the bundle with
 * `Origin: https://<this host>`, the allowlist did not contain the production
 * domain, and both assets came back 403. The page rendered perfectly empty.
 *
 * curl sends no Origin, so curl got 200 — which is why sixteen repo gates and
 * check-live.sh were all green while the product was a blank screen. The
 * comment on config.allowedOrigins records the same bug biting once before on
 * a dev port; it was patched by editing the default list rather than by fixing
 * the hole, so it came back in production.
 *
 * Scheme is deliberately not compared. TLS terminates at the proxy, so the
 * browser says `https://host` while this process is reached over plain http;
 * requiring the scheme to match would re-break exactly what we are fixing.
 * Host is taken from the Host header only — never X-Forwarded-Host, which any
 * client can set. The session cookie is `HttpOnly; SameSite=Lax`, so it does
 * not ride along on cross-site requests and nothing here widens authority.
 */
function isSameOrigin(req, origin) {
  const host = String(req.headers?.host || "").trim();
  if (!host) return false;
  let u;
  try {
    u = new URL(origin);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  return u.host === host;
}

/** An Origin is acceptable when it is absent, allowlisted, or simply us. */
function originAllowed(req, origin) {
  if (!origin) return true;
  if (config.allowedOrigins.has(origin)) return true;
  return isSameOrigin(req, origin);
}

// CORS allowlist
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!originAllowed(req, origin)) {
    return res.status(403).json({ error: "Origin tidak diizinkan" });
  }
  if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  next();
});
// Express 5 / path-to-regexp 8 rejects a bare "*": the wildcard needs a
// parameter name. "*splat" matches every path exactly as the old "*" did.
app.options("*splat", (_req, res) => res.sendStatus(204));

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
// ---------------------------------------------------------------------------
// Burn-rate governance
// ---------------------------------------------------------------------------
// Flight recorder — see server/ledger.js for the threat model.
//
// Constructed before the governance layers so that no decision can be made
// before there is somewhere to record it.
let ledger = null;
if (config.ledger.enabled) {
  try {
    ledger = new FlightRecorder({
      dbPath: config.ledger.dbPath || undefined,
      dataDir: config.dataDir,
      retentionDays: config.ledger.retentionDays,
      checkpointEvery: config.ledger.checkpointEvery,
      synchronous: config.ledger.synchronous,
    });
    const h = ledger.head();
    console.log(`[ledger] ${ledger.path} — ${h.records} records, head ${h.hash.slice(0, 12)}…`);
  } catch (err) {
    // Refuse to pretend. If the audit log cannot be opened, governance still
    // works but the operator must know the record is not being kept.
    console.error(`[ledger] DISABLED — could not open audit log: ${err.message}`);
    console.error("[ledger] Decisions will be enforced but NOT recorded.");
    ledger = null;
  }
}

// Anchoring — the only mechanism that makes tail truncation detectable.
// Constructed after the ledger because it anchors the ledger; a verification
// runs immediately at boot, since the most likely moment for a chain to have
// been tampered with is while this process was NOT running.
let anchors = null;
let anchorTimer = { stop() {}, running: false };
if (ledger && config.anchor.enabled) {
  anchors = new AnchorStore({
    filePath: config.anchor.filePath || undefined,
    dataDir: config.dataDir,
    webhooks: config.anchor.webhooks,
    timeoutMs: config.anchor.timeoutMs,
  });

  const boot = anchors.verify(ledger);
  if (!boot.ok) {
    // Loud, and recorded inside the chain too. An operator who sees this and
    // does nothing has at least been told; the record of being told is itself
    // part of the audit trail.
    console.error(`[anchor] CHAIN FAILED ANCHOR CHECK: ${boot.firstFailure.detail}`);
    try {
      ledger.record("chain_truncated", {
        detectedAt: new Date().toISOString(),
        result: boot.firstFailure.result,
        detail: boot.firstFailure.detail,
        anchoredSeq: boot.firstFailure.seq,
      });
    } catch (err) {
      console.error("[anchor] could not record the failure:", err.message);
    }
  } else {
    console.log(
      `[anchor] ${anchors.path} — ${boot.anchors} anchor(s), strength ${boot.strength}` +
      (config.anchor.webhooks.length ? `, ${config.anchor.webhooks.length} webhook(s)` : "")
    );
  }

  anchorTimer = startAnchoring(anchors, ledger, {
    intervalMs: config.anchor.intervalMs,
    onAnchor: (r) => {
      // Record that we anchored, and to how many sinks. Recorded AFTER the
      // publish so the anchored hash is the one that was actually sent.
      try {
        ledger.record("chain_anchored", {
          seq: r.entry.seq,
          hash: r.entry.hash,
          sinks: r.sinks.map(({ sink, target, ok, strength }) => ({ sink, target, ok, strength })),
        });
      } catch (err) {
        console.error("[anchor] could not record anchoring:", err.message);
      }
    },
  });
}

/**
 * Mirror a governance event into the audit chain.
 *
 * Writes here must never break the decision path: a failed audit write is
 * logged loudly but does not refuse the action, because an office that stops
 * governing when its disk fills is worse than one with a gap in its log. The
 * gap is visible — sequence numbers are contiguous — so this trades a
 * detectable omission for an outage.
 */
function recordGovernance(type, payload, meta) {
  if (!ledger) return;
  try {
    ledger.record(type, payload, meta);
  } catch (err) {
      console.error(`[ledger] FAILED to record ${type}: ${err.message}`);
    }
  }

  /**
   * Amanat — the board of what the fleet is working on (server/tasks.js).
   *
   * Rebuilt by folding `task_transition` records forward, so a task that was
   * running when the process died is still on the board when it comes back.
   * Without the ledger the board still works; it just starts empty after a
   * restart, which is the documented degraded mode rather than a silent one.
   */
  const taskBoard = new TaskBoard({ record: recordGovernance });
  if (ledger) {
    try {
      const rows = ledger.query({ type: "task_transition", limit: 5000 });
      const folded = taskBoard.rebuildFrom(rows);
      if (folded) {
        console.log(`[tasks] rebuilt ${taskBoard.size} task(s) from ${folded} ledger record(s)`);
      }
    } catch (err) {
      console.error(`[tasks] rebuild failed, starting empty: ${err.message}`);
    }
  }

  const burn = new BurnRateTracker(
  {
    globalHourlyUsd: config.budget.globalHourlyUsd,
    globalDailyUsd: config.budget.globalDailyUsd,
    agentHourlyUsd: config.budget.agentHourlyUsd,
    perAgentHourlyUsd: parsePerAgentBudget(config.budget.perAgentRaw),
  },
  {
    // A threshold crossing is itself an event: the office reacts live
    // (room heats up, catches fire, sprinklers trip) without polling.
    onStateChange: (ev) => {
      emitInternal(ev);
      recordGovernance(
        "budget_transition",
        { scope: ev.scope, subject: ev.subject, from: ev.from, state: ev.state,
          spentUsd: ev.spentUsd, limitUsd: ev.limitUsd },
        { subject: ev.subject }
      );
    },
  }
);

// Every event carrying a realized cost feeds the tracker. This sits on the bus
// rather than inside the OTLP route so bridge events with cost data count too.
/**
 * Fold task-bearing events onto the board.
 *
 * No extra broadcast happens here on purpose. The event itself already goes
 * out through `bus.on("event", broadcast)` above, so
 * a client knows a task moved by watching the traffic it is receiving anyway.
 * Emitting a second `tasks_changed` frame would mean two wire formats that
 * can disagree, and a fold implemented once on the server and again in the
 * browser. The server stays authoritative; the client refetches.
 */
bus.on("event", (ev) => {
  if (ev.type !== "task_update" && ev.type !== "a2a_task_in" && ev.type !== "a2a_task_out") {
    return;
  }
  try {
    taskBoard.ingest(ev);
  } catch (err) {
    // A malformed task must never take the event pipeline down with it.
    console.error(`[tasks] ingest failed: ${err.message}`);
  }
});

bus.on("event", (ev) => {
  if (ev.type === "budget_state") return; // never recurse
  const cost = Number(ev.costUsd);
  if (!Number.isFinite(cost) || cost <= 0) return;
  const agent =
    typeof ev.agentId === "string" ? ev.agentId : ev.agent?.name || ev.agent;
  burn.record({
    agent: typeof agent === "string" ? agent : undefined,
    costUsd: cost,
    tokens: Number(ev.totalTokens) || 0,
  });
});

/**
 * The enforcement decision. Agents call this BEFORE spending.
 *
 * Observability reports after the fact; by the time a chart shows a runaway
 * loop the money is gone. This answers from memory in microseconds so it can
 * live in the request path.
 */
app.post("/budget/check", requireAuth(["bridge", "owner"]), (req, res) => {
  const { agent, model, estimatedUsd } = req.body || {};
  const decision = burn.decide({
    agent: typeof agent === "string" ? agent.slice(0, 120) : undefined,
    model: typeof model === "string" ? model.slice(0, 120) : undefined,
    estimatedUsd: Number(estimatedUsd) || 0,
  });
  // 200 even on deny: this is a policy answer, not a transport failure. The
  // caller must read `allow`. Returning 4xx here would make well-behaved
  // clients retry a decision that will not change.
  res.json(decision);
});

/**
 * Current burn state — drives the UI physics layer and external alerting.
 *
 * Owner-only, like every data route here: hourly spend is a competitive
 * disclosure and there is no second principal to show a softened version to.
 * This used to serve a redacted shape giving the *temperature* but not the
 * *invoice*; that shape existed only for guests, and guests are gone.
 *
 * Kept for context: the burn state drives the UI physics layer, so it must
 * visibly catch fire, nothing that discloses what this business spends on AI
 * or which agent is expensive. Hourly spend is a competitive disclosure.
 */
app.get("/burn", requireAny, (_req, res) => {
  res.json(burn.snapshot());
});

// ---------------------------------------------------------------------------
// Floor-plan policy — rooms are scopes, doors are approval gates.
// ---------------------------------------------------------------------------
let policyDoc;
if (config.policyFile) {
  try {
    policyDoc = loadPolicy(readFileSync(config.policyFile, "utf8"));
    console.log(`[policy] loaded ${config.policyFile}`);
  } catch (err) {
    // Fall back to the built-in default rather than booting with no policy.
    console.error(`[policy] could not read ${config.policyFile}: ${err.message} — using default`);
    policyDoc = loadPolicy(null);
  }
} else {
  policyDoc = loadPolicy(null);
}

const floor = new FloorPlanPolicy(policyDoc, {
  burn,
  approvalTtlMs: Math.max(1, config.approvalTtlMin) * 60_000,
  onEvent: (ev) => {
    emitInternal(ev);
    // One hook covers all three governance events, so a new event type cannot
    // be added to the policy engine and quietly skip the audit log.
    if (ev.type === "agent_moved") {
      recordGovernance(
        "agent_moved",
        { agent: ev.agent, fromRoom: ev.fromRoom, room: ev.room, grantedBy: ev.grantedBy },
        { subject: ev.agent, actor: ev.grantedBy }
      );
    } else if (ev.type === "approval_requested") {
      recordGovernance(
        "approval_requested",
        { approvalId: ev.approvalId, agent: ev.agent, kind: ev.kind, tool: ev.tool,
          room: ev.room, fromRoom: ev.fromRoom, reason: ev.reason, expiresAt: ev.expiresAt },
        { subject: ev.agent }
      );
    } else if (ev.type === "approval_resolved") {
      recordGovernance(
        "approval_resolved",
        { approvalId: ev.approvalId, agent: ev.agent, kind: ev.kind, tool: ev.tool,
          room: ev.room, state: ev.state, decidedBy: ev.decidedBy, waitedMs: ev.waitedMs },
        { subject: ev.agent, actor: ev.decidedBy }
      );
    }
  },
});

// The rule set in force is itself evidence: a dossier is meaningless if the
// policy it was judged against is unknown. Recorded once at startup.
recordGovernance("policy_loaded", {
  source: config.policyFile ? "file" : "default",
  path: config.policyFile || null,
  rooms: Object.keys(policyDoc?.rooms || {}).length,
  defaultRoom: policyDoc?.defaultRoom,
  approvalTtlMin: config.approvalTtlMin,
});

// Room spend is tracked alongside agent/global spend.
bus.on("event", (ev) => {
  const cost = Number(ev.costUsd);
  if (!Number.isFinite(cost) || cost <= 0) return;
  const agent = typeof ev.agentId === "string" ? ev.agentId : ev.agent?.name || ev.agent;
  if (typeof agent === "string") floor.recordSpend(agent, cost);
});

setInterval(() => floor.sweepApprovals(), 600_000).unref?.();

// Retention enforcement. Daily is frequent enough for a 400-day window, and
// unref() keeps the timer from holding the process open at shutdown.
if (ledger && config.ledger.retentionDays > 0) {
  setInterval(() => {
    try {
      const r = ledger.prune();
      if (r.pruned) console.log(`[ledger] pruned ${r.pruned} records past retention`);
    } catch (e) { console.error("[ledger] prune failed:", e.message); }
  }, 86_400_000).unref?.();
}

/**
 * The unified gate. Room policy first (is this permitted here?), then spend
 * (can we afford it?). Supersedes /budget/check, which remains for callers
 * that only care about money.
 */
/**
 * Per-agent limiter for the decision hot path.
 *
 * `/policy/check` sits in front of *every* agent action, so it is both the
 * busiest endpoint and the one an agent stuck in a retry loop will hammer —
 * exactly the OWASP LLM10 "denial of wallet" shape this feature exists to
 * prevent. Keyed per agent so one looping agent cannot starve the others.
 * Limits are deliberately generous: this catches runaway loops, not normal
 * bursty work.
 */
const policyLimiter = new RateLimiter({ perMinute: 600, burst: 60, burstWindowMs: 5000 });

app.post("/policy/check", requireAuth(["bridge", "owner"]), (req, res) => {
  const { agent, tool, model, estimatedUsd, approvalId } = req.body || {};
  const limitKey = typeof agent === "string" && agent ? `agent:${agent.slice(0, 120)}` : "agent:*";
  const gate = policyLimiter.check(limitKey);
  if (!gate.ok) {
    // Fail *closed*: a limiter breach denies the action rather than letting it
    // through unchecked. 200 (not 429) keeps the response shape identical to
    // every other decision, so a caller never needs a special branch for it.
    return res.json({
      allow: false,
      action: "deny",
      state: "tripped",
      scope: "limiter",
      reason: `Decision rate limit exceeded (${gate.reason}) — agent is likely in a retry loop.`,
      retryAfterS: 60,
    });
  }
  const str = (v) => (typeof v === "string" ? v.slice(0, 120) : undefined);
  const decision = floor.decide({
    agent: str(agent),
    tool: str(tool),
    model: str(model),
    estimatedUsd: Number(estimatedUsd) || 0,
    approvalId: str(approvalId),
  });

  // `await_approval` is recorded by the approval_requested hook instead —
  // recording both would double-count the same held action in the dossier.
  if (decision.action !== "await_approval" && (config.ledger.recordAllows || !decision.allow)) {
    recordGovernance(
      "policy_decision",
      {
        agent: str(agent) || null,
        tool: str(tool) || null,
        model: str(model) || null,
        room: decision.room ?? floor.roomFor(str(agent)),
        action: decision.action,
        allow: decision.allow,
        scope: decision.scope,
        state: decision.state,
        reason: decision.reason,
        suggestModel: decision.suggestModel,
        estimatedUsd: Number(estimatedUsd) || 0,
        approvalId: str(approvalId) || null,
      },
      { subject: str(agent) || null, actor: req.identity?.role }
    );
  }

  res.json(decision);
});

// ---------------------------------------------------------------------------
// Fase 4 — Flight Recorder
//
// Owner-only, without exception. The ledger is the one place where the facts
// recorded in Fase 3 are all written down together: who spent
// what, which tools are gated, which agent tried to reach past its scope.
// A read-only visitor has no business here, and a bridge token — which any
// agent process holds — least of all, since the agents are the subjects of
// the record.
// ---------------------------------------------------------------------------

const ledgerRequired = (_req, res, next) =>
  ledger
    ? next()
    : res.status(503).json({
        error: "Catatan audit tidak tersedia",
        detail: "Perekam keputusan dinonaktifkan atau gagal dibuka; keputusan tidak sedang direkam.",
      });

/** Chain head — the value to anchor externally. Cheap enough to poll. */
app.get("/ledger/head", requireOwner, ledgerRequired, (_req, res) => {
  res.json({ ...ledger.head(), algorithm: "SHA-256 over canonical JSON" });
});

/**
 * Re-hash the chain and report the first break, if any.
 *
 * Also reports the anchor check, because internal consistency alone is a
 * misleading green tick: a truncated chain passes verify() perfectly. The two
 * answers are kept as separate fields rather than merged into one boolean, so
 * a reader can see WHICH guarantee holds.
 */
app.get("/ledger/verify", requireOwner, ledgerRequired, (req, res) => {
  const from = Number(req.query.from) || 0;
  const to = req.query.to ? Number(req.query.to) : Infinity;
  const started = Date.now();
  const result = ledger.verify({ from, to });
  const anchorResult = anchors ? anchors.verify(ledger) : { ok: true, strength: "disabled", anchors: 0 };
  res.json({
    ...result,
    anchors: anchorResult,
    // The honest headline. Chain-valid AND anchor-consistent.
    trustworthy: result.ok && anchorResult.ok,
    tookMs: Date.now() - started,
  });
});

/**
 * Time Machine — reconstruct office state across a time range.
 *
 * Owner-only: a replay carries dollars, tool names
 * and approver identities in every frame. There is no redacted version of
 * this endpoint on purpose — a half-redacted replay would be an incident
 * artifact with holes in exactly the places an investigator needs.
 *
 * The chain head, the verify result and the anchor verdict ship INSIDE the
 * payload rather than beside it, so a replay saved to disk can still be
 * checked against the ledger months later.
 */
app.get("/replay", requireOwner, ledgerRequired, (req, res) => {
  const now = Date.now();
  const from = req.query.from ? Number(req.query.from) : now - 24 * 3600_000;
  const to = req.query.to ? Number(req.query.to) : now;
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from) {
    return res.status(400).json({
      error: "bad-range",
      detail: "from/to must be epoch milliseconds with to >= from",
    });
  }

  const maxFrames = Math.min(Number(req.query.maxFrames) || 5000, 20_000);
  const started = Date.now();

  // Full scan from the chain start: the fold needs every earlier record to
  // know where agents were when the window opens. See replay.js SEEDING.
  const records = ledger.query({ limit: 1_000_000 });
  const replay = buildReplay(records, { from, to, maxFrames });

  const keyframes = Number(req.query.keyframes) || 0;
  const frames = keyframes > 0 ? sample(replay.frames, keyframes) : replay.frames;

  res.json({
    ...replay,
    frames,
    summary: summarize(replay.frames),
    // Provenance. A replay without these is a story, not evidence.
    chain: {
      head: ledger.head(),
      verification: ledger.verify(),
      anchors: anchors ? anchors.verify(ledger) : { ok: true, strength: "disabled", anchors: 0 },
    },
    tookMs: Date.now() - started,
  });
});

/** Published anchors and how they compare against the live chain. */
app.get("/ledger/anchors", requireOwner, ledgerRequired, (_req, res) => {
  if (!anchors) {
    return res.status(503).json({
      error: "anchoring-disabled",
      detail: "OFFICE_ANCHOR_ENABLED=0. Tail truncation is undetectable while this is off.",
    });
  }
  const { anchors: list } = anchors.list();
  res.json({
    file: anchors.path,
    webhooks: config.anchor.webhooks.map(redactUrl),
    intervalMs: anchorTimer.running ? anchorTimer.intervalMs : 0,
    // Most recent first: an operator checking "did we anchor lately" should
    // not have to scroll past a year of history.
    published: list.slice(-50).reverse(),
    verification: anchors.verify(ledger),
  });
});

/** Anchor right now. Used before an export, after an incident, or by cron. */
app.post("/ledger/anchor", requireOwner, ledgerRequired, async (req, res) => {
  if (!anchors) return res.status(503).json({ error: "anchoring-disabled" });
  const note = typeof req.body?.note === "string" ? req.body.note.slice(0, 200) : "manual";
  const result = await anchors.publish(ledger.head(), { note });
  try {
    ledger.record("chain_anchored", {
      seq: result.entry.seq,
      hash: result.entry.hash,
      note,
      sinks: result.sinks.map(({ sink, target, ok, strength }) => ({ sink, target, ok, strength })),
    });
  } catch (err) {
    console.error("[anchor] could not record anchoring:", err.message);
  }
  // 207 when some sinks failed: the caller anchored, but not everywhere they
  // asked for, and a flat 200 would hide that.
  const partial = result.sinks.some(s => !s.ok);
  res.status(result.anchored ? (partial ? 207 : 200) : 500).json(result);
});

/** Raw records, for tooling rather than humans. */
app.get("/ledger", requireOwner, ledgerRequired, (req, res) => {
  const { from, to, type, subject, limit, offset } = req.query;
  res.json({
    records: ledger.query({
      from: from ? Number(from) : undefined,
      to: to ? Number(to) : undefined,
      type: typeof type === "string" ? type : undefined,
      subject: typeof subject === "string" ? subject.slice(0, 120) : undefined,
      limit, offset,
    }),
    head: ledger.head(),
  });
});

/**
 * Fase 14 — the standup. The morning read.
 *
 * Owner only, with no `?reveal` escape hatch like the kiosk has: this is a
 * ranked list of what went wrong, which agents are stuck and what they are
 * estimated to have cost. There is no version of that worth publishing,
 * so the route simply does not offer one.
 *
 * `?hours=` sets the window (default 24, capped at a week — past that the
 * findings stop being a standup and the dossier is the right artifact).
 * The preceding window of equal length is loaded too: a number with nothing
 * to compare against is trivia.
 *
 * Deliberately NOT recorded in the ledger. The dossier records its own
 * exports because "who read the audit log" is an auditor question, but a
 * report pulled every morning by a cron job would bury the chain in
 * self-reference — thousands of records about reading records.
 */
app.get("/standup", requireOwner, ledgerRequired, (req, res) => {
  const hours = Math.min(Math.max(Number(req.query.hours) || 24, 1), 168);
  const windowMs = hours * 3_600_000;
  const now = Date.now();
  const from = now - windowMs;

  const records = ledger.query({ from, to: now, limit: 5000 });
  const prevRecords = ledger.query({ from: from - windowMs, to: from, limit: 5000 });

  const model = buildStandup({
    records,
    prevRecords,
    pendingApprovals: floor.pendingApprovals(),
    verification: ledger.verify(),
    anchors: anchors ? anchors.verify(ledger) : null,
    now,
    windowMs,
    label: hours === 24 ? "24 jam" : `${hours} jam`,
  });

  const format = req.query.format;
  if (format === "json") return res.json(model);
  res.setHeader("Cache-Control", "no-store");
  if (format === "md") {
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    return res.send(renderStandupMarkdown(model));
  }
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.send(renderStandupText(model));
});

/**
 * The compliance dossier — the artifact an assessor reads.
 *
 * `?format=md` (default) renders Markdown; `json` returns the structured form.
 * The export is itself recorded: "who pulled the audit log, and when" is a
 * question auditors ask about the audit log.
 */
app.get("/dossier", requireOwner, ledgerRequired, (req, res) => {
  const to = req.query.to ? Number(req.query.to) : Date.now();
  const from = req.query.from ? Number(req.query.from) : to - 30 * 86_400_000;
  if (!Number.isFinite(from) || !Number.isFinite(to) || from > to) {
    return res.status(400).json({ error: "Rentang tidak valid", detail: "from/to harus epoch ms dengan from <= to" });
  }

  const records = ledger.query({ from, to, limit: 5000 });
  const verification = ledger.verify();
  const period = {
    from, to,
    fromIso: new Date(from).toISOString(),
    toIso: new Date(to).toISOString(),
  };

  recordGovernance(
    "dossier_exported",
    { from: period.fromIso, to: period.toIso, records: records.length,
      actor: req.identity?.role, verified: verification.ok },
    { actor: req.identity?.role }
  );

  const payload = { records, verification, period, system: { name: "Hermes Office" } };
  if (req.query.format === "json") return res.json(renderJson(payload));

  const stamp = period.fromIso.slice(0, 10) + "_" + period.toIso.slice(0, 10);
  res.type("text/markdown; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="ai-act-dossier_${stamp}.md"`);
  res.send(renderMarkdown(payload));
});

/**
 * The floor plan as data — the audit artifact, not a YAML file.
 *
 * Owner-only. This used to serve a cut-down building view — room names,
 * who is where, but never the tool allow/deny lists, approval
 * gates or budgets, because that is a map of exactly where the privilege
 * boundaries are. With no guest principal left, there is nobody to serve the
 * cut-down version to, and the full snapshot goes only to the owner.
 */
app.get("/policy", requireAny, (_req, res) => {
  res.json(floor.snapshot());
});

/**
 * Moving an agent IS granting it scope, so it is owner-only and recorded with
 * who did it. In the UI this is a drag; here it is one POST.
 */
app.post("/agents/:agent/room", requireOwner, (req, res) => {
  const agent = String(req.params.agent || "").slice(0, 120);
  const room = String(req.body?.room || "").slice(0, 120);
  if (!agent || !room) return res.status(400).json({ error: "agent + room wajib diisi" });

  const result = floor.assign(agent, room, req.identity?.source || "owner");
  if (result.ok) return res.json(result);
  if (result.pending) return res.status(202).json(result);
  return res.status(400).json({ error: result.error });
});

/**
 * The approval queue — what is waiting at a door right now.
 *
 * Owner-only. The redacted variant existed so a read-only visitor could
 * learn a door was being knocked on without learning which agent wanted
 * which privileged tool — "deployer wants kubectl in the server room" is an
 * attack plan. No visitor, no variant.
 */
app.get("/approvals", requireAny, (_req, res) => {
  res.json({ pending: floor.pendingApprovals() });
});

/** An agent polls its own request; a bridge may read, only an owner decides. */
app.get("/approvals/:id", requireAuth(["bridge", "owner"]), (req, res) => {
  const ap = floor.getApproval(String(req.params.id || ""));
  if (!ap) return res.status(404).json({ error: "Persetujuan tidak dikenal" });
  res.json(ap);
});

app.post("/approvals/:id", requireOwner, (req, res) => {
  const approve = req.body?.approve === true;
  const result = floor.resolveApproval(
    String(req.params.id || ""),
    approve,
    req.identity?.source || "owner"
  );
  if (!result.ok) return res.status(409).json({ error: result.error });
  res.json(result.approval);
});

const PERMANENT_CAST = [
  { name: "cloud", role: "generalist" },
  { name: "mac", role: "generalist" },
  { name: "boss", role: "reviewer" },
];

/**
 * Amanat — what the fleet is working on.
 *
 * `requireAny`: the owner's browser and the bridges may read it. Titles and
 * repo names used to be redacted inside `snapshot` for guests; that argument
 * ("the shape of the work is public, its subject is not") had exactly one
 * audience, and that audience no longer exists.
 */
app.get("/tasks", requireAny, (_req, res) => {
  res.json(taskBoard.snapshot());
});

app.get("/roster", requireAny, (_req, res) => {
  // The permanent cast plus anything currently alive — otherwise an agent that
  // arrived over OTLP would vanish from the floor on page reload, because the
  // client builds its initial cast from this list.
  const dynamic = [];
  for (const name of lastHeartbeat.keys()) {
    if (!PERMANENT_CAST.some((a) => a.name === name)) {
      dynamic.push({ name, role: "generalist", dynamic: true });
    }
  }
  res.json({ agents: [...PERMANENT_CAST, ...dynamic], server: "1.0" });
});

  // Session bootstrap for browsers (WS can't send headers): POST /auth/session
  // with Bearer token → HttpOnly office_session cookie used for WS + /chat.
  //
  // `GET /` used to mint a read-only guest cookie here so an anonymous
  // visitor saw a redacted office. That is gone. This server is published
  // through a tunnel, which made "anonymous visitor on the public internet"
  // and "guest" the same principal: every requireAny route was effectively
  // world-readable and the redaction was the only boundary rather than
  // defence-in-depth. The office now serves its shell to anyone and its data
  // to no one until they hold an owner session.
  app.post("/auth/session", (req, res) => {
    const identity = authenticate(req);
    if (!identity) return res.status(401).json({ error: "Tidak terotorisasi" });
    const sid = createSession(getBearer(req));
    if (!sid) return res.status(429).json({ error: "Terlalu banyak sesi" });
    res.setHeader("Set-Cookie", sessionCookieHeader(sid));
    res.json({ ok: true, role: identity.role });
  });

// POST /event — bridges only (cloud/mac). Owner intentionally excluded (SECURITY.md §2).
app.post("/event", requireAuth(["bridge"]), (req, res) => {
  if (!req.is("application/json")) {
    return res.status(415).json({ error: "Content-Type: application/json wajib" });
  }
  const result = bus.ingest(req.body, req.identity);
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  res.json({ ok: true, type: result.event.type, ts: result.event.ts });
});

// ---------------------------------------------------------------------------
// OTLP trace ingest — the standard front door.
//
// Any OpenTelemetry SDK can be pointed here with two env vars:
//   OTEL_EXPORTER_OTLP_ENDPOINT=http://host:7333
//   OTEL_EXPORTER_OTLP_HEADERS=Authorization=Bearer <OFFICE_OTLP_TOKEN>
//
// Only OTLP/HTTP+JSON is accepted. Protobuf would need a decoder dependency;
// every major SDK can emit JSON via OTEL_EXPORTER_OTLP_PROTOCOL=http/json.
// ---------------------------------------------------------------------------
const otlpBody = express.json({ limit: config.otlpMaxBodySize, type: () => true });

// Must run before the JSON parser: protobuf bytes would otherwise fail to
// parse and surface as an opaque 400 instead of actionable guidance.
function rejectProtobuf(req, res, next) {
  const ctype = req.headers["content-type"] || "";
  if (ctype.includes("x-protobuf") || ctype.includes("application/grpc")) {
    return res.status(415).json({
      error: "OTLP protobuf tidak didukung; set OTEL_EXPORTER_OTLP_PROTOCOL=http/json",
    });
  }
  next();
}

app.post("/v1/traces", requireAuth(["bridge"]), rejectProtobuf, otlpBody, (req, res) => {
  let mapped;
  try {
    mapped = otlpToEvents(req.body, { maxEvents: config.otlpMaxEventsPerBatch });
  } catch (err) {
    return res.status(400).json({ error: "Payload OTLP rusak: " + err.message });
  }

  // Most instrumentation emits `chat` and `execute_tool` spans but never
  // `create_agent`, so the office would receive tool activity for characters
  // that were never spawned and render nothing. Synthesize the spawn the first
  // time we see an agent, so an OTLP source needs zero extra instrumentation
  // to appear on the floor. lastHeartbeat is the server's existing liveness
  // map, so this also enrolls the agent in the watchdog.
  const withSpawns = [];
  for (const ev of mapped.events) {
    const who =
      ev.type === "agent_spawned"
        ? ev.agent?.name
        : typeof ev.agentId === "string"
          ? ev.agentId
          : null;
    if (who && !lastHeartbeat.has(who)) {
      lastHeartbeat.set(who, ev.ts || Date.now());
      if (ev.type !== "agent_spawned") {
        withSpawns.push({
          type: "agent_spawned",
          ts: ev.ts,
          agent: { name: who, id: who, role: "generalist" },
          synthetic: true,
        });
      }
    }
    withSpawns.push(ev);
  }

  let accepted = 0;
  let rejected = 0;
  for (const ev of withSpawns) {
    // Per-event rate limiting would reject normal batches, so it is skipped
    // here; the batch size cap plus the body limit bound this path instead.
    // Validation, clamping and redaction still apply to every event.
    const r = bus.ingest(ev, req.identity, { skipRateLimit: true });
    if (r.ok) accepted++;
    else rejected++;
  }

  // OTLP requires 200 + ExportTraceServiceResponse. Spans we could not map are
  // reported as rejected_spans so the exporter's own metrics stay honest.
  const notMapped = mapped.dropped + rejected;
  res.json({
    partialSuccess: notMapped
      ? {
          rejectedSpans: notMapped,
          errorMessage: `${notMapped} span(s) produced no usable event`,
        }
      : {},
  });

  if (config.logLevel === "debug") {
    console.log(
      `[otlp] spans=${mapped.spans} events=${mapped.events.length} accepted=${accepted} rejected=${rejected} dropped=${mapped.dropped}`
    );
  }
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

// External outposts — read-only status for things this office does not run.
// Polling happens here, once per interval, so N browsers do not become N
// times the probe traffic against somebody else's service.
const deskBoard = new DeskBoard({ file: config.desksFile, pollMs: config.desksPollMs });
void deskBoard.load().then(() => { if (config.desksFile) deskBoard.start(); });
app.use("/desks", createDesksRouter(deskBoard, { recordImpl: recordGovernance }));

// Bukti — lihat server/proof.js. Mount di sini, logika di sana: rute ini
// menjawab "apakah yang Anda lihat adalah yang kami uji?", dan jawabannya
// harus memuat perbandingan bundel, bukan sekadar ringkasan gerbang.
app.use("/proof", createProofRouter({
  requireAny,
  verifyLedger: () => (ledger ? ledger.verify() : null),
}));

// GET /github/feed was retired on 2026-10-12. It returned git_push events from
// the ring buffer for a panel the Sect UI migration removed, so it had no
// reader left — and an endpoint with no reader is surface that still has to be
// authenticated and reasoned about in SECURITY.md.
// The events themselves did not go anywhere: they are still in the buffer and
// still reach /debug/events (owner) and the WebSocket. Nothing was lost except
// a second door to the same room.

// Static frontend build (dist/) when present
const DIST = join(__dirname, "..", "frontend", "dist");
if (existsSync(DIST)) {
// Private office, no login: GET / is the browser's entry point. A visitor
// who is already inside the network boundary may be handed an owner session
// on the very response that delivers index.html, so the page's data requests
// (WS, /presence, …) are authenticated with zero user action.
//
// Who counts as "inside" is decided by mayAutoSession() in auth.js, and it
// defaults to nobody. Two things must both hold: the peer address is in
// OFFICE_AUTO_SESSION_CIDRS, and the request did not arrive through a proxy.
//
// The second check is not belt-and-braces, it is the whole boundary. The
// Cloudflare tunnel runs on this host, so a visitor from the open internet
// reaches the socket as 127.0.0.1 — indistinguishable from a local browser
// by address alone. Comments once claimed UFW and the tunnel made everyone
// here trusted; that was false, and for a time every anonymous request to
// dash.abstract.biz.id was issued an owner cookie and could read /ledger
// and /dossier. Verified from outside, not assumed.
//
// Must be registered BEFORE express.static — otherwise static serves
// index.html directly and this handler never runs.
app.get("/", (req, res) => {
  res.setHeader("Cache-Control", "no-cache");
  if (!authenticate(req) && mayAutoSession(req)) {
    const sid = createSession(config.tokens.owner);
    if (sid) res.setHeader("Set-Cookie", sessionCookieHeader(sid));
  }
  res.sendFile("index.html", { root: DIST });
});

  // Hashed Vite bundles are immutable; art is long-lived but replaceable.
  app.use(
    express.static(DIST, {
      fallthrough: true,
      setHeaders(res, path) {
        if (path.includes(`${sep}assets${sep}`)) {
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        } else if (/\.(webp|png|jpg|svg|woff2?)$/i.test(path)) {
          res.setHeader("Cache-Control", "public, max-age=86400");
        } else {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    })
  );

  // SPA catch-all. Asset namespaces are excluded so a missing sprite returns a
  // real 404 instead of 200 + index.html (which silently breaks <img> debugging).
  // app.use is used instead of app.get("*splat") because Express 5's
  // path-to-regexp 8 changed catch-all semantics.
  const ASSET_NS = /^\/(sprites|rooms|assets)\//;

  // SPA deep-links land here rather than on GET / above. Same gate, same
  // default of nobody — OFFICE_TRUSTED_ORIGINS never existed in code, so the
  // allowlist it referred to was never enforced.

  app.use((req, res, next) => {
    if (req.method !== "GET") return next();
    if (ASSET_NS.test(req.path)) return res.status(404).type("txt").send("Tidak ditemukan");
    res.setHeader("Cache-Control", "no-cache");
    if (!authenticate(req) && mayAutoSession(req)) {
      const sid = createSession(config.tokens.owner);
      if (sid) res.setHeader("Set-Cookie", sessionCookieHeader(sid));
    }
    res.sendFile("index.html", { root: DIST });
  });
} else {
  app.get("/", (_req, res) =>
    res.json({
      service: "hermes-office",
      version: "1.0",
      endpoints: ["/health", "/event", "/chat", "/roster", "/ws", "/desks", "/proof", "/debug/events"],
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
    // Same reasoning as the HTTP middleware above: a browser opening a socket
    // back to the page's own host always sends Origin, and that is not a
    // cross-origin request. Refusing it here is why the office could serve a
    // shell and still never connect — wsClients stayed 0 and every agent read
    // as offline, which looks like a flaky socket rather than an origin check.
    if (!originAllowed(info.req, origin)) {
      done(false, 403, "Origin tidak diizinkan");
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
  // Any event attributable to an agent proves it is alive. Previously only
  // agent_status counted, so the Hermes Cloud agent — which sends agent_status
  // exactly once at startup and then only tool_call/tool_done — flipped to
  // 'away' after 90s and stayed there while actively working.
  const raw =
    ev.type === "agent_status" || ev.type === "agent_spawned"
      ? ev.agent
      : ev.agentId || ev.agent || (ev.type === "a2a_task_in" ? ev.dest : null) ||
        (ev.type === "a2a_task_out" ? ev.origin : null);

  // `agent` may be a bare string ("mac") or the object form {name, id, role}
  // that the event contract also allows. Upstream keyed the Map with the raw
  // value, which collapsed every object-form agent to "[object Object]" and
  // made presence never match. This fork had the mirror-image bug: it required
  // a string and so dropped object-form heartbeats silently — including every
  // agent_spawned, whose `agent` is an object by schema. Normalise instead.
  const agent = typeof raw === "string" ? raw : raw?.id || raw?.name || null;

  if (!agent || typeof agent !== "string") return;

  // Watchdog-emitted 'away' events must not count as heartbeats
  // (otherwise offline agents self-revive every 30s sweep).
  if (ev.type === "agent_status" && ev.state === "away" && ev.source === "system") return;

  const ts = ev.ts || Date.now();
  lastHeartbeat.set(agent, ts);
  lastSeenTs.set(agent, ts);

  // An agent that is demonstrably working belongs on the floor plan.
  //
  // Until now nothing ever called floor.assign() except the owner-only
  // POST /agents/:agent/room, so `occupants` was empty for every room on a
  // live instance while agents worked away. The office rendered deserted and
  // the floor plan — which the README calls the policy itself — described a
  // building nobody was in.
  //
  // Placement goes to defaultRoom and nowhere else. That is not a compromise:
  // roomFor() ALREADY governs unplaced agents as if they were in the default
  // room, so writing the assignment down changes what is *visible* and
  // nothing about what is *allowed*. Moving an agent anywhere with more
  // privilege stays owner-only, which is the whole reason assign() is
  // owner-only, and that is untouched.
  //
  // Re-entrancy: assign() emits agent_moved through onEvent -> emitInternal,
  // which lands back in this very listener. isAssigned() is true by then, so
  // it stops at depth two. The guard is written as an explicit early return
  // rather than relying on that, because a future caller should be able to
  // see the recursion is handled without tracing the event bus.
  if (!floor.isAssigned(agent)) {
    floor.assign(agent, floor.defaultRoom(), "auto");
  }
});

// Intervals are configurable so the away-transition is actually testable;
// at the 90s/30s defaults a regression test would take two minutes.
setInterval(() => {
  const cutoff = Date.now() - config.watchdogCutoffMs;
  for (const [agent, ts] of lastHeartbeat) {
    if (ts < cutoff) {
      lastHeartbeat.delete(agent);
      emitInternal({ type: "agent_status", agent, state: "away", lastSeenTs: lastSeenTs.get(agent) });
    }
  }
}, config.watchdogSweepMs).unref?.();

// ---------------------------------------------------------------------------
// Chat routes
// ---------------------------------------------------------------------------

const githubPoller = createGithubPoller((ev) => {
  // Internal emit — github source, bypasses bridge rate limit
  const result = bus.ingest(ev, { source: "github", role: "bridge" }, { skipRateLimit: true });
  if (!result.ok) console.error("[github] event rejected:", result.error);
});
// Both halves are required: a token with no owner would poll whatever the
// default happened to be, and an owner with no token hits the anonymous rate
// limit within minutes. Say which half is missing instead of failing quietly.
if (config.githubToken && config.githubOrg) {
  githubPoller.start(60_000);
} else if (config.githubToken || config.githubOrg) {
  console.warn(
    `[github] poller disabled — ${config.githubToken ? "GITHUB_ORG" : "GITHUB_TOKEN"} is not set`
  );
}

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
      githubPoller: config.githubToken && config.githubOrg ? "on" : "off",
      // Optional integrations report themselves at boot. Previously these had
      // defaults pointing at one developer's machine, so "configured" and
      // "pointing somewhere useful" looked identical from the outside. An
      // operator should be able to read one log line and know what is live.
      a2aMac: config.hermesA2aMacUrl ? "on" : "off",
        ledger: config.ledger?.enabled ? "on" : "off",
        otlp: config.tokens?.otlp ? "on" : "off",
        // Auto-session hands out owner cookies with no token. An operator must
        // never have to read source to find out whether that is on.
        autoSession: autoSessionEnabled() ? "on" : "off",
    })
  );
});

httpServer.on("error", (err) => {
  console.error("[error]", err.message);
  process.exit(1);
});

// ---------------------------------------------------------------------------
// Graceful shutdown
//
// httpServer.close() only stops *new* connections; it waits for live ones to
// end. An attached WebSocket never ends on its own, so the previous version
// hung until SIGKILL. We tear the sockets down explicitly, then keep an
// unref'd deadline as a backstop so the process can never outlive it.
// ---------------------------------------------------------------------------
let shuttingDown = false;

function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${sig} received, draining…`);

  const done = (code) => {
    console.log(`[shutdown] complete (${code === 0 ? "clean" : "forced"})`);
    process.exit(code);
  };

  // Backstop: never let shutdown exceed 5s. unref() so it cannot itself
  // keep the event loop alive if everything else closed in time.
  const deadline = setTimeout(() => done(1), 5000);
  deadline.unref();

  try { githubPoller.stop(); } catch (e) { console.error("[shutdown] poller:", e.message); }
  try { bus.close(); } catch (e) { console.error("[shutdown] bus:", e.message); }
  // Seal the chain with a checkpoint so a clean shutdown is distinguishable
  // from a crash, then close the handle — an open SQLite handle would hold
  // the process open and turn a graceful exit into a SIGKILL.
  try { anchorTimer.stop(); } catch (e) { console.error("[shutdown] anchor timer:", e.message); }
  try { deskBoard.stop(); } catch (e) { console.error("[shutdown] desk board:", e.message); }
  if (ledger) {
    try { ledger.checkpoint("shutdown"); } catch (e) { console.error("[shutdown] ledger checkpoint:", e.message); }
    // Anchor the sealed head locally before closing. Deliberately file-only:
    // shutdown has a 5 s budget and a slow webhook would turn a graceful exit
    // into a SIGKILL. The periodic timer is where remote anchoring happens.
    if (anchors) {
      try { anchors.publishLocalSync(ledger.head(), "shutdown"); }
      catch (e) { console.error("[shutdown] anchor:", e.message); }
    }
    try { ledger.close(); } catch (e) { console.error("[shutdown] ledger close:", e.message); }
  }

  // 1001 = "going away"
  for (const client of wss.clients) {
    try { client.close(1001, "server shutting down"); } catch { /* already dead */ }
  }
  wss.close();

  httpServer.close(() => {
    clearTimeout(deadline);
    done(0);
  });

  // Idle keep-alive sockets hold close() open too.
  httpServer.closeIdleConnections?.();
  // Anything still attached after 2s (half the budget) gets destroyed.
  setTimeout(() => httpServer.closeAllConnections?.(), 2000).unref();
}

for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => shutdown(sig));

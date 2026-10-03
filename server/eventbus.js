/**
 * eventbus.js — validation, clamping, redaction, rate limiting, ring buffer,
 * guest sanitization. Implements docs/EVENTS.md contract.
 * Changes here MUST be mirrored in tests/contract tests.
 */
import { EventEmitter } from "events";

// ---------------------------------------------------------------------------
// Known event types (EVENTS.md §2-3)
// ---------------------------------------------------------------------------

export const KNOWN_EVENT_TYPES = [
  "agent_spawned",
  "agent_finished",
  "tool_call",
  "tool_done",
  "mcp_call",
  "a2a_task_in",
  "a2a_task_out",
  "cron_fired",
  "git_push",
  "channel_msg",
  "agent_status",
];

const KNOWN_SET = new Set(KNOWN_EVENT_TYPES);

// office_chat is internal-only, never accepted from /event (EVENTS.md §2)
const INTERNAL_ONLY = new Set(["office_chat"]);

// ---------------------------------------------------------------------------
// Clamping (EVENTS.md §1: strings max 500, chat text max 4000)
// ---------------------------------------------------------------------------

export const MAX_STRING_LEN = 500;
export const MAX_TEXT_LEN = 4000;

export function clampString(val, max = MAX_STRING_LEN) {
  if (typeof val !== "string") return undefined;
  return val.slice(0, max);
}

/**
 * Clamp every own string property of an event (one level of nesting).
 * `text` fields get the larger MAX_TEXT_LEN budget (chat exception).
 */
export function clampEvent(body) {
  if (!body || typeof body !== "object") return body;
  const out = {};
  for (const [k, v] of Object.entries(body)) {
    if (typeof v === "string") {
      out[k] = v.slice(0, k === "text" ? MAX_TEXT_LEN : MAX_STRING_LEN);
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      const nested = {};
      for (const [k2, v2] of Object.entries(v)) {
        nested[k2] =
          typeof v2 === "string" ? v2.slice(0, MAX_STRING_LEN) : v2;
      }
      out[k] = nested;
    } else {
      out[k] = v;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Redaction (EVENTS.md §5) — applied before persist & broadcast
// ---------------------------------------------------------------------------

const REDACT_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,
  /\bghp_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bvik_[A-Za-z0-9_-]{8,}/g,
  /\bxox[A-Za-z]-[A-Za-z0-9-]{10,}/g,
  // JWT: eyJ....eyJ....sig
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  /\b(api[_-]?key|token|secret|password)\s*[:=]\s*\S+/gi,
];

export function redact(text) {
  if (typeof text !== "string") return text;
  let out = text;
  for (const re of REDACT_PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}

/** Redact all string fields in an event (mutates + returns). */
export function redactEvent(ev) {
  const walk = (obj) => {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === "string") obj[k] = redact(v);
      else if (v && typeof v === "object") walk(v);
    }
  };
  walk(ev);
  return ev;
}

// ---------------------------------------------------------------------------
// Schema validation per type
// ---------------------------------------------------------------------------

const SCHEMAS = {
  agent_spawned: (b) =>
    b.agent && typeof b.agent === "object" && b.agent.name
      ? null
      : "agent.name required",
  agent_finished: (b) => (b.agentId ? null : "agentId required"),
  tool_call: (b) => (b.agentId && b.tool ? null : "agentId + tool required"),
  tool_done: (b) => (b.agentId ? null : "agentId required"),
  mcp_call: (b) => (b.server && b.tool ? null : "server + tool required"),
  a2a_task_in: (b) => (b.dest ? null : "dest required"),
  a2a_task_out: (b) => (b.origin ? null : "origin required"),
  cron_fired: (b) => (b.job ? null : "job required"),
  git_push: (b) => (b.repo ? null : "repo required"),
  channel_msg: (b) => (b.platform ? null : "platform required"),
  agent_status: (b) => (b.agent ? null : "agent required"),
};

const A2A_STATES = new Set(["sent", "working", "completed", "failed"]);
const STATUS_STATES = new Set(["idle", "working", "away"]);
const DIRECTIONS = new Set(["in", "out"]);

export function validateEvent(body) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return "Missing body";
  if (typeof body.type !== "string" || !body.type) return "Missing event type";
  if (INTERNAL_ONLY.has(body.type)) return `Event type ${body.type} is internal-only`;
  if (!KNOWN_SET.has(body.type)) return `Unknown event type: ${body.type}`;
  const check = SCHEMAS[body.type];
  if (check) {
    const err = check(body);
    if (err) return `Invalid ${body.type}: ${err}`;
  }
  if (body.type === "a2a_task_out" && body.state && !A2A_STATES.has(body.state)) {
    return `Invalid a2a_task_out.state: ${body.state}`;
  }
  if (body.type === "agent_status" && body.state && !STATUS_STATES.has(body.state)) {
    return `Invalid agent_status.state: ${body.state}`;
  }
  if (body.type === "channel_msg") {
    if (body.direction && !DIRECTIONS.has(body.direction))
      return "Invalid channel_msg.direction";
    // Privacy: message content, chat names, user ids forbidden (EVENTS.md §3)
    for (const forbidden of ["text", "message", "chatName", "userId", "chatId", "fromUser"]) {
      if (body[forbidden] !== undefined)
        return `channel_msg must not contain ${forbidden}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Rate limiting — 120/min per token, burst 30 in 5s (EVENTS.md §6)
// ---------------------------------------------------------------------------

export class RateLimiter {
  constructor({ perMinute = 120, burst = 30, burstWindowMs = 5000 } = {}) {
    this.perMinute = perMinute;
    this.burst = burst;
    this.burstWindowMs = burstWindowMs;
    this.hits = new Map(); // key -> {minute: number[], burst: number[]}
  }

  check(key, now = Date.now()) {
    let entry = this.hits.get(key);
    if (!entry) {
      entry = { minute: [], burst: [] };
      this.hits.set(key, entry);
    }
    entry.minute = entry.minute.filter((t) => now - t < 60_000);
    entry.burst = entry.burst.filter((t) => now - t < this.burstWindowMs);
    if (entry.minute.length >= this.perMinute)
      return { ok: false, reason: "rate:minute" };
    if (entry.burst.length >= this.burst)
      return { ok: false, reason: "rate:burst" };
    entry.minute.push(now);
    entry.burst.push(now);
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------
// Ring buffer — 7 days / 100k rows, whichever fills first
// ---------------------------------------------------------------------------

export class RingBuffer {
  constructor({ maxRows = 100_000, maxAgeMs = 7 * 24 * 3600 * 1000 } = {}) {
    this.maxRows = maxRows;
    this.maxAgeMs = maxAgeMs;
    this.rows = [];
  }

  push(ev, now = Date.now()) {
    this.rows.push({ ev, ts: now });
    if (this.rows.length > this.maxRows) {
      this.rows.splice(0, this.rows.length - this.maxRows);
    }
  }

  prune(now = Date.now()) {
    const cutoff = now - this.maxAgeMs;
    let i = 0;
    while (i < this.rows.length && this.rows[i].ts < cutoff) i++;
    if (i > 0) this.rows.splice(0, i);
  }

  recent(limit = 50) {
    return this.rows.slice(-limit).map((r) => r.ev);
  }

  get size() {
    return this.rows.length;
  }
}

// ---------------------------------------------------------------------------
// Guest sanitization (SECURITY.md §3)
// ---------------------------------------------------------------------------

const INTERNAL_IP = /(^|[^0-9])(100\.\d+\.\d+\.\d+|127\.0\.0\.1|localhost|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)/;

export function sanitizeForGuest(ev) {
  if (!ev || typeof ev !== "object") return ev;
  if (ev.type === "git_push" && ev.privat) {
    return { type: "git_push", repo: "[private]", privat: true, source: ev.source, ts: ev.ts };
  }
  if (ev.type === "a2a_task_in" || ev.type === "a2a_task_out") {
    return { ...ev, summary: "[redacted]" };
  }
  if (ev.type === "office_chat") {
    return { type: "office_chat", activity: true, source: ev.source, ts: ev.ts };
  }
  // Strip internal URLs / Tailscale IPs from any event
  const out = { ...ev };
  for (const key of ["url", "peer_url", "endpoint"]) {
    if (typeof out[key] === "string" && INTERNAL_IP.test(out[key])) {
      out[key] = undefined;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// OfficeEventBus
// ---------------------------------------------------------------------------

export class OfficeEventBus extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.limiter = new RateLimiter(opts.rate);
    this.buffer = new RingBuffer(opts.ring);
    this.sourceOf = opts.sourceOf || (() => "system");
    this.now = opts.now || (() => Date.now());
    this.pruneTimer = setInterval(() => this.buffer.prune(), 10 * 60 * 1000);
    this.pruneTimer.unref?.();
  }

  /**
   * Ingest an event from an authenticated source.
   * @returns {{ok:true, event:object}|{ok:false, status:number, error:string}}
   */
  ingest(body, identity, opts = {}) {
    const key = identity?.source || "anon";
    if (!opts.skipRateLimit) {
      const rl = this.limiter.check(key, this.now());
      if (!rl.ok) return { ok: false, status: 429, error: rl.reason };
    }
    const err = validateEvent(body);
    if (err) return { ok: false, status: 400, error: err };

    const event = clampEvent({ ...body });
    event.source = identity?.source || "system"; // client-supplied source ignored
    if (!event.ts) event.ts = this.now();
    redactEvent(event);

    this.buffer.push(event, this.now());
    this.broadcast(event);
    return { ok: true, event };
  }

  /** Listeners receive raw events; per-connection guest filtering happens in frameFor. */
  broadcast(event) {
    this.emit("event", event);
  }

  /** WS hello handshake frame (EVENTS.md §7). */
  hello() {
    return { channel: "hello", data: { server: "1.0", events: KNOWN_EVENT_TYPES } };
  }

  /** Per-connection frame with guest filtering applied. */
  frameFor(event, isGuest) {
    const data = isGuest ? sanitizeForGuest(event) : event;
    return JSON.stringify({ channel: "event", data });
  }

  close() {
    clearInterval(this.pruneTimer);
  }
}

export const SOURCE_VALUES = new Set(["cloud", "mac", "github", "system"]);

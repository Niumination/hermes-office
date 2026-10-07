import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateEvent,
  clampEvent,
  clampString,
  redact,
  redactEvent,
  RateLimiter,
  RingBuffer,
  sanitizeForGuest,
  OfficeEventBus,
  KNOWN_EVENT_TYPES,
} from "../server/eventbus.js";

// --- validation -----------------------------------------------------------

test("validates every known event type with golden payload", () => {
  const golden = {
    agent_spawned: { agent: { name: "cloud", role: "generalist", task: "t", id: "opt-1" } },
    agent_finished: { agentId: "cloud", summary: "done" },
    tool_call: { agentId: "cloud", tool: "web_search", detail: "d" },
    tool_done: { agentId: "cloud", tool: "web_search" },
    mcp_call: { server: "github-mcp", tool: "list_issues", agentId: "cloud" },
    a2a_task_in: { dest: "cloud", peer: "mac", taskId: "task-1", summary: "s" },
    a2a_task_out: { origin: "mac", peer: "cloud", state: "completed", summary: "s" },
    cron_fired: { job: "price-monitor", dest: "telegram", ok: true },
    git_push: { repo: "brain", privat: true, author: "zaryu", commits: 2, message: "m", url: "https://github.com/x/y" },
    channel_msg: { platform: "telegram", channelType: "group", direction: "in", agent: "cloud" },
    agent_status: { agent: "mac", state: "idle", uptimeH: 26.4 },
    service_status: { host: "cloud", unit: "hermes-office", kind: "systemd", state: "active", detail: "uptime 3d" },
    budget_state: { scope: "agent", subject: "cloud", state: "hot", spentUsd: 1.2, limitUsd: 2 },
    office_chat: { text: "hello" },
    agent_moved: { agent: "cloud", fromRoom: "lobby", room: "main-office", grantedBy: "owner" },
    approval_requested: { approvalId: "ap-1", agent: "cloud", room: "server-room", tool: "deploy" },
    approval_resolved: { approvalId: "ap-1", agent: "cloud", state: "approved", resolvedBy: "owner" },
  };

  // These are server-authoritative: a bridge must not be able to forge them,
  // so they only validate on the internal path.
  const INTERNAL_ONLY = new Set([
    "budget_state", "office_chat",
    "agent_moved", "approval_requested", "approval_resolved",
  ]);

  for (const type of KNOWN_EVENT_TYPES) {
    assert.ok(golden[type], `no golden payload for ${type} — add one`);
    const internal = INTERNAL_ONLY.has(type);
    assert.equal(
      validateEvent({ type, ...golden[type] }, { internal }),
      null,
      type
    );
    if (internal) {
      assert.match(
        validateEvent({ type, ...golden[type] }),
        /internal-only/,
        `${type} must be refused from the external path`
      );
    }
  }
});

test("unknown type rejected; office_chat internal-only; missing fields rejected", () => {
  assert.match(validateEvent({ type: "nope" }), /Unknown event type/);
  assert.match(validateEvent({ type: "office_chat" }), /internal-only/);
  assert.match(validateEvent({ type: "agent_spawned" }), /agent.name required/);
  assert.match(validateEvent({ type: "channel_msg", platform: "t", text: "secret" }), /must not contain text/);
  assert.match(validateEvent({ type: "a2a_task_out", origin: "mac", state: "bogus" }), /Invalid/);
  assert.match(validateEvent({ type: "agent_status", agent: "mac", state: "bogus" }), /Invalid/);
  assert.match(validateEvent({ type: "service_status", host: "cloud" }), /host \+ unit \+ state required/);
  assert.match(validateEvent({ type: "service_status", host: "cloud", unit: "u", state: "bogus" }), /Invalid/);
  assert.match(validateEvent({ type: "service_status", host: "mars", unit: "u", state: "active" }), /Invalid/);
  assert.equal(validateEvent({ type: "service_status", host: "mac", unit: "com.niumination.office-relay", state: "active" }), null);
  assert.equal(validateEvent(null), "Missing body");
});

// --- clamping -------------------------------------------------------------

test("clamps strings to 500, text to 4000", () => {
  const ev = clampEvent({ detail: "x".repeat(600), text: "y".repeat(5000), agent: { task: "z".repeat(600) } });
  assert.equal(ev.detail.length, 500);
  assert.equal(ev.text.length, 4000);
  assert.equal(ev.agent.task.length, 500);
  assert.equal(clampString(42), undefined);
});

test("clamps agent_status.metrics: numeric-only, rejects non-numeric fields", () => {
  const ev = clampEvent({
    type: "agent_status", agent: "mac",
    metrics: { disk_free_gb: 87.5, load_1m: 2.4, uptime_s: 912400, sneaky: { a: 1 } },
  });
  assert.equal(ev.metrics.disk_free_gb, 87.5);
  assert.equal(ev.metrics.sneaky, undefined);
  const big = clampEvent({ metrics: { x: 1e15 } });
  assert.equal(big.metrics.x, 1e12);
});

// --- redaction ------------------------------------------------------------

test("redacts secrets per EVENTS.md §5", () => {
  const cases = [
    ["key sk-abc123def456", "[REDACTED]"],
    ["ghp_" + "a".repeat(30), "[REDACTED]"],
    ["github_pat_" + "A1b2_" + "x".repeat(20), "[REDACTED]"],
    ["vik_abcdefgh", "[REDACTED]"],
    ["xoxb-123456789012", "[REDACTED]"],
    ["eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.SflKxwRJSMeKKF2QT4f", "[REDACTED]"],
    ["Bearer abcdef123456", "[REDACTED]"],
    ["api_key=supersecret", "[REDACTED]"],
    ["password: hunter2", "[REDACTED]"],
    ["normal text survives", "normal text survives"],
  ];
  for (const [input, expected] of cases) {
    assert.ok(redact(input).includes(expected), input);
  }
  const ev = redactEvent({ summary: "token: abc123def456789", nested: { s: "sk-abcdefghijklmnop" } });
  assert.equal(ev.summary, "[REDACTED]");
  assert.equal(ev.nested.s, "[REDACTED]");
});

// --- rate limiter ---------------------------------------------------------

test("rate limiter: burst and per-minute", () => {
  const rl = new RateLimiter({ perMinute: 3, burst: 2, burstWindowMs: 5000 });
  let t = 0;
  assert.ok(rl.check("cloud", t).ok);
  assert.ok(rl.check("cloud", t).ok);
  assert.equal(rl.check("cloud", t).ok, false); // burst hit (2 in 5s)
  assert.ok(rl.check("mac", t).ok); // independent key
  t = 6000;
  assert.ok(rl.check("cloud", t).ok); // burst window expired (minute now 3/3)
  assert.equal(rl.check("cloud", t).ok, false); // burst again
  t = 7000;
  assert.ok(rl.check("mac", t).ok);
  assert.ok(rl.check("mac", t).ok);
  assert.equal(rl.check("mac", t).ok, false); // minute budget (3 in 60s) exhausted
});

// --- ring buffer ----------------------------------------------------------

test("ring buffer: maxRows and maxAge", () => {
  const rb = new RingBuffer({ maxRows: 5, maxAgeMs: 1000 });
  for (let i = 0; i < 10; i++) rb.push({ i }, 100 + i);
  assert.equal(rb.size, 5);
  assert.equal(rb.recent(2).length, 2);
  rb.prune(2000);
  assert.equal(rb.size, 0);
});

// --- guest sanitization ---------------------------------------------------

test("sanitizeForGuest: private git_push, a2a summary, office_chat, internal urls", () => {
  const gp = sanitizeForGuest({ type: "git_push", repo: "brain", privat: true, url: "https://github.com/x/brain" });
  assert.equal(gp.repo, "[private]");
  assert.equal(gp.url, undefined);
  const pub = sanitizeForGuest({ type: "git_push", repo: "brain", privat: false, url: "https://github.com/x/brain" });
  assert.equal(pub.repo, "brain");
  const a2a = sanitizeForGuest({ type: "a2a_task_in", dest: "cloud", summary: "secret plan" });
  assert.equal(a2a.summary, "[redacted]");
  const oc = sanitizeForGuest({ type: "office_chat", text: "hi", source: "system" });
  assert.equal(oc.text, undefined);
  assert.equal(oc.activity, true);
  const url = sanitizeForGuest({ type: "cron_fired", job: "j", url: "http://100.64.0.1:9900/x" });
  assert.equal(url.url, undefined);
  const svc = sanitizeForGuest({ type: "service_status", host: "cloud", unit: "hermes-office", state: "active", detail: "uptime 3d, log /var/log/office.log" });
  assert.equal(svc.unit, "hermes-office");
  assert.equal(svc.detail, "uptime 3d, log [path]");
  const svcBad = sanitizeForGuest({ type: "service_status", host: "cloud", unit: "u", state: "active", detail: "see http://127.0.0.1:7333" });
  assert.equal(svcBad.detail, undefined);
});

// --- OfficeEventBus.ingest -------------------------------------------------

test("ingest: source override, ts fill, redaction, reject, rate limit", () => {
  const bus = new OfficeEventBus({ rate: { perMinute: 2, burst: 10 } });
  let now = 1000;
  bus.now = () => now;
  const r1 = bus.ingest({ type: "agent_status", agent: "mac", source: "spoofed" }, { source: "mac" });
  assert.ok(r1.ok);
  assert.equal(r1.event.source, "mac"); // client value ignored
  assert.equal(r1.event.ts, 1000);
  const r2 = bus.ingest({ type: "tool_call", agentId: "c", tool: "t", detail: "Bearer zzzzzzzzzz" }, { source: "cloud" });
  assert.equal(r2.event.detail, "[REDACTED]");
  const bad = bus.ingest({ type: "nope" }, { source: "cloud" });
  assert.equal(bad.status, 400);
  bus.ingest({ type: "tool_done", agentId: "c" }, { source: "cloud" });
  assert.equal(bus.ingest({ type: "tool_done", agentId: "c" }, { source: "cloud" }).status, 429);
  bus.close();
});

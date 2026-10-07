/**
 * Integration test: boots the real server on an ephemeral port with test tokens,
 * exercises HTTP auth, /event validation, WS broadcast + guest filtering, chat.
 * Run with: node --test tests/integration.test.js
 * Uses OFFICE_DATA_DIR to a temp dir so it never touches real data.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "child_process";
import { mkdtempSync, existsSync, mkdirSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import WebSocket from "ws";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const PORT = 7391;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKENS = {
  cloud: "cloud-test-token-aaaa",
  mac: "mac-test-token-bbbb",
  owner: "owner-test-token-cccc",
  guest: "guest-test-token-dddd",
};

let proc;

function post(path, body, token, extra = {}) {
  return fetch(BASE + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: JSON.stringify(body),
  });
}

// Every socket opened by the suite, so after() can guarantee the test
// process's event loop is empty. Leaked sockets were why `node --test` passed
// all assertions and then hung forever instead of exiting.
const OPEN_SOCKETS = new Set();

function wsConnect(token, origin) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { Authorization: `Bearer ${token}`, ...(origin ? { Origin: origin } : {}) },
    });
    OPEN_SOCKETS.add(ws);
    ws.on("close", () => OPEN_SOCKETS.delete(ws));
    const frames = [];
    ws.on("message", (m) => frames.push(JSON.parse(m.toString())));
    ws.on("open", () => resolve(ws));
    ws.on("error", reject);
    ws._frames = frames;
  });
}

async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => { setTimeout(r, 100); });
  }
  return false;
}

// The SPA fallback can only answer 200 if frontend/dist/index.html exists, and
// dist/ is gitignored while the backend CI job never builds it. So this test
// passed locally for anyone with a stale build lying around and failed on every
// fresh clone and every CI run — the assertion read "404 !== 200", which blames
// the route instead of naming the missing build. The routing contract does not
// need the real bundle, so the suite now supplies a stub when no build is
// present and removes only what it created.
const DIST_DIR = join(ROOT, "frontend", "dist");
const DIST_INDEX = join(DIST_DIR, "index.html");
let stubbedDist = false;

before(async () => {
  if (!existsSync(DIST_INDEX)) {
    mkdirSync(DIST_DIR, { recursive: true });
    writeFileSync(DIST_INDEX, "<!doctype html><title>stub</title>", "utf8");
    stubbedDist = true;
  }
  const dataDir = mkdtempSync(join(tmpdir(), "office-test-"));
  proc = spawn("node", [join(ROOT, "server", "index.js")], {
    env: {
      ...process.env,
      OFFICE_PORT: String(PORT),
      OFFICE_DATA_DIR: dataDir,
      OFFICE_CLOUD_TOKEN: TOKENS.cloud,
      OFFICE_MAC_TOKEN: TOKENS.mac,
      OFFICE_OWNER_TOKEN: TOKENS.owner,
      OFFICE_GUEST_TOKEN: TOKENS.guest,
      ALLOWED_ORIGINS: "http://localhost:5173",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stderr.on("data", (d) => process.env.DEBUG_TEST && process.stderr.write(d));
  assert.ok(await waitFor(async () => {
    try {
      const r = await fetch(BASE + "/health");
      return r.ok;
    } catch { return false; }
  }), "server did not start");
});

after(async () => {
  // Above the early return below: a stub left behind would make the next fresh
  // clone pass for the wrong reason, which is the exact failure being fixed.
  if (stubbedDist) {
    rmSync(DIST_DIR, { recursive: true, force: true });
    stubbedDist = false;
  }

  for (const ws of OPEN_SOCKETS) {
    try { ws.terminate(); } catch { /* already gone */ }
  }
  OPEN_SOCKETS.clear();

  if (!proc || proc.exitCode !== null || proc.signalCode !== null) return;

  // Wait for a real exit so we assert the server's graceful shutdown actually
  // works; escalate to SIGKILL only if it misses its own 5s budget.
  await new Promise((resolve) => {
    const kill = setTimeout(() => {
      console.error("[test] server ignored SIGTERM, escalating to SIGKILL");
      proc.kill("SIGKILL");
    }, 8000);
    kill.unref();
    proc.once("exit", () => { clearTimeout(kill); resolve(); });
    proc.kill("SIGTERM");
  });
});

test("health endpoint", async () => {
  const r = await fetch(BASE + "/health");
  const j = await r.json();
  assert.equal(j.status, "ok");
});

test("auth: 401 without token, 401 bad token, 403 guest on /event, bridge ok", async () => {
  assert.equal((await post("/event", { type: "tool_done", agentId: "x" })).status, 401);
  assert.equal((await post("/event", { type: "tool_done", agentId: "x" }, "wrong")).status, 401);
  assert.equal((await post("/event", { type: "tool_done", agentId: "x" }, TOKENS.guest)).status, 403);
  const ok = await post("/event", { type: "tool_done", agentId: "x" }, TOKENS.cloud);
  assert.equal(ok.status, 200);
  const okBody = await ok.json();
  assert.equal(okBody.ok, true);
});

test("event validation: unknown type 400, missing field 400, source override ignored", async () => {
  assert.equal((await post("/event", { type: "bogus" }, TOKENS.mac)).status, 400);
  assert.equal((await post("/event", { type: "git_push" }, TOKENS.mac)).status, 400);
  await post(
    { toString: () => "/event" },
    null, TOKENS.mac
  ).catch(() => null);
  const ok = await post("/event", { type: "agent_status", agent: "mac", state: "idle", source: "spoof" }, TOKENS.mac);
  const j = await ok.json();
  assert.equal(j.ok, true);
});

test("owner cannot POST /event, guest cannot POST /chat, owner can", async () => {
  assert.equal((await post("/event", { type: "tool_done", agentId: "x" }, TOKENS.owner)).status, 403);
  assert.equal((await post("/chat", { sender: "g", text: "hi" }, TOKENS.guest)).status, 403);
  const r = await post("/chat", { sender: "owner", text: "hello office" }, TOKENS.owner);
  assert.equal(r.status, 200);
});

test("WS: handshake hello, event broadcast, guest filtering of private git_push", async () => {
  const owner = await wsConnect(TOKENS.owner);
  const guest = await wsConnect(TOKENS.guest);
  await new Promise((r) => { setTimeout(r, 200); });
  assert.equal(owner._frames[0].channel, "hello");
  assert.ok(owner._frames[0].data.events.includes("git_push"));

  await post("/event", {
    type: "git_push",
    repo: "brain",
    privat: true,
    author: "zaryu",
    commits: 2,
    message: "m",
    url: "https://github.com/Niumination/brain",
  }, TOKENS.cloud);

  await new Promise((r) => { setTimeout(r, 300); });
  const ownerEv = owner._frames.filter((f) => f.channel === "event");
  const guestEv = guest._frames.filter((f) => f.channel === "event");
  const lastOwner = ownerEv[ownerEv.length - 1]?.data;
  const lastGuest = guestEv[guestEv.length - 1]?.data;
  assert.equal(lastOwner.type, "git_push");
  assert.equal(lastOwner.repo, "brain");
  assert.equal(lastGuest.repo, "[private]");
  assert.equal(lastGuest.url, undefined);

  // public git_push passes through for guest
  await post("/event", { type: "git_push", repo: "public-repo", privat: false, author: "a", commits: 1 }, TOKENS.cloud);
  await new Promise((r) => { setTimeout(r, 300); });
  const guestLast = guest._frames.filter((f) => f.channel === "event").pop()?.data;
  assert.equal(guestLast.repo, "public-repo");

  owner.close();
  guest.close();
});

test("WS: bad origin rejected, no token rejected", async () => {
  const expectReject = (headers) =>
    new Promise((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers });
      let settled = false;
      const done = (code) => { if (!settled) { settled = true; try { ws.terminate(); } catch {} resolve(code); } };
      ws.on("error", (err) => {
        const m = /Unexpected server response: (\d+)/.exec(err.message);
        done(m ? Number(m[1]) : 0);
      });
      ws.on("close", (code) => done(code));
      ws.on("open", () => done("opened"));
    });
  assert.equal(await expectReject({ Authorization: `Bearer ${TOKENS.owner}`, Origin: "http://evil.example" }), 403);
  assert.equal(await expectReject({}), 401);
});

test("rate limit: burst > 30 in 5s → 429", async () => {
  let got429 = false;
  for (let i = 0; i < 35; i++) {
    const r = await post("/event", { type: "tool_done", agentId: `x${i}` }, TOKENS.mac);
    if (r.status === 429) { got429 = true; break; }
  }
  assert.ok(got429, "expected 429 within burst");
  // give limiter a moment; other tests use different tokens (cloud/owner unaffected)
  await new Promise((r) => { setTimeout(r, 100); });
});

test("redaction end-to-end: secret in event text becomes [REDACTED] in buffer", async () => {
  await post("/event", { type: "a2a_task_in", dest: "cloud", peer: "mac", taskId: "t1", summary: "use sk-abcdefghijklmnop token" }, TOKENS.cloud);
  const r = await fetch(BASE + "/debug/events?limit=20", { headers: { Authorization: `Bearer ${TOKENS.owner}` } });
  const j = await r.json();
  const ev = j.events.filter((e) => e.type === "a2a_task_in").pop();
  assert.ok(ev, "event in buffer");
  assert.equal(ev.summary, "use [REDACTED] token");
});

test("chat history roundtrip via SQLite", async () => {
  await post("/chat", { sender: "owner", text: "persist me" }, TOKENS.owner);
  const r = await fetch(BASE + "/chat", { headers: { Authorization: `Bearer ${TOKENS.owner}` } });
  const j = await r.json();
  assert.ok(j.messages.some((m) => m.text === "persist me"));
});

test("/roster: guest ok, unauthenticated 401", async () => {
  assert.equal((await fetch(BASE + "/roster")).status, 401);
  const r = await fetch(BASE + "/roster", { headers: { Authorization: `Bearer ${TOKENS.guest}` } });
  assert.equal(r.status, 200);
});

test("browser session flow: /auth/session → cookie works for /chat and WS", async () => {
  const s = await fetch(BASE + "/auth/session", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKENS.owner}` },
  });
  assert.equal(s.status, 200);
  const cookie = (s.headers.get("set-cookie") || "").split(";")[0];
  assert.ok(cookie.startsWith("office_session="));

  // /chat via cookie
  const c = await fetch(BASE + "/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ sender: "owner", text: "cookie chat" }),
  });
  assert.equal(c.status, 200);

  // WS via cookie, allowed origin
  const ws = await new Promise((resolve) => {
    const sock = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { Cookie: cookie, Origin: "http://localhost:5173" },
    });
    sock.on("message", (m) => {
      const f = JSON.parse(m.toString());
      if (f.channel === "hello") resolve({ ok: true, frames: [f] });
    });
    sock.on("error", () => resolve({ ok: false, frames: [] }));
    setTimeout(() => resolve({ ok: false, frames: [] }), 2000);
  });
  assert.ok(ws.ok, "cookie WS connect");
  assert.equal(ws.frames[0]?.channel, "hello");
  sock_close(ws);
  // bad session cookie → 401
  const bad = await new Promise((resolve) => {
    const sock = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { Cookie: "office_session=bogus.1", Origin: "http://localhost:5173" },
    });
    sock.on("error", (e) => resolve(/401/.test(e.message) ? 401 : 0));
    sock.on("open", () => resolve("opened"));
  });
  assert.equal(bad, 401);
});

function sock_close(ws) { try { ws && ws.terminate && ws.terminate(); } catch {} }

// --- Fase 0 regression guards -------------------------------------------

test("static: missing asset returns a real 404, SPA route still serves index", async () => {
  // The catch-all used to answer 200 + index.html for every path, so a typo'd
  // sprite silently rendered as a broken image with no network-tab signal.
  const miss = await fetch(BASE + "/sprites/definitely-not-here.webp");
  assert.equal(miss.status, 404);

  const room = await fetch(BASE + "/rooms/also-not-here.webp");
  assert.equal(room.status, 404);

  const spa = await fetch(BASE + "/some/deep/client/route");
  assert.equal(spa.status, 200);
  assert.match(spa.headers.get("content-type") || "", /html/);
});

test("watchdog: a non-agent_status event counts as a heartbeat", async () => {
  // Only agent_status used to refresh liveness, so an agent busy emitting
  // tool_call for >90s was shown as 'away' while actively working.
  // Runs a dedicated server with a 600ms cutoff so this takes ~2s, not 2min.
  const PORT2 = PORT + 1;
  const p = spawn("node", [join(ROOT, "server", "index.js")], {
    env: {
      ...process.env,
      OFFICE_PORT: String(PORT2),
      OFFICE_CLOUD_TOKEN: TOKENS.cloud,
      OFFICE_MAC_TOKEN: TOKENS.mac,
      OFFICE_OWNER_TOKEN: TOKENS.owner,
      OFFICE_GUEST_TOKEN: TOKENS.guest,
      OFFICE_DB: ":memory:",
      OFFICE_WATCHDOG_CUTOFF_MS: "600",
      OFFICE_WATCHDOG_SWEEP_MS: "150",
    },
    stdio: "ignore",
  });
  const B2 = `http://127.0.0.1:${PORT2}`;
  const hdr = { "Content-Type": "application/json", Authorization: `Bearer ${TOKENS.cloud}` };
  const send = (b) => fetch(B2 + "/event", { method: "POST", headers: hdr, body: JSON.stringify(b) });
  const awayCount = async () => {
    const r = await fetch(B2 + "/debug/events", { headers: { Authorization: `Bearer ${TOKENS.owner}` } });
    const j = await r.json();
    const list = Array.isArray(j) ? j : j.events || [];
    return list.filter((e) => e.type === "agent_status" && e.state === "away" && e.agent === "hb").length;
  };

  try {
    await waitFor(async () => {
      try { return (await fetch(B2 + "/health")).ok; } catch { return false; }
    }, 8000);

    await send({ type: "agent_status", agent: "hb", state: "idle" });

    // Keep 'hb' alive with tool_call only — no further agent_status.
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => { setTimeout(r, 200); });
      await send({ type: "tool_call", agentId: "hb", tool: "bash" });
    }
    assert.equal(await awayCount(), 0, "tool_call traffic should have kept 'hb' alive");

    // Now go silent past the cutoff — it must flip to away.
    assert.ok(
      await waitFor(async () => (await awayCount()) > 0, 5000),
      "'hb' should be marked away after the cutoff with no traffic"
    );
  } finally {
    p.kill("SIGTERM");
  }
});

// --- OTLP ingest -----------------------------------------------------------

const otlpSpan = (name, attrs, startNs = 1791000000000000000n, durNs = 500000000n) => ({
  name,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  spanId: "00f067aa0ba902b7",
  startTimeUnixNano: String(startNs),
  endTimeUnixNano: String(startNs + durNs),
  status: { code: 1 },
  attributes: Object.entries(attrs).map(([key, v]) => ({
    key,
    value: typeof v === "number" ? { intValue: String(v) } : { stringValue: String(v) },
  })),
});

const otlpBody = (spans, service = "otlp-svc") => ({
  resourceSpans: [
    {
      resource: { attributes: [{ key: "service.name", value: { stringValue: service } }] },
      scopeSpans: [{ spans }],
    },
  ],
});

async function postOtlp(body, token) {
  return fetch(BASE + "/v1/traces", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
}

test("otlp: requires a bridge token, rejects guest and anonymous", async () => {
  assert.equal((await postOtlp(otlpBody([]))).status, 401);
  assert.equal((await postOtlp(otlpBody([]), "wrong")).status, 401);
  assert.equal((await postOtlp(otlpBody([]), TOKENS.guest)).status, 403);
  assert.equal((await postOtlp(otlpBody([]), TOKENS.cloud)).status, 200);
});

test("otlp: returns an OTLP-shaped response, not a bespoke one", async () => {
  const r = await postOtlp(
    otlpBody([otlpSpan("execute_tool grep", { "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "grep" })]),
    TOKENS.cloud
  );
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok("partialSuccess" in j, "exporters require ExportTraceServiceResponse");
  assert.deepEqual(j.partialSuccess, {}, "full success is an empty object");
});

test("otlp: spans become events, tokens and cost are attributed", async () => {
  await postOtlp(
    otlpBody([
      otlpSpan("chat claude-sonnet-4-5", {
        "gen_ai.operation.name": "chat",
        "gen_ai.provider.name": "anthropic",
        "gen_ai.request.model": "claude-sonnet-4-5-20250929",
        "gen_ai.agent.name": "cost-probe",
        "gen_ai.usage.input_tokens": 12000,
        "gen_ai.usage.output_tokens": 800,
      }),
    ]),
    TOKENS.cloud
  );
  const r = await fetch(BASE + "/debug/events?limit=200", {
    headers: { Authorization: `Bearer ${TOKENS.owner}` },
  });
  const { events } = await r.json();
  const done = events.find((e) => e.type === "tool_done" && e.agentId === "cost-probe");
  assert.ok(done, "tool_done should exist for the OTLP agent");
  assert.equal(done.inputTokens, 12000);
  assert.equal(done.outputTokens, 800);
  assert.equal(done.costUsd, 0.048);
  assert.equal(done.source, "otlp" === done.source ? "otlp" : done.source);
});

test("otlp: an agent seen for the first time is auto-spawned", async () => {
  // Real instrumentation rarely emits create_agent, so without this the
  // character would never appear on the office floor.
  await postOtlp(
    otlpBody([
      otlpSpan("execute_tool ls", {
        "gen_ai.operation.name": "execute_tool",
        "gen_ai.tool.name": "ls",
        "gen_ai.agent.name": "never-announced",
      }),
    ]),
    TOKENS.cloud
  );
  const { events } = await (
    await fetch(BASE + "/debug/events?limit=200", { headers: { Authorization: `Bearer ${TOKENS.owner}` } })
  ).json();
  const spawn = events.find(
    (e) => e.type === "agent_spawned" && e.agent?.name === "never-announced"
  );
  assert.ok(spawn, "a synthetic agent_spawned should precede the tool activity");
  assert.equal(spawn.synthetic, true);

  // ...and it should now be in the roster so a reload still shows it.
  const roster = await (
    await fetch(BASE + "/roster", { headers: { Authorization: `Bearer ${TOKENS.owner}` } })
  ).json();
  assert.ok(roster.agents.some((a) => a.name === "never-announced"));
});

test("otlp: protobuf is refused with actionable guidance", async () => {
  const r = await fetch(BASE + "/v1/traces", {
    method: "POST",
    headers: { "Content-Type": "application/x-protobuf", Authorization: `Bearer ${TOKENS.cloud}` },
    body: Buffer.from([0x0a, 0x00]),
  });
  assert.equal(r.status, 415);
  assert.match((await r.json()).error, /http\/json/);
});

test("otlp: non-GenAI spans are ignored rather than invented into events", async () => {
  const before = (await (await fetch(BASE + "/debug/events?limit=500", { headers: { Authorization: `Bearer ${TOKENS.owner}` } })).json()).events.length;
  const r = await postOtlp(
    otlpBody([otlpSpan("GET /healthz", { "http.request.method": "GET" })]),
    TOKENS.cloud
  );
  assert.equal(r.status, 200);
  const after = (await (await fetch(BASE + "/debug/events?limit=500", { headers: { Authorization: `Bearer ${TOKENS.owner}` } })).json()).events.length;
  assert.equal(after, before, "no events should be produced");
});

// --- Burn-rate governance --------------------------------------------------

test("burn: /burn is readable and reports no limits when none are configured", async () => {
  const r = await fetch(BASE + "/burn", { headers: { Authorization: `Bearer ${TOKENS.owner}` } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.global, "snapshot has a global scope");
  assert.ok(Array.isArray(j.agents));
  assert.equal(j.global.limitHourUsd, null, "test server runs without a budget");
});

test("burn: /burn requires authentication", async () => {
  assert.equal((await fetch(BASE + "/burn")).status, 401);
});

test("burn: /budget/check allows everything when no budget is set", async () => {
  const r = await fetch(BASE + "/budget/check", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKENS.cloud}` },
    body: JSON.stringify({ agent: "anyone", model: "claude-opus-4" }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.allow, true);
  assert.match(j.reason, /no budget/);
});

test("burn: a guest can neither read burn state nor ask for a decision", async () => {
  assert.equal((await fetch(BASE + "/budget/check", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKENS.guest}` },
    body: JSON.stringify({ agent: "x" }),
  })).status, 403);
});

test("burn: bridges cannot forge a budget_state event", async () => {
  // Budget states are server-authoritative; a compromised bridge must not be
  // able to fake "all clear" or trigger someone else's circuit breaker.
  const r = await post(
    "/event",
    { type: "budget_state", scope: "global", subject: "office", state: "normal" },
    TOKENS.cloud
  );
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /internal-only/);
});

test("burn: end-to-end — OTLP spend trips the breaker and denies the next call", async () => {
  // Dedicated server with a tiny budget so the whole ladder runs in one test.
  const PORT3 = PORT + 2;
  const p = spawn("node", [join(ROOT, "server", "index.js")], {
    env: {
      ...process.env,
      OFFICE_PORT: String(PORT3),
      OFFICE_CLOUD_TOKEN: TOKENS.cloud,
      OFFICE_MAC_TOKEN: TOKENS.mac,
      OFFICE_OWNER_TOKEN: TOKENS.owner,
      OFFICE_GUEST_TOKEN: TOKENS.guest,
      OFFICE_DB: ":memory:",
      OFFICE_BUDGET_AGENT_HOURLY_USD: "0.06",
      OFFICE_BUDGET_HOURLY_USD: "1",
    },
    stdio: "ignore",
  });
  const B3 = `http://127.0.0.1:${PORT3}`;
  const hdr = { "Content-Type": "application/json", Authorization: `Bearer ${TOKENS.cloud}` };

  // 10k input tokens of claude-sonnet-4-5 = $0.03 exactly.
  const burnOnce = () =>
    fetch(B3 + "/v1/traces", {
      method: "POST",
      headers: hdr,
      body: JSON.stringify({
        resourceSpans: [{
          resource: { attributes: [{ key: "service.name", value: { stringValue: "burner" } }] },
          scopeSpans: [{ spans: [{
            name: "chat",
            traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
            spanId: "00f067aa0ba902b7",
            startTimeUnixNano: "1791000000000000000",
            endTimeUnixNano: "1791000001000000000",
            status: { code: 1 },
            attributes: [
              { key: "gen_ai.operation.name", value: { stringValue: "chat" } },
              { key: "gen_ai.request.model", value: { stringValue: "claude-sonnet-4-5" } },
              { key: "gen_ai.agent.name", value: { stringValue: "burner" } },
              { key: "gen_ai.usage.input_tokens", value: { intValue: "10000" } },
              { key: "gen_ai.usage.output_tokens", value: { intValue: "0" } },
            ],
          }] }],
        }],
      }),
    });

  const decide = async (model) =>
    (await fetch(B3 + "/budget/check", {
      method: "POST", headers: hdr,
      body: JSON.stringify({ agent: "burner", model }),
    })).json();

  try {
    await waitFor(async () => {
      try { return (await fetch(B3 + "/health")).ok; } catch { return false; }
    }, 8000);

    assert.equal((await decide("claude-opus-4")).allow, true, "nothing spent yet");

    await burnOnce();                                   // $0.03 of $0.06 = 50%
    const warm = await decide("claude-opus-4");
    assert.equal(warm.state, "warm");
    assert.equal(warm.allow, true, "warm still permits work");
    assert.ok(warm.suggestModel, "but it already suggests a cheaper model");

    await burnOnce();                                   // $0.06 of $0.06 = 100%
    const dead = await decide("gpt-4o-mini");
    assert.equal(dead.state, "tripped");
    assert.equal(dead.allow, false, "breaker is open even for the cheapest model");
    assert.ok(dead.retryAfterS > 0);

    // The office must have been told, so the room can catch fire.
    const { events } = await (await fetch(B3 + "/debug/events?limit=200", {
      headers: { Authorization: `Bearer ${TOKENS.owner}` },
    })).json();
    const states = events.filter((e) => e.type === "budget_state").map((e) => e.state);
    assert.ok(states.includes("tripped"), `expected a tripped broadcast, saw ${states}`);

    const snap = await (await fetch(B3 + "/burn", {
      headers: { Authorization: `Bearer ${TOKENS.owner}` },
    })).json();
    const a = snap.agents.find((x) => x.agent === "burner");
    assert.equal(a.state, "tripped");
    assert.equal(a.spentHourUsd, 0.06);
    assert.equal(a.tokens, 20000);
  } finally {
    p.kill("SIGTERM");
  }
});

// --- Floor-plan policy -----------------------------------------------------

const asJson = (r) => r.json();
const policyCheck = (body, token = TOKENS.cloud) =>
  fetch(BASE + "/policy/check", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  }).then(asJson);

const moveAgent = (agent, room, token = TOKENS.owner) =>
  fetch(BASE + `/agents/${encodeURIComponent(agent)}/room`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ room }),
  });

test("policy: /policy describes the full floor plan to an owner", async () => {
  // Guests get a redacted view — see the guest confidentiality tests below.
  const r = await fetch(BASE + "/policy", { headers: { Authorization: `Bearer ${TOKENS.owner}` } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.defaultRoom, "lobby");
  const sr = j.rooms.find((x) => x.room === "server-room");
  assert.equal(sr.entryApproval, true);
  assert.ok(sr.approval.includes("deploy"));
  assert.equal((await fetch(BASE + "/policy")).status, 401, "but not anonymously");
});

test("policy: an unassigned agent is confined to the lobby", async () => {
  const d = await policyCheck({ agent: "newcomer", tool: "deploy" });
  assert.equal(d.room, "lobby");
  assert.equal(d.allow, false);
  assert.match(d.hint, /Server Room/, "the denial says where it would be allowed");
});

test("policy: only an owner may grant scope by moving an agent", async () => {
  assert.equal((await moveAgent("mover", "main-office", TOKENS.cloud)).status, 403);
  assert.equal((await moveAgent("mover", "main-office", TOKENS.guest)).status, 403);
  const ok = await moveAgent("mover", "main-office", TOKENS.owner);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).room, "main-office");
});

test("policy: moving an agent changes what it may do", async () => {
  assert.equal((await policyCheck({ agent: "scoped", tool: "write_file" })).allow, false);
  await moveAgent("scoped", "main-office");
  assert.equal((await policyCheck({ agent: "scoped", tool: "write_file" })).allow, true);
});

test("policy: a nonexistent room is rejected, never silently granted", async () => {
  const r = await moveAgent("ghost", "atlantis");
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Unknown room/);
  assert.equal((await policyCheck({ agent: "ghost", tool: "bash" })).room, "lobby");
});

test("policy: entering a privileged room is held at the door, then performed on approval", async () => {
  const held = await moveAgent("climber", "server-room");
  assert.equal(held.status, 202, "202 Accepted — the request exists but has not happened");
  const { approvalId } = await held.json();
  assert.ok(approvalId);

  // Still in the lobby while pending.
  assert.equal((await policyCheck({ agent: "climber", tool: "bash" })).room, "lobby");

  // It shows up in the queue.
  const queue = await (await fetch(BASE + "/approvals", {
    headers: { Authorization: `Bearer ${TOKENS.owner}` },
  })).json();
  assert.ok(queue.pending.some((a) => a.id === approvalId && a.kind === "entry"));

  // A bridge may read the queue but must not decide.
  assert.equal((await fetch(BASE + `/approvals/${approvalId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKENS.cloud}` },
    body: JSON.stringify({ approve: true }),
  })).status, 403);

  // Owner approves → the move happens.
  const done = await fetch(BASE + `/approvals/${approvalId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKENS.owner}` },
    body: JSON.stringify({ approve: true }),
  });
  assert.equal(done.status, 200);
  assert.equal((await done.json()).status, "approved");
  assert.equal((await policyCheck({ agent: "climber", tool: "web_search" })).room, "server-room");
});

test("policy: a gated tool needs its own sign-off even inside the room", async () => {
  await moveAgent("op", "server-room");
  const entry = await (await fetch(BASE + "/approvals", {
    headers: { Authorization: `Bearer ${TOKENS.owner}` },
  })).json();
  const mine = entry.pending.find((a) => a.agent === "op" && a.kind === "entry");
  await fetch(BASE + `/approvals/${mine.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKENS.owner}` },
    body: JSON.stringify({ approve: true }),
  });

  // In the room, but deploy is a second, independent gate.
  const first = await policyCheck({ agent: "op", tool: "deploy" });
  assert.equal(first.allow, false);
  assert.equal(first.action, "await_approval");
  assert.ok(first.approvalId);

  await fetch(BASE + `/approvals/${first.approvalId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKENS.owner}` },
    body: JSON.stringify({ approve: true }),
  });

  const after = await policyCheck({ agent: "op", tool: "deploy", approvalId: first.approvalId });
  assert.equal(after.allow, true);

  // The same token must not unlock a different tool.
  const replay = await policyCheck({ agent: "op", tool: "kubectl", approvalId: first.approvalId });
  assert.equal(replay.allow, false);
});

test("policy: a denied request leaves the agent where it was", async () => {
  const held = await moveAgent("rejected", "server-room");
  const { approvalId } = await held.json();
  await fetch(BASE + `/approvals/${approvalId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKENS.owner}` },
    body: JSON.stringify({ approve: false }),
  });
  assert.equal((await policyCheck({ agent: "rejected", tool: "web_search" })).room, "lobby");

  // And it cannot be resolved a second time.
  const again = await fetch(BASE + `/approvals/${approvalId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKENS.owner}` },
    body: JSON.stringify({ approve: true }),
  });
  assert.equal(again.status, 409);
});

test("policy: a room caps the model tier reachable inside it", async () => {
  const d = await policyCheck({ agent: "tiered", tool: "llm:x", model: "claude-opus-4" });
  assert.equal(d.allow, false, "lobby permits cheap models only");
  assert.equal(d.action, "restrict");
  assert.ok(d.suggestModel);

  await moveAgent("tiered", "main-office");
  assert.equal((await policyCheck({ agent: "tiered", tool: "llm:x", model: "claude-opus-4" })).allow, true);
});

test("policy: bridges cannot forge governance events", async () => {
  for (const type of ["agent_moved", "approval_requested", "approval_resolved"]) {
    const r = await post("/event", { type, agent: "x", room: "server-room", approvalId: "ap-1", state: "approved" }, TOKENS.cloud);
    assert.equal(r.status, 400, type);
    assert.match((await r.json()).error, /internal-only/, type);
  }
});

test("policy: an unknown approval id is a 404, not a pass", async () => {
  assert.equal((await fetch(BASE + "/approvals/ap-does-not-exist", {
    headers: { Authorization: `Bearer ${TOKENS.owner}` },
  })).status, 404);
  const d = await policyCheck({ agent: "forger", tool: "deploy", approvalId: "ap-made-up" });
  assert.equal(d.allow, false);
});

// --- Guest confidentiality on the governance surface -----------------------
//
// v1 was careful about what a guest could see (sanitizeForGuest, guest-filtered
// roster). The governance endpoints added later initially used requireAny and
// handed read-only visitors the hourly AI spend and a complete map of the
// privilege boundaries. These tests exist so that cannot silently return.

const getAs = (path, token) =>
  fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());

test("guest: /burn discloses temperature but never amounts", async () => {
  const owner = await getAs("/burn", TOKENS.owner);
  const guest = await getAs("/burn", TOKENS.guest);

  assert.equal(guest.global.redacted, true);
  assert.equal(guest.global.spentHourUsd, 0);
  assert.equal(guest.global.spentDayUsd, 0);
  assert.equal(guest.global.lifetimeUsd, 0);
  // State still crosses, so the room can visibly catch fire for a guest.
  assert.equal(guest.global.state, owner.global.state);
  for (const a of guest.agents) {
    assert.equal(a.spentHourUsd, undefined, `${a.agent} spend must not reach a guest`);
    assert.equal(a.tokens, undefined);
  }
});

test("guest: /policy shows the building, not the privilege map", async () => {
  const guest = await getAs("/policy", TOKENS.guest);
  const blob = JSON.stringify(guest);

  for (const room of guest.rooms) {
    assert.equal(room.toolsAllow, undefined, "tool allow lists are recon");
    assert.equal(room.toolsDeny, undefined);
    assert.equal(room.approval, undefined, "which tools are gated is recon");
    assert.equal(room.budgetHourlyUsd, undefined);
    assert.equal(room.entryApproval, undefined);
    assert.ok(room.label, "but the room itself is still visible");
  }
  assert.ok(!blob.includes("kubectl"), "no gated tool name should appear");
  assert.ok(!blob.includes("terraform"));

  // The owner still sees everything.
  const owner = await getAs("/policy", TOKENS.owner);
  assert.ok(owner.rooms.find((r) => r.room === "server-room").approval.includes("kubectl"));
});

test("guest: /approvals shows a knock, not who wants which tool", async () => {
  await moveAgent("secretive", "server-room");
  const guest = await getAs("/approvals", TOKENS.guest);
  assert.ok(guest.pending.length > 0, "the knock is visible");
  for (const a of guest.pending) {
    assert.equal(a.agent, undefined, "agent identity must not reach a guest");
    assert.equal(a.tool, undefined, "nor which privileged tool is wanted");
    assert.equal(a.redacted, true);
  }
  const owner = await getAs("/approvals", TOKENS.owner);
  assert.ok(owner.pending.some((a) => a.agent === "secretive"));
});

test("guest: a single approval cannot be read at all", async () => {
  const held = await moveAgent("probe", "server-room");
  const { approvalId } = await held.json();
  assert.equal(
    (await fetch(BASE + `/approvals/${approvalId}`, {
      headers: { Authorization: `Bearer ${TOKENS.guest}` },
    })).status,
    403,
    "the detail view would re-expose exactly what the list redacts"
  );
});

test("guest: governance events over the socket are sanitized too", async () => {
  // Redacting the REST surface is pointless if the same facts stream over WS.
  const ws = await wsConnect(TOKENS.guest);
  await new Promise((r) => { setTimeout(r, 50); });

  await moveAgent("wsprobe", "main-office");
  await post("/event", {
    type: "tool_done", agentId: "wsprobe", tool: "llm:x",
    costUsd: 0.02, inputTokens: 1000,
  }, TOKENS.cloud);

  assert.ok(await waitFor(() => ws._frames.some((f) => f.data?.type === "agent_moved"), 3000));

  const moved = ws._frames.find((f) => f.data?.type === "agent_moved").data;
  assert.equal(moved.grantedBy, undefined, "who granted scope is not a guest's business");

  const approvals = ws._frames.filter((f) => f.data?.type === "approval_requested");
  for (const f of approvals) {
    assert.equal(f.data.agent, undefined);
    assert.equal(f.data.tool, undefined);
  }

  const budget = ws._frames.filter((f) => f.data?.type === "budget_state");
  for (const f of budget) {
    assert.equal(f.data.spentUsd, undefined, "spend figures must not stream to guests");
    assert.equal(f.data.limitUsd, undefined);
    assert.ok(f.data.state, "but the state still does");
  }
});

// --- Fase 4: Flight Recorder over HTTP ------------------------------------
//
// The unit tests in ledger.test.js cover the cryptography. These cover the
// part that is easy to get wrong in wiring: who may read the audit log, and
// whether decisions actually reach it.

test("ledger: the audit surface is owner-only, including for bridges", async () => {
  // A bridge token is held by every agent process. Agents are the *subjects*
  // of this record, so bridge access would let the watched read the watchlist.
  for (const path of ["/ledger", "/ledger/head", "/ledger/verify", "/dossier"]) {
    for (const [role, token] of [["guest", TOKENS.guest], ["bridge", TOKENS.cloud]]) {
      const r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` } });
      assert.equal(r.status, 403, `${role} must not reach ${path}`);
    }
    const ok = await fetch(BASE + path, { headers: { Authorization: `Bearer ${TOKENS.owner}` } });
    assert.equal(ok.status, 200, `owner should reach ${path}`);
  }
});

test("ledger: a refusal is recorded with enough detail to reconstruct it", async () => {
  await post("/policy/check",
    { agent: "auditme", tool: "terraform", model: "claude-sonnet-4-5" }, TOKENS.owner);

  const { records } = await getAs("/ledger?type=policy_decision&limit=5000", TOKENS.owner);
  const rec = records.reverse().find((r) => r.payload.agent === "auditme");
  assert.ok(rec, "the decision must reach the ledger");
  assert.equal(rec.payload.allow, false);
  assert.equal(rec.payload.tool, "terraform");
  assert.ok(rec.payload.reason, "a refusal without a recorded reason is not defensible");
  assert.ok(rec.payload.room, "the room determines the rule, so it must be recorded");
  assert.ok(rec.hash && rec.prevHash, "every record is chained");
});

test("ledger: the whole approval lifecycle lands in the chain", async () => {
  const held = await moveAgent("chainwalker", "server-room");
  const { approvalId } = await held.json();
  await post(`/approvals/${approvalId}`, { approve: true }, TOKENS.owner);

  const { records } = await getAs("/ledger?subject=chainwalker&limit=5000", TOKENS.owner);
  const types = records.map((r) => r.type);
  assert.ok(types.includes("approval_requested"), "the knock");
  assert.ok(types.includes("approval_resolved"), "the human decision");
  assert.ok(types.includes("agent_moved"), "and the scope change it caused");

  const resolved = records.find((r) => r.type === "approval_resolved");
  assert.equal(resolved.payload.decidedBy, "owner");
  assert.equal(typeof resolved.payload.waitedMs, "number", "Art. 14 needs the response time");
});

test("ledger: verification passes over a chain built by real traffic", async () => {
  const v = await getAs("/ledger/verify", TOKENS.owner);
  assert.equal(v.ok, true, `chain broke: ${v.reason} at ${v.brokenAt}`);
  assert.ok(v.checked > 0);

  const head = await getAs("/ledger/head", TOKENS.owner);
  assert.equal(head.hash, v.head, "the advertised head must match what verification computes");
  assert.match(head.hash, /^[0-9a-f]{64}$/);
});

test("ledger: exporting the dossier is itself recorded", async () => {
  const before = (await getAs("/ledger/head", TOKENS.owner)).seq;
  const r = await fetch(BASE + "/dossier?from=0", {
    headers: { Authorization: `Bearer ${TOKENS.owner}` },
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/markdown/);
  assert.match(r.headers.get("content-disposition"), /ai-act-dossier_/);

  const md = await r.text();
  assert.match(md, /# AI System Activity Dossier/);
  assert.match(md, /The log verifies/, "a live chain should verify");
  assert.match(md, /does \*not\*, by itself, prove/, "limits must be stated to the reader");

  const { records } = await getAs(`/ledger?limit=5000`, TOKENS.owner);
  const exportRec = records.find((x) => x.type === "dossier_exported" && x.seq > before);
  assert.ok(exportRec, "who pulled the audit log is itself auditable");
});

test("ledger: dossier rejects a nonsense period rather than guessing", async () => {
  const r = await fetch(BASE + "/dossier?from=9999999999999&to=0", {
    headers: { Authorization: `Bearer ${TOKENS.owner}` },
  });
  assert.equal(r.status, 400);
});

test("ledger: json format carries the structured summary", async () => {
  const j = await getAs("/dossier?from=0&format=json", TOKENS.owner);
  assert.ok(j.dossier.regulation.articles.length >= 3);
  assert.equal(j.integrity.algorithm, "SHA-256 over canonical JSON");
  assert.ok(j.integrity.doesNotProve.includes("tail"), "the caveat travels with the data too");
  assert.ok(Array.isArray(j.records));
  assert.ok(j.summary.total > 0);
});

test("policy/check: a looping agent is rate limited and fails closed", async () => {
  // OWASP LLM10 denial-of-wallet: the decision endpoint is the one an agent
  // stuck in a retry loop will hammer hardest.
  let limited = null;
  for (let i = 0; i < 700; i++) {
    const r = await post("/policy/check",
      { agent: "looper", tool: "web_search", model: "gpt-4o-mini" }, TOKENS.cloud);
    const j = await r.json();
    if (j.scope === "limiter") { limited = j; break; }
  }
  assert.ok(limited, "600/min should trip within 700 attempts");
  assert.equal(limited.allow, false, "the limiter must fail closed, not open");
  assert.equal(limited.action, "deny");
  assert.ok(limited.retryAfterS > 0);

  // One agent looping must not lock out the others.
  const other = await (await post("/policy/check",
    { agent: "bystander", tool: "web_search", model: "gpt-4o-mini" }, TOKENS.cloud)).json();
  assert.notEqual(other.scope, "limiter", "the limiter is keyed per agent");
});

// --- Auto-guest (upstream, Okt 2026) --------------------------------------
//
// GET / now mints a read-only guest session for any browser without one. The
// server is published through a Tailscale Funnel, so this makes "anonymous
// visitor on the public internet" and "guest" the same principal. Everything
// the Fase 3 review redacted from guests is now redacted from the whole
// internet — and these tests are the proof, because the redaction stopped
// being defence-in-depth and became the only boundary.

test("auto-guest: a tokenless browser is issued a read-only guest session", async () => {
  const r = await fetch(BASE + "/", { redirect: "manual" });
  const cookie = r.headers.get("set-cookie");
  assert.ok(cookie, "GET / should mint a session for an anonymous browser");
  assert.match(cookie, /office_session=/);
  assert.match(cookie, /HttpOnly/i, "the session cookie must not be readable from JS");
});

test("auto-guest: the minted session really is a guest, not an owner", async () => {
  const r = await fetch(BASE + "/", { redirect: "manual" });
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  assert.ok(cookie.startsWith("office_session="));

  const as = (path) => fetch(BASE + path, { headers: { Cookie: cookie } });

  // Owner-only governance surfaces must stay shut to the anonymous public.
  for (const path of ["/ledger", "/ledger/head", "/ledger/verify", "/dossier"]) {
    assert.equal((await as(path)).status, 403, `${path} must be closed to an anonymous visitor`);
  }
  assert.equal((await as("/approvals/ap-1-x")).status, 403);
});

test("auto-guest: an anonymous visitor cannot read spend figures or the privilege map", async () => {
  const r = await fetch(BASE + "/", { redirect: "manual" });
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  const get = async (p) => (await fetch(BASE + p, { headers: { Cookie: cookie } })).json();

  const burn = await get("/burn");
  assert.equal(burn.global.redacted, true, "the public internet must not see hourly AI spend");
  assert.equal(burn.global.spentHourUsd, 0);
  assert.equal(burn.global.lifetimeUsd, 0);

  const policy = await get("/policy");
  const blob = JSON.stringify(policy);
  assert.ok(!blob.includes("kubectl"), "nor a map of which tools are gated where");
  assert.ok(!blob.includes("terraform"));
  for (const room of policy.rooms) {
    assert.equal(room.approval, undefined);
    assert.equal(room.budgetHourlyUsd, undefined);
  }

  const approvals = await get("/approvals");
  for (const a of approvals.pending) {
    assert.equal(a.agent, undefined, "nor which agent is reaching past its scope");
    assert.equal(a.tool, undefined);
  }
});

test("auto-guest: an existing stronger session is never downgraded", async () => {
  // The owner's browser hitting / must keep its owner session.
  const r = await fetch(BASE + "/", {
    headers: { Authorization: `Bearer ${TOKENS.owner}` },
    redirect: "manual",
  });
  assert.equal(r.headers.get("set-cookie"), null, "an authenticated request must not be re-cookied as guest");
});

test("presence: an object-form agent is keyed by id/name, not [object Object]", async () => {
  // The event contract allows agent to be {name, id, role}. Keying a Map with
  // the object collapses every agent to one bucket; requiring a string drops
  // them silently. Both bugs existed — upstream had the first, this fork the
  // second.
  await post("/event", {
    type: "agent_spawned",
    agent: { name: "objectform", id: "objectform", role: "worker" },
  }, TOKENS.cloud);
  await new Promise((r) => { setTimeout(r, 150); });

  const presence = await getAs("/presence", TOKENS.owner);
  const keys = Object.keys(presence.agents || {});
  assert.ok(!keys.includes("[object Object]"), "the object must never become a Map key");
  assert.ok(keys.includes("objectform"), `object-form agent should be present, got: ${keys.join(", ")}`);
});

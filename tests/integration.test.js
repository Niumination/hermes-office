/**
 * Integration test: boots the real server on an ephemeral port with test tokens,
 * exercises HTTP auth, /event validation, WS broadcast, chat.
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

test("auth: 401 without token, 401 bad token, bridge ok on /event", async () => {
  assert.equal((await post("/event", { type: "tool_done", agentId: "x" })).status, 401);
  assert.equal((await post("/event", { type: "tool_done", agentId: "x" }, "wrong")).status, 401);
  assert.equal((await post("/event", { type: "tool_done", agentId: "x" }, "no-such-token")).status, 401);
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

test("owner cannot POST /event, an unknown token cannot POST /chat, owner can", async () => {
  assert.equal((await post("/event", { type: "tool_done", agentId: "x" }, TOKENS.owner)).status, 403);
  assert.equal((await post("/chat", { sender: "g", text: "hi" }, "no-such-token")).status, 401);
  const r = await post("/chat", { sender: "owner", text: "hello office" }, TOKENS.owner);
  assert.equal(r.status, 200);
});

test("WS: handshake hello, event broadcast carries the whole event", async () => {
  const owner = await wsConnect(TOKENS.owner);
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
  const lastOwner = ownerEv[ownerEv.length - 1]?.data;
  // A private repo name used to be rewritten to "[private]" for guest
  // sockets. With one principal the frame is the event, unedited — the
  // owner already knows which repos are theirs.
  assert.equal(lastOwner.type, "git_push");
  assert.equal(lastOwner.repo, "brain");
  assert.equal(lastOwner.url, "https://github.com/Niumination/brain");

  owner.close();
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

test("/roster: owner ok, unauthenticated 401", async () => {
  assert.equal((await fetch(BASE + "/roster")).status, 401);
  const r = await fetch(BASE + "/roster", { headers: { Authorization: `Bearer ${TOKENS.owner}` } });
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

test("otlp: requires a bridge token, rejects owner and anonymous", async () => {
  assert.equal((await postOtlp(otlpBody([]))).status, 401);
  assert.equal((await postOtlp(otlpBody([]), "wrong")).status, 401);
  assert.equal((await postOtlp(otlpBody([]), "no-such-token")).status, 401);
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

test("burn: an unknown token can neither read burn state nor ask for a decision", async () => {
  assert.equal((await fetch(BASE + "/budget/check", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer no-such-token" },
    body: JSON.stringify({ agent: "x" }),
  })).status, 401);
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
  assert.equal(j.defaultRoom, "belum-dipetakan");
  const sr = j.rooms.find((x) => x.room === "lightvela/infra");
  assert.equal(sr.entryApproval, true);
  assert.ok(sr.approval.includes("deploy"));
  assert.equal((await fetch(BASE + "/policy")).status, 401, "but not anonymously");
});

test("policy: an unassigned agent is confined to the lobby", async () => {
  const d = await policyCheck({ agent: "newcomer", tool: "deploy" });
  assert.equal(d.room, "belum-dipetakan");
  assert.equal(d.allow, false);
  assert.match(d.hint, /Infrastruktur & Monitoring/, "the denial says where it would be allowed");
});

test("policy: only an owner may grant scope by moving an agent", async () => {
  assert.equal((await moveAgent("mover", "mac/sites", TOKENS.cloud)).status, 403);
  assert.equal((await moveAgent("mover", "mac/sites", "no-such-token")).status, 401);
  const ok = await moveAgent("mover", "mac/sites", TOKENS.owner);
  assert.equal(ok.status, 200);
  assert.equal((await ok.json()).room, "mac/sites");
});

test("policy: moving an agent changes what it may do", async () => {
  assert.equal((await policyCheck({ agent: "scoped", tool: "write_file" })).allow, false);
  await moveAgent("scoped", "mac/sites");
  assert.equal((await policyCheck({ agent: "scoped", tool: "write_file" })).allow, true);
});

test("policy: a nonexistent room is rejected, never silently granted", async () => {
  const r = await moveAgent("ghost", "atlantis");
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /Unknown room/);
  assert.equal((await policyCheck({ agent: "ghost", tool: "bash" })).room, "belum-dipetakan");
});

test("policy: entering a privileged room is held at the door, then performed on approval", async () => {
  const held = await moveAgent("climber", "lightvela/infra");
  assert.equal(held.status, 202, "202 Accepted — the request exists but has not happened");
  const { approvalId } = await held.json();
  assert.ok(approvalId);

  // Still in the lobby while pending.
  assert.equal((await policyCheck({ agent: "climber", tool: "bash" })).room, "belum-dipetakan");

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
  assert.equal((await policyCheck({ agent: "climber", tool: "web_search" })).room, "lightvela/infra");
});

test("policy: a gated tool needs its own sign-off even inside the room", async () => {
  await moveAgent("op", "lightvela/infra");
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
  const held = await moveAgent("rejected", "lightvela/infra");
  const { approvalId } = await held.json();
  await fetch(BASE + `/approvals/${approvalId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKENS.owner}` },
    body: JSON.stringify({ approve: false }),
  });
  assert.equal((await policyCheck({ agent: "rejected", tool: "web_search" })).room, "belum-dipetakan");

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

  await moveAgent("tiered", "mac/sites");
  assert.equal((await policyCheck({ agent: "tiered", tool: "llm:x", model: "claude-opus-4" })).allow, true);
});

test("policy: bridges cannot forge governance events", async () => {
  for (const type of ["agent_moved", "approval_requested", "approval_resolved"]) {
    const r = await post("/event", { type, agent: "x", room: "lightvela/infra", approvalId: "ap-1", state: "approved" }, TOKENS.cloud);
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

// --- One principal: the governance surface answers the owner or nobody ----
//
// v1 served a softened view to a `guest` role: burn without amounts, the
// building without the privilege map, a knock without the knocker. That role
// is gone — this office has one occupant — and with it the whole redaction
// path. What used to be "a visitor sees less" is now "a visitor sees
// nothing", and these tests hold that line, because a half-removed guest
// mode is worse than either end state: dead branches that still parse, still
// ship, and quietly come back.

const getAs = (path, token) =>
  fetch(BASE + path, { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json());

const statusAs = (path, token) =>
  fetch(BASE + path, token ? { headers: { Authorization: `Bearer ${token}` } } : undefined)
    .then((r) => r.status);

test("no guest token exists: a former guest credential is just a bad token", async () => {
  // The exact string the old suite used. It must now authenticate as nothing.
  assert.equal(await statusAs("/policy", "guest-test-token-dddd"), 401);
  assert.equal(await statusAs("/burn", "guest-test-token-dddd"), 401);
});

test("the governance surface is 401 to anyone without a token", async () => {
  for (const path of ["/burn", "/policy", "/approvals", "/tasks", "/roster", "/desks"]) {
    assert.equal(await statusAs(path), 401, `${path} must not answer an anonymous caller`);
  }
});

test("the owner sees whole objects — nothing is redacted on the way out", async () => {
  // The mirror image of the old guest tests: every field they asserted was
  // blanked must now be present and real for the only principal left.
  const burn = await getAs("/burn", TOKENS.owner);
  assert.equal(burn.global.redacted, undefined, "no redaction marker should survive");
  assert.equal(typeof burn.global.spentHourUsd, "number");
  assert.equal(typeof burn.global.lifetimeUsd, "number");

  const policy = await getAs("/policy", TOKENS.owner);
  assert.ok(
    policy.rooms.find((r) => r.room === "lightvela/infra").approval.includes("kubectl"),
    "the privilege map is the owner's to read"
  );
  for (const room of policy.rooms) {
    assert.equal(room.redacted, undefined);
  }
});

test("approvals name the agent and the tool for the owner", async () => {
  await moveAgent("secretive", "lightvela/infra");
  const owner = await getAs("/approvals", TOKENS.owner);
  assert.ok(owner.pending.some((a) => a.agent === "secretive"));
  for (const a of owner.pending) assert.equal(a.redacted, undefined);
});

test("a single approval is readable by the owner and nobody else", async () => {
  const held = await moveAgent("probe", "lightvela/infra");
  const { approvalId } = await held.json();
  assert.equal(await statusAs(`/approvals/${approvalId}`), 401);
  assert.equal(await statusAs(`/approvals/${approvalId}`, TOKENS.owner), 200);
});

test("the socket streams whole events — there is no second frame shape", async () => {
  // Redaction used to be applied per connection in frameFor(). With one
  // principal there is exactly one frame, and governance detail rides in it.
  const ws = await wsConnect(TOKENS.owner);
  await new Promise((r) => { setTimeout(r, 50); });

  await moveAgent("wsprobe", "mac/sites");
  await post("/event", {
    type: "tool_done", agentId: "wsprobe", tool: "llm:x",
    costUsd: 0.02, inputTokens: 1000,
  }, TOKENS.cloud);

  assert.ok(await waitFor(() => ws._frames.some((f) => f.data?.type === "agent_moved"), 3000));

  const budget = ws._frames.filter((f) => f.data?.type === "budget_state");
  for (const f of budget) {
    assert.ok(f.data.state, "state still streams");
  }
  ws.close();
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
    for (const [role, token] of [["bridge", TOKENS.cloud], ["mac-bridge", TOKENS.mac]]) {
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
  const held = await moveAgent("chainwalker", "lightvela/infra");
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

// --- Auto-session: the door must not open itself to the internet ---------
//
// `GET /` may hand a browser an owner session with no token, but only when
// the visitor is genuinely inside the network boundary. Getting this wrong
// is not a small bug: an owner cookie for everyone cannot be closed by
// rotating credentials, because no credential is involved.
//
// It was wrong in production. The comments claimed UFW and the Cloudflare
// tunnel meant "anyone reaching this handler is already inside". They do
// not. The tunnel runs on the office host, so a visitor from the open
// internet arrives at the socket as 127.0.0.1, identical to a local
// browser. For a time, an anonymous request to dash.abstract.biz.id was
// issued an owner cookie and answered 200 on /ledger and /dossier.
//
// So the gate is two conditions, both defaulting to refusal: the peer must
// be in OFFICE_AUTO_SESSION_CIDRS, and the request must not carry proxy
// headers. The test server sets no CIDRs, which is the shipped default.

test("auto-session is off by default: GET / mints nothing", async () => {
  const r = await fetch(BASE + "/", { redirect: "manual" });
  assert.equal(r.status, 200, "the shell is still public");
  assert.equal(r.headers.get("set-cookie"), null,
    "no owner cookie may be handed out when OFFICE_AUTO_SESSION_CIDRS is unset");
});

test("auto-session refuses anything that arrived through a proxy", async () => {
  // Even with loopback allowlisted, these headers prove the peer address is
  // a tunnel rather than the visitor, so the address proves nothing.
  for (const h of [
    { "X-Forwarded-For": "203.0.113.9" },
    { "CF-Connecting-IP": "203.0.113.9" },
    { "CF-Ray": "8f2a1b3c4d5e6f70-SIN" },
    { "True-Client-IP": "203.0.113.9" },
    { "X-Real-IP": "203.0.113.9" },
    { Forwarded: "for=203.0.113.9" },
  ]) {
    const r = await fetch(BASE + "/", { headers: h, redirect: "manual" });
    assert.equal(r.headers.get("set-cookie"), null,
      `a request carrying ${Object.keys(h)[0]} must never be auto-sessioned`);
  }
});

test("the gate itself: mayAutoSession refuses by default and by proxy", async () => {
  const { mayAutoSession } = await import("../server/auth.js");
  const local = { socket: { remoteAddress: "127.0.0.1" }, headers: {} };
  assert.equal(mayAutoSession(local), false, "empty allowlist means nobody");
  assert.equal(mayAutoSession({ ...local, headers: { "x-forwarded-for": "1.2.3.4" } }), false);
  assert.equal(mayAutoSession({ socket: {}, headers: {} }), false, "no address means no");
  assert.equal(mayAutoSession({}), false, "a malformed request means no");
});

test("a full session table evicts the oldest, it never locks the owner out", async () => {
  // The bounded table once returned null when full, so 1001 visits in a 12h
  // window meant the owner's own /auth/session answered 429 until the TTL
  // expired. Availability is part of security when the lock is the only way in.
  const { createSession } = await import("../server/auth.js");
  let last = null;
  for (let i = 0; i < 1200; i++) last = createSession("t" + i);
  assert.ok(last, "the 1200th session must still be issued");
});

test("the session cookie is marked Secure when the request arrived over TLS", async () => {
  const { sessionCookieHeader, isSecureRequest } = await import("../server/auth.js");
  assert.match(sessionCookieHeader("x", { secure: true }), /; Secure/);
  assert.doesNotMatch(sessionCookieHeader("x"), /; Secure/);
  assert.equal(isSecureRequest({ headers: { "x-forwarded-proto": "https" } }), true);
  assert.equal(isSecureRequest({ headers: { "x-forwarded-proto": "https,http" } }), true);
  assert.equal(isSecureRequest({ headers: { "x-forwarded-proto": "http" } }), false);
  assert.equal(isSecureRequest({ headers: {} }), false);
});

test("an anonymous browser can read nothing but the shell", async () => {
  // Without a session cookie (e.g. a direct curl to a data route, or a
  // browser that never hit GET /) nothing is served.
  for (const path of ["/burn", "/policy", "/approvals", "/tasks", "/roster",
                      "/ledger", "/ledger/head", "/dossier", "/presence"]) {
    const st = (await fetch(BASE + path)).status;
    assert.ok(st === 401 || st === 403, `${path} answered ${st} to an anonymous visitor`);
  }
});

test("an anonymous browser cannot bootstrap owner access via GET /", async () => {
  // The whole production failure in one assertion: visit the front page like
  // a browser, keep whatever cookie you are given, then try the owner-only
  // routes with it.
  const r = await fetch(BASE + "/", { redirect: "manual" });
  const cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  for (const path of ["/ledger", "/dossier", "/presence"]) {
    const st = (await fetch(BASE + path,
      cookie ? { headers: { Cookie: cookie } } : undefined)).status;
    assert.ok(st === 401 || st === 403,
      `${path} answered ${st} to a browser that only visited the front page`);
  }
});

test("/health stays open — it is how the tunnel knows the office is alive", async () => {
  assert.equal((await fetch(BASE + "/health")).status, 200);
});

test("an owner session is created only by presenting the owner token", async () => {
  const r = await fetch(BASE + "/auth/session", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKENS.owner}` },
  });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("set-cookie") || "", /office_session=/);
  assert.match(r.headers.get("set-cookie") || "", /HttpOnly/i);

  const bad = await fetch(BASE + "/auth/session", {
    method: "POST",
    headers: { Authorization: "Bearer not-a-real-token" },
  });
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get("set-cookie"), null);
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

// --- an agent that works shows up on the floor plan -------------------------
//
// Nothing but the owner-only POST /agents/:agent/room ever called assign(), so
// on a live instance every room reported zero occupants while agents worked.
// The office rendered empty and the floor plan described a building nobody was
// in. These exercise the real server end to end: a bridge posts an event, and
// the policy document must then place that agent.

test("an event from a bridge places its agent in the default room", async () => {
  const before = await getAs("/policy", TOKENS.owner);
  const lobbyBefore = before.rooms.find((r) => r.room === "belum-dipetakan");
  assert.ok(
    !lobbyBefore.occupants.some((o) => o.agent === "freshling"),
    "precondition: agent is not on the floor yet",
  );

  const res = await post("/event", { type: "tool_call", agentId: "freshling", tool: "bash" }, TOKENS.cloud);
  assert.equal(res.status, 200);

  await waitFor(async () => {
    const snap = await getAs("/policy", TOKENS.owner);
    const lobby = snap.rooms.find((r) => r.room === "belum-dipetakan");
    return lobby.occupants.some((o) => o.agent === "freshling");
  });

  const after = await getAs("/policy", TOKENS.owner);
  const placed = after.rooms
    .find((r) => r.room === "belum-dipetakan")
    .occupants.find((o) => o.agent === "freshling");
  assert.equal(placed.grantedBy, "auto", "the placement records that nobody signed for it");
});

test("auto-placement never promotes an agent out of the room it was put in", async () => {
  // The whole safety argument for auto-placement is that it only ever writes
  // defaultRoom, so it cannot grant scope. If a later event could re-place an
  // agent, a bridge could walk itself upstairs by emitting events.
  await post("/event", { type: "tool_call", agentId: "climber", tool: "bash" }, TOKENS.cloud);
  await waitFor(async () => {
    const s = await getAs("/policy", TOKENS.owner);
    return s.rooms.find((r) => r.room === "belum-dipetakan").occupants.some((o) => o.agent === "climber");
  });

  const moved = await fetch(BASE + "/agents/climber/room", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKENS.owner}` },
    body: JSON.stringify({ room: "mac/sites" }),
  });
  assert.equal(moved.status, 200);

  // More events arrive after the owner moved it. It must stay where it was put.
  await post("/event", { type: "tool_done", agentId: "climber" }, TOKENS.cloud);
  await post("/event", { type: "tool_call", agentId: "climber", tool: "bash" }, TOKENS.cloud);

  const snap = await getAs("/policy", TOKENS.owner);
  const lobby = snap.rooms.find((r) => r.room === "belum-dipetakan");
  const office = snap.rooms.find((r) => r.room === "mac/sites");
  assert.ok(!lobby.occupants.some((o) => o.agent === "climber"), "not dragged back to lobby");
  assert.ok(office.occupants.some((o) => o.agent === "climber"), "stays where the owner put it");
});

test("the watchdog's own away event does not place a forgotten agent", async () => {
  // agent_status/away is emitted by the server itself with source 'system'.
  // Treating it as proof of life would both revive offline agents and, now,
  // re-place agents the operator had removed.
  const snap = await getAs("/policy", TOKENS.owner);
  const everyone = snap.rooms.flatMap((r) => r.occupants.map((o) => o.agent));
  assert.ok(!everyone.includes("[object Object]"), "object-form agents are normalised, not stringified");
});

// ---------------------------------------------------------------------------
// Same-origin is not a cross-origin request
//
// Regression tests for the bug that served a blank page in production. Vite
// stamps `crossorigin` on the module script and stylesheet it emits, so a real
// browser sends an Origin header even when fetching the page's own bundle. The
// allowlist did not contain the production domain, both assets came back 403,
// and #root stayed empty. curl sends no Origin and so never reproduced it —
// which is exactly how every gate stayed green over a dead site.
//
// ALLOWED_ORIGINS for this suite is only "http://localhost:5173", so the
// server's own origin below is deliberately NOT allowlisted. These assertions
// fail against the old middleware.
// ---------------------------------------------------------------------------

const SELF_ORIGIN = `http://127.0.0.1:${PORT}`;

test("a browser fetching this host's own bundle is not refused", async () => {
  const r = await fetch(BASE + "/health", { headers: { Origin: SELF_ORIGIN } });
  assert.notEqual(r.status, 403, "same-origin request answered 403");
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), SELF_ORIGIN);
});

test("the HTML shell itself survives an Origin header", async () => {
  // GET / is what the browser asks for first. If this 403s there is no page at
  // all, which is the state the live site was actually in.
  const r = await fetch(BASE + "/", { headers: { Origin: SELF_ORIGIN } });
  assert.notEqual(r.status, 403, "the shell refused its own origin");
});

test("an unrelated origin is still refused", async () => {
  // The fix must not become an allow-all. This is the half that still says no.
  const r = await fetch(BASE + "/health", { headers: { Origin: "https://jahat.example" } });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, "Origin tidak diizinkan");
});

test("a different port on the same hostname is still cross-origin", async () => {
  // Origin is scheme+host+port. Same host, other port = another origin, and
  // loosening the check to a hostname comparison would quietly allow it.
  const r = await fetch(BASE + "/health", { headers: { Origin: `http://127.0.0.1:${PORT + 1}` } });
  assert.equal(r.status, 403);
});

test("an explicitly allowlisted origin still works", async () => {
  const r = await fetch(BASE + "/health", { headers: { Origin: "http://localhost:5173" } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("access-control-allow-origin"), "http://localhost:5173");
});

test("a malformed or opaque Origin is refused, not crashed on", async () => {
  // `Origin: null` is what a sandboxed iframe or a file:// page sends. new URL()
  // throws on it; an unguarded parse would turn a 403 into a 500.
  for (const bad of ["null", "not a url", "javascript:alert(1)"]) {
    const r = await fetch(BASE + "/health", { headers: { Origin: bad } });
    assert.equal(r.status, 403, `Origin '${bad}' should be refused`);
  }
});

test("the socket accepts its own origin so the office can go online", async () => {
  // wsClients stayed 0 in production for the same reason. An office that serves
  // a shell but never connects reads as 'every agent offline', which looks like
  // a flaky socket instead of an origin check.
  const ws = await wsConnect(TOKENS.owner, SELF_ORIGIN);
  assert.equal(ws.readyState, WebSocket.OPEN);
  ws.close();
});

test("the socket still refuses a stranger's origin", async () => {
  await assert.rejects(
    () => wsConnect(TOKENS.owner, "https://jahat.example"),
    /403|Unexpected server response/,
  );
});

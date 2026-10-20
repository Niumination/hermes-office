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
      OFFICE_AUTO_SESSION_CIDRS: "",
      OFFICE_TRUSTED_PROXIES: "",
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
      OFFICE_AUTO_SESSION_CIDRS: "",
      OFFICE_TRUSTED_PROXIES: "",
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


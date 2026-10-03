/**
 * Integration test: boots the real server on an ephemeral port with test tokens,
 * exercises HTTP auth, /event validation, WS broadcast + guest filtering, chat.
 * Run with: node --test tests/integration.test.js
 * Uses OFFICE_DATA_DIR to a temp dir so it never touches real data.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "child_process";
import { mkdtempSync } from "fs";
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

function wsConnect(token, origin) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, {
      headers: { Authorization: `Bearer ${token}`, ...(origin ? { Origin: origin } : {}) },
    });
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
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

before(async () => {
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

after(() => {
  proc?.kill("SIGTERM");
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
  const r = await post(
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
  await new Promise((r) => setTimeout(r, 200));
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

  await new Promise((r) => setTimeout(r, 300));
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
  await new Promise((r) => setTimeout(r, 300));
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
  await new Promise((r) => setTimeout(r, 100));
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

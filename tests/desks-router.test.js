/**
 * Tahap 2 router tests — the assembly, not the ingredients.
 *
 * tests/desks-actions.test.js covers parseActions/runAction/cooldownRemaining
 * as pure functions, and covers them well. It still missed a live defect: the
 * router recorded the cooldown *after* awaiting the action, so concurrent
 * POSTs all passed the check and all spawned. Five requests, five processes.
 *
 * The lesson is the reason this file exists. Guards are properties of the
 * route handler — ordering, auth, what leaves in the response body — and a
 * unit test of the helper cannot see any of them. These tests drive real HTTP
 * against a real Express app with the real auth middleware.
 *
 * The listener binds port 0 (kernel-assigned). A fixed port makes a test fail
 * for reasons that have nothing to do with the code under test.
 */
import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";

// auth.js builds its token table at module load from config, which reads env
// at ITS load. So the env has to exist before the first import of the chain —
// hence dynamic import below rather than a static one at the top of the file.
process.env.OFFICE_OWNER_TOKEN = "owner-router-test-token";
process.env.OFFICE_GUEST_TOKEN = "guest-router-test-token";

let createDesksRouter;
let server;
let base;

/** A board stub: the router only ever touches these four fields. */
function makeBoard(actions) {
  return {
    desks: [{ id: "pos-a", label: "Pos A" }],
    problems: [],
    pollMs: 30_000,
    actionsByDesk: new Map([["pos-a", actions]]),
    lastRun: new Map(),
    snapshot: () => [],
  };
}

const ACTION = { id: "restart", label: "Mulai ulang", run: ["true"], timeoutMs: 1000, cooldownMs: 60_000, confirm: true };

function post(path, token) {
  return fetch(base + path, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

/** Mount a fresh app per test so cooldown state never leaks between them. */
async function mount(board, opts) {
  const app = express();
  app.use("/desks", createDesksRouter(board, opts));
  await new Promise((r) => { server = app.listen(0, "127.0.0.1", r); });
  base = `http://127.0.0.1:${server.address().port}`;
}

before(async () => {
  ({ createDesksRouter } = await import("../server/desks.js"));
});

after(() => { server?.close(); });

describe("desks action router — the guards live here, not in the helpers", () => {
  test("concurrent POSTs spawn the action ONCE; the rest get 429", async (t) => {
    const board = makeBoard([ACTION]);
    let spawned = 0;
    await mount(board, {
      runActionImpl: async () => {
        spawned++;
        await new Promise((r) => { setTimeout(r, 50); }); // the action takes time
        return { ok: true, exitCode: 0, ms: 50, error: null };
      },
    });
    t.after(() => server.close());

    const res = await Promise.all(
      [1, 2, 3, 4, 5].map(() => post("/desks/pos-a/actions/restart", process.env.OFFICE_OWNER_TOKEN)),
    );
    const codes = res.map((r) => r.status).sort();

    assert.equal(spawned, 1, "the cooldown must hold while the action is still running");
    assert.deepEqual(codes, [200, 429, 429, 429, 429]);
  });

  test("a completed run still blocks the next one", async (t) => {
    const board = makeBoard([ACTION]);
    await mount(board, {
      runActionImpl: async () => ({ ok: true, exitCode: 0, ms: 1, error: null }),
    });
    t.after(() => server.close());

    const first = await post("/desks/pos-a/actions/restart", process.env.OFFICE_OWNER_TOKEN);
    const second = await post("/desks/pos-a/actions/restart", process.env.OFFICE_OWNER_TOKEN);
    assert.equal(first.status, 200);
    assert.equal(second.status, 429);
    assert.match((await second.json()).error, /cooldown/);
  });

  test("a guest gets 403, and learns nothing about which actions exist", async (t) => {
    const board = makeBoard([ACTION]);
    let spawned = 0;
    await mount(board, { runActionImpl: async () => { spawned++; return { ok: true, exitCode: 0, ms: 1, error: null }; } });
    t.after(() => server.close());

    // Both a real and an imaginary action must answer identically: 403 before
    // any lookup. A guest who can tell "action not found" from "forbidden" can
    // enumerate the owner's action list through the error code alone.
    const real = await post("/desks/pos-a/actions/restart", process.env.OFFICE_GUEST_TOKEN);
    const fake = await post("/desks/pos-a/actions/tidak-ada", process.env.OFFICE_GUEST_TOKEN);
    assert.equal(real.status, 403);
    assert.equal(fake.status, 403);
    assert.equal(spawned, 0);
  });

  test("no token is 401, not 403", async (t) => {
    await mount(makeBoard([ACTION]), { runActionImpl: async () => ({ ok: true, exitCode: 0, ms: 1, error: null }) });
    t.after(() => server.close());
    assert.equal((await post("/desks/pos-a/actions/restart", null)).status, 401);
  });

  test("unknown desk and unknown action are both 404", async (t) => {
    await mount(makeBoard([ACTION]), { runActionImpl: async () => ({ ok: true, exitCode: 0, ms: 1, error: null }) });
    t.after(() => server.close());
    assert.equal((await post("/desks/tidak-ada/actions/restart", process.env.OFFICE_OWNER_TOKEN)).status, 404);
    assert.equal((await post("/desks/pos-a/actions/tidak-ada", process.env.OFFICE_OWNER_TOKEN)).status, 404);
  });

  test("a failing action is still written to the ledger", async (t) => {
    const board = makeBoard([ACTION]);
    const recorded = [];
    await mount(board, {
      runActionImpl: async () => ({ ok: false, exitCode: 3, ms: 7, error: null }),
      recordImpl: (type, payload) => recorded.push({ type, payload }),
    });
    t.after(() => server.close());

    const res = await post("/desks/pos-a/actions/restart", process.env.OFFICE_OWNER_TOKEN);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).exitCode, 3);
    assert.equal(recorded.length, 1, "a failed action is evidence too");
    assert.equal(recorded[0].payload.allow, false);
  });

  test("a ledger that throws does not deny an action that already ran", async (t) => {
    await mount(makeBoard([ACTION]), {
      runActionImpl: async () => ({ ok: true, exitCode: 0, ms: 1, error: null }),
      recordImpl: () => { throw new Error("ledger is down"); },
    });
    t.after(() => server.close());

    // The process already ran. Returning 500 here would tell the owner it did
    // not happen, which is a worse lie than a missing ledger row.
    const res = await post("/desks/pos-a/actions/restart", process.env.OFFICE_OWNER_TOKEN);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  });

  test("the response body never carries stdout or stderr", async (t) => {
    await mount(makeBoard([ACTION]), {
      runActionImpl: async () => ({
        ok: true, exitCode: 0, ms: 1, error: null,
        stdout: "TOKEN=rahasia-sekali", stderr: "/home/owner/jalur-internal",
      }),
    });
    t.after(() => server.close());

    const body = await (await post("/desks/pos-a/actions/restart", process.env.OFFICE_OWNER_TOKEN)).text();
    assert.ok(!body.includes("rahasia-sekali"), "stdout must not reach the client");
    assert.ok(!body.includes("jalur-internal"), "stderr must not reach the client");
    assert.deepEqual(Object.keys(JSON.parse(body)).sort(), ["error", "exitCode", "ms", "ok"]);
  });
});

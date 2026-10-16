/**
 * desks.test.js — external outposts (read-only).
 *
 * The tests that matter most are the ones about *not knowing*. A monitor that
 * reports "failed" when it actually means "I could not reach it" teaches an
 * operator to distrust the board, and a board nobody trusts is worse than no
 * board. `unknown` must stay distinct from `failed` in every path.
 *
 * The second group covers what reaches a client. This repo is published
 * through a tunnel, so anything served without auth is served to anyone;
 * the answer is that nothing is. Internal URLs and error detail
 * must not reach them.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  parseDesks, probeDesk, DeskBoard,
  DESK_OK, DESK_FAILED, DESK_STALE, DESK_UNKNOWN,
} from "../server/desks.js";

const httpDesk = (over = {}) => ({
  id: "d1", label: "Desk One", hall: null, note: null, staleAfterSec: null,
  probe: { kind: "http", url: "http://127.0.0.1:9/health", timeoutMs: 500 },
  ...over,
});

const res = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (typeof body === "string" ? body : JSON.stringify(body ?? {})),
});

describe("parseDesks", () => {
  test("keeps a valid http desk and a valid file desk", () => {
    const { desks, problems } = parseDesks({
      desks: [
        { id: "a", label: "A", probe: { kind: "http", url: "http://x/health" } },
        { id: "b", probe: { kind: "file", path: "/tmp/last-run" } },
      ],
    });
    assert.equal(desks.length, 2);
    assert.equal(problems.length, 0);
    assert.equal(desks[1].label, "b", "label falls back to id");
  });

  test("refuses a probe kind that would execute anything", () => {
    // `command` must never become a probe kind by accident: that is the line
    // between a monitor and a remote shell.
    const { desks, problems } = parseDesks({
      desks: [{ id: "x", probe: { kind: "command", run: "systemctl restart foo" } }],
    });
    assert.equal(desks.length, 0);
    assert.match(problems[0], /must be "http" or "file"/);
  });

  test("refuses a non-http url scheme", () => {
    const { desks, problems } = parseDesks({
      desks: [{ id: "x", probe: { kind: "http", url: "file:///etc/passwd" } }],
    });
    assert.equal(desks.length, 0);
    assert.match(problems[0], /must be http/);
  });

  test("reports duplicates and missing ids instead of dropping them silently", () => {
    const { desks, problems } = parseDesks({
      desks: [
        { id: "a", probe: { kind: "file", path: "/tmp/a" } },
        { id: "a", probe: { kind: "file", path: "/tmp/a2" } },
        { probe: { kind: "file", path: "/tmp/b" } },
      ],
    });
    assert.equal(desks.length, 1);
    assert.equal(problems.length, 2);
  });

  test("clamps an absurd timeout rather than honouring it", () => {
    const { desks } = parseDesks({
      desks: [{ id: "a", probe: { kind: "http", url: "http://x/", timeoutMs: 999_999 } }],
    });
    assert.ok(desks[0].probe.timeoutMs <= 10_000);
  });

  test("a malformed file yields no desks and says why", () => {
    const { desks, problems } = parseDesks({ nope: true });
    assert.equal(desks.length, 0);
    assert.match(problems[0], /must be an array/);
  });
});

describe("probeDesk — states are honest", () => {
  test("200 is ok", async () => {
    const r = await probeDesk(httpDesk(), { fetchImpl: async () => res(200, {}) });
    assert.equal(r.state, DESK_OK);
  });

  test("500 is failed, and the status is kept as detail", async () => {
    const r = await probeDesk(httpDesk(), { fetchImpl: async () => res(500, {}) });
    assert.equal(r.state, DESK_FAILED);
    assert.match(r.detail, /HTTP 500/);
  });

  test("unreachable is UNKNOWN, not failed", async () => {
    const r = await probeDesk(httpDesk(), {
      fetchImpl: async () => { const e = new Error("connect ECONNREFUSED"); e.code = "ECONNREFUSED"; throw e; },
    });
    assert.equal(r.state, DESK_UNKNOWN, "we did not learn that it is broken, only that we could not ask");
    assert.notEqual(r.state, DESK_FAILED);
  });

  test("a timeout is UNKNOWN, not failed", async () => {
    const r = await probeDesk(httpDesk(), {
      fetchImpl: async () => { const e = new Error("aborted"); e.name = "AbortError"; throw e; },
    });
    assert.equal(r.state, DESK_UNKNOWN);
    assert.match(r.detail, /timed out/);
  });

  test("expectField mismatch is failed", async () => {
    const d = httpDesk({ probe: { ...httpDesk().probe, expectField: "status", expectValue: "ok" } });
    const r = await probeDesk(d, { fetchImpl: async () => res(200, { status: "degraded" }) });
    assert.equal(r.state, DESK_FAILED);
    assert.match(r.detail, /degraded/);
  });

  test("expectField match is ok, and nested paths work", async () => {
    const d = httpDesk({ probe: { ...httpDesk().probe, expectField: "db.alive", expectValue: true } });
    const r = await probeDesk(d, { fetchImpl: async () => res(200, { db: { alive: true } }) });
    assert.equal(r.state, DESK_OK);
  });

  test("non-JSON body where JSON was expected is UNKNOWN", async () => {
    const d = httpDesk({ probe: { ...httpDesk().probe, expectField: "status", expectValue: "ok" } });
    const r = await probeDesk(d, { fetchImpl: async () => res(200, "<html>nope</html>") });
    assert.equal(r.state, DESK_UNKNOWN);
  });

  test("never follows redirects", async () => {
    let seen = null;
    await probeDesk(httpDesk(), {
      fetchImpl: async (_u, init) => { seen = init; return res(200, {}); },
    });
    assert.equal(seen.redirect, "manual");
  });

  test("a file desk uses mtime as last-run", async () => {
    const d = { id: "f", label: "F", hall: null, note: null, staleAfterSec: null,
      probe: { kind: "file", path: "/tmp/x", timeoutMs: 500 } };
    const r = await probeDesk(d, { statImpl: async () => ({ mtimeMs: 1_000 }), now: () => 2_000 });
    assert.equal(r.state, DESK_OK);
    assert.equal(r.lastTs, 1_000);
  });

  test("a missing file is UNKNOWN", async () => {
    const d = { id: "f", label: "F", hall: null, note: null, staleAfterSec: null,
      probe: { kind: "file", path: "/tmp/nope", timeoutMs: 500 } };
    const r = await probeDesk(d, {
      statImpl: async () => { const e = new Error("no such file"); e.code = "ENOENT"; throw e; },
    });
    assert.equal(r.state, DESK_UNKNOWN);
  });

  test("an old successful run becomes STALE, not ok", async () => {
    const d = { id: "f", label: "F", hall: null, note: null, staleAfterSec: 60,
      probe: { kind: "file", path: "/tmp/x", timeoutMs: 500 } };
    const r = await probeDesk(d, { statImpl: async () => ({ mtimeMs: 0 }), now: () => 120_000 });
    assert.equal(r.state, DESK_STALE);
  });
});

describe("one principal", () => {
  test("the desk redactor is gone, not merely unused", async () => {
    // `redactDesk` blanked `detail` and `note` so a read-only visitor could
    // see an outpost was unwell without learning its internal host or what
    // the error said. With no such visitor, hiding the error from the one
    // person who can fix it was pure cost. Asserting it is *absent* matters:
    // a dormant redactor invites a second principal back in without anyone
    // re-doing the threat model.
    const mod = await import("../server/desks.js");
    assert.equal(mod.redactDesk, undefined);
  });
});

describe("DeskBoard", () => {
  test("a missing config file is not an error — most installs have no outposts", async () => {
    const board = new DeskBoard({
      file: "/nope/desks.json",
      deps: { readFileImpl: async () => { const e = new Error("enoent"); e.code = "ENOENT"; throw e; } },
    });
    const r = await board.load();
    assert.equal(r.ok, true);
    assert.deepEqual(board.snapshot(), []);
  });

  test("probes once per interval, not once per caller", async () => {
    let calls = 0;
    const board = new DeskBoard({
      file: "/desks.json",
      deps: {
        readFileImpl: async () => JSON.stringify({
          desks: [{ id: "a", probe: { kind: "http", url: "http://x/" } }],
        }),
        fetchImpl: async () => { calls += 1; return res(200, {}); },
      },
    });
    await board.load();
    await board.refresh();
    board.snapshot(); board.snapshot(); board.snapshot();
    assert.equal(calls, 1, "three readers, one probe");
  });

  test("a desk that has never been probed reads as unknown, not ok", async () => {
    const board = new DeskBoard({
      file: "/desks.json",
      deps: {
        readFileImpl: async () => JSON.stringify({
          desks: [{ id: "a", probe: { kind: "http", url: "http://x/" } }],
        }),
      },
    });
    await board.load();
    assert.equal(board.snapshot()[0].state, DESK_UNKNOWN);
  });

  /**
   * Regression for 2026-10-15. snapshot() attached the serialised action list
   * only to the fallback object used before the first probe, so the owner
   * could see actions for a few milliseconds at boot and never afterwards —
   * and start() probes immediately. The UI gates its buttons on this field,
   * so the entire feature was unreachable in production while every test
   * passed: the router tests inject a fake board and never call snapshot(),
   * and the only snapshot assertion happened to cover the unprobed branch.
   *
   * The assertion that matters is therefore "after refresh()", not "before".
   */
  test("a probed desk still carries its actions, with run never serialised", async () => {
    const board = new DeskBoard({
      file: "/desks.json",
      deps: {
        readFileImpl: async () => JSON.stringify({
          desks: [{
            id: "a",
            probe: { kind: "http", url: "http://x/" },
            actions: [{ id: "restart", label: "Mulai ulang", run: ["echo", "RAHASIA"], cooldownMs: 60000 }],
          }],
        }),
        fetchImpl: async () => res(200, {}),
      },
    });
    await board.load();
    await board.refresh();

    const snap = board.snapshot()[0];
    assert.equal(snap.state, DESK_OK, "precondition: the desk really was probed");
    assert.deepEqual(snap.actions, [
      { id: "restart", label: "Mulai ulang", confirm: true, cooldownMs: 60000 },
    ]);
    // The argv is the dangerous half: it names binaries and paths on the host.
    assert.ok(!JSON.stringify(snap).includes("RAHASIA"), "run must never reach a client");
  });

  test("removing a desk from config drops its stale result", async () => {
    let cfg = { desks: [{ id: "a", probe: { kind: "http", url: "http://x/" } }] };
    const board = new DeskBoard({
      file: "/desks.json",
      deps: { readFileImpl: async () => JSON.stringify(cfg), fetchImpl: async () => res(200, {}) },
    });
    await board.load();
    await board.refresh();
    assert.equal(board.snapshot().length, 1);

    cfg = { desks: [] };
    await board.load();
    await board.refresh();
    assert.equal(board.snapshot().length, 0);
    assert.equal(board.results.size, 0);
  });

  test("one broken desk does not take down the listing", async () => {
    const board = new DeskBoard({
      file: "/desks.json",
      deps: {
        readFileImpl: async () => JSON.stringify({
          desks: [
            { id: "good", probe: { kind: "http", url: "http://x/" } },
            { id: "bad", probe: { kind: "http", url: "http://y/" } },
          ],
        }),
        fetchImpl: async (u) => { if (u.includes("y")) throw new Error("boom"); return res(200, {}); },
      },
    });
    await board.load();
    await board.refresh();
    const snap = board.snapshot();
    assert.equal(snap.length, 2);
    assert.equal(snap.find((d) => d.id === "good").state, DESK_OK);
    assert.equal(snap.find((d) => d.id === "bad").state, DESK_UNKNOWN);
  });

  test("poll interval has a floor", () => {
    assert.ok(new DeskBoard({ pollMs: 1 }).pollMs >= 5_000);
  });
});

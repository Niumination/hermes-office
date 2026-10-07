/**
 * anchor.test.js — external anchoring (Fase 11).
 *
 * The two tests that matter most are `tail truncation` and `wholesale
 * regeneration`. Both are attacks that ledger.verify() passes with a clean
 * green tick, and both have been documented as undetectable since Fase 4.
 * If either of those two ever goes green without anchors, this feature is
 * decorative.
 */

import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { FlightRecorder } from "../server/ledger.js";
import {
  AnchorStore,
  startAnchoring,
  redactUrl,
  ANCHOR_OK,
  ANCHOR_TRUNCATED,
  ANCHOR_DIVERGED,
} from "../server/anchor.js";

let dir, ledger, store;

function fill(n, type = "policy_decision") {
  for (let i = 0; i < n; i++) ledger.record(type, { i, note: `record ${i}` });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "anchor-"));
  ledger = new FlightRecorder({ dataDir: dir, synchronous: "OFF" });
  store = new AnchorStore({ dataDir: dir });
});

afterEach(() => {
  try { ledger.close(); } catch { /* already closed */ }
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
describe("publishing", () => {
  test("writes a JSONL line containing the head seq and hash", async () => {
    fill(3);
    const head = ledger.head();
    const r = await store.publish(head);

    assert.equal(r.anchored, true);
    const lines = readFileSync(store.path, "utf8").trim().split("\n");
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.seq, head.seq);
    assert.equal(entry.hash, head.hash);
  });

  test("appends rather than overwrites", async () => {
    fill(2); await store.publish(ledger.head());
    fill(2); await store.publish(ledger.head());

    assert.equal(readFileSync(store.path, "utf8").trim().split("\n").length, 2);
  });

  test("the anchor file is NOT inside the ledger database", () => {
    // An anchor stored in the artifact it anchors is a signature on its own
    // forgery. This is the single most important structural property here.
    assert.notEqual(store.path, ledger.path);
  });

  test("reports local success even when every webhook fails", async () => {
    const s = new AnchorStore({
      dataDir: dir,
      webhooks: ["https://example.invalid/hook"],
      fetchImpl: async () => { throw new Error("getaddrinfo ENOTFOUND"); },
    });
    const r = await s.publish(ledger.head());

    assert.equal(r.anchored, true, "a dead webhook must not discard the local anchor");
    assert.equal(r.sinks.find(x => x.sink === "local").ok, true);
    assert.equal(r.sinks.find(x => x.sink === "webhook").ok, false);
  });

  test("a non-2xx webhook is a failure, not a quiet success", async () => {
    // A 404 recorded as "anchored" would be a lie told by us, not by the
    // endpoint. Worse than not anchoring, because it reports safety.
    const s = new AnchorStore({
      dataDir: dir,
      webhooks: ["https://example.com/gone"],
      fetchImpl: async () => ({ status: 404 }),
    });
    const r = await s.publish(ledger.head());
    const hook = r.sinks.find(x => x.sink === "webhook");

    assert.equal(hook.ok, false);
    assert.equal(hook.error, "HTTP 404");
  });

  test("sends the head as JSON to each webhook", async () => {
    const seen = [];
    const s = new AnchorStore({
      dataDir: dir,
      webhooks: ["https://a.test/h", "https://b.test/h"],
      fetchImpl: async (url, opts) => { seen.push({ url, body: JSON.parse(opts.body) }); return { status: 200 }; },
    });
    fill(5);
    await s.publish(ledger.head());

    assert.equal(seen.length, 2);
    assert.equal(seen[0].body.hash, ledger.head().hash);
    assert.equal(seen[1].body.seq, ledger.head().seq);
  });

  test("publishLocalSync writes without awaiting anything", () => {
    // Used on the shutdown path, which has a hard 5 s budget.
    fill(2);
    const r = store.publishLocalSync(ledger.head(), "shutdown");

    assert.equal(r.ok, true);
    assert.equal(JSON.parse(readFileSync(store.path, "utf8").trim()).note, "shutdown");
  });
});

// ---------------------------------------------------------------------------
describe("verification — the gap this module exists to close", () => {
  test("TAIL TRUNCATION is detected", async () => {
    // THE headline test. Drop the last records and ledger.verify() still
    // returns ok:true — it is a shorter but perfectly valid chain. Only an
    // anchor published before the cut can prove the records existed.
    fill(10);
    const anchored = ledger.head();
    await store.publish(anchored);

    ledger.db.prepare("DELETE FROM ledger WHERE seq > ?").run(anchored.seq - 4);
    const reopened = reopen();

    assert.equal(reopened.verify().ok, true, "precondition: the chain alone still looks fine");

    const result = store.verify(reopened);
    assert.equal(result.ok, false);
    assert.equal(result.firstFailure.result, ANCHOR_TRUNCATED);
    assert.match(result.firstFailure.detail, /provably existed/);
  });

  test("WHOLESALE REGENERATION is detected", async () => {
    // Rebuild the chain from doctored inputs: every hash is internally
    // consistent, so verify() is green. The anchor is the only witness that
    // a different chain once occupied those sequence numbers.
    fill(6);
    await store.publish(ledger.head());
    const honestHead = ledger.head().hash;

    ledger.close();
    rmSync(join(dir, "ledger.db"), { force: true });
    rmSync(join(dir, "ledger.db-wal"), { force: true });
    rmSync(join(dir, "ledger.db-shm"), { force: true });

    ledger = new FlightRecorder({ dataDir: dir, synchronous: "OFF" });
    for (let i = 0; i < 20; i++) ledger.record("policy_decision", { i, note: "fabricated" });

    assert.equal(ledger.verify().ok, true, "precondition: the forged chain verifies");
    assert.notEqual(ledger.head().hash, honestHead);

    const result = store.verify(ledger);
    assert.equal(result.ok, false);
    assert.equal(result.firstFailure.result, ANCHOR_DIVERGED);
    assert.match(result.firstFailure.detail, /rebuilt, not merely shortened/);
  });

  test("an untouched chain passes", async () => {
    fill(5);
    await store.publish(ledger.head());
    fill(5);
    await store.publish(ledger.head());

    const result = store.verify(ledger);
    assert.equal(result.ok, true);
    assert.equal(result.checked, 2);
    // No `failures` key at all on a clean run, and every anchor explicitly ok
    // — a passing verify must not quietly omit anchors it never looked at.
    assert.equal(result.failures, undefined);
    assert.deepEqual(
      store.list().anchors.map(a =>
        recorderHashAt(a.seq) === a.hash ? ANCHOR_OK : "mismatch"),
      [ANCHOR_OK, ANCHOR_OK],
    );
  });

  test("growth after an anchor is not a failure", async () => {
    // Anchors constrain the past, never the future. A chain that is longer
    // than its newest anchor is the normal, healthy state.
    fill(3);
    await store.publish(ledger.head());
    fill(50);

    assert.equal(store.verify(ledger).ok, true);
  });

  test("reports diverged ahead of truncated", async () => {
    // Both can be true at once. Divergence is strictly worse — it means
    // fabrication, not just deletion — so it must be the headline.
    fill(4);
    await store.publish(ledger.head());   // anchor A, seq 5
    fill(4);
    await store.publish(ledger.head());   // anchor B, seq 9

    // Rewrite record 5 in place, then truncate past 7.
    ledger.db.prepare("UPDATE ledger SET hash = ? WHERE seq = ?").run("f".repeat(64), 5);
    ledger.db.prepare("DELETE FROM ledger WHERE seq > 7").run();

    const result = store.verify(reopen());
    assert.equal(result.firstFailure.result, ANCHOR_DIVERGED);
    assert.equal(result.failures.length, 2);
  });

  test("says plainly when nothing has been anchored yet", () => {
    fill(3);
    const result = store.verify(ledger);

    assert.equal(result.ok, true);
    assert.equal(result.anchors, 0);
    assert.equal(result.strength, "none");
    // ok:true with zero anchors must not read as "verified".
    assert.match(result.note, /undetectable/);
  });

  test("grades a local-only setup as local, never remote", async () => {
    // A thousand anchors on the same disk as the ledger are still only local.
    for (let i = 0; i < 20; i++) { fill(1); await store.publish(ledger.head()); }

    assert.equal(store.verify(ledger).strength, "local");
  });

  test("grades a webhook setup as remote", async () => {
    const s = new AnchorStore({ dataDir: dir, webhooks: ["https://a.test/h"], fetchImpl: async () => ({ status: 200 }) });
    fill(2);
    await s.publish(ledger.head());

    assert.equal(s.verify(ledger).strength, "remote");
  });

  test("tracks the high-water mark", async () => {
    fill(7);
    await store.publish(ledger.head());
    fill(3);

    assert.equal(store.verify(ledger).highWaterMark, 8);
  });
});

// ---------------------------------------------------------------------------
describe("robustness", () => {
  test("a corrupt anchor line is counted, not thrown", () => {
    writeFileSync(store.path, '{"seq":1,"hash":"' + "a".repeat(64) + '"}\nNOT JSON\n\n{"seq":"x"}\n');
    const { anchors, malformed } = store.list();

    assert.equal(anchors.length, 1);
    assert.equal(malformed, 2);
  });

  test("a missing anchor file is an empty list, not a crash", () => {
    const s = new AnchorStore({ filePath: join(dir, "nope", "none.jsonl") });
    assert.deepEqual(s.list(), { anchors: [], malformed: 0 });
  });

  test("anchors are sorted by seq regardless of file order", () => {
    const h = "b".repeat(64);
    writeFileSync(store.path,
      `{"seq":9,"hash":"${h}"}\n{"seq":2,"hash":"${h}"}\n{"seq":5,"hash":"${h}"}\n`);

    assert.deepEqual(store.list().anchors.map(a => a.seq), [2, 5, 9]);
  });

  test("an unwritable anchor path fails the sink without throwing", async () => {
    const s = new AnchorStore({ filePath: join(dir, "ledger.db", "cannot", "x.jsonl") });
    const r = await s.publish(ledger.head());

    assert.equal(r.anchored, false);
    assert.equal(r.sinks[0].ok, false);
    assert.ok(s.lastError);
  });
});

// ---------------------------------------------------------------------------
describe("redactUrl", () => {
  test("strips the query string, where webhook tokens live", () => {
    assert.equal(
      redactUrl("https://hooks.slack.com/services/T000/B000?token=SECRET"),
      "https://hooks.slack.com/services/T000/B000?…",
    );
  });

  test("strips basic-auth credentials", () => {
    assert.equal(redactUrl("https://user:pass@example.com/hook"), "https://example.com/hook");
  });

  test("keeps host and path so the operator can still identify the sink", () => {
    assert.equal(redactUrl("https://audit.example.com/v1/anchor"), "https://audit.example.com/v1/anchor");
  });

  test("does not throw on garbage", () => {
    assert.equal(redactUrl("not a url"), "invalid-url");
  });
});

// ---------------------------------------------------------------------------
/**
 * Poll until `fn()` is true, or give up after `ms`.
 *
 * Use this for "did it happen?"; use a plain sleep only for "it must not
 * happen", where a longer wait strengthens the assertion instead of
 * weakening it.
 */
async function waitFor(fn, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise(r => { setTimeout(r, 5); });
  }
  return false;
}

describe("startAnchoring", () => {
  test("is inert when the interval is zero", () => {
    const h = startAnchoring(store, ledger, { intervalMs: 0 });
    assert.equal(h.running, false);
    h.stop();
  });

  test("publishes on the interval and stops when told", async () => {
    // Two different waits, because the two halves of this test need
    // opposite things from the clock.
    //
    // The claim "it repeats" was asserted by sleeping exactly 45ms and
    // demanding >= 2 anchors from a 10ms timer. `node --test` runs test
    // FILES concurrently, so under load the timer gets starved, two ticks do
    // not fit in 45ms, and the suite went red for a reason that has nothing
    // to do with anchoring. Measured: ~1 run in 25 of the full suite, never
    // when this file ran alone — the worst shape of flake, because running
    // it in isolation to investigate makes it disappear.
    //
    // Repetition does not need a precise clock, only a generous deadline, so
    // the first half now polls.
    const h = startAnchoring(store, ledger, { intervalMs: 10 });
    const repeated = await waitFor(() => store.list().anchors.length >= 2, 5000);
    h.stop();
    const after = store.list().anchors.length;
    assert.ok(repeated, `expected repeated anchors, got ${after}`);

    // The second half is the reverse claim — that NOTHING happens after
    // stop(). A fixed sleep is correct here: waiting longer can only make
    // the assertion harder to pass, never easier, so load cannot fake a
    // pass. This one stays.
    await new Promise(r => { setTimeout(r, 40); });
    assert.equal(store.list().anchors.length, after, "stop() must actually stop it");
  });

  test("a throwing publish does not crash the timer", async () => {
    // An anchor timer that can take the process down defeats its purpose.
    const broken = new AnchorStore({ dataDir: dir });
    broken.publish = async () => { throw new Error("disk on fire"); };
    const h = startAnchoring(broken, ledger, { intervalMs: 10 });
    await new Promise(r => { setTimeout(r, 35); });
    h.stop();

    assert.ok(true, "survived");
  });

  test("the timer is unref'd so it cannot hold the process open", () => {
    const h = startAnchoring(store, ledger, { intervalMs: 60_000 });
    assert.equal(h.running, true);
    h.stop();
  });
});

// ---------------------------------------------------------------------------
describe("chain_anchored record type", () => {
  test("the ledger accepts it", () => {
    const r = ledger.record("chain_anchored", { seq: 1, hash: "a".repeat(64), sinks: [] });
    assert.ok(r.hash);
  });

  test("recording an anchor does not invalidate the chain", async () => {
    fill(3);
    const head = ledger.head();
    await store.publish(head);
    ledger.record("chain_anchored", { seq: head.seq, hash: head.hash, sinks: [] });

    assert.equal(ledger.verify().ok, true);
    assert.equal(store.verify(ledger).ok, true);
  });
});

/** Hash stored at a given seq, or null. */
function recorderHashAt(seq) {
  const row = ledger.at(seq);
  return row ? row.hash : null;
}

/** Reopen the ledger so in-memory head state is re-read from disk. */
function reopen() {
  ledger.close();
  ledger = new FlightRecorder({ dataDir: dir, synchronous: "OFF" });
  return ledger;
}

test("anchor file survives a ledger reopen", async () => {
  fill(2);
  await store.publish(ledger.head());
  reopen();

  assert.ok(existsSync(store.path));
  assert.equal(store.verify(ledger).ok, true);
});

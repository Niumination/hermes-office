/**
 * Amanat — the board of what the fleet is working on.
 *
 * These lock the properties the board would be actively misleading without:
 * it must not reopen finished work, must not invent tasks, must not leak a
 * client's project names to a visitor, and must come back after a restart.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  TaskBoard,
  TASK_STATES,
  TASK_LANES,
  normaliseState,
  laneFor,
  canTransition,
} from "../server/tasks.js";

const upd = (taskId, state, extra = {}) => ({
  type: "task_update",
  taskId,
  state,
  ...extra,
});

// --- lifecycle vocabulary ---------------------------------------------------

test("every A2A v1.0 state has a lane", () => {
  for (const s of TASK_STATES) {
    const lane = laneFor(s);
    assert.ok(
      TASK_LANES.some((l) => l.id === lane && l.states.includes(s)),
      `${s} is not claimed by any lane`,
    );
  }
});

test("blocked is the first lane", () => {
  // Not cosmetic: a task waiting on a human is the only one the operator can
  // clear, so it must not render below forty completed ones.
  assert.equal(TASK_LANES[0].id, "blocked");
});

test("legacy spellings normalise instead of being dropped", () => {
  // bridges/mac-relay already emits `sent`; rejecting it would silently lose
  // every task that machine reports.
  assert.equal(normaliseState("sent"), "submitted");
  assert.equal(normaliseState("done"), "completed");
  assert.equal(normaliseState("working"), "working");
  assert.equal(normaliseState("karangan"), null);
  assert.equal(normaliseState(undefined), null);
});

// --- transition guard -------------------------------------------------------

test("a terminal task never reopens", () => {
  for (const terminal of ["completed", "failed", "canceled", "rejected"]) {
    assert.equal(canTransition(terminal, "working"), false, `${terminal} -> working`);
  }
});

test("a repeated state is not a transition", () => {
  assert.equal(canTransition("working", "working"), false);
});

test("late working after completed does not resurrect the task", () => {
  const b = new TaskBoard();
  b.ingest(upd("T1", "working", { title: "asli" }));
  b.ingest(upd("T1", "completed"));
  const moved = b.ingest(upd("T1", "working"));
  assert.equal(moved, null, "out-of-order delivery must not reopen finished work");
  assert.equal(b.snapshot().lanes.done[0].state, "completed");
});

test("a retry still merges metadata the first attempt lacked", () => {
  const b = new TaskBoard();
  b.ingest(upd("T1", "completed"));
  b.ingest(upd("T1", "completed", { title: "judul menyusul" }));
  assert.equal(b.snapshot().lanes.done[0].title, "judul menyusul");
});

// --- identity ---------------------------------------------------------------

test("an event without a taskId creates nothing", () => {
  const b = new TaskBoard();
  assert.equal(b.ingest({ type: "task_update", state: "working" }), null);
  assert.equal(b.size, 0);
});

test("a tool_call never becomes a task", () => {
  // The product rule is that the UI may not fabricate activity. Synthesising
  // a task because an agent looked busy would be the most convincing way to
  // break it.
  const b = new TaskBoard();
  b.ingest({ type: "tool_call", agentId: "cloud", tool: "bash", taskId: "T1" });
  assert.equal(b.size, 0);
});

// --- origin -----------------------------------------------------------------

test("a follow-up without an origin does not rewrite the original", () => {
  // Regression: `ev.source` is stamped by the server with the relaying
  // bridge, which is a different question from where the work came from.
  // Using it as a fallback rewrote telegram-origin tasks to `cloud`.
  const b = new TaskBoard();
  b.ingest(upd("T1", "submitted", { origin: "telegram", agent: "cloud" }));
  b.ingest(upd("T1", "working", { agent: "cloud", source: "cloud" }));
  assert.equal(b.snapshot().lanes.active[0].origin, "telegram");
});

test("a2a events carry their own origin and owner", () => {
  const b = new TaskBoard();
  b.ingest({ type: "a2a_task_in", taskId: "T1", dest: "mac", peer: "cloud", summary: "review" });
  const t = b.snapshot().lanes.active[0];
  assert.equal(t.agent, "mac");
  assert.equal(t.origin, "a2a");
  assert.equal(t.title, "review");
});

// --- guest redaction --------------------------------------------------------

test("a guest sees the shape of the work but never its subject", () => {
  const b = new TaskBoard();
  b.ingest(upd("T1", "working", { title: "repo lightvela: perbaiki build", repo: "lightvela", peer: "mac" }));
  b.ingest(upd("T2", "input_required", { title: "migrasi agroclimate" }));

  const guest = JSON.stringify(b.snapshot({ isGuest: true }));
  for (const secret of ["lightvela", "agroclimate", "perbaiki build"]) {
    assert.ok(!guest.includes(secret), `leaked "${secret}" to a guest`);
  }
  const view = b.snapshot({ isGuest: true });
  assert.equal(view.redacted, true);
  assert.equal(view.counts.active, 1, "a guest still sees that work is running");
  assert.equal(view.counts.blocked, 1, "a guest still sees that something is blocked");
  assert.equal(view.lanes.active[0].title, "[redacted]");
});

test("the owner sees everything the guest does not", () => {
  const b = new TaskBoard();
  b.ingest(upd("T1", "working", { title: "rahasia", repo: "r", peer: "mac" }));
  const t = b.snapshot().lanes.active[0];
  assert.equal(t.title, "rahasia");
  assert.equal(t.repo, "r");
  assert.equal(t.peer, "mac");
});

// --- the ledger contract ----------------------------------------------------

test("only real transitions are written to the chain", () => {
  const written = [];
  const b = new TaskBoard({ record: (type, payload) => written.push({ type, payload }) });
  b.ingest(upd("T1", "working", { title: "x" }));
  b.ingest(upd("T1", "working")); // heartbeat repeat
  b.ingest(upd("T1", "working")); // and again
  b.ingest(upd("T1", "completed"));
  assert.equal(written.length, 2, "a re-sent state must not grow the chain");
  assert.deepEqual(written.map((w) => w.payload.to), ["working", "completed"]);
  assert.equal(written[0].type, "task_transition");
});

test("the board survives a restart by folding the chain", () => {
  const written = [];
  const first = new TaskBoard({ record: (type, payload, meta) => written.push({ type, payload, meta }) });
  first.ingest(upd("T1", "working", { title: "masih jalan", agent: "cloud", origin: "telegram" }));
  first.ingest(upd("T2", "working", { title: "baru selesai" }));
  first.ingest(upd("T2", "completed"));

  // Recent transitions: a restart a minute after the work happened.
  const base = Date.now() - 60_000;
  const rows = written.map((w, i) => ({ seq: i + 1, ts: base + i, payload: JSON.stringify(w.payload) }));
  const revived = new TaskBoard();
  const folded = revived.rebuildFrom(rows);

  assert.equal(folded, rows.length);
  assert.equal(revived.rebuilt, true);
  assert.equal(revived.size, 2);
  const after = revived.snapshot();
  assert.equal(after.lanes.active[0].id, "T1");
  assert.equal(after.lanes.active[0].title, "masih jalan");
  assert.equal(after.lanes.active[0].origin, "telegram");
  assert.equal(after.lanes.done[0].id, "T2");
});

test("a restart keeps running work but not work finished days ago", () => {
  // The board answers "what is happening", not "what ever happened" — the
  // chain is the archive. A task still `working` has no TTL no matter how
  // old the record is, because nothing has said it stopped; a task that
  // completed last week must not reappear on the board at boot.
  const old = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const b = new TaskBoard();
  b.rebuildFrom([
    { seq: 1, ts: old, payload: JSON.stringify({ taskId: "lama-jalan", to: "working" }) },
    { seq: 2, ts: old, payload: JSON.stringify({ taskId: "lama-selesai", to: "completed" }) },
  ]);
  const ids = [...b.tasks.keys()];
  assert.deepEqual(ids, ["lama-jalan"]);
});

test("rebuilding does not re-record, so the chain cannot grow on boot", () => {
  const written = [];
  const b = new TaskBoard({ record: (t, p) => written.push([t, p]) });
  b.rebuildFrom([{ seq: 1, ts: 1, payload: JSON.stringify({ taskId: "T1", to: "working" }) }]);
  assert.equal(written.length, 0);
  assert.equal(b.size, 1);
});

test("a corrupt ledger row is skipped, not fatal", () => {
  const b = new TaskBoard();
  const folded = b.rebuildFrom([
    { seq: 1, ts: 1, payload: "{ not json" },
    { seq: 2, ts: 2, payload: JSON.stringify({ taskId: "T1", to: "working" }) },
    { seq: 3, ts: 3, payload: JSON.stringify({ nothing: true }) },
  ]);
  assert.equal(folded, 1);
  assert.equal(b.size, 1);
});

// --- the emitter mirrors the server, or the board stays empty ---------------

test("bridges/hermes-emit knows exactly the events a bridge may post", async () => {
  // This project has been bitten twice by one fact living in two places. The
  // emitter keeps its own allow-list so it can reject a typo locally instead
  // of earning a 400 nobody reads — which is right, and is also exactly how
  // `task_update` shipped server-side while the emitter silently dropped
  // every one of them as `dropped_invalid`.
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(new URL("../bridges/hermes-emit/hermes_emit.py", import.meta.url), "utf8");

  const pySet = (name) => {
    const body = src.split(`${name} = frozenset(`)[1]?.split(")")[0] ?? "";
    return new Set([...body.matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]));
  };

  const { KNOWN_EVENT_TYPES, INTERNAL_ONLY_TYPES } = await import("../server/eventbus.js");
  const internal = new Set(INTERNAL_ONLY_TYPES ?? []);
  const bridgeable = new Set(KNOWN_EVENT_TYPES.filter((t) => !internal.has(t)));

  assert.deepEqual(
    [...pySet("BRIDGE_EVENT_TYPES")].sort(),
    [...bridgeable].sort(),
    "hermes_emit.BRIDGE_EVENT_TYPES has drifted from the server's contract",
  );
});

// --- bounds -----------------------------------------------------------------

test("a looping agent cannot exhaust memory", () => {
  const b = new TaskBoard({ maxTasks: 10 });
  for (let i = 0; i < 200; i++) b.ingest(upd(`T${i}`, "working"));
  assert.equal(b.size, 10);
  assert.ok(b.dropped > 0, "the shortfall must be counted, not silent");
  assert.equal(b.snapshot().dropped, b.dropped);
});

test("finished work ages off the board before live work does", () => {
  let now = 1_000_000;
  const b = new TaskBoard({ now: () => now, doneTtlMs: 1000 });
  b.ingest({ ...upd("done-1", "completed"), ts: now });
  b.ingest({ ...upd("live-1", "working"), ts: now });
  now += 5000;
  b.ingest({ ...upd("live-2", "working"), ts: now });
  const ids = [...b.tasks.keys()];
  assert.ok(!ids.includes("done-1"), "a finished task past its TTL should be evicted");
  assert.ok(ids.includes("live-1"), "a running task must not be evicted by age");
});

test("transition history is capped", () => {
  const b = new TaskBoard();
  for (let i = 0; i < 100; i++) {
    b.ingest(upd("T1", i % 2 ? "working" : "submitted"));
  }
  assert.ok(b.tasks.get("T1").transitions.length <= 24);
});

// --- snapshot shape ---------------------------------------------------------

test("lanes are newest-first so the thing that just moved is on top", () => {
  const b = new TaskBoard();
  b.ingest({ ...upd("old", "working"), ts: 1000 });
  b.ingest({ ...upd("new", "working"), ts: 9000 });
  assert.deepEqual(b.snapshot().lanes.active.map((t) => t.id), ["new", "old"]);
});

test("an empty board reports zero rather than omitting lanes", () => {
  // The panel distinguishes "nothing is running" from "the fetch failed".
  // A missing lane key would collapse that difference.
  const snap = new TaskBoard().snapshot();
  for (const lane of TASK_LANES) {
    assert.ok(Array.isArray(snap.lanes[lane.id]), `lane ${lane.id} missing`);
    assert.equal(snap.counts[lane.id], 0);
  }
  assert.equal(snap.total, 0);
});

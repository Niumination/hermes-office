/**
 * replay.test.js — Time Machine (Fase 12).
 *
 * The load-bearing tests here are `determinism` and `seeding`. A replay that
 * differs between two runs cannot be used as evidence, and a replay that
 * starts cold shows an empty office slowly filling up — an artifact that
 * looks like an evacuation and is pure reconstruction error.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildReplay, sample, summarize, BURN_STATES } from "../server/replay.js";

let seq = 0;
function rec(type, payload, ts, actor = null) {
  return { seq: ++seq, ts, type, actor, payload: JSON.stringify(payload) };
}
function reset() { seq = 0; }

/** A small, realistic session: two agents, a denial, an approval, a burn climb. */
function session() {
  reset();
  return [
    rec("policy_loaded", { source: "file" }, 1000),
    rec("agent_moved", { agent: "ana", fromRoom: "lobby", room: "main-office", trust: 2 }, 2000),
    rec("agent_moved", { agent: "budi", fromRoom: "lobby", room: "meeting-room", trust: 1 }, 3000),
    rec("policy_decision", { agent: "budi", tool: "kubectl", room: "meeting-room", allow: false, reason: "tool denied in room" }, 4000),
    rec("approval_requested", { approvalId: "ap-1", agent: "ana", tool: "deploy", kind: "tool", room: "server-room", expiresAt: 9999 }, 5000),
    rec("budget_transition", { scope: "global", from: "normal", state: "warm", spentUsd: 1.234, limitUsd: 2 }, 6000),
    rec("approval_resolved", { approvalId: "ap-1", agent: "ana", tool: "deploy", state: "granted", decidedBy: "owner" }, 7000),
    rec("agent_moved", { agent: "ana", fromRoom: "main-office", room: "server-room", trust: 3 }, 8000),
  ];
}

// ---------------------------------------------------------------------------
describe("folding", () => {
  test("emits one frame per governance record", () => {
    const r = buildReplay(session());
    assert.equal(r.frames.length, 8);
    assert.equal(r.stats.emitted, 8);
  });

  test("ignores records that are not governance events", () => {
    reset();
    const r = buildReplay([
      rec("chain_opened", {}, 1000),
      rec("chain_checkpoint", { headSeq: 1 }, 1100),
      rec("chain_anchored", { seq: 1 }, 1200),
      rec("dossier_exported", { records: 3 }, 1300),
      rec("agent_moved", { agent: "ana", room: "lobby" }, 1400),
    ]);
    assert.equal(r.frames.length, 1);
    assert.equal(r.frames[0].type, "agent_moved");
  });

  test("tracks occupancy as agents move", () => {
    const r = buildReplay(session());
    const last = r.frames.at(-1);

    assert.deepEqual(last.occupants, {
      "meeting-room": ["budi"],
      "server-room": ["ana"],
    });
  });

  test("an agent leaves the room it came from", () => {
    const r = buildReplay(session());
    const beforeMove = r.frames.find(f => f.ts === 7000);
    const afterMove = r.frames.find(f => f.ts === 8000);

    assert.deepEqual(beforeMove.occupants["main-office"], ["ana"]);
    assert.equal(afterMove.occupants["main-office"], undefined);
  });

  test("places an agent from a decision when no move was recorded", () => {
    // The chain can start mid-session. Without this an agent who never moves
    // during the window is invisible in every frame.
    reset();
    const r = buildReplay([
      rec("policy_decision", { agent: "citra", tool: "ls", room: "kitchen", allow: true }, 1000),
    ]);
    assert.deepEqual(r.frames[0].occupants, { kitchen: ["citra"] });
  });

  test("a recorded move overrides a room inferred from a decision", () => {
    reset();
    const r = buildReplay([
      rec("policy_decision", { agent: "ana", tool: "ls", room: "kitchen", allow: true }, 1000),
      rec("agent_moved", { agent: "ana", fromRoom: "kitchen", room: "ceo-office" }, 2000),
      rec("policy_decision", { agent: "ana", tool: "ls", room: "kitchen", allow: true }, 3000),
    ]);
    // The stale room on the third record must NOT drag her back.
    assert.deepEqual(r.frames.at(-1).occupants, { "ceo-office": ["ana"] });
  });
});

// ---------------------------------------------------------------------------
describe("approvals", () => {
  test("a pending approval appears and then clears", () => {
    const r = buildReplay(session());
    const whilePending = r.frames.find(f => f.ts === 6000);
    const afterResolve = r.frames.find(f => f.ts === 7000);

    assert.equal(whilePending.pendingApprovals.length, 1);
    assert.equal(whilePending.pendingApprovals[0].id, "ap-1");
    assert.equal(whilePending.pendingApprovals[0].tool, "deploy");
    assert.equal(afterResolve.pendingApprovals.length, 0);
  });

  test("resolving an unknown approval is harmless", () => {
    reset();
    const r = buildReplay([rec("approval_resolved", { approvalId: "ghost", state: "denied" }, 1000)]);
    assert.equal(r.frames[0].pendingApprovals.length, 0);
  });
});

// ---------------------------------------------------------------------------
describe("burn state", () => {
  test("follows global budget transitions", () => {
    const r = buildReplay(session());
    assert.equal(r.frames.find(f => f.ts === 5000).burn, "normal");
    assert.equal(r.frames.find(f => f.ts === 6000).burn, "warm");
    assert.equal(r.frames.find(f => f.ts === 6000).spentUsd, 1.23);
  });

  test("a per-agent breaker does not repaint the whole office", () => {
    // One agent hitting their own cap must not make the building look like
    // the global budget tripped.
    reset();
    const r = buildReplay([
      rec("budget_transition", { scope: "agent", subject: "ana", from: "normal", state: "tripped", spentUsd: 99 }, 1000),
    ]);
    assert.equal(r.frames[0].burn, "normal");
    assert.equal(r.frames[0].spentUsd, 0);
  });

  test("ignores a burn state that is not one of the five", () => {
    reset();
    const r = buildReplay([
      rec("budget_transition", { scope: "global", state: "on-fire", spentUsd: 1 }, 1000),
    ]);
    assert.equal(r.frames[0].burn, "normal");
    assert.ok(BURN_STATES.includes(r.frames[0].burn));
  });

  test("carries the seq the money came from, so staleness is visible", () => {
    // Burn state updates on every decision; realized spend only moves on a
    // budget transition. A frame can honestly read "hot" beside a figure from
    // several records earlier — but only if it says which record.
    const r = buildReplay(session());
    const transition = r.frames.find(f => f.ts === 6000);
    const later = r.frames.find(f => f.ts === 8000);

    assert.equal(transition.spentAsOfSeq, transition.seq, "fresh at the transition");
    assert.equal(later.spentUsd, 1.23);
    assert.equal(later.spentAsOfSeq, transition.seq, "stale afterwards, and says so");
    assert.notEqual(later.spentAsOfSeq, later.seq);
  });

  test("spentAsOfSeq is null before any money is recorded", () => {
    reset();
    const r = buildReplay([rec("agent_moved", { agent: "ana", room: "lobby" }, 1000)]);
    assert.equal(r.frames[0].spentAsOfSeq, null);
    assert.equal(r.frames[0].spentUsd, 0);
  });

  test("rounds dollars to cents", () => {
    reset();
    const r = buildReplay([
      rec("budget_transition", { scope: "global", state: "hot", spentUsd: 1.23456789 }, 1000),
    ]);
    assert.equal(r.frames[0].spentUsd, 1.23);
  });
});

// ---------------------------------------------------------------------------
describe("seeding — state before the window opens", () => {
  test("agents already in rooms appear in the first frame", () => {
    // THE test. Without pre-roll folding, a replay of the last hour shows an
    // empty office that fills up as people happen to move, which reads as an
    // evacuation and is entirely an artifact of the reconstruction.
    const r = buildReplay(session(), { from: 7500 });

    assert.equal(r.frames.length, 1);
    assert.deepEqual(r.frames[0].occupants, {
      "meeting-room": ["budi"],
      "server-room": ["ana"],
    });
  });

  test("burn state carries into the window", () => {
    const r = buildReplay(session(), { from: 7500 });
    assert.equal(r.frames[0].burn, "warm");
    assert.equal(r.frames[0].spentUsd, 1.23);
  });

  test("counts how many records were folded as pre-roll", () => {
    const r = buildReplay(session(), { from: 7500 });
    assert.equal(r.stats.seeded, 7);
    assert.equal(r.stats.emitted, 1);
  });

  test("an approval pending before the window is still pending inside it", () => {
    const r = buildReplay(session(), { from: 6500, to: 6999 });
    reset();
    const r2 = buildReplay(session(), { from: 5500, to: 6500 });

    assert.equal(r.frames.length, 0, "no records in that gap");
    assert.equal(r2.frames[0].pendingApprovals[0].id, "ap-1");
  });
});

// ---------------------------------------------------------------------------
describe("range", () => {
  test("excludes records after `to`", () => {
    const r = buildReplay(session(), { to: 4000 });
    assert.equal(r.frames.at(-1).ts, 4000);
  });

  test("boundaries are inclusive on both ends", () => {
    const r = buildReplay(session(), { from: 4000, to: 6000 });
    assert.deepEqual(r.frames.map(f => f.ts), [4000, 5000, 6000]);
  });

  test("reports the real first and last frame timestamps", () => {
    const r = buildReplay(session(), { from: 3500, to: 6500 });
    assert.equal(r.range.firstFrameTs, 4000);
    assert.equal(r.range.lastFrameTs, 6000);
    assert.equal(r.range.durationMs, 2000);
  });

  test("an empty window is empty, not an error", () => {
    const r = buildReplay(session(), { from: 100_000, to: 200_000 });
    assert.deepEqual(r.frames, []);
    assert.equal(r.range.durationMs, 0);
  });
});

// ---------------------------------------------------------------------------
describe("determinism — the property that makes this evidence", () => {
  test("two folds of the same data are byte-identical", () => {
    const a = JSON.stringify(buildReplay(session()));
    const b = JSON.stringify(buildReplay(session()));
    assert.equal(a, b);
  });

  test("occupant lists are sorted, not insertion-ordered", () => {
    reset();
    const r = buildReplay([
      rec("agent_moved", { agent: "zara", room: "lobby" }, 1000),
      rec("agent_moved", { agent: "adi", room: "lobby" }, 2000),
      rec("agent_moved", { agent: "mira", room: "lobby" }, 3000),
    ]);
    assert.deepEqual(r.frames.at(-1).occupants.lobby, ["adi", "mira", "zara"]);
  });

  test("room keys are sorted", () => {
    reset();
    const r = buildReplay([
      rec("agent_moved", { agent: "a", room: "server-room" }, 1000),
      rec("agent_moved", { agent: "b", room: "kitchen" }, 2000),
      rec("agent_moved", { agent: "c", room: "lobby" }, 3000),
    ]);
    assert.deepEqual(Object.keys(r.frames.at(-1).occupants), ["kitchen", "lobby", "server-room"]);
  });

  test("a frame is a snapshot, not a live reference", () => {
    // If frames shared the state object every frame would show the FINAL
    // office and the replay would be a still image pretending to be a film.
    const r = buildReplay(session());
    assert.notDeepEqual(r.frames[1].occupants, r.frames.at(-1).occupants);
  });
});

// ---------------------------------------------------------------------------
describe("damage and limits", () => {
  test("an unparseable payload is skipped, not fatal", () => {
    reset();
    const r = buildReplay([
      { seq: 1, ts: 1000, type: "agent_moved", actor: null, payload: "{not json" },
      rec("agent_moved", { agent: "ana", room: "lobby" }, 2000),
    ]);
    assert.equal(r.frames.length, 1);
    assert.equal(r.stats.scanned, 2, "the damaged record is still counted");
  });

  test("maxFrames truncates and says so", () => {
    const r = buildReplay(session(), { maxFrames: 3 });
    assert.equal(r.frames.length, 3);
    assert.equal(r.stats.truncated, true);
  });

  test("a complete replay is not marked truncated", () => {
    assert.equal(buildReplay(session()).stats.truncated, false);
  });

  test("accepts an already-parsed payload object", () => {
    reset();
    const r = buildReplay([{ seq: 1, ts: 1000, type: "agent_moved", payload: { agent: "ana", room: "lobby" } }]);
    assert.deepEqual(r.frames[0].occupants, { lobby: ["ana"] });
  });

  test("a move with no room removes the agent from the floor", () => {
    reset();
    const r = buildReplay([
      rec("agent_moved", { agent: "ana", room: "lobby" }, 1000),
      rec("agent_moved", { agent: "ana", room: null }, 2000),
    ]);
    assert.deepEqual(r.frames.at(-1).occupants, {});
  });
});

// ---------------------------------------------------------------------------
describe("change descriptions", () => {
  test("a denial is phrased as a denial", () => {
    const r = buildReplay(session());
    const denial = r.frames.find(f => f.ts === 4000);
    assert.match(denial.change, /DITOLAK/);
    assert.match(denial.change, /kubectl/);
  });

  test("a move names both rooms", () => {
    const r = buildReplay(session());
    assert.equal(r.frames.find(f => f.ts === 2000).change, "ana → main-office (dari lobby)");
  });

  test("a budget transition names both states", () => {
    const r = buildReplay(session());
    assert.match(r.frames.find(f => f.ts === 6000).change, /normal → warm/);
  });
});

// ---------------------------------------------------------------------------
describe("sample", () => {
  test("keeps the first and last frame", () => {
    const r = buildReplay(session());
    const s = sample(r.frames, 3);

    assert.equal(s.length, 3);
    assert.equal(s[0].seq, r.frames[0].seq);
    assert.equal(s.at(-1).seq, r.frames.at(-1).seq);
  });

  test("marks every sampled frame so it cannot pass as the full record", () => {
    const s = sample(buildReplay(session()).frames, 4);
    assert.ok(s.every(f => f.sampled === true));
  });

  test("returns everything untouched when the cap exceeds the length", () => {
    const r = buildReplay(session());
    const s = sample(r.frames, 999);

    assert.equal(s.length, r.frames.length);
    assert.equal(s[0].sampled, undefined, "an unsampled frame must not be labelled sampled");
  });

  test("a cap of zero is a no-op, not an empty replay", () => {
    assert.equal(sample(buildReplay(session()).frames, 0).length, 8);
  });
});

// ---------------------------------------------------------------------------
describe("summarize", () => {
  test("counts frames by type", () => {
    const s = summarize(buildReplay(session()).frames);
    assert.equal(s.byType.agent_moved, 3);
    assert.equal(s.byType.policy_decision, 1);
  });

  test("lists every agent seen, sorted", () => {
    assert.deepEqual(summarize(buildReplay(session()).frames).agents, ["ana", "budi"]);
  });

  test("reports the peak burn state, not the final one", () => {
    reset();
    const frames = buildReplay([
      rec("budget_transition", { scope: "global", state: "critical", spentUsd: 5 }, 1000),
      rec("budget_transition", { scope: "global", state: "normal", spentUsd: 0 }, 2000),
    ]).frames;
    // An incident that recovered still happened.
    assert.equal(summarize(frames).peakBurn, "critical");
  });

  test("surfaces denials separately", () => {
    const s = summarize(buildReplay(session()).frames);
    assert.equal(s.denialCount, 1);
    assert.match(s.denials[0].change, /kubectl/);
  });

  test("an empty replay summarizes without throwing", () => {
    const s = summarize([]);
    assert.equal(s.frames, 0);
    assert.equal(s.peakBurn, "normal");
    assert.deepEqual(s.agents, []);
  });
});

test("BURN_STATES is ordered coldest to hottest", () => {
  assert.deepEqual(BURN_STATES, ["normal", "warm", "hot", "critical", "tripped"]);
});

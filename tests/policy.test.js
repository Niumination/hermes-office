import test from "node:test";
import assert from "node:assert/strict";
import {
  FloorPlanPolicy,
  DEFAULT_POLICY,
  modelTier,
  matchesPattern,
  loadPolicy,
} from "../server/policy.js";
import { BurnRateTracker } from "../server/burnrate.js";
import { readFileSync } from "node:fs";

function clock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

const mk = (opts = {}) => {
  const c = opts.clock || clock();
  const p = new FloorPlanPolicy(opts.policy || DEFAULT_POLICY, { now: c.now, ...opts });
  return { p, c };
};

// --- primitives ------------------------------------------------------------

test("glob matching handles the patterns policy authors actually write", () => {
  assert.ok(matchesPattern("bash", "*"));
  assert.ok(matchesPattern("bash", "bash"));
  assert.ok(!matchesPattern("bash", "deploy"));
  assert.ok(matchesPattern("llm:gpt-4o", "llm:*"));
  assert.ok(!matchesPattern("shell:rm", "llm:*"));
  assert.ok(matchesPattern("fs:read:file", "fs:*"));
  assert.ok(matchesPattern("BASH", "bash"), "matching is case-insensitive");
  assert.ok(!matchesPattern("", "bash"));
});

test("model tiering separates cheap fallbacks from premium", () => {
  assert.equal(modelTier("gpt-4o-mini"), "cheap");
  assert.equal(modelTier("claude-haiku-4"), "cheap");
  assert.equal(modelTier("gemini-2.5-flash"), "cheap");
  assert.equal(modelTier("claude-opus-4"), "premium");
  assert.equal(modelTier("gpt-4o"), "premium");
  assert.equal(modelTier("claude-sonnet-4-5"), "standard");
  assert.equal(modelTier(undefined), "standard");
});

test("a broken policy file falls back to the default rather than no policy", () => {
  assert.equal(loadPolicy("{not json"), DEFAULT_POLICY);
  assert.equal(loadPolicy(null), DEFAULT_POLICY);
  assert.equal(loadPolicy("null"), DEFAULT_POLICY);
  assert.deepEqual(loadPolicy('{"defaultRoom":"mac/tools"}').defaultRoom, "mac/tools");
});

// --- deny by default -------------------------------------------------------

test("an unassigned agent lands in the least privileged room", () => {
  const { p } = mk();
  assert.equal(p.roomFor("stranger"), "belum-dipetakan");
  const d = p.decide({ agent: "stranger", tool: "bash" });
  assert.equal(d.allow, false);
  assert.equal(d.room, "belum-dipetakan");
});

test("an unknown assigned room degrades to the default, it does not fail open", () => {
  const { p } = mk();
  p.assignments.set("ghost", { room: "atlantis", since: 0, grantedBy: "x" });
  assert.equal(p.roomFor("ghost"), "belum-dipetakan");
  assert.equal(p.decide({ agent: "ghost", tool: "bash" }).allow, false);
});

test("a denial says where the tool would be allowed", () => {
  const { p } = mk();
  const d = p.decide({ agent: "x", tool: "kubectl" });
  assert.equal(d.allow, false);
  assert.match(d.hint, /Infrastruktur & Monitoring/);
  assert.match(d.hint, /sign-off/);
});

test("the deny list beats the allow list", () => {
  const { p } = mk();
  p.assign("x", "mac/sites");
  // main-office allows "*" but explicitly denies bash.
  assert.equal(p.decide({ agent: "x", tool: "web_search" }).allow, true);
  assert.equal(p.decide({ agent: "x", tool: "bash" }).allow, false);
});

// --- rooms as scopes -------------------------------------------------------

test("moving an agent changes what it may do", () => {
  const { p } = mk();
  assert.equal(p.decide({ agent: "x", tool: "write_file" }).allow, false, "lobby is read-only-ish");
  p.assign("x", "mac/sites", "zaryu");
  assert.equal(p.decide({ agent: "x", tool: "write_file" }).allow, true);
});

test("the grant is recorded with who made it — this is the audit answer", () => {
  const seen = [];
  const { p } = mk({ onEvent: (e) => seen.push(e) });
  p.assign("x", "mac/sites", "zaryu");

  const moved = seen.find((e) => e.type === "agent_moved");
  assert.equal(moved.agent, "x");
  assert.equal(moved.fromRoom, "belum-dipetakan");
  assert.equal(moved.room, "mac/sites");
  assert.equal(moved.grantedBy, "zaryu");

  const snap = p.snapshot();
  const office = snap.rooms.find((r) => r.room === "mac/sites");
  assert.equal(office.occupants[0].agent, "x");
  assert.equal(office.occupants[0].grantedBy, "zaryu");
});

test("a room caps the model tier reachable inside it", () => {
  const { p } = mk();
  // lobby permits cheap only
  const dear = p.decide({ agent: "x", tool: "llm:opus", model: "claude-opus-4" });
  assert.equal(dear.allow, false);
  assert.equal(dear.action, "restrict");
  assert.ok(dear.suggestModel);
  assert.equal(p.decide({ agent: "x", tool: "llm:haiku", model: "claude-haiku-4" }).allow, true);

  p.assign("x", "mac/sites");
  assert.equal(p.decide({ agent: "x", tool: "llm:opus", model: "claude-opus-4" }).allow, true);
});

test("a break room has no spend allowance, so agents parked there are idle", () => {
  const { p } = mk();
  p.assign("x", "mac/tools");
  const d = p.decide({ agent: "x", tool: "llm:cheap", model: "gpt-4o-mini" });
  assert.equal(d.allow, false);
  assert.match(d.reason, /idle|allowance/);
});

test("assigning to a room that does not exist is an error, not a silent grant", () => {
  const { p } = mk();
  const r = p.assign("x", "the-void");
  assert.equal(r.ok, false);
  assert.match(r.error, /Unknown room/);
  assert.equal(p.roomFor("x"), "belum-dipetakan");
});

// --- doors as gates --------------------------------------------------------

test("entering a privileged room is held at the door until a human signs off", () => {
  const { p } = mk();
  const r = p.assign("x", "lightvela/infra", "zaryu");
  assert.equal(r.ok, false);
  assert.equal(r.pending, true);
  assert.ok(r.approvalId);
  assert.equal(p.roomFor("x"), "belum-dipetakan", "the agent has NOT moved yet");

  p.resolveApproval(r.approvalId, true, "zaryu");
  assert.equal(p.roomFor("x"), "lightvela/infra", "approval performs the move");
});

test("a denied entry leaves the agent where it was", () => {
  const { p } = mk();
  const r = p.assign("x", "lightvela/infra");
  p.resolveApproval(r.approvalId, false, "zaryu");
  assert.equal(p.roomFor("x"), "belum-dipetakan");
  assert.equal(p.getApproval(r.approvalId).status, "denied");
});

test("a dangerous tool needs its own sign-off even inside the privileged room", () => {
  // Two independent gates: being in the room, and using the tool.
  const { p } = mk();
  const entry = p.assign("x", "lightvela/infra");
  p.resolveApproval(entry.approvalId, true, "zaryu");

  const first = p.decide({ agent: "x", tool: "deploy" });
  assert.equal(first.allow, false);
  assert.equal(first.action, "await_approval");
  assert.ok(first.approvalId);

  // Still blocked while pending.
  assert.equal(p.decide({ agent: "x", tool: "deploy", approvalId: first.approvalId }).allow, false);

  p.resolveApproval(first.approvalId, true, "zaryu");
  const after = p.decide({ agent: "x", tool: "deploy", approvalId: first.approvalId });
  assert.equal(after.allow, true);
});

test("an approval cannot be replayed for a different agent or tool", () => {
  const { p } = mk();
  const entry = p.assign("thief", "lightvela/infra");
  p.resolveApproval(entry.approvalId, true, "zaryu");
  p.assign("victim", "lightvela/infra");

  const ap = p.decide({ agent: "thief", tool: "deploy" });
  p.resolveApproval(ap.approvalId, true, "zaryu");

  // Same token, different tool → refused.
  const wrongTool = p.decide({ agent: "thief", tool: "kubectl", approvalId: ap.approvalId });
  assert.equal(wrongTool.allow, false);

  // Same token, different agent → refused.
  const wrongAgent = p.decide({ agent: "someone-else", tool: "deploy", approvalId: ap.approvalId });
  assert.equal(wrongAgent.allow, false);
});

test("approvals expire, and an expired one does not unlock anything", () => {
  const c = clock();
  const p = new FloorPlanPolicy(DEFAULT_POLICY, { now: c.now, approvalTtlMs: 1000 });
  const entry = p.assign("x", "lightvela/infra");
  c.advance(1500);
  assert.equal(p.getApproval(entry.approvalId).status, "expired");
  assert.equal(p.resolveApproval(entry.approvalId, true).ok, false);
  assert.equal(p.roomFor("x"), "belum-dipetakan");
});

test("a resolved approval cannot be resolved twice", () => {
  const { p } = mk();
  const entry = p.assign("x", "lightvela/infra");
  assert.equal(p.resolveApproval(entry.approvalId, true).ok, true);
  const again = p.resolveApproval(entry.approvalId, false);
  assert.equal(again.ok, false);
  assert.match(again.error, /already approved/);
});

test("approval requests and resolutions are broadcast", () => {
  const seen = [];
  const { p } = mk({ onEvent: (e) => seen.push(e) });
  const entry = p.assign("x", "lightvela/infra");
  p.resolveApproval(entry.approvalId, true, "zaryu");

  const req = seen.find((e) => e.type === "approval_requested");
  const res = seen.find((e) => e.type === "approval_resolved");
  assert.equal(req.agent, "x");
  assert.equal(req.kind, "entry");
  assert.equal(res.state, "approved");
  assert.equal(res.resolvedBy, "zaryu");
});

test("the approval map is swept so it cannot grow without bound", () => {
  const c = clock();
  const p = new FloorPlanPolicy(DEFAULT_POLICY, { now: c.now, approvalTtlMs: 1000 });
  for (let i = 0; i < 50; i++) p.assign(`a${i}`, "lightvela/infra");
  assert.equal(p.approvals.size, 50);
  c.advance(2000);
  assert.equal(p.pendingApprovals().length, 0, "all expired");
  c.advance(3_600_001);
  p.sweepApprovals();
  assert.equal(p.approvals.size, 0);
});

// --- room as a spend envelope ---------------------------------------------

test("a small room cannot burn much, regardless of the agent's own budget", () => {
  const c = clock();
  const burn = new BurnRateTracker({}, { now: c.now }); // no agent/global cap
  const p = new FloorPlanPolicy(DEFAULT_POLICY, { now: c.now, burn });

  p.assign("x", "mac/sites"); // $2.00/hr envelope
  assert.equal(p.decide({ agent: "x", tool: "llm:a", model: "claude-sonnet-4-5" }).allow, true);

  p.recordSpend("x", 2.0);
  const d = p.decide({ agent: "x", tool: "llm:a", model: "claude-sonnet-4-5" });
  assert.equal(d.allow, false);
  assert.equal(d.scope, "room");
  assert.match(d.reason, /Sites budget exhausted/);
});

test("room spend follows the agent when it moves", () => {
  const c = clock();
  const p = new FloorPlanPolicy(DEFAULT_POLICY, { now: c.now });
  p.assign("x", "mac/sites");
  p.recordSpend("x", 1.5);
  assert.equal(Math.round(p.roomSpentHour("mac/sites") * 100) / 100, 1.5);

  p.assign("x", "mac/labs");
  p.recordSpend("x", 0.4);
  assert.equal(Math.round(p.roomSpentHour("mac/labs") * 100) / 100, 0.4);
  assert.equal(Math.round(p.roomSpentHour("mac/sites") * 100) / 100, 1.5, "history stays with the room");
});

test("the agent budget still applies on top of the room envelope", () => {
  const c = clock();
  const burn = new BurnRateTracker({ agentHourlyUsd: 0.10 }, { now: c.now });
  const p = new FloorPlanPolicy(DEFAULT_POLICY, { now: c.now, burn });
  // ceo-office is entryApproval, so the grant must actually be signed off —
  // the first draft of this test silently left the agent in the lobby.
  const entry = p.assign("x", "mac/dinas");
  p.resolveApproval(entry.approvalId, true, "zaryu");
  assert.equal(p.roomFor("x"), "mac/dinas"); // generous $10/hr room

  burn.record({ agent: "x", costUsd: 0.10 });
  const d = p.decide({ agent: "x", tool: "llm:a", model: "claude-sonnet-4-5" });
  assert.equal(d.allow, false, "the stricter agent cap governs");
  assert.equal(d.scope, "agent");
});

// --- snapshot --------------------------------------------------------------

test("the snapshot is a complete, readable description of the floor plan", () => {
  const { p } = mk();
  p.assign("x", "mac/sites", "zaryu");
  const s = p.snapshot();

  assert.equal(s.defaultRoom, "belum-dipetakan");
  const lobby = s.rooms.find((r) => r.room === "belum-dipetakan");
  assert.equal(lobby.maxModelTier, "cheap");

  const sr = s.rooms.find((r) => r.room === "lightvela/infra");
  assert.equal(sr.entryApproval, true);
  assert.ok(sr.approval.includes("deploy"));

  const office = s.rooms.find((r) => r.room === "mac/sites");
  assert.deepEqual(office.occupants.map((o) => o.agent), ["x"]);
  assert.equal(office.budgetHourlyUsd, 1.5);
});

// --- the floor plan is the owner's ecosystem, not the fork's office --------
//
// Until 2026-10-17 this table held eight rooms inherited from the fork:
// lobby, main-office, meeting-room, server-room, mac-studio, ceo-office,
// kitchen, nap-room. The owner has two machines and fifteen folders, and no
// lobby. These tests fail if any of that vocabulary comes back, and they are
// written against the authoritative list rather than a copy of it.

test("the floor plan has no room the fork invented", () => {
  const { p } = mk();
  const gone = [
    "lobby", "main-office", "meeting-room", "server-room",
    "mac-studio", "ceo-office", "kitchen", "nap-room",
  ];
  for (const id of gone) {
    assert.ok(!p.room(id), `${id} is back in the floor plan`);
  }
  assert.ok(!gone.includes(p.defaultRoom()), "the default room is a fork room again");
});

test("every room the ecosystem declares has a policy, and no room has a policy without it", () => {
  // frontend/src/eco/ecosystem.ts is the authoritative transcription of the
  // owner's AGENTS.md. Reading it here rather than restating it is the point:
  // adding a room there must break this test until policy catches up.
  const src = readFileSync(
    new URL("../frontend/src/eco/ecosystem.ts", import.meta.url),
    "utf8"
  );
  // Only the ROOMS blocks: desks carry `id` and `office` too, and matching
  // them turned this into an assertion that every repo needs its own policy.
  const roomsBlock = src.slice(
    src.indexOf("const MAC_ROOMS"),
    src.indexOf("export const ROOMS")
  );
  const declared = [...roomsBlock.matchAll(/\{\s*id:\s*'([^']+)',\s*office:\s*'([^']+)'/g)]
    .map(([, id, office]) => `${office}/${id}`);

  assert.ok(declared.length >= 15, `expected the 15 ecosystem rooms, parsed ${declared.length}`);

  const { p } = mk();
  const inPolicy = p.snapshot().rooms.map((r) => r.room);

  for (const room of declared) {
    assert.ok(inPolicy.includes(room), `${room} is declared but has no policy — agents there would be governed as ${p.defaultRoom()}`);
  }
  // The only room allowed to exist without being an ecosystem room is the
  // one that means "we do not know where this agent belongs".
  const extra = inPolicy.filter((r) => !declared.includes(r));
  assert.deepEqual(extra, ["belum-dipetakan"], "a room exists that the ecosystem never declared");
});

test("the default room is always a real entry in the table", () => {
  // decide() refuses with `no policy for this room` when it cannot find the
  // room. roomFor() degrades to the default, so if the default itself were
  // missing every unplaced agent would be refused everything.
  const { p } = mk();
  assert.ok(p.room(p.defaultRoom()), "defaultRoom names a room that does not exist");
  assert.equal(p.decide({ agent: "nobody-placed-me", tool: "read_file" }).allow, true);
});

test("an agent in a withdrawn room degrades to the default, it is not frozen", () => {
  const { p } = mk();
  p.assignments.set("ghost", { room: "server-room", since: 0, grantedBy: "x" });
  assert.equal(p.roomFor("ghost"), "belum-dipetakan");
  assert.equal(p.decide({ agent: "ghost", tool: "read_file" }).allow, true, "frozen, not degraded");
  assert.equal(p.decide({ agent: "ghost", tool: "bash" }).allow, false);
});

test("deploy is reachable in three rooms and signed for in all of them", () => {
  const { p } = mk();
  const withProd = p.snapshot().rooms.filter(
    (r) => r.toolsAllow.includes("*") && !r.toolsDeny.includes("deploy")
  );
  const names = withProd.map((r) => r.room).sort();
  // Mac services ship, both LightVela rooms run live things. Everywhere else
  // deploy is denied outright rather than gated, because nothing there ships.
  assert.deepEqual(
    names,
    ["lightvela/infra", "lightvela/root", "mac/services"],
    "deploy reachable somewhere unexpected"
  );
  for (const r of withProd) {
    assert.ok(r.approval.includes("deploy"), `${r.room} allows deploy with no sign-off`);
  }
  // And the twelve remaining rooms must not quietly allow it.
  const rest = p.snapshot().rooms.filter((r) => !names.includes(r.room));
  for (const r of rest) {
    const reachable = r.toolsAllow.includes("*") && !r.toolsDeny.includes("deploy");
    assert.ok(!reachable, `${r.room} can deploy and nobody declared it`);
  }
});

// --- the rung that ranked without refusing ---------------------------------
//
// Rooms used to carry trust: untrusted | standard | privileged | idle. It was
// written in eight places, copied into three outputs and one event, and read
// by nothing. These tests fail if it comes back, and they are written so they
// cannot pass while it exists: they name the field, not a derived value.

test("the floor plan no longer ranks rooms by a trust rung", () => {
  const { p } = mk();
  const s = p.snapshot();

  for (const r of s.rooms) {
    assert.ok(
      !("trust" in r),
      `room ${r.room} still publishes a trust rung: ${JSON.stringify(r.trust)}`
    );
  }
});

test("a refusal cites the mechanism that refused, not a rank", () => {
  const { p } = mk();
  p.assign("x", "belum-dipetakan", "zaryu");

  // lobby denies bash by scope, not by being "untrusted".
  const d = p.decide({ agent: "x", tool: "bash" });
  assert.equal(d.allow, false);
  assert.ok(!("trust" in d), "the decision still carries a trust rung");
  assert.match(d.reason, /bash/, "the reason should name the tool it refused");
});

test("moving an agent records where it went, not how trusted it became", () => {
  const seen = [];
  const { p } = mk({ onEvent: (e) => seen.push(e) });
  // main-office, not "lightvela/infra": the latter has entryApproval, so the move
  // is held for sign-off and never emits agent_moved.
  p.assign("x", "mac/sites", "zaryu");

  const moved = seen.filter((e) => e.type === "agent_moved");
  assert.ok(moved.length >= 1, "the move should have been recorded");
  for (const e of moved) {
    assert.ok(!("trust" in e), "agent_moved still carries a trust rung");
    assert.equal(e.room, "mac/sites");
  }
});

// --- floor visibility vs floor governance ----------------------------------
//
// roomFor() and isAssigned() answer different questions and the gap between
// them is what left every room's `occupants` empty on a live instance while
// the policy engine happily governed those same agents as lobby residents.

test("isAssigned separates 'placed on the floor' from 'governed somewhere'", () => {
  const { p } = mk();

  // Never seen: governed as lobby, but not standing anywhere.
  assert.equal(p.roomFor("ghost"), "belum-dipetakan");
  assert.equal(p.isAssigned("ghost"), false);

  p.assign("ghost", "belum-dipetakan", "auto");

  // Governance answer is unchanged — that is the point. Only visibility moved.
  assert.equal(p.roomFor("ghost"), "belum-dipetakan");
  assert.equal(p.isAssigned("ghost"), true);
});

test("isAssigned is false when the recorded room no longer exists", () => {
  // Mirrors roomFor()'s own guard: a policy reload can delete a room out from
  // under an assignment, and a stale pointer must not read as a placement.
  // main-office, not "lightvela/infra": the privileged rooms carry entryApproval, so
  // assign() parks the move as a pending approval instead of committing it —
  // which is correct, and would make this test assert the wrong thing.
  const { p } = mk();
  p.assign("drifter", "mac/sites", "owner");
  assert.equal(p.isAssigned("drifter"), true);

  p.assignments.set("drifter", { room: "room-that-was-deleted", since: 0, grantedBy: "owner" });
  assert.equal(p.isAssigned("drifter"), false);
  assert.equal(p.roomFor("drifter"), "belum-dipetakan");
});

test("placing an agent in the default room puts it in that room's occupants", () => {
  const { p } = mk();
  const before = p.snapshot().rooms.find((r) => r.room === "belum-dipetakan");
  assert.equal(before.occupants.length, 0);

  p.assign("cloud", p.defaultRoom(), "auto");

  const after = p.snapshot().rooms.find((r) => r.room === "belum-dipetakan");
  assert.deepEqual(after.occupants.map((o) => o.agent), ["cloud"]);
  assert.equal(after.occupants[0].grantedBy, "auto");
});

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
  assert.deepEqual(loadPolicy('{"defaultRoom":"kitchen"}').defaultRoom, "kitchen");
});

// --- deny by default -------------------------------------------------------

test("an unassigned agent lands in the least privileged room", () => {
  const { p } = mk();
  assert.equal(p.roomFor("stranger"), "lobby");
  const d = p.decide({ agent: "stranger", tool: "bash" });
  assert.equal(d.allow, false);
  assert.equal(d.room, "lobby");
});

test("an unknown assigned room degrades to the default, it does not fail open", () => {
  const { p } = mk();
  p.assignments.set("ghost", { room: "atlantis", since: 0, grantedBy: "x" });
  assert.equal(p.roomFor("ghost"), "lobby");
  assert.equal(p.decide({ agent: "ghost", tool: "bash" }).allow, false);
});

test("a denial says where the tool would be allowed", () => {
  const { p } = mk();
  const d = p.decide({ agent: "x", tool: "kubectl" });
  assert.equal(d.allow, false);
  assert.match(d.hint, /Server Room/);
  assert.match(d.hint, /sign-off/);
});

test("the deny list beats the allow list", () => {
  const { p } = mk();
  p.assign("x", "main-office");
  // main-office allows "*" but explicitly denies bash.
  assert.equal(p.decide({ agent: "x", tool: "web_search" }).allow, true);
  assert.equal(p.decide({ agent: "x", tool: "bash" }).allow, false);
});

// --- rooms as trust zones --------------------------------------------------

test("moving an agent changes what it may do", () => {
  const { p } = mk();
  assert.equal(p.decide({ agent: "x", tool: "write_file" }).allow, false, "lobby is read-only-ish");
  p.assign("x", "main-office", "zaryu");
  assert.equal(p.decide({ agent: "x", tool: "write_file" }).allow, true);
});

test("the grant is recorded with who made it — this is the audit answer", () => {
  const seen = [];
  const { p } = mk({ onEvent: (e) => seen.push(e) });
  p.assign("x", "main-office", "zaryu");

  const moved = seen.find((e) => e.type === "agent_moved");
  assert.equal(moved.agent, "x");
  assert.equal(moved.fromRoom, "lobby");
  assert.equal(moved.room, "main-office");
  assert.equal(moved.grantedBy, "zaryu");

  const snap = p.snapshot();
  const office = snap.rooms.find((r) => r.room === "main-office");
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

  p.assign("x", "main-office");
  assert.equal(p.decide({ agent: "x", tool: "llm:opus", model: "claude-opus-4" }).allow, true);
});

test("a break room has no spend allowance, so agents parked there are idle", () => {
  const { p } = mk();
  p.assign("x", "kitchen");
  const d = p.decide({ agent: "x", tool: "llm:cheap", model: "gpt-4o-mini" });
  assert.equal(d.allow, false);
  assert.match(d.reason, /idle|allowance/);
});

test("assigning to a room that does not exist is an error, not a silent grant", () => {
  const { p } = mk();
  const r = p.assign("x", "the-void");
  assert.equal(r.ok, false);
  assert.match(r.error, /Unknown room/);
  assert.equal(p.roomFor("x"), "lobby");
});

// --- doors as gates --------------------------------------------------------

test("entering a privileged room is held at the door until a human signs off", () => {
  const { p } = mk();
  const r = p.assign("x", "server-room", "zaryu");
  assert.equal(r.ok, false);
  assert.equal(r.pending, true);
  assert.ok(r.approvalId);
  assert.equal(p.roomFor("x"), "lobby", "the agent has NOT moved yet");

  p.resolveApproval(r.approvalId, true, "zaryu");
  assert.equal(p.roomFor("x"), "server-room", "approval performs the move");
});

test("a denied entry leaves the agent where it was", () => {
  const { p } = mk();
  const r = p.assign("x", "server-room");
  p.resolveApproval(r.approvalId, false, "zaryu");
  assert.equal(p.roomFor("x"), "lobby");
  assert.equal(p.getApproval(r.approvalId).status, "denied");
});

test("a dangerous tool needs its own sign-off even inside the privileged room", () => {
  // Two independent gates: being in the room, and using the tool.
  const { p } = mk();
  const entry = p.assign("x", "server-room");
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
  const entry = p.assign("thief", "server-room");
  p.resolveApproval(entry.approvalId, true, "zaryu");
  p.assign("victim", "server-room");

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
  const entry = p.assign("x", "server-room");
  c.advance(1500);
  assert.equal(p.getApproval(entry.approvalId).status, "expired");
  assert.equal(p.resolveApproval(entry.approvalId, true).ok, false);
  assert.equal(p.roomFor("x"), "lobby");
});

test("a resolved approval cannot be resolved twice", () => {
  const { p } = mk();
  const entry = p.assign("x", "server-room");
  assert.equal(p.resolveApproval(entry.approvalId, true).ok, true);
  const again = p.resolveApproval(entry.approvalId, false);
  assert.equal(again.ok, false);
  assert.match(again.error, /already approved/);
});

test("approval requests and resolutions are broadcast", () => {
  const seen = [];
  const { p } = mk({ onEvent: (e) => seen.push(e) });
  const entry = p.assign("x", "server-room");
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
  for (let i = 0; i < 50; i++) p.assign(`a${i}`, "server-room");
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

  p.assign("x", "main-office"); // $2.00/hr envelope
  assert.equal(p.decide({ agent: "x", tool: "llm:a", model: "claude-sonnet-4-5" }).allow, true);

  p.recordSpend("x", 2.0);
  const d = p.decide({ agent: "x", tool: "llm:a", model: "claude-sonnet-4-5" });
  assert.equal(d.allow, false);
  assert.equal(d.scope, "room");
  assert.match(d.reason, /Main Office budget exhausted/);
});

test("room spend follows the agent when it moves", () => {
  const c = clock();
  const p = new FloorPlanPolicy(DEFAULT_POLICY, { now: c.now });
  p.assign("x", "main-office");
  p.recordSpend("x", 1.5);
  assert.equal(Math.round(p.roomSpentHour("main-office") * 100) / 100, 1.5);

  p.assign("x", "meeting-room");
  p.recordSpend("x", 0.4);
  assert.equal(Math.round(p.roomSpentHour("meeting-room") * 100) / 100, 0.4);
  assert.equal(Math.round(p.roomSpentHour("main-office") * 100) / 100, 1.5, "history stays with the room");
});

test("the agent budget still applies on top of the room envelope", () => {
  const c = clock();
  const burn = new BurnRateTracker({ agentHourlyUsd: 0.10 }, { now: c.now });
  const p = new FloorPlanPolicy(DEFAULT_POLICY, { now: c.now, burn });
  // ceo-office is entryApproval, so the grant must actually be signed off —
  // the first draft of this test silently left the agent in the lobby.
  const entry = p.assign("x", "ceo-office");
  p.resolveApproval(entry.approvalId, true, "zaryu");
  assert.equal(p.roomFor("x"), "ceo-office"); // generous $10/hr room

  burn.record({ agent: "x", costUsd: 0.10 });
  const d = p.decide({ agent: "x", tool: "llm:a", model: "claude-sonnet-4-5" });
  assert.equal(d.allow, false, "the stricter agent cap governs");
  assert.equal(d.scope, "agent");
});

// --- snapshot --------------------------------------------------------------

test("the snapshot is a complete, readable description of the floor plan", () => {
  const { p } = mk();
  p.assign("x", "main-office", "zaryu");
  const s = p.snapshot();

  assert.equal(s.defaultRoom, "lobby");
  const lobby = s.rooms.find((r) => r.room === "lobby");
  assert.equal(lobby.trust, "untrusted");
  assert.equal(lobby.maxModelTier, "cheap");

  const sr = s.rooms.find((r) => r.room === "server-room");
  assert.equal(sr.entryApproval, true);
  assert.ok(sr.approval.includes("deploy"));

  const office = s.rooms.find((r) => r.room === "main-office");
  assert.deepEqual(office.occupants.map((o) => o.agent), ["x"]);
  assert.equal(office.budgetHourlyUsd, 2);
});

/**
 * ledger.test.js — the flight recorder's whole value is that it detects
 * tampering, so most of these tests are attacks rather than happy paths.
 *
 * Note the deliberate negative test at the end: the chain CANNOT detect tail
 * truncation, and that limitation is asserted rather than hidden, so nobody
 * later reads the passing suite as proof of a guarantee the design does not
 * make.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { FlightRecorder, canonicalJson, hashRecord, GENESIS_HASH } from "../server/ledger.js";
import { renderMarkdown, summarize, narrate } from "../server/dossier.js";

function fresh(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ledger-"));
  const rec = new FlightRecorder({ dbPath: join(dir, "t.db"), ...opts });
  return { rec, dir, cleanup: () => { rec.close(); rmSync(dir, { recursive: true, force: true }); } };
}

// --- canonical serialization ------------------------------------------------
// If this is wrong the chain throws false alarms on honest data, which in an
// audit is nearly as damaging as missing a real edit.

test("canonicalJson: key order never changes the output", () => {
  const a = { zebra: 1, alpha: 2, mid: { y: 1, x: 2 } };
  const b = { mid: { x: 2, y: 1 }, alpha: 2, zebra: 1 };
  assert.equal(canonicalJson(a), canonicalJson(b));
  assert.equal(canonicalJson(a), '{"alpha":2,"mid":{"x":2,"y":1},"zebra":1}');
});

test("canonicalJson: array order IS significant", () => {
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
});

test("canonicalJson: undefined dropped from objects, nulled in arrays (matches JSON.stringify)", () => {
  assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
  assert.equal(canonicalJson([1, undefined, 2]), "[1,null,2]");
});

test("canonicalJson: non-finite numbers have no JSON form, become null", () => {
  assert.equal(canonicalJson({ a: NaN, b: Infinity, c: -Infinity }), '{"a":null,"b":null,"c":null}');
});

test("canonicalJson: cycles throw rather than silently truncating", () => {
  const o = { a: 1 };
  o.self = o;
  assert.throws(() => canonicalJson(o), /circular/);
});

test("canonicalJson: strings with quotes/newlines round-trip through JSON.parse", () => {
  const tricky = { s: 'he said "no"\n\tand left', u: "émoji 🚀", k: "a|b" };
  assert.deepEqual(JSON.parse(canonicalJson(tricky)), tricky);
});

// --- chain construction -----------------------------------------------------

test("chain: opens with a genesis-linked record so a wiped log looks new", () => {
  const { rec, cleanup } = fresh();
  try {
    const rows = rec.query({});
    assert.equal(rows.length, 1);
    assert.equal(rows[0].type, "chain_opened");
    assert.equal(rows[0].prevHash, GENESIS_HASH, "first record must link to genesis");
    assert.equal(rec.verify().ok, true);
  } finally { cleanup(); }
});

test("chain: each record links to the one before it", () => {
  const { rec, cleanup } = fresh();
  try {
    const a = rec.record("policy_decision", { agent: "x", action: "allow" });
    const b = rec.record("policy_decision", { agent: "y", action: "deny" });
    assert.equal(b.prevHash, a.hash);
    assert.equal(rec.head().hash, b.hash);
    assert.equal(rec.verify().ok, true);
  } finally { cleanup(); }
});

test("chain: identical payloads produce different hashes (position is bound in)", () => {
  const { rec, cleanup } = fresh();
  try {
    const p = { agent: "same", action: "allow", tool: "bash" };
    const a = rec.record("policy_decision", p, { ts: 1000 });
    const b = rec.record("policy_decision", p, { ts: 1000 });
    assert.notEqual(a.hash, b.hash, "otherwise two identical decisions could be swapped undetected");
  } finally { cleanup(); }
});

test("chain: survives reopening the database", () => {
  const dir = mkdtempSync(join(tmpdir(), "ledger-"));
  const path = join(dir, "t.db");
  try {
    const r1 = new FlightRecorder({ dbPath: path });
    r1.record("policy_decision", { agent: "a", action: "allow" });
    const head = r1.head();
    r1.close();

    const r2 = new FlightRecorder({ dbPath: path });
    assert.equal(r2.head().hash, head.hash, "head must be recovered, not restarted");
    assert.equal(r2.head().seq, head.seq);
    const next = r2.record("policy_decision", { agent: "b", action: "deny" });
    assert.equal(next.prevHash, head.hash, "the chain must continue, not fork");
    assert.equal(r2.verify().ok, true);
    r2.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("chain: rejects unknown record types", () => {
  const { rec, cleanup } = fresh();
  try {
    assert.throws(() => rec.record("totally_made_up", {}), /unknown record type/);
  } finally { cleanup(); }
});

// --- tampering --------------------------------------------------------------

test("tamper: editing a payload in place is detected and named", () => {
  const { rec, dir, cleanup } = fresh();
  try {
    rec.record("policy_decision", { agent: "deployer", action: "deny", tool: "kubectl" });
    rec.record("policy_decision", { agent: "planner", action: "allow" });
    assert.equal(rec.verify().ok, true);

    // The incriminating move: rewrite a refusal as a permission.
    const raw = new Database(join(dir, "t.db"));
    raw.prepare("UPDATE ledger SET payload = ? WHERE seq = 2")
      .run('{"action":"allow","agent":"deployer","tool":"kubectl"}');
    raw.close();

    const v = rec.verify();
    assert.equal(v.ok, false);
    assert.equal(v.reason, "content-altered");
    assert.equal(v.brokenAt, 2, "must name the exact record");
    assert.match(v.detail, /changed after it was written/);
  } finally { cleanup(); }
});

test("tamper: altering a timestamp is detected", () => {
  const { rec, dir, cleanup } = fresh();
  try {
    rec.record("approval_resolved", { approvalId: "ap-1", state: "denied" });
    const raw = new Database(join(dir, "t.db"));
    raw.prepare("UPDATE ledger SET ts = ts + 86400000 WHERE seq = 2").run();
    raw.close();
    const v = rec.verify();
    assert.equal(v.ok, false, "ts is part of the preimage, so moving an event in time must break it");
    assert.equal(v.brokenAt, 2);
  } finally { cleanup(); }
});

test("tamper: deleting a record from the middle is detected", () => {
  const { rec, dir, cleanup } = fresh();
  try {
    for (let i = 0; i < 5; i++) rec.record("policy_decision", { agent: `a${i}`, action: "allow" });
    const raw = new Database(join(dir, "t.db"));
    raw.prepare("DELETE FROM ledger WHERE seq = 3").run();
    raw.close();
    const v = rec.verify();
    assert.equal(v.ok, false);
    assert.equal(v.reason, "broken-link", "record 4 still points at the hash of the deleted record 3");
    assert.equal(v.brokenAt, 4);
  } finally { cleanup(); }
});

test("tamper: re-hashing an edited record still breaks the following link", () => {
  // A smarter attacker edits the payload AND recomputes that record's hash.
  // The chain must still break, because record N+1 committed to the old hash.
  const { rec, dir, cleanup } = fresh();
  try {
    rec.record("policy_decision", { agent: "deployer", action: "deny" });
    rec.record("policy_decision", { agent: "deployer", action: "allow" });

    const raw = new Database(join(dir, "t.db"));
    const row = raw.prepare("SELECT * FROM ledger WHERE seq = 2").get();
    const forgedPayload = '{"action":"allow","agent":"deployer"}';
    const forgedHash = hashRecord({
      seq: row.seq, ts: row.ts, prevHash: row.prev_hash,
      type: row.type, actor: row.actor, payloadJson: forgedPayload,
    });
    raw.prepare("UPDATE ledger SET payload = ?, hash = ? WHERE seq = 2").run(forgedPayload, forgedHash);
    raw.close();

    const v = rec.verify();
    assert.equal(v.ok, false, "record 3 committed to the pre-forgery hash of record 2");
    assert.equal(v.reason, "broken-link");
    assert.equal(v.brokenAt, 3);
  } finally { cleanup(); }
});

test("LIMITATION: tail truncation is NOT detected by the chain alone", () => {
  // Asserted on purpose. The chain cannot see records that no longer exist,
  // and a shortened chain is internally consistent. Only an externally
  // anchored head hash closes this. docs/FLIGHT-RECORDER.md says so; this
  // test stops the claim from quietly inflating over time.
  const { rec, dir, cleanup } = fresh();
  try {
    for (let i = 0; i < 5; i++) rec.record("policy_decision", { agent: `a${i}`, action: "deny" });
    const anchoredHead = rec.head().hash;

    const raw = new Database(join(dir, "t.db"));
    raw.prepare("DELETE FROM ledger WHERE seq > 3").run();
    raw.close();

    const r2 = new FlightRecorder({ dbPath: join(dir, "t.db") });
    assert.equal(r2.verify().ok, true, "the truncated chain still verifies — this is the known gap");
    // ...but an anchored head exposes it immediately:
    assert.notEqual(r2.head().hash, anchoredHead, "which is exactly why the head must be published");
    r2.close();
  } finally { cleanup(); }
});

// --- retention --------------------------------------------------------------

test("retention: pruning removes a prefix and declares the gap", () => {
  const { rec, cleanup } = fresh({ retentionDays: 30 });
  try {
    const old = Date.now() - 60 * 86_400_000;
    for (let i = 0; i < 4; i++) rec.record("policy_decision", { agent: `old${i}` }, { ts: old + i });
    rec.record("policy_decision", { agent: "recent" });

    const before = rec.count();
    const r = rec.prune();
    assert.ok(r.pruned > 0, "aged records should go");
    assert.ok(rec.count() < before);

    const marker = rec.query({ type: "chain_truncated" });
    assert.equal(marker.length, 1, "the gap must be declared in-chain, not silent");
    assert.equal(marker[0].payload.removedCount, r.pruned);
    assert.ok(marker[0].payload.lastRemovedHash, "the boundary hash lets an auditor bridge the gap");

    assert.equal(rec.verify().ok, true, "the surviving chain must still verify");
  } finally { cleanup(); }
});

test("retention: refuses to empty the chain entirely", () => {
  const { rec, cleanup } = fresh({ retentionDays: 1 });
  try {
    const old = Date.now() - 400 * 86_400_000;
    // Force every record, including the head, to be ancient.
    rec.db.prepare("UPDATE ledger SET ts = ?").run(old);
    const r = rec.prune();
    assert.equal(r.pruned, 0);
    assert.match(r.note, /would empty the chain/);
  } finally { cleanup(); }
});

test("retention: disabled when retentionDays is 0", () => {
  const { rec, cleanup } = fresh({ retentionDays: 0 });
  try {
    rec.record("policy_decision", { agent: "x" }, { ts: Date.now() - 9999 * 86_400_000 });
    assert.equal(rec.prune().pruned, 0);
  } finally { cleanup(); }
});

// --- checkpoints & query ----------------------------------------------------

test("checkpoint: written automatically and records the head at that moment", () => {
  const { rec, cleanup } = fresh({ checkpointEvery: 5 });
  try {
    for (let i = 0; i < 12; i++) rec.record("policy_decision", { agent: `a${i}` });
    const cps = rec.query({ type: "chain_checkpoint" });
    assert.ok(cps.length >= 2, `expected periodic checkpoints, got ${cps.length}`);
    assert.ok(cps[0].payload.headHash);
    assert.equal(rec.verify().ok, true);
  } finally { cleanup(); }
});

test("query: filters by type, subject and time window", () => {
  const { rec, cleanup } = fresh();
  try {
    rec.record("policy_decision", { agent: "alice", action: "deny" }, { subject: "alice", ts: 1000 });
    rec.record("policy_decision", { agent: "bob", action: "allow" }, { subject: "bob", ts: 2000 });
    rec.record("agent_moved", { agent: "alice", room: "server-room" }, { subject: "alice", ts: 3000 });

    assert.equal(rec.query({ subject: "alice" }).length, 2);
    assert.equal(rec.query({ type: "agent_moved" }).length, 1);
    assert.equal(rec.query({ from: 1500, to: 2500 }).length, 1);
  } finally { cleanup(); }
});

// --- dossier ----------------------------------------------------------------

test("dossier: states plainly when the chain does not verify", () => {
  const md = renderMarkdown({
    records: [],
    verification: { ok: false, reason: "content-altered", brokenAt: 7, detail: "record 7 was changed" },
    period: { fromIso: "2026-09-01T00:00:00Z", toIso: "2026-10-01T00:00:00Z" },
  });
  assert.match(md, /DOES NOT VERIFY/);
  assert.match(md, /must not be relied upon/);
  assert.match(md, /sequence 7/);
});

test("dossier: never overstates what the hash chain proves", () => {
  const md = renderMarkdown({
    records: [],
    verification: { ok: true, checked: 3, firstSeq: 1, lastSeq: 3, head: "abc" },
    period: { fromIso: "2026-09-01T00:00:00Z", toIso: "2026-10-01T00:00:00Z" },
  });
  assert.match(md, /does \*not\*, by itself, prove/);
  assert.match(md, /deleted from the end of the log/, "tail truncation must be disclosed to the reader");
  assert.match(md, /anchored outside this system/);
});

test("dossier: narrates an approval in language a non-engineer can read", () => {
  const s = narrate({
    seq: 9, ts: Date.now(), type: "approval_requested",
    payload: { approvalId: "ap-3-x", agent: "deployer", kind: "tool", tool: "kubectl", room: "server-room" },
  });
  assert.match(s, /deployer requested human approval to run/);
  assert.match(s, /blocked pending a decision/);
  assert.ok(!s.includes("{"), "no raw JSON should leak into the prose");
});

test("dossier: Art. 14 section quantifies the human intervention", () => {
  const now = Date.now();
  const records = [
    { seq: 1, ts: now, type: "approval_requested",
      payload: { approvalId: "ap-1", agent: "deployer", kind: "tool", tool: "kubectl", room: "server-room" } },
    { seq: 2, ts: now + 4000, type: "approval_resolved",
      payload: { approvalId: "ap-1", agent: "deployer", state: "denied", decidedBy: "owner", waitedMs: 4000, tool: "kubectl" } },
  ];
  const md = renderMarkdown({
    records,
    verification: { ok: true, checked: 2, firstSeq: 1, lastSeq: 2, head: "h" },
    period: { fromIso: "2026-10-01T00:00:00Z", toIso: "2026-10-02T00:00:00Z" },
  });
  assert.match(md, /Human oversight \(Art\. 14\)/);
  assert.match(md, /1 action was \*\*stopped by the system/, "singular, because an evidence document should read like prose");
  assert.match(md, /4\.0 seconds/, "median wait is the evidence that oversight was real");
  assert.match(md, /a human did in fact intervene/);
});

test("dossier: an attacker-chosen agent name cannot forge document structure", () => {
  // Agent names arrive from OTLP spans, so they are attacker-influenced. A
  // dossier is evidence; forging a heading or a table row inside it would be
  // a way to mislead an assessor.
  const hostile = "evil`\n\n## Forged Heading\n\n| x | y |";
  const md = renderMarkdown({
    records: [
      { seq: 1, ts: Date.now(), type: "approval_requested",
        payload: { approvalId: "ap-1", agent: hostile, kind: "tool", tool: "k|c", room: "server-room" } },
      { seq: 2, ts: Date.now() + 1, type: "approval_resolved",
        payload: { approvalId: "ap-1", agent: hostile, state: "approved", decidedBy: "owner", waitedMs: 1, tool: "k|c" } },
    ],
    verification: { ok: true, checked: 2, firstSeq: 1, lastSeq: 2, head: "h" },
    period: { fromIso: "2026-10-01T00:00:00Z", toIso: "2026-10-02T00:00:00Z" },
  });

  // The real property is structural: a hostile value must not be able to
  // start a new line, because Markdown only recognises headings and table
  // rows at the start of one. The text may survive inline; it is inert there.
  const headings = md.split("\n").filter((l) => /^#{1,6}\s/.test(l));
  assert.ok(
    headings.every((h) => !h.includes("Forged")),
    `a hostile value forged a heading: ${headings.filter((h) => h.includes("Forged")).join(" / ")}`
  );
  assert.ok(!md.includes("evil`"), "backticks must not survive, or they close the code span");
  // The name is still reported, just neutralised — redaction would be worse
  // than escaping, since the auditor needs to know who acted.
  assert.match(md, /evil'/);
  // Inside the Art. 14 table the pipe must additionally be escaped.
  const tableLine = md.split("\n").find((l) => l.includes("ap-1") && l.startsWith("| 2"));
  assert.ok(tableLine, "the resolved approval should appear in the oversight table");
  assert.ok(!/\|\s*k\|c\s*\|/.test(tableLine), "unescaped pipes would forge extra columns");
});

test("summarize: counts refusals and distinguishes expired from decided", () => {
  const s = summarize([
    { seq: 1, ts: 1, type: "policy_decision", payload: { action: "deny", agent: "a", tool: "bash" } },
    { seq: 2, ts: 2, type: "policy_decision", payload: { action: "allow", agent: "b" } },
    { seq: 3, ts: 3, type: "approval_resolved", payload: { state: "expired", waitedMs: 300000 } },
    { seq: 4, ts: 4, type: "approval_resolved", payload: { state: "approved", waitedMs: 1000 } },
  ]);
  assert.equal(s.decisions, 2);
  assert.equal(s.byAction.deny, 1);
  assert.equal(s.denials.length, 1);
  assert.equal(s.approvals.expired, 1);
  assert.equal(s.approvals.approved, 1);
  assert.deepEqual(s.agents, ["a", "b"]);
});

test("dossier: every refusal can be attributed to a named rule", () => {
  // A refusal with an empty "Rule" column is not defensible evidence — an
  // assessor cannot check a rule nobody can name. This shipped broken once:
  // room-policy denials carried no `scope`, so the column rendered blank.
  const md = renderMarkdown({
    records: [{
      seq: 3, ts: Date.now(), type: "policy_decision",
      payload: { agent: "deployer", tool: "kubectl", action: "deny", scope: "room",
                 room: "lobby", reason: "kubectl is outside the scope of Lobby" },
    }],
    verification: { ok: true, checked: 1, firstSeq: 3, lastSeq: 3, head: "h" },
    period: { fromIso: "2026-10-01T00:00:00Z", toIso: "2026-10-02T00:00:00Z" },
  });
  const row = md.split("\n").find((l) => l.startsWith("| 3 |"));
  assert.ok(row, "the refusal should appear in the refusals table");
  const cells = row.split("|").map((c) => c.trim());
  assert.ok(cells.every((c, i) => i === 0 || i === cells.length - 1 || c.length > 0),
    `every column must be populated, got: ${row}`);
  assert.ok(row.includes("room"), "the deciding rule must be named");
});

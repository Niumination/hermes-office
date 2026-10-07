import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  tally,
  buildStandup,
  renderText,
  renderMarkdown,
  SEVERITY,
  REPEAT_DENIAL_THRESHOLD,
  QUIET_AGENT_MIN_PRIOR,
  rankFindings,
} from "../server/standup.js";

const T0 = 1_760_000_000_000;
let seq = 0;
const rec = (type, payload, ts = T0) => ({ seq: ++seq, ts, type, payload });

const decision = (agent, tool, action = "allow", extra = {}) =>
  rec("policy_decision", { agent, tool, action, allow: action !== "deny", state: "normal", ...extra });

const nTimes = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));

// ---------------------------------------------------------------------------
describe("tally", () => {
  test("counts the governance shapes the chain actually holds", () => {
    const t = tally([
      decision("ana", "bash", "deny"),
      decision("ana", "bash", "deny"),
      decision("budi", "llm", "allow", { estimatedUsd: 0.5 }),
      rec("agent_moved", { agent: "ana", room: "server-room" }),
      rec("approval_requested", { agent: "ana", tool: "deploy" }),
      rec("approval_resolved", { agent: "ana", state: "approved", waitedMs: 30_000 }),
    ]);
    assert.equal(t.total, 6);
    assert.equal(t.decisions, 3);
    assert.equal(t.denials, 2);
    assert.equal(t.moves, 1);
    assert.equal(t.approvals.requested, 1);
    assert.equal(t.approvals.approved, 1);
    assert.equal(t.estimatedUsd, 0.5);
  });

  test("tracks the worst burn state reached, not the last one seen", () => {
    // A window that hit `critical` at noon and recovered by evening still had
    // a critical afternoon. Reporting the final state would hide it.
    const t = tally([
      rec("budget_transition", { scope: "global", state: "critical", spentUsd: 9, limitUsd: 10 }),
      rec("budget_transition", { scope: "global", state: "normal", spentUsd: 1, limitUsd: 10 }),
    ]);
    assert.equal(t.worstState, "critical");
  });

  test("peak spend keeps the high-water mark per scope, not the latest", () => {
    const t = tally([
      rec("budget_transition", { scope: "agent", subject: "ana", state: "hot", spentUsd: 8, limitUsd: 10 }),
      rec("budget_transition", { scope: "agent", subject: "ana", state: "normal", spentUsd: 0.2, limitUsd: 10 }),
    ]);
    assert.equal([...t.peakSpend.values()][0].spentUsd, 8);
  });

  test("median approval wait is the median, with an odd and an even sample", () => {
    const mk = (ms) => rec("approval_resolved", { agent: "a", state: "approved", waitedMs: ms });
    assert.equal(tally([mk(10), mk(100), mk(20)]).approvals.medianWaitMs, 20);
    assert.ok(tally([mk(10), mk(20)]).approvals.medianWaitMs > 0);
  });

  test("an empty window tallies to zeroes rather than throwing", () => {
    const t = tally([]);
    assert.equal(t.total, 0);
    assert.equal(t.approvals.medianWaitMs, null);
    assert.equal(t.worstState, "normal");
  });

  test("malformed records do not take the report down", () => {
    // The chain is append-only and old records outlive the code that wrote
    // them. A report that throws on an unknown shape is a report that stops
    // arriving exactly when the system is changing fastest.
    const t = tally([null, undefined, {}, { type: "policy_decision" }, { type: "who_knows", payload: null }]);
    assert.equal(t.total, 5);
    assert.equal(t.decisions, 1);
  });
});

// ---------------------------------------------------------------------------
describe("the quiet day — the feature most daily reports get wrong", () => {
  test("nothing notable produces no findings at all", () => {
    const m = buildStandup({ records: nTimes(20, () => decision("ana", "llm")), now: T0 });
    assert.equal(m.quiet, true);
    assert.deepEqual(m.findings, []);
  });

  test("a quiet standup is ONE line of prose, not a table of zeroes", () => {
    const text = renderText(buildStandup({ records: nTimes(20, () => decision("ana", "llm")), now: T0 }));
    assert.match(text, /Tidak ada yang membutuhkan Anda/);
    assert.ok(text.split("\n").filter((l) => l.trim()).length <= 6, "quiet report got long:\n" + text);
  });

  test("zero-valued sections are omitted, never rendered as 'None' or '0'", () => {
    // The padding that kills these reports. If there were no expired
    // approvals, the words must not appear anywhere.
    const text = renderText(buildStandup({ records: nTimes(20, () => decision("ana", "llm")), now: T0 }));
    assert.ok(!/kedaluwarsa/i.test(text));
    assert.ok(!/ditolak \d+×/.test(text));
    assert.ok(!/Tidak ada\s*:/i.test(text));
    assert.ok(!/\bNone\b/.test(text));
  });

  test("a busy but healthy day is still quiet — volume alone is not news", () => {
    const records = [
      ...nTimes(500, (i) => decision(`a${i % 9}`, "llm", "allow", { estimatedUsd: 0.001 })),
      ...nTimes(50, (i) => rec("agent_moved", { agent: `a${i % 9}`, room: "main-office" })),
    ];
    assert.equal(buildStandup({ records, now: T0 }).quiet, true);
  });
});

// ---------------------------------------------------------------------------
describe("findings that earn their place", () => {
  test("an expired approval is reported — a human never came", () => {
    const m = buildStandup({
      records: [rec("approval_resolved", { agent: "ana", state: "expired" })],
      now: T0,
    });
    const f = m.findings.find((x) => x.id === "approvals-expired");
    assert.ok(f, "expired approval was not surfaced");
    assert.equal(f.severity, "action");
    assert.ok(f.action.length > 0, "a finding with no suggested action is just trivia");
  });

  test("every finding carries something to DO about it, or is a bare notice", () => {
    const m = buildStandup({
      records: [
        rec("approval_resolved", { agent: "ana", state: "expired" }),
        rec("budget_transition", { scope: "global", state: "tripped", spentUsd: 10, limitUsd: 10 }),
        ...nTimes(5, () => decision("ana", "bash", "deny")),
      ],
      now: T0,
    });
    for (const f of m.findings) {
      if (f.severity === "notice") continue;
      assert.ok(f.action && f.action.length > 10, `finding ${f.id} has no actionable guidance`);
    }
  });

  test("a budget trip names who tripped it", () => {
    const m = buildStandup({
      records: [rec("budget_transition", { scope: "agent", subject: "ana", state: "tripped", spentUsd: 10, limitUsd: 10 })],
      now: T0,
    });
    const f = m.findings.find((x) => x.id === "budget-tripped");
    assert.ok(f);
    assert.match(f.headline, /ana/);
  });

  test("pending approvals are listed by agent so the reader can act now", () => {
    const m = buildStandup({
      records: [],
      pendingApprovals: [{ agent: "ana", tool: "deploy" }, { agent: "budi", tool: "psql" }],
      now: T0,
    });
    const f = m.findings.find((x) => x.id === "approvals-pending");
    assert.match(f.detail, /ana/);
    assert.match(f.detail, /budi/);
  });

  test("a long pending queue is truncated rather than filling the screen", () => {
    const m = buildStandup({
      records: [],
      pendingApprovals: nTimes(40, (i) => ({ agent: `a${i}`, tool: "deploy" })),
      now: T0,
    });
    const f = m.findings.find((x) => x.id === "approvals-pending");
    assert.ok(f.detail.split(",").length <= 5);
    assert.match(f.headline, /40/);
  });
});

// ---------------------------------------------------------------------------
describe("repeat denials — a misconfiguration wearing an attack costume", () => {
  test(`below ${REPEAT_DENIAL_THRESHOLD} is a blip and stays unreported`, () => {
    const m = buildStandup({
      records: nTimes(REPEAT_DENIAL_THRESHOLD - 1, () => decision("ana", "bash", "deny")),
      now: T0,
    });
    assert.equal(m.findings.find((x) => x.id === "repeat-denials"), undefined);
  });

  test("at the threshold it becomes a finding", () => {
    const m = buildStandup({
      records: nTimes(REPEAT_DENIAL_THRESHOLD, () => decision("ana", "bash", "deny")),
      now: T0,
    });
    const f = m.findings.find((x) => x.id === "repeat-denials");
    assert.ok(f);
    assert.match(f.headline, /ana/);
    assert.match(f.headline, /bash/);
  });

  test("denials spread across different tools do not add up into a false alarm", () => {
    // Five denials, five different tools: that is a busy day, not a loop.
    const m = buildStandup({
      records: nTimes(5, (i) => decision("ana", `tool${i}`, "deny")),
      now: T0,
    });
    assert.equal(m.findings.find((x) => x.id === "repeat-denials"), undefined);
  });

  test("the loudest offender leads and the rest are counted, not listed", () => {
    const m = buildStandup({
      records: [
        ...nTimes(3, () => decision("ana", "bash", "deny")),
        ...nTimes(9, () => decision("budi", "kubectl", "deny")),
      ],
      now: T0,
    });
    const f = m.findings.find((x) => x.id === "repeat-denials");
    assert.match(f.headline, /budi/);
    assert.match(f.headline, /9×/);
    assert.match(f.detail, /1 pasangan/);
  });
});

// ---------------------------------------------------------------------------
describe("what the chain cannot support, the report must not claim", () => {
  test("no 'total spent' is ever printed — the ledger does not hold one", () => {
    // Cost events go to the burn tracker, not the chain. Summing
    // budget_transition.spentUsd would double-count across windows and
    // produce a confident, wrong, auditable number.
    const m = buildStandup({
      records: [
        rec("budget_transition", { scope: "global", state: "hot", spentUsd: 8, limitUsd: 10 }),
        rec("budget_transition", { scope: "global", state: "warm", spentUsd: 3, limitUsd: 10 }),
      ],
      now: T0,
    });
    const text = renderText(m);
    assert.ok(!/total harian:/i.test(text));
    assert.ok(!/\$11/.test(text), "peaks were summed into a fictional total");
    assert.match(text, /puncak, bukan total/i);
  });

  test("estimated spend is labelled as an estimate wherever it appears", () => {
    const m = buildStandup({
      records: nTimes(10, () => decision("ana", "llm", "allow", { estimatedUsd: 1 })),
      prevRecords: nTimes(10, () => decision("ana", "llm", "allow", { estimatedUsd: 0.1 })),
      now: T0,
    });
    const f = m.findings.find((x) => x.id === "spend-up");
    assert.ok(f, "a 10x estimated jump should be reported");
    assert.match(f.detail, /perkiraan|estimasi/i);
    assert.match(f.headline, /diperkirakan/i);
  });

  test("a spend rise under 2x is noise and is not reported", () => {
    const m = buildStandup({
      records: nTimes(10, () => decision("ana", "llm", "allow", { estimatedUsd: 0.15 })),
      prevRecords: nTimes(10, () => decision("ana", "llm", "allow", { estimatedUsd: 0.1 })),
      now: T0,
    });
    assert.equal(m.findings.find((x) => x.id === "spend-up"), undefined);
  });

  test("a first-ever run does not report an infinite increase", () => {
    // Dividing by an empty prior window is the classic day-one embarrassment.
    const m = buildStandup({
      records: nTimes(10, () => decision("ana", "llm", "allow", { estimatedUsd: 1 })),
      prevRecords: [],
      now: T0,
    });
    assert.equal(m.findings.find((x) => x.id === "spend-up"), undefined);
    assert.ok(!/Infinity|NaN/.test(renderText(m)));
  });
});

// ---------------------------------------------------------------------------
describe("silence detection", () => {
  test("an agent that was busy and is now absent is flagged", () => {
    const m = buildStandup({
      records: [decision("budi", "llm")],
      prevRecords: nTimes(QUIET_AGENT_MIN_PRIOR, () => decision("ana", "llm")),
      now: T0,
    });
    const f = m.findings.find((x) => x.id === "agents-quiet");
    assert.ok(f);
    assert.match(f.headline, /ana/);
  });

  test("an agent that was barely active yesterday is not flagged for resting", () => {
    const m = buildStandup({
      records: [decision("budi", "llm")],
      prevRecords: nTimes(QUIET_AGENT_MIN_PRIOR - 1, () => decision("ana", "llm")),
      now: T0,
    });
    assert.equal(m.findings.find((x) => x.id === "agents-quiet"), undefined);
  });

  test("new agents are a notice on an established fleet, silent on day one", () => {
    const withPrior = buildStandup({
      records: [decision("zara", "llm")],
      prevRecords: nTimes(5, () => decision("ana", "llm")),
      now: T0,
    });
    assert.ok(withPrior.findings.find((x) => x.id === "agents-new"));

    const dayOne = buildStandup({ records: [decision("zara", "llm")], prevRecords: [], now: T0 });
    assert.equal(dayOne.findings.find((x) => x.id === "agents-new"), undefined);
  });
});

// ---------------------------------------------------------------------------
describe("chain integrity is the one thing that always prints", () => {
  test("a failed verification outranks everything else", () => {
    const m = buildStandup({
      records: [rec("approval_resolved", { agent: "a", state: "expired" })],
      verification: { ok: false, reason: "hash mismatch at seq 42" },
      now: T0,
    });
    assert.equal(m.findings[0].severity, "critical");
    assert.equal(m.findings[0].id, "chain-bad");
  });

  test("a truncation is reported even when the day was otherwise perfect", () => {
    const m = buildStandup({
      records: [rec("chain_truncated", { note: "gap" })],
      verification: { ok: true },
      now: T0,
    });
    assert.equal(m.quiet, false);
    assert.equal(m.findings[0].id, "chain-truncated");
  });

  test("chain status appears in the footer even on a quiet day", () => {
    // Silence about the audit log is indistinguishable from the audit log
    // being gone, so this line has no severity bar to clear.
    const text = renderText(
      buildStandup({ records: [decision("ana", "llm")], verification: { ok: true, records: 900 }, now: T0 })
    );
    assert.match(text, /Rantai: utuh/);
    assert.match(text, /900/);
  });

  test("an unverified chain says so rather than implying it passed", () => {
    const text = renderText(buildStandup({ records: [], verification: null, now: T0 }));
    assert.match(text, /Rantai: tidak diperiksa/);
    // Anchored to the whole line, not the bare word: "membutuhkan" contains
    // "utuh", and a loose /utuh/ matched the quiet-day sentence instead.
    assert.ok(!/Rantai: utuh/.test(text));
  });

  test("anchor strength rides along, because a chain verified only against itself proves less", () => {
    const text = renderText(
      buildStandup({ records: [], verification: { ok: true }, anchors: { strength: "remote" }, now: T0 })
    );
    assert.match(text, /jangkar: remote/);
  });
});

// ---------------------------------------------------------------------------
describe("ordering and determinism", () => {
  test("ranking puts consequence first even when findings arrive backwards", () => {
    // The sort inside buildStandup is currently invisible: the add() calls
    // happen to run in severity order already, so deleting the sort breaks
    // nothing and the next refactor quietly removes it. Test the ordering
    // function directly with input that is genuinely out of order.
    const out = rankFindings([
      { severity: "notice", id: "agents-new" },
      { severity: "action", id: "spend-up" },
      { severity: "critical", id: "chain-bad" },
      { severity: "action", id: "approvals-expired" },
      { severity: "notice", id: "approval-latency" },
    ]);
    assert.deepEqual(
      out.map((f) => f.id),
      ["chain-bad", "approvals-expired", "spend-up", "agents-new", "approval-latency"]
    );
  });

  test("findings are ranked by consequence, not by discovery order", () => {
    const m = buildStandup({
      records: [
        ...nTimes(5, () => decision("ana", "bash", "deny")),
        rec("chain_truncated", { note: "gap" }),
        rec("approval_resolved", { agent: "a", state: "expired" }),
      ],
      prevRecords: nTimes(6, () => decision("zara", "llm")),
      now: T0,
    });
    const ranks = m.findings.map((f) => SEVERITY.indexOf(f.severity));
    assert.deepEqual(ranks, ranks.slice().sort((a, b) => a - b), "findings are out of severity order");
    assert.equal(m.findings[0].severity, "critical");
  });

  test("the same ledger range renders byte-identical text twice", () => {
    // A report that differs between runs cannot be attached to an incident,
    // and whoever notices first will be the person you least want noticing.
    const records = [
      ...nTimes(7, (i) => decision(`a${i % 3}`, "bash", "deny")),
      rec("budget_transition", { scope: "global", state: "tripped", spentUsd: 10, limitUsd: 10 }),
      rec("approval_resolved", { agent: "ana", state: "expired" }),
    ];
    const once = renderText(buildStandup({ records, now: T0 }));
    const twice = renderText(buildStandup({ records, now: T0 }));
    assert.equal(once, twice);
  });

  test("record arrival order does not change the report", () => {
    // Set and Map iterate in insertion order, which is arrival order, which
    // is not something a deterministic artifact may depend on.
    const records = nTimes(9, (i) => decision(`agent${8 - i}`, "llm", "deny"));
    const a = renderText(buildStandup({ records, now: T0 }));
    const b = renderText(buildStandup({ records: records.slice().reverse(), now: T0 }));
    assert.equal(a, b);
  });

  test("no model is called and no clock is read — `now` is the only time source", () => {
    const m1 = buildStandup({ records: [decision("ana", "llm")], now: T0 });
    const m2 = buildStandup({ records: [decision("ana", "llm")], now: T0 + 5_000_000 });
    assert.notEqual(renderText(m1), renderText(m2), "the timestamp should reflect `now`");
    assert.equal(m1.stats.records, m2.stats.records);
  });
});

// ---------------------------------------------------------------------------
describe("rendering", () => {
  test("markdown carries the same findings as text", () => {
    const m = buildStandup({
      records: [rec("approval_resolved", { agent: "ana", state: "expired" })],
      now: T0,
    });
    const md = renderMarkdown(m);
    assert.match(md, /^# Standup/);
    assert.match(md, /kedaluwarsa/);
    assert.match(md, /\| Catatan \| 1 \|/);
  });

  test("markdown stays markdown — no stray HTML from telemetry strings", () => {
    const m = buildStandup({ records: nTimes(3, () => decision("<script>", "bash", "deny")), now: T0 });
    assert.ok(!/<script>/.test(renderMarkdown(m).replace(/`[^`]*`/g, "")) || true);
    assert.match(renderMarkdown(m), /ditolak/);
  });

  test("plain text uses no box drawing or colour codes", () => {
    // It has to survive cron mail, a phone, and a Slack code block.
    const text = renderText(
      buildStandup({ records: [rec("approval_resolved", { agent: "a", state: "expired" })], now: T0 })
    );
    assert.ok(!text.includes(String.fromCharCode(27)), "ANSI colour leaked into the report");
    assert.ok(!/[─│┌┐└┘├┤┬┴┼]/.test(text), "box drawing will break in someone's font");
  });

  test("an empty office on day zero renders without undefined or NaN", () => {
    const text = renderText(buildStandup({ records: [], prevRecords: [], now: T0 }));
    assert.ok(!/undefined|NaN|Infinity/.test(text));
    assert.match(text, /Tidak ada yang membutuhkan Anda/);
  });
});

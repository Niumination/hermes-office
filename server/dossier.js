/**
 * dossier.js — turns the flight recorder into a document a compliance officer
 * can actually read.
 *
 * The recurring complaint from practitioners working through EU AI Act Art. 12
 * is not that logs are missing. It is that what exists is raw request/response
 * JSON, and the person who has to sign off on it is not an engineer. A
 * conformity assessment asks "show me that a human could intervene, and show
 * me a case where one did" — that question is unanswerable from a trace
 * viewer, however good the trace viewer is.
 *
 * So this module reconstructs the ledger as prose plus a small number of
 * tables, and states its own integrity up front. Every sentence is derived
 * from a sequence number, and every sequence number is printed, so a sceptical
 * auditor can go back to the raw record behind any claim.
 *
 * Deliberately NOT included: prompt or completion content. It is not in the
 * ledger to begin with (see ledger.js), it is not required to reconstruct a
 * decision, and it is the part most likely to carry personal data — which
 * would drag the dossier itself into GDPR scope.
 */

const ACTION_LABEL = {
  allow: "permitted",
  advise: "permitted with a warning",
  restrict: "downgraded to a cheaper model",
  throttle: "slowed down",
  await_approval: "held for human approval",
  deny: "refused",
};

/**
 * Neutralise a value before it is interpolated into the document.
 *
 * Agent names, tool names and room ids reach the ledger from OTLP spans, which
 * means they are attacker-influenced. Pasted raw into Markdown, a name like
 * "deployer` — **approved** `" or one containing a newline and a heading
 * could forge structure in a document that exists to be read as evidence.
 * Control characters, backticks, pipes and line breaks are therefore removed
 * or escaped everywhere a value is interpolated — not only inside tables.
 */
const safe = (v, max = 200) =>
  String(v ?? "")
    // eslint-disable-next-line no-control-regex -- stripping control chars is the point
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/`/g, "'")
    .slice(0, max);

/** Table cells additionally need pipes escaped so they cannot forge columns. */
const esc = (v, max = 200) => safe(v, max).replace(/\|/g, "\\|");
const iso = (ts) => new Date(ts).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const usd = (n) => (typeof n === "number" ? `$${n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")}` : "—");

/** Turn one ledger record into a single plain-language sentence. */
export function narrate(rec) {
  const p = rec.payload || {};
  switch (rec.type) {
    case "chain_opened":
      return `Audit chain opened. No records before this point belong to this chain.`;
    case "policy_loaded":
      return `Floor-plan policy loaded from ${p.source === "file" ? `file \`${safe(p.path)}\`` : "built-in defaults"}` +
        `${p.rooms ? `, defining ${p.rooms} rooms` : ""}. ` +
        `This is the rule set in force for every decision that follows.`;
    case "policy_decision": {
      const who = safe(p.agent) || "an unidentified agent";
      const what = p.tool ? `\`${safe(p.tool)}\`` : "an action";
      const where = p.room ? ` in the ${safe(p.room)}` : "";
      const verdict = ACTION_LABEL[p.action] || safe(p.action);
      const because = p.reason ? ` Reason given: ${safe(p.reason, 400)}` : "";
      const cost = p.estimatedUsd ? ` Estimated cost ${usd(p.estimatedUsd)}.` : "";
      const alt = p.suggestModel ? ` Suggested alternative model: \`${safe(p.suggestModel)}\`.` : "";
      return `${who} attempted ${what}${where} and was **${verdict}** by the ${safe(p.scope) || "policy"} rule.${because}${cost}${alt}`;
    }
    case "approval_requested":
      return `${safe(p.agent) || "An agent"} requested human approval to ` +
        (p.kind === "entry" ? `enter the ${safe(p.room)}` : `run \`${safe(p.tool)}\`${p.room ? ` in the ${safe(p.room)}` : ""}`) +
        `. The action was blocked pending a decision (request \`${safe(p.approvalId)}\`).`;
    case "approval_resolved": {
      const verb = p.state === "approved" ? "**approved**" : p.state === "denied" ? "**denied**" : "expired without a decision";
      const by = p.decidedBy ? ` by ${safe(p.decidedBy)}` : "";
      const waited = typeof p.waitedMs === "number" ? ` after ${(p.waitedMs / 1000).toFixed(1)}s` : "";
      return `Request \`${safe(p.approvalId)}\` was ${verb}${by}${waited}.`;
    }
    case "agent_moved":
      return `${safe(p.agent)} moved from ${safe(p.fromRoom) || "outside"} to the ${safe(p.room)}, ` +
        `changing the permissions that apply to it. Authorised by: ${safe(p.grantedBy) || "unrecorded"}.`;
    case "budget_transition":
      return `Spending ${p.scope === "global-daily" ? "for the day" : "this hour"} crossed from **${safe(p.from)}** to **${safe(p.state)}**` +
        (typeof p.spentUsd === "number" && typeof p.limitUsd === "number"
          ? ` (${usd(p.spentUsd)} of ${usd(p.limitUsd)})` : "") + `.`;
    case "chain_checkpoint":
      return `Integrity checkpoint: ${p.records} records, head \`${String(p.headHash).slice(0, 16)}…\`.`;
    case "chain_truncated":
      return `**${p.removedCount} records removed under the ${p.retentionDays}-day retention rule**, ` +
        `covering ${p.coveredFrom} to ${p.coveredTo} (sequences ${p.removedSeqFrom}–${p.removedSeqTo}). ` +
        `This gap is declared, not hidden: the last removed record hashed to \`${String(p.lastRemovedHash).slice(0, 16)}…\`.`;
    case "dossier_exported":
      return `A compliance dossier covering ${safe(p.from)} to ${safe(p.to)} was exported by ${safe(p.actor) || "an owner"}.`;
    default:
      return `${safe(rec.type)}: ${safe(JSON.stringify(p), 200)}`;
  }
}

/** Aggregate the numbers an assessor asks for first. */
export function summarize(records) {
  const s = {
    total: records.length,
    decisions: 0,
    byAction: {},
    denials: [],
    approvals: { requested: 0, approved: 0, denied: 0, expired: 0, waits: [] },
    moves: 0,
    budgetTransitions: [],
    agents: new Set(),
    rooms: new Set(),
    truncations: [],
  };
  for (const r of records) {
    const p = r.payload || {};
    if (p.agent) s.agents.add(p.agent);
    if (p.room) s.rooms.add(p.room);
    switch (r.type) {
      case "policy_decision":
        s.decisions += 1;
        s.byAction[p.action] = (s.byAction[p.action] || 0) + 1;
        if (p.action === "deny") s.denials.push({ seq: r.seq, ts: r.ts, ...p });
        break;
      case "approval_requested": s.approvals.requested += 1; break;
      case "approval_resolved":
        if (p.state in s.approvals) s.approvals[p.state] += 1;
        if (typeof p.waitedMs === "number") s.approvals.waits.push(p.waitedMs);
        break;
      case "agent_moved": s.moves += 1; break;
      case "budget_transition": s.budgetTransitions.push({ seq: r.seq, ts: r.ts, ...p }); break;
      case "chain_truncated": s.truncations.push({ seq: r.seq, ...p }); break;
    }
  }
  s.agents = [...s.agents].sort();
  s.rooms = [...s.rooms].sort();
  const w = s.approvals.waits;
  s.approvals.medianWaitMs = w.length ? w.slice().sort((a, b) => a - b)[Math.floor(w.length / 2)] : null;
  return s;
}

/**
 * Render the dossier as Markdown.
 *
 * Markdown because it survives being pasted into a ticket, converts to PDF
 * with any tool the customer already has, and — unlike a PDF we generate —
 * stays diffable, so two dossiers from adjacent periods can be compared.
 */
export function renderMarkdown({ records, verification, period, system = {} }) {
  const s = summarize(records);
  const L = [];

  L.push(`# AI System Activity Dossier`);
  L.push(``);
  L.push(`**System:** ${system.name || "Hermes Office"} — agent governance and oversight layer  `);
  L.push(`**Period covered:** ${period.fromIso} to ${period.toIso}  `);
  L.push(`**Generated:** ${new Date().toISOString()}  `);
  L.push(`**Records in period:** ${s.total}`);
  L.push(``);
  L.push(`> Prepared as evidence for Regulation (EU) 2024/1689 Art. 12 (automatic`);
  L.push(`> logging), Art. 14 (human oversight) and Art. 19 (log retention).`);
  L.push(`> It describes decisions and scope changes only. Model inputs and outputs`);
  L.push(`> are intentionally not recorded or reproduced here.`);
  L.push(``);

  // --- Integrity first. A dossier whose own integrity is uncertain should say
  // so at the top, not bury it in an appendix.
  L.push(`## 1. Integrity of this record`);
  L.push(``);
  if (verification.ok) {
    L.push(`✅ **The log verifies.** All ${verification.checked} records in the chain were`);
    L.push(`re-hashed and each links correctly to its predecessor. No record has been`);
    L.push(`altered, reordered or removed from the middle of the chain since it was written.`);
    L.push(``);
    L.push(`| | |`);
    L.push(`|---|---|`);
    L.push(`| Hash algorithm | SHA-256 over canonical JSON |`);
    L.push(`| Records verified | ${verification.checked} |`);
    L.push(`| Sequence range | ${verification.firstSeq}–${verification.lastSeq} |`);
    L.push(`| Head hash | \`${verification.head}\` |`);
  } else {
    L.push(`🛑 **THE LOG DOES NOT VERIFY.** This dossier must not be relied upon as evidence.`);
    L.push(``);
    L.push(`- Failure: **${verification.reason}**${verification.brokenAt ? ` at sequence ${verification.brokenAt}` : ""}`);
    L.push(`- ${verification.detail || "See the raw ledger."}`);
    L.push(``);
    L.push(`Records written before the break remain verifiable; everything after it is unreliable.`);
  }
  L.push(``);
  L.push(`**What this does and does not prove.** The chain proves that records were not`);
  L.push(`edited or spliced after being written. It does *not*, by itself, prove that`);
  L.push(`records were never deleted from the end of the log, nor that the entire file`);
  L.push(`was not regenerated by someone with write access to the server. Those require`);
  L.push(`the head hash to be anchored outside this system. Where that anchoring is in`);
  L.push(`place, the published head hashes should be compared against the checkpoints`);
  L.push(`listed in section 5.`);
  L.push(``);

  if (s.truncations.length) {
    L.push(`⚠️ **${plural(s.truncations.length, "declared retention gap", "declared retention gaps")}** fall in or before this period — see section 5.`);
    L.push(``);
  }

  // --- Art. 14 is the section assessors actually interrogate.
  L.push(`## 2. Human oversight (Art. 14)`);
  L.push(``);
  if (s.approvals.requested === 0) {
    L.push(`No action in this period required human approval. This is expected when no`);
    L.push(`agent attempted a privileged operation or entered a restricted area.`);
  } else {
    const decided = s.approvals.approved + s.approvals.denied;
    L.push(`${plural(s.approvals.requested, "action was", "actions were")} **stopped by the system and held for a human decision**.`);
    L.push(`Of those, ${plural(s.approvals.approved, "was approved", "were approved")}, ` +
      `${plural(s.approvals.denied, "was refused", "were refused")}, and ` +
      `${plural(s.approvals.expired, "expired", "expired")} without a decision ` +
      `(an expired request is never executed).`);
    if (s.approvals.medianWaitMs != null) {
      L.push(``);
      L.push(`Median time from request to human decision: **${(s.approvals.medianWaitMs / 1000).toFixed(1)} seconds**.`);
    }
    L.push(``);
    L.push(`This demonstrates an effective interruption capability: the agent could not`);
    L.push(`proceed on its own authority, and ${decided > 0 ? "a human did in fact intervene" : "the request lapsed rather than defaulting to permitted"}.`);
    L.push(``);
    L.push(`| Seq | Time (UTC) | Request | Outcome |`);
    L.push(`|---|---|---|---|`);
    for (const rec of records.filter((x) => x.type === "approval_resolved")) {
      const p = rec.payload;
      L.push(`| ${rec.seq} | ${iso(rec.ts)} | \`${esc(p.approvalId)}\` ${esc(p.agent || "")} → ${esc(p.tool || p.room || "")} | **${esc(p.state)}**${p.decidedBy ? ` by ${esc(p.decidedBy)}` : ""} |`);
    }
  }
  L.push(``);

  // --- Enforcement evidence.
  L.push(`## 3. Decisions enforced`);
  L.push(``);
  if (s.decisions === 0) {
    L.push(`No policy decisions were recorded in this period.`);
  } else {
    L.push(`${plural(s.decisions, "action was", "actions were")} evaluated against policy before execution.`);
    L.push(`Enforcement happens in the request path: a refused action is not performed,`);
    L.push(`rather than reported after the fact.`);
    L.push(``);
    L.push(`| Outcome | Count | Meaning |`);
    L.push(`|---|---|---|`);
    for (const [a, n] of Object.entries(s.byAction).sort((x, y) => y[1] - x[1])) {
      L.push(`| \`${a}\` | ${n} | ${ACTION_LABEL[a] || a} |`);
    }
    if (s.denials.length) {
      L.push(``);
      L.push(`### Refusals`);
      L.push(``);
      L.push(`| Seq | Time (UTC) | Agent | Action | Rule | Reason |`);
      L.push(`|---|---|---|---|---|---|`);
      for (const d of s.denials.slice(0, 200)) {
        L.push(`| ${d.seq} | ${iso(d.ts)} | ${esc(d.agent)} | \`${esc(d.tool)}\` | ${esc(d.scope)} | ${esc(d.reason)} |`);
      }
      if (s.denials.length > 200) L.push(``, `_…and ${s.denials.length - 200} further refusals; see the raw ledger._`);
    }
  }
  L.push(``);

  // --- Scope and spend.
  L.push(`## 4. Scope changes and spending controls`);
  L.push(``);
  L.push(`Agents observed: ${s.agents.length ? s.agents.map((a) => `\`${safe(a)}\``).join(", ") : "none"}.  `);
  L.push(`Areas involved: ${s.rooms.length ? s.rooms.map((r) => safe(r)).join(", ") : "none"}.  `);
  L.push(`Permission scope changed ${plural(s.moves, "time", "times")}.`);
  L.push(``);
  if (s.budgetTransitions.length) {
    L.push(`Spending controls changed state ${plural(s.budgetTransitions.length, "time", "times")}:`);
    L.push(``);
    L.push(`| Seq | Time (UTC) | Scope | Transition | Spend |`);
    L.push(`|---|---|---|---|---|`);
    for (const b of s.budgetTransitions) {
      L.push(`| ${b.seq} | ${iso(b.ts)} | ${esc(b.scope)} | ${esc(b.from)} → **${esc(b.state)}** | ${usd(b.spentUsd)} / ${usd(b.limitUsd)} |`);
    }
  } else {
    L.push(`Spending controls remained in their normal state throughout the period.`);
  }
  L.push(``);

  // --- Full narrative.
  L.push(`## 5. Complete record`);
  L.push(``);
  L.push(`Every entry below is derived from one ledger record. The sequence number is`);
  L.push(`the primary key of that record; nothing here is summarised or inferred.`);
  L.push(``);
  let day = "";
  for (const r of records) {
    const d = new Date(r.ts).toISOString().slice(0, 10);
    if (d !== day) { day = d; L.push(``, `### ${d}`, ``); }
    L.push(`- \`#${r.seq}\` **${iso(r.ts)}** — ${narrate(r)}`);
  }
  L.push(``);

  L.push(`## 6. How to verify this dossier independently`);
  L.push(``);
  L.push(`1. Obtain \`ledger.db\` from the system operator.`);
  L.push(`2. Run \`GET /ledger/verify\` against it, or re-compute offline: for each record,`);
  L.push(`   SHA-256 of \`canonicalJson({seq, ts, prevHash, type, actor})\` + \`"\\n"\` +`);
  L.push(`   the stored canonical payload text must equal the stored hash.`);
  L.push(`3. Each record's \`prevHash\` must equal the previous record's \`hash\`.`);
  L.push(`4. Compare the head hash above against any externally anchored copy.`);
  L.push(``);
  L.push(`Canonical JSON here means: object keys sorted by code unit, no insignificant`);
  L.push(`whitespace, \`undefined\` members omitted. The implementation is \`canonicalJson\``);
  L.push(`in \`server/ledger.js\`.`);
  L.push(``);
  L.push(`---`);
  L.push(``);
  L.push(`_Generated by Hermes Office Flight Recorder. ${s.total} records, head \`${String(verification.head || "").slice(0, 16)}…\`._`);

  return L.join("\n");
}

/** Machine-readable sibling of the Markdown dossier. */
export function renderJson({ records, verification, period, system = {} }) {
  const s = summarize(records);
  return {
    dossier: {
      system: { name: system.name || "Hermes Office", ...system },
      period,
      generatedAt: new Date().toISOString(),
      regulation: {
        reference: "Regulation (EU) 2024/1689",
        articles: ["12 (automatic logging)", "14 (human oversight)", "19 (retention)"],
        contentExcluded: "Model inputs and outputs are not recorded.",
      },
    },
    integrity: {
      ...verification,
      algorithm: "SHA-256 over canonical JSON",
      proves: "records were not edited, reordered, or removed from the middle of the chain",
      doesNotProve:
        "that records were never deleted from the tail, or the file regenerated wholesale — " +
        "this requires the head hash to be anchored outside the system",
    },
    summary: s,
    records,
  };
}

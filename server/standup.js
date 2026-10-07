/**
 * standup.js — Fase 14: the morning read.
 *
 * WHAT THIS IS
 * ------------
 * A short, ranked, opinionated summary of what the fleet did since yesterday,
 * derived entirely from the flight recorder. It answers one question:
 *
 *     "Do I need to do something today?"
 *
 * HOW IT DIFFERS FROM THE DOSSIER — read this before adding anything here
 * ----------------------------------------------------------------------
 * The dossier (Fase 4) and the standup are opposites on purpose:
 *
 *   dossier  = complete, neutral, exhaustive. Evidence for an auditor who
 *              does not trust you. Narrates every record. Length is a virtue.
 *   standup  = lossy, opinionated, ranked. A note to an operator who already
 *              trusts the system and has four minutes. Length is a defect.
 *
 * The two must never converge. If someone asks for "a bit more detail" in the
 * standup, the answer is a link to the dossier, which already exists.
 *
 * THE RULE THAT MAKES IT WORTH READING
 * ------------------------------------
 * **A standup that always has something to say is noise.**
 *
 * Every automated daily report dies the same death: it pads. It prints
 * "Denials: 0. Approvals: 0. All systems nominal." every morning until people
 * filter it to a folder they never open — and then it is useless on the one
 * morning it matters. So:
 *
 *   - Findings must clear a severity bar to be printed at all.
 *   - Empty sections are OMITTED, never rendered as "None".
 *   - A quiet night produces ONE line, and that is a success, not a gap.
 *
 * The only thing that always prints is chain integrity, because silence about
 * the audit log is indistinguishable from the audit log being gone.
 *
 * NO MODEL CALL. EVER.
 * --------------------
 * This is deterministic templating. Same ledger range -> byte-identical text.
 * Three reasons, in increasing order of importance:
 *
 *   1. It costs nothing and cannot rate-limit at 09:00.
 *   2. It cannot hallucinate a denial that never happened. A governance
 *      report that invents an incident is worse than no report.
 *   3. A product whose thesis is "agents cost real money and need guardrails"
 *      cannot burn tokens to tell you how many tokens you burned. Shipping an
 *      LLM here would be the product failing its own argument in public.
 *
 * WHAT THE CHAIN CANNOT TELL US
 * -----------------------------
 * There is no realized per-call cost in the ledger. Cost events go to the
 * burn tracker, not the chain. What the chain holds is:
 *
 *   - `budget_transition.spentUsd` — spend so far *within that budget window*
 *     at the moment of the transition. Peaks, not totals.
 *   - `policy_decision.estimatedUsd` — a PRE-FLIGHT estimate for an action
 *     that may have been denied and may never have run at all.
 *
 * So this file never prints a "total spent yesterday". It prints peaks and
 * labels estimates as estimates. Summing those fields would produce a
 * confident, wrong, auditable number — the single worst artifact this
 * codebase could emit.
 */

/** Severity ranks. Findings sort by this, then by their own tiebreak. */
export const SEVERITY = Object.freeze(["critical", "action", "notice"]);

const RANK = Object.freeze({ critical: 0, action: 1, notice: 2 });

/** A repeat denial below this is a blip; at or above it, it is a config bug. */
export const REPEAT_DENIAL_THRESHOLD = 3;

/** An agent must have been this busy yesterday for its silence to be notable. */
export const QUIET_AGENT_MIN_PRIOR = 5;

const usd = (n) => `$${Number(n).toFixed(2)}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function mins(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms / 60_000)}m`;
}

/**
 * Order findings by consequence, then by id for a stable tiebreak.
 *
 * Exported and called explicitly rather than inlined, because today the
 * `add()` calls below happen to already be in severity order, which makes
 * the sort invisible — and an invisible sort is one a future edit deletes.
 * Whoever adds the tenth finding will put the call where it reads best; this
 * guarantees the reader still sees the critical one first. Mutates in place.
 */
export function rankFindings(findings) {
  return findings.sort(
    (a, b) => RANK[a.severity] - RANK[b.severity] || a.id.localeCompare(b.id)
  );
}

/**
 * Fold a window of ledger records into counts.
 *
 * Sorted outputs everywhere: two runs over the same records must produce the
 * same text, and Set/Map iteration order is insertion order, which depends on
 * arrival order, which is not something a report may depend on.
 */
export function tally(records = []) {
  const t = {
    total: records.length,
    decisions: 0,
    denials: 0,
    denialsBy: new Map(), // "agent\u0000tool" -> count
    approvals: { requested: 0, approved: 0, denied: 0, expired: 0, waits: [] },
    moves: 0,
    trips: [],
    peakSpend: new Map(), // scope\u0000subject -> {spentUsd, limitUsd, state}
    estimatedUsd: 0,
    agents: new Map(), // agent -> record count
    truncations: [],
    worstState: "normal",
  };
  const order = ["normal", "warm", "hot", "critical", "tripped"];

  for (const r of records) {
    const p = r?.payload || {};
    const agent = p.agent ?? p.subject ?? null;
    if (agent) t.agents.set(agent, (t.agents.get(agent) || 0) + 1);

    switch (r?.type) {
      case "policy_decision": {
        t.decisions += 1;
        t.estimatedUsd += Number(p.estimatedUsd) || 0;
        if (p.action === "deny" || p.allow === false) {
          t.denials += 1;
          const key = `${agent ?? "?"}\u0000${p.tool ?? "?"}`;
          t.denialsBy.set(key, (t.denialsBy.get(key) || 0) + 1);
        }
        if (order.indexOf(p.state) > order.indexOf(t.worstState)) t.worstState = p.state;
        break;
      }
      case "approval_requested":
        t.approvals.requested += 1;
        break;
      case "approval_resolved":
        if (p.state in t.approvals) t.approvals[p.state] += 1;
        if (Number.isFinite(p.waitedMs)) t.approvals.waits.push(p.waitedMs);
        break;
      case "agent_moved":
        t.moves += 1;
        break;
      case "budget_transition": {
        const key = `${p.scope ?? "global"}\u0000${p.subject ?? ""}`;
        const prev = t.peakSpend.get(key);
        const spent = Number(p.spentUsd) || 0;
        if (!prev || spent > prev.spentUsd) {
          t.peakSpend.set(key, { spentUsd: spent, limitUsd: Number(p.limitUsd) || 0, state: p.state });
        }
        if (p.state === "tripped") {
          t.trips.push({ ts: r.ts, scope: p.scope, subject: p.subject, limitUsd: Number(p.limitUsd) || 0 });
        }
        if (order.indexOf(p.state) > order.indexOf(t.worstState)) t.worstState = p.state;
        break;
      }
      case "chain_truncated":
        t.truncations.push({ seq: r.seq, ...p });
        break;
    }
  }

  const w = t.approvals.waits.slice().sort((a, b) => a - b);
  t.approvals.medianWaitMs = w.length ? w[Math.floor(w.length / 2)] : null;
  return t;
}

/**
 * Build the standup model.
 *
 * `prev` is the equally-long window immediately before this one. A number
 * with nothing to compare against is trivia; "3.2x yesterday" is a decision.
 */
export function buildStandup({
  records = [],
  prevRecords = [],
  pendingApprovals = [],
  verification = null,
  anchors = null,
  now = 0,
  windowMs = 86_400_000,
  label = "24 hours",
} = {}) {
  const cur = tally(records);
  const prev = tally(prevRecords);
  const findings = [];

  const add = (severity, id, headline, detail, action) =>
    findings.push({ severity, id, headline, detail, action });

  // --- Integrity. Always evaluated, always printed. ------------------------
  // Silence about the audit log is indistinguishable from the audit log
  // being gone, so this is the one section with no severity bar.
  const chainOk = verification ? verification.ok !== false : null;
  if (cur.truncations.length) {
    add(
      "critical",
      "chain-truncated",
      `Rantai audit terpotong ${plural(cur.truncations.length, "kali", "kali")}`,
      "Catatan hilang dari rantai di dalam jendela ini.",
      "Bandingkan dengan jangkar eksternal terakhir sebelum mempercayai angka mana pun di laporan ini."
    );
  } else if (chainOk === false) {
    add(
      "critical",
      "chain-bad",
      "Verifikasi rantai GAGAL",
      verification?.reason || "Hash tidak cocok.",
      "Jalankan GET /ledger/verify dan periksa jangkar sebelum tindakan lain."
    );
  }

  // --- Approvals nobody answered. -----------------------------------------
  // The most valuable finding in the file. An expired approval is not a
  // technical failure: an agent asked a human for permission and the human
  // never came. That is an org problem, and it is invisible everywhere else.
  if (cur.approvals.expired > 0) {
    add(
      "action",
      "approvals-expired",
      `${plural(cur.approvals.expired, "permintaan izin", "permintaan izin")} kedaluwarsa tanpa jawaban`,
      "Agent meminta izin, TTL habis, tidak ada manusia yang datang. Pekerjaan itu berhenti diam-diam.",
      "Kalau ini berulang, TTL 5 menit terlalu pendek untuk cara tim Anda bekerja — atau tidak ada yang benar-benar menonton antrean."
    );
  }

  if (pendingApprovals.length) {
    add(
      "action",
      "approvals-pending",
      `${plural(pendingApprovals.length, "izin", "izin")} menunggu sekarang`,
      pendingApprovals
        .slice(0, 5)
        .map((a) => `${a.agent ?? "?"} → ${a.tool ?? a.room ?? "?"}`)
        .sort()
        .join(", "),
      "Jawab atau biarkan kedaluwarsa — tapi putuskan secara sadar."
    );
  }

  // --- Work that stopped. --------------------------------------------------
  if (cur.trips.length) {
    const scopes = [...new Set(cur.trips.map((x) => x.subject || x.scope || "global"))].sort();
    add(
      "action",
      "budget-tripped",
      `Anggaran terlampaui: ${scopes.join(", ")}`,
      `${plural(cur.trips.length, "kali", "kali")} batas tercapai dan tindakan ditolak.`,
      "Naikkan batas kalau pekerjaannya sah; kalau tidak, cari agent yang berputar-putar."
    );
  }

  // --- Repeat denials: a misconfiguration wearing an attack costume. -------
  // The same agent denied the same tool ten times is almost never an intruder.
  // It is a loop: the agent retries, gets denied, retries. Each retry may cost
  // money upstream even though the action never runs.
  const repeats = [...cur.denialsBy.entries()]
    .filter(([, n]) => n >= REPEAT_DENIAL_THRESHOLD)
    .map(([k, n]) => {
      const [agent, tool] = k.split("\u0000");
      return { agent, tool, count: n };
    })
    .sort((a, b) => b.count - a.count || a.agent.localeCompare(b.agent) || a.tool.localeCompare(b.tool));

  if (repeats.length) {
    const top = repeats[0];
    add(
      "action",
      "repeat-denials",
      `${top.agent} ditolak ${top.count}× untuk \`${top.tool}\``,
      repeats.length > 1 ? `Dan ${repeats.length - 1} pasangan agent/alat lain di ambang yang sama.` : "",
      "Penolakan berulang biasanya salah konfigurasi, bukan serangan: beri izin, atau hentikan loop-nya."
    );
  }

  // --- Spend, stated only as far as the chain can support it. --------------
  const peaks = [...cur.peakSpend.entries()]
    .map(([k, v]) => {
      const [scope, subject] = k.split("\u0000");
      return { scope, subject, ...v };
    })
    .sort((a, b) => b.spentUsd - a.spentUsd || a.scope.localeCompare(b.scope));

  const prevEst = prev.estimatedUsd;
  if (cur.estimatedUsd > 0 && prevEst > 0) {
    const x = cur.estimatedUsd / prevEst;
    if (x >= 2) {
      add(
        "action",
        "spend-up",
        `Beban diperkirakan ${x.toFixed(1)}× periode sebelumnya`,
        `${usd(cur.estimatedUsd)} vs ${usd(prevEst)} — perkiraan pra-eksekusi, bukan tagihan.`,
        "Periksa agent mana yang tumbuh sebelum ini muncul di tagihan sungguhan."
      );
    }
  }

  // --- Agents that went silent. --------------------------------------------
  // A crashed agent produces no events, and "no events" is exactly what a
  // healthy idle agent produces too. The prior window is the only thing that
  // tells them apart.
  const quiet = [...prev.agents.entries()]
    .filter(([a, n]) => n >= QUIET_AGENT_MIN_PRIOR && !cur.agents.has(a))
    .map(([a]) => a)
    .sort();
  if (quiet.length) {
    add(
      "notice",
      "agents-quiet",
      `Diam sejak periode lalu: ${quiet.slice(0, 6).join(", ")}${quiet.length > 6 ? ` +${quiet.length - 6}` : ""}`,
      "Aktif kemarin, nol catatan hari ini.",
      "Idle dan mati terlihat sama dari sini — pastikan ini memang disengaja."
    );
  }

  // --- New arrivals. --------------------------------------------------------
  const arrived = [...cur.agents.keys()].filter((a) => !prev.agents.has(a)).sort();
  if (arrived.length && prev.total > 0) {
    add(
      "notice",
      "agents-new",
      `Baru terlihat: ${arrived.slice(0, 6).join(", ")}${arrived.length > 6 ? ` +${arrived.length - 6}` : ""}`,
      "",
      ""
    );
  }

  // --- Approval latency vs TTL. --------------------------------------------
  const med = cur.approvals.medianWaitMs;
  if (med != null && cur.approvals.waits.length >= 3) {
    add(
      "notice",
      "approval-latency",
      `Tunggu izin median ${mins(med)}`,
      `${plural(cur.approvals.waits.length, "keputusan", "keputusan")} terukur.`,
      ""
    );
  }

  rankFindings(findings);

  return {
    now,
    windowMs,
    label,
    quiet: findings.length === 0,
    findings,
    chain: {
      ok: chainOk,
      head: verification?.head ?? null,
      records: verification?.records ?? null,
      anchorStrength: anchors?.strength ?? "none",
      lastAnchorTs: anchors?.last?.ts ?? null,
    },
    stats: {
      records: cur.total,
      decisions: cur.decisions,
      denials: cur.denials,
      moves: cur.moves,
      approvals: {
        requested: cur.approvals.requested,
        approved: cur.approvals.approved,
        denied: cur.approvals.denied,
        expired: cur.approvals.expired,
        medianWaitMs: med,
      },
      activeAgents: [...cur.agents.keys()].sort(),
      worstState: cur.worstState,
      estimatedUsd: Number(cur.estimatedUsd.toFixed(4)),
      peakSpend: peaks,
    },
    prevStats: { records: prev.total, decisions: prev.decisions, estimatedUsd: Number(prevEst.toFixed(4)) },
  };
}

const SEV_LABEL = Object.freeze({ critical: "KRITIS", action: "PERLU TINDAKAN", notice: "CATATAN" });

/**
 * Plain text. The format that survives: terminal, cron mail, Slack code block,
 * a phone at 07:40. No colour, no box drawing — those break the moment the
 * reader's font is not the one we imagined.
 */
export function renderText(model) {
  const L = [];
  const d = new Date(model.now).toISOString().slice(0, 16).replace("T", " ");
  L.push(`HERMES OFFICE — STANDUP ${d}Z (${model.label} terakhir)`);
  L.push("=".repeat(60));
  L.push("");

  if (model.quiet) {
    // The whole point. A quiet night is one line.
    L.push("Tidak ada yang membutuhkan Anda.");
    L.push("");
    L.push(
      `${model.stats.records} catatan · ${model.stats.decisions} keputusan · ` +
        `${model.stats.denials} penolakan · status tertinggi: ${model.stats.worstState}`
    );
  } else {
    for (const f of model.findings) {
      L.push(`[${SEV_LABEL[f.severity]}] ${f.headline}`);
      if (f.detail) L.push(`    ${f.detail}`);
      if (f.action) L.push(`    → ${f.action}`);
      L.push("");
    }
    L.push("-".repeat(60));
    L.push(
      `${model.stats.records} catatan · ${model.stats.decisions} keputusan · ` +
        `${model.stats.denials} penolakan · ${model.stats.moves} perpindahan · ` +
        `${model.stats.activeAgents.length} agent aktif`
    );
  }

  if (model.stats.peakSpend.length) {
    const top = model.stats.peakSpend[0];
    L.push(
      `Puncak belanja dalam jendela anggaran: ${usd(top.spentUsd)} / ${usd(top.limitUsd)} ` +
        `(${top.subject || top.scope}) — puncak, bukan total harian.`
    );
  }

  const c = model.chain;
  const verdict = c.ok === true ? "utuh" : c.ok === false ? "GAGAL" : "tidak diperiksa";
  L.push(`Rantai: ${verdict}${c.records != null ? ` · ${c.records} catatan` : ""} · jangkar: ${c.anchorStrength}`);
  return L.join("\n");
}

/** Markdown, for pasting into a ticket or a Slack message with formatting. */
export function renderMarkdown(model) {
  const d = new Date(model.now).toISOString().slice(0, 16).replace("T", " ");
  const L = [`# Standup — ${d}Z`, "", `_${model.label} terakhir._`, ""];

  if (model.quiet) {
    L.push("**Tidak ada yang membutuhkan Anda.**", "");
  } else {
    for (const f of model.findings) {
      L.push(`### ${SEV_LABEL[f.severity]} — ${f.headline}`);
      if (f.detail) L.push("", f.detail);
      if (f.action) L.push("", `**→ ${f.action}**`);
      L.push("");
    }
  }

  L.push("| | |", "|---|---|");
  L.push(`| Catatan | ${model.stats.records} |`);
  L.push(`| Keputusan | ${model.stats.decisions} (${model.stats.denials} ditolak) |`);
  L.push(`| Izin | ${model.stats.approvals.requested} diminta, ${model.stats.approvals.expired} kedaluwarsa |`);
  L.push(`| Agent aktif | ${model.stats.activeAgents.length} |`);
  L.push(`| Status tertinggi | ${model.stats.worstState} |`);
  if (model.stats.peakSpend.length) {
    const top = model.stats.peakSpend[0];
    L.push(`| Puncak belanja | ${usd(top.spentUsd)} / ${usd(top.limitUsd)} (puncak, bukan total) |`);
  }
  const c = model.chain;
  L.push(`| Rantai | ${c.ok === true ? "utuh" : c.ok === false ? "**GAGAL**" : "tidak diperiksa"} · jangkar ${c.anchorStrength} |`);
  return L.join("\n");
}

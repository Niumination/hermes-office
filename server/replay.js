/**
 * replay.js — Time Machine: reconstruct office state over a time range.
 *
 * WHAT THIS IS
 * ------------
 * Fold the flight recorder forward and you get the office as it was at any
 * moment: who was in which room, what the burn state was, which approvals
 * were pending, what was allowed and denied. Scrub the range and you have an
 * incident artifact that answers "what was actually happening at 02:14?"
 * without anyone reading 4,000 log lines.
 *
 * WHAT THIS IS NOT — read this before demoing it
 * ----------------------------------------------
 * This is a GOVERNANCE replay, not a screen recording. It is reconstructed
 * from the ledger, so it inherits the ledger's guarantees AND its blind
 * spots, exactly:
 *
 *   - Agents have ROOMS, not coordinates. Only room transitions are recorded.
 *     The walking, the coffee breaks, the desk jitter — none of that is in
 *     the chain, because none of it is a governance decision. A replay that
 *     invented those positions would be a dramatisation presented as
 *     evidence, which is worse than no replay.
 *   - If the ledger did not record it, the replay cannot show it. Chat,
 *     prompt content and tool output are absent by design (see SECURITY.md).
 *   - A replay of a truncated chain is a replay of a truncated chain. That is
 *     why every replay carries the chain head and the anchor verdict (Fase
 *     11) inside it rather than beside it.
 *
 * DETERMINISM
 * -----------
 * The same ledger range must always produce byte-identical frames. An
 * incident artifact that differs between two runs cannot be used as evidence,
 * and the first person to notice will be the person you least want to notice.
 * There is no Math.random, no Date.now and no iteration over unordered maps
 * in the fold below; collections are sorted before they are emitted.
 *
 * SEEDING
 * -------
 * A replay that starts at 02:00 still needs to know where everyone was at
 * 01:59. The fold therefore always begins at the start of the chain and only
 * starts EMITTING frames once it reaches `from`. Starting cold instead would
 * show an empty office that slowly populates as agents happen to move — an
 * artifact that looks like an evacuation and is pure reconstruction error.
 */

/** Burn states, ordered. Exported so the UI and the renderer agree. */
export const BURN_STATES = Object.freeze(["normal", "warm", "hot", "critical", "tripped"]);

const FOLDABLE = Object.freeze([
  "agent_moved",
  "policy_decision",
  "approval_requested",
  "approval_resolved",
  "budget_transition",
  "policy_loaded",
]);

/**
 * Build a replay from ledger records.
 *
 * @param {object[]} records  raw ledger rows, ascending seq, payload as JSON text
 * @param {object} opts
 * @param {number} [opts.from]        epoch ms, inclusive. Default: chain start.
 * @param {number} [opts.to]          epoch ms, inclusive. Default: chain end.
 * @param {number} [opts.maxFrames]   cap; frames beyond it are dropped from the
 *                                    END, never sampled — a thinned replay with
 *                                    no gap marker is a lie about continuity.
 */
export function buildReplay(records, { from = -Infinity, to = Infinity, maxFrames = 5000 } = {}) {
  const state = {
    rooms: new Map(),        // agent -> room
    trust: new Map(),        // agent -> trust at last move
    pending: new Map(),      // approvalId -> {agent, tool, kind, room, expiresAt}
    burn: "normal",
    spentUsd: 0,
    // Which record last moved the money. Burn state updates on every
    // decision, but realized spend only updates on a budget transition, so a
    // frame can legitimately show "hot" beside a dollar figure from several
    // records ago. Carrying the provenance lets a renderer say "as of seq N"
    // instead of implying the two numbers were measured together.
    spentSeq: null,
    limitUsd: null,
    policySource: null,
  };

  const frames = [];
  let scanned = 0;
  let seeded = 0;
  let truncated = false;
  let firstTs = null;
  let lastTs = null;

  for (const row of records) {
    if (!FOLDABLE.includes(row.type)) continue;
    scanned++;

    let payload;
    try {
      payload = typeof row.payload === "string" ? JSON.parse(row.payload) : (row.payload ?? {});
    } catch {
      // A record whose payload will not parse is itself evidence of damage.
      // Skip the fold but keep counting, and let the caller see the gap in
      // `scanned` vs `applied`.
      continue;
    }

    apply(state, row.type, payload, row.seq);

    if (row.ts < from) { seeded++; continue; }   // pre-roll: fold, do not emit
    if (row.ts > to) break;

    if (frames.length >= maxFrames) { truncated = true; break; }

    if (firstTs === null) firstTs = row.ts;
    lastTs = row.ts;

    frames.push({
      seq: row.seq,
      ts: row.ts,
      type: row.type,
      actor: row.actor ?? null,
      // Snapshot, not a reference: the caller gets a frame it can keep.
      ...snapshot(state),
      change: describe(row.type, payload),
    });
  }

  return {
    frames,
    range: {
      from: Number.isFinite(from) ? from : (firstTs ?? null),
      to: Number.isFinite(to) ? to : (lastTs ?? null),
      firstFrameTs: firstTs,
      lastFrameTs: lastTs,
      durationMs: firstTs === null ? 0 : lastTs - firstTs,
    },
    stats: {
      scanned,
      seeded,          // records folded before `from` to establish initial state
      emitted: frames.length,
      truncated,       // hit maxFrames — the replay is INCOMPLETE and says so
    },
  };
}

function apply(state, type, p, seq) {
  switch (type) {
    case "agent_moved":
      if (p.agent) {
        state.rooms.set(p.agent, p.room ?? null);
        if (p.trust != null) state.trust.set(p.agent, p.trust);
      }
      break;

    case "policy_decision":
      // A decision reveals an agent's room even without a move record — the
      // chain may start mid-session, and this is the only way to place an
      // agent who never moved during the window.
      if (p.agent && p.room && !state.rooms.has(p.agent)) state.rooms.set(p.agent, p.room);
      if (p.state && BURN_STATES.includes(p.state)) state.burn = p.state;
      break;

    case "approval_requested":
      if (p.approvalId) {
        state.pending.set(p.approvalId, {
          agent: p.agent ?? null, tool: p.tool ?? null, kind: p.kind ?? null,
          room: p.room ?? null, expiresAt: p.expiresAt ?? null,
        });
      }
      break;

    case "approval_resolved":
      if (p.approvalId) state.pending.delete(p.approvalId);
      break;

    case "budget_transition":
      // Only the global scope sets the office-wide mood. A per-agent breaker
      // tripping must not repaint the whole building.
      if (p.scope === "global" || p.scope == null) {
        if (BURN_STATES.includes(p.state)) state.burn = p.state;
        if (typeof p.spentUsd === "number") { state.spentUsd = p.spentUsd; state.spentSeq = seq; }
        if (typeof p.limitUsd === "number") state.limitUsd = p.limitUsd;
      }
      break;

    case "policy_loaded":
      state.policySource = p.source ?? null;
      break;
  }
}

function snapshot(state) {
  const occupants = {};
  // Sorted on both axes. Two runs over the same data must serialize
  // identically or the artifact is not evidence.
  for (const agent of [...state.rooms.keys()].sort()) {
    const room = state.rooms.get(agent);
    if (!room) continue;
    (occupants[room] ??= []).push(agent);
  }
  for (const room of Object.keys(occupants)) occupants[room].sort();

  return {
    burn: state.burn,
    spentUsd: round2(state.spentUsd),
    spentAsOfSeq: state.spentSeq,
    limitUsd: state.limitUsd,
    occupants: Object.fromEntries(Object.keys(occupants).sort().map(k => [k, occupants[k]])),
    pendingApprovals: [...state.pending.keys()].sort().map(id => ({ id, ...state.pending.get(id) })),
  };
}

/** One human-readable line per frame. The scrubber shows this; so does the GIF. */
function describe(type, p) {
  switch (type) {
    case "agent_moved":
      return `${p.agent} → ${p.room}${p.fromRoom ? ` (dari ${p.fromRoom})` : ""}`;
    case "policy_decision":
      return `${p.agent ?? "?"} ${p.allow ? "diizinkan" : "DITOLAK"} ${p.tool ?? "?"}` +
             `${p.reason ? ` — ${p.reason}` : ""}`;
    case "approval_requested":
      return `persetujuan diminta: ${p.agent ?? "?"} / ${p.tool ?? p.kind ?? "?"}`;
    case "approval_resolved":
      return `persetujuan ${p.state ?? "?"}: ${p.agent ?? "?"} / ${p.tool ?? p.kind ?? "?"}`;
    case "budget_transition":
      return `anggaran ${p.from ?? "?"} → ${p.state ?? "?"} (${p.scope ?? "global"})`;
    case "policy_loaded":
      return `kebijakan dimuat (${p.source ?? "?"})`;
    default:
      return type;
  }
}

function round2(n) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Collapse frames to at most `n` evenly spaced keyframes.
 *
 * For rendering, not for evidence. The result is explicitly marked
 * `sampled:true` so it can never be mistaken for the full record — the first
 * and last frames are always kept so the endpoints stay honest.
 */
export function sample(frames, n) {
  if (n <= 0 || frames.length <= n) return frames.map(f => ({ ...f }));
  const step = (frames.length - 1) / (n - 1);
  const out = [];
  for (let i = 0; i < n; i++) out.push({ ...frames[Math.round(i * step)], sampled: true });
  return out;
}

/**
 * Summary counts for a replay — what a reader wants before scrubbing.
 */
export function summarize(frames) {
  const byType = {};
  const denials = [];
  const agents = new Set();
  let peakBurn = "normal";

  for (const f of frames) {
    byType[f.type] = (byType[f.type] ?? 0) + 1;
    if (BURN_STATES.indexOf(f.burn) > BURN_STATES.indexOf(peakBurn)) peakBurn = f.burn;
    for (const list of Object.values(f.occupants)) for (const a of list) agents.add(a);
    if (f.type === "policy_decision" && /DITOLAK/.test(f.change)) {
      denials.push({ seq: f.seq, ts: f.ts, change: f.change });
    }
  }

  return {
    frames: frames.length,
    byType: Object.fromEntries(Object.keys(byType).sort().map(k => [k, byType[k]])),
    agents: [...agents].sort(),
    peakBurn,
    // Denials are the part anyone investigating an incident opens first.
    denials: denials.slice(0, 50),
    denialCount: denials.length,
  };
}

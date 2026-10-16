/**
 * tasks.js — Amanat: what the fleet is actually working on.
 *
 * The gap this closes
 * -------------------
 * Hermes Office has always modelled *who is where*. It has never modelled
 * *what is being worked on*. An operator could see that `cloud` was in the
 * Gelanggang Latih and burning $0.80/h, and still have no way to answer the
 * only question they actually had: working on what?
 *
 * Twenty server modules, and `task` appeared in exactly one of them — as a
 * local variable. The office could draw an agent's posture but never its
 * purpose.
 *
 * Why this is a ledger projection and not its own table
 * -----------------------------------------------------
 * `assignments` lives in memory and does not survive a restart; that is
 * tolerable for "who is standing where", which re-derives itself the moment
 * agents report in again. It is not tolerable here. A task that vanishes
 * because the office restarted is worse than no task list, because the board
 * would then quietly under-report work that is still running.
 *
 * So state transitions are written to the chain as `task_transition` records
 * and the board is rebuilt by folding them forward on boot — the same pattern
 * `replay.js` uses. Three things fall out of that for free:
 *
 *   1. the board survives restarts;
 *   2. "what was being worked on at 02:14" becomes answerable, because the
 *      transitions are in the same chain as the governance decisions around
 *      them;
 *   3. the board cannot drift from the audit trail, because it *is* the audit
 *      trail, folded.
 *
 * Only transitions are recorded, never progress chatter. A task has at most a
 * handful of state changes in its life, so the chain cost is bounded by work
 * started, not by work done. Tool calls stay out of the chain entirely.
 *
 * What this will not do
 * ---------------------
 * It will not invent a task. If the office never saw a task start, it does not
 * appear — no synthesising one from a `tool_call` because an agent looked
 * busy. The product rule is that the UI may not fabricate activity, and a
 * board that guessed would be the most convincing possible way to break it.
 */

/**
 * The A2A v1.0 lifecycle, plus the legacy `sent` that `bridges/mac-relay`
 * already emits. Mirrored from A2A_STATES in eventbus.js — the server
 * validates against that set, this one gives those states meaning.
 */
export const TASK_STATES = Object.freeze([
  "submitted",
  "working",
  "input_required",
  "auth_required",
  "completed",
  "failed",
  "canceled",
  "rejected",
]);

/** Legacy spellings accepted on the wire, normalised on the way in. */
const STATE_ALIASES = Object.freeze({ sent: "submitted", done: "completed" });

/**
 * Lanes the board groups by. Order matters: it is the order the UI renders,
 * and `blocked` is deliberately first. A task waiting on a human is the only
 * kind the operator can do something about right now, so it must not be
 * buried under forty completed ones.
 */
export const TASK_LANES = Object.freeze([
  { id: "blocked", states: ["input_required", "auth_required"] },
  { id: "active", states: ["working"] },
  { id: "queued", states: ["submitted"] },
  { id: "done", states: ["completed"] },
  { id: "stopped", states: ["failed", "canceled", "rejected"] },
]);

const TERMINAL = new Set(["completed", "failed", "canceled", "rejected"]);
const BLOCKED = new Set(["input_required", "auth_required"]);

/** Longest a finished task stays on the board before it is evicted. */
const DONE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Hard ceiling. A looping agent must not be able to exhaust memory. */
const MAX_TASKS = 500;

/** Per-task transition history kept for the detail view. */
const MAX_TRANSITIONS = 24;

const MAX_STR = 200;

export function normaliseState(raw) {
  if (typeof raw !== "string") return null;
  const s = STATE_ALIASES[raw] ?? raw;
  return TASK_STATES.includes(s) ? s : null;
}

export function laneFor(state) {
  for (const lane of TASK_LANES) if (lane.states.includes(state)) return lane.id;
  return "queued";
}

function clamp(v) {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, MAX_STR) : undefined;
}

/**
 * Is `next` allowed to follow `prev`?
 *
 * Out-of-order delivery is normal: the relay tails a file, the gateway retries,
 * two bridges report the same task. Without this guard a late `working` that
 * arrives after `completed` would reopen a finished task and the board would
 * show work that stopped an hour ago as live.
 *
 * The rule is deliberately one-way rather than a full state machine: once a
 * task is terminal it stays terminal, and everything else may move freely.
 * A stricter machine would start rejecting real transitions from runtimes that
 * do not implement the spec exactly, and a board that silently drops real
 * events is worse than one that accepts an odd ordering.
 */
export function canTransition(prev, next) {
  if (!prev) return true;
  if (prev === next) return false;
  if (TERMINAL.has(prev)) return false;
  return true;
}

export class TaskBoard {
  /**
   * @param {object} [opts]
   * @param {(type: string, payload: object, meta?: object) => void} [opts.record]
   *   governance sink, normally index.js's recordGovernance. Omitted in tests
   *   and when the ledger is disabled; the board then works but does not
   *   survive a restart, which is the documented degraded mode.
   * @param {() => number} [opts.now]
   */
  constructor({ record = null, now = Date.now, maxTasks = MAX_TASKS, doneTtlMs = DONE_TTL_MS } = {}) {
    /** @type {Map<string, object>} */
    this.tasks = new Map();
    this.record = record;
    this.now = now;
    this.maxTasks = maxTasks;
    this.doneTtlMs = doneTtlMs;
    this.rebuilt = false;
    this.dropped = 0;
  }

  /**
   * Fold one office event into the board.
   *
   * @returns {{taskId: string, from: string|null, to: string}|null} the
   *   transition, when one happened. The caller uses it to decide whether to
   *   broadcast; returning null for a no-op keeps a chatty bridge from
   *   re-rendering every client sixty times a minute.
   */
  ingest(ev, { persist = true } = {}) {
    if (!ev || typeof ev !== "object") return null;

    const parsed = this._parse(ev);
    if (!parsed) return null;
    const { id, state, patch } = parsed;

    const existing = this.tasks.get(id);
    const prev = existing ? existing.state : null;

    if (!canTransition(prev, state)) {
      // Still merge late-arriving metadata — a retry often carries the title
      // the first attempt lacked — but do not move the task backwards.
      if (existing) this._merge(existing, patch);
      return null;
    }

    const ts = typeof ev.ts === "number" ? ev.ts : this.now();
    const task = existing ?? {
      id,
      title: undefined,
      agent: undefined,
      peer: undefined,
      origin: undefined,
      repo: undefined,
      state,
      createdTs: ts,
      updatedTs: ts,
      transitions: [],
    };

    this._merge(task, patch);
    task.state = state;
    task.updatedTs = ts;
    task.lane = laneFor(state);
    task.transitions.push({ state, ts });
    if (task.transitions.length > MAX_TRANSITIONS) {
      task.transitions.splice(0, task.transitions.length - MAX_TRANSITIONS);
    }

    this.tasks.set(id, task);
    this._evict();

    if (persist && this.record) {
      // Title is deliberately included: an auditor reading the chain six
      // months later needs to know what the task *was*, and the chain is
      // already owner-only.
      this.record(
        "task_transition",
        {
          taskId: id,
          from: prev,
          to: state,
          title: task.title ?? null,
          agent: task.agent ?? null,
          origin: task.origin ?? null,
          repo: task.repo ?? null,
        },
        { actor: task.agent ?? null, subject: id, ts },
      );
    }

    return { taskId: id, from: prev, to: state };
  }

  /** Translate the three event shapes that carry task identity. */
  _parse(ev) {
    const id = clamp(ev.taskId);
    if (!id) return null;

    if (ev.type === "task_update") {
      const state = normaliseState(ev.state) ?? "working";
      return {
        id,
        state,
        patch: {
          title: clamp(ev.title) ?? clamp(ev.summary),
          agent: clamp(ev.agent) ?? clamp(ev.agentId),
          // `ev.source` is deliberately NOT a fallback here. The server stamps
          // it with the bridge that relayed the event, which answers "who
          // told us" — a different question from "where did this work come
          // from". Using it meant a follow-up `working` with no origin field
          // silently rewrote a task's origin from `telegram` to `cloud`, and
          // the board then misreported how the operator gives orders.
          origin: clamp(ev.origin) ?? clamp(ev.platform),
          repo: clamp(ev.repo),
          peer: clamp(ev.peer),
        },
      };
    }

    if (ev.type === "a2a_task_in") {
      // A peer handed us work. Arrival is the start of working on it; A2A
      // models acceptance on the receiving side, not a separate submission.
      return {
        id,
        state: normaliseState(ev.state) ?? "working",
        patch: {
          title: clamp(ev.summary),
          agent: clamp(ev.dest),
          peer: clamp(ev.peer),
          origin: "a2a",
          repo: clamp(ev.repo),
        },
      };
    }

    if (ev.type === "a2a_task_out") {
      return {
        id,
        state: normaliseState(ev.state) ?? "submitted",
        patch: {
          title: clamp(ev.summary),
          agent: clamp(ev.origin),
          peer: clamp(ev.peer),
          origin: "a2a",
          repo: clamp(ev.repo),
        },
      };
    }

    return null;
  }

  /** Later non-empty values win; a retry must not blank a known field. */
  _merge(task, patch) {
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined && v !== null && v !== "") task[k] = v;
    }
  }

  /**
   * Keep the board bounded. Finished work ages out first — the chain is the
   * archive, this is the view — and only if that is not enough do we drop the
   * oldest live task, counting it so the shortfall is visible rather than
   * silent.
   */
  _evict() {
    const now = this.now();
    for (const [id, t] of this.tasks) {
      if (TERMINAL.has(t.state) && now - t.updatedTs > this.doneTtlMs) {
        this.tasks.delete(id);
      }
    }
    if (this.tasks.size <= this.maxTasks) return;

    const ordered = [...this.tasks.values()].sort((a, b) => {
      const at = TERMINAL.has(a.state) ? 0 : 1;
      const bt = TERMINAL.has(b.state) ? 0 : 1;
      if (at !== bt) return at - bt;
      return a.updatedTs - b.updatedTs;
    });
    while (this.tasks.size > this.maxTasks) {
      const victim = ordered.shift();
      if (!victim) break;
      this.tasks.delete(victim.id);
      this.dropped += 1;
    }
  }

  /**
   * Rebuild from ledger rows on boot. Records are `task_transition` payloads
   * in ascending seq.
   *
   * `persist` is off: re-recording a fold would double every task's history
   * on every restart, and the chain would grow without any new work happening.
   */
  rebuildFrom(records) {
    let folded = 0;
    for (const row of records ?? []) {
      let payload = row?.payload;
      if (typeof payload === "string") {
        try {
          payload = JSON.parse(payload);
        } catch {
          continue;
        }
      }
      if (!payload?.taskId || !payload?.to) continue;
      this.ingest(
        {
          type: "task_update",
          taskId: payload.taskId,
          state: payload.to,
          title: payload.title ?? undefined,
          agent: payload.agent ?? undefined,
          origin: payload.origin ?? undefined,
          repo: payload.repo ?? undefined,
          ts: row.ts,
        },
        { persist: false },
      );
      folded += 1;
    }
    this.rebuilt = true;
    return folded;
  }

  /**
   * Board snapshot.
   *
   * This used to take an `isGuest` flag and blank out titles and repo names,
   * on the argument that a visitor may see the shape of the work but not its
   * subject. There is no visitor. The board is the owner's.
   */
  snapshot() {
    const lanes = Object.fromEntries(TASK_LANES.map((l) => [l.id, []]));

    for (const t of this.tasks.values()) {
      const view = {
        id: t.id,
        state: t.state,
        lane: t.lane ?? laneFor(t.state),
        agent: t.agent ?? null,
        origin: t.origin ?? null,
        createdTs: t.createdTs,
        updatedTs: t.updatedTs,
        blocked: BLOCKED.has(t.state),
      };
      view.title = t.title ?? null;
      view.repo = t.repo ?? null;
      view.peer = t.peer ?? null;
      lanes[view.lane].push(view);
    }

    // Newest first inside a lane: an operator scanning the board wants the
    // thing that just changed, not the thing that has been sitting there.
    for (const list of Object.values(lanes)) list.sort((a, b) => b.updatedTs - a.updatedTs);

    return {
      lanes,
      order: TASK_LANES.map((l) => l.id),
      counts: Object.fromEntries(Object.entries(lanes).map(([k, v]) => [k, v.length])),
      total: this.tasks.size,
      blocked: lanes.blocked.length,
      dropped: this.dropped,
      rebuilt: this.rebuilt,
    };
  }

  get size() {
    return this.tasks.size;
  }
}

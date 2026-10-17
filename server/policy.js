/**
 * policy.js — the floor plan IS the policy.
 *
 * The idea
 * --------
 * Every agent governance product on the market expresses policy as YAML that
 * nobody reads. Hermes Office already draws a building. So: make the drawing
 * authoritative.
 *
 * RETRACTED 2026-10-17 — the `trust` field.
 * Every room used to carry one of four rungs — untrusted, standard,
 * privileged, idle. It is gone. It was never read: grep found it written in eight room
 * literals, copied into three output objects, attached to the agent_moved
 * event and accumulated into a Map in replay.js that nothing ever consumed.
 * No branch anywhere compared it. It denied nothing.
 * What actually refuses an action is below, and is unchanged: a missing room,
 * budgetHourlyUsd === 0, the tools deny list, the allow list, maxModelTier,
 * and the approval gates. Those are mechanisms. `trust` was a four-rung
 * ladder printed beside them, and a label that ranks without enforcing reads
 * as proof of an enforcement that does not exist.
 * Historical agent_moved records still carry `trust` in their payload. Replay
 * ignores unknown payload keys, so the chain stays valid and verifiable; old
 * events are not rewritten.
 *
 *   room          = scope           (which tools and models are reachable)
 *   room budget   = spend envelope  (a small room cannot burn much)
 *   door          = policy gate     (some transitions need a human)
 *   moving an agent into a room = granting it that room's scope
 *
 * The result is a governance model a non-engineer can audit by looking at it.
 * "Why was the agent allowed to run kubectl?" becomes "because someone put it
 * in the server room, and here is who did that and when."
 *
 * Relationship to burnrate.js
 * ---------------------------
 * burnrate.js answers "can we afford this?" across agent/global scopes. This
 * module answers "is this permitted here?" and adds a third spend scope: the
 * room. `decide()` composes both and returns the strictest outcome.
 *
 * Deny-by-default
 * ---------------
 * An unknown room, an unassigned agent, or a tool matching nothing all land in
 * the default room, which is the least privileged zone. Policy that fails open
 * is not policy.
 */

import { SlidingWindow, isPremium, suggestDowngrade, stateForRatio } from "./burnrate.js";

/** Model capability tiers, cheapest first. A room caps the tier it permits. */
export const MODEL_TIERS = ["cheap", "standard", "premium"];

const CHEAP = [
  /-mini\b/, /-nano\b/, /haiku/, /flash/, /-8b\b/, /small/,
  /gpt-3\.5/, /embedding/,
];

export function modelTier(model) {
  if (!model) return "standard";
  const id = String(model).toLowerCase();
  if (CHEAP.some((re) => re.test(id))) return "cheap";
  if (isPremium(id)) return "premium";
  return "standard";
}

/**
 * Glob matching for tool names: "*" and "fs:*" style patterns only.
 * Deliberately not full regex — policy authors should not be able to write a
 * catastrophically backtracking pattern into the request path.
 */
export function matchesPattern(name, pattern) {
  if (pattern === "*") return true;
  const n = String(name || "").toLowerCase();
  const p = String(pattern || "").toLowerCase();
  if (!p.includes("*")) return n === p;
  const [head, ...rest] = p.split("*");
  if (!n.startsWith(head)) return false;
  let i = head.length;
  for (const part of rest) {
    if (part === "") continue;
    const at = n.indexOf(part, i);
    if (at === -1) return false;
    i = at + part.length;
  }
  return p.endsWith("*") || n.endsWith(rest[rest.length - 1] ?? "");
}

const anyMatch = (name, patterns) =>
  Array.isArray(patterns) && patterns.some((p) => matchesPattern(name, p));

/**
 * Default floor plan — the owner's actual ecosystem.
 *
 * Until 2026-10-17 this table held eight rooms inherited from the fork the
 * project started as: lobby, main-office, meeting-room, server-room,
 * mac-studio, ceo-office, kitchen, nap-room. It described an office with
 * staff. This one has two machines and fifteen folders.
 *
 * The shape comes from frontend/src/eco/ecosystem.ts, which was transcribed
 * from the owner's AGENTS.md and project catalogue:
 *
 *   KANTOR  ->  RUANG      ->  MEJA  ->  AGEN
 *   machine     category       repo     telegram topic
 *
 * Ids are namespaced `office/room` because `root` exists in BOTH offices and
 * this map is flat. The same convention already names agents in the frontend
 * cast table (`mac/orkestrator`, `lightvela/infra`).
 *
 * What refuses an action: a missing room, budgetHourlyUsd === 0, the deny
 * list, the allow list, maxModelTier, and the approval gates. There is no
 * trust rung — see the retraction at the head of this file.
 *
 * Removing a room does not freeze the agents in it. roomFor() checks that an
 * assignment still names a room in this map and degrades to `defaultRoom`
 * when it does not, so the eight fork rooms could be withdrawn without
 * stranding anyone. decide()'s `no policy for this room` is reachable only
 * when the default room itself is missing from this map — which is the one
 * invariant this table must hold, and a test below holds it.
 *
 * Nothing was carried over, either: assignments live in an in-memory Map
 * built empty at construction and never rehydrated at boot, so a restart
 * already leaves every agent unplaced. There was no stored placement to
 * migrate.
 */

/** Production tooling. It lives on LightVela; the Mac is a workstation. */
const PRODUCTION = ["deploy", "kubectl", "terraform"];
/** Production tooling plus anything that reaches a shell or a database. */
const HANDS_OFF = [...PRODUCTION, "bash", "shell", "psql"];

export const DEFAULT_POLICY = {
  defaultRoom: "belum-dipetakan",
  rooms: {
    // Not a place. Where an agent sits when the office cannot say which room
    // it belongs to — the same words the UI already prints for an unmapped
    // agent. Read-only tools and the smallest allowance in the building.
    "belum-dipetakan": {
      label: "Belum dipetakan",
      tools: { allow: ["web_search", "read_file", "fetch", "llm:*"], deny: [] },
      maxModelTier: "cheap",
      budgetHourlyUsd: 0.25,
      approval: [],
    },

    // --- Mac: ~/Desktop/Niumination, structured, one-home rule -------------

    // mirai + ecosystem-config. The orchestrator and the main agent work here.
    "mac/root": {
      label: "Root Ekosistem",
      tools: { allow: ["*"], deny: PRODUCTION },
      maxModelTier: "premium",
      budgetHourlyUsd: 3.0,
      approval: ["bash"],
    },
    // Shipped and tested: Niu-LKH, PemdiAcehTengah, niu-dash, cc-switch, ...
    "mac/apps": {
      label: "Apps",
      tools: { allow: ["*"], deny: PRODUCTION },
      maxModelTier: "premium",
      budgetHourlyUsd: 2.0,
      approval: [],
    },
    // Backends and engines: sapa-ai, niu-cast, latticesend. These are the
    // Mac-side things that eventually ship, so `deploy` is reachable here —
    // with a signature on it.
    "mac/services": {
      label: "Services",
      tools: { allow: ["*"], deny: ["kubectl", "terraform"] },
      maxModelTier: "premium",
      budgetHourlyUsd: 2.0,
      approval: ["deploy", "bash"],
    },
    "mac/sites": {
      label: "Sites",
      tools: { allow: ["*"], deny: HANDS_OFF },
      maxModelTier: "premium",
      budgetHourlyUsd: 1.5,
      approval: [],
    },
    "mac/desktop": {
      label: "Desktop",
      tools: { allow: ["*"], deny: HANDS_OFF },
      maxModelTier: "premium",
      budgetHourlyUsd: 1.5,
      approval: [],
    },
    // No desks yet. Kept because the folder exists and agents land here.
    "mac/agents": {
      label: "Agents",
      tools: { allow: ["*"], deny: PRODUCTION },
      maxModelTier: "premium",
      budgetHourlyUsd: 1.0,
      approval: ["bash"],
    },
    // Experiments are allowed to fail, not allowed to be expensive.
    "mac/labs": {
      label: "Labs",
      tools: { allow: ["*"], deny: HANDS_OFF },
      maxModelTier: "standard",
      budgetHourlyUsd: 0.5,
      approval: [],
    },
    // asn-admin. The owner's rule is that ASN output must never reach a public
    // repository. This table CANNOT enforce that: it gates tool names, and
    // "which remote a commit goes to" is not one. The entry gate below is the
    // honest part — a human signs off on entering — and the rest is a human
    // rule that lives outside this file. Do not let the lock imply more.
    "mac/dinas": {
      label: "Dinas",
      tools: { allow: ["*"], deny: HANDS_OFF },
      maxModelTier: "premium",
      budgetHourlyUsd: 1.0,
      approval: [],
      entryApproval: true,
    },
    // Obsidian vault, local. Reading and writing notes, nothing else.
    "mac/brain": {
      label: "Brain",
      tools: { allow: ["read_file", "write_file", "web_search", "fetch", "llm:*"], deny: [] },
      maxModelTier: "standard",
      budgetHourlyUsd: 0.5,
      approval: [],
    },
    // 238 skills, 21 domains. Read-mostly reference.
    "mac/skills": {
      label: "Skills",
      tools: { allow: ["read_file", "write_file", "web_search", "llm:*"], deny: [] },
      maxModelTier: "standard",
      budgetHourlyUsd: 0.5,
      approval: [],
    },
    // Empty on the owner's instruction: leave Tools and Vault alone for now.
    // Zero allowance means decide() refuses everything here, which is the
    // truthful answer for a room with nothing in it.
    "mac/tools": {
      label: "Tools",
      tools: { allow: [] },
      maxModelTier: "cheap",
      budgetHourlyUsd: 0,
      approval: [],
    },
    "mac/vault": {
      label: "Vault",
      tools: { allow: [] },
      maxModelTier: "cheap",
      budgetHourlyUsd: 0,
      approval: [],
      entryApproval: true,
    },

    // --- LightVela: ~/niumination, no folder taxonomy ----------------------

    // hermes-office itself sits here.
    "lightvela/root": {
      label: "Root Ekosistem",
      tools: { allow: ["*"], deny: ["kubectl", "terraform"] },
      maxModelTier: "premium",
      budgetHourlyUsd: 2.0,
      approval: ["deploy", "bash"],
    },
    // 9router, Hermes Gateway, Office Octo, Hermes Cron, Agro-Climate. The
    // only room in either office with production tooling, and a human stands
    // at the door.
    "lightvela/infra": {
      label: "Infrastruktur & Monitoring",
      tools: { allow: ["*"] },
      maxModelTier: "premium",
      budgetHourlyUsd: 5.0,
      approval: ["deploy", "kubectl", "terraform", "psql", "bash"],
      entryApproval: true,
    },
    "lightvela/content": {
      label: "Content Studio",
      tools: { allow: ["*"], deny: HANDS_OFF },
      maxModelTier: "premium",
      budgetHourlyUsd: 1.5,
      approval: [],
    },
  },
};

const TIER_RANK = Object.fromEntries(MODEL_TIERS.map((t, i) => [t, i]));

let approvalSeq = 0;

export class FloorPlanPolicy {
  /**
   * @param {object} policy floor-plan policy document
   * @param {{now?: () => number, burn?: import("./burnrate.js").BurnRateTracker,
   *          onEvent?: (e: object) => void, approvalTtlMs?: number}} [opts]
   */
  constructor(policy = DEFAULT_POLICY, opts = {}) {
    this.policy = { ...DEFAULT_POLICY, ...policy, rooms: { ...DEFAULT_POLICY.rooms, ...(policy.rooms || {}) } };
    this.now = opts.now || (() => Date.now());
    this.burn = opts.burn || null;
    this.onEvent = opts.onEvent || (() => {});
    this.approvalTtlMs = opts.approvalTtlMs ?? 300_000; // 5 min

    /** @type {Map<string, {room: string, since: number, grantedBy: string}>} */
    this.assignments = new Map();
    /** @type {Map<string, SlidingWindow>} room -> hourly spend */
    this.roomSpend = new Map();
    /** @type {Map<string, object>} pending + resolved approvals */
    this.approvals = new Map();
  }

  // --- floor plan ---------------------------------------------------------

  room(id) {
    return this.policy.rooms[id] || null;
  }

  defaultRoom() {
    return this.policy.defaultRoom;
  }

  /** Which room governs this agent. Unassigned agents get the least privilege. */
  roomFor(agent) {
    const a = this.assignments.get(agent);
    if (a && this.room(a.room)) return a.room;
    return this.defaultRoom();
  }

  /**
   * Whether this agent has an explicit placement on the floor.
   *
   * Deliberately distinct from `roomFor()`, which answers the governance
   * question and therefore never returns "nowhere" — an unplaced agent is
   * governed as if it were in the default room. This answers the *visibility*
   * question instead: has anyone actually put it on the floor plan?
   *
   * The two drifted apart in practice. Every agent was governed as a lobby
   * occupant while `occupants` stayed empty for every room, so the office
   * rendered empty while the policy engine considered it staffed.
   */
  isAssigned(agent) {
    const a = this.assignments.get(agent);
    return Boolean(a && this.room(a.room));
  }

  /**
   * Move an agent. This IS the act of granting scope, so it is recorded with
   * who did it — that record is the audit answer to "why was this allowed?".
   */
  assign(agent, roomId, grantedBy = "owner") {
    if (!this.room(roomId)) {
      return { ok: false, error: `Unknown room: ${roomId}` };
    }
    const from = this.roomFor(agent);
    const r = this.room(roomId);

    if (r.entryApproval && from !== roomId) {
      const ap = this._openApproval({
        kind: "entry",
        agent,
        room: roomId,
        fromRoom: from,
        reason: `${roomId} requires sign-off to enter`,
      });
      return { ok: false, pending: true, approvalId: ap.id, approval: ap };
    }

    this._commitAssign(agent, roomId, grantedBy, from);
    return { ok: true, agent, room: roomId, fromRoom: from };
  }

  _commitAssign(agent, roomId, grantedBy, from) {
    this.assignments.set(agent, { room: roomId, since: this.now(), grantedBy });
    this.onEvent({
      type: "agent_moved",
      agent,
      fromRoom: from,
      room: roomId,
      grantedBy,
      ts: this.now(),
    });
  }

  // --- spend --------------------------------------------------------------

  recordSpend(agent, costUsd) {
    if (!(costUsd > 0)) return;
    const room = this.roomFor(agent);
    let w = this.roomSpend.get(room);
    if (!w) {
      w = new SlidingWindow(3_600_000, 60);
      this.roomSpend.set(room, w);
    }
    w.add(costUsd, this.now());
  }

  roomSpentHour(roomId) {
    const w = this.roomSpend.get(roomId);
    return w ? w.total(this.now()) : 0;
  }

  // --- approvals ----------------------------------------------------------

  _openApproval(fields) {
    const id = `ap-${++approvalSeq}-${this.now().toString(36)}`;
    const ap = {
      id,
      status: "pending",
      createdAt: this.now(),
      expiresAt: this.now() + this.approvalTtlMs,
      ...fields,
    };
    this.approvals.set(id, ap);
    this.onEvent({
      type: "approval_requested",
      approvalId: id,
      kind: ap.kind,
      agent: ap.agent,
      room: ap.room,
      tool: ap.tool,
      reason: ap.reason,
      ts: this.now(),
    });
    return ap;
  }

  getApproval(id) {
    const ap = this.approvals.get(id);
    if (!ap) return null;
    if (ap.status === "pending" && this.now() > ap.expiresAt) {
      ap.status = "expired";
      ap.resolvedAt = this.now();
      // Expiry used to happen silently, which meant the audit log recorded a
      // request with no outcome. "Nobody answered, so the action did not
      // happen" is positive evidence that the system fails closed — exactly
      // what Art. 14 asks to see — so it must be emitted like any other
      // resolution. Emitted once: status is no longer "pending" afterwards.
      this.onEvent({
        type: "approval_resolved",
        approvalId: ap.id,
        kind: ap.kind,
        agent: ap.agent,
        room: ap.room,
        tool: ap.tool,
        state: "expired",
        resolvedBy: null,
        decidedBy: null,
        waitedMs: ap.resolvedAt - ap.createdAt,
        ts: this.now(),
      });
    }
    return ap;
  }

  /** Human decision at the door. */
  resolveApproval(id, approve, by = "owner") {
    const ap = this.getApproval(id);
    if (!ap) return { ok: false, error: "Unknown approval" };
    if (ap.status !== "pending") {
      return { ok: false, error: `Approval already ${ap.status}` };
    }
    ap.status = approve ? "approved" : "denied";
    ap.resolvedAt = this.now();
    ap.resolvedBy = by;

    // An approved entry request performs the move it was asking for.
    if (approve && ap.kind === "entry") {
      this._commitAssign(ap.agent, ap.room, by, ap.fromRoom);
    }

    this.onEvent({
      type: "approval_resolved",
      approvalId: id,
      kind: ap.kind,
      agent: ap.agent,
      room: ap.room,
      tool: ap.tool,
      state: ap.status,
      resolvedBy: by,
      decidedBy: by,
      // How long a human took to answer is Art. 14 evidence in itself: an
      // oversight capability nobody ever exercises is not oversight.
      waitedMs: ap.resolvedAt - ap.createdAt,
      ts: this.now(),
    });
    return { ok: true, approval: ap };
  }

  pendingApprovals() {
    const out = [];
    for (const id of this.approvals.keys()) {
      const ap = this.getApproval(id);
      if (ap?.status === "pending") out.push(ap);
    }
    return out.sort((a, b) => a.createdAt - b.createdAt);
  }

  /** Drop resolved/expired approvals so the map cannot grow without bound. */
  sweepApprovals(maxAgeMs = 3_600_000) {
    const cutoff = this.now() - maxAgeMs;
    let removed = 0;
    for (const [id, ap] of this.approvals) {
      this.getApproval(id); // force expiry transition
      if (ap.status !== "pending" && (ap.resolvedAt ?? ap.createdAt) < cutoff) {
        this.approvals.delete(id);
        removed++;
      }
    }
    return removed;
  }

  // --- the decision -------------------------------------------------------

  /**
   * Unified gate: room policy first, then spend.
   *
   * @param {{agent?: string, tool?: string, model?: string,
   *          estimatedUsd?: number, approvalId?: string}} req
   */
  decide(req = {}) {
    const agent = typeof req.agent === "string" && req.agent ? req.agent : null;
    const tool = typeof req.tool === "string" ? req.tool : "";
    const model = typeof req.model === "string" ? req.model : "";
    const estimatedUsd = Number(req.estimatedUsd) || 0;

    const roomId = agent ? this.roomFor(agent) : this.defaultRoom();
    const room = this.room(roomId) || this.room(this.defaultRoom());

    const base = {
      agent,
      room: roomId,
      roomLabel: room?.label ?? roomId,
      // Which rule decided this. Steps 1–4 are the room's own doing; step 5
      // delegates to the burn tracker, which overrides it with its own scope.
      // Without a default, a room-policy refusal reached the audit dossier
      // with an empty "Rule" column — a refusal nobody can attribute is not
      // defensible evidence.
      scope: "room",
      tool: tool || undefined,
      model: model || undefined,
    };

    if (!room) {
      // Should be unreachable, but policy that fails open is not policy.
      return { ...base, allow: false, action: "deny", reason: "no policy for this room" };
    }

    // 0. An explicitly idle room short-circuits with the clearest reason.
    //    Checking tools first would answer "write_file is outside the scope of
    //    Kitchen", which is true but tells the operator far less than "agents
    //    parked here are idle".
    if (room.budgetHourlyUsd === 0) {
      return {
        ...base,
        allow: false,
        action: "deny",
        scope: "room",
        reason: `${room.label} has no spend allowance (agents here are idle)`,
      };
    }

    // 1. Tool permission. Deny list wins over allow list.
    if (tool) {
      if (anyMatch(tool, room.tools?.deny)) {
        return {
          ...base,
          allow: false,
          action: "deny",
          reason: `${tool} is not permitted in ${room.label}`,
          hint: this._whereIsToolAllowed(tool),
        };
      }
      if (!anyMatch(tool, room.tools?.allow)) {
        return {
          ...base,
          allow: false,
          action: "deny",
          reason: `${tool} is outside the scope of ${room.label}`,
          hint: this._whereIsToolAllowed(tool),
        };
      }
    }

    // 2. Model tier ceiling.
    if (model) {
      const tier = modelTier(model);
      const ceiling = room.maxModelTier || "premium";
      if (TIER_RANK[tier] > TIER_RANK[ceiling]) {
        return {
          ...base,
          allow: false,
          action: "restrict",
          reason: `${model} is ${tier}; ${room.label} permits up to ${ceiling}`,
          suggestModel: suggestDowngrade(model),
        };
      }
    }

    // 3. Human gate at the door.
    if (tool && anyMatch(tool, room.approval)) {
      if (req.approvalId) {
        const ap = this.getApproval(req.approvalId);
        if (ap && ap.status === "approved" && ap.agent === agent && ap.tool === tool) {
          // fall through to the spend checks
        } else {
          return {
            ...base,
            allow: false,
            action: "await_approval",
            approvalId: req.approvalId,
            approvalStatus: ap?.status ?? "unknown",
            reason:
              ap?.status === "denied"
                ? `a human denied ${tool} for ${agent}`
                : `waiting for sign-off on ${tool}`,
          };
        }
      } else {
        const ap = this._openApproval({
          kind: "tool",
          agent,
          room: roomId,
          tool,
          model: model || undefined,
          reason: `${tool} in ${room.label} requires human sign-off`,
        });
        return {
          ...base,
          allow: false,
          action: "await_approval",
          approvalId: ap.id,
          approvalStatus: "pending",
          expiresAt: ap.expiresAt,
          reason: `${tool} in ${room.label} requires human sign-off`,
        };
      }
    }

    // 4. Room spend envelope — a small room cannot burn much.
    const roomLimit = room.budgetHourlyUsd;
    if (roomLimit != null) {
      const spent = this.roomSpentHour(roomId);
      const ratio = (spent + Math.max(0, estimatedUsd)) / roomLimit;
      if (ratio >= 1) {
        return {
          ...base,
          allow: false,
          action: "deny",
          scope: "room",
          state: "tripped",
          spentUsd: round(spent),
          limitUsd: roomLimit,
          ratio: round(ratio, 4),
          reason: `${room.label} budget exhausted ($${spent.toFixed(2)} of $${roomLimit.toFixed(2)}/hr)`,
        };
      }
    }

    // 5. Agent and global spend, delegated to the burn tracker.
    if (this.burn) {
      const d = this.burn.decide({ agent, model, estimatedUsd });
      if (!d.allow || d.action !== "allow") {
        return { ...base, ...d, scope: d.scope ?? "room", reason: d.reason };
      }
    }

    const spent = roomLimit ? this.roomSpentHour(roomId) : 0;
    return {
      ...base,
      allow: true,
      action: "allow",
      scope: "room",
      state: roomLimit ? stateForRatio(spent / roomLimit) : "normal",
      spentUsd: round(spent),
      limitUsd: roomLimit ?? null,
      ratio: roomLimit ? round(spent / roomLimit, 4) : 0,
      reason: `permitted in ${room.label}`,
    };
  }

  /** Actionable denial: tell the caller which room would allow this. */
  _whereIsToolAllowed(tool) {
    const open = [];
    for (const [id, r] of Object.entries(this.policy.rooms)) {
      if (anyMatch(tool, r.tools?.deny)) continue;
      if (!anyMatch(tool, r.tools?.allow)) continue;
      open.push({ room: id, label: r.label, needsApproval: anyMatch(tool, r.approval) });
    }
    if (!open.length) return undefined;
    return `allowed in: ${open.map((o) => o.label + (o.needsApproval ? " (with sign-off)" : "")).join(", ")}`;
  }

  /** The floor plan as data — drives the UI and is the audit artifact. */
  snapshot() {
    const rooms = Object.entries(this.policy.rooms).map(([id, r]) => {
      const spent = this.roomSpentHour(id);
      const limit = r.budgetHourlyUsd;
      const occupants = [];
      for (const [agent, a] of this.assignments) {
        if (a.room === id) occupants.push({ agent, since: a.since, grantedBy: a.grantedBy });
      }
      return {
        room: id,
        label: r.label,
        maxModelTier: r.maxModelTier,
        toolsAllow: r.tools?.allow ?? [],
        toolsDeny: r.tools?.deny ?? [],
        approval: r.approval ?? [],
        entryApproval: Boolean(r.entryApproval),
        budgetHourlyUsd: limit ?? null,
        spentHourUsd: round(spent),
        ratio: limit > 0 ? round(spent / limit, 4) : null,
        state: limit > 0 ? stateForRatio(spent / limit) : "normal",
        occupants,
      };
    });
    return {
      defaultRoom: this.defaultRoom(),
      rooms,
      pendingApprovals: this.pendingApprovals().length,
      ts: this.now(),
    };
  }
}

function round(n, dp = 6) {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/** Load a floor-plan policy from JSON, falling back to the default. */
export function loadPolicy(raw) {
  if (!raw) return DEFAULT_POLICY;
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== "object") return DEFAULT_POLICY;
    return parsed;
  } catch {
    return DEFAULT_POLICY;
  }
}

/**
 * burnrate.js — cost accounting, budget policy and the enforcement decision.
 *
 * Why this is not just a dashboard widget
 * ---------------------------------------
 * Observability reports after the fact. By the time a chart shows a runaway
 * loop, the money is gone — a documented 2026 incident burned tens of
 * thousands over one weekend before anyone looked. IDC (Dec 2025) found 96% of
 * enterprises exceed their AI cost projections while only 44% have any
 * financial guardrail, and no major agent framework ships a native dollar cap.
 * OWASP tracks this as LLM10, "Unbounded Consumption / Denial of Wallet".
 *
 * So the budget has to be answerable *in the request path*, before the spend
 * happens. That is what `decide()` is for: an agent asks "may I spend?" and
 * gets an answer in microseconds from in-memory state.
 *
 * Steering, not halting
 * ---------------------
 * Microsoft's TokenOps work found that run-level governance which *steers* —
 * downgrade the model, shorten the context, drop optional tool calls — cut
 * spend per task ~78% while raising completion from 67% to 96%. Hard halting
 * does the opposite: it saves money by failing the work, which just moves the
 * cost to a human. So the ladder below degrades gradually and only denies at
 * the very top.
 *
 *   normal   < 50%   allow
 *   warm     < 75%   allow, advise cheaper model
 *   hot      < 90%   allow, but refuse premium models
 *   critical < 100%  throttle: cheapest tier only
 *   tripped  >= 100% deny
 *
 * The physics metaphor in the UI reads directly off these states: room
 * temperature is burn rate, fire is `critical`, sprinklers are `tripped`.
 */

/**
 * Premium models refused at `hot` and above.
 *
 * These must be regexes, not substrings: "gpt-4o-mini" contains "gpt-4o" and
 * "gpt-5-nano" contains "gpt-5", so plain `includes` would block the very
 * cheap models we want agents to fall back to — exactly inverting the policy.
 */
const PREMIUM = [
  /claude-opus/,
  /gpt-4-turbo/,
  /gpt-4o(?!-mini)/,
  /gpt-4(?![.o\d-])/, // bare "gpt-4", not gpt-4.1 / gpt-4o
  /gpt-4\.1(?!-mini|-nano)/,
  /gpt-5(?!-mini|-nano)/,
  /\bo1(?!-mini)/,
  /\bo3(?!-mini)/,
  /gemini-2\.5-pro/,
  /gemini-1\.5-pro/,
  /grok-4/,
  /grok-3(?!-mini)/,
  /mistral-large/,
  /llama-3\.1-405b/,
];

/** Suggested downgrades, cheapest sensible substitute per family. */
const DOWNGRADE = [
  [/claude-opus/, "claude-sonnet-4-5"],
  [/claude-sonnet/, "claude-haiku-4"],
  [/gpt-5(?!-mini|-nano)/, "gpt-5-mini"],
  [/gpt-4o(?!-mini)/, "gpt-4o-mini"],
  [/gpt-4\.1(?!-mini|-nano)/, "gpt-4.1-mini"],
  [/gpt-4-turbo|gpt-4$/, "gpt-4o-mini"],
  [/^o[13](?!-mini)/, "o4-mini"],
  [/gemini-2\.5-pro/, "gemini-2.5-flash"],
  [/gemini-1\.5-pro/, "gemini-1.5-flash"],
  [/grok-4|grok-3(?!-mini)/, "grok-3-mini"],
  [/mistral-large/, "mistral-small"],
  [/llama-3\.1-405b|llama-3\.3-70b/, "llama-3.1-8b"],
];

export const BURN_STATES = ["normal", "warm", "hot", "critical", "tripped"];

export function stateForRatio(ratio) {
  if (!Number.isFinite(ratio) || ratio < 0) return "normal";
  if (ratio >= 1) return "tripped";
  if (ratio >= 0.9) return "critical";
  if (ratio >= 0.75) return "hot";
  if (ratio >= 0.5) return "warm";
  return "normal";
}

export function suggestDowngrade(model) {
  if (!model) return undefined;
  const id = String(model).toLowerCase();
  for (const [re, to] of DOWNGRADE) if (re.test(id)) return to;
  return undefined;
}

export function isPremium(model) {
  if (!model) return false;
  const id = String(model).toLowerCase();
  return PREMIUM.some((re) => re.test(id));
}

/**
 * Fixed-resolution sliding window. Buckets are cheap to age out and bound
 * memory regardless of traffic, unlike keeping a list of every charge.
 */
export class SlidingWindow {
  constructor(windowMs, buckets = 60) {
    this.windowMs = windowMs;
    this.bucketMs = Math.max(1, Math.floor(windowMs / buckets));
    this.buckets = buckets;
    this.ring = new Array(buckets).fill(0);
    this.stamp = new Array(buckets).fill(-1);
  }

  _idx(now) {
    return Math.floor(now / this.bucketMs) % this.buckets;
  }

  add(amount, now) {
    const slot = Math.floor(now / this.bucketMs);
    const i = slot % this.buckets;
    if (this.stamp[i] !== slot) {
      this.ring[i] = 0;
      this.stamp[i] = slot;
    }
    this.ring[i] += amount;
  }

  total(now) {
    const current = Math.floor(now / this.bucketMs);
    const oldest = current - this.buckets + 1;
    let sum = 0;
    for (let i = 0; i < this.buckets; i++) {
      if (this.stamp[i] >= oldest) sum += this.ring[i];
    }
    return sum;
  }
}

/**
 * @typedef {object} BudgetPolicy
 * @property {number} [globalHourlyUsd]  spend cap across all agents, per hour
 * @property {number} [globalDailyUsd]   spend cap across all agents, per day
 * @property {number} [agentHourlyUsd]   default per-agent hourly cap
 * @property {Record<string, number>} [perAgentHourlyUsd] overrides by agent
 */

export class BurnRateTracker {
  /**
   * @param {BudgetPolicy} policy
   * @param {{now?: () => number, onStateChange?: (e: object) => void}} [opts]
   */
  constructor(policy = {}, opts = {}) {
    this.policy = policy;
    this.now = opts.now || (() => Date.now());
    this.onStateChange = opts.onStateChange || (() => {});

    this.globalHour = new SlidingWindow(3_600_000, 60);
    this.globalDay = new SlidingWindow(86_400_000, 96);
    /** @type {Map<string, {hour: SlidingWindow, state: string, lifetimeUsd: number, calls: number, tokens: number}>} */
    this.agents = new Map();
    this.globalState = "normal";
    this.lifetimeUsd = 0;
  }

  _agent(name) {
    let a = this.agents.get(name);
    if (!a) {
      a = { hour: new SlidingWindow(3_600_000, 60), state: "normal", lifetimeUsd: 0, calls: 0, tokens: 0 };
      this.agents.set(name, a);
    }
    return a;
  }

  agentLimit(name) {
    const per = this.policy.perAgentHourlyUsd || {};
    return per[name] ?? this.policy.agentHourlyUsd;
  }

  /**
   * Record realized spend. Called for every event that carries a cost.
   * @returns {object[]} budget_state events worth broadcasting (state changes only)
   */
  record({ agent, costUsd = 0, tokens = 0 }) {
    const now = this.now();
    const cost = Number.isFinite(costUsd) ? costUsd : 0;

    this.globalHour.add(cost, now);
    this.globalDay.add(cost, now);
    this.lifetimeUsd += cost;

    const changes = [];

    if (agent) {
      const a = this._agent(agent);
      a.hour.add(cost, now);
      a.lifetimeUsd += cost;
      a.calls += 1;
      a.tokens += Number.isFinite(tokens) ? tokens : 0;

      const limit = this.agentLimit(agent);
      if (limit > 0) {
        const next = stateForRatio(a.hour.total(now) / limit);
        if (next !== a.state) {
          const from = a.state;
          a.state = next;
          changes.push(this._event("agent", agent, from, next, a.hour.total(now), limit));
        }
      }
    }

    const gLimit = this.policy.globalHourlyUsd;
    if (gLimit > 0) {
      const next = stateForRatio(this.globalHour.total(now) / gLimit);
      if (next !== this.globalState) {
        const from = this.globalState;
        this.globalState = next;
        changes.push(this._event("global", "office", from, next, this.globalHour.total(now), gLimit));
      }
    }

    for (const ev of changes) this.onStateChange(ev);
    return changes;
  }

  _event(scope, subject, from, to, spentUsd, limitUsd) {
    return {
      type: "budget_state",
      scope,
      subject,
      from,
      state: to,
      spentUsd: round(spentUsd),
      limitUsd: round(limitUsd),
      ratio: round(limitUsd > 0 ? spentUsd / limitUsd : 0, 4),
      ts: this.now(),
    };
  }

  /**
   * The enforcement decision — answered before the spend, from memory.
   *
   * @param {{agent?: string, model?: string, estimatedUsd?: number}} req
   * @returns {{allow: boolean, action: "allow"|"advise"|"restrict"|"throttle"|"deny",
   *            state: string, reason: string, suggestModel?: string,
   *            spentUsd: number, limitUsd?: number, ratio: number,
   *            retryAfterS?: number}}
   */
  decide(req = {}) {
    const now = this.now();
    const { agent, model, estimatedUsd = 0 } = req;

    // Evaluate agent and global scopes; the stricter one governs.
    const scopes = [];

    if (agent) {
      const limit = this.agentLimit(agent);
      if (limit > 0) {
        const spent = this._agent(agent).hour.total(now);
        scopes.push({ scope: "agent", subject: agent, spent, limit });
      }
    }
    if (this.policy.globalHourlyUsd > 0) {
      scopes.push({
        scope: "global",
        subject: "office",
        spent: this.globalHour.total(now),
        limit: this.policy.globalHourlyUsd,
      });
    }
    if (this.policy.globalDailyUsd > 0) {
      scopes.push({
        scope: "global-daily",
        subject: "office",
        spent: this.globalDay.total(now),
        limit: this.policy.globalDailyUsd,
      });
    }

    if (!scopes.length) {
      return {
        allow: true,
        action: "allow",
        state: "normal",
        reason: "no budget configured",
        spentUsd: 0,
        ratio: 0,
      };
    }

    // Include the projected cost of this call so the caller is stopped at the
    // boundary rather than one call past it.
    const worst = scopes
      .map((s) => ({ ...s, ratio: (s.spent + Math.max(0, estimatedUsd)) / s.limit }))
      .sort((a, b) => b.ratio - a.ratio)[0];

    const state = stateForRatio(worst.ratio);
    const base = {
      state,
      scope: worst.scope,
      subject: worst.subject,
      spentUsd: round(worst.spent),
      limitUsd: round(worst.limit),
      ratio: round(worst.ratio, 4),
    };

    switch (state) {
      case "tripped":
        return {
          ...base,
          allow: false,
          action: "deny",
          reason: `${worst.scope} budget exhausted (${fmt(worst.spent)} of ${fmt(worst.limit)})`,
          retryAfterS: this._secondsUntilRelief(worst, now),
        };

      case "critical": {
        const suggest = suggestDowngrade(model);
        if (isPremium(model)) {
          return {
            ...base,
            allow: false,
            action: "throttle",
            reason: `at ${pct(worst.ratio)} of ${worst.scope} budget; premium models are blocked`,
            suggestModel: suggest,
            retryAfterS: this._secondsUntilRelief(worst, now),
          };
        }
        return {
          ...base,
          allow: true,
          action: "throttle",
          reason: `at ${pct(worst.ratio)} of ${worst.scope} budget; use the cheapest viable model`,
          suggestModel: suggest,
        };
      }

      case "hot":
        return {
          ...base,
          allow: !isPremium(model),
          action: isPremium(model) ? "restrict" : "advise",
          reason: isPremium(model)
            ? `at ${pct(worst.ratio)} of ${worst.scope} budget; ${model} is premium`
            : `at ${pct(worst.ratio)} of ${worst.scope} budget`,
          suggestModel: suggestDowngrade(model),
        };

      case "warm":
        return {
          ...base,
          allow: true,
          action: "advise",
          reason: `at ${pct(worst.ratio)} of ${worst.scope} budget`,
          suggestModel: suggestDowngrade(model),
        };

      default:
        return { ...base, allow: true, action: "allow", reason: "within budget" };
    }
  }

  /** When the oldest spend ages out of the window, headroom returns. */
  _secondsUntilRelief(scope, _now) {
    const windowS = scope.scope === "global-daily" ? 86_400 : 3_600;
    // Conservative: a full bucket, not the whole window.
    return Math.max(30, Math.ceil(windowS / 60));
  }

  /** Full snapshot for GET /burn and for the UI's physics layer. */
  snapshot() {
    const now = this.now();
    const gHour = this.globalHour.total(now);
    const gDay = this.globalDay.total(now);
    const gLimit = this.policy.globalHourlyUsd;

    const agents = [];
    for (const [name, a] of this.agents) {
      const limit = this.agentLimit(name);
      const spent = a.hour.total(now);
      agents.push({
        agent: name,
        spentHourUsd: round(spent),
        limitUsd: limit > 0 ? round(limit) : null,
        ratio: limit > 0 ? round(spent / limit, 4) : null,
        state: limit > 0 ? stateForRatio(spent / limit) : "normal",
        lifetimeUsd: round(a.lifetimeUsd),
        calls: a.calls,
        tokens: a.tokens,
      });
    }
    agents.sort((x, y) => y.spentHourUsd - x.spentHourUsd);

    return {
      global: {
        spentHourUsd: round(gHour),
        spentDayUsd: round(gDay),
        limitHourUsd: gLimit > 0 ? round(gLimit) : null,
        limitDayUsd: this.policy.globalDailyUsd > 0 ? round(this.policy.globalDailyUsd) : null,
        ratio: gLimit > 0 ? round(gHour / gLimit, 4) : null,
        state: gLimit > 0 ? stateForRatio(gHour / gLimit) : "normal",
        lifetimeUsd: round(this.lifetimeUsd),
        // Projected hourly spend if the last hour's pace continues.
        burnPerHourUsd: round(gHour),
      },
      agents,
      policy: {
        globalHourlyUsd: this.policy.globalHourlyUsd ?? null,
        globalDailyUsd: this.policy.globalDailyUsd ?? null,
        agentHourlyUsd: this.policy.agentHourlyUsd ?? null,
        perAgentHourlyUsd: this.policy.perAgentHourlyUsd || {},
      },
      ts: now,
    };
  }
}

// --- helpers ---------------------------------------------------------------

function round(n, dp = 6) {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

function pct(ratio) {
  return `${Math.round(ratio * 100)}%`;
}

function fmt(usd) {
  return `$${(Math.round(usd * 100) / 100).toFixed(2)}`;
}

/** Parse OFFICE_BUDGET_PER_AGENT="researcher=2.50,planner=0.75". */
export function parsePerAgentBudget(raw) {
  const out = {};
  if (!raw) return out;
  for (const part of String(raw).split(",")) {
    const [k, v] = part.split("=");
    const n = Number((v || "").trim());
    if (k && k.trim() && Number.isFinite(n) && n > 0) out[k.trim()] = n;
  }
  return out;
}

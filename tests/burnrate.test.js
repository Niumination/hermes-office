import test from "node:test";
import assert from "node:assert/strict";
import {
  BurnRateTracker,
  stateForRatio,
  suggestDowngrade,
  isPremium,
  parsePerAgentBudget,
} from "../server/burnrate.js";

/** Deterministic clock so sliding-window behaviour is testable. */
function clock(start = 1_700_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms) => (t += ms) };
}

const mk = (policy, c = clock()) => ({
  c,
  t: new BurnRateTracker(policy, { now: c.now }),
});

// --- state ladder ----------------------------------------------------------

test("state ladder maps spend ratio to the five physics states", () => {
  assert.equal(stateForRatio(0), "normal");
  assert.equal(stateForRatio(0.49), "normal");
  assert.equal(stateForRatio(0.5), "warm");
  assert.equal(stateForRatio(0.74), "warm");
  assert.equal(stateForRatio(0.75), "hot");
  assert.equal(stateForRatio(0.89), "hot");
  assert.equal(stateForRatio(0.9), "critical");
  assert.equal(stateForRatio(0.99), "critical");
  assert.equal(stateForRatio(1), "tripped");
  assert.equal(stateForRatio(12), "tripped");
  assert.equal(stateForRatio(NaN), "normal", "missing data must not look like a fire");
});

// --- accounting ------------------------------------------------------------

test("records spend per agent and globally", () => {
  const { t } = mk({ globalHourlyUsd: 10, agentHourlyUsd: 4 });
  t.record({ agent: "a", costUsd: 1, tokens: 100 });
  t.record({ agent: "a", costUsd: 0.5, tokens: 50 });
  t.record({ agent: "b", costUsd: 2, tokens: 200 });

  const s = t.snapshot();
  assert.equal(s.global.spentHourUsd, 3.5);
  assert.equal(s.global.lifetimeUsd, 3.5);
  const a = s.agents.find((x) => x.agent === "a");
  assert.equal(a.spentHourUsd, 1.5);
  assert.equal(a.calls, 2);
  assert.equal(a.tokens, 150);
  assert.equal(s.agents[0].agent, "b", "snapshot ranks by spend");
});

test("spend ages out of the sliding window", () => {
  const { t, c } = mk({ globalHourlyUsd: 10 });
  t.record({ agent: "a", costUsd: 6 });
  assert.equal(t.snapshot().global.state, "warm");

  c.advance(61 * 60 * 1000); // one hour and change
  assert.equal(t.snapshot().global.spentHourUsd, 0, "window should be empty");
  assert.equal(t.snapshot().global.state, "normal");
  assert.equal(t.snapshot().global.lifetimeUsd, 6, "lifetime never decays");
});

test("daily window outlives the hourly one", () => {
  const { t, c } = mk({ globalHourlyUsd: 10, globalDailyUsd: 100 });
  t.record({ agent: "a", costUsd: 9 });
  c.advance(2 * 60 * 60 * 1000);
  const s = t.snapshot();
  assert.equal(s.global.spentHourUsd, 0);
  assert.equal(s.global.spentDayUsd, 9);
});

// --- state-change events ---------------------------------------------------

test("emits budget_state only on a transition, not on every charge", () => {
  const seen = [];
  const c = clock();
  const t = new BurnRateTracker(
    { globalHourlyUsd: 10 },
    { now: c.now, onStateChange: (e) => seen.push(e) }
  );

  t.record({ agent: "a", costUsd: 1 }); // 10% normal
  assert.equal(seen.length, 0);
  t.record({ agent: "a", costUsd: 4 }); // 50% warm
  assert.equal(seen.length, 1);
  t.record({ agent: "a", costUsd: 0.5 }); // 55% still warm
  assert.equal(seen.length, 1, "no event while the state is unchanged");
  t.record({ agent: "a", costUsd: 3 }); // 85% hot
  assert.equal(seen.length, 2);

  assert.equal(seen[0].type, "budget_state");
  assert.equal(seen[0].from, "normal");
  assert.equal(seen[0].state, "warm");
  assert.equal(seen[1].state, "hot");
});

test("per-agent and global transitions are reported separately", () => {
  const seen = [];
  const c = clock();
  const t = new BurnRateTracker(
    { globalHourlyUsd: 10, agentHourlyUsd: 2 },
    { now: c.now, onStateChange: (e) => seen.push(e) }
  );
  t.record({ agent: "hog", costUsd: 2 }); // agent 100%, global 20%
  const scopes = seen.map((e) => `${e.scope}:${e.state}`);
  assert.ok(scopes.includes("agent:tripped"));
  assert.ok(!scopes.some((s) => s.startsWith("global")), "global is still normal");
});

// --- the enforcement decision ---------------------------------------------

test("no budget configured means never block", () => {
  const { t } = mk({});
  const d = t.decide({ agent: "a", model: "claude-opus-4" });
  assert.equal(d.allow, true);
  assert.equal(d.action, "allow");
});

test("decision steers before it halts, as the ladder prescribes", () => {
  mk({ agentHourlyUsd: 10 });

  const at = (spent, model) => {
    const fresh = new BurnRateTracker({ agentHourlyUsd: 10 }, { now: () => 1e12 });
    fresh.record({ agent: "a", costUsd: spent });
    return fresh.decide({ agent: "a", model });
  };

  assert.equal(at(1, "gpt-4o").action, "allow");
  assert.equal(at(6, "gpt-4o").action, "advise");
  assert.equal(at(6, "gpt-4o").allow, true);

  // hot: premium refused, cheap still allowed
  assert.equal(at(8, "claude-opus-4").action, "restrict");
  assert.equal(at(8, "claude-opus-4").allow, false);
  assert.equal(at(8, "gpt-4o-mini").allow, true);

  // critical: throttle to cheapest
  assert.equal(at(9.5, "gpt-4o-mini").action, "throttle");
  assert.equal(at(9.5, "gpt-4o-mini").allow, true, "work continues at the cheap tier");
  assert.equal(at(9.5, "claude-opus-4").allow, false);

  // tripped: hard deny regardless of model
  assert.equal(at(11, "gpt-4o-mini").action, "deny");
  assert.equal(at(11, "gpt-4o-mini").allow, false);
  assert.ok(at(11, "gpt-4o-mini").retryAfterS > 0, "deny tells the caller when to retry");
});

test("a downgrade is suggested whenever one exists", () => {
  const { t } = mk({ agentHourlyUsd: 1 });
  t.record({ agent: "a", costUsd: 0.8 });
  const d = t.decide({ agent: "a", model: "claude-opus-4-1" });
  assert.equal(d.suggestModel, "claude-sonnet-4-5");
  assert.ok(d.reason.includes("%"), "reason states how far into the budget we are");
});

test("the projected cost of this call is counted, so the cap is hit at the boundary", () => {
  const { t } = mk({ agentHourlyUsd: 10 });
  t.record({ agent: "a", costUsd: 9.5 });
  // Without lookahead this reads as 95% (critical) and a cheap call is allowed.
  const blind = t.decide({ agent: "a", model: "gpt-4o-mini" });
  assert.equal(blind.state, "critical");
  // With a $1 estimate it already exceeds the cap, so it must be denied now.
  const ahead = t.decide({ agent: "a", model: "gpt-4o-mini", estimatedUsd: 1 });
  assert.equal(ahead.state, "tripped");
  assert.equal(ahead.allow, false);
});

test("the strictest scope governs", () => {
  const { t } = mk({ globalHourlyUsd: 100, agentHourlyUsd: 1 });
  t.record({ agent: "a", costUsd: 1 }); // agent tripped, global at 1%
  const d = t.decide({ agent: "a", model: "gpt-4o-mini" });
  assert.equal(d.allow, false);
  assert.equal(d.scope, "agent");

  // A different agent is unaffected by its neighbour's overspend.
  assert.equal(t.decide({ agent: "b", model: "gpt-4o-mini" }).allow, true);
});

test("a daily cap can trip while the hourly one is calm", () => {
  const { t, c } = mk({ globalHourlyUsd: 10, globalDailyUsd: 12 });
  t.record({ agent: "a", costUsd: 9 });
  c.advance(2 * 60 * 60 * 1000); // hourly window empties, daily does not
  const d = t.decide({ agent: "a", model: "gpt-4o-mini", estimatedUsd: 4 });
  assert.equal(d.scope, "global-daily");
  assert.equal(d.allow, false);
});

// --- helpers ---------------------------------------------------------------

test("premium detection and downgrades cover the main families", () => {
  assert.ok(isPremium("claude-opus-4-20250514"));
  assert.ok(isPremium("gpt-4o-2024-11-20"));
  assert.ok(!isPremium("claude-haiku-4"));
  assert.ok(!isPremium("llama-3.1-8b"));
  assert.equal(suggestDowngrade("gemini-2.5-pro"), "gemini-2.5-flash");
  assert.equal(suggestDowngrade("something-unknown"), undefined);
});

test("per-agent budget string parses, ignoring junk", () => {
  assert.deepEqual(parsePerAgentBudget("researcher=2.50,planner=0.75"), {
    researcher: 2.5,
    planner: 0.75,
  });
  assert.deepEqual(parsePerAgentBudget("bad,=1,x=notanumber,y=-5,z=0"), {});
  assert.deepEqual(parsePerAgentBudget(""), {});
  assert.deepEqual(parsePerAgentBudget(undefined), {});
});

test("a per-agent override beats the default", () => {
  const { t } = mk({ agentHourlyUsd: 10, perAgentHourlyUsd: { tightwad: 1 } });
  t.record({ agent: "tightwad", costUsd: 1 });
  t.record({ agent: "normal-agent", costUsd: 1 });
  assert.equal(t.decide({ agent: "tightwad" }).allow, false);
  assert.equal(t.decide({ agent: "normal-agent" }).allow, true);
});

test("memory stays bounded under sustained traffic", () => {
  const c = clock();
  const t = new BurnRateTracker({ globalHourlyUsd: 1e9 }, { now: c.now });
  for (let i = 0; i < 20_000; i++) {
    t.record({ agent: "a", costUsd: 0.0001 });
    c.advance(1000);
  }
  // 60 hourly + 96 daily buckets per scope, regardless of charge count.
  assert.equal(t.globalHour.ring.length, 60);
  assert.equal(t.globalDay.ring.length, 96);
  assert.equal(t.agents.size, 1);
  assert.ok(t.snapshot().global.spentHourUsd > 0);
});

test("cheap variants are never mistaken for premium", () => {
  // Substring matching would block exactly the models the policy wants agents
  // to fall back to, inverting the whole mechanism.
  for (const cheap of [
    "gpt-4o-mini", "gpt-4o-mini-2024-07-18", "gpt-5-mini", "gpt-5-nano",
    "gpt-4.1-mini", "gpt-4.1-nano", "o3-mini", "o4-mini", "o1-mini",
    "claude-haiku-4", "gemini-2.5-flash", "grok-3-mini", "mistral-small",
    "llama-3.1-8b",
  ]) {
    assert.equal(isPremium(cheap), false, `${cheap} must not be premium`);
  }
  for (const dear of [
    "gpt-4o", "gpt-4o-2024-11-20", "gpt-5", "gpt-4", "gpt-4-turbo",
    "claude-opus-4-1", "o1", "o3", "gemini-2.5-pro", "grok-4", "mistral-large",
  ]) {
    assert.equal(isPremium(dear), true, `${dear} must be premium`);
  }
});

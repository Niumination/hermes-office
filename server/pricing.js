/**
 * pricing.js — token → USD estimation.
 *
 * Feeds cost attribution on OTLP-derived events. Kept in its own module with a
 * plain data table so prices can be corrected without touching mapping logic.
 *
 * Prices are USD per 1,000,000 tokens. Matching is longest-prefix on a
 * lowercased model id, so "claude-sonnet-4-5-20250929" matches the
 * "claude-sonnet-4" entry and dated OpenAI snapshots match their base model.
 *
 * IMPORTANT: these are estimates for visualization and budget signalling, not
 * billing. Provider-reported cost (gen_ai.usage.cost) always wins when present.
 * Cached-token and batch discounts are not modelled, so figures skew high.
 */

/** @type {Array<[prefix: string, inputPerMTok: number, outputPerMTok: number]>} */
const PRICES = [
  // Anthropic
  ["claude-opus-4", 15, 75],
  ["claude-sonnet-4", 3, 15],
  ["claude-haiku-4", 1, 5],
  ["claude-3-7-sonnet", 3, 15],
  ["claude-3-5-sonnet", 3, 15],
  ["claude-3-5-haiku", 0.8, 4],
  ["claude-3-opus", 15, 75],
  ["claude-3-haiku", 0.25, 1.25],

  // OpenAI
  ["gpt-5-mini", 0.25, 2],
  ["gpt-5-nano", 0.05, 0.4],
  ["gpt-5", 1.25, 10],
  ["gpt-4.1-nano", 0.1, 0.4],
  ["gpt-4.1-mini", 0.4, 1.6],
  ["gpt-4.1", 2, 8],
  ["gpt-4o-mini", 0.15, 0.6],
  ["gpt-4o", 2.5, 10],
  ["gpt-4-turbo", 10, 30],
  ["gpt-4", 30, 60],
  ["gpt-3.5-turbo", 0.5, 1.5],
  ["o4-mini", 1.1, 4.4],
  ["o3-mini", 1.1, 4.4],
  ["o3", 2, 8],
  ["o1-mini", 1.1, 4.4],
  ["o1", 15, 60],
  ["text-embedding-3-large", 0.13, 0],
  ["text-embedding-3-small", 0.02, 0],

  // Google
  ["gemini-2.5-pro", 1.25, 10],
  ["gemini-2.5-flash-lite", 0.1, 0.4],
  ["gemini-2.5-flash", 0.3, 2.5],
  ["gemini-2.0-flash", 0.1, 0.4],
  ["gemini-1.5-pro", 1.25, 5],
  ["gemini-1.5-flash", 0.075, 0.3],

  // Meta / Mistral / DeepSeek / xAI — common hosted prices
  ["deepseek-reasoner", 0.55, 2.19],
  ["deepseek-chat", 0.27, 1.1],
  ["grok-4", 3, 15],
  ["grok-3-mini", 0.3, 0.5],
  ["grok-3", 3, 15],
  ["mistral-large", 2, 6],
  ["mistral-small", 0.2, 0.6],
  ["llama-3.3-70b", 0.59, 0.79],
  ["llama-3.1-405b", 2.7, 2.7],
  ["llama-3.1-70b", 0.59, 0.79],
  ["llama-3.1-8b", 0.05, 0.08],
];

// Longest prefix first so "gpt-4o-mini" never matches "gpt-4" by accident.
const SORTED = [...PRICES].sort((a, b) => b[0].length - a[0].length);

/** Locally hosted inference has no per-token cost. */
const FREE_PROVIDERS = new Set(["ollama", "llamacpp", "llama.cpp", "vllm", "lmstudio", "local"]);

/**
 * @returns {number|undefined} USD, rounded to 6dp, or undefined when unknown.
 */
export function estimateCostUsd(model, inputTokens, outputTokens, provider) {
  const hasTokens =
    Number.isFinite(inputTokens) || Number.isFinite(outputTokens);
  if (!hasTokens) return undefined;

  if (provider && FREE_PROVIDERS.has(String(provider).toLowerCase())) return 0;
  if (!model) return undefined;

  const id = String(model).toLowerCase();
  const hit = SORTED.find(([prefix]) => id.includes(prefix));
  if (!hit) return undefined;

  const [, inRate, outRate] = hit;
  const cost =
    ((inputTokens || 0) / 1e6) * inRate + ((outputTokens || 0) / 1e6) * outRate;
  return Math.round(cost * 1e6) / 1e6;
}

/** Exposed for a future pricing-override endpoint and for tests. */
export function knownModels() {
  return PRICES.map(([prefix, i, o]) => ({ prefix, inputPerMTok: i, outputPerMTok: o }));
}

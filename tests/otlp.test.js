import test from "node:test";
import assert from "node:assert/strict";
import {
  anyValue,
  attrsToObject,
  nanosToMs,
  normalizeId,
  normalizeGenAi,
  inferOperation,
  spanToEvents,
  otlpToEvents,
} from "../server/otlp.js";
import { estimateCostUsd } from "../server/pricing.js";

// --- helpers ---------------------------------------------------------------

const attr = (obj) =>
  Object.entries(obj).map(([key, v]) => ({
    key,
    value:
      typeof v === "number"
        ? Number.isInteger(v)
          ? { intValue: String(v) }
          : { doubleValue: v }
        : typeof v === "boolean"
          ? { boolValue: v }
          : { stringValue: String(v) },
  }));

const span = (name, attrs, { start = 1e18, durNs = 1e9, error = false } = {}) => ({
  name,
  traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
  spanId: "00f067aa0ba902b7",
  startTimeUnixNano: String(start),
  endTimeUnixNano: String(start + durNs),
  status: { code: error ? 2 : 1 },
  attributes: attr(attrs),
});

const wrap = (spans, resourceAttrs = { "service.name": "svc" }) => ({
  resourceSpans: [
    { resource: { attributes: attr(resourceAttrs) }, scopeSpans: [{ spans }] },
  ],
});

// --- primitives ------------------------------------------------------------

test("anyValue decodes every OTLP scalar, int64 arrives as a string", () => {
  assert.equal(anyValue({ stringValue: "x" }), "x");
  assert.equal(anyValue({ intValue: "9007" }), 9007);
  assert.equal(anyValue({ doubleValue: 1.5 }), 1.5);
  assert.equal(anyValue({ boolValue: true }), true);
  assert.deepEqual(anyValue({ arrayValue: { values: [{ stringValue: "a" }] } }), ["a"]);
  assert.equal(anyValue(null), undefined);
  assert.equal(anyValue({ bytesValue: "AAAA" }), undefined, "bytes are never surfaced");
});

test("nanosToMs keeps precision on 19-digit nanosecond timestamps", () => {
  // 1791000003500000000ns = 1791000003500ms. Dividing as a float loses the
  // low digits, so this must be done on the string.
  assert.equal(nanosToMs("1791000003500000000"), 1791000003500);
  assert.equal(nanosToMs("999"), 0);
  assert.equal(nanosToMs("not-a-number"), undefined);
  assert.equal(nanosToMs(undefined), undefined);
});

test("normalizeId accepts hex and base64 span ids", () => {
  assert.equal(normalizeId("00F067AA0BA902B7"), "00f067aa0ba902b7");
  assert.equal(normalizeId(Buffer.from("00f067aa0ba902b7", "hex").toString("base64")), "00f067aa0ba902b7");
  assert.equal(normalizeId(""), "");
});

test("attrsToObject skips malformed entries instead of throwing", () => {
  const out = attrsToObject([
    { key: "a", value: { stringValue: "1" } },
    { key: 42, value: { stringValue: "ignored" } },
    null,
    { novalue: true },
  ]);
  assert.deepEqual(out, { a: "1" });
});

// --- the normalization layer (the actual product value) --------------------

test("normalizeGenAi collapses three attribute generations to one shape", () => {
  const current = normalizeGenAi({
    "gen_ai.provider.name": "anthropic",
    "gen_ai.request.model": "claude-sonnet-4-5",
    "gen_ai.usage.input_tokens": 100,
    "gen_ai.usage.output_tokens": 20,
  });
  const preV142 = normalizeGenAi({
    "gen_ai.system": "anthropic",
    "gen_ai.request.model": "claude-sonnet-4-5",
    "gen_ai.usage.prompt_tokens": 100,
    "gen_ai.usage.completion_tokens": 20,
  });
  const openllmetry = normalizeGenAi({
    "llm.vendor": "anthropic",
    "llm.request.model": "claude-sonnet-4-5",
    "llm.usage.prompt_tokens": 100,
    "llm.usage.completion_tokens": 20,
  });

  for (const [label, g] of [["current", current], ["pre-1.42", preV142], ["openllmetry", openllmetry]]) {
    assert.equal(g.provider, "anthropic", label);
    assert.equal(g.model, "claude-sonnet-4-5", label);
    assert.equal(g.inputTokens, 100, label);
    assert.equal(g.outputTokens, 20, label);
    assert.equal(g.totalTokens, 120, `${label} derives total when absent`);
  }
});

test("normalizeGenAi prefers the newest spelling when both are present", () => {
  // Frameworks routinely emit both during a migration window.
  const g = normalizeGenAi({
    "gen_ai.system": "old-value",
    "gen_ai.provider.name": "new-value",
    "gen_ai.usage.prompt_tokens": 1,
    "gen_ai.usage.input_tokens": 999,
  });
  assert.equal(g.provider, "new-value");
  assert.equal(g.inputTokens, 999);
});

test("agent name falls back to resource service.name", () => {
  const g = normalizeGenAi({}, { "service.name": "billing-agent" });
  assert.equal(g.agentName, "billing-agent");
});

test("inferOperation reads the span-name convention when the attribute is absent", () => {
  assert.equal(inferOperation("chat gpt-4o", {}), "chat");
  assert.equal(inferOperation("execute_tool read_file", {}), "execute_tool");
  assert.equal(inferOperation("anything", { toolName: "x" }), "execute_tool");
  assert.equal(inferOperation("anything", { model: "gpt-4o" }), "chat");
  assert.equal(inferOperation("GET /users", {}), "", "non-GenAI spans stay unmapped");
});

// --- span mapping ----------------------------------------------------------

test("execute_tool becomes a tool_call/tool_done pair with real span timestamps", () => {
  const evs = spanToEvents(
    span("execute_tool read_file", {
      "gen_ai.operation.name": "execute_tool",
      "gen_ai.tool.name": "read_file",
      "gen_ai.agent.name": "researcher",
    }, { start: 1791000000000000000, durNs: 250000000 })
  );
  assert.equal(evs.length, 2);
  assert.equal(evs[0].type, "tool_call");
  assert.equal(evs[1].type, "tool_done");
  assert.equal(evs[0].agentId, "researcher");
  assert.equal(evs[1].tool, "read_file");
  assert.equal(evs[1].ts - evs[0].ts, 250, "duration survives as a 250ms gap");
  assert.equal(evs[1].durationMs, 250);
  assert.equal(evs[1].ok, true);
});

test("a failed span sets ok:false", () => {
  const evs = spanToEvents(
    span("invoke_agent planner", { "gen_ai.operation.name": "invoke_agent" }, { error: true })
  );
  assert.equal(evs.at(-1).type, "agent_finished");
  assert.equal(evs.at(-1).ok, false);
});

test("create_agent maps to agent_spawned with the object agent shape", () => {
  const [ev] = spanToEvents(
    span("create_agent researcher", {
      "gen_ai.operation.name": "create_agent",
      "gen_ai.agent.name": "researcher",
      "gen_ai.agent.role": "reviewer",
    })
  );
  assert.equal(ev.type, "agent_spawned");
  assert.equal(typeof ev.agent, "object");
  assert.equal(ev.agent.name, "researcher");
  assert.equal(ev.agent.role, "reviewer");
});

test("MCP spans map to mcp_call", () => {
  const [ev] = spanToEvents(
    span("mcp tools/call", { "mcp.method.name": "tools/call", "mcp.server.name": "filesystem", "gen_ai.tool.name": "read_file" })
  );
  assert.equal(ev.type, "mcp_call");
  assert.equal(ev.server, "filesystem");
  assert.equal(ev.tool, "read_file");
});

test("non-GenAI spans produce nothing rather than noise", () => {
  assert.deepEqual(spanToEvents(span("GET /healthz", { "http.method": "GET" })), []);
  assert.deepEqual(spanToEvents(null), []);
  assert.deepEqual(spanToEvents({}), []);
});

test("prompt and completion content never leaves the mapper", () => {
  const evs = spanToEvents(
    span("chat gpt-4o", {
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": "gpt-4o",
      "gen_ai.prompt": "my secret business plan",
      "gen_ai.completion": "the answer is 42",
      "gen_ai.input.messages": "sensitive",
    })
  );
  const blob = JSON.stringify(evs);
  assert.ok(!blob.includes("secret business plan"));
  assert.ok(!blob.includes("the answer is 42"));
  assert.ok(!blob.includes("sensitive"));
});

// --- batch walking ---------------------------------------------------------

test("otlpToEvents walks the full envelope and time-orders the result", () => {
  const r = otlpToEvents(
    wrap([
      span("chat gpt-4o", { "gen_ai.operation.name": "chat", "gen_ai.request.model": "gpt-4o" }, { start: 3e18 }),
      span("execute_tool a", { "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "a" }, { start: 1e18 }),
      span("GET /x", { "http.method": "GET" }),
    ])
  );
  assert.equal(r.spans, 3);
  assert.equal(r.events.length, 4, "two mappable spans → two pairs");
  const ts = r.events.map((e) => e.ts);
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b), "events are time-ordered");
});

test("otlpToEvents tolerates garbage without throwing", () => {
  for (const bad of [null, undefined, {}, { resourceSpans: "nope" }, { resourceSpans: [null] }]) {
    const r = otlpToEvents(bad);
    assert.equal(r.events.length, 0);
  }
});

test("otlpToEvents caps the batch instead of unbounded ingest", () => {
  const many = Array.from({ length: 50 }, (_, i) =>
    span(`execute_tool t${i}`, { "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": `t${i}` })
  );
  const r = otlpToEvents(wrap(many), { maxEvents: 10 });
  assert.equal(r.events.length, 10);
  assert.ok(r.dropped > 0, "overflow is reported, not silently discarded");
});

test("snake_case envelope keys are accepted (some exporters emit them)", () => {
  const body = {
    resource_spans: [
      {
        resource: { attributes: attr({ "service.name": "svc" }) },
        scope_spans: [
          { spans: [span("execute_tool x", { "gen_ai.operation.name": "execute_tool", "gen_ai.tool.name": "x" })] },
        ],
      },
    ],
  };
  assert.equal(otlpToEvents(body).events.length, 2);
});

// --- cost ------------------------------------------------------------------

test("cost estimation matches published per-MTok rates", () => {
  // 12k in @ $3/MTok + 800 out @ $15/MTok = 0.036 + 0.012
  assert.equal(estimateCostUsd("claude-sonnet-4-5-20250929", 12000, 800), 0.048);
  // 5k in @ $2.50 + 1.2k out @ $10 = 0.0125 + 0.012
  assert.equal(estimateCostUsd("gpt-4o", 5000, 1200), 0.0245);
});

test("longest-prefix matching stops gpt-4o-mini being billed as gpt-4", () => {
  const mini = estimateCostUsd("gpt-4o-mini-2024-07-18", 1e6, 0);
  const four = estimateCostUsd("gpt-4", 1e6, 0);
  assert.equal(mini, 0.15);
  assert.equal(four, 30);
});

test("cost is undefined for unknown models and zero for local inference", () => {
  assert.equal(estimateCostUsd("some-homegrown-model", 1000, 1000), undefined);
  assert.equal(estimateCostUsd("llama3", 1000, 1000, "ollama"), 0);
  assert.equal(estimateCostUsd("gpt-4o", undefined, undefined), undefined, "no tokens, no guess");
});

test("provider-reported cost wins over the estimate", () => {
  const [, done] = spanToEvents(
    span("chat gpt-4o", {
      "gen_ai.operation.name": "chat",
      "gen_ai.request.model": "gpt-4o",
      "gen_ai.usage.input_tokens": 5000,
      "gen_ai.usage.output_tokens": 1200,
      "gen_ai.usage.cost": 0.99,
    })
  );
  assert.equal(done.costUsd, 0.99);
});

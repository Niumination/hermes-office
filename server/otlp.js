/**
 * otlp.js — OpenTelemetry GenAI → Hermes Office event mapping.
 *
 * Why this exists
 * ---------------
 * Hermes Office could previously only be fed by its own two bridges, which
 * capped its addressable users at "people running Hermes". Every serious agent
 * runtime now emits OpenTelemetry GenAI spans — Claude Code, VS Code Copilot,
 * OpenAI Codex, LangChain, LlamaIndex, Pydantic AI, OpenLLMetry. Accepting OTLP
 * means anything that can point an exporter at a URL becomes visualizable.
 *
 * The normalization problem (this is the actual work)
 * ---------------------------------------------------
 * The GenAI semantic conventions moved to their own repo in v1.42.0 and every
 * attribute is still status *Development*. Nothing is frozen, nothing is
 * tagged, and in practice a single trace often carries two or three
 * generations of attribute names at once because the app, the framework and
 * the instrumentation library were each pinned at different times:
 *
 *   gen_ai.system              → gen_ai.provider.name
 *   gen_ai.usage.prompt_tokens → gen_ai.usage.input_tokens
 *   gen_ai.usage.completion_tokens → gen_ai.usage.output_tokens
 *   llm.* / traceloop.*        → gen_ai.*            (OpenLLMetry lineage)
 *
 * We read every known spelling and emit one canonical shape. Consumers
 * downstream never see the archaeology.
 *
 * Privacy posture
 * ---------------
 * Prompt and completion *content* is never read. Only operation metadata,
 * model identifiers and token counts cross this boundary. That is deliberate
 * and matches the channel_msg privacy contract the rest of the server already
 * enforces: the office shows that work happened, never what was said.
 */

import { estimateCostUsd } from "./pricing.js";

// ---------------------------------------------------------------------------
// OTLP/JSON primitive decoding
// ---------------------------------------------------------------------------

/**
 * Decode an OTLP AnyValue.
 * int64 fields are strings in protobuf-JSON, so intValue arrives as "1234".
 */
export function anyValue(v) {
  if (v == null || typeof v !== "object") return undefined;
  if ("stringValue" in v) return v.stringValue;
  if ("intValue" in v) {
    const n = Number(v.intValue);
    return Number.isFinite(n) ? n : undefined;
  }
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("boolValue" in v) return Boolean(v.boolValue);
  if ("arrayValue" in v) return (v.arrayValue?.values || []).map(anyValue);
  if ("kvlistValue" in v) return attrsToObject(v.kvlistValue?.values);
  if ("bytesValue" in v) return undefined; // never surfaced
  return undefined;
}

/** OTLP KeyValue[] → plain object. */
export function attrsToObject(list) {
  const out = {};
  if (!Array.isArray(list)) return out;
  for (const kv of list) {
    if (!kv || typeof kv.key !== "string") continue;
    const val = anyValue(kv.value);
    if (val !== undefined) out[kv.key] = val;
  }
  return out;
}

/** protobuf-JSON int64 nanoseconds → epoch milliseconds. */
export function nanosToMs(nanos) {
  if (nanos == null) return undefined;
  const s = String(nanos);
  if (!/^\d+$/.test(s)) return undefined;
  // Avoid Number precision loss on 19-digit nanosecond values: cut the last 6
  // digits as a string instead of dividing a float.
  const ms = s.length > 6 ? Number(s.slice(0, -6)) : 0;
  return Number.isFinite(ms) ? ms : undefined;
}

/**
 * Span/trace ids are hex in OTLP/JSON, but several SDKs emit base64.
 * Normalize to lowercase hex so correlation keys are stable.
 */
export function normalizeId(id) {
  if (typeof id !== "string" || !id) return "";
  if (/^[0-9a-fA-F]+$/.test(id) && id.length % 2 === 0) return id.toLowerCase();
  try {
    return Buffer.from(id, "base64").toString("hex");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Attribute generation normalization
// ---------------------------------------------------------------------------

/** First defined value among several spellings. */
function pick(attrs, ...keys) {
  for (const k of keys) {
    const v = attrs[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function num(v) {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Collapse every known attribute generation into one canonical record.
 * Order inside each pick() is newest spelling first.
 */
export function normalizeGenAi(attrs, resource = {}) {
  const provider = pick(
    attrs,
    "gen_ai.provider.name", // current
    "gen_ai.system", // pre-1.42
    "llm.vendor", // OpenLLMetry
    "llm.system"
  );

  const model = pick(
    attrs,
    "gen_ai.request.model",
    "gen_ai.response.model",
    "llm.request.model",
    "llm.model_name",
    "model"
  );

  const inputTokens = num(
    pick(
      attrs,
      "gen_ai.usage.input_tokens", // current
      "gen_ai.usage.prompt_tokens", // pre-1.42
      "llm.usage.prompt_tokens",
      "llm.token_count.prompt"
    )
  );

  const outputTokens = num(
    pick(
      attrs,
      "gen_ai.usage.output_tokens",
      "gen_ai.usage.completion_tokens",
      "llm.usage.completion_tokens",
      "llm.token_count.completion"
    )
  );

  const totalTokens = num(
    pick(attrs, "gen_ai.usage.total_tokens", "llm.usage.total_tokens")
  );

  // service.name is a *value* from the resource, not a key in attrs, so it is
  // applied after pick() rather than as another candidate key.
  const agentName =
    pick(attrs, "gen_ai.agent.name", "gen_ai.agent.id", "agent.name", "traceloop.entity.name") ??
    resource["service.name"];

  return {
    operation: pick(attrs, "gen_ai.operation.name", "llm.request.type", "traceloop.span.kind"),
    provider: provider === undefined ? undefined : String(provider),
    model: model === undefined ? undefined : String(model),
    agentName: agentName === undefined ? undefined : String(agentName),
    agentId: pick(attrs, "gen_ai.agent.id", "gen_ai.agent.name"),
    conversationId: pick(attrs, "gen_ai.conversation.id", "session.id", "gen_ai.thread.id"),
    toolName: pick(attrs, "gen_ai.tool.name", "tool.name", "mcp.tool.name"),
    toolType: pick(attrs, "gen_ai.tool.type", "tool.type"),
    toolDescription: pick(attrs, "gen_ai.tool.description"),
    mcpMethod: pick(attrs, "mcp.method.name", "rpc.method"),
    mcpServer: pick(attrs, "mcp.server.name", "rpc.service", "mcp.transport"),
    workflowName: pick(attrs, "gen_ai.workflow.name", "traceloop.workflow.name"),
    inputTokens,
    outputTokens,
    totalTokens:
      totalTokens ?? ((inputTokens ?? 0) + (outputTokens ?? 0) || undefined),
    reportedCost: num(pick(attrs, "gen_ai.usage.cost", "llm.usage.total_cost")),
  };
}

/**
 * Infer the operation when `gen_ai.operation.name` is absent.
 * Span names follow "{operation} {target}" by convention, e.g. "chat gpt-4o",
 * "execute_tool read_file", "invoke_agent researcher".
 */
export function inferOperation(spanName, g) {
  if (g.operation) return String(g.operation).toLowerCase();
  const name = String(spanName || "").toLowerCase();
  const head = name.split(/\s+/)[0];
  const KNOWN = new Set([
    "chat", "text_completion", "generate_content", "embeddings", "execute_tool",
    "invoke_agent", "create_agent", "invoke_workflow", "plan", "retrieval",
  ]);
  if (KNOWN.has(head)) return head;
  if (g.mcpMethod || name.startsWith("mcp")) return "mcp";
  if (g.toolName) return "execute_tool";
  if (g.model) return "chat";
  return "";
}

// ---------------------------------------------------------------------------
// Span → Hermes events
// ---------------------------------------------------------------------------

const AGENT_FALLBACK = "otlp";

function cleanAgent(name) {
  const s = String(name || AGENT_FALLBACK).trim().slice(0, 120);
  return s || AGENT_FALLBACK;
}

/**
 * Map one span to zero or more Hermes events.
 *
 * OTLP delivers *completed* spans, so operations that the office renders as a
 * start/finish animation produce a pair of events carrying the span's real
 * start and end timestamps. The ring buffer is time-ordered, so the UI replays
 * them in the right order even though they arrive together.
 */
export function spanToEvents(span, resource = {}, _options = {}) {
  if (!span || typeof span !== "object") return [];

  const attrs = attrsToObject(span.attributes);
  const g = normalizeGenAi(attrs, resource);
  const op = inferOperation(span.name, g);
  if (!op) return []; // not a GenAI span — ignore rather than invent an event

  const startTs = nanosToMs(span.startTimeUnixNano) ?? Date.now();
  const endTs = nanosToMs(span.endTimeUnixNano) ?? startTs;
  const durationMs = Math.max(0, endTs - startTs);

  const traceId = normalizeId(span.traceId);
  const spanId = normalizeId(span.spanId);
  const agent = cleanAgent(g.agentName || resource["service.name"]);

  // status.code 2 = ERROR (1 = OK, 0 = UNSET)
  const failed = span.status?.code === 2 || span.status?.code === "STATUS_CODE_ERROR";

  const costUsd =
    g.reportedCost ??
    estimateCostUsd(g.model, g.inputTokens, g.outputTokens, g.provider);

  // Carried on every event so the UI can correlate and cost-attribute.
  const common = {
    traceId: traceId || undefined,
    spanId: spanId || undefined,
    conversationId: g.conversationId ? String(g.conversationId) : undefined,
    model: g.model,
    provider: g.provider,
  };

  const usage = {};
  if (g.inputTokens !== undefined) usage.inputTokens = g.inputTokens;
  if (g.outputTokens !== undefined) usage.outputTokens = g.outputTokens;
  if (g.totalTokens !== undefined) usage.totalTokens = g.totalTokens;
  if (costUsd !== undefined) usage.costUsd = costUsd;

  const pair = (callType, doneType, callExtra, doneExtra) => [
    { type: callType, ts: startTs, ...common, ...callExtra },
    {
      type: doneType,
      ts: endTs,
      durationMs,
      ok: !failed,
      ...common,
      ...usage,
      ...doneExtra,
    },
  ];

  switch (op) {
    case "create_agent":
      return [
        {
          type: "agent_spawned",
          ts: startTs,
          agent: {
            name: agent,
            id: String(g.agentId || agent),
            role: String(attrs["gen_ai.agent.role"] || "generalist"),
          },
          ...common,
        },
      ];

    case "invoke_agent":
      return [
        {
          type: "agent_spawned",
          ts: startTs,
          agent: { name: agent, id: String(g.agentId || agent), role: "generalist" },
          ...common,
        },
        {
          type: "agent_finished",
          ts: endTs,
          agentId: agent,
          durationMs,
          ok: !failed,
          summary: failed ? "failed" : "",
          ...common,
          ...usage,
        },
      ];

    case "execute_tool":
      return pair(
        "tool_call",
        "tool_done",
        { agentId: agent, tool: String(g.toolName || span.name || "tool").slice(0, 120) },
        { agentId: agent, tool: String(g.toolName || span.name || "tool").slice(0, 120) }
      );

    case "mcp":
      return [
        {
          type: "mcp_call",
          ts: startTs,
          server: String(g.mcpServer || "mcp").slice(0, 120),
          tool: String(g.toolName || g.mcpMethod || "call").slice(0, 120),
          agentId: agent,
          durationMs,
          ok: !failed,
          ...common,
          ...usage,
        },
      ];

    case "invoke_workflow":
    case "plan":
    case "retrieval":
    case "chat":
    case "text_completion":
    case "generate_content":
    case "embeddings": {
      // No native Hermes type for an LLM turn; render it as tool activity so
      // the character visibly works, with the model as the tool identity.
      const label =
        op === "invoke_workflow"
          ? `workflow:${g.workflowName || span.name || ""}`.slice(0, 120)
          : op === "plan" || op === "retrieval"
            ? op
            : `llm:${g.model || g.provider || "model"}`.slice(0, 120);
      return pair(
        "tool_call",
        "tool_done",
        { agentId: agent, tool: label },
        { agentId: agent, tool: label }
      );
    }

    default:
      return [];
  }
}

/**
 * Walk a full OTLP ExportTraceServiceRequest.
 * @returns {{events: object[], spans: number, dropped: number}}
 */
export function otlpToEvents(body, options = {}) {
  const maxEvents = options.maxEvents ?? 2000;
  const events = [];
  let spans = 0;
  let dropped = 0;

  const resourceSpans = body?.resourceSpans || body?.resource_spans || [];
  for (const rs of Array.isArray(resourceSpans) ? resourceSpans : []) {
    const resource = attrsToObject(rs?.resource?.attributes);
    const scopeSpans = rs?.scopeSpans || rs?.scope_spans || [];
    for (const ss of Array.isArray(scopeSpans) ? scopeSpans : []) {
      for (const span of Array.isArray(ss?.spans) ? ss.spans : []) {
        spans++;
        if (events.length >= maxEvents) {
          dropped++;
          continue;
        }
        try {
          for (const ev of spanToEvents(span, resource, options)) {
            if (events.length < maxEvents) events.push(ev);
            else dropped++;
          }
        } catch {
          dropped++; // one malformed span must never fail the whole batch
        }
      }
    }
  }

  // Time order so the office animates call → done correctly even when a batch
  // interleaves spans from several concurrent agents.
  events.sort((a, b) => (a.ts || 0) - (b.ts || 0));
  return { events, spans, dropped };
}

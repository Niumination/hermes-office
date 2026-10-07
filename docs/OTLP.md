# OTLP Ingest

Hermes Office accepts OpenTelemetry GenAI traces at `POST /v1/traces`.

Anything that can point an OTLP exporter at a URL becomes visible on the office
floor — Claude Code, VS Code Copilot, OpenAI Codex, LangChain, LlamaIndex,
Pydantic AI, CrewAI, OpenLLMetry, or your own SDK instrumentation. No Hermes
bridge required.

## Quick start

```bash
# server
OFFICE_OTLP_TOKEN=$(openssl rand -hex 24)

# any OpenTelemetry-instrumented app
export OTEL_EXPORTER_OTLP_ENDPOINT=http://your-office-host:7333
export OTEL_EXPORTER_OTLP_PROTOCOL=http/json
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer $OFFICE_OTLP_TOKEN"
```

That is the whole integration.

## Protocol

| | |
|---|---|
| Path | `POST /v1/traces` |
| Encoding | **OTLP/HTTP + JSON only** |
| Auth | `Authorization: Bearer <OFFICE_OTLP_TOKEN>` (role `bridge`) |
| Response | `200` + `ExportTraceServiceResponse` |
| Body limit | `OTLP_MAX_BODY_SIZE`, default `8mb` |
| Batch cap | `OTLP_MAX_EVENTS_PER_BATCH`, default `2000` events |

Protobuf returns `415` with a message telling you to switch protocol. Decoding
it would require pulling in a protobuf runtime for a format every SDK can
already emit as JSON; that dependency was not worth the attack surface.

Spans we cannot map are reported back honestly so your exporter's own metrics
stay accurate:

```json
{ "partialSuccess": { "rejectedSpans": 3, "errorMessage": "3 span(s) produced no usable event" } }
```

## Span mapping

Operation is read from `gen_ai.operation.name`, falling back to the span-name
convention (`"chat gpt-4o"` → `chat`).

| GenAI operation | Hermes events |
|---|---|
| `create_agent` | `agent_spawned` |
| `invoke_agent` | `agent_spawned` + `agent_finished` |
| `execute_tool` | `tool_call` + `tool_done` |
| `chat`, `text_completion`, `generate_content`, `embeddings` | `tool_call` + `tool_done`, tool = `llm:<model>` |
| `invoke_workflow` | `tool_call` + `tool_done`, tool = `workflow:<name>` |
| `plan`, `retrieval` | `tool_call` + `tool_done` |
| MCP spans (`mcp.method.name`) | `mcp_call` |
| anything else | ignored |

Non-GenAI spans produce **nothing**. An HTTP or database span will not be
guessed into a fake agent action.

Because OTLP delivers *completed* spans, operations that the office animates as
start→finish emit a pair of events carrying the span's real start and end
timestamps. The ring buffer is time-ordered, so the UI replays them correctly
even though they arrive in the same batch.

### Auto-spawn

Most instrumentation never emits `create_agent`. The first time an agent name
appears, the server synthesizes an `agent_spawned` (marked `synthetic: true`)
so the character actually walks onto the floor, and enrolls it in the liveness
watchdog. It also joins `GET /roster`, so a page reload still shows it.

Agent identity resolves in this order:
`gen_ai.agent.name` → `gen_ai.agent.id` → `agent.name` → `traceloop.entity.name`
→ resource `service.name` → `"otlp"`.

## Attribute normalization

This is the part that matters in practice. The GenAI semantic conventions moved
to a dedicated repo in v1.42.0 (12 Jun 2026) and **every attribute is still
status *Development*** — nothing is frozen, nothing is tagged. A single trace
routinely carries two or three generations of attribute names at once, because
the application, the framework and the instrumentation library were each pinned
at different times.

All of these are read and collapsed into one canonical shape:

| Canonical | Also accepted |
|---|---|
| `gen_ai.provider.name` | `gen_ai.system`, `llm.vendor`, `llm.system` |
| `gen_ai.usage.input_tokens` | `gen_ai.usage.prompt_tokens`, `llm.usage.prompt_tokens`, `llm.token_count.prompt` |
| `gen_ai.usage.output_tokens` | `gen_ai.usage.completion_tokens`, `llm.usage.completion_tokens`, `llm.token_count.completion` |
| `gen_ai.request.model` | `gen_ai.response.model`, `llm.request.model`, `llm.model_name` |
| `gen_ai.agent.name` | `gen_ai.agent.id`, `agent.name`, `traceloop.entity.name` |
| `gen_ai.tool.name` | `tool.name`, `mcp.tool.name` |

When both an old and a new spelling are present, the **newer wins**.
`total_tokens` is derived when absent.

## Cost attribution

`tool_done`, `agent_finished` and `mcp_call` carry `inputTokens`,
`outputTokens`, `totalTokens` and `costUsd`.

- Provider-reported cost (`gen_ai.usage.cost`) always wins.
- Otherwise cost is estimated from `server/pricing.js` using longest-prefix
  matching on the model id, so `gpt-4o-mini-2024-07-18` is never billed at
  `gpt-4` rates.
- Known local providers (`ollama`, `vllm`, `llamacpp`, `lmstudio`) cost `0`.
- Unknown models yield **no** `costUsd` rather than a wrong one.

These are estimates for visualization and budget signalling, not billing.
Cached-token and batch discounts are not modelled, so figures skew high.

## Privacy

Prompt and completion **content is never read**. Only operation metadata, model
identifiers and token counts cross the boundary — the same contract
`channel_msg` already enforces: the office shows that work happened, never what
was said.

Events then pass through the standard ingest pipeline — validation, clamping,
and the 8-pattern secret redactor — exactly like bridge events. OTLP is not a
privileged side door.

## Limits and failure behaviour

- Per-event rate limiting is **skipped** on this path (a normal batch would
  trip the 120/min limit). The body-size limit and batch cap bound it instead.
- One malformed span never fails the batch; it is counted in `rejectedSpans`.
- Events beyond `OTLP_MAX_EVENTS_PER_BATCH` are dropped and reported, not
  silently discarded.
- Set `LOG_LEVEL=debug` for a per-request line:
  `[otlp] spans=6 events=9 accepted=9 rejected=0 dropped=0`

## Verifying your setup

```bash
curl -s -X POST http://127.0.0.1:7333/v1/traces \
  -H "Authorization: Bearer $OFFICE_OTLP_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"resourceSpans":[{"resource":{"attributes":[
        {"key":"service.name","value":{"stringValue":"smoke"}}]},
      "scopeSpans":[{"spans":[{
        "name":"execute_tool ls","traceId":"4bf92f3577b34da6a3ce929d0e0e4736",
        "spanId":"00f067aa0ba902b7","startTimeUnixNano":"1791000000000000000",
        "endTimeUnixNano":"1791000000500000000","status":{"code":1},
        "attributes":[
          {"key":"gen_ai.operation.name","value":{"stringValue":"execute_tool"}},
          {"key":"gen_ai.tool.name","value":{"stringValue":"ls"}}]}]}]}]}'
# → {"partialSuccess":{}}
```

Then check the office, or `GET /debug/events` with an owner token.

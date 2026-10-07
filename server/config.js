import { readFileSync, existsSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Load .env.office into process.env (first match wins; real env wins over file). */
function loadEnvFile() {
  const candidates = [
    join(__dirname, "..", ".env.office"),
    join(process.cwd(), ".env.office"),
  ];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const val = m[2].trim().replace(/^["']|["']$/g, "");
      if (process.env[m[1]] === undefined) process.env[m[1]] = val;
    }
    return p;
  }
  return null;
}

loadEnvFile();

export const config = {
  port: parseInt(process.env.OFFICE_PORT || "7333", 10),
  host: process.env.OFFICE_HOST || "0.0.0.0",
  tokens: {
    cloud: process.env.OFFICE_CLOUD_TOKEN || "",
    mac: process.env.OFFICE_MAC_TOKEN || "",
    owner: process.env.OFFICE_OWNER_TOKEN || "",
    guest: process.env.OFFICE_GUEST_TOKEN || "",
    // Dedicated token for OTLP exporters. Role resolves to "bridge" via the
    // existing mapping, so it can POST events but never read /debug.
    otlp: process.env.OFFICE_OTLP_TOKEN || "",
  },
  hermesApi: process.env.HERMES_API || "http://127.0.0.1:3000",
  // No default. This previously shipped pointing at one specific machine's
  // Tailscale address, which meant a fresh install would POST its chat traffic
  // to a host the operator does not control and cannot see. An unset optional
  // integration must be OFF, never aimed at a stranger.
  hermesA2aMacUrl: process.env.HERMES_A2A_MAC_URL || "",
  hermesA2aMacToken: process.env.HERMES_A2A_MAC_TOKEN || "",
  githubToken: process.env.GITHUB_TOKEN || "",
  // No default. This used to name one particular account, so anyone who set
  // GITHUB_TOKEN without also setting GITHUB_ORG would spend their own rate
  // limit polling someone else's repositories.
  githubOrg: process.env.GITHUB_ORG || "",
  githubOwnerType: process.env.GITHUB_OWNER_TYPE || "",   // "user" | "org" | "" (auto-detect)
  watchdogCutoffMs: parseInt(process.env.OFFICE_WATCHDOG_CUTOFF_MS || "90000", 10),
  watchdogSweepMs: parseInt(process.env.OFFICE_WATCHDOG_SWEEP_MS || "30000", 10),
  allowedOrigins: new Set(
    (process.env.ALLOWED_ORIGINS ||
      "http://localhost:5173,http://localhost:7333,http://127.0.0.1:7333")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  ),
  // --- Burn-rate governance -------------------------------------------
  // Dollar caps enforced in the request path via POST /budget/check.
  // 0 or unset = that scope is unlimited.
  budget: {
    globalHourlyUsd: Number(process.env.OFFICE_BUDGET_HOURLY_USD || 0),
    globalDailyUsd: Number(process.env.OFFICE_BUDGET_DAILY_USD || 0),
    agentHourlyUsd: Number(process.env.OFFICE_BUDGET_AGENT_HOURLY_USD || 0),
    // "researcher=2.50,planner=0.75"
    perAgentRaw: process.env.OFFICE_BUDGET_PER_AGENT || "",
  },

  // --- Floor-plan policy ----------------------------------------------
  // Path to a JSON floor-plan policy document. Unset = built-in default.
  policyFile: process.env.OFFICE_POLICY_FILE || "",
  // Minutes a pending human approval stays open before expiring.
  approvalTtlMin: Number(process.env.OFFICE_APPROVAL_TTL_MIN || 5),

  // --- Flight recorder (audit ledger) ----------------------------------
  // Hash-chained, append-only record of governance decisions. On by default:
  // an audit trail that must be switched on is one that will be off during
  // the incident you needed it for.
  ledger: {
    enabled: process.env.OFFICE_LEDGER_ENABLED !== "0",
    dbPath: process.env.OFFICE_LEDGER_DB || "",
    // Art. 19 requires at least six months. 400 days covers a full annual
    // audit cycle with margin. 0 disables pruning entirely.
    retentionDays: Number(process.env.OFFICE_LEDGER_RETENTION_DAYS || 400),
    checkpointEvery: Number(process.env.OFFICE_LEDGER_CHECKPOINT_EVERY || 500),
    // Recording permitted actions too is what makes the log a complete record
    // rather than an incident list; Art. 12 asks for the former. Turn off only
    // if write volume genuinely demands it, and expect an assessor to ask why.
    recordAllows: process.env.OFFICE_LEDGER_RECORD_ALLOWS !== "0",
    // FULL = fsync every append. Slower, but a decision that was enforced and
    // not durably recorded is the exact gap an audit looks for.
    synchronous: (process.env.OFFICE_LEDGER_SYNCHRONOUS || "FULL").toUpperCase(),
  },

  // --- Ledger anchoring --------------------------------------------------
  // Publishing the head hash outside the ledger is the ONLY thing that makes
  // tail truncation detectable. See server/anchor.js for why the chain alone
  // cannot do it. On by default with a local file: weak, free, and strictly
  // better than nothing. Webhooks are what make it strong.
  anchor: {
    enabled: process.env.OFFICE_ANCHOR_ENABLED !== "0",
    filePath: process.env.OFFICE_ANCHOR_FILE || "",
    // Comma-separated. Each receives {seq, hash, records, ts, note}.
    webhooks: (process.env.OFFICE_ANCHOR_WEBHOOKS || "")
      .split(",").map(s => s.trim()).filter(Boolean),
    // Hourly. Short enough that at most an hour of tail is unprotected,
    // long enough that a third-party endpoint will not rate-limit us.
    intervalMs: Number(process.env.OFFICE_ANCHOR_INTERVAL_MS || 3_600_000),
    timeoutMs: Number(process.env.OFFICE_ANCHOR_TIMEOUT_MS || 5_000),
  },

  // OTLP batches are far larger than the 16kb /event limit.
  otlpMaxBodySize: process.env.OTLP_MAX_BODY_SIZE || "8mb",
  otlpMaxEventsPerBatch: parseInt(process.env.OTLP_MAX_EVENTS_PER_BATCH || "2000", 10),
  logLevel: process.env.LOG_LEVEL || "info",
  a2aMaxTurns: parseInt(process.env.A2A_MAX_TURNS || "1", 10),
  a2aCooldownMs: parseInt(process.env.A2A_COOLDOWN_MS || "60000", 10),
  dataDir: process.env.OFFICE_DATA_DIR || join(__dirname, "..", "data"),
};

try { mkdirSync(config.dataDir, { recursive: true }); } catch {}

export function assertConfig() {
  const missing = [];
  if (!config.tokens.cloud) missing.push("OFFICE_CLOUD_TOKEN");
  if (!config.tokens.mac) missing.push("OFFICE_MAC_TOKEN");
  if (!config.tokens.owner) missing.push("OFFICE_OWNER_TOKEN");
  if (missing.length) {
    throw new Error(
      "Missing required env: " + missing.join(", ") + " (copy .env.office.example)"
    );
  }
}

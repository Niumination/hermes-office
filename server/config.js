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
  },
  hermesApi: process.env.HERMES_API || "http://127.0.0.1:3000",
  hermesA2aMacUrl: process.env.HERMES_A2A_MAC_URL || "http://100.120.57.37:9900",
  hermesA2aMacToken: process.env.HERMES_A2A_MAC_TOKEN || "",
  githubToken: process.env.GITHUB_TOKEN || "",
  githubOrg: process.env.GITHUB_ORG || "Niumination",
  allowedOrigins: new Set(
    (process.env.ALLOWED_ORIGINS ||
      "http://localhost:5173,http://localhost:7333,http://127.0.0.1:7333")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
  ),
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

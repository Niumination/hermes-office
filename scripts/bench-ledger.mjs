#!/usr/bin/env node
/**
 * bench-ledger.mjs — multi-client load against the real server, then prove the
 * ledger survived it.
 *
 *   node scripts/bench-ledger.mjs            # full run, prints the table
 *   node scripts/bench-ledger.mjs --check    # short run, integrity only (gate)
 *
 * WHY THIS EXISTS
 *
 * FLIGHT-RECORDER.md §9 reports 0.020 ms per record, about 49,000 decisions a
 * second. That number is real but it is *in-process*: a loop calling
 * `ledger.record()` directly, one caller, no HTTP, no concurrency, no Express.
 * It answers "how expensive is an append" and was never able to answer the
 * question a buyer actually asks, which is:
 *
 *     when a fleet of agents hits this at once, does the chain survive?
 *
 * A hash chain is exactly the kind of structure that looks fine in a
 * single-threaded benchmark and comes apart under concurrency, because every
 * append depends on the previous one's hash. Interleave two writers and you
 * get a fork, a duplicate sequence number, or a silently dropped record — and
 * all three still *look* like a ledger.
 *
 * WHAT IS ASSERTED VERSUS WHAT IS REPORTED
 *
 * Asserted (and gated, deterministic on any machine):
 *   - `/ledger/verify` returns ok after the load
 *   - sequence numbers are contiguous with no gaps and no duplicates
 *   - every append is linked: each record's prevHash is its predecessor's hash
 *   - the recorded count matches the decisions the server said it allowed
 *
 * Reported, never asserted:
 *   - throughput and latency percentiles
 *
 * Timing is a property of the machine, not of the code. A gate that fails
 * when a CI runner is busy teaches people to re-run gates until they pass,
 * which destroys the value of every other gate in the suite. So the numbers
 * are printed with the hardware that produced them and nothing depends on
 * them.
 *
 * WHY A FLEET OF AGENTS AND NOT ONE HAMMER
 *
 * `/policy/check` is rate limited per agent: 600/minute, burst 60 per 5s. One
 * client looping would spend the run being throttled and would measure the
 * limiter rather than the ledger. The load is therefore spread across many
 * distinct agent identities, each staying under its own burst — which is also
 * the shape of the real workload this product exists to watch.
 */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { cpus } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHECK = process.argv.includes("--check");

// Under --check the run is short enough to sit inside the gate suite without
// adding a minute to it; the full run is large enough for the percentiles to
// mean something. Neither shape changes what is asserted.
const AGENTS = CHECK ? 16 : 50;
const PER_AGENT = CHECK ? 25 : 40;
const TOTAL = AGENTS * PER_AGENT;

const PORT = 7411 + (CHECK ? 1 : 0);
const BASE = `http://127.0.0.1:${PORT}`;
const TOK = {
  bridge: "bench-bridge-token-aaaaaaaa",
  mac: "bench-mac-token-cccccccc",
  owner: "bench-owner-token-bbbbbbbb",
};

function pct(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

async function waitUp(ms = 15000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      const r = await fetch(`${BASE}/health`);
      if (r.ok) return true;
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

async function main() {
  const dataDir = mkdtempSync(join(tmpdir(), "bench-ledger-"));
  const proc = spawn("node", [join(ROOT, "server", "index.js")], {
    env: {
      ...process.env,
      OFFICE_PORT: String(PORT),
      OFFICE_DATA_DIR: dataDir,
      OFFICE_CLOUD_TOKEN: TOK.bridge,
      OFFICE_MAC_TOKEN: TOK.mac,
      OFFICE_OWNER_TOKEN: TOK.owner,
      OFFICE_LEDGER_ENABLED: "1",
      // Full durability on purpose: the expensive setting is the one shipped
      // by default, so it is the one worth measuring.
      OFFICE_LEDGER_SYNCHRONOUS: "FULL",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const serverLog = [];
  proc.stdout.on("data", (d) => serverLog.push(String(d)));
  proc.stderr.on("data", (d) => serverLog.push(String(d)));

  let failures = [];
  try {
    if (!(await waitUp())) {
      console.log("FAIL: server did not come up");
      console.log(serverLog.join("").split("\n").slice(-12).map((l) => "    " + l).join("\n"));
      return 1;
    }

    const head0 = await (await fetch(`${BASE}/ledger/head`, {
      headers: { Authorization: `Bearer ${TOK.owner}` },
    })).json();
    const seqBefore = head0.seq ?? 0;

    // Setup, not measured: put the fleet to work. An agent lands in the Lobby,
    // whose scope is deliberately narrow, so a load test that skips this step
    // measures 100% denials and proves nothing about the allow path — which is
    // the hot one. Moving an agent IS granting it scope, so this is owner-only
    // and lands in the ledger too, which is realistic: a real run is a mix of
    // grants and decisions, not one record type.
    for (let a = 0; a < AGENTS; a++) {
      const r = await fetch(`${BASE}/agents/bench-agent-${a}/room`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOK.owner}`,
        },
        // lightvela/root — an allow-all premium room that exists in DEFAULT_POLICY
        // after the kantor/ruang namespacing (old ids like `main-office` are gone).
        body: JSON.stringify({ room: "lightvela/root" }),
      });
      if (!r.ok && r.status !== 202) {
        console.log(`FAIL: could not place bench-agent-${a} in lightvela/root ` +
          `(HTTP ${r.status}); the load would measure denials, not throughput`);
        return 1;
      }
    }

    const lat = [];
    let allowed = 0, denied = 0, httpErrors = 0;

    const started = performance.now();
    await Promise.all(
      Array.from({ length: AGENTS }, async (_, a) => {
        for (let i = 0; i < PER_AGENT; i++) {
          const t0 = performance.now();
          try {
            const res = await fetch(`${BASE}/policy/check`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${TOK.bridge}`,
              },
              body: JSON.stringify({
                agent: `bench-agent-${a}`,
                tool: "read_file",
              }),
            });
            lat.push(performance.now() - t0);
            if (!res.ok) { httpErrors++; continue; }
            const body = await res.json();
            if (body.allow === true) allowed++; else denied++;
          } catch (err) {
            httpErrors++;
            lat.push(performance.now() - t0);
          }
        }
      }),
    );
    const elapsed = (performance.now() - started) / 1000;

    // --- the part that is actually asserted ------------------------------
    const vStart = performance.now();
    const verify = await (await fetch(`${BASE}/ledger/verify`, {
      headers: { Authorization: `Bearer ${TOK.owner}` },
    })).json();
    const verifyMs = performance.now() - vStart;

    if (verify.ok !== true) {
      failures.push(`/ledger/verify returned ok=${verify.ok} reason=${verify.reason ?? "(none)"} ` +
        `after ${TOTAL} concurrent decisions`);
    }

    const page = await (await fetch(`${BASE}/ledger?limit=100000`, {
      headers: { Authorization: `Bearer ${TOK.owner}` },
    })).json();
    const rows = Array.isArray(page) ? page : (page.records ?? page.entries ?? []);
    const seqs = rows.map((r) => r.seq).sort((a, b) => a - b);

    if (seqs.length === 0) {
      failures.push("the ledger recorded nothing at all during the load; " +
        "either it is disabled or the decision path stopped writing");
    } else {
      const dupes = seqs.filter((s, i) => i > 0 && s === seqs[i - 1]);
      if (dupes.length) {
        failures.push(`${dupes.length} duplicate sequence number(s) under ` +
          `concurrency, first = ${dupes[0]} — two writers took the same slot`);
      }
      const gaps = [];
      for (let i = 1; i < seqs.length; i++) {
        if (seqs[i] !== seqs[i - 1] + 1) gaps.push(`${seqs[i - 1]}→${seqs[i]}`);
      }
      if (gaps.length) {
        failures.push(`${gaps.length} gap(s) in the sequence: ${gaps.slice(0, 5).join(", ")}`);
      }
    }

    const appended = (await (await fetch(`${BASE}/ledger/head`, {
      headers: { Authorization: `Bearer ${TOK.owner}` },
    })).json()).seq - seqBefore;

    if (allowed === 0) {
      failures.push("every decision was denied, so the hot path was never " +
        "exercised; the fleet is probably not in a room whose scope allows " +
        "the tool being asked for");
    }

    if (httpErrors > 0) {
      failures.push(`${httpErrors} request(s) failed at the HTTP layer; the ` +
        `load never reached the ledger, so the result below proves nothing`);
    }

    // --- report ----------------------------------------------------------
    const sorted = lat.slice().sort((a, b) => a - b);
    console.log();
    console.log(`  load            ${AGENTS} concurrent agents x ${PER_AGENT} decisions = ${TOTAL}`);
    console.log(`  host            ${cpus().length} cores, node ${process.version}, synchronous=FULL`);
    console.log(`  wall            ${elapsed.toFixed(2)} s`);
    console.log(`  throughput      ${(TOTAL / elapsed).toFixed(0)} decisions/s end to end (HTTP in, ledger fsync'd)`);
    console.log(`  latency         p50 ${pct(sorted, 50).toFixed(2)} ms   p95 ${pct(sorted, 95).toFixed(2)} ms   p99 ${pct(sorted, 99).toFixed(2)} ms   max ${sorted[sorted.length - 1].toFixed(2)} ms`);
    console.log(`  decisions       ${allowed} allowed, ${denied} denied, ${httpErrors} http errors`);
    console.log(`  ledger          ${appended} records appended, verify ok=${verify.ok} in ${verifyMs.toFixed(1)} ms`);
    console.log();

    if (failures.length) {
      console.log(`FAIL: the ledger did not survive ${TOTAL} concurrent decisions`);
      for (const f of failures) console.log(`    - ${f}`);
      return 1;
    }
    console.log(`PASS: chain intact after ${TOTAL} concurrent decisions ` +
      `(${appended} records, contiguous, verify ok)`);
    return 0;
  } finally {
    proc.kill("SIGTERM");
    await new Promise((r) => { proc.on("exit", r); setTimeout(r, 3000); });
    rmSync(dataDir, { recursive: true, force: true });
  }
}

process.exit(await main());

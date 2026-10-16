/**
 * proof.js — GET /proof: the evidence surface.
 *
 * WHY THIS EXISTS
 * ---------------
 * This product's whole claim is "replay is governance": you can show an
 * auditor what happened and prove the record was not edited. The ledger
 * already backs that claim at runtime (`/ledger/verify` recomputes the chain).
 *
 * What nothing could answer was the question an auditor asks second:
 * *is the thing I am looking at the thing you tested?*
 *
 * For several weeks a live instance served a bundle three commits behind the
 * verified tree. Every gate was green, the ledger verified, the UI looked
 * correct — and no surface anywhere could have told you the deployment was
 * stale. That is not a cosmetic gap. A verification that does not bind to the
 * artifact in front of you is a certificate for a different building.
 *
 * So this route reports three things and refuses to blur them:
 *
 *   1. LIVE   — the chain, recomputed now, by the server answering you.
 *   2. RECORDED — the gate results from the last full `verify.sh`, with the
 *      timestamp and commit they belong to. Never presented as "now".
 *   3. BINDING — whether the bundle this server is serving is byte-identical
 *      to the bundle those gates ran against.
 *
 * HONESTY RULES BAKED IN
 * ----------------------
 * - A missing report is reported as missing. It is never rendered as zero
 *   gates or as a failure, because "nobody ran the suite" and "the suite
 *   failed" are different facts and conflating them flatters us in one
 *   direction and slanders us in the other.
 * - `verifiedAt` is always returned alongside gate results so staleness is
 *   visible without arithmetic by the reader.
 * - When the served bundle does not match the verified one, `bundleMatches`
 *   is false and `gates` are still shown — but the caller has what it needs
 *   to say the gates describe a different build. We do not silently hide the
 *   gates, and we do not silently imply they apply.
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";
import express from "express";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REPORT = join(ROOT, "handoff", "VERIFY-REPORT.json");
const DIST_ASSETS = join(ROOT, "frontend", "dist", "assets");

/** Read the recorded verify report, or null when there is none. */
export function readReport(path = REPORT) {
  if (!existsSync(path)) return null;
  try {
    const doc = JSON.parse(readFileSync(path, "utf8"));
    if (!doc || typeof doc !== "object" || !Array.isArray(doc.gates)) return null;
    return doc;
  } catch {
    // A corrupt report is the same as no report for every purpose a caller
    // has. Pretending to parse it would be worse than admitting we cannot.
    return null;
  }
}

/** Fingerprint the bundle this process is actually serving. */
export function servedBundle(dir = DIST_ASSETS) {
  if (!existsSync(dir)) return null;
  const file = readdirSync(dir)
    .filter((f) => /^index-.*\.js$/.test(f))
    .sort()[0];
  if (!file) return null;
  const sha256 = createHash("sha256")
    .update(readFileSync(join(dir, file)))
    .digest("hex");
  return { file, sha256 };
}

/**
 * Build the proof payload.
 *
 * `verify` is injected rather than imported so the ledger stays the caller's
 * concern and this module remains testable without a database.
 */
export function buildProof({ report, served, ledger }) {
  const gatesKnown = report !== null;
  const bundleMatches =
    gatesKnown && report.bundle?.sha256 && served?.sha256
      ? report.bundle.sha256 === served.sha256
      : null; // null = cannot tell, which is not the same as false.

  return {
    ledger,
    verification: gatesKnown
      ? {
          verifiedAt: report.generatedAt ?? null,
          commit: report.commit ?? null,
          branch: report.branch ?? null,
          dirty: report.dirty ?? null,
          gatesGreen: report.gatesGreen ?? null,
          gatesTotal: report.gatesTotal ?? null,
          gates: report.gates,
        }
      : null,
    // Spelled out rather than implied: a consumer that forgets to check
    // `bundleMatches` should still be unable to claim freshness by accident.
    reportMissing: !gatesKnown,
    bundleMatches,
    served: served ? { file: served.file } : null,
    verifiedBundle: gatesKnown ? (report.bundle?.file ?? null) : null,
  };
}


export function createProofRouter({ requireAny, verifyLedger }) {
  const router = express.Router();

  router.get("/", requireAny, (req, res) => {
    let ledger = null;
    try {
      ledger = verifyLedger ? verifyLedger() : null;
    } catch {
      // The ledger being unavailable must not take the gate evidence down
      // with it. Two independent claims, reported independently.
      ledger = null;
    }

    const proof = buildProof({
      report: readReport(),
      served: servedBundle(),
      ledger: ledger
        ? { ok: !!ledger.ok, trustworthy: ledger.trustworthy ?? null,
            records: ledger.checked ?? null }
        : null,
    });

    res.json(proof);
  });

  return router;
}

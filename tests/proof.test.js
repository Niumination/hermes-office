/**
 * proof.test.js — the evidence surface must not flatter us.
 *
 * Most of these tests are about one failure mode: a proof page that implies
 * freshness it cannot support. That is worse than having no proof page,
 * because it converts "we do not know" into "we are fine" at exactly the
 * moment somebody is deciding whether to trust the product.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  readReport, servedBundle, buildProof, redactForGuest,
} from "../server/proof.js";

const tmp = () => mkdtempSync(join(tmpdir(), "proof-"));

const REPORT = {
  generatedAt: "2026-10-12T09:00:00Z",
  commit: "abc123",
  branch: "dev",
  dirty: false,
  gates: [{ gate: "eslint", ok: true }, { gate: "doc claims", ok: true }],
  gatesGreen: 2,
  gatesTotal: 2,
  bundle: { file: "index-AAA.js", sha256: "a".repeat(64) },
};

test("a missing report reads as missing, never as zero gates", () => {
  const dir = tmp();
  assert.equal(readReport(join(dir, "nope.json")), null);

  const proof = buildProof({ report: null, served: null, ledger: null });
  assert.equal(proof.reportMissing, true);
  assert.equal(proof.verification, null);
  // The distinction this asserts: nobody ran the suite is not the same fact
  // as the suite failed, and a 0/0 would read as the latter.
  assert.notDeepEqual(proof.verification, { gatesGreen: 0, gatesTotal: 0 });
  rmSync(dir, { recursive: true, force: true });
});

test("a corrupt report is treated as absent, not parsed optimistically", () => {
  const dir = tmp();
  const p = join(dir, "r.json");
  writeFileSync(p, "{ this is not json");
  assert.equal(readReport(p), null);
  rmSync(dir, { recursive: true, force: true });
});

test("a report without a gates array is rejected", () => {
  const dir = tmp();
  const p = join(dir, "r.json");
  writeFileSync(p, JSON.stringify({ generatedAt: "2026-01-01T00:00:00Z" }));
  assert.equal(readReport(p), null);
  rmSync(dir, { recursive: true, force: true });
});

test("verifiedAt always travels with the gate results", () => {
  const proof = buildProof({ report: REPORT, served: null, ledger: null });
  assert.equal(proof.verification.verifiedAt, "2026-10-12T09:00:00Z");
  assert.equal(proof.verification.gatesGreen, 2);
  // Staleness has to be visible without the reader doing arithmetic on a
  // field we did not send.
  assert.ok(proof.verification.verifiedAt);
});

test("a served bundle matching the verified one reports bundleMatches true", () => {
  const proof = buildProof({
    report: REPORT,
    served: { file: "index-AAA.js", sha256: "a".repeat(64) },
    ledger: null,
  });
  assert.equal(proof.bundleMatches, true);
});

test("a stale deployment is caught: different bundle, gates still shown", () => {
  const proof = buildProof({
    report: REPORT,
    served: { file: "index-OLD.js", sha256: "b".repeat(64) },
    ledger: null,
  });
  assert.equal(proof.bundleMatches, false);
  // The gates are not hidden — they are real results for a real commit. What
  // must be impossible is reading them as applying to what is being served.
  assert.equal(proof.verification.gatesGreen, 2);
  assert.equal(proof.verifiedBundle, "index-AAA.js");
  assert.equal(proof.served.file, "index-OLD.js");
});

test("unknown binding is null, which is not false", () => {
  const proof = buildProof({ report: REPORT, served: null, ledger: null });
  // Same rule as the desks board: `unknown` must never be promoted to a
  // verdict. We could not fingerprint the bundle; that is not a mismatch.
  assert.equal(proof.bundleMatches, null);
  assert.notEqual(proof.bundleMatches, false);
});

test("servedBundle fingerprints the real file and survives an absent dist", () => {
  const dir = tmp();
  assert.equal(servedBundle(join(dir, "missing")), null);

  const assets = join(dir, "assets");
  mkdirSync(assets, { recursive: true });
  writeFileSync(join(assets, "index-ZZZ.js"), "console.log(1)\n");
  const got = servedBundle(assets);
  assert.equal(got.file, "index-ZZZ.js");
  assert.match(got.sha256, /^[0-9a-f]{64}$/);
  rmSync(dir, { recursive: true, force: true });
});

test("guests get the verdict, never the commit, branch or gate names", () => {
  const full = buildProof({
    report: REPORT,
    served: { file: "index-AAA.js", sha256: "a".repeat(64) },
    ledger: { ok: true, trustworthy: true, records: 12 },
  });
  const guest = redactForGuest(full);
  const text = JSON.stringify(guest);

  assert.equal(guest.redacted, true);
  assert.equal(guest.verification.gatesGreen, 2);
  assert.equal(guest.bundleMatches, true);
  for (const leak of ["abc123", "dev", "eslint", "doc claims", "index-AAA.js"]) {
    assert.equal(text.includes(leak), false, `guest payload leaked ${leak}`);
  }
  // Chain health is a yes/no for a guest; record counts are not theirs.
  assert.equal(guest.ledger.ok, true);
  assert.equal("records" in guest.ledger, false);
});

test("a guest told nothing was verified is still told that much", () => {
  const guest = redactForGuest(
    buildProof({ report: null, served: null, ledger: null }));
  assert.equal(guest.reportMissing, true);
  assert.equal(guest.verification, null);
});

test("the ledger failing does not erase the gate evidence", () => {
  const proof = buildProof({
    report: REPORT,
    served: { file: "index-AAA.js", sha256: "a".repeat(64) },
    ledger: null,
  });
  // Two independent claims. One being unavailable must not silently take the
  // other down — that is how a page ends up blank during an incident.
  assert.equal(proof.ledger, null);
  assert.equal(proof.verification.gatesTotal, 2);
});

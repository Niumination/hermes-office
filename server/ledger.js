/**
 * ledger.js — Flight Recorder: an append-only, hash-chained record of every
 * governance decision the office makes.
 *
 * WHY THIS EXISTS
 * ---------------
 * Fase 1–3 built the decision path: OTLP tells us what agents did, burn-rate
 * and the floor plan decide what they may do next. None of it was *recorded*
 * in a form anyone could later defend. The ring buffer holds 7 days in RAM and
 * is gone on restart; that is monitoring, not an audit trail.
 *
 * EU AI Act high-risk obligations have been live since 2 Aug 2026:
 *   - Art. 12(1)  automatic event logging over the system's lifetime.
 *                 Manual record-keeping explicitly does not qualify.
 *   - Art. 19     logs retained at least six months.
 *   - Art. 14     evidence that a human could oversee and interrupt.
 *   - Art. 99(4)  up to EUR 15M or 3% of global turnover.
 *
 * WHAT IS RECORDED, AND WHAT IS DELIBERATELY NOT
 * ----------------------------------------------
 * Only *decisions* and *scope changes* — not the event firehose. A dossier a
 * compliance officer cannot read is worth nothing, and the recurring complaint
 * from practitioners is precisely that they are handed raw I/O logs. So this
 * records the answer to "who was allowed to do what, when, and on whose
 * authority", and nothing else. Prompt and completion content never enters
 * the ledger; it is not needed to reconstruct a decision and it is the part
 * most likely to carry personal data.
 *
 * THREAT MODEL — READ THIS BEFORE CLAIMING "TAMPER-PROOF"
 * -------------------------------------------------------
 * A hash chain is *tamper-evident*, not tamper-proof, and the distinction is
 * the whole ballgame in an audit:
 *
 *   - Editing or reordering any record in place  -> DETECTED. Every subsequent
 *     hash breaks, and verify() names the exact seq.
 *   - Deleting a record from the middle          -> DETECTED. Same mechanism.
 *   - Deleting records off the TAIL              -> *NOT* detected by the chain
 *     alone. A shorter chain is still internally consistent.
 *   - Rewriting the entire file from scratch     -> NOT detected by the chain
 *     alone. An attacker with write access can forge a clean history.
 *
 * The last two are only closed by anchoring the head hash somewhere the
 * attacker does not control. This module therefore exposes head() and writes
 * periodic `chain_checkpoint` records; publishing those externally (a log
 * drain, a git commit, a countersigning service) is what actually makes
 * truncation detectable. docs/FLIGHT-RECORDER.md states this plainly rather
 * than letting a buyer assume more than the cryptography delivers.
 */
import Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const GENESIS_HASH = "0".repeat(64);

/** Record types the dossier knows how to narrate. */
export const LEDGER_TYPES = Object.freeze([
  "chain_opened",
  "policy_decision",
  "approval_requested",
  "approval_resolved",
  "agent_moved",
  "budget_transition",
  "policy_loaded",
  "chain_checkpoint",
  "chain_anchored",
  "chain_truncated",
  "dossier_exported",
]);

/**
 * Deterministic JSON serialization.
 *
 * The chain is only as reliable as this function. If two runs can serialize
 * the same logical record differently, verification fails on honest data and
 * the whole artifact loses credibility — a false alarm in an audit is nearly
 * as damaging as a missed one. Rules:
 *   - object keys sorted by UTF-16 code unit (plain `.sort()`)
 *   - `undefined` members dropped from objects, `null` inside arrays
 *     (matching JSON.stringify, so a hand-check with jq agrees)
 *   - no insignificant whitespace
 *   - NaN / +-Infinity -> null, because they have no JSON form
 *   - cycles throw rather than silently truncating
 */
export function canonicalJson(value, seen = new Set()) {
  if (value === null) return "null";
  const t = typeof value;

  if (t === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
  if (t === "boolean") return value ? "true" : "false";
  if (t === "string") return JSON.stringify(value);
  if (t === "bigint") return JSON.stringify(value.toString());
  if (t === "undefined" || t === "function" || t === "symbol") return undefined;

  if (value instanceof Date) return JSON.stringify(value.toISOString());

  if (seen.has(value)) throw new TypeError("canonicalJson: circular reference");
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const parts = value.map((v) => canonicalJson(v, seen) ?? "null");
      return `[${parts.join(",")}]`;
    }
    const keys = Object.keys(value).sort();
    const parts = [];
    for (const k of keys) {
      const sv = canonicalJson(value[k], seen);
      if (sv !== undefined) parts.push(`${JSON.stringify(k)}:${sv}`);
    }
    return `{${parts.join(",")}}`;
  } finally {
    seen.delete(value);
  }
}

/**
 * The hash covers the record's position and its link to the previous record,
 * not just its contents — otherwise two identical decisions would hash alike
 * and could be swapped without detection.
 */
export function hashRecord({ seq, ts, prevHash, type, actor, payloadJson }) {
  const preimage = canonicalJson({ seq, ts, prevHash, type, actor: actor ?? null }) + "\n" + payloadJson;
  return createHash("sha256").update(preimage, "utf8").digest("hex");
}

export class FlightRecorder {
  /**
   * @param {object} opts
   * @param {string} [opts.dbPath]         explicit file, else <dataDir>/ledger.db
   * @param {string} [opts.dataDir]        directory for the default filename
   * @param {number} [opts.retentionDays]  0 disables pruning
   * @param {number} [opts.checkpointEvery] records between checkpoints
   */
  constructor({ dbPath, dataDir = ".", retentionDays = 400, checkpointEvery = 500, synchronous = "FULL" } = {}) {
    // A separate file from office.db on purpose: the audit log has a different
    // retention rule, a different access rule, and should be archivable (or
    // handed to an auditor) without shipping the chat history with it.
    this.path = dbPath || join(dataDir, "ledger.db");
    this.retentionDays = retentionDays;
    this.checkpointEvery = checkpointEvery;

    this.db = new Database(this.path);
    this.db.pragma("journal_mode = WAL");
    // Durability matters more than throughput here: a decision that was
    // enforced but not recorded is exactly the gap an auditor looks for.
    this.db.pragma(`synchronous = ${/^(OFF|NORMAL|FULL|EXTRA)$/.test(synchronous) ? synchronous : "FULL"}`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ledger (
        seq        INTEGER PRIMARY KEY,
        ts         INTEGER NOT NULL,
        type       TEXT    NOT NULL,
        actor      TEXT,
        subject    TEXT,
        payload    TEXT    NOT NULL,
        prev_hash  TEXT    NOT NULL,
        hash       TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ledger_ts      ON ledger (ts);
      CREATE INDEX IF NOT EXISTS idx_ledger_type    ON ledger (type);
      CREATE INDEX IF NOT EXISTS idx_ledger_subject ON ledger (subject);
    `);

    this._insert = this.db.prepare(
      `INSERT INTO ledger (seq, ts, type, actor, subject, payload, prev_hash, hash)
       VALUES (@seq, @ts, @type, @actor, @subject, @payload, @prevHash, @hash)`
    );
    this._tail = this.db.prepare("SELECT seq, hash FROM ledger ORDER BY seq DESC LIMIT 1");

    const tail = this._tail.get();
    this.seq = tail ? tail.seq : 0;
    this.headHash = tail ? tail.hash : GENESIS_HASH;
    this.sinceCheckpoint = 0;

    if (!tail) {
      // An empty chain and a deleted chain look identical from the outside.
      // Opening with a record means a wiped ledger is at least *visibly* new.
      this.record("chain_opened", {
        openedAt: new Date().toISOString(),
        note: "Chain start. Earlier records, if any existed, are not part of this chain.",
      });
    }
  }

  /**
   * Append one record. Synchronous and immediate by design — buffering writes
   * would create a window where an enforced decision is unrecorded, which is
   * the one failure mode this module exists to prevent.
   *
   * @returns {{seq:number, ts:number, hash:string, prevHash:string}}
   */
  record(type, payload = {}, { actor = null, subject = null, ts = Date.now() } = {}) {
    if (!LEDGER_TYPES.includes(type)) {
      throw new Error(`ledger: unknown record type "${type}"`);
    }
    const seq = this.seq + 1;
    const prevHash = this.headHash;
    const payloadJson = canonicalJson(payload ?? {});
    const hash = hashRecord({ seq, ts, prevHash, type, actor, payloadJson });

    this._insert.run({ seq, ts, type, actor, subject, payload: payloadJson, prevHash, hash });
    this.seq = seq;
    this.headHash = hash;
    this.sinceCheckpoint += 1;

    if (type !== "chain_checkpoint" && this.sinceCheckpoint >= this.checkpointEvery) {
      this.sinceCheckpoint = 0;
      this.checkpoint();
    }
    return { seq, ts, hash, prevHash };
  }

  /**
   * A self-anchor: records the current head inside the chain itself.
   *
   * On its own this proves little — an attacker rewriting the file rewrites
   * the checkpoints too. Its value is that head hashes are small and cheap to
   * copy somewhere else. Export them and truncation becomes detectable.
   */
  checkpoint(note = "periodic") {
    return this.record("chain_checkpoint", {
      note,
      headSeq: this.seq,
      headHash: this.headHash,
      records: this.count(),
    });
  }

  /**
   * One record by sequence number, or null.
   *
   * Added for anchor verification: comparing a published anchor against the
   * chain needs the hash AT a specific seq, not a range scan. Returns the raw
   * row — callers that expose it must redact.
   */
  at(seq) {
    return this.db.prepare("SELECT * FROM ledger WHERE seq = ?").get(seq) ?? null;
  }

  head() {
    return { seq: this.seq, hash: this.headHash, records: this.count() };
  }

  count() {
    return this.db.prepare("SELECT COUNT(*) AS n FROM ledger").get().n;
  }

  /**
   * Walk the chain and recompute every hash.
   *
   * Returns the FIRST break rather than a list: after one broken link every
   * later record is unverifiable anyway, and reporting thousands of
   * consequential failures would bury the actual edit.
   */
  verify({ from = 0, to = Infinity } = {}) {
    const rows = this.db
      .prepare("SELECT * FROM ledger WHERE seq >= ? AND seq <= ? ORDER BY seq ASC")
      .all(from, Number.isFinite(to) ? to : Number.MAX_SAFE_INTEGER);

    if (rows.length === 0) return { ok: true, records: 0, checked: 0, head: this.headHash };

    let prev = null;
    for (const row of rows) {
      if (prev === null) {
        // The first record examined must either start the chain or follow a
        // record we are not looking at; both are legitimate starting points.
        prev = row.prev_hash;
      }
      if (row.prev_hash !== prev) {
        return {
          ok: false,
          brokenAt: row.seq,
          reason: "broken-link",
          detail: `record ${row.seq} claims prev_hash ${row.prev_hash.slice(0, 12)}… but the previous record hashes to ${String(prev).slice(0, 12)}…`,
          records: this.count(),
        };
      }
      const recomputed = hashRecord({
        seq: row.seq,
        ts: row.ts,
        prevHash: row.prev_hash,
        type: row.type,
        actor: row.actor,
        payloadJson: row.payload,
      });
      if (recomputed !== row.hash) {
        return {
          ok: false,
          brokenAt: row.seq,
          reason: "content-altered",
          detail: `record ${row.seq} (${row.type}) does not hash to its stored value — its contents were changed after it was written`,
          records: this.count(),
        };
      }
      prev = row.hash;
    }

    // Gaps are their own failure: a chain can be link-consistent yet missing
    // sequence numbers if rows were deleted and the chain spliced.
    const expected = rows[rows.length - 1].seq - rows[0].seq + 1;
    if (rows.length !== expected) {
      return { ok: false, reason: "sequence-gap", records: this.count(), checked: rows.length };
    }

    return {
      ok: true,
      records: this.count(),
      checked: rows.length,
      firstSeq: rows[0].seq,
      lastSeq: rows[rows.length - 1].seq,
      head: prev,
    };
  }

  query({ from, to, type, subject, limit = 500, offset = 0 } = {}) {
    const where = [];
    const params = {};
    if (from != null) { where.push("ts >= @from"); params.from = from; }
    if (to != null) { where.push("ts <= @to"); params.to = to; }
    if (type) { where.push("type = @type"); params.type = type; }
    if (subject) { where.push("subject = @subject"); params.subject = subject; }
    const sql =
      "SELECT * FROM ledger" +
      (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
      " ORDER BY seq ASC LIMIT @limit OFFSET @offset";
    return this.db
      .prepare(sql)
      .all({ ...params, limit: Math.min(Number(limit) || 500, 5000), offset: Number(offset) || 0 })
      .map((r) => ({
        seq: r.seq,
        ts: r.ts,
        type: r.type,
        actor: r.actor,
        subject: r.subject,
        payload: JSON.parse(r.payload),
        prevHash: r.prev_hash,
        hash: r.hash,
      }));
  }

  /**
   * Retention pruning, chain-aware.
   *
   * Only ever removes a prefix (the oldest records), never from the middle —
   * removing from the middle would break every link after it and make the
   * ledger unverifiable. A `chain_truncated` marker records what was dropped
   * and the hash of the last surviving link, so the remaining chain still
   * verifies and the gap is declared rather than hidden.
   *
   * Default retention is 400 days: Art. 19 requires at least six months, and
   * an annual audit needs to reach back over a full year.
   */
  prune(now = Date.now()) {
    if (!this.retentionDays) return { pruned: 0 };
    const cutoff = now - this.retentionDays * 86_400_000;
    const last = this.db
      .prepare("SELECT seq, hash, ts FROM ledger WHERE ts < ? ORDER BY seq DESC LIMIT 1")
      .get(cutoff);
    if (!last) return { pruned: 0 };
    // Never prune the whole chain: the head must remain to anchor it.
    if (last.seq >= this.seq) return { pruned: 0, note: "refused: would empty the chain" };

    const first = this.db.prepare("SELECT seq, ts FROM ledger ORDER BY seq ASC LIMIT 1").get();
    const info = this.db.prepare("DELETE FROM ledger WHERE seq <= ?").run(last.seq);
    this.record("chain_truncated", {
      reason: "retention",
      retentionDays: this.retentionDays,
      removedSeqFrom: first.seq,
      removedSeqTo: last.seq,
      removedCount: info.changes,
      lastRemovedHash: last.hash,
      coveredFrom: new Date(first.ts).toISOString(),
      coveredTo: new Date(last.ts).toISOString(),
    });
    return { pruned: info.changes, throughSeq: last.seq };
  }

  close() {
    try { this.db.close(); } catch { /* already closed */ }
  }
}

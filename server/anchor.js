/**
 * anchor.js — external anchoring for the flight recorder.
 *
 * WHAT THIS CLOSES
 * ----------------
 * The hash chain in ledger.js detects edits, timestamp changes, reorders and
 * middle-deletes. It cannot detect two things, and FLIGHT-RECORDER.md has
 * said so plainly since Fase 4:
 *
 *   1. TAIL TRUNCATION    — drop the last N records and the remaining chain
 *                           still verifies perfectly. It is a shorter, valid
 *                           chain.
 *   2. WHOLESALE REGEN    — rebuild the entire chain from doctored inputs and
 *                           every hash is internally consistent.
 *
 * Both are unsolvable from inside the file. A chain can only prove its own
 * internal consistency; it cannot prove that a longer version ever existed.
 * The fix is not cryptographic, it is *social*: publish the head hash
 * somewhere the server cannot later reach into and change.
 *
 * Once a head hash {seq: 4120, hash: "9f3a…"} is in someone else's hands, the
 * server can no longer pretend seq 4120 held something different, nor that
 * the chain ended at 4000. It can still lie about the future. It cannot
 * retract what it already published.
 *
 * STRENGTH IS NOT BINARY
 * ----------------------
 * A local anchor file sits on the same disk as the ledger. Someone with root
 * rewrites both. That does NOT make it worthless — it defends against the
 * realistic case (a process or an operator editing ledger.db, an application
 * bug, a partial restore) and it costs nothing. It is simply weaker than a
 * receipt held by a third party, so this module labels the two differently
 * and never lets a local-only setup report itself as strongly anchored.
 *
 *   local   — appended to a JSONL file next to the ledger. Weak.
 *   remote  — POSTed to an operator-configured URL that returned 2xx. Strong,
 *             and only as strong as the independence of that endpoint.
 *
 * NEVER BLOCKS
 * ------------
 * Same rule as the ledger itself: a failure to anchor must never refuse an
 * action or crash a request. An audit feature that can take the product down
 * is an audit feature operators will disable.
 */

import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

/** Outcome of comparing one published anchor against the live chain. */
export const ANCHOR_OK = "ok";
export const ANCHOR_TRUNCATED = "truncated";
export const ANCHOR_DIVERGED = "diverged";

export class AnchorStore {
  /**
   * @param {object} opts
   * @param {string} [opts.filePath]  JSONL anchor log; defaults to <dataDir>/anchors.jsonl
   * @param {string} [opts.dataDir]
   * @param {string[]} [opts.webhooks] URLs that receive {seq, hash, records, ts}
   * @param {number} [opts.timeoutMs]  per-webhook timeout
   * @param {Function} [opts.fetchImpl] injectable for tests
   */
  constructor({ filePath, dataDir = ".", webhooks = [], timeoutMs = 5000, fetchImpl } = {}) {
    // Deliberately NOT inside ledger.db. An anchor stored in the artifact it
    // anchors is a signature on its own forgery.
    this.path = filePath || join(dataDir, "anchors.jsonl");
    this.webhooks = webhooks.filter(Boolean);
    this.timeoutMs = timeoutMs;
    this.fetch = fetchImpl || globalThis.fetch;
    this.lastError = null;

    try {
      mkdirSync(dirname(this.path), { recursive: true });
    } catch {
      /* best effort — publish() reports the real failure */
    }
  }

  /**
   * Append one anchor locally and fan it out to every webhook.
   *
   * Local write happens FIRST and independently: if the network is down we
   * still want the weak anchor. Returns a per-sink report rather than a
   * boolean, because "anchored" with three sinks and two failures is a
   * materially different situation from three successes.
   */
  async publish(head, { note = "periodic" } = {}) {
    const entry = {
      seq: head.seq,
      hash: head.hash,
      records: head.records ?? null,
      ts: Date.now(),
      note,
    };

    const sinks = [];

    try {
      appendFileSync(this.path, JSON.stringify(entry) + "\n", "utf8");
      sinks.push({ sink: "local", target: this.path, ok: true, strength: "local" });
    } catch (err) {
      this.lastError = err.message;
      sinks.push({ sink: "local", target: this.path, ok: false, error: err.message, strength: "local" });
    }

    // Sequential, not Promise.all: these are slow, rare, and a stampede of
    // parallel outbound requests from an audit path is a worse failure mode
    // than taking an extra two seconds once an hour.
    for (const url of this.webhooks) {
      sinks.push(await this._post(url, entry));
    }

    return { entry, sinks, anchored: sinks.some(s => s.ok) };
  }

  /**
   * Local-only anchor, synchronous.
   *
   * Exists for shutdown, which has a hard 5 s budget: awaiting a slow webhook
   * there would turn a graceful exit into a SIGKILL, and a SIGKILL during
   * shutdown is precisely when a chain gets left in an unanchored state.
   * Remote anchoring belongs on the periodic timer, not the exit path.
   */
  publishLocalSync(head, note = "shutdown") {
    const entry = { seq: head.seq, hash: head.hash, records: head.records ?? null, ts: Date.now(), note };
    try {
      appendFileSync(this.path, JSON.stringify(entry) + "\n", "utf8");
      return { entry, ok: true };
    } catch (err) {
      this.lastError = err.message;
      return { entry, ok: false, error: err.message };
    }
  }

  async _post(url, entry) {
    try {
      const res = await this.fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(entry),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      // Only a 2xx counts. A 200-with-error-body is the endpoint's problem,
      // but a 404 recorded as a successful anchor would be a lie told by us.
      const ok = res.status >= 200 && res.status < 300;
      return {
        sink: "webhook",
        target: redactUrl(url),
        ok,
        status: res.status,
        strength: "remote",
        ...(ok ? {} : { error: `HTTP ${res.status}` }),
      };
    } catch (err) {
      this.lastError = err.message;
      return {
        sink: "webhook",
        target: redactUrl(url),
        ok: false,
        error: err.name === "TimeoutError" ? `timeout after ${this.timeoutMs}ms` : err.message,
        strength: "remote",
      };
    }
  }

  /** Every anchor ever written locally, oldest first. Corrupt lines are reported, not thrown. */
  list() {
    if (!existsSync(this.path)) return { anchors: [], malformed: 0 };
    let malformed = 0;
    const anchors = [];
    for (const line of readFileSync(this.path, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const o = JSON.parse(line);
        if (typeof o.seq === "number" && typeof o.hash === "string") anchors.push(o);
        else malformed++;
      } catch {
        malformed++;
      }
    }
    anchors.sort((a, b) => a.seq - b.seq);
    return { anchors, malformed };
  }

  /**
   * Compare every published anchor against the live chain.
   *
   * This is the whole point of the module. Three outcomes per anchor:
   *
   *   ok         the chain still contains that exact hash at that seq
   *   truncated  the chain is now SHORTER than an anchor we published —
   *              records that provably existed are gone
   *   diverged   a record exists at that seq but hashes differently —
   *              the chain was rebuilt, not merely trimmed
   *
   * `diverged` is strictly worse than `truncated` and is reported first.
   */
  verify(recorder) {
    const { anchors, malformed } = this.list();
    if (anchors.length === 0) {
      return {
        ok: true,
        anchors: 0,
        malformed,
        strength: "none",
        note: "No anchors published yet — tail truncation is undetectable until at least one exists.",
      };
    }

    const head = recorder.head();
    const results = [];

    for (const a of anchors) {
      if (a.seq > head.seq) {
        results.push({
          ...a,
          result: ANCHOR_TRUNCATED,
          detail:
            `anchor published seq ${a.seq} but the chain now ends at ${head.seq} — ` +
            `${a.seq - head.seq} record(s) that provably existed are missing`,
        });
        continue;
      }
      const row = recorder.at ? recorder.at(a.seq) : null;
      if (!row) {
        results.push({
          ...a,
          result: ANCHOR_TRUNCATED,
          detail: `anchor published seq ${a.seq} but no record exists at that sequence`,
        });
      } else if (row.hash !== a.hash) {
        results.push({
          ...a,
          result: ANCHOR_DIVERGED,
          detail:
            `anchor published ${a.hash.slice(0, 12)}… at seq ${a.seq}, chain now holds ` +
            `${row.hash.slice(0, 12)}… — the chain was rebuilt, not merely shortened`,
        });
      } else {
        results.push({ ...a, result: ANCHOR_OK });
      }
    }

    const diverged = results.filter(r => r.result === ANCHOR_DIVERGED);
    const truncated = results.filter(r => r.result === ANCHOR_TRUNCATED);
    const failures = [...diverged, ...truncated];

    return {
      ok: failures.length === 0,
      anchors: anchors.length,
      malformed,
      // Honest grading: a thousand local anchors are still only local.
      strength: this.webhooks.length > 0 ? "remote" : "local",
      checked: results.length,
      ...(failures.length ? { failures, firstFailure: failures[0] } : {}),
      highWaterMark: anchors[anchors.length - 1].seq,
    };
  }
}

/** Strip credentials and query strings before a URL reaches a response body or a log. */
export function redactUrl(url) {
  try {
    const u = new URL(url);
    // Query strings are where webhook tokens live (Slack, Discord, generic
    // relays). This value is shown to the owner in /ledger/anchors and would
    // otherwise be one screenshot away from leaking.
    return `${u.protocol}//${u.host}${u.pathname}${u.search ? "?…" : ""}`;
  } catch {
    return "invalid-url";
  }
}

/**
 * Periodic anchoring. Returns a handle with stop().
 *
 * Errors are swallowed on purpose — see the module header. An anchor timer
 * that can crash the process defeats its own purpose.
 */
export function startAnchoring(store, recorder, { intervalMs, onAnchor } = {}) {
  if (!intervalMs || intervalMs <= 0) return { stop() {}, running: false };

  const tick = async () => {
    try {
      const result = await store.publish(recorder.head(), { note: "periodic" });
      if (onAnchor) onAnchor(result);
    } catch (err) {
      console.error("[anchor] publish failed:", err.message);
    }
  };

  const timer = setInterval(tick, intervalMs);
  // Never hold the process open at shutdown.
  if (timer.unref) timer.unref();
  return { stop: () => clearInterval(timer), running: true, intervalMs };
}

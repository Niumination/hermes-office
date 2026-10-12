/**
 * desks.js — external outposts: read-only status for things the office does
 * not run itself (cron jobs, sibling services, batch pipelines).
 *
 * ## Why this exists, and why it is deliberately small
 *
 * UPGRADE-PLAN.md asked for a cron-job fleet view with `@mention` commands
 * that restart services. That second half changes what this product *is*:
 * the office is an authorised observer, and `@mitigasi → systemctl restart`
 * would make it a shell executor — on a service published through a Tailscale
 * Funnel, where "guest" and "anonymous visitor on the internet" are the same
 * principal (docs/SECURITY.md §3).
 *
 * So phase one is observation only. There is no route here that changes
 * anything, anywhere. The threat model is identical to the day before this
 * file existed, and that is the point: the useful half ships now, the
 * dangerous half gets designed properly later.
 *
 * ## Generic, not agroclimate-specific
 *
 * Nothing here knows the word "mitigasi". A desk is declared in a JSON file
 * the owner controls, with one of two probe kinds:
 *
 *   http — GET a URL, optionally require a JSON field to equal a value
 *   file — stat a path; its mtime is the "last run" (the classic cron
 *          touchfile), which needs no cooperation from the job itself
 *
 * `command` is NOT a probe kind. Shelling out is how a monitor becomes an
 * execution path, and config files get edited by people who are not thinking
 * about that.
 *
 * ## Honest states
 *
 *   ok       the probe answered and matched
 *   failed   the probe answered and did not match
 *   stale    it last succeeded longer ago than staleAfterSec
 *   unknown  we could not find out — unreachable, malformed, never run
 *
 * `unknown` is a real state, not a synonym for `failed`. A desk whose probe
 * timed out has not failed; we simply do not know. Rendering that as a red
 * light would be the UI inventing a fact, which this repo does not do.
 */
import { Router } from "express";
import { readFile, stat } from "node:fs/promises";
import { requireAny } from "./auth.js";

export const DESK_OK = "ok";
export const DESK_FAILED = "failed";
export const DESK_STALE = "stale";
export const DESK_UNKNOWN = "unknown";

/** Hard ceilings. Config is owner-authored, but typos should not hang a request. */
const MAX_DESKS = 64;
const MAX_TIMEOUT_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 2_000;
const MAX_BODY_BYTES = 64 * 1024;
const MIN_POLL_MS = 5_000;
const DEFAULT_POLL_MS = 30_000;

const str = (v, max = 120) => (typeof v === "string" ? v.slice(0, max) : "");

/**
 * Parse and clamp a desk config. Invalid desks are dropped with a reason
 * rather than silently skipped, so a typo surfaces instead of a desk quietly
 * never appearing.
 */
export function parseDesks(raw) {
  const problems = [];
  const desks = [];
  const list = Array.isArray(raw?.desks) ? raw.desks : [];

  if (!Array.isArray(raw?.desks)) problems.push("`desks` must be an array");

  for (const [i, d] of list.slice(0, MAX_DESKS).entries()) {
    const id = str(d?.id, 64);
    if (!id) { problems.push(`desk[${i}]: missing id`); continue; }
    if (desks.some((x) => x.id === id)) { problems.push(`desk[${i}]: duplicate id "${id}"`); continue; }

    const kind = str(d?.probe?.kind, 16);
    if (kind !== "http" && kind !== "file") {
      problems.push(`desk "${id}": probe.kind must be "http" or "file"`);
      continue;
    }

    const probe = { kind, timeoutMs: clampTimeout(d?.probe?.timeoutMs) };
    if (kind === "http") {
      const url = str(d?.probe?.url, 2048);
      if (!/^https?:\/\//i.test(url)) {
        problems.push(`desk "${id}": probe.url must be http(s)`);
        continue;
      }
      probe.url = url;
      if (d?.probe?.expectField) {
        probe.expectField = str(d.probe.expectField, 120);
        probe.expectValue = d.probe.expectValue;
      }
    } else {
      const path = str(d?.probe?.path, 4096);
      if (!path) { problems.push(`desk "${id}": probe.path required`); continue; }
      probe.path = path;
    }

    desks.push({
      id,
      label: str(d?.label, 120) || id,
      hall: str(d?.hall, 64) || null,
      note: str(d?.note, 240) || null,
      staleAfterSec: Number.isFinite(d?.staleAfterSec) && d.staleAfterSec > 0
        ? Math.min(Math.floor(d.staleAfterSec), 31_536_000)
        : null,
      probe,
    });
  }

  if (list.length > MAX_DESKS) problems.push(`only the first ${MAX_DESKS} desks are used`);
  return { desks, problems };
}

function clampTimeout(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(Math.floor(n), MAX_TIMEOUT_MS);
}

/** Read a dotted path out of a JSON body without throwing on anything. */
function dig(obj, path) {
  return String(path).split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/**
 * Run one probe. Never throws: an unreachable desk is a result, not an error,
 * and one bad desk must not take down the whole listing.
 */
export async function probeDesk(desk, { fetchImpl = fetch, statImpl = stat, now = Date.now } = {}) {
  const at = now();
  try {
    if (desk.probe.kind === "file") {
      const s = await statImpl(desk.probe.path);
      const lastMs = s.mtimeMs ?? s.mtime?.getTime?.() ?? null;
      return finalise(desk, { state: DESK_OK, lastMs, at });
    }

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), desk.probe.timeoutMs);
    let res;
    try {
      res = await fetchImpl(desk.probe.url, {
        method: "GET",
        signal: ctl.signal,
        redirect: "manual", // a monitor must not be a redirect follower
        headers: { Accept: "application/json, text/plain;q=0.8, */*;q=0.1" },
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      return finalise(desk, { state: DESK_FAILED, at, detail: `HTTP ${res.status}` });
    }

    if (desk.probe.expectField) {
      const text = (await res.text()).slice(0, MAX_BODY_BYTES);
      let body;
      try { body = JSON.parse(text); } catch {
        return finalise(desk, { state: DESK_UNKNOWN, at, detail: "response was not JSON" });
      }
      const got = dig(body, desk.probe.expectField);
      const want = desk.probe.expectValue;
      if (got !== want) {
        return finalise(desk, {
          state: DESK_FAILED, at,
          detail: `${desk.probe.expectField} = ${JSON.stringify(got)}, expected ${JSON.stringify(want)}`,
        });
      }
    }

    return finalise(desk, { state: DESK_OK, lastMs: at, at });
  } catch (err) {
    const detail = err?.name === "AbortError" ? "timed out" : (err?.code || err?.message || "unreachable");
    return finalise(desk, { state: DESK_UNKNOWN, at, detail: String(detail).slice(0, 160) });
  }
}

function finalise(desk, { state, lastMs = null, at, detail = null }) {
  let finalState = state;
  if (state === DESK_OK && desk.staleAfterSec && lastMs != null) {
    const ageSec = Math.max(0, Math.round((at - lastMs) / 1000));
    if (ageSec > desk.staleAfterSec) finalState = DESK_STALE;
  }
  return {
    id: desk.id,
    label: desk.label,
    hall: desk.hall,
    note: desk.note,
    kind: desk.probe.kind,
    state: finalState,
    lastTs: lastMs,
    checkedTs: at,
    detail,
  };
}

/**
 * A guest sees that an outpost exists and whether it is well — never where it
 * lives or what the error said. Internal hostnames and stack-ish detail
 * strings are exactly the kind of thing a public Funnel should not hand out,
 * and `detail` is the field most likely to carry them.
 */
export function redactDesk(d) {
  return {
    id: d.id,
    label: d.label,
    hall: d.hall,
    kind: d.kind,
    state: d.state,
    lastTs: d.lastTs,
    checkedTs: d.checkedTs,
    detail: null,
    redacted: true,
  };
}

/**
 * Poll on the server, not per client. Ten open browsers must not become ten
 * times the probe traffic against someone else's service — that turns a
 * monitor into a load generator (the "WebSocket storm" worry in
 * UPGRADE-PLAN.md §3.1, applied where it actually bites).
 */
export class DeskBoard {
  constructor({ file, pollMs = DEFAULT_POLL_MS, deps = {} } = {}) {
    this.file = file || null;
    this.pollMs = Math.max(Number(pollMs) || DEFAULT_POLL_MS, MIN_POLL_MS);
    this.deps = deps;
    this.desks = [];
    this.problems = [];
    this.results = new Map();
    this.loadedTs = null;
    this.timer = null;
  }

  async load() {
    if (!this.file) { this.desks = []; this.problems = []; return { ok: true, configured: false }; }
    try {
      const text = await (this.deps.readFileImpl ?? readFile)(this.file, "utf8");
      const parsed = parseDesks(JSON.parse(text));
      this.desks = parsed.desks;
      this.problems = parsed.problems;
      this.loadedTs = Date.now();
      return { ok: true, configured: true };
    } catch (err) {
      // A missing file is not an error — most installs have no outposts.
      this.desks = [];
      this.problems = err?.code === "ENOENT" ? [] : [`cannot read desks file: ${err?.message || err}`];
      return { ok: err?.code === "ENOENT", configured: err?.code !== "ENOENT" };
    }
  }

  async refresh() {
    const out = await Promise.all(this.desks.map((d) => probeDesk(d, this.deps)));
    for (const r of out) this.results.set(r.id, r);
    // Drop results for desks removed from config.
    for (const id of [...this.results.keys()]) {
      if (!this.desks.some((d) => d.id === id)) this.results.delete(id);
    }
    return out;
  }

  snapshot() {
    return this.desks.map((d) => this.results.get(d.id) ?? {
      id: d.id, label: d.label, hall: d.hall, note: d.note, kind: d.probe.kind,
      state: DESK_UNKNOWN, lastTs: null, checkedTs: null, detail: "not probed yet",
    });
  }

  start() {
    if (this.timer) return;
    const tick = () => { void this.refresh().catch(() => {}); };
    tick();
    this.timer = setInterval(tick, this.pollMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export function createDesksRouter(board) {
  const r = Router();

  r.get("/", requireAny, (req, res) => {
    const guest = req.identity?.role === "guest";
    const desks = board.snapshot();
    res.json({
      desks: guest ? desks.map(redactDesk) : desks,
      // Config problems are an owner's business; a guest learns nothing from
      // a parse error about a file they cannot see.
      problems: guest ? [] : board.problems,
      pollMs: board.pollMs,
      ts: Date.now(),
    });
  });

  return r;
}

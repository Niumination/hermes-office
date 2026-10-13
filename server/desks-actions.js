/**
 * desks-actions.js — Pos Jaga tahap 2: gated actions on external outposts.
 *
 * Tahap 1 (`desks.js`) could tell you a post is Genting and then do nothing
 * about it. Tahap 2 lets the owner act — which is why every guard below
 * exists. The design decision is in DESAIN-posjaga-tahap2.md; the one-line
 * version:
 *
 *   The office never runs a command anybody typed in the UI. It runs a
 *   *named action the owner declared in a config file*, with argv.
 *
 * That is the difference between a remote shell and a closed list. The damage
 * ceiling is what the owner wrote down while sober.
 *
 * ## Guards, in the order they fire
 *
 *   1. actions[] is optional and defaults to empty — the feature is inert
 *      until configured, exactly like an empty OFFICE_DESKS_FILE.
 *   2. `run` must be an argv array. No shell, so no `;`, `&&`, backtick, or
 *      glob expansion. No interpolation of any kind — once a UI can fill in
 *      part of a command, the closed list stops being closed.
 *   3. `requireOwner` + POST /policy/check, so an action is subject to the
 *      same per-hall budget and approval rules as any other decision, and is
 *      written to the ledger as a chained entry: who, what, where, result.
 *   4. A cooldown (default 60s per action per desk). An alarm that restarts a
 *      service every 30 seconds makes an outage, not a fix.
 *   5. A mandatory timeout (max 60s), killing the process group.
 *
 * No automation. "If Genting then restart" is tahap 3 and needs its own
 * discussion — it puts production in the hands of a timeout heuristic.
 *
 * ## What does NOT come back
 *
 * Raw stdout/stderr never reaches the response. That is the easiest leak path
 * in the product (paths, hostnames, tokens in logs). The caller gets exit
 * code and duration; the full output stays in the owner-only ledger.
 */
import { spawn } from "node:child_process";

/** Hard ceilings, same philosophy as desks.js: config is owner-authored. */
const MAX_ACTIONS_PER_DESK = 16;
const MAX_TIMEOUT_MS = 60_000;
const MIN_COOLDOWN_MS = 5_000;
const MAX_COOLDOWN_MS = 3600_000;
const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_ARG_LEN = 4096;
const MAX_RUN_ARGS = 32;
/** Per-stream cap on captured output. Enough to see a stack trace, not a log file. */
const MAX_CAPTURE_BYTES = 2048;

/** Sub-second resolution: the cooldown is measured against real time. */
const now = () => Date.now();

/**
 * Reject anything that is not a literal argv array. A `string` run would need
 * a shell to mean anything, and a shell is exactly what this file exists to
 * avoid. `${` is refused too, even inside an argv element — interpolation
 * anywhere is a hole waiting for a UI to fill it.
 */
export function parseActions(rawActions, deskId) {
  const problems = [];
  const actions = [];

  if (rawActions == null) return { actions, problems };
  if (!Array.isArray(rawActions)) {
    problems.push(`desk "${deskId}": actions must be an array`);
    return { actions, problems };
  }

  for (const [i, a] of rawActions.slice(0, MAX_ACTIONS_PER_DESK).entries()) {
    const id = typeof a?.id === "string" ? a.id.slice(0, 64) : "";
    if (!id) { problems.push(`desk "${deskId}": action[${i}] missing id`); continue; }
    if (actions.some((x) => x.id === id)) {
      problems.push(`desk "${deskId}": duplicate action id "${id}"`);
      continue;
    }

    if (!Array.isArray(a?.run) || a.run.length === 0) {
      problems.push(`desk "${deskId}": action "${id}" run must be a non-empty argv array, not a shell string`);
      continue;
    }
    if (a.run.length > MAX_RUN_ARGS) {
      problems.push(`desk "${deskId}": action "${id}" has too many args (max ${MAX_RUN_ARGS})`);
      continue;
    }

    const run = a.run.map((v) => {
      if (typeof v !== "string") return null;
      if (v.includes("${")) return null;
      return v.slice(0, MAX_ARG_LEN);
    });
    if (run.some((v) => v === null)) {
      problems.push(`desk "${deskId}": action "${id}" run must be strings with no \${} interpolation`);
      continue;
    }

    const timeoutMs = clampNumber(a?.timeoutMs, MAX_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const cooldownMs = clampNumber(a?.cooldownMs, DEFAULT_COOLDOWN_MS, MAX_COOLDOWN_MS, MIN_COOLDOWN_MS);

    actions.push({
      id,
      label: typeof a?.label === "string" ? a.label.slice(0, 120) || id : id,
      run,
      timeoutMs,
      cooldownMs,
      confirm: a?.confirm !== false, // default true — an action is opt-in twice
    });
  }

  if (rawActions.length > MAX_ACTIONS_PER_DESK) {
    problems.push(`desk "${deskId}": only the first ${MAX_ACTIONS_PER_DESK} actions are used`);
  }
  return { actions, problems };
}

function clampNumber(v, def, max, min = 1) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.max(Math.floor(n), min), max);
}

/**
 * Run one action. Never throws; the caller decides what to do with a failure
 * that is not a crash.
 *
 * Spawned without a shell, detached so the process group dies with the
 * timeout — a child that ignores SIGTERM must not outlive the desk that
 * asked for it. Output is captured but only its exit code and duration are
 * returned to the caller; the bytes themselves are the caller's to log.
 */
export function runAction(action, { spawnImpl = spawn, nowImpl = now } = {}) {
  return new Promise((resolve) => {
    const startedAt = nowImpl();
    let exited = false;

    // Keep the TAIL of each stream, bounded. The pipes must be drained
    // regardless — a full pipe blocks a chatty child past its own timeout —
    // so the only question is whether we throw the bytes away or keep the
    // last few KB. We keep them: an operator debugging a failed action at 3am
    // with nothing but "exit 1" is a support ticket we wrote ourselves.
    //
    // The tail, not the head: a process that fails says why on its way out.
    //
    // These bytes go to the ledger and NOWHERE else. They are never in the
    // HTTP response (see the router), and `narrate()` in dossier.js withholds
    // them from the exported dossier — that file is written to be handed to
    // an outsider, and command output is the likeliest place for a path,
    // hostname, or token to be sitting.
    const cap = { stdout: [], stderr: [] };
    const capLen = { stdout: 0, stderr: 0 };
    const keep = (name) => (chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
      cap[name].push(buf);
      capLen[name] += buf.length;
      while (capLen[name] > MAX_CAPTURE_BYTES && cap[name].length > 1) {
        capLen[name] -= cap[name].shift().length;
      }
    };

    const tail = (name) =>
      Buffer.concat(cap[name]).toString("utf8").slice(-MAX_CAPTURE_BYTES) || null;

    const finish = (ok, exitCode, ms, error = null) => {
      if (exited) return;
      exited = true;
      resolve({ ok, exitCode, ms, error, stdoutTail: tail("stdout"), stderrTail: tail("stderr") });
    };

    let child;
    try {
      child = spawnImpl(action.run[0], action.run.slice(1), {
        shell: false,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      finish(false, null, nowImpl() - startedAt, String(err?.message || err).slice(0, 160));
      return;
    }

    child.stdout?.on("data", keep("stdout"));
    child.stderr?.on("data", keep("stderr"));


    const timer = setTimeout(() => {
      try {
        if (child.pid != null) process.kill(-child.pid, "SIGKILL");
      } catch { /* already gone, or the group never formed */ }
      finish(false, null, nowImpl() - startedAt, `timed out after ${action.timeoutMs} ms`);
    }, action.timeoutMs);

    child.on("error", (err) => {
      clearTimeout(timer);
      finish(false, null, nowImpl() - startedAt, String(err?.message || err).slice(0, 160));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      finish(code === 0, code, nowImpl() - startedAt);
    });
  });
}

/**
 * Per-action-per-desk cooldown. Returns the ms remaining if the action ran
 * too recently, else 0 and records the run.
 */
export function cooldownRemaining(state, deskId, actionId, { nowImpl = now } = {}) {
  const key = `${deskId}::${actionId}`;
  const last = state?.lastRun?.get?.(key);
  if (last == null) return 0;
  const desk = state?.actions?.get?.(deskId);
  const action = desk?.find?.((a) => a.id === actionId);
  const cd = action?.cooldownMs ?? DEFAULT_COOLDOWN_MS;
  const elapsed = nowImpl() - last;
  return elapsed >= cd ? 0 : cd - elapsed;
}

/**
 * Attach parsed actions to a DeskBoard's desks, returning a lookup the router
 * uses. Problems are reported the same way parseDesks reports them — a typo
 * surfaces, it does not silently disable an action.
 */
export function indexActions(desks, actionsByDesk) {
  const index = new Map();
  for (const desk of desks) {
    const parsed = actionsByDesk.get(desk.id);
    if (parsed) {
      index.set(desk.id, { actions: parsed.actions });
      desk._actionProblems = parsed.problems;
    }
  }
  return index;
}

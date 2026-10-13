/**
 * Tahap 2 tests — the guards are the feature.
 *
 * Every test below is a guard that must hold, not a happy path. The design
 * (DESAIN-posjaga-tahap2.md) says the office may run *named, owner-declared*
 * actions only; each test is one way that constraint could fail.
 */
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { parseActions, runAction, cooldownRemaining } from "../server/desks-actions.js";

const deskId = "alert-check";

describe("parseActions — the closed list stays closed", () => {
  test("a valid argv action parses with defaults", () => {
    const { actions, problems } = parseActions(
      [{ id: "restart", label: "Mulai ulang", run: ["systemctl", "restart", "x.service"] }],
      deskId,
    );
    assert.deepEqual(problems, []);
    assert.equal(actions.length, 1);
    assert.deepEqual(actions[0].run, ["systemctl", "restart", "x.service"]);
    assert.equal(actions[0].timeoutMs, 60_000); // clamped to the max
    assert.equal(actions[0].cooldownMs, 60_000); // default
    assert.equal(actions[0].confirm, true); // opt-in twice by default
  });

  test("a string run is refused — no shell, ever", () => {
    const { actions, problems } = parseActions(
      [{ id: "restart", run: "systemctl restart x.service" }],
      deskId,
    );
    assert.deepEqual(actions, []);
    assert.ok(problems[0].includes("argv array"));
  });

  test("${} interpolation is refused even inside an argv element", () => {
    const { actions, problems } = parseActions(
      [{ id: "touch", run: ["touch", "/tmp/${DATE}"] }],
      deskId,
    );
    assert.deepEqual(actions, []);
    assert.ok(problems[0].includes("${"));
  });

  test("a non-string argv element is refused", () => {
    const { actions, problems } = parseActions(
      [{ id: "bad", run: ["echo", 42] }],
      deskId,
    );
    assert.deepEqual(actions, []);
    assert.ok(problems.length > 0);
  });

  test("missing or duplicate action ids are reported, not silently dropped", () => {
    const { problems: p1 } = parseActions([{ run: ["echo"] }], deskId);
    assert.equal(p1.some((p) => p.includes("missing id")), true);

    const { problems: p2 } = parseActions(
      [{ id: "a", run: ["true"] }, { id: "a", run: ["true"] }],
      deskId,
    );
    assert.equal(p2.some((p) => p.includes("duplicate")), true);
  });

  test("an absurd timeout is clamped to 60s, not honoured", () => {
    const { actions } = parseActions(
      [{ id: "slow", run: ["sleep"], timeoutMs: 99_999_999 }],
      deskId,
    );
    assert.equal(actions[0].timeoutMs, 60_000);
  });

  test("an absurd cooldown is clamped, and 0/negative falls back to the default", () => {
    const { actions: big } = parseActions(
      [{ id: "a", run: ["true"], cooldownMs: 99_999_999 }], deskId,
    );
    assert.equal(big[0].cooldownMs, 3_600_000);

    const { actions: zero } = parseActions(
      [{ id: "a", run: ["true"], cooldownMs: 0 }], deskId,
    );
    assert.equal(zero[0].cooldownMs, 60_000);
  });

  test("confirm can be opted out of, but not silently", () => {
    const { actions } = parseActions([{ id: "a", run: ["true"], confirm: false }], deskId);
    assert.equal(actions[0].confirm, false);
  });

  test("absent actions is inert, not an error", () => {
    const { actions, problems } = parseActions(null, deskId);
    assert.deepEqual(actions, []);
    assert.deepEqual(problems, []);
  });

  test("only the first 16 actions are used", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, run: ["true"] }));
    const { actions, problems } = parseActions(many, deskId);
    assert.equal(actions.length, 16);
    assert.equal(problems.some((p) => p.includes("only the first")), true);
  });
});

describe("runAction — measured, not forwarded", () => {
  test("exit 0 is ok and reports duration", async () => {
    const r = await runAction({ run: ["true"], timeoutMs: 5_000 });
    assert.equal(r.ok, true);
    assert.equal(r.exitCode, 0);
    assert.ok(r.ms >= 0);
  });

  test("non-zero exit is not ok, and the code is returned", async () => {
    const r = await runAction({ run: ["false"], timeoutMs: 5_000 });
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 1);
  });

  test("a missing binary fails cleanly instead of throwing", async () => {
    const r = await runAction({ run: ["definitely-not-a-real-binary-xyz"], timeoutMs: 5_000 });
    assert.equal(r.ok, false);
    assert.ok(r.error);
  });

  test("a hanging child is killed at the timeout", async () => {
    const r = await runAction({ run: ["sleep", "30"], timeoutMs: 300 });
    assert.equal(r.ok, false);
    assert.ok(r.error.includes("timed out"));
    // The process group must die with it, not just the parent promise.
    assert.ok(r.ms < 20_000);
  });

  /**
   * This test used to assert that runAction's result contained no output at
   * all. That stopped being true on purpose: output is now captured so the
   * ledger can hold it, because "exit 1" and nothing else is not a debuggable
   * record of what the office did on the owner's behalf.
   *
   * The guarantee did not disappear — it moved to where it can actually be
   * enforced. runAction hands the bytes to its caller; the ROUTER is what
   * refuses to put them in an HTTP response, and dossier.narrate() is what
   * refuses to put them in the exported file. Both are tested:
   * tests/desks-router.test.js, "the response body never carries stdout or
   * stderr" and "captured output is withheld from the export".
   *
   * So what is left to assert here is the narrower, still-vital claim: the
   * error string itself must not smuggle output out through the back door.
   */
  test("output is captured for the ledger, but never folded into the error string", async () => {
    const r = await runAction({ run: ["sh", "-c", "echo SECRET-LEAK >&2; exit 3"], timeoutMs: 5_000 });
    assert.equal(r.ok, false);
    assert.equal(r.exitCode, 3);
    assert.equal(r.error, null, "a non-zero exit is not an error message");
    assert.match(r.stderrTail, /SECRET-LEAK/, "the tail is captured deliberately");
    assert.equal(r.stdoutTail, null);
  });
});

describe("cooldownRemaining — an alarm must not become an outage", () => {
  const state = () => ({
    lastRun: new Map([["alert-check::restart", 1_000_000]]),
    actions: new Map([["alert-check", [{ id: "restart", cooldownMs: 60_000 }]]]),
  });

  test("0 within the window is not 0 remaining", () => {
    assert.equal(
      cooldownRemaining(state(), deskId, "restart", { nowImpl: () => 1_000_000 + 10_000 }),
      50_000);
  });

  test("after the window, the remaining is 0", () => {
    assert.equal(
      cooldownRemaining(state(), deskId, "restart", { nowImpl: () => 1_000_000 + 61_000 }),
      0);
  });

  test("an action that never ran has no cooldown", () => {
    assert.equal(cooldownRemaining(state(), deskId, "never"), 0);
  });
});

describe("captured output — bounded, tail-biased, ledger-only", () => {
  const act = (run, extra = {}) => ({ id: "x", run, timeoutMs: 5000, cooldownMs: 1000, ...extra });

  test("stdout and stderr tails are captured", async () => {
    const r = await runAction(act(["node", "-e", "console.log('halo-stdout');console.error('halo-stderr')"]));
    assert.equal(r.ok, true);
    assert.match(r.stdoutTail, /halo-stdout/);
    assert.match(r.stderrTail, /halo-stderr/);
  });

  test("a chatty child is capped, and we keep the END not the beginning", async () => {
    // A process that fails says why on its way out, so the tail is the part
    // worth keeping. It also must not be able to grow the ledger without
    // bound by printing a lot.
    const r = await runAction(act([
      "node", "-e",
      "for (let i = 0; i < 5000; i++) console.log('x'.repeat(40)); console.log('PENANDA-AKHIR')",
    ]));
    assert.ok(r.stdoutTail.length <= 2048, `tail was ${r.stdoutTail.length} bytes`);
    assert.match(r.stdoutTail, /PENANDA-AKHIR/, "the end of the output is what survives");
  });

  test("silent output is null, not an empty string", async () => {
    const r = await runAction(act(["true"]));
    assert.equal(r.stdoutTail, null);
    assert.equal(r.stderrTail, null);
  });

  test("a spawn that throws still resolves, with null tails", async () => {
    const r = await runAction(act(["/tidak/ada/biner-ini"]));
    assert.equal(r.ok, false);
    assert.equal(r.stdoutTail, null);
  });
});

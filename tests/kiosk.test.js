/**
 * kiosk.test.js — wall-display status page (Fase 13).
 *
 * The tests that matter here are the redaction ones and the escaping one.
 * This page is the only place in the product that renders telemetry-supplied
 * strings as raw markup, and it is the only view designed to be read by
 * people who were never authenticated.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { kioskModel, renderKiosk, esc, KIOSK_REFRESH_MS } from "../server/kiosk.js";

// ---------------------------------------------------------------------------
// The clock is pinned, and the pin is checked.
//
// renderKiosk stamps Date.now() into the page as `data-at` so the browser can
// show how stale the wall display is. The redaction tests below sweep the
// WHOLE document for forbidden substrings — deliberately, because a leak
// through a title attribute would slip past field-by-field assertions.
//
// Those two good decisions collide. A 13-digit epoch contains arbitrary
// 3-digit runs, so the lifetime-spend needle "412" matched the clock in about
// 1% of renders: roughly 20 minutes of red CI per day, in one-second windows
// ~16 minutes apart, red for everyone running in that window and green again
// by the time they re-ran. A suite that fails on the clock teaches people to
// press re-run until it passes, which is exactly how a real redaction leak
// gets waved through.
//
// So every model below is built at a fixed instant, and REDACTED_NEEDLES
// lists the bare-digit strings the sweeps forbid. The fixture test asserts
// none of them occurs in the timestamp — change NOW, or add a numeric needle
// that collides, and it fails on the first run instead of once a fortnight.
const NOW = 1700000000000;
const REDACTED_NEEDLES = ["412"];

const policy = {
  rooms: [
    { room: "lobby", label: "Lobby", trust: 0, state: "idle", occupants: [] },
    { room: "main-office", label: "Main Office", trust: 2, state: "active",
      occupants: [{ agent: "zara" }, { agent: "ana" }] },
    { room: "server-room", label: "Server Room", trust: 3, state: "active",
      occupants: [{ agent: "budi" }] },
  ],
  pendingApprovals: [{ id: "ap-1" }],
};

const burnFull = {
  global: { state: "hot", ratio: 0.82, spentHourUsd: 1.64, limitHourUsd: 2, spentDayUsd: 9.1, lifetimeUsd: 412 },
  agents: [{ agent: "ana", state: "warm", spentHourUsd: 0.9 }],
};

const burnGuest = { global: { state: "hot", ratio: 0.82 } };

// ---------------------------------------------------------------------------
describe("redaction — the wall is a public surface", () => {
  test("no dollars in the model without reveal", () => {
    const m = kioskModel({ now: NOW, policy, burn: burnGuest });
    assert.equal(m.burn.spentHourUsd, null);
    assert.equal(m.burn.limitHourUsd, null);
    assert.equal(m.reveal, false);
  });

  test("no dollar sign anywhere in the rendered page without reveal", () => {
    // A field-by-field assertion misses a leak through a title attribute or
    // a stray interpolation, so sweep the whole document.
    const html = renderKiosk(kioskModel({ now: NOW, policy, burn: burnGuest }));
    assert.ok(!html.includes("$"), "rendered kiosk must contain no dollar figures");
  });

  test("a full burn snapshot still yields nothing without reveal", () => {
    // The guard must live in the model, not in the caller. If someone later
    // passes the unredacted snapshot by mistake, nothing may leak.
    const m = kioskModel({ now: NOW, policy, burn: burnFull, reveal: false });
    assert.equal(m.burn.spentHourUsd, null);
    assert.ok(!renderKiosk(m).includes("1.64"));
  });

  test("ratio DOES survive — it is a temperature, not a sum", () => {
    const m = kioskModel({ now: NOW, policy, burn: burnGuest });
    assert.equal(m.burn.ratio, 0.82);
    assert.match(renderKiosk(m), /82% dari anggaran/);
  });

  test("reveal shows dollars when explicitly asked", () => {
    const m = kioskModel({ now: NOW, policy, burn: burnFull, reveal: true });
    assert.equal(m.burn.spentHourUsd, 1.64);
    const html = renderKiosk(m);
    assert.match(html, /\$1\.64/);
    assert.match(html, /\$2\.00/);
  });

  test("reveal never exposes day or lifetime spend", () => {
    // Hourly is the operational number. Lifetime spend on a wall is a
    // business metric nobody asked to publish.
    const html = renderKiosk(kioskModel({ now: NOW, policy, burn: burnFull, reveal: true }));
    assert.ok(!html.includes("412"));
    assert.ok(!html.includes("9.1"));
  });

  test("per-agent burn states never reach the page", () => {
    const html = renderKiosk(kioskModel({ now: NOW, policy, burn: burnFull, reveal: true }));
    assert.ok(!html.includes("0.9"), "per-agent spend must not appear");
  });
});

// ---------------------------------------------------------------------------
describe("escaping — agent names are attacker-influenced", () => {
  test("a script tag in an agent name is neutralised", () => {
    const hostile = {
      rooms: [{ room: "r", label: "R", trust: 1,
                occupants: [{ agent: '<script>alert(1)</script>' }] }],
      pendingApprovals: [],
    };
    const html = renderKiosk(kioskModel({ now: NOW, policy: hostile, burn: burnGuest }));

    assert.ok(!html.includes("<script>alert(1)</script>"));
    assert.match(html, /&lt;script&gt;/);
  });

  test("a hostile room label cannot break out of an attribute", () => {
    const hostile = {
      rooms: [{ room: "r", label: '" onload="alert(1)', trust: 1, occupants: [{ agent: "a" }] }],
      pendingApprovals: [],
    };
    const html = renderKiosk(kioskModel({ now: NOW, policy: hostile, burn: burnGuest }));
    assert.ok(!html.includes('onload="alert(1)"'));
    assert.match(html, /&quot; onload=/);
  });

  test("esc handles every dangerous character", () => {
    assert.equal(esc(`<>&"'`), "&lt;&gt;&amp;&quot;&#39;");
  });

  test("esc turns null and undefined into empty, not the literal word", () => {
    assert.equal(esc(null), "");
    assert.equal(esc(undefined), "");
  });

  test("the burn state lands in an attribute safely", () => {
    const m = kioskModel({ now: NOW, policy, burn: { global: { state: '"><img src=x>' } } });
    const html = renderKiosk(m);
    assert.ok(!html.includes('"><img src=x>'));
  });
});

// ---------------------------------------------------------------------------
describe("model", () => {
  test("busiest rooms come first, ties broken by name", () => {
    const m = kioskModel({ now: NOW, policy, burn: burnGuest });
    assert.deepEqual(m.rooms.map(r => r.room), ["main-office", "server-room", "lobby"]);
  });

  test("occupants are sorted, not insertion-ordered", () => {
    const m = kioskModel({ now: NOW, policy, burn: burnGuest });
    assert.deepEqual(m.rooms[0].occupants, ["ana", "zara"]);
  });

  test("counts agents, occupied rooms and pending approvals", () => {
    const m = kioskModel({ now: NOW, policy, burn: burnGuest });
    assert.equal(m.totals.agents, 3);
    assert.equal(m.totals.rooms, 3);
    assert.equal(m.totals.occupiedRooms, 2);
    assert.equal(m.totals.pendingApprovals, 1);
  });

  test("an unknown burn state falls back to normal instead of rendering blank", () => {
    const m = kioskModel({ now: NOW, policy, burn: { global: { state: "catastrophic" } } });
    assert.equal(m.burn.label, "NORMAL");
    assert.ok(m.burn.accent);
  });

  test("empty input produces an empty but valid page", () => {
    const m = kioskModel({ now: NOW, policy: {}, burn: {} });
    assert.deepEqual(m.rooms, []);
    assert.equal(m.totals.agents, 0);
    assert.match(renderKiosk(m), /<!doctype html>/);
  });

  test("occupants without a name are dropped, not rendered as blanks", () => {
    const m = kioskModel({ now: NOW,
      policy: { rooms: [{ room: "r", occupants: [{ agent: "a" }, {}, { agent: null }] }] },
      burn: burnGuest,
    });
    assert.deepEqual(m.rooms[0].occupants, ["a"]);
  });

  test("a room with no label falls back to its id", () => {
    const m = kioskModel({ now: NOW, policy: { rooms: [{ room: "nap-room", occupants: [] }] }, burn: burnGuest });
    assert.equal(m.rooms[0].label, "nap-room");
  });
});

// ---------------------------------------------------------------------------
describe("rendering", () => {
  test("loads no external resources at all", () => {
    // The page must survive an asset-pipeline change, an offline wall
    // machine, and the sandboxed preview, which blocks the network entirely.
    const html = renderKiosk(kioskModel({ now: NOW, policy, burn: burnGuest }));
    assert.ok(!/<link\b/i.test(html), "no stylesheet links");
    assert.ok(!/src=["']https?:/i.test(html), "no remote scripts or images");
    assert.ok(!/@import/.test(html), "no CSS imports");
    assert.ok(!/fonts\./.test(html), "no web fonts");
  });

  test("ships a noscript meta refresh so a JS failure still updates the wall", () => {
    const html = renderKiosk(kioskModel({ now: NOW, policy, burn: burnGuest }));
    assert.match(html, /<noscript><meta http-equiv="refresh" content="15">/);
  });

  test("server-renders the rooms, so first paint is correct without JS", () => {
    const html = renderKiosk(kioskModel({ now: NOW, policy, burn: burnGuest }));
    assert.match(html, /Main Office/);
    assert.match(html, /budi/);
  });

  test("marks the data timestamp so the client can show staleness", () => {
    const html = renderKiosk(kioskModel({ policy, burn: burnGuest, now: NOW }));
    assert.match(html, new RegExp(`data-at="${NOW}"`));
  });

  test("declares a disconnected state for the stale path", () => {
    const html = renderKiosk(kioskModel({ now: NOW, policy, burn: burnGuest }));
    assert.match(html, /TERPUTUS/);
  });

  test("honours prefers-reduced-motion", () => {
    assert.match(renderKiosk(kioskModel({ now: NOW, policy, burn: burnGuest })),
                 /prefers-reduced-motion:reduce/);
  });

  test("is deterministic for the same model", () => {
    // A deliberately different instant: determinism must hold for any model,
    // not only the pinned one.
    const m = kioskModel({ policy, burn: burnGuest, now: 1 });
    assert.equal(renderKiosk(m), renderKiosk(m));
  });

  test("burn state drives the body attribute and the palette", () => {
    const hot = renderKiosk(kioskModel({ now: NOW, policy, burn: burnGuest }));
    const calm = renderKiosk(kioskModel({ now: NOW, policy, burn: { global: { state: "normal" } } }));

    assert.match(hot, /data-burn="hot"/);
    assert.match(calm, /data-burn="normal"/);
    assert.notEqual(hot.match(/background:#\w+/)[0], calm.match(/background:#\w+/)[0]);
  });

  test("caps the occupant list and says how many were hidden", () => {
    const crowd = {
      rooms: [{ room: "r", label: "R", occupants: Array.from({ length: 9 }, (_, i) => ({ agent: `a${i}` })) }],
      pendingApprovals: [],
    };
    const html = renderKiosk(kioskModel({ now: NOW, policy: crowd, burn: burnGuest }));
    assert.match(html, /\+3 lagi/);
  });

  test("hides the approval count when there are none", () => {
    const html = renderKiosk(kioskModel({ now: NOW, policy: { rooms: [], pendingApprovals: [] }, burn: burnGuest }));
    assert.ok(!html.includes("menunggu persetujuan"));
  });

  test("omits the ratio bar when no ratio is known", () => {
    const html = renderKiosk(kioskModel({ now: NOW, policy, burn: { global: { state: "normal" } } }));
    assert.ok(!html.includes("dari anggaran per jam"));
  });

  test("clamps a nonsense ratio into the bar instead of overflowing it", () => {
    const over = renderKiosk(kioskModel({ now: NOW, policy, burn: { global: { state: "tripped", ratio: 3.4 } } }));
    const under = renderKiosk(kioskModel({ now: NOW, policy, burn: { global: { state: "normal", ratio: -1 } } }));
    assert.match(over, /width:100%/);
    assert.match(under, /width:0%/);
  });

  test("the refresh interval is a sane wall-display cadence", () => {
    // Too fast and a 24/7 screen hammers the server; too slow and it lies.
    assert.ok(KIOSK_REFRESH_MS >= 5_000 && KIOSK_REFRESH_MS <= 60_000);
  });
});


// ---------------------------------------------------------------------------
describe("the wall-display failure modes that only show up in the field", () => {
  test("a crowded room still renders every other room", () => {
    // Regression guard: an early layout capped the grid and silently dropped
    // rooms past the cap, which on a wall reads as rooms that do not exist.
    const many = {
      rooms: Array.from({ length: 12 }, (_, i) => ({
        room: `r${i}`, label: `Room ${i}`, occupants: i % 2 ? [{ agent: `a${i}` }] : [],
      })),
      pendingApprovals: [],
    };
    const html = renderKiosk(kioskModel({ now: NOW, policy: many, burn: burnGuest }));
    for (let i = 0; i < 12; i++) assert.ok(html.includes(`Room ${i}`), `Room ${i} missing`);
  });

  test("an empty office renders as an empty office, not as an error", () => {
    // Nights and weekends are the majority of a wall display's life.
    const html = renderKiosk(kioskModel({ now: NOW,
      policy: { rooms: [{ room: "lobby", label: "Lobby", occupants: [] }], pendingApprovals: [] },
      burn: { global: { state: "normal", ratio: 0 } },
    }));
    assert.match(html, /Lobby/);
    assert.match(html, /0 agent/);
    assert.ok(!html.includes("undefined"));
  });

  test("no 'undefined' or 'null' ever reaches the screen", () => {
    // The single most common wall-display embarrassment.
    const sparse = { rooms: [{ room: "x" }], pendingApprovals: undefined };
    const html = renderKiosk(kioskModel({ now: NOW, policy: sparse, burn: {} }));
    assert.ok(!/>undefined</.test(html));
    assert.ok(!/>null</.test(html));
    assert.ok(!/NaN/.test(html));
  });
});

// ---------------------------------------------------------------------------
describe("fixture integrity", () => {
  test("the pinned clock cannot collide with a redaction needle", () => {
    // Without this, the collision is invisible: the suite is green on the
    // day you add the needle and red on a day nobody changed anything.
    for (const needle of REDACTED_NEEDLES) {
      assert.ok(
        !String(NOW).includes(needle),
        `pinned clock ${NOW} contains the redacted value ${needle} — the ` +
        `document sweep would fail for reasons that have nothing to do ` +
        `with redaction`,
      );
    }
  });
});

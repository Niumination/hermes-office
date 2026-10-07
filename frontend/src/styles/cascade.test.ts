import { describe, it, expect, afterEach } from "vitest";
import officeCss from "./office.css?raw";
import roomsCss from "./rooms.css?raw";
import hermesCss from "./hermes.css?raw";
import donghuaCss from "./donghua.css?raw";

/**
 * Cascade tests — the guard that let the `!important` flags come out.
 *
 * donghua.css restyles panels that office.css already styled. The original
 * implementation reached for `!important` on every declaration, which works
 * but poisons the layer: a customer re-skinning the product (the whole point
 * of a theme file) then has to escalate to `!important` themselves, and the
 * next person has nowhere left to go.
 *
 * It turned out the flags were never needed. donghua.css is imported last and
 * the selectors have equal specificity, so plain source order already wins.
 * "Already wins" is not something to assert in a comment and hope about, so
 * it is asserted here instead.
 *
 * HOW THIS IS MEASURED
 * --------------------
 * vitest already runs in a jsdom environment, so this uses the real document
 * rather than constructing one — no node builtins, which keeps the file
 * inside the browser tsconfig the rest of the frontend compiles under.
 *
 * jsdom does not resolve `var()`: `background: var(--dh-panel)` computes to
 * transparent rather than the token's value. So this does not check that the
 * panel is the right colour; it checks that the value CHANGED when the theme
 * layer was added. The same element is measured twice, once with the base
 * sheets and once with the theme on top.
 *
 * That is a weaker claim than "it looks right" and it is the honest one: a
 * unit test cannot see. What it does prove is the thing that would silently
 * regress — that the theme still reaches the element at all.
 *
 * Note also that jsdom ignores `@media`, so the one surviving `!important`
 * (the `prefers-reduced-motion` override) cannot be covered here.
 */

// Import order from HermesOfficeApp.tsx. If that order changes this breaks,
// which is correct: the order IS the mechanism.
const BASE = [officeCss, roomsCss, hermesCss];

function mount(sheets: string[], className: string, attrs: Record<string, string> = {}) {
  for (const css of sheets) {
    const el = document.createElement("style");
    el.textContent = css;
    document.head.appendChild(el);
  }
  const div = document.createElement("div");
  div.className = className;
  for (const [k, v] of Object.entries(attrs)) div.setAttribute(k, v);
  document.body.appendChild(div);
  const cs = getComputedStyle(div);
  // Snapshot now: the nodes are torn down between cases.
  return {
    backgroundColor: cs.backgroundColor,
    borderTopLeftRadius: cs.borderTopLeftRadius,
    boxShadow: cs.boxShadow,
    borderTopColor: cs.borderTopColor,
  };
}

afterEach(() => {
  document.head.innerHTML = "";
  document.body.innerHTML = "";
});

const THEMED_PANELS = [
  "burn-hud",
  "approval-gate",
  "audit-panel",
  "audit-chip",
  "agents-panel",
  "chat-panel",
  "github-feed",
];

describe("the theme layer wins without !important", () => {
  for (const cls of THEMED_PANELS) {
    it(`.${cls} is restyled by donghua.css through plain source order`, () => {
      const before = mount(BASE, cls);
      document.head.innerHTML = "";
      document.body.innerHTML = "";
      const after = mount([...BASE, donghuaCss], cls);

      // At least one of the chrome properties the theme sets must have moved.
      // Checking "something changed" rather than a specific value keeps this
      // from breaking every time a token is retuned.
      const moved =
        before.backgroundColor !== after.backgroundColor ||
        before.borderTopLeftRadius !== after.borderTopLeftRadius ||
        before.boxShadow !== after.boxShadow ||
        before.borderTopColor !== after.borderTopColor;
      expect(moved, `donghua.css never reached .${cls}`).toBe(true);
    });
  }

  it("donghua.css carries exactly one !important, and it is the accessibility one", () => {
    // Six came out. This one stays on purpose: it is a reduced-motion
    // override, and the convention there is to make it unoverridable so no
    // future rule can reintroduce motion for someone who asked for none.
    //
    // Comments are stripped first. The file now explains in prose why the
    // flags were removed, and counting the word inside that explanation
    // reported three flags in a file that has one.
    const decls = donghuaCss.replace(/\/\*[\s\S]*?\*\//g, "");
    expect([...decls.matchAll(/!important/g)]).toHaveLength(1);

    const line = decls.split("\n").find((l: string) => l.includes("!important")) as string;
    expect(line).toMatch(/transition:\s*none/);

    // ...and it sits inside the reduced-motion block, not loose in the file.
    const mq = decls.lastIndexOf("@media (prefers-reduced-motion: reduce)");
    expect(mq).toBeGreaterThan(-1);
    expect(decls.indexOf(line)).toBeGreaterThan(mq);
  });

  it("the burn state trim out-specifies the panel chrome", () => {
    // This is the relationship most at risk from dropping !important: the
    // state rule comes EARLIER in the file than the chrome rule it has to
    // beat, so it only wins on specificity.
    //
    // Asserted structurally rather than by measurement, and that is a real
    // limitation worth naming: the state rule's values are `color-mix()`
    // over a `var()` token, neither of which jsdom evaluates, so both the
    // plain and the hot element compute to the same empty value and a
    // measured test would pass for the wrong reason. Checking the selector
    // shape at least fails if someone flattens it to `.burn-hud`.
    const decls = donghuaCss.replace(/\/\*[\s\S]*?\*\//g, "");

    const stateRule = /\[data-burn\]:not\(\[data-burn=['"]normal['"]\]\)\s+\.burn-hud\s*\{([^}]*)\}/.exec(
      decls
    );
    expect(stateRule, "the burn-state trim rule is gone or was renamed").not.toBeNull();
    expect(stateRule![1]).toMatch(/border-color:/);
    expect(stateRule![1]).toMatch(/box-shadow:/);

    // Two compound selectors (attribute + class) against the chrome rule's
    // one. `:not()` adds its argument's specificity, so this is strictly
    // higher however the browser counts it.
    const selector = stateRule![0].slice(0, stateRule![0].indexOf("{"));
    expect(selector.trim().split(/\s+/).length).toBeGreaterThan(1);
  });

  it("a panel with no theme rule is left alone", () => {
    // Proves the test can tell the difference, rather than reporting
    // "changed" for anything at all.
    const before = mount(BASE, "burn-hud-row");
    document.head.innerHTML = "";
    document.body.innerHTML = "";
    const after = mount([...BASE, donghuaCss], "burn-hud-row");
    expect(after.backgroundColor).toBe(before.backgroundColor);
    expect(after.boxShadow).toBe(before.boxShadow);
  });
});

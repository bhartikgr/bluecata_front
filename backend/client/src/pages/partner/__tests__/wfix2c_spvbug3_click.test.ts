/**
 * W-FIX2c SPV-BUG-3 (F4 family) — SPV detail tab-click + card-open reliability.
 *
 * LIVE PROOF: on the SPV detail page a plain click did NOT switch tabs and the
 * SPV card only opened via a raw pointer sequence (not a real link/button) —
 * the same first-click no-op family as F4/F6.
 *
 * Root cause (shared): controlled Radix `onValueChange` can miss the first
 * pointer interaction, and a bare <div> onClick is not a real interactive
 * element so the first click is dropped.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WAVE 40 / F-1 — THIS TEST'S CONTRACT CHANGED, AND WHY IT HAD TO.
 *
 * SPV-BUG-3's fix was `role="button" tabIndex={0}` + a hand-written Enter/Space
 * handler ON THE CARD. That bought a reliable single click, and it also created
 * the largest defect on the live platform:
 *
 *   • The card's onKeyDown fires on Enter/Space BUBBLED FROM ANY DESCENDANT.
 *     Pressing Enter on one of the 16 SPV tab triggers toggled `selectedId` and
 *     unmounted the whole detail panel mid-activation. Reproduced in real
 *     Chromium, both poles — build_log/WAVE40_REPORT.md.
 *   • `role="button"` gives an element PRESENTATIONAL CHILDREN: the entire
 *     subtree is flattened in the accessibility tree, so the 16 `role="tab"`
 *     triggers, the publish button and both links inside the card did not exist
 *     for assistive technology at all.
 *
 * So this test now asserts the OPPOSITE of what it used to on the role/tabIndex
 * question, and asserts the replacement it was traded for. NOTHING WAS DROPPED:
 * the card keeps its onClick and its keyboard handler, and the disclosure gained
 * a REAL native <button> which the browser (not a hand-written handler)
 * activates on Enter and Space.
 *
 * Fix contract (static-source, matching this tree's convention):
 *   1. the SPV card is NOT an interactive-role ancestor — no role="button", no
 *      tabIndex — because it contains 16 tabs, two links and a button;
 *   2. a real <button> carries the disclosure, with aria-expanded/aria-controls;
 *   3. the card still opens on a plain click (its onClick survives);
 *   4. the detail wrapper stops key events, so no key pressed inside the tabbed
 *      panel can bubble out and collapse the panel the user is working in;
 *   5. the SPV detail tabs stay UNCONTROLLED Radix Tabs (`defaultValue`), which
 *      is first-click safe by construction (no controlled-value race).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const engine = readFileSync(resolve(__dirname, "..", "PartnerSpvEngine.tsx"), "utf8");
const tabs = readFileSync(
  resolve(__dirname, "..", "..", "..", "components", "partner", "SpvDetailTabs.tsx"),
  "utf8",
);

/** Strip block comments so prose ABOUT an attribute cannot pass for the
 *  attribute itself — this file's own WAVE 40 rationale quotes `role="button"`. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\{\/\*[\s\S]*?\*\/\}/g, " ");
}

/** The JSX of the SPV list card's opening element, attributes only. */
function cardOpeningTag(): string {
  const at = engine.indexOf("data-testid={`spv-row-${s.id}`}");
  expect(at).toBeGreaterThan(-1);
  const start = engine.lastIndexOf("<Card", at);
  /* The opening tag ends at the first `>` alone on a line at the Card's own
     indentation — arrow functions in the handlers contain `=>`, so a plain
     indexOf(">") would cut the tag in half. */
  const end = engine.indexOf("\n            >", start);
  expect(end).toBeGreaterThan(start);
  return stripComments(engine.slice(start, end));
}

/** The opening tag of the element carrying `attr`, comments stripped. */
function openingTagWith(attr: string, tag: string): string {
  const at = engine.indexOf(attr);
  expect(at).toBeGreaterThan(-1);
  const start = engine.lastIndexOf(`<${tag}`, at);
  const window = engine.slice(start, at + 1200);
  const stripped = stripComments(window);
  /* Cut at the first `>` that is not part of `=>`. */
  let i = stripped.indexOf(">", 1);
  while (i > 0 && stripped[i - 1] === "=") i = stripped.indexOf(">", i + 1);
  return stripped.slice(0, i < 0 ? undefined : i);
}

describe("WAVE 40 / F-1 — the SPV card is not an interactive-role ancestor", () => {
  it("has no role=\"button\" and no tabIndex on the card that contains the 16 tabs", () => {
    const tag = cardOpeningTag();
    expect(tag).not.toContain('role="button"');
    expect(tag).not.toContain("tabIndex=");
  });

  it("still opens on a plain click — the SPV-BUG-3 guarantee is kept", () => {
    expect(cardOpeningTag()).toContain("onClick={() => setSelectedId(s.id === selectedId ? null : s.id)}");
  });

  it("carries the disclosure on a REAL <button> with aria-expanded and aria-controls", () => {
    const btn = openingTagWith("data-testid={`spv-row-toggle-${s.id}`}", "button");
    expect(btn).toContain('type="button"');
    expect(btn).toContain("aria-expanded={selectedId === s.id}");
    expect(btn).toContain("aria-controls={`spv-detail-${s.id}`}");
  });

  it("stops key events at the detail wrapper so a key inside the tabs cannot collapse it", () => {
    const wrapper = openingTagWith("data-testid={`spv-detail-${s.id}`}", "div");
    expect(wrapper).toContain("onKeyDown={(e) => e.stopPropagation()}");
    expect(wrapper).toContain("onClick={(e) => e.stopPropagation()}");
    /* aria-controls on the toggle points at an `id`, not a data-testid. */
    expect(wrapper).toContain("id={`spv-detail-${s.id}`}");
  });

  it("keeps the card's own keyboard handler (nothing was deleted, only relocated)", () => {
    expect(engine).toMatch(/e\.key === "Enter" \|\| e\.key === " "/);
  });
});

describe("W-FIX2c SPV-BUG-3 — SPV detail tabs are first-click safe (uncontrolled)", () => {
  it("uses uncontrolled Radix Tabs (defaultValue), not a controlled value race", () => {
    /* WAVE 40 — `defaultValue` is now an expression so the blue "Open LP roster
       & capital calls" link can land the GP on the LPs tab. It is still
       UNCONTROLLED: no `value=` and no `onValueChange` anywhere, which is the
       property SPV-BUG-3 actually depended on. */
    expect(tabs).toMatch(/<Tabs\s+defaultValue=\{initialTab/);
    expect(tabs).not.toMatch(/<Tabs[^>]*\bvalue=\{/);
    expect(tabs).not.toContain("onValueChange");
  });

  it("falls back to overview for an unknown initialTab instead of selecting nothing", () => {
    expect(tabs).toContain('SPV_TAB_KEYS.includes(initialTab) ? initialTab : "overview"');
  });

  it("declares every one of the 16 tab keys it renders a trigger for", () => {
    const declared = (tabs.match(/TabsTrigger value="([a-z0-9]+)"/g) ?? []).map((m) =>
      m.replace(/.*value="/, "").replace('"', ""),
    );
    expect(declared).toHaveLength(16);
    for (const key of declared) expect(tabs).toContain(`  "${key}",`);
  });
});

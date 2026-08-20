/**
 * WAVE 58 · owner ruling R27 — THE WIZARD'S POOL CONTROL, PINNED.
 *
 * Source-lock style, matching `w52_round_wizard_disclosure.test.ts` and
 * `wfix2b_f5_auto_pps.test.ts`: these assertions read RoundNew.tsx as text,
 * because no full render harness exists for this page in this tree. They pin the
 * SURFACE. They are NOT the reachability proof — that is
 * `server/__tests__/w58_option_pool_percent_reachability.test.ts`, which goes
 * through HTTP routes, and this file makes no claim that anything is reachable.
 *
 * Every assertion FAILS if its change is reverted; transcripts in
 * build_log/wave58/W58_NEW_TESTS.md.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WIZARD = path.resolve(__dirname, "..", "RoundNew.tsx");
const src = fs.readFileSync(WIZARD, "utf8");
const DETAIL = path.resolve(__dirname, "..", "RoundDetail.tsx");
const detailSrc = fs.readFileSync(DETAIL, "utf8");

describe("W58 · R27 scope 2 — the input is a PERCENTAGE, the share count is DERIVED", () => {
  it("W58-W1 — a percentage field exists, labelled as a percentage of fully-diluted", () => {
    expect(src).toContain('data-testid="addon-pool-percent"');
    expect(src).toContain("Pool size (% of fully-diluted)");
    /* Percent-as-written is stated ON SCREEN, not merely in a comment, because
       the founder is the person who has to know 15 means 15%. */
    expect(src).toContain("Percent as written — 15 means 15%");
  });

  it("W58-W2 — the share count is READ-ONLY and is labelled as derived", () => {
    /* R27: "The share count becomes the derived output, shown to the founder,
       never the input."

       ══ AMENDED BY WAVE 58c · A2, AND MADE STRICTLY STRONGER — NOT WEAKENED ══
       This test previously asserted `readOnly` UNCONDITIONALLY and that the string
       `poolSize: e.target.value` did not exist anywhere in the file. Both encoded
       the claim "a share count is never an input", and that claim is exactly what
       Wave 58c · A2 had to overturn: it is a CAPABILITY REGRESSION AGAINST LIVE on
       SAFE and convertible-note rounds, which have no pre-money valuation and
       therefore no definable percentage of post-money fully-diluted. Proved by
       execution: with the fully-diluted base supplied, the percentage path still
       refuses with `pre_money_missing_for_pool`
       (`build_log/wave58cd/probe_before.mts`). Live accepts a share count on those
       instruments (`LIVE_AUDIT_2026_08_15.md`), and "we cannot disable vehicles."

       So R27's rule is preserved WHERE IT APPLIES — on a priced round, where a
       percentage IS definable — and this test now pins BOTH branches by name
       instead of one unconditional attribute. Nothing is unpinned. */
    expect(src).toContain('const poolEntryUnit: "percent" | "shares" = isPricedInstrument ? "percent" : "shares";');
    /* PRICED: still derived, still read-only, still labelled as derived. */
    expect(src).toMatch(/readOnly=\{poolEntryUnit === "percent"\}[\s\S]{0,400}data-testid="addon-pool-size"/);
    expect(src).toContain("Derived, not typed");
    /* And the ONLY writer of the derived value is still the single mirror effect,
       which is now gated so it cannot run on the unpriced path. */
    expect(src).toContain("d.poolSize === derivedPoolShares ? d : { ...d, poolSize: derivedPoolShares }");
    expect(src).toContain("if (!isPricedInstrument) return;");
    /* UNPRICED: the founder may type, and is told WHY the unit differs — the
       reason is on screen, not only in a comment. */
    expect(src).toContain('data-testid="addon-pool-unit-note"');
    expect(src).toContain('data-testid="err-addon-pool-size"');
  });

  it("W58-W3 — NOTHING WAS DROPPED: the label, the testid, the container and the toggle survive", () => {
    /* This is the no-silent-drop check, expressed as a test rather than trusted
       to the guard alone. The share-count control is RELOCATED, not removed. */
    for (const identity of [
      "Pool size (shares)",
      'data-testid="addon-pool-size"',
      'data-testid="addon-pool-fields"',
      'data-testid="addon-pool-toggle"',
      "Add / top up an option pool (ESOP)",
    ]) {
      expect(src).toContain(identity);
    }
  });

  it("W58-W4 — the derived count is what travels on the wire, and the percentage travels with it", () => {
    /* The `option_pool` child round still carries `poolSize` as a SHARE COUNT —
       unchanged key, unchanged meaning — so nothing downstream breaks. */
    expect(src).toContain("poolSize: addonPoolDraft.poolSize.trim(), sharesAuthorized: addonPoolDraft.poolSize.trim(),");
    /* And the parent round carries the percentage, which is the field the engine
       has read since Wave 52 and that nothing wrote until this wave. */
    expect(src).toMatch(/optionPoolPostPercent: addonPool && poolDerivation && poolDerivation\.ok/);
    /* WAVE 58b — this assertion was `expect(src).toContain("optionPoolMode: addonPool
       && poolDerivation && poolDerivation.ok")`. It still holds in substance and is
       now STRONGER. The 2026-08-15 live audit established that the STANDALONE
       "Option Pool Top-Up" vehicle has always had its own pre/post-money choice
       (`form.poolTiming`) which reached NO arithmetic — zero references in
       `server/` and zero in `packages/`. Both surfaces now write the one
       `optionPoolMode` key the engine reads, so the expression is a two-surface
       ternary rather than the add-on branch alone. Asserted here as both branches
       so neither can be dropped. */
    expect(src).toContain('form.poolTiming === "post_money" ? "post_money" : "pre_money"');
    /* ══ AMENDED BY WAVE 58c · A2, STRICTLY STRONGER ══
       Was `expect(src).toContain("addonPool && poolDerivation && poolDerivation.ok
       ? addonPoolDraft.poolMode : null")`. That gate stored the placement ONLY when
       the PERCENTAGE derivation succeeded, so a SAFE/note pool — which is expressed
       as a share count and has no percentage to derive — stored NEITHER a percentage
       NOR a placement: the founder's "who pays for it" choice was silently dropped.
       The gate is now `poolExpressed`, which is true when the pool is validly
       expressed IN THIS INSTRUMENT'S OWN UNIT. Both branches of that definition are
       asserted below, so neither can be dropped, and the percentage branch still
       requires `poolDerivation.ok` exactly as before. */
    expect(src).toContain("poolExpressed ? addonPoolDraft.poolMode : null");
    expect(src).toContain('? Boolean(poolDerivation && poolDerivation.ok)');
    expect(src).toContain(": Boolean(unpricedPoolCheck && unpricedPoolCheck.ok)");
    /* The single writer of the derived value, so it cannot diverge from the
       percentage that produced it. */
    expect(src).toContain("d.poolSize === derivedPoolShares ? d : { ...d, poolSize: derivedPoolShares }");
  });

  it("W58-W5 — the arithmetic goes through the exact-decimal module, not float code", () => {
    expect(src).toContain("derivePoolTopUpFromPercent");
    expect(src).toContain("parsePoolPercentAsWritten");
    /* R16: no conversion layer anywhere in the wizard. */
    const live = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
      .join("\n");
    expect(live).not.toMatch(/\/\s*100\b/);
    expect(live).not.toMatch(/\*\s*100\b/);
  });
});

describe("W58 · R27 scope 3 — placement is explicit, and the shuffle is disclosed", () => {
  it("W58-W6 — a pre-money / post-money placement control exists, with who-pays on screen", () => {
    expect(src).toContain('data-testid="addon-pool-placement"');
    expect(src).toContain("Pre-money — the founders pay for it alone");
    expect(src).toContain("Post-money — everyone pays for it pro-rata");
  });

  it("W58-W7 — the EFFECTIVE pre-money is displayed with its derivation, not buried", () => {
    expect(src).toContain('data-testid="addon-pool-effective-premoney"');
    expect(src).toContain("Effective pre-money");
    expect(src).toContain("Headline pre-money");
    expect(src).toContain("Value of the new pool");
    /* §10 item 6 of the document already SENT to the external reviewer:
       "The effective, pool-adjusted pre-money is displayed rather than buried." */
    expect(src).toContain("option pool shuffle");
    expect(src).toContain('data-testid="addon-pool-derived-pps"');
  });
});

describe("W58 · R27 scope 4 — the control is relocated beside the price", () => {
  it("W58-W8 — the pool renders on STEP 2 for priced instruments and STEP 5 otherwise", () => {
    expect(src).toContain('data-testid="addon-pool-host"');
    expect(src).toContain('((step === 2 && isPricedInstrument) || (step === 5 && !isPricedInstrument))');
  });

  it("W58-W9 — Review still shows the pool: a recap, not a removal", () => {
    expect(src).toContain('data-testid="addon-pool-review-recap"');
    /* It points at where the control now lives, so the founder is never left
       hunting for a field that moved. */
    expect(src).toContain('Set one on Step 2 — "Terms" — where the price per share reacts to it.');
  });
});

describe("W58 · R27 scope 5 — the existing pool is surfaced", () => {
  it("W58-W10 — the shares already reserved are read from the cap table and shown", () => {
    expect(src).toContain('data-testid="addon-pool-existing"');
    expect(src).toContain("Already under the plan");
    expect(src).toContain("New top-up this round (derived)");
    expect(src).toContain("Pool after this round");
    /* Read from the SAME endpoint the cap table uses, so the two cannot disagree. */
    expect(src).toContain("/securities");
    expect(src).toContain('s?.instrument === "option"');
  });

  it("W58-W11 — an unestablished existing pool is REFUSED, never assumed to be zero", () => {
    expect(src).toContain("existingPoolQ.data === undefined");
    expect(src).toContain('data-testid="addon-pool-refusal"');
    /* And the honest limitation of the figure is on screen, not only in a comment. */
    expect(src).toContain("granted options and the");
  });
});

describe("W58 · R27 scope 6 — validation refuses honestly", () => {
  it("W58-W12 — the percentage field renders a NAMED error, never a silent coercion", () => {
    expect(src).toContain('data-testid="err-addon-pool-percent"');
    expect(src).toContain("poolPercentCheck && !poolPercentCheck.ok");
    /* The refusal CODE is shown too, so a founder reporting a problem can quote
       something a engineer can search for. */
    expect(src).toContain("Refusal code:");
  });
});

describe("W58 · R27 scope 7 — the dead tooltip", () => {
  it("W58-W13 — the pool's explanation is rendered STATICALLY, needing no hover", () => {
    /* The live walkthrough found the "?" beside "Add warrants / option pool
       (optional)" renders no popover in the DOM. A hover-only affordance next to
       a money-critical control is replaced by an always-open one. */
    expect(src).toContain('data-testid="addon-pool-help"');
    expect(src).toContain("How the option pool is sized");
    expect(src).toContain("sized as a % of fully-diluted");
    /* The original HelpTip on the section heading is NOT deleted — that would be
       a silent drop of the warrants explanation it also carries. */
    expect(src).toContain("Add warrants / option pool (optional)");
  });
});

describe("W58 · R21 — the third surface: the round-detail Projection", () => {
  it("W58-W14 — the Projection passes the round's percentage into the engine", () => {
    /* Before this wave `projectPostClose` was called with NO pool field at all,
       so `compute.ts:457-458` could never fire on the Projection screen. */
    expect(detailSrc).toContain("optionPoolPostPercent: String(roundPoolPercent)");
    expect(detailSrc).toContain("hasRoundPoolPercent");
  });

  it("W58-W15 — and it DISCLOSES the pool, with the denominator named", () => {
    expect(detailSrc).toContain('data-testid="disclosure-w58-option-pool"');
    expect(detailSrc).toContain("% of post-money fully-diluted shares");
    expect(detailSrc).toContain('data-testid="disclosure-w58-pool-placement-warning"');
    /* It does NOT fall back to the ambiguous `poolSize` key. */
    expect(detailSrc).not.toContain("poolSize");
  });
});

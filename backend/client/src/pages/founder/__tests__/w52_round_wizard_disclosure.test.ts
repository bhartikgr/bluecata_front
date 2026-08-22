/**
 * WAVE 52 — the round wizard's five findings, and the promise Step 1 makes.
 *
 * Source-lock style, matching the convention already used by
 * `wfix2b_f5_auto_pps.test.ts`: these assertions read RoundNew.tsx as text, so
 * they pin the surface even where a full render harness is not available for
 * this page. Each one FAILS if its fix is reverted — the transcripts are in
 * build_log/wave52/W52_NEW_TESTS.md.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const WIZARD = path.resolve(__dirname, "..", "RoundNew.tsx");
const src = fs.readFileSync(WIZARD, "utf8");

describe("W52 · item 5a — the blank-denominator fallback is removed", () => {
  it("W52 item 5a basePreMoneyShares no longer falls back to sharesAuthorized", () => {
    /* THE DEFECT: `const shares = isFinite(fd) && fd > 0 ? fd : Number(form.sharesAuthorized);`
       silently substituted this round's NEW-issuance count for the pre-money
       fully-diluted count, divided the pre-money by it, and printed the result
       as a price per share. */
    expect(src).not.toContain("? fd : Number(form.sharesAuthorized)");
    /* And the replacement is present and refuses instead. */
    expect(src).toMatch(/const basePreMoneyShares = \(\(\) => \{[\s\S]{0,200}return isFinite\(fd\) && fd > 0 \? fd : 0;/);
  });

  it("W52 item 5a the caption can no longer assert an unqualified `FD =` figure", () => {
    /* The old caption printed "— FD = 10,000,000" using the substituted value. */
    expect(src).not.toContain("— FD = ${Math.round(fdPreMoneyShares)");
    expect(src).toContain("fully-diluted pre-money shares used =");
    /* When it cannot be computed it says so, rather than showing nothing. */
    expect(src).toContain("Capavate will not substitute the new-share count for it.");
  });

  it("W52 item 5a the Wave 50 pool identity is preserved verbatim", () => {
    /* The option-pool /100 defect was fixed in Wave 50 and must NOT be re-fixed.
       Both source-locked expressions survive this wave untouched. */
    expect(src).toContain("shares / (1 - poolTopUpPct)");
    expect(src).toContain("poolShares / (basePreMoneyShares + poolShares)");
    /* And the guard that silently discarded every real pool stays absent. */
    expect(src).not.toContain("poolShares / 100");
  });
});

describe("W52 · item 2a — the field is renamed, three sites", () => {
  it("W52 item 2a the UI label reads 'New shares issued in this round'", () => {
    expect(src).toContain("<Label>New shares issued in this round</Label>");
    expect(src).not.toContain("<Label>Shares authorized</Label>");
  });

  it("W52 item 2a the price-per-share placeholder names the right denominator", () => {
    expect(src).not.toContain('placeholder="Enter pre-money and shares authorized"');
    expect(src).toContain('placeholder="Enter pre-money and fully-diluted pre-money shares"');
  });

  it("W52 item 2a the tooltip states what the field is NOT", () => {
    /* The reviewer's premise — "Authorized Shares appears as a combined sum" —
       came from the label. The tooltip now says it is neither authorized capital
       nor a sum, and that it is a numerator. */
    expect(src).toContain("This is not authorized capital and it is not a sum of existing holdings");
    expect(src).toContain("It is a numerator: it is never the denominator used to price the round.");
  });

  it("W52 item 2a the STRUCK authorized-ceiling rationale does not reappear", () => {
    /* Strategy Review 1 struck DGCL §161 and NVCA §2.2 as the authority for this
       defect: they are correct law about a different quantity, and citing them
       would put a false sentence in front of a founder. */
    const lower = src.toLowerCase();
    expect(lower).not.toContain("dgcl");
    expect(lower).not.toContain("§161");
    expect(lower).not.toContain("nvca §2.2");
  });

  it("W52 item 2a the wire key is deliberately NOT renamed, and that is recorded", () => {
    /* Renaming `sharesAuthorized` is a data migration with a mirror, through
       extras_json / UPDATE_EXTRAS_WHITELIST. Only the label moved in this wave,
       and the mismatch is commented at the read site. */
    expect(src).toContain("sharesAuthorized: optionalIntegerString(form.sharesAuthorized)");
    expect(src).toContain("DB-KEY MISMATCH");
    expect(src).toContain("UPDATE_EXTRAS_WHITELIST");
  });
});

describe("W52 · item 1a — the post-money box stops rendering what it cannot compute", () => {
  it("W52 item 1a the surface no longer renders pre-money + target as post-money", () => {
    /* THE DEFECT: value={`$${post.toLocaleString()}`} where
       post = Number(form.preMoney) + Number(form.targetAmount) || 0. On Common,
       targetAmount is not a collected field, so this rendered the PRE-money
       under a post-money label. */
    expect(src).not.toContain("value={`$${post.toLocaleString()}`}");
    expect(src).not.toContain("<Label>Implied post-money</Label>");
  });

  it("W52 item 1a the readout is retained, with a true label and a derivation line", () => {
    /* Not a removal: same div, same data-testid, a correct label, and MORE
       disclosure than before. */
    expect(src).toContain('data-testid="input-post"');
    expect(src).toContain("<Label>Post-money valuation</Label>");
    expect(src).toContain('data-testid="w52-post-money-derivation"');
    expect(src).toContain("w52PostMoney.display");
    expect(src).toContain("w52PostMoney.derivation");
  });

  it("W52 item 1a the Common notional raise is disclosed AS A RAISE", () => {
    /* The server derives the Common raise as pricePerShare × sharesAuthorized
       and stores it as targetAmount. Since the multiplicand means new shares
       issued, that is the notional primary raise — defensible, and NOT to be
       "fixed" into a post-money. */
    expect(src).toContain("commonNotionalRaise");
    expect(src).toContain("NOTIONAL primary raise, subject to actual subscriptions");
    expect(src).toContain("It is a raise amount, not a post-money");
  });

  it("W52 item 1a an uncomputable post-money refuses rather than showing $0", () => {
    expect(src).toContain('display: "Not computable"');
    expect(src).toContain("it will not show $0 to mean");
  });
});

describe("W52 · §0 — the Review-step cap-table preview exists", () => {
  it("W52 §0 Step 1 still promises the preview, and Review now delivers one", () => {
    expect(src).toContain("Cap-table impact is computed live on Review.");
    expect(src).toContain('data-testid="w52-captable-preview"');
    expect(src).toContain("const w52Preview = (() => {");
  });

  it("W52 §0 the preview is inside the Review step, not another step", () => {
    const step5 = src.indexOf("{step === 5 && (");
    const preview = src.indexOf('data-testid="w52-captable-preview"');
    expect(step5).toBeGreaterThan(-1);
    expect(preview).toBeGreaterThan(step5);
  });

  it("W52 AC-16 every instrument has a preview branch or a named refusal", () => {
    for (const inst of ["safe_post", "safe_pre", "convertible_note", "warrant", "option_pool"]) {
      expect(src).toContain(`form.instrument === "${inst}"`);
    }
    expect(src).toContain('kind: "refusal" as const');
    expect(src).toContain("Insufficient inputs");
  });

  it("W52 AC-16 the refusal pole never renders a zero or a blank in place of a number", () => {
    expect(src).toContain("Capavate will not show a zero or a blank in place of them.");
    expect(src).toContain('data-testid="w52-preview-refusal"');
  });

  it("W52 AC-17 the note preview refuses on accrued interest rather than assuming zero", () => {
    expect(src).toContain("ACCRUED INTEREST IS NOT MODELLED");
    expect(src).toContain("no day-count convention");
    /* The sentence is wrapped across concatenated string literals in the source,
       so assert its two halves rather than a line that does not exist. */
    expect(src).toContain("Treating accrued interest as zero would understate the");
    expect(src).toContain("note's share count and overstate every founder.");
  });

  it("W52 AC-17 an undetermined conversion trigger fails closed on the SAFE preview", () => {
    /* WAVE 85 — STALE COPY PIN, RE-POINTED. Wave 83 removed the internal state word
       "UNDETERMINED" and the phrase "not a stored field in this build" from this
       founder-facing disclosure, under the owner's ruling. Both strings, verbatim:
         OLD: "Conversion trigger is not a stored field in this build. Whether this instrument converts in "
              "a given financing is therefore UNDETERMINED, which fails closed: it is excluded from any "
              "pricing denominator and any price computed alongside it is provisional."
         NEW: "Whether this instrument converts in a given financing is not recorded on the round, so "
              "Capavate will not assume it: the instrument is left out of every pricing denominator, and "
              "any price computed alongside it is provisional."
       THE FAIL-CLOSED BEHAVIOUR IS UNCHANGED, and the new sentence states it MORE
       plainly, not less: the instrument is left out of every pricing denominator and the
       price is provisional. "Fails closed" was the engineering name for exactly that
       consequence. The second assertion below is byte-identical to before and still
       passes, so the load-bearing half of this pin never moved.
       NOTE: "UNDETERMINED" is BANNED from this screen by Wave 83's own
       `w83_copy_and_controls.test.ts`, so restoring the old wording is not available —
       the two pins would contradict each other. See build_log/wave85/OWNER_QUESTIONS.md #1. */
    expect(src).toContain("is not recorded on the round, so ");
    expect(src).toContain("Capavate will not assume it");
    expect(src).toContain("left out of every pricing denominator");
    expect(src).toContain("any price computed alongside it is provisional");
  });

  it("W52 the two SAFE conventions are described differently, not identically", () => {
    /* Section 8.3 of the response could not run the decisive test. The preview
       must at minimum not describe them identically. */
    expect(src).toContain("Post-money SAFE (YC v1.2)");
    expect(src).toContain("Pre-money SAFE (YC v1.0)");
    expect(src).toContain("EXCLUDES the option pool created at the");
    expect(src).toContain("ADDITIONAL pool on top");
  });

  it("W52 AC-7 the preview renders each percentage through formatPct, which carries the label", () => {
    expect(src).toContain("r.percentages.map((pc) => formatPct(pc))");
    expect(src).toContain("DENOM_LABEL_SHORT[w52Preview.preview.pricing.denominator.label]");
    expect(src).toContain("DENOM_LABEL_TEXT[w52Preview.preview.pricing.denominator.label]");
    expect(src).toContain("Ownership, with its denominator named");
  });

  it("W52 the pricing denominator is itemised on screen, with a total", () => {
    expect(src).toContain('data-testid="w52-preview-denominator"');
    expect(src).toContain('data-testid="w52-denom-total"');
    expect(src).toContain("Total pricing denominator:");
  });

  it("W52 the effective pool-adjusted pre-money is displayed, not buried", () => {
    expect(src).toContain('data-testid="w52-effective-pre-money"');
    expect(src).toContain("Effective, pool-adjusted pre-money");
    expect(src).toContain("the founders alone pay for it");
  });

  it("W52 the residual and its disposition are disclosed per investor", () => {
    expect(src).toContain("describeResidual(d, null)");
    expect(src).toContain('data-testid={`w52-preview-residual-${i}`}');
  });

  it("W52 the rounding rule is stated on screen, and the total is not the summed column", () => {
    expect(src).toContain('data-testid="w52-preview-rounding-note"');
    expect(src).toContain("never the sum of the rounded column");
    expect(src).toContain("displayedTotals");
  });

  it("W52 AC-15 the preview is appended at the END as a sibling, and says why", () => {
    /* The append-at-the-END rule is the only thing standing between this wave
       and a several-hundred-identity renumbering event, so the reason lives in
       the source rather than only in a report. */
    expect(src).toContain("APPENDED AT THE END AS A SIBLING, deliberately");
    expect(src).toContain("62 phantom drops");
  });
});

describe("W52 · scope discipline", () => {
  it("W52 does not import or touch either sacred cap-table module", () => {
    expect(src).not.toContain("captableCommitStore");
    expect(src).not.toContain("capTableMembership");
    expect(src).not.toContain("roundCarryForwardEngine");
  });

  it("W52 percent handling stays as-written: no live /100 or *100 in the wizard", () => {
    /* R16 / OR-1: percent as written, 1 = 1%, no conversion. The only
       conversions in this wave are roundMath.ts's two clearly-named display
       boundary helpers. Comment lines are excluded because Wave 50's record of
       the DELETED `/ 100` defect must stay readable in the source. */
    const live = src
      .split("\n")
      .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*") && !l.trim().startsWith("/*"))
      .join("\n");
    expect(live).not.toMatch(/\/\s*100\b/);
    expect(live).not.toMatch(/\*\s*100\b/);
    /* And the specific Wave 50 defect stays deleted. */
    expect(src).not.toContain("Number(addonPoolDraft.poolSize) / 100");
    expect(src).not.toContain("if (p >= 100) return 0");
  });

  it("W52 the wizard's math goes through the exact-decimal module, not float arithmetic", () => {
    expect(src).toContain('from "@/lib/roundMath"');
    for (const fn of [
      "derivePricePerShare",
      "deriveInvestorShares",
      "computePostMoney",
      "buildCapTablePreview",
      "commonNotionalRaise",
    ]) {
      expect(src).toContain(fn);
    }
  });
});

/**
 * WAVE 55 · R6 — honest refusal at the T1-SURFACE sites this wave changed.
 *
 * Owner ruling 55-Q1: **"dash in dense tables, explicit refusal where
 * prominent."** Owner ruling R6: no surface may render `0` when it means
 * "we do not know". Owner ruling R16: percent as-written — nothing in this
 * file converts a unit, and no edit under test touches a percentage.
 *
 * Each site gets FOUR assertions, and the third is the one that makes the test
 * fail if the change is reverted:
 *
 *   POLE A — REFUSAL   : the unknown input renders the refusal string, and the
 *                        digit `0` is ABSENT from the rendered output.
 *   POLE B — REAL ZERO : a genuine `0` still renders "$0.00" / "0" and is NOT
 *                        the refusal. A helper that refused for 0 as well would
 *                        be a worse bug than the one R6 fixes.
 *   STRUCTURAL         : the real source line is read off disk and must contain
 *                        the refusing call and must NOT contain the old
 *                        `?? 0` coalesce. Reverting the edit fails this file.
 *   REACHABILITY       : the value's own declaration is read off disk and must
 *                        admit `null`, so the refusal branch is reachable and
 *                        the fix is not decoration. Where the null is produced
 *                        by a server route, the SERVER file is asserted too.
 *
 * Every assertion in this file was reproduced by running it. Nothing here is
 * asserted from memory.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  formatMinorOrUnavailable,
  moneyOrNotProvided,
  MONEY_UNAVAILABLE,
  NOT_PROVIDED,
} from "../moneyDisplay";

const TREE = path.resolve(__dirname, "../../../..");
const read = (rel: string) => fs.readFileSync(path.join(TREE, rel), "utf8");

/** No digit anywhere — the strongest form of "the number is absent". */
const hasNoDigit = (s: string) => expect(s).not.toMatch(/[0-9]/);

describe("WAVE 55 · R6 — the refusal vocabulary itself (both poles)", () => {
  it("dash treatment: unknown -> '—' with no digits; a real 0 -> '$0.00'", () => {
    for (const unknown of [null, undefined, ""] as const) {
      const out = formatMinorOrUnavailable(unknown as never, "USD");
      expect(out).toBe(MONEY_UNAVAILABLE);
      hasNoDigit(out);
    }
    const zero = formatMinorOrUnavailable(0, "USD", { locale: "en-US" });
    expect(zero).toBe("$0.00");
    expect(zero).not.toBe(MONEY_UNAVAILABLE);
  });

  it("named-refusal treatment: unknown -> 'Not provided'; a real 0 -> '$0.00'", () => {
    const out = moneyOrNotProvided(null, "USD");
    expect(out).toBe(NOT_PROVIDED);
    expect(out).toBe("Not provided");
    hasNoDigit(out);
    expect(moneyOrNotProvided(0, "USD", { locale: "en-US" })).toBe("$0.00");
  });

  it("an unknown DENOMINATION also refuses instead of being relabelled USD", () => {
    // AdminFeesConsolidated previously wrote `inv.currency ?? "USD"`, which
    // renamed an unknown currency to dollars. Passing it through unchanged
    // means the refusal covers that pole too.
    expect(formatMinorOrUnavailable(12345, null)).toBe(MONEY_UNAVAILABLE);
    expect(formatMinorOrUnavailable(12345, "")).toBe(MONEY_UNAVAILABLE);
  });
});

/* ------------------------------------------------------------------------- */

describe("WAVE 55 · site 1 — admin/PartnerPL.tsx fmtMoney (dense P&L table -> dash)", () => {
  const REL = "client/src/pages/admin/PartnerPL.tsx";
  it("STRUCTURAL — the helper refuses and the `?? 0` is gone", () => {
    const src = read(REL);
    expect(src).toContain('return formatMinorOrUnavailable(minor, currency, { locale: "en-US" });');
    expect(src).not.toContain('return formatMinor(minor ?? 0, currency, { locale: "en-US" });');
    expect(src).toContain('from "@/lib/moneyDisplay"');
  });
  it("REACHABILITY — the helper's own parameter is declared nullable", () => {
    expect(read(REL)).toContain('function fmtMoney(minor: number | null, currency = "USD"): string {');
  });
  it("POLES — every cell fed by this helper", () => {
    expect(formatMinorOrUnavailable(null, "USD", { locale: "en-US" })).toBe("—");
    expect(formatMinorOrUnavailable(250000, "USD", { locale: "en-US" })).toBe("$2,500.00");
    expect(formatMinorOrUnavailable(0, "USD", { locale: "en-US" })).toBe("$0.00");
  });
});

describe("WAVE 55 · site 2 — admin/CollectivePaymentPL.tsx fmtMoney (dense table -> dash)", () => {
  const REL = "client/src/pages/admin/CollectivePaymentPL.tsx";
  it("STRUCTURAL — the helper refuses and the `?? 0` is gone", () => {
    const src = read(REL);
    expect(src).toContain('return formatMinorOrUnavailable(minor, currency, { locale: "en-US" });');
    expect(src).not.toContain('return formatMinor(minor ?? 0, currency, { locale: "en-US" });');
  });
  it("REACHABILITY — nullable parameter", () => {
    expect(read(REL)).toContain('function fmtMoney(minor: number | null, currency = "USD"): string {');
  });
});

describe("WAVE 55 · site 3 — admin/AdminPartnerBillingOps.tsx discount cell (dense table -> dash)", () => {
  const REL = "client/src/pages/admin/AdminPartnerBillingOps.tsx";
  it("STRUCTURAL — the discount cell refuses, and the row is still there", () => {
    const src = read(REL);
    /* ═══════════════════════════════════════════════════════════════════════
       CORRECTED BY WAVE 73 · ITEM 2 — WAVE 55'S INTENT IS PRESERVED AND WIDENED.
       ═══════════════════════════════════════════════════════════════════════
       This assertion used to pin the literal `"USD"` in all three cells:

           expect(src).toContain('{formatMinorOrUnavailable(r.discountMinor, "USD")}');
           expect(src).toContain('{r.listAmountMinor === null ? "—" : formatMinor(r.listAmountMinor, "USD")}');
           expect(src).toContain('{formatMinor(r.amountMinor, "USD")}');

       Wave 55's SUBJECT was the refusal — that an unknown discount renders a dash
       instead of a fabricated `$0.00`, without dropping the cell. The hardcoded
       currency was incidental to that, and it was ALSO a money defect:
       `partner_subscription.currency` is `TEXT NOT NULL` and populated, so a
       partner billed in EUR had their figures printed with a `$`. Wave 73 Item 2
       makes all three cells read the stored `r.currency`.

       So the assertions below pin WAVE 55'S ACTUAL SUBJECT — every money cell in
       this row goes through the refusing formatter, none of them fabricates a
       zero, and the cells all still exist — and they no longer pin the defect Wave
       55 was not about. Wave 73's own poles (`w73_partner_currency_db_driven.test.tsx`)
       assert the EUR render and the no-currency refusal out of the DOM. */
    expect(src).toContain('{formatMinorOrUnavailable(r.discountMinor, r.currency)}');
    expect(src).not.toContain('{formatMinor(r.discountMinor ?? 0, "USD")}');
    expect(src).not.toContain('{formatMinor(r.discountMinor ?? 0, r.currency)}');
    // NO SILENT DROP: the cell, and the sibling cells, still exist.
    expect(src).toContain('<td className="px-3 py-2 text-right font-mono">{formatMinorOrUnavailable(r.discountMinor, r.currency)}</td>');
    expect(src).toContain('{formatMinorOrUnavailable(r.listAmountMinor, r.currency)}');
    expect(src).toContain('{formatMinorOrUnavailable(r.amountMinor, r.currency)}');
    /* AND THE DEFECT THAT WAS REMOVED CANNOT RETURN: no money cell in this row
       may name a currency the database did not supply. */
    expect(src).not.toContain('formatMinor(r.listAmountMinor, "USD")');
    expect(src).not.toContain('formatMinor(r.amountMinor, "USD")');
  });
  it("REACHABILITY — `discountMinor` is declared `number | null` on this page's DTO", () => {
    expect(read(REL)).toContain("discountMinor: number | null;");
  });
  it("VOICE — the dash matches the sibling column already refusing in the same row", () => {
    expect(formatMinorOrUnavailable(null, "USD")).toBe("—");
  });
});

describe("WAVE 55 · site 4 — partner/PartnerFundDetail.tsx Target Size (prominent -> named refusal)", () => {
  const REL = "client/src/pages/partner/PartnerFundDetail.tsx";
  it("STRUCTURAL — the tile refuses by name and the `?? 0` is gone", () => {
    const src = read(REL);
    expect(src).toContain("{moneyOrNotProvided(f.targetRaiseMinor, f.currency)}");
    expect(src).not.toContain("{formatMinor(f.targetRaiseMinor ?? 0, f.currency)}");
    // NO SILENT DROP: the label and its sibling tile survive.
    expect(src).toContain(">Target Size</div>");
    expect(src).toContain(">Currency (ISO 4217)</div>");
  });
  it("REACHABILITY — nullable on the client DTO AND written as null by the server", () => {
    expect(read(REL)).toContain("targetRaiseMinor: number | null;");
    expect(read("server/spvDiscoveryStore.ts")).toContain("targetRaiseMinor: number | null;");
    expect(read("server/partnerRoutes.ts")).toContain(
      "targetRaiseMinor: isNumber(targetSizeMinor) ? targetSizeMinor : null,",
    );
  });
  it("POLES — unknown target size refuses; a fund genuinely targeting 0 still prints", () => {
    const refusal = moneyOrNotProvided(null, "USD");
    expect(refusal).toBe("Not provided");
    hasNoDigit(refusal);
    expect(moneyOrNotProvided(0, "USD", { locale: "en-US" })).toBe("$0.00");
    expect(moneyOrNotProvided(500000000, "USD", { locale: "en-US" })).toBe("$5,000,000.00");
  });
});

describe("WAVE 55 · site 5 — partner/PartnerSpvDetail.tsx Target Size (prominent -> named refusal)", () => {
  const REL = "client/src/pages/partner/PartnerSpvDetail.tsx";
  it("STRUCTURAL — the tile refuses by name and the `?? 0` is gone", () => {
    const src = read(REL);
    expect(src).toContain("{moneyOrNotProvided(s.targetRaiseMinor, s.currency)}");
    expect(src).not.toContain("{formatMinor(s.targetRaiseMinor ?? 0, s.currency)}");
    expect(src).toContain(">Target Size</div>");
  });
  it("REACHABILITY — nullable on the client DTO", () => {
    expect(read(REL)).toContain("targetRaiseMinor: number | null;");
  });
});

describe("WAVE 55 · site 6 — founder/CapTable.tsx SAFE/note principal (dense list -> dash)", () => {
  const REL = "client/src/pages/founder/CapTable.tsx";
  it("STRUCTURAL — the principal refuses and the `?? 0` is gone", () => {
    const src = read(REL);
    expect(src).toContain(
      "{s.investmentAmount == null ? MONEY_UNAVAILABLE : `${sym}${s.investmentAmount.toLocaleString()}`}",
    );
    expect(src).not.toContain("{sym}{(s.investmentAmount ?? 0).toLocaleString()}");
    // R16 / no unit conversion: this column stays MAJOR units. There must be no
    // `/ 100` or `* 100` introduced on the principal expression.
    expect(src).not.toContain("s.investmentAmount / 100");
    expect(src).not.toContain("s.investmentAmount * 100");
    // NO SILENT DROP: the row label and the card's existing honest refusal stay.
    expect(src).toContain("<span>Principal</span>");
    expect(src).toContain("None outstanding.");
  });
  it("REACHABILITY — the shared securities type admits a null principal", () => {
    // The page consumes GET /api/companies/:id/securities. The security shape is
    // declared in the shared adapter, and the principal is explicitly nullable
    // there, so the refusal branch is reachable from a real HTTP response.
    expect(read("shared/roundMathEngineAdapter.ts")).toContain("investmentAmount: number | null;");
    expect(read(REL)).toContain('/api/companies/${companyId}/securities');
  });
  it("POLES — no principal on file renders the dash with no digits; a real 0 prints", () => {
    hasNoDigit(MONEY_UNAVAILABLE);
    expect(MONEY_UNAVAILABLE).toBe("—");
    // the preserved happy-path expression, exercised directly
    const sym = "$";
    expect(`${sym}${(0).toLocaleString()}`).toBe("$0");
    expect(`${sym}${(250000).toLocaleString("en-US")}`).toBe("$250,000");
  });
});

describe("WAVE 55 · site 7 — admin/AdminFeesConsolidated.tsx invoice amount (dense table -> dash)", () => {
  const REL = "client/src/pages/admin/AdminFeesConsolidated.tsx";
  it("STRUCTURAL — the amount cell refuses, and the currency is no longer forced to USD", () => {
    const src = read(REL);
    expect(src).toContain("{formatMinorOrUnavailable(inv.amountMinor, inv.currency)}");
    expect(src).not.toContain(
      '                          {formatMinor(inv.amountMinor ?? 0, inv.currency ?? "USD")}\n',
    );
    // NO SILENT DROP: the refund control on the same row is untouched.
    expect(src).toContain("data-testid={`button-refund-invoice-${inv.id}`}");
  });
  it("POLES — unknown amount OR unknown currency refuses; a real 0 prints", () => {
    expect(formatMinorOrUnavailable(null, "USD")).toBe("—");
    expect(formatMinorOrUnavailable(1000, null)).toBe("—");
    expect(formatMinorOrUnavailable(0, "USD", { locale: "en-US" })).toBe("$0.00");
    // exponent-aware, so a 0-decimal currency is not misstated (JPY)
    expect(formatMinorOrUnavailable(1000, "JPY", { locale: "en-US" })).toBe("¥1,000");
  });
});

/* ------------------------------------------------------------------------- */

describe("WAVE 55 — sites deliberately LEFT AS-IS, pinned so the decision is visible", () => {
  it("partner/SpvPerformance.tsx: DTO declares contributed/distributed NON-nullable", () => {
    const src = read("client/src/pages/partner/SpvPerformance.tsx");
    expect(src).toContain("contributedMinor: number;");
    expect(src).toContain("distributedMinor: number;");
    // and the genuinely-nullable neighbour already refuses, which is the
    // in-file evidence that the author distinguished the two cases on purpose.
    expect(src).toContain("{p.residualValueMinor === null || p.residualValueMinor === undefined");
  });
  it("founder/CapTable.tsx accrued interest is already guarded, so its `?? 0` is dead", () => {
    expect(read("client/src/pages/founder/CapTable.tsx")).toContain(
      "{s.accruedInterest != null && s.accruedInterest > 0 && (",
    );
  });
  it("the empty cap table is already honest (Wave 58c/58d) — F-8's presentation half", () => {
    const src = read("client/src/pages/founder/CapTable.tsx");
    expect(src).toContain("No securities recorded yet.");
    expect(src).toContain('data-testid="captable-flat-total-empty-note"');
    expect(src).toContain("there is nothing to total, and this is not a 0% ownership figure");
  });
});

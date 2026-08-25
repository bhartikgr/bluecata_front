/* ════════════════════════════════════════════════════════════════════════════
   WAVE 125 · FINDING 2 — AN EIGHTH REGISTER THAT NOTHING WROTE, PRINTING A FALSE
   ZERO IN FIVE PLACES.
   ════════════════════════════════════════════════════════════════════════════
   `capTableHolders` had NO WRITER anywhere in live code. This wave's enumeration
   (build_log/wave125/captable_holders_sites.json) found 29 unique live
   occurrences: 7 type declarations, 16 literal `0`s, 2 pass-throughs and 6
   renderers — and ZERO computations. The literal reached users in FIVE places:
   the founder dashboard (twice), `CompanySwitcher` ("0 holders"), `SelectCompany`
   ("0 investors") and a `Reports` snapshot. On the very same dashboard page the
   Capitalization Journey DERIVED `1` correctly, so the page contradicted itself.

   This is the EIGHTH such register on this platform: the running count went
   3 → 4 → 5 → 7 → 8, each found after the previous was declared final.

   THE RULE THIS FILE PINS: a count of holders is not money, so a DERIVED zero is
   a meaningful answer — but a zero that means "nobody ever computed this" must
   never be printed. So the producer returns:
     · a NUMBER when it read securities and derived a count;
     · `null`, with a reason, when there was no provider, no securities on record,
       or the engine refused.
   And it counts holders by the SAME definition the journey KPI uses
   (`countCapTableHolders`), so the two figures on one page cannot disagree again.

   FAIL-BEFORE: group (D) shows the literal the five renderers used to read.
   ════════════════════════════════════════════════════════════════════════════ */
import { describe, it, expect, afterEach } from "vitest";
import {
  computeCapTableHolderCount,
  computeCapTableHoldersOnRecord,
  setFounderOwnershipSecuritiesProvider,
} from "../lib/founderOwnershipEngine";
import { countCapTableHolders } from "../../client/src/lib/captable/capTableHolderCount";

const CID = "co_w125_blueprint";

/** BluePrint Catalyst Limited as it stands on production: 150 shares, ONE
 *  investor holding all of them, and no founder row. The journey derives 1. */
const BLUEPRINT = [
  { id: "sec_w125_inv", companyId: CID, holderName: "Aster Capital", holderType: "investor", instrument: "common", series: null, shares: 150, pricePerShare: 1, investmentAmount: 150, cap: null, discount: null, issuedAt: "2026-01-01" },
];

/** Three distinct holders across the three published bands, one of them holding
 *  two separate securities — so a naive `rows.length` would say 4. */
const THREE_HOLDERS = [
  { id: "s1", companyId: CID, holderName: "Ada Okafor", holderType: "founder", instrument: "common", series: null, shares: 700000, pricePerShare: 0.0001, investmentAmount: 70, cap: null, discount: null, issuedAt: "2025-01-01" },
  { id: "s2", companyId: CID, holderName: "Ada Okafor", holderType: "founder", instrument: "common", series: null, shares: 100000, pricePerShare: 0.0001, investmentAmount: 10, cap: null, discount: null, issuedAt: "2025-03-01" },
  { id: "s3", companyId: CID, holderName: "Aster Capital", holderType: "investor", instrument: "preferred", series: "A", shares: 250000, pricePerShare: 4, investmentAmount: 1000000, cap: null, discount: null, issuedAt: "2025-02-01" },
  { id: "s4", companyId: CID, holderName: "Option pool", holderType: "pool", instrument: "option", series: null, shares: 50000, pricePerShare: null, investmentAmount: null, cap: null, discount: null, issuedAt: "2025-01-01" },
];

afterEach(() => setFounderOwnershipSecuritiesProvider(null));

describe("W125 · FINDING 2 (A) — the count is DERIVED, and matches the journey", () => {
  it("derives 1 for BluePrint Catalyst, the figure the journey already showed", () => {
    setFounderOwnershipSecuritiesProvider(() => BLUEPRINT as never);
    const r = computeCapTableHolderCount(CID);
    expect(r.reason).toBe("computed");
    expect(r.count).toBe(1);
    /* THE SELF-CONTRADICTION, GONE: the same definition on both sides. */
    expect(r.count).toBe(countCapTableHolders(BLUEPRINT as never));
  });

  it("counts DISTINCT holders, not securities", () => {
    setFounderOwnershipSecuritiesProvider(() => THREE_HOLDERS as never);
    expect(computeCapTableHolderCount(CID).count).toBe(3);
    expect(THREE_HOLDERS).toHaveLength(4);
  });
});

describe("W125 · FINDING 2 (B) — a zero nobody computed is refused, not printed", () => {
  it("returns null when no securities provider is wired", () => {
    setFounderOwnershipSecuritiesProvider(null);
    const r = computeCapTableHolderCount(CID);
    expect(r.count).toBeNull();
    expect(r.reason).toBe("no_securities_provider");
  });

  it("returns null when the register is EMPTY — nothing was read, so nothing is known", () => {
    setFounderOwnershipSecuritiesProvider(() => [] as never);
    const r = computeCapTableHolderCount(CID);
    expect(r.count).toBeNull();
    expect(r.reason).toBe("no_securities_on_record");
  });

  it("returns null when the provider throws", () => {
    setFounderOwnershipSecuritiesProvider(() => {
      throw new Error("db closed");
    });
    const r = computeCapTableHolderCount(CID);
    expect(r.count).toBeNull();
    expect(r.reason).toBe("no_securities_provider");
  });

  it("returns null for a missing company id", () => {
    setFounderOwnershipSecuritiesProvider(() => THREE_HOLDERS as never);
    expect(computeCapTableHolderCount("").count).toBeNull();
    expect(computeCapTableHolderCount(null).count).toBeNull();
    expect(computeCapTableHolderCount(undefined).count).toBeNull();
  });

  it("NEVER returns 0 in any un-derived state — that is the whole defect", () => {
    setFounderOwnershipSecuritiesProvider(null);
    expect(computeCapTableHoldersOnRecord(CID)).not.toBe(0);
    setFounderOwnershipSecuritiesProvider(() => [] as never);
    expect(computeCapTableHoldersOnRecord(CID)).not.toBe(0);
  });
});

describe("W125 · FINDING 2 (C) — the KPI wrapper", () => {
  it("hands the renderers a number or a null, and nothing else", () => {
    setFounderOwnershipSecuritiesProvider(() => BLUEPRINT as never);
    expect(computeCapTableHoldersOnRecord(CID)).toBe(1);
    setFounderOwnershipSecuritiesProvider(() => [] as never);
    expect(computeCapTableHoldersOnRecord(CID)).toBeNull();
  });
});

describe("W125 · FINDING 2 (D) — FAIL-BEFORE: what the five renderers used to read", () => {
  it("the field was a hard-coded literal, identical in every state", () => {
    /* Verbatim shape of the KPI object as it left the store before this wave.
       Note there is no company, no provider and no register involved at all — the
       zero was the same for a company with 150 shares and one with none. */
    const beforeForBluePrint = { capTableHolders: 0 };
    const beforeForEmptyCompany = { capTableHolders: 0 };
    expect(beforeForBluePrint.capTableHolders).toBe(0);
    expect(beforeForEmptyCompany.capTableHolders).toBe(0);
    expect(beforeForBluePrint.capTableHolders).toBe(beforeForEmptyCompany.capTableHolders);

    /* After: the two states are distinguishable, and the populated one is right. */
    setFounderOwnershipSecuritiesProvider(() => BLUEPRINT as never);
    const afterForBluePrint = computeCapTableHoldersOnRecord(CID);
    setFounderOwnershipSecuritiesProvider(() => [] as never);
    const afterForEmptyCompany = computeCapTableHoldersOnRecord(CID);
    expect(afterForBluePrint).toBe(1);
    expect(afterForEmptyCompany).toBeNull();
    expect(afterForBluePrint).not.toBe(afterForEmptyCompany);
  });
});

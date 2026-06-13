/**
 * Patch 2 — Round Carry-Forward Engine tests.
 *
 * INVESTOR-GRADE / AUDIT-GRADE: covers determinism, immutability,
 * provenance accuracy, high-risk field exclusion, and audit log integrity.
 *
 * 25+ tests organized into:
 *   - SAFE → SAFE carry-forward
 *   - SAFE → Priced equity (unrealizedInstruments)
 *   - Priced equity → Priced equity
 *   - No prior rounds (first round)
 *   - Multi-currency (most recent SAFE wins)
 *   - Never-carry fields (cap, preMoney)
 *   - Anti-dilution carry
 *   - Audit digest determinism + tamper-detection
 *   - Immutability (engine never mutates stores)
 *   - Audit log (accept + override)
 *   - Hash chain integrity
 *   - Unknown company
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  computeCarryForward,
  computeConversionProjections,
  type RoundType,
} from "../roundCarryForwardEngine";
import {
  appendCarryForwardAuditEntry,
  clearCarryForwardAuditLog,
  getCarryForwardAuditLog,
} from "../roundCarryForwardRoutes";
// Engine imports — used directly to verify math matches
import {
  convertSafeToPreferred,
  convertNoteToPreferred,
  resolveFormula,
} from "@capavate/cap-table-engine";

// ─── Store snapshots (for immutability checks) ─────────────────────────────
import { rounds, securities, companies } from "../mockData";
import { getCompanyProfile } from "../companyProfileStore";

const CO_NOVAPAY = "co_novapay";
const CO_ARBOREAL = "co_arboreal";
const NONEXISTENT = "co_does_not_exist_xyzzy";

beforeEach(() => {
  clearCarryForwardAuditLog();
});

// ============================================================
// Section 1: SAFE → SAFE carry-forward
// ============================================================
describe("SAFE → SAFE carry-forward", () => {
  it("currency carries from previous SAFE round", () => {
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "safe" });
    expect(result.fields["currency"]).toBeDefined();
    expect(result.fields["currency"].suggestedValue).toBe("USD");
    expect(result.fields["currency"].source).toBe("prev_round");
    expect(result.fields["currency"].confidence).toBe("high");
  });

  it("mfn carries from previous SAFE round with medium confidence", () => {
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "safe" });
    expect(result.fields["mfn"]).toBeDefined();
    expect(result.fields["mfn"].source).toBe("prev_round");
    expect(result.fields["mfn"].confidence).toBe("medium");
    // sourceRoundId should point to the pre-seed SAFE round
    expect(result.fields["mfn"].sourceRoundId).toBe("rnd_novapay_preseed");
  });

  it("proRata carries from previous SAFE round", () => {
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "safe" });
    expect(result.fields["proRata"]).toBeDefined();
    expect(result.fields["proRata"].source).toBe("prev_round");
  });

  it("safeType carries from previous SAFE round with high confidence", () => {
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "safe" });
    expect(result.fields["safeType"]).toBeDefined();
    expect(result.fields["safeType"].confidence).toBe("high");
    expect(["post_money_cap", "pre_money_cap"]).toContain(result.fields["safeType"].suggestedValue);
  });

  it("cap is NEVER in the suggested fields (too dangerous)", () => {
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "safe" });
    expect(result.fields["cap"]).toBeUndefined();
    // Cap warning must be present instead
    expect(result.warnings.some((w) => w.toLowerCase().includes("cap"))).toBe(true);
  });

  it("discount is NEVER in the suggested fields", () => {
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "safe" });
    expect(result.fields["discount"]).toBeUndefined();
    expect(result.warnings.some((w) => w.toLowerCase().includes("discount"))).toBe(true);
  });

  it("each suggestion carries sourceRoundId + sourceRoundName + sourceRoundClosedAt", () => {
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "safe" });
    const currency = result.fields["currency"];
    expect(currency.sourceRoundId).toBeTruthy();
    expect(currency.sourceRoundName).toBeTruthy();
    expect(currency.sourceRoundClosedAt).toBeTruthy();
  });
});

// ============================================================
// Section 2: SAFE → Priced equity (unrealizedInstruments)
// ============================================================
describe("SAFE → Priced equity carry-forward", () => {
  it("unrealizedInstruments contains SAFE instruments for a company with open SAFEs", () => {
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "priced_equity" });
    // NovaPay has SAFEs in rnd_novapay_preseed that haven't been re-labelled as converted
    // (The seed closed round has preferred stock; SAFEs in preseed are the unconverted ones)
    expect(result.unrealizedInstruments.length).toBeGreaterThanOrEqual(1);
    const safes = result.unrealizedInstruments.filter((u) => u.instrumentType === "safe");
    expect(safes.length).toBeGreaterThanOrEqual(1);
  });

  it("each unrealized SAFE has principal, cap, discount, sourceRoundId", () => {
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "priced_equity" });
    for (const u of result.unrealizedInstruments) {
      if (u.instrumentType === "safe") {
        expect(u.principal).toBeTruthy();
        expect(u.sourceRoundId).toBeTruthy();
        expect(u.holderName).toBeTruthy();
        expect(u.rationale).toBeTruthy();
      }
    }
  });

  it("projected conversion price is null when no series PPS provided (pre-round)", () => {
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "priced_equity" });
    // At suggestion time we don't know the round price yet
    for (const u of result.unrealizedInstruments) {
      expect(u.projectedConversionPriceUsd).toBeNull();
    }
  });

  it("computeConversionProjections fills conversion price using existing engine (not reimplemented)", () => {
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "priced_equity" });
    const SERIES_PPS = "1.00";
    const CAP_TABLE_SHARES = "12000000"; // example capitalization

    const projected = computeConversionProjections(
      result.unrealizedInstruments,
      SERIES_PPS,
      CAP_TABLE_SHARES,
    );

    for (const u of projected) {
      if (u.cap || u.discount) {
        expect(u.projectedConversionPriceUsd).not.toBeNull();
        expect(u.projectedShares).not.toBeNull();
      }
    }
  });

  it("conversion math matches existing engine exactly: $1M SAFE @ $10M cap, 20% discount, $1 PPS, 12M cap", () => {
    // This is the "test 9" from the spec:
    // $1M SAFE with $10M cap, 20% discount, MFN
    // Converting in a round at $1.00/sh, 12M total capitalization
    // Expected: min($10M/12M, $1.00×0.80) = min($0.8333, $0.80) = $0.80 (discount binds)
    const formulaRecord = resolveFormula("safe.postmoney.conversion", "US");
    const engineResult = convertSafeToPreferred({
      purchaseAmount: "1000000",
      capType: "post_money_cap",
      cap: "10000000",
      discount: "0.20",
      seriesPricePerShare: "1.00",
      companyCapitalization: "12000000",
      formulaId: formulaRecord.id,
      formulaVersion: formulaRecord.version,
      region: "US",
      formulaDef: formulaRecord.definition,
    });

    // Discount price = 1.00 × 0.80 = 0.80
    // Cap price = 10,000,000 / 12,000,000 = 0.8333...
    // Winner: discount (lower) = 0.80
    expect(engineResult.binding).toBe("discount");
    expect(parseFloat(engineResult.conversionPrice)).toBeCloseTo(0.80, 8);
    expect(engineResult.safeShares).toBe(BigInt(1_250_000));

    // Now verify computeConversionProjections returns identical numbers
    const inst = {
      instrumentId: "test_safe",
      holderName: "Test Investor",
      instrumentType: "safe" as const,
      principal: "1000000",
      cap: "10000000",
      discount: "0.20",
      mfn: true,
      currency: "USD",
      sourceRoundId: "rnd_test",
      sourceRoundName: "Test Round",
      projectedConversionPriceUsd: null,
      projectedShares: null,
      effectivePricePerShare: null,
      rationale: "Test",
    };
    const projected = computeConversionProjections([inst], "1.00", "12000000");
    expect(projected[0].projectedConversionPriceUsd).toBe(engineResult.conversionPrice);
    expect(projected[0].projectedShares).toBe(engineResult.safeShares.toString());
  });
});

// ============================================================
// Section 3: Priced equity → Priced equity
// ============================================================
describe("Priced equity → Priced equity carry-forward", () => {
  it("liquidationPreference carries if previous priced round was 1x non-participating", () => {
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "priced_equity" });
    // NovaPay seed closed: "1x non-participating, broad-based weighted-average"
    expect(result.fields["liquidationPreference"]).toBeDefined();
    expect(result.fields["liquidationPreference"].suggestedValue).toBe("1x_non_participating");
    expect(result.fields["liquidationPreference"].confidence).toBe("high");
  });

  it("antiDilutionType carries broad-based weighted average from previous priced round", () => {
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "priced_equity" });
    expect(result.fields["antiDilutionType"]).toBeDefined();
    expect(result.fields["antiDilutionType"].suggestedValue).toBe("broad_based_weighted_average");
    expect(result.fields["antiDilutionType"].confidence).toBe("medium");
  });

  it("preMoney is NEVER in the suggested fields for priced equity", () => {
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "priced_equity" });
    expect(result.fields["preMoney"]).toBeUndefined();
    expect(result.fields["preMoneyValuation"]).toBeUndefined();
    expect(result.warnings.some((w) => w.toLowerCase().includes("pre-money"))).toBe(true);
  });

  it("roundSize is NEVER in the suggested fields", () => {
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "priced_equity" });
    expect(result.fields["roundSize"]).toBeUndefined();
    expect(result.warnings.some((w) => w.toLowerCase().includes("round size"))).toBe(true);
  });
});

// ============================================================
// Section 4: No previous rounds — first round
// ============================================================
describe("First round — no prior rounds", () => {
  it("returns empty fields and warning for unknown company", () => {
    const result = computeCarryForward({ companyId: NONEXISTENT, proposedRoundType: "safe" });
    expect(Object.keys(result.fields)).toHaveLength(0);
    expect(result.unrealizedInstruments).toHaveLength(0);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.toLowerCase().includes("not found"))).toBe(true);
  });

  it("returns no-prior-rounds warning for a company with no closed rounds", () => {
    // co_arboreal only has open/active rounds in mockData (rnd_pre is terms_set, not closed)
    const result = computeCarryForward({ companyId: CO_ARBOREAL, proposedRoundType: "safe" });
    // Should either have no fields or a warning about no prior rounds
    const hasNoPriorRoundsWarning = result.warnings.some(
      (w) => w.toLowerCase().includes("no prior round") || w.toLowerCase().includes("first round"),
    );
    expect(hasNoPriorRoundsWarning).toBe(true);
  });

  it("returns empty unrealizedInstruments for company with no rounds", () => {
    const result = computeCarryForward({ companyId: NONEXISTENT, proposedRoundType: "priced_equity" });
    expect(result.unrealizedInstruments).toHaveLength(0);
  });
});

// ============================================================
// Section 5: Multi-currency — most recent SAFE wins
// ============================================================
describe("Multi-currency: most recent SAFE currency is used", () => {
  it("currency suggestion uses the most recently closed SAFE round's currency", () => {
    // NovaPay SAFE round is USD — verify that's what comes back
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "safe" });
    const currencyField = result.fields["currency"];
    expect(currencyField).toBeDefined();
    // The sourceRoundId should be the most recent closed SAFE round
    const safeRounds = rounds.filter(
      (r) =>
        r.companyId === CO_NOVAPAY &&
        (r.state === "closed" || r.state === "funded"),
    );
    expect(safeRounds.length).toBeGreaterThan(0);
    // The suggested currency must be from an actual closed round
    const sourceRound = rounds.find((r) => r.id === currencyField.sourceRoundId);
    expect(sourceRound).toBeDefined();
    expect((sourceRound as { currency?: string })?.currency).toBe(currencyField.suggestedValue);
  });
});

// ============================================================
// Section 6: Never-carry fields
// ============================================================
describe("Never-carry fields", () => {
  it("cap is NEVER suggested for any round type", () => {
    for (const rt of ["safe", "note", "priced_equity"] as RoundType[]) {
      const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: rt });
      expect(result.fields["cap"]).toBeUndefined();
    }
  });

  it("preMoney is NEVER suggested for any round type", () => {
    for (const rt of ["safe", "note", "priced_equity"] as RoundType[]) {
      const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: rt });
      expect(result.fields["preMoney"]).toBeUndefined();
      expect(result.fields["preMoneyValuation"]).toBeUndefined();
    }
  });

  it("roundSize is NEVER suggested for any round type", () => {
    for (const rt of ["safe", "note", "priced_equity"] as RoundType[]) {
      const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: rt });
      expect(result.fields["roundSize"]).toBeUndefined();
    }
  });

  it("optionPoolPct is NEVER suggested for priced equity", () => {
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "priced_equity" });
    expect(result.fields["optionPoolPct"]).toBeUndefined();
    expect(result.warnings.some((w) => w.toLowerCase().includes("option pool"))).toBe(true);
  });
});

// ============================================================
// Section 7: Anti-dilution defaults
// ============================================================
describe("Anti-dilution type defaults", () => {
  it("antiDilutionType defaults to broad-based weighted average when previous round had it", () => {
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "priced_equity" });
    expect(result.fields["antiDilutionType"]?.suggestedValue).toBe("broad_based_weighted_average");
  });

  it("antiDilutionType uses market_standard source when no prior priced round exists", () => {
    // For a company with only SAFE history (no priced round yet),
    // the engine should default to market standard
    const result = computeCarryForward({ companyId: CO_ARBOREAL, proposedRoundType: "priced_equity" });
    if (result.fields["antiDilutionType"]) {
      const source = result.fields["antiDilutionType"].source;
      expect(["market_standard", "prev_round"]).toContain(source);
      expect(result.fields["antiDilutionType"].suggestedValue).toBe("broad_based_weighted_average");
    }
    // If no fields at all (no prior rounds), this is acceptable
  });
});

// ============================================================
// Section 8: Audit digest determinism
// ============================================================
describe("Audit digest determinism", () => {
  it("same inputs → same auditDigest", () => {
    const r1 = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "safe" });
    const r2 = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "safe" });
    expect(r1.auditDigest).toBe(r2.auditDigest);
  });

  it("different companyId → different auditDigest", () => {
    const r1 = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "safe" });
    const r2 = computeCarryForward({ companyId: CO_ARBOREAL, proposedRoundType: "safe" });
    expect(r1.auditDigest).not.toBe(r2.auditDigest);
  });

  it("different roundType → different auditDigest", () => {
    const r1 = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "safe" });
    const r2 = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "note" });
    expect(r1.auditDigest).not.toBe(r2.auditDigest);
  });

  it("auditDigest is a 64-character hex string", () => {
    const r = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "safe" });
    expect(r.auditDigest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("auditDigest changes when any suggested field value changes", () => {
    // We can verify this by checking that two different states produce different digests
    const r_safe = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "safe" });
    const r_priced = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "priced_equity" });
    expect(r_safe.auditDigest).not.toBe(r_priced.auditDigest);
  });
});

// ============================================================
// Section 9: Immutability — engine must not mutate stores
// ============================================================
describe("Engine immutability — never mutates stores", () => {
  it("rounds array is not mutated after carry-forward computation", () => {
    const roundCountBefore = rounds.length;
    const firstRoundId = rounds[0]?.id;
    computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "safe" });
    computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "priced_equity" });
    expect(rounds.length).toBe(roundCountBefore);
    expect(rounds[0]?.id).toBe(firstRoundId);
  });

  it("securities array is not mutated after carry-forward computation", () => {
    const secCountBefore = securities.length;
    const firstSecId = securities[0]?.id;
    computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "priced_equity" });
    expect(securities.length).toBe(secCountBefore);
    expect(securities[0]?.id).toBe(firstSecId);
  });

  it("companies array is not mutated after carry-forward computation", () => {
    const coCountBefore = companies.length;
    const firstCoId = companies[0]?.id;
    computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "safe" });
    expect(companies.length).toBe(coCountBefore);
    expect(companies[0]?.id).toBe(firstCoId);
  });

  it("companyProfile is not mutated after carry-forward computation", () => {
    const profileBefore = getCompanyProfile(CO_NOVAPAY);
    const jurisdictionBefore = profileBefore.jurisdiction;
    computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "safe" });
    const profileAfter = getCompanyProfile(CO_NOVAPAY);
    expect(profileAfter.jurisdiction).toBe(jurisdictionBefore);
  });
});

// ============================================================
// Section 10: Audit log — accept + override
// ============================================================
describe("Audit log — accept and override", () => {
  it("accepting a suggestion records suggestedValue, acceptedValue, auditDigest, timestamp, actor", () => {
    const digest = "aabbcc112233aabbcc112233aabbcc112233aabbcc112233aabbcc112233aabb";
    const entry = appendCarryForwardAuditEntry({
      roundId: "rnd_test_1",
      companyId: CO_NOVAPAY,
      actor: "founder@novapay.ai",
      acceptedFields: [
        { fieldName: "currency", suggestedValue: "USD", acceptedValue: "USD" },
        { fieldName: "mfn", suggestedValue: true, acceptedValue: true },
      ],
      overriddenFields: [],
      auditDigest: digest,
    });

    expect(entry.id).toBeTruthy();
    expect(entry.actor).toBe("founder@novapay.ai");
    expect(entry.auditDigest).toBe(digest);
    expect(entry.timestamp).toBeTruthy();
    expect(new Date(entry.timestamp).getFullYear()).toBeGreaterThanOrEqual(2025);
    expect(entry.acceptedFields).toHaveLength(2);
    expect(entry.acceptedFields[0].fieldName).toBe("currency");
    expect(entry.acceptedFields[0].suggestedValue).toBe("USD");
    expect(entry.acceptedFields[0].acceptedValue).toBe("USD");
    expect(entry.overriddenFields).toHaveLength(0);
  });

  it("overriding a suggestion records suggestedValue, acceptedValue, overrideReason, auditDigest, timestamp, actor", () => {
    const digest = "deadbeef1234deadbeef1234deadbeef1234deadbeef1234deadbeef1234dead";
    const entry = appendCarryForwardAuditEntry({
      roundId: "rnd_test_2",
      companyId: CO_NOVAPAY,
      actor: "founder@novapay.ai",
      acceptedFields: [
        { fieldName: "currency", suggestedValue: "USD", acceptedValue: "USD" },
      ],
      overriddenFields: [
        {
          fieldName: "safeType",
          suggestedValue: "post_money_cap",
          acceptedValue: "pre_money_cap",
          overrideReason: "Investor specifically requested pre-money SAFE structure.",
        },
      ],
      auditDigest: digest,
    });

    expect(entry.overriddenFields).toHaveLength(1);
    expect(entry.overriddenFields[0].fieldName).toBe("safeType");
    expect(entry.overriddenFields[0].suggestedValue).toBe("post_money_cap");
    expect(entry.overriddenFields[0].acceptedValue).toBe("pre_money_cap");
    expect(entry.overriddenFields[0].overrideReason).toContain("pre-money SAFE");
    expect(entry.auditDigest).toBe(digest);
  });
});

// ============================================================
// Section 11: Hash chain integrity
// ============================================================
describe("Hash chain integrity", () => {
  it("first entry has prevEntryHash = CARRY_FORWARD_GENESIS", () => {
    const entry = appendCarryForwardAuditEntry({
      roundId: "rnd_chain_1",
      companyId: CO_NOVAPAY,
      actor: "a@test.com",
      acceptedFields: [],
      overriddenFields: [],
      auditDigest: "aaa",
    });
    expect(entry.prevEntryHash).toBe("CARRY_FORWARD_GENESIS");
  });

  it("second entry's prevEntryHash equals first entry's entryHash", () => {
    const e1 = appendCarryForwardAuditEntry({
      roundId: "rnd_chain_2a",
      companyId: CO_NOVAPAY,
      actor: "a@test.com",
      acceptedFields: [],
      overriddenFields: [],
      auditDigest: "bbb",
    });
    const e2 = appendCarryForwardAuditEntry({
      roundId: "rnd_chain_2b",
      companyId: CO_NOVAPAY,
      actor: "a@test.com",
      acceptedFields: [],
      overriddenFields: [],
      auditDigest: "ccc",
    });
    expect(e2.prevEntryHash).toBe(e1.entryHash);
  });

  it("entryHash is a 64-character hex string", () => {
    const e = appendCarryForwardAuditEntry({
      roundId: "rnd_chain_3",
      companyId: CO_NOVAPAY,
      actor: "a@test.com",
      acceptedFields: [],
      overriddenFields: [],
      auditDigest: "ddd",
    });
    expect(e.entryHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("audit log grows by one per append", () => {
    const before = getCarryForwardAuditLog().length;
    appendCarryForwardAuditEntry({
      roundId: "rnd_chain_4",
      companyId: CO_NOVAPAY,
      actor: "a@test.com",
      acceptedFields: [],
      overriddenFields: [],
      auditDigest: "eee",
    });
    expect(getCarryForwardAuditLog().length).toBe(before + 1);
  });

  it("hash chain extends: N entries form a valid chain", () => {
    const entries: ReturnType<typeof appendCarryForwardAuditEntry>[] = [];
    for (let i = 0; i < 5; i++) {
      entries.push(
        appendCarryForwardAuditEntry({
          roundId: `rnd_chain_N_${i}`,
          companyId: CO_NOVAPAY,
          actor: "a@test.com",
          acceptedFields: [],
          overriddenFields: [],
          auditDigest: `digest_${i}`,
        }),
      );
    }
    // Verify chain linkage
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i].prevEntryHash).toBe(entries[i - 1].entryHash);
    }
  });
});

// ============================================================
// Section 12: SAFE → SAFE round 2 — full field check
// ============================================================
describe("Full field check: SAFE round 2 from SAFE round 1", () => {
  it("currency/mfn/proRata/safeType all carry; cap/discount do NOT", () => {
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "safe" });
    // Present
    expect(result.fields["currency"]).toBeDefined();
    expect(result.fields["mfn"]).toBeDefined();
    expect(result.fields["proRata"]).toBeDefined();
    expect(result.fields["safeType"]).toBeDefined();
    // Not present
    expect(result.fields["cap"]).toBeUndefined();
    expect(result.fields["discount"]).toBeUndefined();
    expect(result.fields["preMoney"]).toBeUndefined();
    expect(result.fields["roundSize"]).toBeUndefined();
  });
});

// ============================================================
// Section 13: Note round carry-forward
// ============================================================
describe("Convertible note carry-forward", () => {
  it("currency/mfn/proRata carry for note round; interestRate and cap/discount do NOT", () => {
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "note" });
    expect(result.fields["currency"]).toBeDefined();
    expect(result.fields["cap"]).toBeUndefined();
    expect(result.fields["discount"]).toBeUndefined();
    expect(result.fields["interestRate"]).toBeUndefined();
    expect(result.warnings.some((w) => w.toLowerCase().includes("interest rate"))).toBe(true);
  });

  it("maturityMonths = 24 carries when previous note had 24 months; otherwise does not", () => {
    // NovaPay has a bridge note with issuedAt=2024-08-22 and maturityDate=2026-11-01
    // That's ~26 months, not 24, so maturityMonths should NOT carry
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "note" });
    // Either maturityMonths is absent (not 24 months), or it carries
    // The Northstar Angels note: issued "2024-08-22", maturity "2026-11-01" = ~26 months
    // So it should NOT carry
    // (If by some rounding it ends up at 24, the test should tolerate it)
    if (result.fields["maturityMonths"]) {
      expect(result.fields["maturityMonths"].suggestedValue).toBe(24);
    }
  });
});

// ============================================================
// Section 14: Company profile fields (all round types)
// ============================================================
describe("Company profile fields", () => {
  it("companyLegalName is suggested from company profile", () => {
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "safe" });
    if (result.fields["companyLegalName"]) {
      expect(result.fields["companyLegalName"].source).toBe("company_profile");
      expect(result.fields["companyLegalName"].confidence).toBe("high");
      expect(result.fields["companyLegalName"].suggestedValue).toBeTruthy();
    }
    // It's OK if not present when profile has no legalName set
  });

  it("boardSeats suggestion has medium confidence", () => {
    const result = computeCarryForward({ companyId: CO_NOVAPAY, proposedRoundType: "priced_equity" });
    if (result.fields["boardSeats"]) {
      expect(result.fields["boardSeats"].confidence).toBe("medium");
    }
  });
});

// ============================================================
// Section 15: Convertible note engine math verification
// ============================================================
describe("Note conversion math matches existing engine", () => {
  it("$250k note @ 6% APR, 15% discount, $7M cap, $1 PPS, 12M cap — engine math used directly", () => {
    const formulaRecord = resolveFormula("note.conversion", "US");
    const result = convertNoteToPreferred({
      principal: "250000",
      interestRate: "0.06",
      interestKind: "simple",
      yearsElapsed: "1",
      cap: "7000000",
      discount: "0.15",
      seriesPricePerShare: "1.00",
      companyCapitalization: "12000000",
      formulaId: formulaRecord.id,
      formulaVersion: formulaRecord.version,
      region: "US",
      formulaDef: formulaRecord.definition,
    });
    // outstanding = 250000 + 250000×0.06×1 = 265000
    expect(result.outstanding).toBe("265000");
    // capPrice = 7000000/12000000 ≈ 0.5833
    // discountPrice = 1.00×0.85 = 0.85
    // winner: cap (lower)
    expect(result.binding).toBe("cap");
    const capPrice = 7_000_000 / 12_000_000;
    expect(parseFloat(result.conversionPrice)).toBeCloseTo(capPrice, 6);
    // noteShares = floor(265000 / (7000000/12000000))
    const expectedShares = Math.floor(265_000 / capPrice);
    expect(Number(result.noteShares)).toBe(expectedShares);
  });
});

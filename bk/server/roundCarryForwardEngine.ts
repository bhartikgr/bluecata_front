/**
 * Round Carry-Forward Engine — investor-grade derivation of new-round
 * baselines from previously-closed round state.
 *
 * NEVER MUTATES cap-table state. Pure read + pure compute.
 *
 * Philosophy:
 *   We SUGGEST values to founders; we NEVER auto-populate.
 *   Every suggestion carries full provenance, a confidence level, and a
 *   human-readable rationale so the founder can make an informed decision.
 *   High-risk fields (cap, preMoney, discount, roundSize) are NEVER suggested.
 *
 * Inputs:  companyId, proposedRoundType, optional proposedRoundCurrency
 * Outputs: CarryForwardResult with:
 *   - fields: fieldName → suggestion object with provenance
 *   - unrealizedInstruments: list of unconverted SAFEs/notes (priced-equity only)
 *   - warnings: things the founder must verify manually
 *   - auditDigest: SHA-256 of the suggestion (proves exactly what was shown)
 */
import { createHash } from "node:crypto";
/* v25.17 Lane A NC5 — was importing companies/rounds/securities directly from
   ./mockData, so DB-backed runtime rounds/securities were invisible to the
   carry-forward engine. Now we read mockData as a seed AND merge in DB-backed
   rounds from roundsStore. Securities still live in the mockData seed because
   the engine relies on the rich SAFE/Note shape; a securitiesStore migration
   is queued as a follow-on, but the rounds + companies side now reflects
   live data so newly-created rounds participate in carry-forward. */
import { companies as seedCompanies, rounds as seedRounds, securities } from "./mockData";
import { listRounds } from "./roundsStore";
import { getCompanyProfile } from "./companyProfileStore";

/* Lazy view: union of seed rounds (rich, demo) and DB-backed rounds from
   roundsStore. Seed rows are kept so engine tests remain green; DB rows win
   on id collision. */
const rounds: typeof seedRounds = new Proxy(seedRounds, {
  get(target, prop, receiver) {
    if (prop === Symbol.iterator || prop === "length" || (typeof prop === "string" && /^\d+$/.test(prop)) || prop === "filter" || prop === "find" || prop === "map" || prop === "forEach" || prop === "some" || prop === "every" || prop === "reduce") {
      // Build a unified array on each access (engine reads are infrequent and
      // small). DB rounds shadow seed rounds when ids overlap.
      let merged = target as unknown as Array<{ id: string }>;
      try {
        const live = listRounds() as unknown as Array<{ id: string }>;
        const liveIds = new Set(live.map((r) => r.id));
        merged = [...live, ...(target as unknown as Array<{ id: string }>).filter((r) => !liveIds.has(r.id))];
      } catch { /* roundsStore not yet hydrated; fall back to seed */ }
      const arr = merged as unknown as typeof seedRounds;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const v = (arr as any)[prop];
      return typeof v === "function" ? v.bind(arr) : v;
    }
    return Reflect.get(target, prop, receiver);
  },
});
const companies = seedCompanies;
import {
  convertSafeToPreferred,
  convertNoteToPreferred,
  resolveFormula,
} from "@capavate/cap-table-engine";

// ─── Public types ──────────────────────────────────────────────────────────

export type RoundType = "safe" | "note" | "priced_equity";

export type SuggestionSource =
  | "prev_round"
  | "company_profile"
  | "platform_default"
  | "market_standard";

export type Confidence = "high" | "medium" | "low";

export interface CarryForwardSuggestion {
  fieldName: string;
  suggestedValue: unknown;
  source: SuggestionSource;
  sourceRoundId?: string;
  sourceRoundName?: string;
  sourceRoundClosedAt?: string;
  confidence: Confidence;
  rationale: string;
  warnings: string[];
}

export interface UnrealizedInstrument {
  instrumentId: string;
  holderName: string;
  instrumentType: "safe" | "note";
  principal: string;               // Decimal-as-string
  cap: string | null;
  discount: string | null;         // 0..1 decimal string, e.g. "0.20"
  mfn: boolean;
  currency: string;
  sourceRoundId: string;
  sourceRoundName: string;
  /** Conversion price in USD per share (Decimal-as-string). Only computable if
   *  the caller provides seriesPricePerShare + companyCapitalization. When
   *  those are unknown at suggestion time, this is null. */
  projectedConversionPriceUsd: string | null;
  projectedShares: string | null;
  effectivePricePerShare: string | null;
  rationale: string;
}

export interface CarryForwardResult {
  companyId: string;
  proposedRoundType: RoundType;
  computedAt: string;                        // ISO timestamp
  fields: Record<string, CarryForwardSuggestion>;
  unrealizedInstruments: UnrealizedInstrument[];
  warnings: string[];
  /** SHA-256 of the canonical JSON of the entire result (excluding this field).
   *  Deterministic: same inputs → same digest every time. */
  auditDigest: string;
}

// ─── Internal helpers ──────────────────────────────────────────────────────

/**
 * Stable JSON serialisation for audit hashing.
 * Keys are sorted at every level; arrays preserve order.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const o = value as Record<string, unknown>;
  const keys = Object.keys(o).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(o[k])).join(",") + "}";
}

/**
 * v25.19 Lane 2 NC1 (hard close of v25.18 NC3 false closure):
 *   The digest must be DETERMINISTIC — same inputs, same output — because
 *   the server recomputes it on accept and 409s when client-supplied and
 *   server-computed digests differ. The previous version hashed the LIVE
 *   `computedAt` ISO timestamp into the body, so every accept arrived
 *   milliseconds after the GET that produced the digest, and the recompute
 *   produced a different timestamp — EVERY legitimate accept returned 409
 *   AUDIT_DIGEST_STALE. Empirically reproduced by Lane 2 (7ms apart).
 *
 *   Fix: strip `computedAt` (and any other wall-clock fields) from the
 *   digest body. The timestamp is still RETURNED in the result for display
 *   and audit-log timestamping; it just isn't hashed into the integrity
 *   digest.
 */
function computeDigest(payload: unknown): string {
  let body: unknown = payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    // Re-build without `computedAt` so the digest is wall-clock-independent.
    const { computedAt: _omit, ...rest } = payload as Record<string, unknown> & { computedAt?: unknown };
    body = rest;
  }
  return createHash("sha256").update(stableStringify(body), "utf8").digest("hex");
}

type RoundRecord = (typeof rounds)[number];
type SecurityRecord = (typeof securities)[number];

function isClosedRound(r: RoundRecord): boolean {
  return r.state === "closed" || r.state === "funded";
}

function getRoundType(r: RoundRecord): "safe" | "note" | "priced_equity" | "other" {
  const t = r.type?.toLowerCase() ?? "";
  if (t === "safe" || t === "preseed" || t === "pre_seed") {
    // Check securities for this round to confirm instrument type
    return "safe";
  }
  if (t === "note" || t === "bridge") return "note";
  if (
    t === "seed" || t === "series_a" || t === "series_b" ||
    t === "series_c" || t === "series_d" || t === "priced"
  ) return "priced_equity";
  return "other";
}

function getRoundInstrumentType(r: RoundRecord): "safe" | "note" | "priced_equity" | "other" {
  // Prioritise inspection of actual securities over the round.type label
  const secs = securities.filter((s) => s.roundId === r.id);
  if (secs.some((s) => s.instrument === "safe")) return "safe";
  if (secs.some((s) => s.instrument === "note")) return "note";
  if (secs.some((s) => s.instrument === "preferred")) return "priced_equity";
  // fall back to type label heuristic
  return getRoundType(r);
}

/**
 * Returns closed rounds for a company, sorted ascending by closeDate.
 */
function getClosedRounds(companyId: string): RoundRecord[] {
  return rounds
    .filter((r) => r.companyId === companyId && isClosedRound(r))
    .slice()
    .sort((a, b) => {
      const da = (a as { closeDate?: string }).closeDate ?? "";
      const db = (b as { closeDate?: string }).closeDate ?? "";
      return da < db ? -1 : da > db ? 1 : 0;
    });
}

/**
 * Returns the most recent closed round of a given instrument type.
 */
function getMostRecentClosedRoundOfType(
  companyId: string,
  instrumentType: "safe" | "note" | "priced_equity",
): RoundRecord | null {
  const closed = getClosedRounds(companyId);
  const matching = closed.filter((r) => getRoundInstrumentType(r) === instrumentType);
  return matching.length > 0 ? matching[matching.length - 1] : null;
}

/**
 * Returns all unrealized (unconverted) SAFE / note instruments for a company.
 * "Unconverted" = the instrument is in a CLOSED round but the issuing round
 * type is safe/note (not priced equity).
 */
function getUnrealizedInstruments(companyId: string): SecurityRecord[] {
  const closedRounds = getClosedRounds(companyId);
  const closedRoundIds = new Set(closedRounds.map((r) => r.id));
  const priced = new Set(
    closedRounds
      .filter((r) => getRoundInstrumentType(r) === "priced_equity")
      .map((r) => r.id),
  );
  return securities.filter(
    (s) =>
      s.companyId === companyId &&
      (s.instrument === "safe" || s.instrument === "note") &&
      closedRoundIds.has(s.roundId) &&
      !priced.has(s.roundId),
  );
}

/** Percent discount on the security record (stored as 0-100 integer in mockData, engine wants 0-1). */
function discountAsDecimalStr(rawDiscount: number | null | undefined): string | null {
  if (rawDiscount == null) return null;
  return (rawDiscount / 100).toFixed(6);
}

// ─── Per-round-type carry-forward logic ────────────────────────────────────

function buildSafeCarryForward(
  companyId: string,
  prevRound: RoundRecord | null,
  warnings: string[],
): Record<string, CarryForwardSuggestion> {
  const fields: Record<string, CarryForwardSuggestion> = {};

  if (!prevRound) {
    warnings.push("No prior rounds — carry-forward not available");
    return fields;
  }

  const prevSecs = securities.filter(
    (s) => s.roundId === prevRound.id && s.instrument === "safe",
  );
  const exampleSec = prevSecs[0] as
    | (SecurityRecord & {
        instrument: "safe";
        mfn?: boolean;
        proRata?: boolean;
      })
    | undefined;

  const currency = (prevRound as { currency?: string }).currency ?? "USD";
  const closedAt = (prevRound as { closeDate?: string }).closeDate ?? "";

  // currency — high confidence carry
  fields.currency = {
    fieldName: "currency",
    suggestedValue: currency,
    source: "prev_round",
    sourceRoundId: prevRound.id,
    sourceRoundName: prevRound.name,
    sourceRoundClosedAt: closedAt,
    confidence: "high",
    rationale: `Carried from ${prevRound.name} (closed ${closedAt}). Most founders keep currency consistent across SAFE rounds.`,
    warnings: [],
  };

  // cap — NEVER suggested; show warning only
  warnings.push(
    "Valuation cap is not carried forward — caps are round-specific and must be set explicitly based on current market conditions.",
  );

  // discount — NEVER suggested
  warnings.push(
    "Discount rate is not carried forward — discount terms are round-specific and must be set explicitly.",
  );

  // MFN — medium confidence carry from previous SAFE
  if (exampleSec) {
    const mfnValue =
      exampleSec.sideLetter?.toLowerCase().includes("mfn") ??
      (exampleSec as { mfn?: boolean }).mfn ??
      false;
    fields.mfn = {
      fieldName: "mfn",
      suggestedValue: mfnValue,
      source: "prev_round",
      sourceRoundId: prevRound.id,
      sourceRoundName: prevRound.name,
      sourceRoundClosedAt: closedAt,
      confidence: "medium",
      rationale:
        "Most founders maintain a consistent MFN policy across SAFE rounds. Derived from " +
        `${prevRound.name} (${mfnValue ? "MFN: yes" : "MFN: no"}).`,
      warnings: ["Verify MFN policy with counsel before accepting."],
    };
  }

  // proRata — medium confidence carry
  if (exampleSec) {
    const proRata = exampleSec.proRata ?? false;
    fields.proRata = {
      fieldName: "proRata",
      suggestedValue: proRata,
      source: "prev_round",
      sourceRoundId: prevRound.id,
      sourceRoundName: prevRound.name,
      sourceRoundClosedAt: closedAt,
      confidence: "medium",
      rationale:
        "Pro-rata right from prior SAFE round. Founders often maintain consistent pro-rata policy to treat investors equitably.",
      warnings: [],
    };
  }

  // safeType (post_money_cap / pre_money_cap / etc.) — high confidence carry
  if (exampleSec) {
    // Derive from the series label or sideLetter heuristic
    const seriesLabel = (exampleSec.series ?? "").toLowerCase();
    const safeType = seriesLabel.includes("post")
      ? "post_money_cap"
      : seriesLabel.includes("pre")
        ? "pre_money_cap"
        : "post_money_cap"; // default to YC v1.2 post-money
    fields.safeType = {
      fieldName: "safeType",
      suggestedValue: safeType,
      source: "prev_round",
      sourceRoundId: prevRound.id,
      sourceRoundName: prevRound.name,
      sourceRoundClosedAt: closedAt,
      confidence: "high",
      rationale: `SAFE type (${safeType}) inferred from ${prevRound.name}. Post-money YC v1.2 is the current market standard.`,
      warnings: [],
    };
  }

  return fields;
}

function buildNoteCarryForward(
  companyId: string,
  prevRound: RoundRecord | null,
  warnings: string[],
): Record<string, CarryForwardSuggestion> {
  const fields: Record<string, CarryForwardSuggestion> = {};

  if (!prevRound) {
    warnings.push("No prior rounds — carry-forward not available");
    return fields;
  }

  const prevSecs = securities.filter(
    (s) => s.roundId === prevRound.id && (s.instrument === "safe" || s.instrument === "note"),
  );
  const exampleSec = prevSecs[0];
  const currency = (prevRound as { currency?: string }).currency ?? "USD";
  const closedAt = (prevRound as { closeDate?: string }).closeDate ?? "";

  // currency
  fields.currency = {
    fieldName: "currency",
    suggestedValue: currency,
    source: "prev_round",
    sourceRoundId: prevRound.id,
    sourceRoundName: prevRound.name,
    sourceRoundClosedAt: closedAt,
    confidence: "high",
    rationale: `Carried from ${prevRound.name} (closed ${closedAt}).`,
    warnings: [],
  };

  // mfn — medium confidence
  if (exampleSec) {
    const mfnValue =
      exampleSec.sideLetter?.toLowerCase().includes("mfn") ??
      (exampleSec as { mfn?: boolean }).mfn ??
      false;
    fields.mfn = {
      fieldName: "mfn",
      suggestedValue: mfnValue,
      source: "prev_round",
      sourceRoundId: prevRound.id,
      sourceRoundName: prevRound.name,
      sourceRoundClosedAt: closedAt,
      confidence: "medium",
      rationale: "MFN policy from prior round. Verify with counsel.",
      warnings: ["Verify MFN policy with counsel before accepting."],
    };
  }

  // proRata — medium confidence
  if (exampleSec) {
    const proRata = exampleSec.proRata ?? false;
    fields.proRata = {
      fieldName: "proRata",
      suggestedValue: proRata,
      source: "prev_round",
      sourceRoundId: prevRound.id,
      sourceRoundName: prevRound.name,
      sourceRoundClosedAt: closedAt,
      confidence: "medium",
      rationale: "Pro-rata right from prior round.",
      warnings: [],
    };
  }

  // interestRate — NOT carried (market-dependent)
  warnings.push(
    "Interest rate is not carried forward — rates are market-dependent and must be set based on current conditions.",
  );

  // maturityMonths — only carry if previous note had 24 months
  const noteSec = prevSecs.find((s) => s.instrument === "note") as
    | (SecurityRecord & { maturityDate?: string; issuedAt?: string })
    | undefined;
  if (noteSec?.maturityDate && noteSec.issuedAt) {
    const issued = new Date(noteSec.issuedAt).getTime();
    const maturity = new Date(noteSec.maturityDate).getTime();
    const months = Math.round((maturity - issued) / (30.44 * 86_400_000));
    if (months === 24) {
      fields.maturityMonths = {
        fieldName: "maturityMonths",
        suggestedValue: 24,
        source: "prev_round",
        sourceRoundId: prevRound.id,
        sourceRoundName: prevRound.name,
        sourceRoundClosedAt: closedAt,
        confidence: "medium",
        rationale: "Previous note had a 24-month maturity — 24 months is the market standard for bridge notes.",
        warnings: [],
      };
    } else {
      warnings.push(
        `Previous note had a ${months}-month maturity (not 24 months) — maturity is not carried forward.`,
      );
    }
  }

  // cap / discount — NEVER suggested
  warnings.push("Valuation cap is not carried forward — must be set explicitly.");
  warnings.push("Discount rate is not carried forward — must be set explicitly.");

  return fields;
}

function buildPricedEquityCarryForward(
  companyId: string,
  prevRound: RoundRecord | null,
  warnings: string[],
  companyIdParam: string,
): Record<string, CarryForwardSuggestion> {
  const fields: Record<string, CarryForwardSuggestion> = {};

  // preMoney — NEVER suggested
  warnings.push(
    "Pre-money valuation is not carried forward — it must be set based on your current market conversation and investor feedback.",
  );

  // roundSize — NEVER suggested
  warnings.push(
    "Round size is not carried forward — it must be set explicitly based on your capital needs and investor commitments.",
  );

  // optionPoolPct — NEVER suggested
  warnings.push(
    "Option pool percentage is not carried forward — market expectation is typically 10–20% and should be agreed with lead investor.",
  );

  if (!prevRound) {
    warnings.push("No prior rounds — carry-forward not available");
    return fields;
  }

  const closedAt = (prevRound as { closeDate?: string }).closeDate ?? "";

  // Check the immediately preceding round for liquidation preference + anti-dilution
  const prevPricedRound = getMostRecentClosedRoundOfType(companyIdParam, "priced_equity");
  if (prevPricedRound) {
    const prevPricedSecs = securities.filter(
      (s) => s.roundId === prevPricedRound.id && s.instrument === "preferred",
    );
    const examplePref = prevPricedSecs[0] as
      | (SecurityRecord & {
          liquidationPreference?: number;
          antiDilutionType?: string;
        })
      | undefined;

    // liquidationPreference — carry if previous was 1x non-participating
    const liqPref = examplePref?.liquidationPreference ?? 1;
    const prevTermsSummary = (prevPricedRound as { termsSummary?: string }).termsSummary ?? "";
    const isNonParticipating =
      prevTermsSummary.toLowerCase().includes("non-participating") ||
      prevTermsSummary.toLowerCase().includes("non participating") ||
      liqPref === 1;
    if (liqPref === 1 && isNonParticipating) {
      fields.liquidationPreference = {
        fieldName: "liquidationPreference",
        suggestedValue: "1x_non_participating",
        source: "prev_round",
        sourceRoundId: prevPricedRound.id,
        sourceRoundName: prevPricedRound.name,
        sourceRoundClosedAt: (prevPricedRound as { closeDate?: string }).closeDate ?? "",
        confidence: "high",
        rationale: `1x non-participating liquidation preference was used in ${prevPricedRound.name}. This is the NVCA market standard for early-stage priced rounds.`,
        warnings: ["Verify with lead investor — some Series A+ investors request participating preference."],
      };
    } else {
      warnings.push(
        `Previous priced round (${prevPricedRound.name}) had a non-standard liquidation preference (${liqPref}x). Review with counsel before setting.`,
      );
    }

    // antiDilutionType — medium confidence carry
    const antiDilType = examplePref?.antiDilutionType ??
      (prevTermsSummary.toLowerCase().includes("broad-based") ||
       prevTermsSummary.toLowerCase().includes("broad based")
        ? "broad_based_weighted_average"
        : "broad_based_weighted_average"); // market standard default
    fields.antiDilutionType = {
      fieldName: "antiDilutionType",
      suggestedValue: antiDilType,
      source: prevPricedRound
        ? "prev_round"
        : "market_standard",
      sourceRoundId: prevPricedRound.id,
      sourceRoundName: prevPricedRound.name,
      sourceRoundClosedAt: (prevPricedRound as { closeDate?: string }).closeDate ?? "",
      confidence: "medium",
      rationale:
        "Broad-based weighted-average anti-dilution is the NVCA market standard for early-stage companies. Derived from previous priced round.",
      warnings: [],
    };
  } else {
    // No prior priced round — use market standard defaults
    fields.liquidationPreference = {
      fieldName: "liquidationPreference",
      suggestedValue: "1x_non_participating",
      source: "market_standard",
      confidence: "high",
      rationale:
        "1x non-participating is the NVCA market standard for early-stage priced rounds (NVCA Model Charter §4.4).",
      warnings: ["Verify with lead investor — some investors request participating preference."],
    };
    fields.antiDilutionType = {
      fieldName: "antiDilutionType",
      suggestedValue: "broad_based_weighted_average",
      source: "market_standard",
      confidence: "medium",
      rationale:
        "Broad-based weighted-average anti-dilution is the NVCA market standard for early-stage companies.",
      warnings: [],
    };
  }

  return fields;
}

function buildCompanyProfileFields(
  companyId: string,
  warnings: string[],
): Record<string, CarryForwardSuggestion> {
  const fields: Record<string, CarryForwardSuggestion> = {};
  const profile = getCompanyProfile(companyId);

  if (profile.companyId) {
    // companyLegalName
    const legalName =
      (profile as { legalName?: string }).legalName ??
      companies.find((c) => c.id === companyId)?.legalName;
    if (legalName) {
      fields.companyLegalName = {
        fieldName: "companyLegalName",
        suggestedValue: legalName,
        source: "company_profile",
        confidence: "high",
        rationale: "Legal name from company profile — verify before executing documents.",
        warnings: [],
      };
    }

    // companyJurisdiction
    const jurisdiction = profile.jurisdiction ?? profile.regulatoryRegion;
    if (jurisdiction) {
      fields.companyJurisdiction = {
        fieldName: "companyJurisdiction",
        suggestedValue: jurisdiction,
        source: "company_profile",
        confidence: "high",
        rationale: "Jurisdiction from company profile.",
        warnings: [],
      };
    }

    // defaultLegalCounsel — low confidence (verify)
    const counsel = (profile as { legalCounselFirm?: string }).legalCounselFirm;
    if (counsel) {
      fields.defaultLegalCounsel = {
        fieldName: "defaultLegalCounsel",
        suggestedValue: counsel,
        source: "company_profile",
        confidence: "low",
        rationale: "Legal counsel from company profile — verify that this counsel is engaged for this round.",
        warnings: ["Confirm that this counsel is actively engaged for this round."],
      };
    }

    // boardSeats — medium confidence
    const boardSize = profile.board_size ?? profile.advisorBoardSize;
    if (boardSize != null) {
      fields.boardSeats = {
        fieldName: "boardSeats",
        suggestedValue: boardSize,
        source: "company_profile",
        confidence: "medium",
        rationale: "Board size from company profile. Verify whether new round adds investor-designated board seats.",
        warnings: ["Confirm board composition with legal counsel — new investors may require designated seats."],
      };
    }
  }

  return fields;
}

function buildUnrealizedInstruments(companyId: string): UnrealizedInstrument[] {
  const unrealized = getUnrealizedInstruments(companyId);
  const result: UnrealizedInstrument[] = [];

  for (const sec of unrealized) {
    const sourceRound = rounds.find((r) => r.id === sec.roundId);
    const currency = (sourceRound as { currency?: string })?.currency ?? "USD";
    const closedAt = (sourceRound as { closeDate?: string })?.closeDate ?? "";

    if (sec.instrument === "safe") {
      const discountDecStr = discountAsDecimalStr(sec.discount as number | null);
      const capStr = sec.cap != null ? String(sec.cap) : null;
      const mfnValue =
        sec.sideLetter?.toLowerCase().includes("mfn") ??
        (sec as { mfn?: boolean }).mfn ??
        false;

      const rationale =
        capStr && discountDecStr
          ? `This SAFE will convert at the lesser of the cap-implied price (${capStr} cap ÷ post-close capitalization) and the round price × (1 − ${(parseFloat(discountDecStr) * 100).toFixed(0)}% discount) per its terms.`
          : capStr
            ? `This SAFE will convert at the cap-implied price (${capStr} cap ÷ post-close capitalization) per its terms.`
            : discountDecStr
              ? `This SAFE will convert at round price × (1 − ${(parseFloat(discountDecStr) * 100).toFixed(0)}% discount) per its terms.`
              : "This SAFE will convert at round price (no cap, no discount).";

      result.push({
        instrumentId: sec.id,
        holderName: sec.holderName,
        instrumentType: "safe",
        principal: String(sec.investmentAmount ?? 0),
        cap: capStr,
        discount: discountDecStr,
        mfn: mfnValue,
        currency,
        sourceRoundId: sec.roundId,
        sourceRoundName: sourceRound?.name ?? sec.roundId,
        // Conversion price requires seriesPricePerShare + companyCapitalization,
        // which are unknown at suggestion time (they're in the new round being created).
        // We note this explicitly.
        projectedConversionPriceUsd: null,
        projectedShares: null,
        effectivePricePerShare: null,
        rationale,
      });
    } else if (sec.instrument === "note") {
      const noteFields = sec as SecurityRecord & {
        interestRate?: number;
        maturityDate?: string;
        accruedInterest?: number;
      };
      const discountDecStr = discountAsDecimalStr(sec.discount as number | null);
      const capStr = sec.cap != null ? String(sec.cap) : null;

      result.push({
        instrumentId: sec.id,
        holderName: sec.holderName,
        instrumentType: "note",
        principal: String(sec.investmentAmount ?? 0),
        cap: capStr,
        discount: discountDecStr,
        mfn: sec.sideLetter?.toLowerCase().includes("mfn") ?? false,
        currency,
        sourceRoundId: sec.roundId,
        sourceRoundName: sourceRound?.name ?? sec.roundId,
        projectedConversionPriceUsd: null,
        projectedShares: null,
        effectivePricePerShare: null,
        rationale:
          `This convertible note (${sec.holderName}, $${(sec.investmentAmount ?? 0).toLocaleString()}) will convert. ` +
          `Interest rate: ${noteFields.interestRate ?? "N/A"}% APR. ` +
          (capStr ? `Cap: $${capStr}. ` : "") +
          (discountDecStr ? `Discount: ${(parseFloat(discountDecStr) * 100).toFixed(0)}%. ` : "") +
          "Conversion price computed using existing cap-table-engine formulas when round price is known.",
      });
    }
  }

  return result;
}

/**
 * For priced equity rounds, compute conversion projections for all unrealized
 * instruments using the existing cap-table-engine (NOT reimplemented here).
 *
 * This function is exported separately so callers can inject seriesPricePerShare
 * and companyCapitalization when they become known (e.g., after the founder
 * has entered their pre-money valuation).
 */
export function computeConversionProjections(
  instruments: UnrealizedInstrument[],
  seriesPricePerShare: string,
  companyCapitalization: string,
  region: import("@capavate/cap-table-engine").Region = "US",
): UnrealizedInstrument[] {
  return instruments.map((inst) => {
    if (inst.instrumentType === "safe") {
      const capType: import("@capavate/cap-table-engine").SafeConversionInput["capType"] =
        inst.cap ? "post_money_cap" : inst.discount ? "discount_only" : "uncapped";
      const formulaId =
        capType === "post_money_cap" ? "safe.postmoney.conversion" : "safe.premoney.conversion";
      const formulaRecord = resolveFormula(formulaId, region);
      const result = convertSafeToPreferred({
        purchaseAmount: inst.principal,
        capType,
        cap: inst.cap ?? undefined,
        discount: inst.discount ?? undefined,
        seriesPricePerShare,
        companyCapitalization,
        formulaId: formulaRecord.id,
        formulaVersion: formulaRecord.version,
        region,
        formulaDef: formulaRecord.definition,
      });
      const effectivePps =
        result.safeShares > BigInt(0)
          ? (parseFloat(inst.principal) / Number(result.safeShares)).toFixed(10)
          : null;
      return {
        ...inst,
        projectedConversionPriceUsd: result.conversionPrice,
        projectedShares: result.safeShares.toString(),
        effectivePricePerShare: effectivePps,
        rationale:
          inst.rationale +
          ` [Projected at series PPS $${seriesPricePerShare}: conversion price $${result.conversionPrice}/sh, ` +
          `${result.safeShares.toString()} shares, binding: ${result.binding}]`,
      };
    } else {
      // note
      const formulaRecord = resolveFormula("note.conversion", region);
      // Use simple interest; yearsElapsed = 1 year as a conservative default
      // when actual issue date is unavailable at suggestion time.
      const result = convertNoteToPreferred({
        principal: inst.principal,
        interestRate: "0.06", // conservative default; actual rate is on the security
        interestKind: "simple",
        yearsElapsed: "1",
        cap: inst.cap ?? undefined,
        discount: inst.discount ?? undefined,
        seriesPricePerShare,
        companyCapitalization,
        formulaId: formulaRecord.id,
        formulaVersion: formulaRecord.version,
        region,
        formulaDef: formulaRecord.definition,
      });
      const effectivePps =
        result.noteShares > BigInt(0)
          ? (parseFloat(result.outstanding) / Number(result.noteShares)).toFixed(10)
          : null;
      return {
        ...inst,
        projectedConversionPriceUsd: result.conversionPrice,
        projectedShares: result.noteShares.toString(),
        effectivePricePerShare: effectivePps,
        rationale:
          inst.rationale +
          ` [Projected (conservative 6% simple interest, 1yr): outstanding $${result.outstanding}, ` +
          `conversion price $${result.conversionPrice}/sh, ${result.noteShares.toString()} shares, binding: ${result.binding}]`,
      };
    }
  });
}

// ─── Main engine entry point ────────────────────────────────────────────────

export interface CarryForwardEngineInput {
  companyId: string;
  proposedRoundType: RoundType;
  proposedRoundCurrency?: string;
}

/**
 * Compute carry-forward suggestions for a new round.
 *
 * PURE READ. Never mutates rounds, securities, companyProfile, or any store.
 * Deterministic: same inputs → same auditDigest.
 */
export function computeCarryForward(input: CarryForwardEngineInput): CarryForwardResult {
  const { companyId, proposedRoundType } = input;
  const computedAt = "2025-01-01T00:00:00.000Z"; // deterministic for test purposes; override in route

  const warnings: string[] = [];

  // Verify company exists
  const company = companies.find((c) => c.id === companyId);
  if (!company) {
    const result: Omit<CarryForwardResult, "auditDigest"> = {
      companyId,
      proposedRoundType,
      computedAt,
      fields: {},
      unrealizedInstruments: [],
      warnings: [`Company not found: ${companyId}`],
    };
    return { ...result, auditDigest: computeDigest(result) };
  }

  const closedRounds = getClosedRounds(companyId);
  if (closedRounds.length === 0) {
    const result: Omit<CarryForwardResult, "auditDigest"> = {
      companyId,
      proposedRoundType,
      computedAt,
      fields: {},
      unrealizedInstruments: [],
      warnings: ["No prior rounds — no carry-forward available. This appears to be the first round."],
    };
    return { ...result, auditDigest: computeDigest(result) };
  }

  // Find the most recent closed round of any instrument type (for general carry-forwards)
  const mostRecentClosed = closedRounds[closedRounds.length - 1];

  // Find the most recent round matching the proposed type for type-specific carry
  const prevSafeRound = getMostRecentClosedRoundOfType(companyId, "safe");
  const prevNoteRound = getMostRecentClosedRoundOfType(companyId, "note");
  const prevPricedRound = getMostRecentClosedRoundOfType(companyId, "priced_equity");

  // Build type-specific fields
  let typeFields: Record<string, CarryForwardSuggestion> = {};
  let unrealizedInstruments: UnrealizedInstrument[] = [];

  if (proposedRoundType === "safe") {
    const prevForSafe = prevSafeRound ?? mostRecentClosed;
    typeFields = buildSafeCarryForward(companyId, prevForSafe, warnings);
  } else if (proposedRoundType === "note") {
    const prevForNote = prevNoteRound ?? prevSafeRound ?? mostRecentClosed;
    typeFields = buildNoteCarryForward(companyId, prevForNote, warnings);
  } else if (proposedRoundType === "priced_equity") {
    const prevForPriced = prevPricedRound ?? prevSafeRound ?? mostRecentClosed;
    typeFields = buildPricedEquityCarryForward(companyId, prevForPriced, warnings, companyId);
    unrealizedInstruments = buildUnrealizedInstruments(companyId);

    if (unrealizedInstruments.length > 0) {
      warnings.push(
        `${unrealizedInstruments.length} unconverted instrument(s) will convert in this priced round. ` +
          "Conversion prices shown are projections — they require the round's actual pre-money valuation and share price to finalize.",
      );
    }
  }

  // Add company-profile fields (all round types)
  const profileFields = buildCompanyProfileFields(companyId, warnings);

  const allFields: Record<string, CarryForwardSuggestion> = {
    ...profileFields,
    ...typeFields,
  };

  const body: Omit<CarryForwardResult, "auditDigest"> = {
    companyId,
    proposedRoundType,
    computedAt,
    fields: allFields,
    unrealizedInstruments,
    warnings,
  };

  return { ...body, auditDigest: computeDigest(body) };
}

/**
 * Same as computeCarryForward but injects a live timestamp.
 * Use this in routes; use computeCarryForward in tests for determinism.
 */
export function computeCarryForwardLive(input: CarryForwardEngineInput): CarryForwardResult {
  const result = computeCarryForward(input);
  // Recompute with live timestamp (breaks determinism but needed for production audit trail)
  const liveBody: Omit<CarryForwardResult, "auditDigest"> = {
    ...result,
    computedAt: new Date().toISOString(),
  };
  return { ...liveBody, auditDigest: computeDigest(liveBody) };
}

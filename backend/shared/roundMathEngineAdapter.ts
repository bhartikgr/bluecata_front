/**
 * shared/roundMathEngineAdapter.ts
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WAVE 52c · B1 — ONE ADAPTER, REACHABLE FROM BOTH SIDES
 * ═══════════════════════════════════════════════════════════════════════════
 * This file is `client/src/lib/engineDemo.ts` MOVED, not copied. It was moved
 * because Wave 52's pricing-order flag was DECORATIVE: it was resolved from the
 * database by `server/lib/roundMathDisclosureStore.ts::resolveW52PricingOrder()`
 * and NO PRODUCTION CODE CALLED IT. Both poles were proven inside the engine
 * package's own tests, never through the app, so flipping the flag in production
 * changed nothing at all.
 *
 * The reason it could not be wired was structural: the only production caller of
 * the round-pricing pipeline was the CLIENT (`projectPostClose`, on
 * `/founder/rounds/:id` → Projection), and a browser cannot read `platform_config`.
 * A server route can. So the adapter now lives in `shared/`, where the server
 * route `GET /api/founder/rounds/:id/round-math`
 * (`server/roundMathRoutes.ts`) and the client screen use the SAME
 * implementation — no second math surface, no rival adapter to drift.
 *
 * `pricingOrderMode` is threaded through as an ARGUMENT. This file never reads
 * `process.env`, never reads a config table, and never caches a resolution:
 * R21 requires the value to be db-driven and resolved at call time, and a value
 * memoised here would need a restart to flip, which is not a rollback.
 *
 * `client/src/lib/engineDemo.ts` is now a re-export of this module, so every
 * existing client import keeps working and there is exactly one definition of
 * `adaptSecuritiesToEngine`, `runEngine` and `projectPostClose` in the tree.
 */
import Decimal from "decimal.js";
import {
  computeCapTable,
  /* WAVE 70 · D4 — the As-Converted preview CALLS the engine's conversion
     instead of reimplementing it in floats. See `asConvertedConvertibleShares`. */
  convertSafeToPreferred,
  convertNoteToPreferred,
  /* WAVE 71 · D8 — the ONE exact interest clock, shared with `compute.ts`. Before
     this wave the float expression existed in BOTH files, deliberately duplicated
     by Wave 70 so the two conversion paths could not disagree. Importing it is how
     the duplication ends without re-opening D4. */
  exactYearsElapsedString,
  resolveFormula,
  type Holder,
  type Transaction,
  type View,
  type Region,
  type CapTableResult,
  type PricingOrderMode,
} from "@capavate/cap-table-engine";

export type ApiSecurity = {
  id: string;
  companyId: string;
  holderName: string;
  holderType: string;
  instrument: string;
  series: string | null;
  shares: number;
  pricePerShare: number | null;
  investmentAmount: number | null;
  cap: number | null;
  discount: number | null;
  issuedAt: string | null;
  // Sprint 5 — institutional-grade enrichments
  certificateNumber?: string | null;
  shareNumberFrom?: number | null;
  shareNumberTo?: number | null;
  roundId?: string | null;
  vesting?: { months: number; cliff: number; startDate: string; percentVested: number } | null;
  drag?: boolean;
  rofr?: boolean;
  coSale?: boolean;
  proRata?: boolean;
  leadInvestorOfRound?: boolean;
  sideLetter?: string | null;
  // Defect 15 — privacy fields optionally enriched by server for co-member views.
  investorId?: string | null;
  holderVisibility?: { screenName: string; screenNameSet: boolean; visibleToCoMembers: boolean; visibleToCollectiveNetwork: boolean } | null;
  optionStatus?: { granted: number; available: number; exercised: number; cancelled: number } | null;
  interestRate?: number | null;
  maturityDate?: string | null;
  accruedInterest?: number | null;
  strike?: number | null;
  expiry?: string | null;
  fmv?: number | null;
  /* ── WAVE 70 — THE FOUR STORED TERMS THIS ADAPTER USED TO INVENT ─────────
     Every one of these was a hardcoded literal on the engine wire before this
     wave. They are resolved FROM THE DATABASE by `buildCompanySecurities`
     (`server/routes.ts`) out of the issuing round's `extras_json`, which is why
     WAVE 70 required NO migration: `antiDilutionType`, `interestRate`,
     `maturityDate` and `maturityMonths` were already on the extras whitelist
     (`server/roundsStore.ts`), and `safeType` is added to it additively.
     ALL OPTIONAL, AND ABSENT IS NEVER A DEFAULT WHERE THE NUMBER WOULD MOVE —
     each has a named refusal or a stated assumption. See the WAVE 70 block
     above `adaptSecuritiesToEngine`. */
  /** D5 · the SAFE cap convention as negotiated. Absent = assumed post-money. */
  safeCapType?: SafeCapTypeStored | null;
  /** D1 / R60 · the per-class anti-dilution method. Absent = refuse on a down round. */
  antiDilutionType?: AntiDilutionTypeStored | null;
  /** D1 / R60 §6 · the per-class participation term. Absent = key omitted. */
  participatingPreferred?: boolean | null;
  /** D6 · the note's compounding convention. Absent = simple (market default). */
  interestKind?: "simple" | "compounded" | null;
  /** D7 · maturity in months from issue. Fenced [0,600] (R50). */
  maturityMonths?: number | null;
  /* ── WAVE 71 · D13 — THE SAFE's MOST-FAVORED-NATION PROVISION ──────────────
     `applyMfn` (`packages/cap-table-engine/src/conversion/mfnOrdering.ts`) is
     implemented and tested and returned immediately on `!s.safe.mfn` for every
     SAFE that ever reached it, because `adaptSecuritiesToEngine`'s SAFE branch set
     `type`, `cap` and `discount` and NEVER `mfn`. So the provision could not be
     switched on from anywhere, and `applyMfn` had no application caller at all.
     It is read from the issuing round's `extras_json`, where `"mfn"` was ALREADY
     on `roundsStore.ts`'s `UPDATE_EXTRAS_WHITELIST` — so this needs NO MIGRATION
     (migrations stay at 173, highest 0192).
     ABSENT IS ABSENT: `null`/`undefined` omits the key, `applyMfn` returns the
     SAFE untouched, and no existing number moves. Only an explicit `true` turns
     the provision on. */
  mfn?: boolean | null;
};

/* ═══════════════════════════════════════════════════════════════════════════ *
 *  WAVE 3F / ITEM 5 — THE FORBIDDEN PERCENT GUESS IS REMOVED FROM THIS FILE.
 * ═══════════════════════════════════════════════════════════════════════════ *
 *
 * WHAT WAS HERE (:118, :152, :190 in the frozen artifact):
 *
 *     s.discount != null ? (s.discount > 1 ? (s.discount / 100).toString()
 *                                          : s.discount.toString()) : undefined
 *     const discountFrac = s.discount != null
 *       ? (s.discount > 1 ? s.discount / 100 : s.discount) : 0;
 *
 * `n > 1 ? n / 100 : n` CANNOT DISTINGUISH 1% FROM 100%. Both arrive as a
 * number the heuristic reads as a fraction: a wire value of `1` meant as "1%"
 * is silently priced as a 100% discount, and every value in (0,1] is
 * indistinguishable from a correctly-fractional one. The magnitude of a number
 * is not evidence of its unit. This is the heuristic the owner forbade, and
 * W10 REVIEW A found it still shipping in the artifact.
 *
 * THE RULE NOW — CORRECTED IN WAVE 58f (F3) UNDER OWNER RULING R30.
 *
 * WHAT THIS COMMENT USED TO SAY, AND WHY IT WAS WRONG. It said "STORAGE AND
 * WIRE ARE FRACTIONAL. 0.2 is 20%. 1 is 100%. Full stop." The WIRE half was
 * right and still is. The STORAGE half was never true of this platform and is
 * now formally ruled against: R30 fixes storage as PERCENT-AS-WRITTEN. Live
 * `rounds.extras_json` holds `"discount": 20` for a 20% discount, and
 * `shared/schema.ts:1425` documents `captable_commits.discount_pct` the same
 * way. A reader who believed this paragraph would conclude a stored `20` was
 * out of domain and "fix" it to `0.2` — turning a 20% discount into 0.2%. That
 * is not a documentation nit; it is an instruction to corrupt a term sheet.
 *
 * THE TWO UNITS, AND THE ONE PLACE THEY MEET:
 *   • STORAGE / API / UI IS PERCENT-AS-WRITTEN (R30). `20` means 20%. Its
 *     domain is [0, 100) for a discount (`DISCOUNT_STORED_PERCENT_MAX`) and
 *     [0, 100] for an interest rate (`INTEREST_RATE_PERCENT_MAX`), enforced by
 *     `validateDiscountPercentAsWritten` / `validateInterestRatePercentAsWritten`
 *     below — the single shared rule all three round write paths import (R21),
 *     and by the table-level fence in
 *     `migrations/0190_wave58f_discount_pct_domain.sql`.
 *   • THE ENGINE WIRE IS FRACTIONAL. `0.2` means 20%. `1` means 100%.
 *   • `toWireDiscount` IS THE ONLY BRIDGE. It divides the stored percent by
 *     100 EXACTLY ONCE, on the way to the engine. Nothing else may divide, and
 *     nothing may divide twice.
 *
 * WHAT HAS NOT CHANGED — the part this file exists for:
 *   • A WIRE value outside [0,1] is not re-interpreted, re-scaled or clamped —
 *     it is REJECTED by `InvalidDiscountWireValueError`, because a `20` on the
 *     WIRE is a producer bug and guessing which of 20% and 2000% was meant is
 *     exactly the defect. That class remains the sole arbiter of [0,1].
 *   • R16 still forbids inferring a unit from a magnitude. Converting from a
 *     DECLARED unit (percent-as-written → wire fraction, via `toWireDiscount`)
 *     is a different operation and is the sanctioned one.
 *   • DISPLAY goes through percentDisplay.formatFractionAsPercent, never
 *     through an inline ×100 here.
 */

/** Raised instead of guessing the unit of an out-of-domain discount. */
export class InvalidDiscountWireValueError extends Error {
  readonly securityId: string;
  readonly received: unknown;
  constructor(securityId: string, received: unknown) {
    super(
      `INVALID_DISCOUNT_FRACTION: security ${securityId} sent discount=${JSON.stringify(received)}; ` +
        `discounts are FRACTIONAL on the wire and must be within [0,1] (0.2 = 20%). ` +
        `The value is rejected rather than rescaled: 1 means 100%, not 1%.`,
    );
    this.name = "InvalidDiscountWireValueError";
    this.securityId = securityId;
    this.received = received;
  }
}

/**
 * Read a discount that is FRACTIONAL BY CONTRACT.
 * Returns undefined when absent. Throws on anything outside [0,1] or
 * non-finite. Never divides, never multiplies, never clamps.
 */
export function readDiscountFraction(raw: unknown, securityId: string): number | undefined {
  if (raw === null || raw === undefined || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw new InvalidDiscountWireValueError(securityId, raw);
  return n;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 58e · D1 — THE UNIT BOUNDARY. ONE CONVERSION, DECLARED, UNCONDITIONAL.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * TWO LAYERS DISAGREED AND NOTHING TRANSLATED BETWEEN THEM.
 *
 *   STORAGE / API / UI  — PERCENT-AS-WRITTEN. Owner ruling **R30** (2026-08-15),
 *     which follows R16 / OR-1 ("1=1%. 100=100%."). Declared in the schema in two
 *     places: `shared/schema.ts:156` (`discount: real("discount")  // SAFE/Note
 *     discount %`) and `shared/schema.ts:1425` (`discountPct  // "20" = 20%`).
 *     Confirmed on live 2026-08-15: `GET /api/rounds` returns `"discount": 20` on
 *     every clean record (`rnd_0f0f57d06f36`, `rnd_f140c3959608`). One schema key
 *     only — `discount`. The label is `Discount (%)` on every surface.
 *   ENGINE WIRE — FRACTION in [0,1]. `packages/cap-table-engine/src/captable/
 *     views.ts:82` and `:95` compute `pps.mul(D(1).minus(discount))`.
 *
 * THE FORMULA DIRECTION IS CORRECT — `× (1 − d)`, not `× d`. There is NO
 * "Discount vs Discount Rate" inversion in the engine. Verified by reading those
 * two lines and by execution (`build_log/wave58e/w58e_probe_boundary.mts`). The
 * DLA Piper "quadrupling" error is therefore NOT present — see D3's disclosure.
 *
 * WHAT THE MISSING CONVERSION COST, in exact decimals on a $1.00 round
 * (`build_log/wave58e/w58e_exact_math.py`, recomputed, not quoted):
 *   fraction 0.2 crossing correctly      -> $1.00 × (1 − 0.2)        = $0.80
 *   percent 20 crossing UNCONVERTED      -> $1.00 × (1 − 20)         = −$19.00
 *   corrupt 20260707 crossing UNCONVERTED-> $1.00 × (1 − 20260707)   = −$20,260,706.00
 * A negative price per share. That is why the guard above exists.
 *
 * `InvalidDiscountWireValueError` IS A SAFETY NET, NOT A BUG. It is KEPT,
 * byte-identical, and it stays the ONLY arbiter of the wire domain. Waves 58c and
 * 58d were right to refuse to "fix" it. This wave adds the missing conversion IN
 * FRONT of it; it does not weaken it. After conversion the corrupt row is still
 * refused: 20260707 / 100 = 202607.07, which is outside [0,1].
 *
 * THE FORBIDDEN THING, RESTATED SO IT IS NOT REVIVED BY ACCIDENT. The commented-
 * out `discount > 1 ? discount / 100 : discount` above (this file's WAVE 3F / ITEM
 * 5 block) is commented out DELIBERATELY. R16 forbids rescaling by magnitude: that
 * heuristic cannot tell 1% from 100%, and every value in (0,1] is priced as a 100%
 * discount. This conversion is NOT that. It NEVER inspects the value to decide
 * whether to convert. It converts EVERY value, because the STORAGE UNIT IS
 * DECLARED, and a declared unit is evidence where a magnitude is not.
 *
 * THE CONSEQUENCE, STATED RATHER THAN HIDDEN: a stored `0.2` now means 0.2% off,
 * i.e. a conversion price of $0.998 on a $1.00 round — not $0.80. That is the
 * correct reading of the declared unit, it is what R30 rules, and NO live record
 * in the 2026-08-15 audit of 20 rounds stores `0.2`. The founder-facing screens
 * added by D3 print what a typed value WILL MEAN ("0.2% off") before it is saved,
 * so the trap is surfaced rather than guessed at.
 *
 * EXACT DECIMAL. The wire value is produced with `decimal.js` at the engine's own
 * precision, so `20` becomes the string `"0.2"` and not a float artefact. The
 * engine parses the string with `D(...)`, so no float ever touches the price.
 */
const DiscountDec = Decimal.clone({ precision: 38, toExpNeg: -40, toExpPos: 40 });

/** The unit the DATABASE holds a SAFE/Note discount in. Declared, never sniffed. */
export const DISCOUNT_STORAGE_UNIT = "percent_as_written" as const;
/** The unit the ENGINE takes on the wire. */
export const DISCOUNT_WIRE_UNIT = "fraction_0_to_1" as const;
/** The write-boundary ceiling for the STORED percent (exclusive). See D2/D3. */
export const DISCOUNT_STORED_PERCENT_MAX = 100;

export type WireDiscount = {
  /** The stored value, exactly as it arrived, for disclosure and refusals. */
  readonly storedPercent: string;
  /** The engine wire value: an exact decimal string in [0,1]. */
  readonly wireFraction: string;
  /** The same fraction as a number, for the float-arithmetic conversion path. */
  readonly asNumber: number;
};

/**
 * THE ONE BOUNDARY. Converts a discount from its declared STORAGE unit
 * (percent-as-written) to the engine's declared WIRE unit (a fraction in [0,1]),
 * then hands the converted value to `readDiscountFraction` — which is still the
 * only thing that decides whether a value is admissible.
 *
 * Absent (`null` / `undefined` / `""`) returns `undefined`: absent is not zero.
 * Anything that is not a finite number, or whose converted fraction falls outside
 * `[0,1]`, is REJECTED by the guard and re-raised naming the STORED value the
 * founder can actually see on screen — never rescaled, never clamped, never
 * guessed at.
 */
export function toWireDiscount(rawStoredPercent: unknown, securityId: string): WireDiscount | undefined {
  if (rawStoredPercent === null || rawStoredPercent === undefined || rawStoredPercent === "") return undefined;
  let pct: InstanceType<typeof DiscountDec>;
  try {
    pct = new DiscountDec(rawStoredPercent as never);
  } catch {
    /* Not a number at all. The guard's domain check cannot speak to this, so the
       same refusal is raised directly, naming the value as stored. */
    throw new InvalidDiscountWireValueError(securityId, rawStoredPercent);
  }
  if (!pct.isFinite()) throw new InvalidDiscountWireValueError(securityId, rawStoredPercent);
  /* THE CONVERSION. Unconditional. No comparison of `pct` against anything. */
  const frac = pct.div(100);
  const wireFraction = frac.toFixed();
  const asNumber = frac.toNumber();
  /* THE GUARD, KEPT AND STILL LOAD-BEARING. If this call is removed, a corrupt
     `20260707` converts to 202607.07 and reaches `× (1 − d)`. Proven by mutation:
     `build_log/wave58e/W58E_NEW_TESTS.md` transcript M1. */
  try {
    readDiscountFraction(asNumber, securityId);
  } catch {
    /* Re-raised with the STORED value, because that is the number on the founder's
       screen and in the database row. Same error class and same `name`, so every
       existing consumer (`tryLedgerFullyDilutedPreMoneyShares`, the route handlers'
       `catch`) keeps behaving identically. */
    throw new InvalidDiscountWireValueError(securityId, rawStoredPercent);
  }
  return { storedPercent: pct.toFixed(), wireFraction, asNumber };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 58e · D2 + D3 — ONE RANGE RULE, AND ONE DISCLOSURE, FOR EVERY SURFACE.
 * ═══════════════════════════════════════════════════════════════════════════
 * These live in `shared/` DELIBERATELY. The 2026-08-15 live audit found the two
 * option-pool fields validating DIFFERENTLY in the same application, and the
 * `Discount (%)` field validating NOT AT ALL on either the wizard or the
 * Edit-terms modal. A rule that exists in two places is a rule that will diverge,
 * so the server routes (`POST /api/rounds`, `PATCH /api/rounds/:id/terms`) and the
 * founder screens import the SAME functions from here.
 *
 * AUTHORITIES, named as R29 requires:
 *  · The two-term taxonomy and the 80%-not-20% inversion — the YC SAFE form uses
 *    "Discount Rate", meaning the price AFTER the discount:
 *    https://www.wyrick.com/news-insights/safe-financing-valuation-cap-vs-discount-variants
 *  · The consequence of conflating them, verbatim "quadrupling the intended
 *    discount", and the 10-20% market norm:
 *    https://www.dlapiper.com/en/insights/publications/2022/08/safe-faqs
 *  · Conversion price = round PPS × (1 − discount), and lower-of cap/discount:
 *    https://fundersclub.com/learn/safe-primer/safe-numerical-examples/safe-cap-and-discount/
 *  · House percent convention: owner ruling R16 / OR-1 and R30;
 *    `spec/strategy/CAPTABLE_MATH_INDUSTRY_STANDARD.md`.
 */

/** Market norm for a SAFE/Note discount (DLA Piper). WARN outside it, never block. */
export const DISCOUNT_MARKET_NORM_MIN = 10;
export const DISCOUNT_MARKET_NORM_MAX = 20;
/** Sane upper bound for a note's annual interest rate, percent-as-written. */
export const INTEREST_RATE_PERCENT_MAX = 100;

export type TermRangeVerdict =
  | {
      readonly ok: true;
      /** The value as written, byte-preserved. No rescaling, ever. */
      readonly percent: string;
      /** Non-blocking disclosure. Present when the value is legal but unusual. */
      readonly warning?: string;
    }
  | { readonly ok: false; readonly error: string; readonly message: string };

function decOrNull(raw: unknown): InstanceType<typeof DiscountDec> | null {
  const t = String(raw).replace(/[,\s%$]/g, "");
  if (t === "") return null;
  let d: InstanceType<typeof DiscountDec>;
  try {
    d = new DiscountDec(t);
  } catch {
    return null;
  }
  return d.isFinite() ? d : null;
}

/**
 * THE WRITE-BOUNDARY RANGE RULE FOR `discount`, percent-as-written, `[0, 100)`.
 *
 * This is the guard R31-a asks for. The live row `rnd_64e9d6ad728a` holds
 * `discount: 20260707` — its own `createdAt` of 2026-07-07 as YYYYMMDD — and the
 * two HTTP writers accepted it because they only checked "a non-negative number".
 * A date is a non-negative number.
 *
 * 100 is REFUSED as well as everything above it: a 100% discount is a free share,
 * and the conversion price `round PPS × (1 − 1)` is $0. Note the deliberate
 * asymmetry with the WIRE guard, which admits the fraction `1`: the wire guard
 * defends the arithmetic, this one defends the founder's intent.
 *
 * MAGNITUDE IS NEVER EVIDENCE OF UNIT (R16). `0.2` is ACCEPTED and means
 * two tenths of one percent. It is not silently read as 20%. The calling screens
 * print what it will mean so the founder can correct it themselves.
 */
export function validateDiscountPercentAsWritten(raw: unknown): TermRangeVerdict {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return { ok: true, percent: "" }; // absent is untouched, never coerced to 0
  }
  const d = decOrNull(raw);
  if (d === null) {
    return {
      ok: false,
      error: "invalid_discount",
      message:
        `Discount (% off the round price) must be a number. "${String(raw)}" is not one, and Capavate will ` +
        `not guess at what you meant.`,
    };
  }
  if (d.lt(0)) {
    return {
      ok: false,
      error: "invalid_discount",
      message:
        `Discount (% off the round price) cannot be negative. A negative discount would make the SAFE holder ` +
        `pay MORE than the round price, which is a premium, not a discount.`,
    };
  }
  if (d.gte(DISCOUNT_STORED_PERCENT_MAX)) {
    return {
      ok: false,
      error: "invalid_discount",
      message:
        `Discount (% off the round price) must be at least 0 and less than 100. "${String(raw)}" is outside that ` +
        `range, so Capavate will not store it. It is PERCENT-AS-WRITTEN (owner ruling R16): 20 means 20% off, ` +
        `and it is never rescaled by how big it looks. A value of 100 or more would price the shares at zero or ` +
        `below. If you are seeing an 8-digit number here, it is a date that was written into this field by ` +
        `mistake — the live example is 20260707, which is 2026-07-07.`,
    };
  }
  /* THE MARKET-NORM WARNING. Legal, stored, never blocked — and it says why. */
  if (d.gt(0) && (d.lt(DISCOUNT_MARKET_NORM_MIN) || d.gt(DISCOUNT_MARKET_NORM_MAX))) {
    return {
      ok: true,
      percent: d.toFixed(),
      warning:
        `A discount of ${d.toFixed()}% is outside the ${DISCOUNT_MARKET_NORM_MIN}–${DISCOUNT_MARKET_NORM_MAX}% ` +
        `market norm for SAFEs and convertible notes (DLA Piper, "SAFE FAQs"). It is legal and it has been ` +
        `stored exactly as you wrote it — this is a heads-up, not a rejection. ` +
        (d.lt(DISCOUNT_MARKET_NORM_MIN)
          ? `Below 10% is unusually founder-friendly; check it is not a decimal slip — ${d.toFixed()} means ` +
            `${d.toFixed()}% off, not ${d.mul(100).toFixed()}%.`
          : `Above 20% is unusually investor-friendly; on conversion the holder pays ` +
            `${new DiscountDec(100).minus(d).toFixed()}% of the round price.`),
    };
  }
  return { ok: true, percent: d.toFixed() };
}

/**
 * THE WRITE-BOUNDARY RANGE RULE FOR `interestRate`, percent-as-written, `[0, 100]`.
 * The same live row holds `interestRate: 20261231` — a maturity date (2026-12-31)
 * as YYYYMMDD. 100% APR is admitted as the outer bound because distressed bridge
 * notes exist; a date is not a rate under any reading.
 */
export function validateInterestRatePercentAsWritten(raw: unknown): TermRangeVerdict {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return { ok: true, percent: "" };
  }
  const d = decOrNull(raw);
  if (d === null) {
    return {
      ok: false,
      error: "invalid_interestRate",
      message: `Interest rate (% APR) must be a number. "${String(raw)}" is not one.`,
    };
  }
  if (d.lt(0) || d.gt(INTEREST_RATE_PERCENT_MAX)) {
    return {
      ok: false,
      error: "invalid_interestRate",
      message:
        `Interest rate (% APR) must be at least 0 and no more than ${INTEREST_RATE_PERCENT_MAX}. ` +
        `"${String(raw)}" is outside that range. It is PERCENT-AS-WRITTEN (owner ruling R16): 6 means 6% a ` +
        `year. An 8-digit value here is a date written into a rate field — the live example is 20261231, ` +
        `which is 2026-12-31.`,
    };
  }
  if (d.gt(20)) {
    return {
      ok: true,
      percent: d.toFixed(),
      warning:
        `${d.toFixed()}% APR is far above the 4–8% typical of early-stage convertible notes. It is legal and ` +
        `has been stored as written; this is a heads-up, not a rejection.`,
    };
  }
  return { ok: true, percent: d.toFixed() };
}

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 61b · R50 — THE FOUR NUMERIC TERM BOUNDS, PLUS THE SHARE COUNT.
   ═══════════════════════════════════════════════════════════════════════════
   WHY THIS BLOCK EXISTS. `discount` and `interestRate` were fenced by Wave 58e
   and 58f. THEIR SIBLINGS WERE NOT. Every other numeric term on a round went
   through a helper that checked only `Number.isNaN(n) || n < 0`, and a date
   written as `YYYYMMDD` is a large POSITIVE number. The live row
   `rnd_64e9d6ad728a` is the proof: it stores `discount: 20260707` (its own
   createdAt as a number) and `interestRate: 20261231`. The same keystroke into
   `maturityMonths` would have stored 1.7 million years of maturity, and nothing
   in the tree would have said a word.

   WHAT THIS IS, EXACTLY. A RANGE CHECK AND NOTHING ELSE.
     · The parse is IDENTICAL to the helper each caller already used
       (`Number(raw)`), so no value that is accepted today changes its units,
       its rounding or its stored form. `1e9` in, `1e9` out.
     · REFUSED BY NAME (R16). Never clamped, never rescaled, never "repaired".
       The refusal names the FIELD, the VALUE RECEIVED and the ACCEPTED RANGE,
       because guessing whether `20260707` meant a date, 20 million months or
       something else is the defect itself.
     · ABSENT IS UNTOUCHED. `null` / `undefined` / `""` return `ok` with an
       empty `value`, and every caller writes nothing. A field missing from a
       PATCH body is never reset to zero. (`""` was previously coerced to `0` by
       `numericTerm` and WRITTEN as zero; treating it as absent removes a
       fabricated zero and is the one deliberate behaviour narrowing here. It is
       recorded in `build_log/wave61b/WAVE61B_REPORT.md` and tested.)
     · The five PRICED-MONEY fields (`targetAmount`, `preMoney`, `postMoney`,
       `pricePerShare`, `minTicket`) are DELIBERATELY ABSENT from this block.
       R50: an invented ceiling on a round size is the same defect class as an
       invented percentage. Do not add them without a stated business policy.

   THE DOMAINS ARE THE OWNER'S (R50), not this file's invention:
     · maturityMonths    [0, 600]    50 years. 20261231 months = 1.7 Myr.
     · expiryYears       [0, 50]
     · strikePrice       (0, 1e9]    0 is refused: a zero-strike warrant is a
                                     free share, and `routes.ts` already
                                     refuses `strikePrice <= 0` on create.
     · valuationCap      (0, 1e12]   0 is refused: an uncapped instrument is
                                     expressed by ABSENCE, not by a $0 cap.
     · fdPreMoneyShares  [0, 1e13]   whole numbers only (the column is INTEGER).

   HONEST LIMIT, STATED HERE SO NO READER OVERCLAIMS IT: a bound CANNOT catch a
   date in `fdPreMoneyShares`. `20260707` is a perfectly plausible share count.
   That field gets a magnitude ceiling and an integrality rule, and nothing this
   block does makes a date-shaped share count detectable. */

/** R50 · maximum maturity, in months. 600 = 50 years. */
export const MATURITY_MONTHS_MAX = 600;
/** R50 · maximum warrant/option expiry, in years. */
export const EXPIRY_YEARS_MAX = 50;
/** R50 · maximum strike price, in major currency units per share. */
export const STRIKE_PRICE_MAX = 1_000_000_000;
/** R50 · maximum valuation cap, in major currency units. */
export const VALUATION_CAP_MAX = 1_000_000_000_000;
/** R50 · maximum declared fully-diluted pre-money share count. */
export const FD_PRE_MONEY_SHARES_MAX = 10_000_000_000_000;

/**
 * The verdict shape for a BOUNDED NON-PERCENT term.
 *
 * Deliberately NOT `TermRangeVerdict`: that type carries the accepted value in a
 * field literally named `percent`, and putting a share count or a month count in
 * a field called `percent` is the unit confusion R16 exists to prevent. Adding a
 * type is additive; widening `TermRangeVerdict` would not be.
 */
export type TermValueVerdict =
  | {
      readonly ok: true;
      /** The value as parsed. `""` means ABSENT — write nothing. */
      readonly value: string;
    }
  | { readonly ok: false; readonly error: string; readonly message: string };

/** Shared shape for every R50 refusal, so the five cannot drift apart. */
function boundedNumericTerm(args: {
  field: string;
  /** Human label used in the sentence, e.g. "Maturity (months)". */
  label: string;
  raw: unknown;
  min: number;
  max: number;
  /** true → `min` itself is REFUSED (an open lower bound). */
  exclusiveMin: boolean;
  /** true → a fractional value is refused (the column is an INTEGER). */
  wholeNumbersOnly?: boolean;
  /** Appended to every refusal: what the field means and how to fix it. */
  meaning: string;
}): TermValueVerdict {
  const { field, label, raw, min, max, exclusiveMin, meaning } = args;
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return { ok: true, value: "" }; // absent — untouched, never coerced to 0
  }
  /* IDENTICAL PARSE to the `numericTerm` / `coerceNumeric` helpers this replaces.
     No separator stripping is added here: widening what is ACCEPTED is not a
     range check, and the create route has already stripped separators before it
     calls this. */
  const n = Number(raw as never);
  const range = `${exclusiveMin ? "greater than" : "at least"} ${min} and no more than ${max.toLocaleString("en-US")}`;
  if (!Number.isFinite(n)) {
    return {
      ok: false,
      error: `invalid_${field}`,
      message:
        `${label} must be a number. Capavate received "${String(raw)}", which is not one, and will not guess ` +
        `at what it meant. ${meaning}`,
    };
  }
  if (args.wholeNumbersOnly && !Number.isInteger(n)) {
    return {
      ok: false,
      error: `invalid_${field}`,
      message:
        `${label} must be a whole number. Capavate received "${String(raw)}". ${meaning}`,
    };
  }
  if (exclusiveMin ? !(n > min) : n < min) {
    return {
      ok: false,
      error: `invalid_${field}`,
      message:
        `${label} must be ${range}. Capavate received "${String(raw)}", which is outside that range, so it ` +
        `has NOT been stored. ${meaning}`,
    };
  }
  if (n > max) {
    return {
      ok: false,
      error: `invalid_${field}`,
      message:
        `${label} must be ${range}. Capavate received "${String(raw)}", which is outside that range, so it ` +
        `has NOT been stored. ${meaning} If you are looking at an 8-digit number here, it is a DATE that was ` +
        `typed into a numeric field by mistake — the live example is 20260707, which is 2026-07-07. Capavate ` +
        `does not rescale or clamp a value to make it fit (owner ruling R16); correct the field and save again.`,
    };
  }
  return { ok: true, value: String(n) };
}

/** R50 · `maturityMonths` ∈ [0, 600]. Refused by name, never clamped. */
export function validateMaturityMonths(raw: unknown): TermValueVerdict {
  return boundedNumericTerm({
    field: "maturityMonths",
    label: "Maturity (months)",
    raw,
    min: 0,
    max: MATURITY_MONTHS_MAX,
    exclusiveMin: false,
    meaning:
      `Maturity is the number of MONTHS until a convertible note falls due — 24 means two years. The ceiling ` +
      `is ${MATURITY_MONTHS_MAX} months (50 years).`,
  });
}

/** R50 · `expiryYears` ∈ [0, 50]. Refused by name, never clamped. */
export function validateExpiryYears(raw: unknown): TermValueVerdict {
  return boundedNumericTerm({
    field: "expiryYears",
    label: "Expiry (years)",
    raw,
    min: 0,
    max: EXPIRY_YEARS_MAX,
    exclusiveMin: false,
    meaning:
      `Expiry is the number of YEARS a warrant or option stays exercisable — 10 means ten years. The ceiling ` +
      `is ${EXPIRY_YEARS_MAX} years.`,
  });
}

/** R50 · `strikePrice` ∈ (0, 1e9]. Zero is refused; a free share is not a strike. */
export function validateStrikePrice(raw: unknown): TermValueVerdict {
  return boundedNumericTerm({
    field: "strikePrice",
    label: "Strike price",
    raw,
    min: 0,
    max: STRIKE_PRICE_MAX,
    exclusiveMin: true,
    meaning:
      `The strike is the price PER SHARE, in the round's currency, at which the warrant or option may be ` +
      `exercised — 0.001 is a tenth of a cent. It must be greater than 0, because a zero strike is a free ` +
      `share, not a price. Leave the field EMPTY if there is no strike; do not enter 0.`,
  });
}

/** R50 · `valuationCap` ∈ (0, 1e12]. Absence, not 0, expresses an uncapped instrument. */
export function validateValuationCap(raw: unknown): TermValueVerdict {
  return boundedNumericTerm({
    field: "valuationCap",
    label: "Valuation cap",
    raw,
    min: 0,
    max: VALUATION_CAP_MAX,
    exclusiveMin: true,
    meaning:
      `The valuation cap is a company valuation in whole currency units — 8000000 is an $8m cap, NOT $8m in ` +
      `cents. It must be greater than 0. An UNCAPPED SAFE or note is recorded by leaving the cap EMPTY, not ` +
      `by entering 0: a $0 cap would convert the instrument at a price of zero.`,
  });
}

/**
 * R50 · `fdPreMoneyShares` ∈ [0, 1e13], whole numbers only.
 *
 * READ THE LIMIT IN THE BLOCK COMMENT ABOVE. A share count and a YYYYMMDD date
 * are indistinguishable by magnitude — `20260707` is ~20.3m shares, which is an
 * entirely ordinary cap table. This bound refuses ABSURD magnitudes and
 * FRACTIONS (the column is INTEGER, so a fraction was being silently truncated);
 * it does NOT and cannot refuse a date here. Recorded so nobody reads this
 * function as closing the R31-a hole on this field.
 */
export function validateFdPreMoneyShares(raw: unknown): TermValueVerdict {
  return boundedNumericTerm({
    field: "fdPreMoneyShares",
    label: "Fully-diluted pre-money shares",
    raw,
    min: 0,
    max: FD_PRE_MONEY_SHARES_MAX,
    exclusiveMin: false,
    wholeNumbersOnly: true,
    meaning:
      `This is a COUNT OF SHARES before the round, not a price and not a percentage. It is stored in an ` +
      `INTEGER column, so a fraction of a share cannot be recorded.`,
  });
}

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 68 · R56 — A DATE-SHAPED VALUE IN A MONEY FIELD IS **WARNED** ABOUT,
   NEVER REFUSED.
   ═══════════════════════════════════════════════════════════════════════════
   WHY THIS EXISTS, AND WHY IT IS NOT A BLOCK. `20260707` is both a plausible
   calendar date (2026-07-07 — the `createdAt` of the corrupt live round
   `rnd_64e9d6ad728a`) and a completely legitimate valuation cap of 20,260,707.
   R55 established that NO magnitude ceiling can tell those apart, and R16's
   principle is that magnitude is never evidence of intent. So:

     · The value is ACCEPTED. The save proceeds. No control changes.
     · The warning NAMES THE SUSPICION AND THE ALTERNATIVE and is never
       phrased as an error.
     · THIS IS NOT R42. R42 blocks a refund whose amount cannot be computed.
       R56 warns and stores. The two must not be conflated.

   WHY THE TRIGGER IS DELIBERATELY NARROW. "A warning that fires on legitimate
   input is worse than none — people learn to dismiss it" (R56). So it fires on
   EXACTLY an 8-digit run of digits that parses as a plausible calendar date:
     · exactly 8 digits, nothing else — no sign, no decimal point, no separator.
       A 7-digit or 9-digit number is NOT date-shaped and MUST NOT warn.
     · year in [DATE_SHAPE_YEAR_MIN, DATE_SHAPE_YEAR_MAX]
     · month 01–12
     · day valid FOR THAT MONTH AND YEAR (leap years included, so 20260229 does
       not warn and 20240229 does)

   WHY IT IS NOT IN MIGRATION 0192. A SQLite trigger cannot warn — it can only
   ABORT. Putting this in the migration would turn a warning into a refusal and
   contradict the ruling. R56 says so explicitly, and 0192's header repeats it.

   WHY ONLY `valuationCap` AND `strikePrice`. `maturityMonths` [0,600] and
   `expiryYears` [0,50] already REFUSE `20260707` by range (R50), and R56
   forbids softening a working fence into a warning. `fdPreMoneyShares` is a
   SHARE COUNT, not money, and R56 is money-fields-only; 20,260,707 shares is an
   ordinary cap table and the ruling does not extend there.

   NO CURRENCY SYMBOL IS INVENTED. The round's currency is not available in this
   module and R29 forbids assuming a market, so the alternative is stated as a
   grouped number ("20,260,707") rather than as "$20,260,707". The ruling's
   example uses a dollar sign because the example round was in dollars. */

/** R56 · earliest year an 8-digit value is read as a plausible date. */
export const DATE_SHAPE_YEAR_MIN = 1990;
/** R56 · latest year an 8-digit value is read as a plausible date. */
export const DATE_SHAPE_YEAR_MAX = 2100;

/** The money fields R56 covers. Nothing else may be added without a ruling. */
export const DATE_SHAPE_WARNED_FIELDS = ["valuationCap", "strikePrice"] as const;
export type DateShapedField = (typeof DATE_SHAPE_WARNED_FIELDS)[number];

/**
 * The `YYYY-MM-DD` a value would be if it were a date, or `null` when the value
 * is not date-shaped under R56's narrow test.
 *
 * Returns `null` — i.e. NO WARNING — for anything that is not exactly eight
 * digits, so `2026070` (7) and `202607070` (9) are silent by construction.
 */
export function dateShapeOf(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim();
  if (!/^\d{8}$/.test(s)) return null; // EXACTLY 8 digits. 7 and 9 are not date-shaped.
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  if (y < DATE_SHAPE_YEAR_MIN || y > DATE_SHAPE_YEAR_MAX) return null;
  if (m < 1 || m > 12) return null;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  if (d < 1 || d > dim) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/**
 * R56's warning sentence, or `null` when there is nothing to say.
 *
 * NEVER an error and NEVER a block: the caller pushes this onto the same
 * non-blocking `termWarnings` array the market-norm disclosures already use
 * (Wave 58e/58f), and the save proceeds untouched.
 */
export function dateShapedValueWarning(field: DateShapedField, raw: unknown): string | null {
  const iso = dateShapeOf(raw);
  if (iso === null) return null;
  const n = Number(String(raw).trim());
  const grouped = n.toLocaleString("en-US");
  const label = field === "valuationCap" ? "valuation cap" : "strike price";
  const unit =
    field === "valuationCap"
      ? "in the round's currency"
      : "per share, in the round's currency";
  return (
    `${String(raw).trim()} looks like a date (${iso}). If you meant a ${label} of ${grouped} ${unit}, ` +
    `this is correct and it has been stored exactly as written — otherwise check the field. ` +
    `Capavate cannot tell the two apart, so this is a heads-up, not a rejection.`
  );
}

/* ─────────────────────────────────────────────────────────────────────────── */

/** The investor-grade disclosure R30 requires, computed — never a fixed string. */
export type DiscountDisclosure = {
  /** The Discount: the percentage taken OFF the price. `"20"`. */
  readonly discountPercent: string;
  /** The Discount Rate: the percentage actually PAYABLE. `"80"`. The YC SAFE term. */
  readonly discountRatePercent: string;
  /** The engine wire value. `"0.2"`. */
  readonly wireFraction: string;
  /** The one sentence a lawyer looks for, with BOTH forms in it. */
  readonly bothForms: string;
  /** `"$1.00 × (1 − 0.2) = $0.80"` when a round price is known, else null. */
  readonly conversionArithmetic: string | null;
  /** The conversion price itself, exact. */
  readonly conversionPrice: string | null;
  /** Non-null when outside the 10–20% norm. Disclosure, never a block. */
  readonly marketNormNote: string | null;
  /** Non-null when the stored value cannot be read as a discount at all. */
  readonly refusal: string | null;
};

export function describeDiscount(
  storedPercent: unknown,
  roundPricePerShare?: number | string | null,
): DiscountDisclosure | null {
  if (storedPercent === null || storedPercent === undefined || String(storedPercent).trim() === "") return null;
  const verdict = validateDiscountPercentAsWritten(storedPercent);
  const d = decOrNull(storedPercent);
  if (!verdict.ok || d === null) {
    return {
      discountPercent: String(storedPercent),
      discountRatePercent: "",
      wireFraction: "",
      bothForms: "",
      conversionArithmetic: null,
      conversionPrice: null,
      marketNormNote: null,
      refusal: verdict.ok ? `"${String(storedPercent)}" cannot be read as a discount.` : verdict.message,
    };
  }
  const pct = d.toFixed();
  const rate = new DiscountDec(100).minus(d).toFixed();
  const frac = d.div(100);
  let conversionArithmetic: string | null = null;
  let conversionPrice: string | null = null;
  const pps = roundPricePerShare === null || roundPricePerShare === undefined || roundPricePerShare === ""
    ? null
    : decOrNull(roundPricePerShare);
  if (pps !== null && pps.gt(0)) {
    const price = pps.mul(new DiscountDec(1).minus(frac));
    conversionPrice = price.toFixed();
    conversionArithmetic = `$${pps.toFixed()} × (1 − ${frac.toFixed()}) = $${price.toFixed()}`;
  }
  return {
    discountPercent: pct,
    discountRatePercent: rate,
    wireFraction: frac.toFixed(),
    /* BOTH FORMS IN ONE SENTENCE. The counterparty's term sheet may use either,
       and recording a 20% Discount as a Discount Rate of 20% is DLA Piper's
       "quadrupling the intended discount". */
    bothForms:
      `${pct}% discount — the SAFE/Note holder pays ${rate}% of the round price ` +
      `(the YC SAFE form calls this a Discount Rate of ${rate}%).`,
    conversionArithmetic,
    conversionPrice,
    marketNormNote: verdict.warning ?? null,
    refusal: null,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 70 — THE FOUR INVENTED TERMS ARE GONE. ONE READ AND ONE REFUSAL EACH.
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WAS HERE, AND WHY IT MATTERED. Four negotiated deal terms were LITERALS
 * on the engine wire. Not defaults with a disclosure — literals, asserted as
 * fact to the founder:
 *
 *     interestRate:   "0.05"            the founder's typed rate reached NO
 *                                       arithmetic anywhere (D6)
 *     maturityDate:   "2027-12-31"      a fenced field whose value reached
 *                                       nothing (D7)
 *     type:           "post_money_cap"  every SAFE forced post-money, and
 *                                       `pre_money_cap` unreachable (D5)
 *     antiDilution / participating       set on the NEW round only, never on the
 *                                       EXISTING class that needs protecting,
 *                                       and hardcoded "broad_based" (D1, R60)
 *
 * THE RULE THIS BLOCK IMPLEMENTS, from R60 §2-§4 and R6:
 *   1. EVERY term is READ FROM STORAGE. `buildCompanySecurities`
 *      (`server/routes.ts`) resolves each one out of the issuing round's
 *      `extras_json`, which is why WAVE 70 needed NO migration.
 *   2. ABSENT IS NEVER A DEFAULT WHERE THE NUMBER WOULD MOVE. A fabricated
 *      term is worse than a gap, so each one has a NAMED refusal.
 *   3. A REFUSAL NAMES THE FIELD, THE SECURITY AND WHAT TO DO. Never a clamp,
 *      never a guess, never a crash (R16, and D9's `Infinity → BigInt`).
 *
 * WHERE THE LINE IS DRAWN, STATED RATHER THAN HIDDEN. A refusal fires only when
 * the missing term WOULD CHANGE A NUMBER:
 *   · a note's interest rate always changes the outstanding balance → REFUSE
 *     the moment the note is adapted;
 *   · anti-dilution only bites when a LATER round prices BELOW an earlier
 *     class's original issue price → refused in `projectPostClose`, after the
 *     engine has produced the round's exact price per share, and only for the
 *     classes the down round actually reaches (R60 §4);
 *   · `participating` reaches NO arithmetic on the cap-table path at all — see
 *     `resolvePreferredTerms` for the executed proof and why it is therefore
 *     omitted rather than refused;
 *   · a SAFE's cap convention only bites when the SAFE HAS a cap, and the
 *     platform has no stored value for it on any legacy row, so it is an
 *     ASSUMPTION THAT IS STATED ON SCREEN rather than a refusal. See
 *     `resolveSafeCapType`.
 *
 * AUTHORITIES, named as R29 requires:
 *   · Post-money SAFE conversion and the "Company Capitalization" denominator:
 *     https://www.ycombinator.com/documents
 *     https://www.ycombinator.com/blog/announcing-the-post-money-safe
 *   · Pre-money SAFE (legacy) conversion: https://www.ycombinator.com/documents
 *   · Weighted-average anti-dilution and the base measured IMMEDIATELY PRIOR
 *     to the dilutive issuance: NVCA Model Certificate of Incorporation
 *     §4.4(d)(ii)(A). https://nvca.org/model-legal-documents/
 *   · Convertible-note accrued interest `P + P·r·t`:
 *     https://pulley.com/guides/convertible-notes
 *   · Percent-as-written storage, fractional wire, one bridge: owner rulings
 *     R16 / R30, and R60 for the anti-dilution term itself.
 */

/** The SAFE cap conventions the engine implements. Both are reachable now (D5). */
export type SafeCapTypeStored = "post_money_cap" | "pre_money_cap";
/** The anti-dilution methods the engine implements, per R60 §3. */
export type AntiDilutionTypeStored = "none" | "broad_based" | "narrow_based" | "full_ratchet";

const SAFE_CAP_TYPES_STORED: readonly SafeCapTypeStored[] = ["post_money_cap", "pre_money_cap"];
const ANTI_DILUTION_TYPES_STORED: readonly AntiDilutionTypeStored[] = [
  "none",
  "broad_based",
  "narrow_based",
  "full_ratchet",
];

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 76 · R60 / R21 — THE TWO CLOSED VOCABULARIES, VALIDATED IN ONE PLACE.
   ═══════════════════════════════════════════════════════════════════════════
   WHAT WAS MEASURED, NOT ASSUMED. Wave 76's probe
   (`build_log/wave76/W76_PROBE_TRANSCRIPT.txt`) drove all three HTTP writers
   against these two keys and found THREE DIFFERENT BEHAVIOURS for the same field:

     PATCH /api/rounds/:id/terms   antiDilutionType="full_ratchet"  -> 200, DROPPED
     PATCH /api/founder/rounds/:id antiDilutionType="full_ratchet"  -> 200, PERSISTED
     PATCH /api/founder/rounds/:id antiDilutionType="FULL_RATCHET"  -> 200, PERSISTED
     PATCH /api/founder/rounds/:id antiDilutionType=7               -> 200, PERSISTED
     POST  /api/rounds             antiDilutionType="nonsense-method" -> 200, PERSISTED

   So the defect was never that the term is uncorrectable — it is that two writers
   accept ANY value and the third silently discards a VALID one. A stored
   `"FULL_RATCHET"` is the worst outcome of the three: it is a plausible typing of a
   real method, it is accepted with a 200, and `resolvePreferredTerms` below then
   throws `invalid_anti_dilution_type` — so the cap table stops producing a share
   count and the founder is never told which keystroke did it.

   THE RULE IS DECLARED HERE, ONCE, BESIDE THE VOCABULARY IT ENFORCES, and imported
   by every writer. Waves 58e, 58f and 61b were each caught by fixing ONE writer of
   a term that had more than one; the count here is FOUR (the fourth,
   `.../carry-forward/accept`, filters its patch to the core-column whitelist and
   cannot reach either key — verified, not assumed).

   NEVER COERCED, NEVER DEFAULTED. `"FULL_RATCHET"` is REFUSED rather than
   lower-cased, and `"post money"` is REFUSED rather than mapped to
   `"post_money_cap"`. Guessing that a founder who typed one thing meant another is
   the same act as inventing the term outright: on the R64/R65 fixture the three
   anti-dilution methods give materially different share counts on one event, so a
   silent correction is a silent restatement of the deal. `"none"` IS a term on
   record — it means the class negotiated no protection — and it is accepted.

   ABSENT IS ABSENT. `null` / `undefined` / `""` all return `{ ok: true, value: "" }`,
   which every caller reads as "write nothing". Distinguishing ABSENT from EXPLICIT
   REMOVAL is the CALLER's job, exactly as it already is for `discount`: the route
   tests `body[key] !== undefined` before it consults this verdict. */

/** The four anti-dilution methods, for a UI control or a refusal to enumerate. */
export const ANTI_DILUTION_TYPES_FOR_INPUT: readonly AntiDilutionTypeStored[] =
  ANTI_DILUTION_TYPES_STORED;
/** The two SAFE cap conventions, for a UI control or a refusal to enumerate. */
export const SAFE_CAP_TYPES_FOR_INPUT: readonly SafeCapTypeStored[] = SAFE_CAP_TYPES_STORED;

/** Shared shape for both closed-vocabulary refusals, so the two cannot drift. */
function closedVocabularyTerm(args: {
  field: string;
  label: string;
  raw: unknown;
  allowed: readonly string[];
  meaning: string;
}): TermValueVerdict {
  const { field, label, raw, allowed, meaning } = args;
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return { ok: true, value: "" }; // absent — untouched, never defaulted
  }
  const list = allowed.map((a) => `"${a}"`).join(", ");
  if (typeof raw !== "string") {
    return {
      ok: false,
      error: `invalid_${field}`,
      message:
        `${label} must be one of ${list}. Capavate received the ${typeof raw} ${JSON.stringify(raw)}, which is ` +
        `not one of them, and will not guess which was negotiated. ${meaning}`,
    };
  }
  const v = raw.trim();
  if (!allowed.includes(v)) {
    /* The near-miss is named explicitly, because it is the failure a founder will
       actually hit — and it is REFUSED, not silently corrected. */
    const nearMiss = allowed.find((a) => a.toLowerCase() === v.toLowerCase().replace(/[\s-]+/g, "_"));
    return {
      ok: false,
      error: `invalid_${field}`,
      message:
        `${label} must be exactly one of ${list}. Capavate received "${v}", which is not, so NOTHING has been ` +
        (nearMiss
          ? `stored. Did you mean "${nearMiss}"? Capavate will not assume so: these values are read by the ` +
            `cap-table engine as written, and quietly rewriting one of a founder's recorded deal terms into ` +
            `another is the defect this refusal exists to prevent (owner ruling R60). Send the exact value. `
          : `stored. ${meaning} `) +
        (nearMiss ? meaning : ""),
    };
  }
  return { ok: true, value: v };
}

/**
 * R60 · `antiDilutionType` ∈ {none, broad_based, narrow_based, full_ratchet}.
 *
 * THE SAME FOUR TOKENS `resolvePreferredTerms` enforces below, read off the SAME
 * constant, so a value this function accepts can never be one the engine path
 * refuses. That symmetry is the whole point: before Wave 76 a writer could store a
 * token the reader would later reject, which turns a typing mistake into a cap
 * table that will not compute.
 */
export function validateAntiDilutionTypeStored(raw: unknown): TermValueVerdict {
  return closedVocabularyTerm({
    field: "antiDilutionType",
    label: "Anti-dilution method",
    raw,
    allowed: ANTI_DILUTION_TYPES_STORED as readonly string[],
    meaning:
      `Anti-dilution protection is what re-prices an existing preferred class when a later round prices BELOW ` +
      `that class's original issue price. The three protective methods give materially different share counts on ` +
      `identical facts — "full_ratchet" re-prices the whole class to the new price, while "broad_based" and ` +
      `"narrow_based" weighted average differ in which shares are counted in the base (NVCA Model Certificate of ` +
      `Incorporation, section 4.4(d)(ii)(A); https://nvca.org/model-legal-documents/). "none" is a real term and ` +
      `means the class negotiated no protection. Record what the class's own documents say.`,
  });
}

/**
 * D5 · `safeType` ∈ {post_money_cap, pre_money_cap}.
 *
 * The engine's OWN vocabulary, not a second spelling of it. While the value is
 * unset the adapter states the YC post-money assumption on screen rather than
 * choosing silently (`resolveSafeCapType`), so an absent value stays absent here.
 */
export function validateSafeCapTypeStored(raw: unknown): TermValueVerdict {
  return closedVocabularyTerm({
    field: "safeType",
    label: "SAFE cap convention",
    raw,
    allowed: SAFE_CAP_TYPES_STORED as readonly string[],
    meaning:
      `A SAFE's cap convention decides what the cap is a cap ON, and therefore how many shares the SAFE converts ` +
      `into. "post_money_cap" is the YC v1.2 post-money SAFE, where the cap measures capitalisation AFTER the SAFE ` +
      `converts; "pre_money_cap" is the legacy pre-money SAFE, where it measures capitalisation before ` +
      `(https://www.ycombinator.com/documents). The two conventions give different conversion prices and different ` +
      `share counts on identical terms, which is why Capavate stores which one the instrument actually is.`,
  });
}

/**
 * The base class for every WAVE 70 refusal.
 *
 * SUBCLASSED RATHER THAN PARAMETERISED so each refusal has its OWN `name`. The
 * brief's requirement is "refuses BY NAME": a caller, a test and an HTTP body
 * must all be able to say WHICH term was missing without parsing prose.
 */
export class RoundMathTermRefusal extends Error {
  /** Stable machine code. Safe to put in an HTTP body and to assert on. */
  readonly code: string;
  /** The security whose stored row is incomplete, so the founder can find it. */
  readonly securityId: string;
  /** The field name as the founder sees it on the terms form. */
  readonly field: string;
  constructor(code: string, securityId: string, field: string, message: string) {
    super(message);
    this.name = "RoundMathTermRefusal";
    this.code = code;
    this.securityId = securityId;
    this.field = field;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 72 · DEFECT 1 — TWO REFUSALS THE PROJECTION DID NOT HAVE.
 * ═══════════════════════════════════════════════════════════════════════════
 * Both are modelled on `invalid_pre_money_valuation` below — same base class,
 * same `code`/`securityId`/`field` shape, same 422 mapping on
 * `server/roundMathRoutes.ts` — rather than inventing a second refusal idiom.
 */

/**
 * DEFECT 1 fault 1 — THE PRICING DENOMINATOR WAS ZERO, so no price exists.
 *
 * The engine raises `ZeroPricingDenominatorError` at the one line that divides a
 * valuation by a share count; this is its founder-facing form, so the HTTP layer
 * and the UI see the same named refusal they already handle for every other
 * missing term. The engine's own sentence is carried through verbatim rather than
 * rewritten, so the two layers cannot be read as describing different problems.
 */
export class ZeroPricingDenominatorRefusal extends RoundMathTermRefusal {
  /** The fully-diluted count that was zero, exactly as the engine measured it. */
  readonly fdSharesBeforeRound: string;
  constructor(series: string, fdSharesBeforeRound: string, engineMessage: string) {
    super("zero_pricing_denominator", series, "shares", engineMessage);
    this.name = "ZeroPricingDenominatorRefusal";
    this.fdSharesBeforeRound = fdSharesBeforeRound;
  }
}

/**
 * DEFECT 1 fault 2 — THE FIXED-POINT PRICING SOLVE DID NOT SETTLE.
 *
 * INDEPENDENT OF FAULT 1, and that is the point: `converged="false"` was being
 * returned inside a SUCCESSFUL projection, so the platform reported a settled
 * price it never settled — a dead promise. The solve is
 * `p ← preMoney ÷ D(p)`, iterated to EXACT decimal equality with a
 * repeat-detector (never an epsilon); it reports `converged="false"` when it hit
 * a floor()-induced 2-cycle or the 24-iteration ceiling, i.e. when two different
 * prices are both self-consistent. Which of the two is "the" price is a modelling
 * decision, not an arithmetic fact, so the projection refuses instead of picking.
 *
 * THE ONE EXEMPTION, NAMED RATHER THAN HIDDEN: `legacy_pre_w52`. That mode is the
 * Wave 52b ROLLBACK pole — it deliberately runs NO solve at all (iterations `0`)
 * and keeps the pre-Wave-52 straight-line price, and it reports
 * `converged="false"` precisely so the trace never claims a fixed point it never
 * looked for. Refusing there would not fix a dead promise; it would delete the
 * rollback the platform flag exists to provide, and its disclosure banner already
 * states on screen which order produced the number. So the exemption is scoped to
 * that ONE mode, read off the trace's own `pricingOrderMode`, and it is listed as
 * an OWNER QUESTION in `build_log/wave72/WAVE72_REPORT.md`.
 */
export class PricingSolveNotConvergedRefusal extends RoundMathTermRefusal {
  /** Iterations the solve actually ran, from the engine's own transcript. */
  readonly iterations: string;
  /** The full price trail, so the two rival prices are on the record. */
  readonly trail: string;
  constructor(series: string, iterations: string, trail: string, lastPrice: string) {
    super(
      "pricing_solve_not_converged",
      series,
      "pricePerShare",
      `The price per share for ${series} did not settle. Capavate solves the price as a fixed point — ` +
        `price = pre-money valuation ÷ the fully-diluted count that the price itself determines (the new ` +
        `option pool and every converting SAFE/note are inside that count) — and it stops only when two ` +
        `successive prices are EXACTLY equal. After ${iterations} iteration(s) it did not: the trail was ` +
        `${trail}, ending at ${lastPrice}. That means more than one price is self-consistent on these ` +
        `terms, and Capavate will not present one of them as the closed price, because every share count ` +
        `and ownership percentage on this projection is divided by it. Enter an explicit price per share on ` +
        `the round's terms (Rounds → Edit terms) — a stored price is used as given and needs no solve — or ` +
        `adjust the pre-money valuation, the raise or the option-pool target.`,
    );
    this.name = "PricingSolveNotConvergedRefusal";
    this.iterations = iterations;
    this.trail = trail;
  }
}

/** D6 — a convertible note with no stored interest rate. NEVER defaulted. */
export class MissingNoteInterestRateError extends RoundMathTermRefusal {
  constructor(securityId: string) {
    super(
      "missing_note_interest_rate",
      securityId,
      "interestRate",
      `This convertible note (${securityId}) has no interest rate on record, so Capavate cannot compute what ` +
        `is owed on it. A note's balance at conversion is principal + principal × rate × years, and every ` +
        `share the holder receives depends on that rate. Capavate will NOT assume one: before this wave the ` +
        `engine used a hardcoded 5% and the carry-forward suggestion used 6%, and neither was the rate anybody ` +
        `agreed to. Enter the note's annual interest rate on the round's terms — it is PERCENT-AS-WRITTEN ` +
        `(owner ruling R16 / R30), so type 6 for 6% a year. If the note genuinely bears no interest, enter 0.`,
    );
    this.name = "MissingNoteInterestRateError";
  }
}

/** D6 — a stored interest rate that cannot be read as a rate. NEVER rescaled. */
export class InvalidInterestRateWireValueError extends RoundMathTermRefusal {
  constructor(securityId: string, rawStored: unknown, detail: string) {
    super(
      "invalid_interest_rate",
      securityId,
      "interestRate",
      `The interest rate stored against ${securityId} is "${String(rawStored)}", which Capavate will not put ` +
        `on the engine wire. ${detail} The value has NOT been rescaled, clamped or guessed at (R16): magnitude ` +
        `is never evidence of unit.`,
    );
    this.name = "InvalidInterestRateWireValueError";
  }
}

/**
 * D9 — a STORED discount outside `[0, 100)` that the WIRE guard admits.
 *
 * THE EXACT HOLE THIS CLOSES, and why it needed its own class. The write fence
 * `validateDiscountPercentAsWritten` refuses `100`. The WIRE guard's domain is
 * `[0,1]` INCLUSIVE — a deliberate, documented asymmetry (see `toWireDiscount`)
 * — so `toWireDiscount(100)` returns the fraction `"1"` and is CORRECT to do so:
 * it defends the arithmetic, not the founder's intent. The conversion price is
 * then `PPS × (1 − 1) = 0`, `purchase ÷ 0 = Infinity`, and `decimalToShares`
 * reached `BigInt("Infinity")`:
 *
 *     SyntaxError: Cannot convert Infinity to a BigInt
 *
 * Reachable on a LEGACY ROW, because migration 0192's UPDATE triggers validate
 * CHANGES, not STATE (deliberate, per R41) — a pre-fence `100` is never
 * re-validated. It surfaced as a 500 and a blank Projection.
 *
 * `toWireDiscount` IS NOT WEAKENED AND NOT DUPLICATED (R34, W58G-D1). This gate
 * runs AFTER it, so `20260707` still raises `InvalidDiscountWireValueError`
 * exactly as W58E-D1f asserts, and only the ONE value the wire guard admits but
 * the domain forbids — exactly `100` — arrives here.
 */
export class StoredDiscountOutOfDomainError extends RoundMathTermRefusal {
  constructor(securityId: string, rawStored: unknown, detail: string) {
    super(
      "stored_discount_out_of_domain",
      securityId,
      "discount",
      `The discount stored against ${securityId} is "${String(rawStored)}", which is outside the domain ` +
        `[0, 100) this platform stores discounts in. ${detail} Capavate is refusing rather than computing: at ` +
        `100% the conversion price is $0 and the share count is arithmetically infinite. Correct the discount ` +
        `on the round's terms.`,
    );
    this.name = "StoredDiscountOutOfDomainError";
  }
}

/**
 * D4 — the As-Converted view asked for, with no round price to convert AT.
 *
 * WHAT THIS REPLACES: `const estPps = preferred.length ? … : 1`. A literal
 * `$1.00` per share, presented to the founder as an ownership percentage. On the
 * documented fixture it made a SAFE worth 2,500,000 shares that the same engine
 * converts at 2,250,000, and moved founder ownership from 51.512…% to 66.180…%.
 * A fabricated price is a fabricated cap table (R6).
 */
export class AsConvertedPriceUnknownError extends RoundMathTermRefusal {
  constructor(securityIds: string[]) {
    super(
      "as_converted_price_unknown",
      securityIds.join(","),
      "pricePerShare",
      `The As-Converted view cannot be computed: this company holds ${securityIds.length} convertible ` +
        `instrument(s) (${securityIds.join(", ")}) and NO priced round to convert them at. A SAFE or note ` +
        `converts at the lower of its cap-implied price and the round price × (1 − discount), and without a ` +
        `round price neither candidate exists. Capavate previously assumed $1.00 per share here and showed the ` +
        `resulting percentages as fact; it now refuses. Use the Fully-Diluted view, which states its own ` +
        `denominator and excludes unconverted convertibles, or record the priced round.`,
    );
    this.name = "AsConvertedPriceUnknownError";
  }
}

/**
 * D1 / R60 §4 — a DOWN ROUND reached a preferred class whose anti-dilution term
 * is not on record.
 *
 * THIS IS THE REFUSAL R60 ASKS FOR, IN THE PLACE IT ASKS FOR IT. Anti-dilution
 * is a negotiated contractual right. Before this wave the adapter set no
 * `antiDilution` on any existing security, so `applyAntiDilutionPass` returned
 * every protected class untouched and the platform showed a confident, wrong
 * number: a down round from $2.50 to $0.6154 left Series A at exactly 4,000,000
 * shares where the engine's own broad-based formula yields 4,516,129.
 *
 * "An unprotected number presented as final is worse than an honest refusal"
 * (R60 §4, R6). So the number is not shown.
 */
export class UnknownAntiDilutionTermError extends RoundMathTermRefusal {
  /** The round price that triggered the protection, exact. */
  readonly newIssuePrice: string;
  /** The class's original issue price, exact. */
  readonly originalIssuePrice: string;
  constructor(securityId: string, series: string | null, oip: string, nip: string) {
    super(
      "unknown_anti_dilution_term",
      securityId,
      "antiDilutionType",
      `This is a DOWN ROUND for ${series ?? "an existing preferred class"} (${securityId}): the new round ` +
        `prices at $${nip} per share, below that class's original issue price of $${oip}. Anti-dilution ` +
        `protection therefore applies — and Capavate has no anti-dilution method on record for this class, so ` +
        `it will not state a share count. The three industry methods give materially different answers on the ` +
        `same facts (full ratchet, broad-based weighted average, narrow-based weighted average), and asserting ` +
        `one nobody negotiated is the defect this refusal exists to prevent (owner ruling R60). Record the ` +
        `class's anti-dilution term on the round that issued it, then re-run the projection.`,
    );
    this.name = "UnknownAntiDilutionTermError";
    this.originalIssuePrice = oip;
    this.newIssuePrice = nip;
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  D6 — THE INTEREST-RATE BRIDGE. ONE DIVISION BY 100, IN ONE PLACE.
 * ───────────────────────────────────────────────────────────────────────────── */

/** The unit the DATABASE holds a note's interest rate in. Declared, never sniffed. */
export const INTEREST_RATE_STORAGE_UNIT = "percent_as_written" as const;
/** The unit the ENGINE takes on the wire. */
export const INTEREST_RATE_WIRE_UNIT = "fraction_0_to_1" as const;

export type WireInterestRate = {
  /** The stored value, exactly as it arrived, for disclosure and refusals. */
  readonly storedPercent: string;
  /** The engine wire value: an exact decimal string in [0,1]. */
  readonly wireFraction: string;
  /** The same fraction as a number, for callers that need a float. */
  readonly asNumber: number;
};

/**
 * THE INTEREST-RATE BOUNDARY — the exact shape of `toWireDiscount`, for the
 * exact same reason, and it is the ONLY place a note's rate is ever divided.
 *
 * R16, restated for this field: STORAGE IS PERCENT-AS-WRITTEN (`6` means 6% a
 * year, R30); THE ENGINE WIRE IS FRACTIONAL (`0.06`). This function divides by
 * 100 EXACTLY ONCE. Nothing else in the tree may divide an interest rate, and
 * nothing may divide it twice — DLA Piper's word for conflating the two forms of
 * a rate is "quadrupling", and it reaches signed documents.
 *
 * THE CONVERSION IS UNCONDITIONAL. It never inspects the magnitude to decide
 * whether to convert; the storage unit is DECLARED, and a declared unit is
 * evidence where a magnitude is not. A stored `0.06` therefore means six
 * hundredths of one percent, and is not silently read as 6%.
 *
 * ABSENT RETURNS `undefined`, and absent is NOT zero. The caller decides what to
 * do about it, and for a note the caller REFUSES (`MissingNoteInterestRateError`).
 *
 * A WIRE VALUE OUTSIDE `[0,1]` IS REJECTED, NEVER RESCALED. `INTEREST_RATE_PERCENT_MAX`
 * is 100, so the fence and the wire domain coincide by construction.
 */
export function toWireInterestRate(rawStoredPercent: unknown, securityId: string): WireInterestRate | undefined {
  if (rawStoredPercent === null || rawStoredPercent === undefined || String(rawStoredPercent).trim() === "") {
    return undefined;
  }
  const verdict = validateInterestRatePercentAsWritten(rawStoredPercent);
  if (!verdict.ok) throw new InvalidInterestRateWireValueError(securityId, rawStoredPercent, verdict.message);
  let pct: InstanceType<typeof DiscountDec>;
  try {
    pct = new DiscountDec(verdict.percent as never);
  } catch {
    throw new InvalidInterestRateWireValueError(
      securityId,
      rawStoredPercent,
      "It could not be parsed as an exact decimal.",
    );
  }
  /* THE ONE DIVISION. Unconditional, exact, decimal.js at engine precision. */
  const frac = pct.div(100);
  if (!frac.isFinite() || frac.lt(0) || frac.gt(1)) {
    throw new InvalidInterestRateWireValueError(
      securityId,
      rawStoredPercent,
      `Converted to the engine's fractional unit it is ${frac.toFixed()}, which is outside [0,1].`,
    );
  }
  return { storedPercent: pct.toFixed(), wireFraction: frac.toFixed(), asNumber: frac.toNumber() };
}

/**
 * D9 — the discount as it reaches the engine, with the STATE domain enforced.
 *
 * ORDER IS LOAD-BEARING AND IS NOT AN ACCIDENT. `toWireDiscount` runs FIRST, so
 * `20260707` still raises `InvalidDiscountWireValueError` and the message still
 * names the stored value — W58E-D1f and W58G-D2 both assert that by name and
 * neither changes. The state-domain check runs SECOND, so the only value that
 * can reach it is one the wire guard admitted: in `(0, 100]` the wire fraction is
 * in `(0, 1]`, and the single value the two domains disagree about is exactly
 * `100`. That value now produces a named refusal instead of
 * `SyntaxError: Cannot convert Infinity to a BigInt`.
 */
export function toEngineDiscount(rawStoredPercent: unknown, securityId: string): string | undefined {
  const wire = toWireDiscount(rawStoredPercent, securityId);
  if (wire === undefined) return undefined;
  const verdict = validateDiscountPercentAsWritten(rawStoredPercent);
  if (!verdict.ok) throw new StoredDiscountOutOfDomainError(securityId, rawStoredPercent, verdict.message);
  return wire.wireFraction;
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  D5 — THE SAFE CAP CONVENTION, READ RATHER THAN FORCED.
 * ───────────────────────────────────────────────────────────────────────────── */

export type ResolvedSafeCapType = {
  readonly capType: SafeCapTypeStored;
  /** `true` when NOTHING was stored and the market default is being assumed. */
  readonly assumed: boolean;
  /** Non-null exactly when `assumed` is true. The sentence to put on screen. */
  readonly assumption: string | null;
};

/**
 * THE STORED CAP CONVENTION, OR A STATED ASSUMPTION — never a silent choice.
 *
 * `roundMathEngineAdapter.ts:892` used to read `type: "post_money_cap"`,
 * unconditionally, for every SAFE that ever reached the engine. `pre_money_cap`
 * IS implemented in the engine and produces different, correct results — on
 * identical terms ($2,000,000 at a $10,000,000 cap over a 10,000,000-share base)
 * post-money gives $0.80 and 2,500,000 shares, pre-money gives $1.00 and
 * 2,000,000 — and it was unreachable through the platform. §11 request 5 of the
 * document already sent to Shadie asks her to test exactly this.
 *
 * WHY THIS IS AN ASSUMPTION AND NOT A REFUSAL, stated plainly because the brief
 * offered both. There is NO STORED VALUE for this term on any existing row: the
 * carry-forward engine derives a `safeType` from a string match on the free-text
 * series label and then discards it, and `rounds.extras_json` has never carried
 * the key. Refusing on absence would blank every SAFE on every existing cap
 * table — a regression dressed as a safeguard, and worse for the founder than
 * the defect. So:
 *   · a STORED value is used, and `pre_money_cap` is now reachable;
 *   · absence is ASSUMED to be YC v1.2 post-money, which is the market standard
 *     and is what the platform has always computed, so no existing number moves
 *     for that reason alone;
 *   · the assumption is RETURNED, not swallowed, and is stated on the
 *     As-Converted denominator panel of `/founder/captable`;
 *   · `safeType` is now on the round extras whitelist, so a founder CAN record
 *     the real convention and stop the assumption applying to their round.
 * It stays an OWNER QUESTION whether absence should harden into a refusal once a
 * write surface exists.
 */
export function resolveSafeCapType(s: ApiSecurity): ResolvedSafeCapType {
  const raw = s.safeCapType;
  if (raw !== null && raw !== undefined && String(raw).trim() !== "") {
    const v = String(raw).trim();
    if ((SAFE_CAP_TYPES_STORED as readonly string[]).includes(v)) {
      return { capType: v as SafeCapTypeStored, assumed: false, assumption: null };
    }
    /* An unreadable stored value is NOT quietly replaced by the default. */
    throw new RoundMathTermRefusal(
      "invalid_safe_cap_type",
      s.id,
      "safeType",
      `The SAFE cap convention stored against ${s.id} is "${v}", which is neither "post_money_cap" nor ` +
        `"pre_money_cap". The two conventions produce different share counts on identical terms, so Capavate ` +
        `will not pick one for you.`,
    );
  }
  return {
    capType: "post_money_cap",
    assumed: true,
    assumption:
      `SAFE cap convention not on record — read as POST-MONEY (YC SAFE v1.2, the current market standard). ` +
      `A pre-money SAFE on the same terms converts at a HIGHER price and issues FEWER shares, so this ` +
      `assumption is favourable to the SAFE holder and dilutive to existing holders. Record the convention on ` +
      `the round's terms to replace this assumption with your actual document.`,
  };
}

/**
 * Every distinct cap-convention assumption in force on a ledger, for display.
 *
 * Returned as a de-duplicated list of sentences so a screen can state the
 * assumption once rather than per row. Empty when every SAFE's convention is on
 * record — the point being that this notice DISAPPEARS when the data improves.
 */
export function safeCapTypeAssumptions(secs: ApiSecurity[]): string[] {
  const out: string[] = [];
  for (const s of secs) {
    if (s.instrument !== "safe") continue;
    if (!s.cap) continue; /* With no cap the convention reaches no arithmetic. */
    const r = resolveSafeCapType(s);
    if (r.assumption && !out.includes(r.assumption)) out.push(r.assumption);
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  D1 / R60 — THE PREFERRED CLASS'S OWN NEGOTIATED TERMS.
 * ───────────────────────────────────────────────────────────────────────────── */

export type ResolvedPreferredTerms = {
  /** Present ONLY when a method is on record. Absent = the engine leaves the class alone. */
  readonly antiDilution?: AntiDilutionTypeStored;
  /** Present ONLY when the term is on record. See the note on `participating`. */
  readonly participating?: boolean;
  /** `true` when no anti-dilution method is on record for this class. */
  readonly antiDilutionUnknown: boolean;
};

/**
 * THE EXISTING CLASS'S TERMS, READ FROM STORAGE (R60 §2).
 *
 * WHAT WAS WRONG. `adaptSecuritiesToEngine` built every `preferred` security
 * with `{ liquidationPreferenceMultiple: 1, participating: false, seniority: 0,
 * originalIssuePrice }` and NO `antiDilution` key at all, while
 * `projectPostClose` set `antiDilution: "broad_based"` on the NEW round being
 * issued. That is the wrong side of the transaction: anti-dilution protects
 * EARLIER investors when a LATER round prices lower, so the property has to be
 * carried by the class that needs protecting. Measured consequence: a down round
 * $2.50 → $0.6154 left Series A at exactly 4,000,000 shares and emitted no
 * anti-dilution trace step; the identical fixture with `antiDilution:
 * "broad_based"` on the class yields 4,516,129.
 *
 * ABSENT IS ABSENT. When no method is on record the key is OMITTED rather than
 * defaulted, so `applyAntiDilutionPass` behaves exactly as it does today and NO
 * existing number moves silently. The gap is carried out in `antiDilutionUnknown`
 * and refused by `projectPostClose` at the point a down round makes it matter.
 *
 * `participating`, AND WHY IT IS NOT REFUSED — the honest answer to R60 §6.
 * The hardcoded `participating: false` is the same defect class, and it is no
 * longer hardcoded here: a stored term is read, and absence omits the key rather
 * than asserting non-participation. It is NOT refused, because on this path it
 * reaches NO arithmetic — `packages/cap-table-engine/src/captable/compute.ts`
 * never reads `Security.preferred.participating`; only the liquidation waterfall
 * does, and the one reachable waterfall surface
 * (`GET /api/founder/captable/waterfall`) builds its OWN input and hardcodes
 * `participating: false` at `server/track1Routes.ts:190`. Refusing a cap table
 * over a field that cannot change it would be theatre; fixing the surface that
 * DOES read it is finding D11, which is Wave 71's. Stated here so nobody reads
 * this omission as the whole of R60 §6.
 */
export function resolvePreferredTerms(s: ApiSecurity): ResolvedPreferredTerms {
  let antiDilution: AntiDilutionTypeStored | undefined;
  const rawAd = s.antiDilutionType;
  if (rawAd !== null && rawAd !== undefined && String(rawAd).trim() !== "") {
    const v = String(rawAd).trim();
    if (!(ANTI_DILUTION_TYPES_STORED as readonly string[]).includes(v)) {
      throw new RoundMathTermRefusal(
        "invalid_anti_dilution_type",
        s.id,
        "antiDilutionType",
        `The anti-dilution method stored against ${s.id} is "${v}", which is not one of "none", ` +
          `"broad_based", "narrow_based" or "full_ratchet". The three formulas give materially different ` +
          `share counts on identical facts, so Capavate will not guess which was negotiated.`,
      );
    }
    antiDilution = v as AntiDilutionTypeStored;
  }
  let participating: boolean | undefined;
  if (s.participatingPreferred === true || s.participatingPreferred === false) {
    participating = s.participatingPreferred;
  }
  return {
    ...(antiDilution !== undefined ? { antiDilution } : {}),
    ...(participating !== undefined ? { participating } : {}),
    /* "none" IS a term on record — it means the class negotiated no protection.
       Only true absence is unknown. */
    antiDilutionUnknown: antiDilution === undefined,
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 *  D6 / D7 — THE TWO NOTE FIELDS, RESOLVED ONCE FOR EVERY CALLER.
 * ───────────────────────────────────────────────────────────────────────────── */

/**
 * The note's interest rate on the engine wire, or a NAMED REFUSAL.
 *
 * There is exactly one of these in the tree and both note paths call it — the
 * engine payload in `adaptSecuritiesToEngine` and the As-Converted preview in
 * `asConvertedConvertibleShares` — so the two cannot disagree about what a note
 * is worth. That was D6's actual damage: three treatments of one rate.
 *
 * WHAT IT WILL NOT DO. It will not return 5%, it will not return 6%, and it will
 * not return 0 for a missing value. A note with no rate on record produces no
 * number at all (R6, and the D6 finding's own conclusion).
 */
export function requireNoteInterestRateWire(s: ApiSecurity): string {
  const wire = toWireInterestRate(s.interestRate, s.id);
  if (wire === undefined) throw new MissingNoteInterestRateError(s.id);
  return wire.wireFraction;
}

/**
 * D7 — the note's maturity date. ONE canonical field, ONE derivation.
 *
 * ── WAVE 77 · R71 — THE PRECEDENCE IS NOW THE OTHER WAY ROUND ────────────────
 * Owner ruling R71 condition 1: **`maturityMonths` is the canonical field and
 * `maturityDate` is DERIVED from it, not independently writable.** Before this
 * wave a stored absolute date won, so a round could carry two spellings of one
 * fact and nothing in the tree said which was true. It now reads:
 *
 *   1. `maturityMonths` (canonical) + the issue date -> the date, by CALENDAR
 *      month arithmetic (`setUTCMonth`), never "months × 30". R50's domain
 *      `[0, 600]` is restated at this read boundary, so a date typed into a
 *      months field (`20261231`) is IGNORED rather than turned into a
 *      1.7-million-year maturity.
 *   2. Only if there is no usable canonical value: a stored absolute
 *      `maturityDate` is still READ. **R71 condition 3 — existing stored values
 *      must be read, not orphaned.** Nothing is overwritten in storage by this
 *      function, and it never writes.
 *   3. Neither -> `{}`; the key is omitted and the engine's note type permits
 *      that (see `types.ts`).
 *
 * NO SILENT DROP (R71 condition 2): every surface that displayed a maturity date
 * still displays one — `client/src/pages/founder/CapTable.tsx:630` reads
 * `s.maturityDate` off `GET /api/companies/:id/securities`, which is built by
 * `server/routes.ts::buildCompanySecurities`, which now fills that field through
 * THIS function. Same field, same screen, derived value.
 *
 * NOTHING DOWNSTREAM TRIGGERS ON IT, and that is still the honest statement of
 * what D7 is. `convertNoteToPreferred` never reads a maturity date; there is no
 * maturity trigger and no automatic conversion.
 */
export function resolveNoteMaturityDate(s: ApiSecurity): { maturityDate?: string } {
  const derived = deriveMaturityDateFromMonths(s.maturityMonths, s.issuedAt);
  if (derived !== null) return { maturityDate: derived };
  /* R71 condition 3 — a LEGACY stored absolute date is read, never orphaned. */
  const raw = s.maturityDate;
  if (raw !== null && raw !== undefined && String(raw).trim() !== "") {
    return { maturityDate: String(raw).slice(0, 10) };
  }
  return {};
}

/**
 * WAVE 77 · R71 — THE ONE DERIVATION OF A MATURITY DATE, IN ONE PLACE.
 *
 * A quantity with two implementations is a quantity that will disagree (R21), and
 * a maturity date is exactly the quantity R71 was issued about. Every caller —
 * the engine path (`resolveNoteMaturityDate`), the cap-table read
 * (`buildCompanySecurities`) and the census script — goes through here.
 * Returns `null` when no canonical value is usable; NEVER a substituted date.
 */
export function deriveMaturityDateFromMonths(
  months: number | null | undefined,
  issuedAt: string | null | undefined,
): string | null {
  if (months === null || months === undefined || String(months).trim() === "") return null;
  if (!Number.isFinite(Number(months))) return null;
  if (!issuedAt || String(issuedAt).trim() === "") return null;
  const m = Math.trunc(Number(months));
  if (m < 0 || m > MATURITY_MONTHS_MAX) return null;
  const d = new Date(`${String(issuedAt).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  /* ── WAVE 79 · ITEM 4 / D-A4 — THE MONTH-END CLAMP ────────────────────────
     THIS WAS `d.setUTCMonth(d.getUTCMonth() + m)` ALONE, WHICH ROLLS OVER.
     `setUTCMonth` keeps the day-of-month and lets the date spill into the next
     month when the target month is shorter. Measured on the old line:

        1 month  from 2025-01-31 -> 2025-03-03   (should be 2025-02-28)
        1 month  from 2025-08-31 -> 2025-10-01   (should be 2025-09-30)
       12 months from 2024-02-29 -> 2025-03-01   (should be 2025-02-28)
        3 months from 2025-11-30 -> 2026-03-02   (should be 2026-02-28)

     A TWELVE-MONTH NOTE MATURING IN THE THIRTEENTH MONTH IS NOT A TWELVE-MONTH
     NOTE. Financial convention clamps to the last day of the target month: a note
     issued on the 31st matures on the last day of the maturity month. That is the
     rule in every end-of-month convention in use — ISDA 2006 Definitions §4.16
     ("End of Month": the payment date is the last calendar day of the month) and
     ICMA / EMU market practice for month-end roll dates. The correction can only
     move a date EARLIER inside the target month, never into a different month, so
     it cannot turn a matured note into an unmatured one in a later month.

     Set the day to 1 FIRST, so `setUTCMonth` cannot roll over while we compute the
     target month; then take that month's real last day; then clamp. `Date.UTC(y,
     mo + 1, 0)` is the last day of month `mo` — it is leap-year-correct by
     construction, so 2024-02 gives 29 and 2025-02 gives 28 with no year rule here.

     R71 is untouched: this is still ONE derivation in ONE place, still calendar
     arithmetic and never "months × 30", still returns `null` rather than
     substituting a date, and `m = 0` still returns the issue date itself (day
     clamped against its own month, which cannot move it). */
  const dayOfMonth = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + m);
  const lastDayOfTargetMonth = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(dayOfMonth < lastDayOfTargetMonth ? dayOfMonth : lastDayOfTargetMonth);
  return d.toISOString().slice(0, 10);
}

/**
 * WAVE 77 · R71 condition 3 — THE CENSUS PREDICATE, so a disagreement between the
 * two names is REPORTED rather than silently resolved.
 *
 * `agrees` is false ONLY when both a canonical `maturityMonths` (with an issue
 * date) and a stored absolute `maturityDate` exist AND they name different days.
 * This function never writes and never picks a winner — R71 says which spelling
 * wins on a live row is the owner's decision, not this code's.
 */
export function censusMaturityNames(s: ApiSecurity): {
  agrees: boolean;
  derived: string | null;
  stored: string | null;
} {
  const derived = deriveMaturityDateFromMonths(s.maturityMonths, s.issuedAt);
  const rawStored = s.maturityDate;
  const stored =
    rawStored === null || rawStored === undefined || String(rawStored).trim() === ""
      ? null
      : String(rawStored).slice(0, 10);
  return { agrees: derived === null || stored === null || derived === stored, derived, stored };
}

/**
 * WAVE 77 · R71 conditions 1 and 4 — THE ONE RULE, DECLARED ONCE FOR EVERY WRITER.
 *
 * R71 condition 4 says one rule must apply at every writer. The only way to
 * guarantee that structurally is for the writers to IMPORT the rule instead of
 * restating it — this project has paid four times for a rule that lived in three
 * places (Waves 58e, 58f, 61b, 76). The refusal is NAMED, it names the control
 * that does work (R58: never name a control that is not there), and it is a
 * REFUSAL, not a silent drop: `PATCH /api/rounds/:id/terms` used to accept a
 * `maturityDate` with HTTP 200 and drop it.
 */
export const MATURITY_DATE_NOT_WRITABLE = {
  error: "maturity_date_not_writable",
  field: "maturityDate",
  message:
    "Capavate records a round's maturity as Maturity (months) — the number of months from issue — " +
    "and computes the maturity date from it every time it is read. The absolute date cannot be " +
    "stored directly, because two spellings of one date can disagree and nothing could then say " +
    "which one is true. Set it on Founder -> Rounds -> the round -> Edit terms -> Maturity (months), " +
    `which accepts 0 to ${MATURITY_MONTHS_MAX} months (owner ruling R71; the bound is R50).`,
} as const;

/** A preferred class the ledger holds with NO anti-dilution term on record. */
export type UnknownAntiDilutionClass = {
  readonly securityId: string;
  readonly series: string | null;
  /** Exact, as stored. The price a later round has to fall below to bite. */
  readonly originalIssuePrice: string;
};

/**
 * `resolvePreferredTerms` reduced to the keys the engine payload accepts, with
 * the unknown-term bookkeeping pushed onto the caller's list as a side effect.
 *
 * SEPARATE FROM `resolvePreferredTerms` on purpose: that function is the pure,
 * testable read of what is on record; this one is the payload adaptation. Two
 * responsibilities, two functions, so a test can assert the read without
 * constructing a ledger.
 */
function preferredTermsFor(
  s: ApiSecurity,
  sink: UnknownAntiDilutionClass[],
): { antiDilution?: AntiDilutionTypeStored; participating?: boolean } {
  const { antiDilution, participating, antiDilutionUnknown } = resolvePreferredTerms(s);
  if (antiDilutionUnknown) {
    sink.push({
      securityId: s.id,
      series: s.series,
      /* The class's original issue price, exactly as stored. `projectPostClose`
         compares the round's solved price against this, and only a STRICTLY
         lower round price triggers the refusal (R60 §4). A class with no price
         on record cannot be shown to be down-rounded, so it is recorded with an
         empty price and skipped by that comparison rather than refused. */
      originalIssuePrice: s.pricePerShare != null ? String(s.pricePerShare) : "",
    });
  }
  return {
    ...(antiDilution !== undefined ? { antiDilution } : {}),
    ...(participating !== undefined ? { participating } : {}),
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 71 · D20 — THE FOUR TRANSACTION TYPES THE ADAPTER COULD NOT EXPRESS.
   ═══════════════════════════════════════════════════════════════════════════
   THE DEFECT, measured. `adaptSecuritiesToEngine` emitted ONLY
   `{ type: "issue", … }`. Executed on a ledger of a common row, an option row and
   a warrant row, the emitted transaction types were exactly
   `["issue","issue","issue"]`. The engine's `exercise_option` branch, its
   `exercise_warrant` branch and its standalone `esop_topup` branch are therefore
   unreachable from the only caller-facing entry point, and `exerciseOption` has no
   application caller anywhere in the tree. "We cannot disable vehicles" — an
   unreachable vehicle IS a disabled vehicle.

   WHAT THIS FIXES, EXACTLY: the ADAPTER can now express them. `events` is an
   OPTIONAL second argument, so every existing caller is byte-for-byte unaffected,
   and each event maps 1:1 onto an engine transaction with no arithmetic in
   between — this adapter does not compute an exercise, it says one happened and
   lets the engine's own leaf do the work.

   WHAT THIS DOES *NOT* FIX, AND THIS IS THE HONEST HALF (see
   `build_log/wave71/W71_VISIBILITY.md`). Nothing in the tree STORES such an
   event, so no route can yet supply one. Per vehicle, checked rather than assumed:
     · `exercise_option` — there is NO option-exercise store, table, migration or
       route anywhere in `server/`. `optionStatus.exercised` exists on
       `ApiSecurity` as a display counter with no event behind it. The vehicle is
       now EXPRESSIBLE and still has no writer. That writer is a feature, not a
       maths fix, and it is an OWNER QUESTION.
     · `exercise_warrant` — there IS a reachable server implementation
       (`server/lib/warrantExercise.ts`), but it does NOT record an exercise event:
       it writes the RESULT through the sacred `commitFunded` ledger as ordinary
       issued shares. So a warrant exercised through the platform reaches the
       engine as an `issue`, not as an `exercise_warrant`. Emitting BOTH from the
       same underlying fact would double-count the shares, which is why this
       adapter will not synthesise the event from a ledger row. It is emitted only
       when a caller states the event explicitly.
     · `esop_topup` standalone — the pool percentage lives on the ROUND
       (`optionPoolPostPercent` in `rounds.extras_json`), not on a security, and
       this function's input is securities. A pool-only round with no securities
       has nothing to attach to. Reachable TODAY through the priced round's own
       `optionPoolPostPercent` (Wave 58b); reachable as a STANDALONE transaction
       only through this channel.
     · `transfer` — **NOT EMITTED, DELIBERATELY, AND THIS CORRECTS THE FINDING.**
       D20 lists `transfer` alongside the other three as "unreachable". It is
       worse than unreachable: `transfer` is a declared member of the engine's
       `Transaction` union that NEITHER ENGINE IMPLEMENTS. Verified by execution of
       the transaction loops: `packages/cap-table-engine/src/captable/compute.ts`
       handles `issue`, `exercise_option`, `exercise_warrant`,
       `issue_preferred_round` and `esop_topup`, and
       `packages/cap-table-engine-ref/src/refCapTable.ts` handles the same five.
       A `transfer` transaction falls through both loops and changes nothing. So
       emitting one here would be a SILENT DROP — the founder would record a
       transfer of shares and no number would move — which is precisely what R21
       forbids. It is reported as an engine gap, not papered over with an emitter.
       The string `"transfer"` also does not appear anywhere in `server/` or
       `client/`, so there is nothing to wire it from either.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A cap-table event that is NOT the issuance of a security. One shape per engine
 * transaction type the engine actually implements; `transfer` is deliberately
 * absent — see the block above.
 */
export type ApiCapTableEvent =
  | { kind: "exercise_option"; securityId: string; sharesExercised: number | string | bigint; date: string }
  | { kind: "exercise_warrant"; securityId: string; date: string; cashless?: boolean | null; fmvPerShare?: string | number | null }
  /** `targetPercent` is PERCENT-AS-WRITTEN (R16): `"12"` is 12%, never `0.12`. */
  | { kind: "esop_topup"; targetPercent: string; mode?: "pre_money" | "post_money" | null; date: string };

/** Thrown when an event cannot be turned into a transaction without inventing a value. */
export class CapTableEventRefusal extends Error {
  readonly code: string;
  readonly field: string;
  constructor(code: string, field: string, message: string) {
    super(message);
    this.name = "CapTableEventRefusal";
    this.code = code;
    this.field = field;
  }
}

function eventToTransaction(e: ApiCapTableEvent): Transaction {
  const date = String(e.date ?? "").slice(0, 10);
  if (date === "") {
    throw new CapTableEventRefusal(
      "event_date_required", "date",
      `A cap-table event with no date cannot be placed in the ledger. The engine applies transactions in ` +
      `date order and the order changes the arithmetic, so Capavate will not date this event for you.`,
    );
  }
  if (e.kind === "exercise_option") {
    /* Exact, via string — an option count is a share count and must not round-trip
       through a float on the way to a `bigint`. */
    let shares: bigint;
    try {
      shares = BigInt(String(e.sharesExercised).trim());
    } catch {
      throw new CapTableEventRefusal(
        "invalid_shares_exercised", "sharesExercised",
        `"${String(e.sharesExercised)}" is not a whole number of option shares. Capavate will not round it.`,
      );
    }
    if (shares <= BigInt(0)) {
      throw new CapTableEventRefusal(
        "invalid_shares_exercised", "sharesExercised",
        `An option exercise of ${shares.toString()} shares is not an exercise. Record the number exercised.`,
      );
    }
    return { type: "exercise_option", securityId: e.securityId, sharesExercised: shares, date };
  }
  if (e.kind === "exercise_warrant") {
    const cashless = e.cashless === true;
    const fmvRaw = e.fmvPerShare;
    const fmv = fmvRaw === null || fmvRaw === undefined || String(fmvRaw).trim() === ""
      ? undefined
      : String(fmvRaw).trim();
    /* WAVE 71 · D12 — the refusal is the ENGINE LEAF's (`exerciseWarrant` now
       throws `CashlessExerciseFmvRequiredError`) and it is NOT duplicated here.
       One rule, one place (R21). The event is passed through exactly as stated and
       the leaf decides; `cashless` is `false` unless the caller said `true`, and a
       missing FMV is passed as ABSENT rather than as a zero price. */
    return {
      type: "exercise_warrant",
      securityId: e.securityId,
      date,
      cashless,
      ...(fmv !== undefined ? { fmvPerShare: fmv } : {}),
    };
  }
  /* esop_topup. PERCENT-AS-WRITTEN, passed through in the unit it arrived in —
     there is no conversion layer here and there must not be one (R16). */
  const pct = String(e.targetPercent ?? "").trim();
  if (!/^\d+(\.\d+)?$/.test(pct)) {
    throw new CapTableEventRefusal(
      "invalid_target_percent", "targetPercent",
      `The pool target "${pct}" is not a number. It is PERCENT-AS-WRITTEN (owner ruling R16): "12" means ` +
      `12%, and "0.12" means a tenth of one percent — it is never rescaled by how big it looks.`,
    );
  }
  return {
    type: "esop_topup",
    targetPercent: pct,
    mode: e.mode === "post_money" ? "post_money" : "pre_money",
    date,
  };
}

export function adaptSecuritiesToEngine(secs: ApiSecurity[], events?: ApiCapTableEvent[]): {
  holders: Holder[];
  transactions: Transaction[];
  /* WAVE 70 · D1 / R60 §4 — ADDITIVE THIRD FIELD. Existing callers destructure
     `{ holders, transactions }` and are unaffected. `projectPostClose` uses this
     to refuse a down round that reaches an unprotected class; nothing else does,
     which is why it is reported rather than thrown here (an up round needs no
     anti-dilution term and must not be blocked for lacking one). */
  unknownAntiDilutionClasses: UnknownAntiDilutionClass[];
} {
  const holders: Holder[] = [];
  const unknownAntiDilutionClasses: UnknownAntiDilutionClass[] = [];
  const seen = new Set<string>();
  for (const s of secs) {
    const id = s.holderName;
    if (seen.has(id)) continue;
    seen.add(id);
    holders.push({
      id,
      name: s.holderName,
      type: (s.holderType as Holder["type"]) ?? "other",
    });
  }

  const transactions: Transaction[] = secs.map<Transaction>((s, i) => {
    const baseId = s.id ?? `s-${i}`;
    if (s.instrument === "common" || s.instrument === "preferred") {
      return {
        type: "issue",
        date: s.issuedAt ?? "2025-01-01",
        security: {
          id: baseId,
          holderId: s.holderName,
          kind: s.instrument,
          series: s.series ?? undefined,
          shares: BigInt(s.shares),
          pricePerShare: s.pricePerShare?.toString(),
          investmentAmount: s.investmentAmount?.toString(),
          ...(s.instrument === "preferred" ? {
            preferred: {
              liquidationPreferenceMultiple: 1,
              /* WAVE 70 · D1 / R60 — THE EXISTING CLASS CARRIES ITS OWN
                 NEGOTIATED TERMS, READ FROM STORAGE. `participating: false` and
                 the total absence of `antiDilution` used to be literals here;
                 `resolvePreferredTerms` reads both and OMITS what is not on
                 record rather than asserting it. Anti-dilution protects EARLIER
                 investors when a LATER round prices lower, which is why it has
                 to be on this side of the transaction and not on the new round.
                 `antiDilutionUnknown` is DELIBERATELY not spread onto the engine
                 payload — it is bookkeeping for `projectPostClose`'s refusal, not
                 a term, and the engine's `Security` type has no such field. */
              ...preferredTermsFor(s, unknownAntiDilutionClasses),
              seniority: 0,
              originalIssuePrice: s.pricePerShare?.toString() ?? "1",
            },
          } : {}),
        },
      };
    }
    if (s.instrument === "option") {
      return {
        type: "issue",
        date: s.issuedAt ?? "2025-01-01",
        security: {
          id: baseId,
          holderId: s.holderName,
          kind: "option",
          series: s.series ?? undefined,
          option: { grantedShares: BigInt(s.shares), exercisePrice: "0.01", vestingMonths: 48, cliffMonths: 12 },
        },
      };
    }
    if (s.instrument === "safe") {
      return {
        type: "issue",
        date: s.issuedAt ?? "2025-01-01",
        security: {
          id: baseId,
          holderId: s.holderName,
          kind: "safe",
          investmentAmount: s.investmentAmount?.toString(),
          safe: {
            /* WAVE 70 · D5 — THE STORED CAP CONVENTION, NOT A LITERAL.
               This line read `type: "post_money_cap"` unconditionally, which made
               `pre_money_cap` — implemented, tested, and producing different and
               correct results ($1.00/2,000,000 vs $0.80/2,500,000 on identical
               terms) — unreachable through the platform. `resolveSafeCapType`
               reads the stored value and, where nothing is stored, returns the
               market default TOGETHER WITH the sentence that states it. */
            type: resolveSafeCapType(s).capType,
            cap: s.cap?.toString(),
            /* WAVE 58e · D1 — stored PERCENT (R30) converted once, here, to the
               engine's FRACTIONAL wire unit. WAVE 3F / ITEM 5's guard still
               rejects anything outside [0,1] AFTER the conversion.
               WAVE 70 · D9 — and the STATE domain [0,100) is now enforced on top
               of it, so a legacy stored `100` produces a named refusal instead of
               `SyntaxError: Cannot convert Infinity to a BigInt`. */
            discount: toEngineDiscount(s.discount, s.id),
            /* ── WAVE 71 · D13 — THE MFN PROVISION, FROM STORAGE ──────────────
               This key did not exist here, so `applyMfn` returned every SAFE
               untouched and the whole MFN implementation had no application
               caller. `mfn` is read from the issuing round's `extras_json`
               (`"mfn"` was already on the extras whitelist — NO MIGRATION).
               ONLY an explicit `true` sets it; absent omits the key, so no
               existing cap table moves. The resolver now adopts ONE later SAFE's
               cap, discount and cap convention as a SET rather than composing a
               best-of that no instrument offered — see `mfnOrdering.ts`. */
            ...(s.mfn === true ? { mfn: true } : {}),
          },
        },
      };
    }
    if (s.instrument === "warrant") {
      return {
        type: "issue",
        date: s.issuedAt ?? "2025-01-01",
        security: {
          id: baseId,
          holderId: s.holderName,
          kind: "warrant",
          warrant: {
            underlyingShares: BigInt(s.shares),
            strikePrice: (s.pricePerShare ?? 0.01).toString(),
            expiry: "2030-12-31",
            /* ── WAVE 71 · D12 — WHY THIS LITERAL IS NOW SAFE, AND STILL A GAP ──
               `cashless: true` is hardcoded, and Wave 70 named it as the same
               hardcoded-term defect class as D1/D5/D6. It is LEFT AS IT IS, and
               here is the reasoning rather than an omission:
                 · Nothing stores a per-warrant cashless permission. There is no
                   field on any write surface and none on `ApiSecurity`. Refusing
                   on absence would blank every warrant on every cap table — a
                   regression dressed as a safeguard.
                 · This value reaches arithmetic ONLY as the DEFAULT in
                   `compute.ts`'s `cashless: tx.cashless ?? sec.warrant.cashless`,
                   i.e. only when an `exercise_warrant` transaction does not state
                   the method. The D20 event channel above ALWAYS states it.
                 · Most importantly: the dangerous behaviour this flag used to
                   enable is GONE. `exerciseWarrant` now THROWS
                   `CashlessExerciseFmvRequiredError` when a cashless exercise
                   arrives with no FMV, instead of silently issuing the full
                   underlying (200,000 shares on the documented fixture). So
                   `true` now means "refuse unless an FMV is on record", which is
                   the safe direction, where before it meant "over-issue".
               A stored per-warrant term remains an OWNER QUESTION. */
            cashless: true,
          },
        },
      };
    }
    if (s.instrument === "note") {
      return {
        type: "issue",
        date: s.issuedAt ?? "2025-01-01",
        security: {
          id: baseId,
          holderId: s.holderName,
          kind: "note",
          investmentAmount: s.investmentAmount?.toString(),
          note: {
            principal: (s.investmentAmount ?? 0).toString(),
            cap: s.cap?.toString(),
            /* WAVE 58e · D1 — same single boundary as the SAFE branch above.
               WAVE 70 · D9 — plus the [0,100) state domain. */
            discount: toEngineDiscount(s.discount, s.id),
            /* ── WAVE 70 · D6 — THE FOUNDER'S TYPED RATE, AND NOTHING ELSE ────
               This line read `interestRate: "0.05"`. A hardcoded 5% APR, applied
               to every convertible note on the platform, while the rate the
               founder actually typed reached no arithmetic anywhere in the tree.
               An `ApiSecurity` carrying `interestRate: 8` produced
               `in.interestRate = 0.05` in the engine trace, and the same field
               was independently hardcoded to `0.06` over a fixed one-year term in
               the carry-forward suggestion engine.
               NOW: the STORED, TYPED rate, percent-as-written (R30), crossing to
               the engine's fractional wire through `toWireInterestRate` — the one
               bridge, dividing by 100 exactly once.
               ABSENT REFUSES. A defaulted rate is a fabricated number (R6), and
               it is a number a founder would read as what they owe. */
            interestRate: requireNoteInterestRateWire(s),
            /* Compounding convention. No storage exists for this field on any
               surface, and `simple` is what every path already used and what the
               market default is for an early-stage convertible note
               (https://pulley.com/guides/convertible-notes). A stored value is
               honoured the moment one exists. Recorded as an OWNER QUESTION in
               build_log/wave70 rather than defaulted silently. */
            interestKind: s.interestKind === "compounded" ? "compounded" : "simple",
            issueDate: s.issuedAt ?? "2025-01-01",
            /* ── WAVE 70 · D7 — THE HARDCODED MATURITY IS GONE ───────────────
               This line read `maturityDate: "2027-12-31"` — a literal date
               asserted about every note on the platform, while `maturityMonths`
               was fenced [0,600] at both layers (Wave 61b, migration 0192) and
               its value reached nothing. The STORED maturity is passed when there
               is one, derived from `maturityMonths` when that is what is stored,
               and OMITTED when neither is on record.
               WHAT THIS DOES NOT FIX, said plainly: maturity still triggers
               nothing. `convertNoteToPreferred` never reads a maturity date —
               there is no maturity trigger, no default and no automatic
               conversion. This stops the platform ASSERTING a date it does not
               have; it does not add the feature. Owner-scope, per D7. */
            ...resolveNoteMaturityDate(s),
          },
        },
      };
    }
    // Fallback to common
    return {
      type: "issue",
      date: s.issuedAt ?? "2025-01-01",
      security: { id: baseId, holderId: s.holderName, kind: "common", shares: BigInt(s.shares ?? 0) },
    };
  });

  /* WAVE 71 · D20 — the non-issuance events, appended. `computeCapTable` sorts by
     date, so an exercise dated before an issuance still lands in the right place;
     nothing here depends on the order they are pushed. */
  if (events && events.length > 0) {
    for (const e of events) transactions.push(eventToTransaction(e));
  }
  return { holders, transactions, unknownAntiDilutionClasses };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 70 · D4 — AS-CONVERTED IS COMPUTED ONCE, BY THE ENGINE, OR NOT AT ALL.
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT WAS HERE. A SECOND, PRIVATE conversion — `safeConvertedShares` — that
 * disagreed with the engine's real conversion in FOUR ways on identical input:
 *
 *   |                    | this adapter (preview)          | engine (at close)          |
 *   | arithmetic         | JS `Number`, `Math.floor`       | decimal.js 38 digits, bigint |
 *   | price, no round    | hardcoded `1`                   | the solved round price      |
 *   | cap treatment      | `cap ÷ fdShares` — PRE-money    | post-money re-basing        |
 *   | note interest      | NOT included                    | `P + P·r·t`                 |
 *
 * MEASURED, same instruments, same fixture:
 *   SAFE $2,000,000 @ $10,000,000 cap, 20% discount   2,500,000  vs  2,250,000
 *   note $500,000 @ $12,000,000 cap, 15% discount       588,235  vs    397,741
 *   founder ownership              66.180…%  (preview)  vs  51.512…%  (close)
 *
 * A founder read one of those numbers off `/founder/captable` and the other off
 * the Projection, for the same company on the same day.
 *
 * THE FIX. There is now ONE conversion computation. This function does not
 * implement conversion at all — it CALLS the engine's own
 * `convertSafeToPreferred` and `convertNoteToPreferred`, with the same
 * post-money re-basing, the same accrued-interest formula and the same decimal
 * precision the conversion at close uses. The engine path is authoritative; this
 * is a caller of it.
 *
 * THE ELAPSED-TIME CLOCK IS NOW SHARED, NOT COPIED (WAVE 71 · D8). Wave 70 had
 * to REPRODUCE `compute.ts`'s float expression here character-for-character —
 * `(close − issued) / (365.25 × 24 × 3600 × 1000)`, then `.toFixed(8)` — because
 * the point of that wave was that the two paths AGREE, and a better clock on one
 * side alone would have recreated the divergence D4 existed to remove. Its own
 * comment said Wave 71 must fix BOTH SITES TOGETHER. Wave 71 did something
 * better than fixing two sites: there is now ONE site.
 * `exactYearsElapsedString` (`@capavate/cap-table-engine`,
 * `src/primitives/timeElapsed.ts`) is imported by BOTH this function and
 * `compute.ts`, so there is no second implementation left to drift. The
 * CONVENTION is unchanged — a 365.25-day year stated to 8 decimal places — and
 * only the arithmetic moved off IEEE-754 onto `decimal.js`. Measured: the
 * documented note fixture reads `yearsElapsed = 1.2128679` before and after.
 *
 * PRECISION AT THE ApiSecurity BOUNDARY, disclosed. `ApiSecurity.shares` is
 * typed `number`, so the engine's `bigint` share count is narrowed with
 * `Number(...)` before it is written onto the synthetic row. That is EXACT for
 * every count below 2^53 (9,007,199,254,740,992 shares — five orders of
 * magnitude above any real cap table) and the value is an integer by
 * construction, so `BigInt(s.shares)` downstream cannot throw. Re-typing
 * `ApiSecurity.shares` to `bigint` would touch every founder screen and is not
 * this wave.
 */
function asConvertedConvertibleShares(
  secs: ApiSecurity[],
  /** The last priced round's price per share, EXACT, never fabricated. */
  estPps: string,
  /** Fully-diluted count excluding convertibles — the engine's `companyCap`. */
  estFdShares: bigint,
  /** The date the elapsed-interest clock runs to. */
  asOfDate: string,
  region: Region,
): Map<string, bigint> {
  const out = new Map<string, bigint>();
  const companyCapDecimal = new DiscountDec(estFdShares.toString());

  /* Mirrors compute.ts:576-580. The sum is over POST-MONEY SAFEs converting at
     this event, and it is what makes the post-money cap a post-money cap. */
  const totalPostMoneySafeAmt = secs
    .filter((s) => s.instrument === "safe" && resolveSafeCapType(s).capType === "post_money_cap")
    .reduce((acc, s) => acc.plus(new DiscountDec(String(s.investmentAmount ?? 0))), new DiscountDec(0));

  for (const s of secs) {
    if (s.instrument !== "safe" && s.instrument !== "note") continue;
    const purchase = s.investmentAmount ?? 0;
    if (!purchase) continue;
    /* THE SAME single boundary the engine payload uses. D9's refusal included. */
    const discount = toEngineDiscount(s.discount, s.id);

    if (s.instrument === "safe") {
      const { capType } = resolveSafeCapType(s);
      const f = resolveFormula(
        capType === "post_money_cap" ? "safe.postmoney.conversion" : "safe.premoney.conversion",
        region,
      );
      /* Mirrors compute.ts:592-607 EXACTLY, including the `toFixed(0)`. */
      let denominator = estFdShares.toString();
      const safeCap = new DiscountDec(String(s.cap ?? 0));
      if (capType === "post_money_cap" && safeCap.gt(0)) {
        const effectiveCap = safeCap.minus(totalPostMoneySafeAmt);
        if (effectiveCap.gt(0)) {
          denominator = companyCapDecimal.mul(safeCap).div(effectiveCap).toFixed(0);
        }
      }
      const r = convertSafeToPreferred({
        purchaseAmount: String(purchase),
        capType,
        ...(s.cap != null ? { cap: String(s.cap) } : {}),
        ...(discount !== undefined ? { discount } : {}),
        seriesPricePerShare: estPps,
        companyCapitalization: denominator,
        formulaId: f.id,
        formulaVersion: f.version,
        region,
        formulaDef: f.definition,
      });
      out.set(s.id, r.safeShares);
      continue;
    }

    /* ── the note ────────────────────────────────────────────────────────────
       D6: the rate is the STORED, TYPED rate. There is no `0.05` and no `0.06`
       anywhere on this path any more, and absence REFUSES. */
    const interestRateWire = requireNoteInterestRateWire(s);
    const f = resolveFormula("note.conversion", region);
    /* WAVE 71 · D8 — the ONE exact clock, shared with `compute.ts`. Was a
       reproduced IEEE-754 expression; see this block's header. */
    const issued = new Date(s.issuedAt ?? asOfDate);
    const closeDate = new Date(asOfDate);
    const yearsElapsed = exactYearsElapsedString(issued, closeDate);
    const r = convertNoteToPreferred({
      principal: String(purchase),
      interestRate: interestRateWire,
      interestKind: s.interestKind === "compounded" ? "compounded" : "simple",
      yearsElapsed,
      ...(s.cap != null ? { cap: String(s.cap) } : {}),
      ...(discount !== undefined ? { discount } : {}),
      seriesPricePerShare: estPps,
      companyCapitalization: estFdShares.toString(),
      formulaId: f.id,
      formulaVersion: f.version,
      region,
      formulaDef: f.definition,
    });
    out.set(s.id, r.noteShares);
  }
  return out;
}

export function runEngine(
  secs: ApiSecurity[],
  view: View,
  region: Region = "US",
  /* WAVE 52c · B1 — resolved from the DATABASE by the caller, never here.
     Omitted = the engine's own default (the corrected Wave 52 order). */
  pricingOrderMode?: PricingOrderMode,
  /* ── WAVE 79 · ITEM 3 — THE CLOCK, AS AN INPUT INSTEAD OF A HIDDEN READ ─────
     This function read `new Date()` twice, so its as-converted total moved every
     night as note interest accrued. `W58CD-B3a` pinned `9991276` and was measured
     at `9991305` a day later: a test that passes today and fails tomorrow, in a
     suite whose failing-count gate is about to be frozen into a QA document.
     `asOf` is OPTIONAL and every existing caller is unchanged — omitted, it is
     still today. No date is invented and no default date is substituted: the
     caller either supplies the day it means or gets the current one, exactly as
     before. This is an ISO calendar DATE (`YYYY-MM-DD`), the same shape the two
     `new Date().toISOString().slice(0, 10)` expressions produced. */
  asOf?: string,
): CapTableResult {
  const nowIso = asOf ?? new Date().toISOString().slice(0, 10);
  let working = secs;
  if (view === "as_converted") {
    /* ── WAVE 70 · D4 — NO PRICE IS EVER FABRICATED ────────────────────────
       This block used to end `: 1` — a hardcoded $1.00 per share whenever no
       priced round existed, fed straight into the conversion and rendered as an
       ownership percentage. It is the single most consequential invented number
       in this file: on the documented fixture it made a SAFE worth 2,500,000
       shares that the same engine converts at 2,250,000, and moved founder
       ownership from 51.512…% to 66.180…%.
       The refusal is SCOPED TO WHERE IT BITES. It fires only when there is
       actually something to convert, so a cap table with no SAFEs and no notes
       still renders As-Converted (it is then identical to Fully-Diluted, which is
       the truth) and no existing screen loses a view it had. */
    const convertibles = secs.filter(
      (x) => (x.instrument === "safe" || x.instrument === "note") && (x.investmentAmount ?? 0) > 0,
    );
    if (convertibles.length > 0) {
      const priced = secs
        .filter((x) => x.instrument === "preferred" && (x.pricePerShare ?? 0) > 0)
        .sort((a, b) => (a.issuedAt ?? "").localeCompare(b.issuedAt ?? ""));
      if (priced.length === 0) {
        throw new AsConvertedPriceUnknownError(convertibles.map((x) => x.id));
      }
      /* EXACT. The stored price crosses into decimal.js as a string and never
         goes back through a float. */
      const estPps = new DiscountDec(
        String(priced[priced.length - 1].pricePerShare),
      ).toFixed();
      /* The engine's `companyCap`: fully diluted EXCLUDING the convertibles that
         are being converted (compute.ts:556-558). */
      const estFdShares = secs.reduce<bigint>((sum, x) => {
        if (
          x.instrument === "common" || x.instrument === "preferred" ||
          x.instrument === "option" || x.instrument === "warrant"
        ) {
          return sum + BigInt(x.shares ?? 0);
        }
        return sum;
        /* `BigInt(0)`, not `0n`: this module is compiled at a target below
           ES2020 (TS2737), and a `0n` literal here adds two type errors to the
           tree's pinned 587. Same value, same type. */
      }, BigInt(0));
      /* WAVE 79 · ITEM 3 — was `new Date().toISOString().slice(0, 10)`. */
      const asOfDate = nowIso;
      const converted = asConvertedConvertibleShares(secs, estPps, estFdShares, asOfDate, region);
      working = secs.map((s) => {
        const shares = converted.get(s.id);
        if (shares === undefined || shares <= BigInt(0)) return s;
        return {
          ...s,
          instrument: "common",
          /* Exact for every count below 2^53; see the D4 block header. */
          shares: Number(shares),
          series: s.series ?? "SAFE → Common (as-converted)",
          pricePerShare: s.pricePerShare ?? Number(estPps),
        };
      });
    }
  }
  const { holders, transactions } = adaptSecuritiesToEngine(working);
  return computeCapTable({
    companyId: "co-active",
    /* WAVE 79 · ITEM 3 — was `new Date().toISOString().slice(0, 10)`. */
    asOf: nowIso,
    view,
    formulaRegion: region,
    holders,
    transactions,
    ...(pricingOrderMode ? { pricingOrderMode } : {}),
  });
}

/** Project a post-close cap table by appending a synthetic priced round. */
export function projectPostClose(
  secs: ApiSecurity[],
  // Wave C4 — widen to accept null/undefined: a freshly-created round often has
  // no pre-money / target yet (shown as "Unknown"/$0). Previously these were
  // typed as `number` but the caller passed `round.preMoney` (number | null),
  // and `null.toString()` below crashed the whole projection tab.
  round: {
    preMoneyValuation: number | null | undefined;
    investmentAmount: number | null | undefined;
    series: string;
    /* WAVE 52c · B4 — PERCENT-AS-WRITTEN (R16 / OR-1): "25" is 25%. Optional;
       omitted means no pool top-up is applied, which is stated by the caller
       rather than silently treated as a zero pool. */
    optionPoolPostPercent?: string;
    optionPoolMode?: "pre_money" | "post_money";
    /* WAVE 70 · D1 / R60 §2 — THE NEW ROUND'S OWN NEGOTIATED TERMS, PASSED IN
       BY WHOEVER READ THEM FROM THE DATABASE. This function used to hardcode
       `antiDilution: "broad_based"` and `participating: false` on the round it
       synthesised. Both are optional here and both are OMITTED when the caller
       has nothing on record, because asserting a method nobody negotiated is the
       defect (R60 §2). These terms attach to the class this round CREATES; the
       protection of EARLIER classes is carried by the securities themselves, via
       `resolvePreferredTerms`. */
    antiDilutionType?: AntiDilutionTypeStored | null;
    participating?: boolean | null;
  },
  region: Region = "US",
  /* WAVE 52c · B1 — THE WHOLE POINT. The pricing order is chosen by the value
     the DATABASE holds, passed in by whoever resolved it. Omitting it keeps the
     engine's own default (the corrected Wave 52 order); passing "legacy_pre_w52"
     reproduces the pre-Wave-52 arithmetic exactly. */
  pricingOrderMode?: PricingOrderMode,
  /* WAVE 71 · D21 — an OPTIONAL observer that receives the exact `ComputeOptions`
     this function is about to run. Additive and side-effect-free for every
     existing caller (none passes it). It exists so the dual-engine reconciliation
     gate reconciles THE PROJECTION a founder is shown, not a reconstruction of it —
     a second construction would be a second authority (R21), which is the shape of
     D4, D6 and D12. */
  captureComputeOptions?: (opts: Parameters<typeof computeCapTable>[0]) => void,
  /* ── WAVE 79 · ITEM 3 — THE CLOCK, AS AN INPUT INSTEAD OF A HIDDEN READ ─────
     `projectionDate` and `asOf` below both read `new Date()`, and the projection
     date is what the engine measures a note's accrued interest against
     (`compute.ts:885` — `closeDate = new Date(tx.date)`). So the trace's
     `yearsElapsed` moved every midnight: `W71-D8a` pinned `"1.2128679"` (the
     2026-08-18 value) and was measured at `"1.21560575"` on 2026-08-19.
     OPTIONAL, and every existing caller is unchanged — omitted, it is still
     today. Note this does NOT back-date anything: `projectionDate` is still the
     lexicographic MAXIMUM of this value and every existing transaction date, so
     the Wave 52c ordering fix is intact. */
  asOf?: string,
): CapTableResult {
  const nowIso = asOf ?? new Date().toISOString().slice(0, 10);
  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 71 · D16 — THE GUARD IS IN THE SHARED FUNCTION, AND THE COMMENT THAT
     CLAIMED IT WAS ALREADY SAFE IS GONE.
     ═══════════════════════════════════════════════════════════════════════════
     WHAT THE OLD COMMENT SAID, AND WHY IT WAS FALSE. It read "Fail-safe coercion
     so a null/undefined/NaN can never crash `.toString()`". That much was true
     and it is the only thing it prevented. Coercing to `0` then produced
     `0 ÷ N = 0` for the price per share, `floor(I ÷ 0) = Infinity` for the new
     investor share count, and:

         SyntaxError: Cannot convert Infinity to a BigInt
           at buildPricedRound (packages/cap-table-engine/src/captable/compute.ts)
           at projectPostClose (shared/roundMathEngineAdapter.ts)

     So the comment asserted a safety the code did not provide — a false comment
     next to money arithmetic, which is worse than no comment (R44).

     A NEW FINDING, FOUND BY EXECUTING THIS AND NOT BY READING IT. A NEGATIVE
     pre-money is worse than the crash and was NOT covered by the finding as
     written. `Number.isFinite(-1)` is `true`, so `-1` sailed past the coercion
     and produced, measured on the documented fixture:

         preMoneyValuation = -1  ->  totalShares = -89,999,991,000,001

     A NEGATIVE SHARE COUNT, returned as a successful cap table. No exception, no
     refusal. That is strictly more dangerous than the `Infinity` crash, because a
     crash is visible and this is not. It is refused here too.

     WHY THE GUARD BELONGS HERE. Both reachable surfaces already guard —
     `canProject` on `server/roundMathRoutes.ts` (`preMoney > 0 && target > 0`)
     and `client/src/pages/founder/RoundDetail.tsx` — so this was unreachable
     today. The finding was recorded precisely BECAUSE the guard lived in the two
     callers rather than in the shared function: a third caller inherits the
     crash, not the protection. Wave 70's D1 refusal block could not catch it
     either, because that block runs AFTER `computeCapTable` returns and this
     crash happens inside it.

     WHY IT REFUSES INSTEAD OF SUBSTITUTING. R6: a defaulted valuation is a
     fabricated number, and a price per share derived from a fabricated valuation
     is what every subsequent figure on the screen is divided by. */
  const pmvRaw = round.preMoneyValuation;
  const pmvNum = Number(pmvRaw);
  if (!Number.isFinite(pmvNum) || pmvNum <= 0) {
    throw new RoundMathTermRefusal(
      "invalid_pre_money_valuation",
      round.series,
      "preMoneyValuation",
      `A post-close projection cannot be computed without a pre-money valuation greater than zero. ` +
      `The value on record for ${round.series} is ${pmvRaw === null ? "empty" : pmvRaw === undefined ? "not set" : `"${String(pmvRaw)}"`}. ` +
      `Price per share is pre-money valuation ÷ the fully-diluted denominator, so a zero or missing ` +
      `valuation makes the price zero and the new investor's share count arithmetically infinite, and a ` +
      `negative valuation makes the whole cap table negative. Capavate will not substitute a valuation: ` +
      `every ownership percentage on the projection is derived from it. Enter the pre-money valuation on ` +
      `the round's terms.`,
    );
  }
  const preMoneyValuation = pmvNum;
  const investmentAmount = Number.isFinite(Number(round.investmentAmount)) ? Number(round.investmentAmount) : 0;
  const adapted = adaptSecuritiesToEngine(secs);
  const { holders, transactions } = adapted;
  if (!holders.find((h) => h.id === `investors-${round.series}`)) {
    holders.push({ id: `investors-${round.series}`, name: `${round.series} investors`, type: "investor" });
  }
  /* ── WAVE 52c — THE PROJECTION MUST BE DATED AFTER EVERY EXISTING POSITION ──
     FOUND BY EXECUTION while wiring B1, not by reading. `computeCapTable` sorts
     transactions with `getTxDate(a).localeCompare(getTxDate(b))`, and this line
     used to be a bare `new Date().toISOString().slice(0, 10)` — a DATE, e.g.
     "2026-08-15". A security issued today through the commit ledger carries a
     FULL TIMESTAMP, e.g. "2026-08-15T04:57:06.669Z", and by string comparison
     "2026-08-15" < "2026-08-15T04:57:06.669Z". So the synthetic round SORTED
     BEFORE the shares that already exist, the pricing denominator came out 0,
     and the price per share came out **Infinity** — on any company whose most
     recent position was committed today, which is every company immediately
     after a commit.

     THE FIX: date the projection at the lexicographic MAXIMUM of today and every
     existing transaction date. `Array.prototype.sort` is stable in Node, and this
     transaction is pushed LAST, so an equal date leaves the round last — which is
     what "post-close" means. No date is invented and nothing is back-dated. */
  const projectionDate = transactions.reduce<string>((latest, t) => {
    const d = (t as { date?: string }).date ?? "";
    return d > latest ? d : latest;
    /* WAVE 79 · ITEM 3 — was `new Date().toISOString().slice(0, 10)`. */
  }, nowIso);
  transactions.push({
    type: "issue_preferred_round",
    date: projectionDate,
    round: {
      id: round.series,
      series: round.series,
      preMoneyValuation: preMoneyValuation.toString(),
      investmentAmount: investmentAmount.toString(),
      liquidationPreferenceMultiple: 1,
      /* ── WAVE 70 · D1 / R60 — THE TWO HARDCODED TERMS ARE DELETED ─────────
         These two lines read `participating: false, antiDilution: "broad_based"`.
         R60 named line :1090 of this file as the ONLY occurrence of
         `antiDilution` in the adapter and as being on the WRONG SIDE of the
         transaction: it was set on the NEW round being issued, when
         anti-dilution protects EARLIER investors against a LATER, lower-priced
         round. It protected nobody and it asserted a method nobody negotiated.
         They are now read from the round's stored terms and OMITTED when absent. */
      ...(round.participating === true || round.participating === false
        ? { participating: round.participating }
        : {}),
      ...(round.antiDilutionType ? { antiDilution: round.antiDilutionType } : {}),
      /* Passed through in the SAME unit it arrived in. No conversion layer. */
      ...(round.optionPoolPostPercent
        ? {
            optionPoolPostPercent: round.optionPoolPostPercent,
            optionPoolMode: round.optionPoolMode ?? ("pre_money" as const),
          }
        : {}),
    },
  });
  /* WAVE 71 · D21 — the EXACT `ComputeOptions` the projection is computed from,
     captured in one object so the dual-engine reconciliation gate can be handed
     the SAME input rather than a second model of it. `buildPostCloseComputeOptions`
     below is a thin wrapper around this whole function that returns these options
     instead of the result, so there is one construction and not two. */
  const computeOpts = {
    companyId: "co-active",
    /* WAVE 79 · ITEM 3 — was `new Date().toISOString().slice(0, 10)`. */
    asOf: nowIso,
    view: "fully_diluted" as View,
    formulaRegion: region,
    holders,
    transactions,
    ...(pricingOrderMode ? { pricingOrderMode } : {}),
  };
  if (captureComputeOptions) captureComputeOptions(computeOpts);
  /* WAVE 72 · DEFECT 1 fault 1 — THE ENGINE'S ZERO-DENOMINATOR THROW BECOMES THIS
     FILE'S NAMED REFUSAL. Matched on `name`/`code` rather than `instanceof`,
     because the engine is consumed both from source (client/vitest, via the
     workspace alias) and from its built `dist` (server), and an `instanceof`
     across those two module instances is not reliable. The engine's own sentence
     is carried through unchanged, so the two layers cannot be read as describing
     different problems. */
  let result: CapTableResult;
  try {
    result = computeCapTable(computeOpts);
  } catch (err) {
    const e = err as { name?: string; code?: string; message?: string; fdSharesBeforeRound?: string };
    if (e && (e.name === "ZeroPricingDenominatorError" || e.code === "zero_pricing_denominator")) {
      throw new ZeroPricingDenominatorRefusal(
        round.series,
        String(e.fdSharesBeforeRound ?? "0"),
        String(e.message ?? ""),
      );
    }
    throw err;
  }

  /* ═══════════════════════════════════════════════════════════════════════
     WAVE 72 · DEFECT 1 — A PROJECTION MAY NOT BE RETURNED AS SUCCESS WITH AN
     UNSETTLED OR IMPOSSIBLE PRICE. AUDITED FROM THE ENGINE'S OWN TRANSCRIPT.
     ═══════════════════════════════════════════════════════════════════════
     WHY HERE. The same reasoning as the down-round check below, and the same
     mechanism: the price is the output of a fixed-point solve INSIDE the engine,
     so the only honest way to know what that solve did is to read the trace step
     it wrote. No arithmetic is repeated here and no second pricing
     implementation is introduced.

     WHAT IT REFUSES, and why each is a refusal rather than a warning:
       (a) `pricingDenominator` not strictly positive — there are no shares to
           price against, so no price exists. This is belt-and-braces BEHIND the
           engine's own throw: this boundary must not depend on a future engine
           version keeping it.
       (b) a non-finite or non-positive `pricePerShare` — `Infinity` MUST NEVER be
           emitted (final review 1, defect 1), and a zero price makes the new
           investor's share count arithmetically infinite.
       (c) `converged = "false"` OUTSIDE the `legacy_pre_w52` rollback mode — the
           solve was attempted and did not settle, so a settled price is being
           promised that was never reached. See `PricingSolveNotConvergedRefusal`
           for why that ONE mode is exempt and why the exemption is narrow.

     `projectPostClose` is the SINGLE projection entry point in the tree —
     `buildPostCloseComputeOptions` is a wrapper around this very function, and
     both HTTP callers plus `client/src/pages/founder/RoundDetail.tsx` come
     through here — so every path that returns a projection inherits this audit.
     Enumerated in `build_log/wave72/W72_CONSUMER_ENUMERATION.md` §2, by reading
     the call sites, rather than assumed. */
  const pricingStep = result.trace.find((t) => t.formulaId === "round.pricing.order");
  if (pricingStep?.outputs) {
    const o = pricingStep.outputs as Record<string, string | undefined>;
    const denomRaw = String(o.pricingDenominator ?? "");
    const denom = /^-?[0-9]+$/.test(denomRaw) ? BigInt(denomRaw) : null;
    if (denom === null || denom <= BigInt(0)) {
      throw new ZeroPricingDenominatorRefusal(
        round.series,
        denomRaw === "" ? "(not reported)" : denomRaw,
        `The post-close projection for ${round.series} cannot be priced: the fully-diluted pricing ` +
          `denominator is ${denomRaw === "" ? "not reported" : denomRaw}, so the price per share ` +
          `(pre-money valuation ÷ that denominator) does not exist. Capavate will not report a price ` +
          `against zero shares, because the new investor's share count is the raise ÷ that price. Record ` +
          `the company's existing shares first — equity originates through the round/ledger flow on ` +
          `/founder/rounds; the cap table at /founder/captable is VIEW-ONLY — then project ` +
          `${round.series} again.`,
      );
    }
    const ppsRaw = String(o.pricePerShare ?? "");
    const ppsNum = Number(ppsRaw);
    if (!Number.isFinite(ppsNum) || ppsNum <= 0) {
      throw new ZeroPricingDenominatorRefusal(
        round.series,
        denomRaw,
        `The post-close projection for ${round.series} produced a price per share of "${ppsRaw}", which is ` +
          `not a usable price. Capavate will not report an infinite, missing or non-positive price per ` +
          `share: every share count and every ownership percentage on the projection is derived from it. ` +
          `Check the round's pre-money valuation on its terms (Rounds → Edit terms) and the shares ` +
          `recorded on the cap table (/founder/captable, view-only).`,
      );
    }
    if (String(o.converged ?? "") === "false" && String(o.pricingOrderMode ?? "") !== "legacy_pre_w52") {
      throw new PricingSolveNotConvergedRefusal(
        round.series,
        String(o.iterations ?? "(not reported)"),
        String(o.trail ?? "(not reported)"),
        ppsRaw,
      );
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════
     WAVE 70 · D1 / R60 §4 — A DOWN ROUND MAY NOT BE PRESENTED AS FINAL WHEN A
     PROTECTED CLASS'S ANTI-DILUTION TERM IS UNKNOWN.
     ═══════════════════════════════════════════════════════════════════════
     WHY THE CHECK IS HERE AND NOT AT ADAPT TIME. "Down round" is defined against
     the round's PRICE PER SHARE, and that price is the output of a fixed-point
     solve inside the engine (pool top-up and conversion both feed it). There is
     no honest way to know it before the engine has run. So the engine runs
     FIRST — it cannot throw for this reason, because an unknown term simply
     leaves the class untouched — and the round's exact price is then read back
     out of its own trace. No number is approximated and no second pricing
     implementation is introduced.

     WHY IT REFUSES RATHER THAN WARNS. R60 §4: "an unprotected number presented
     as final is worse than an honest refusal." The classes reached by this check
     are exactly the classes whose share count the engine has just left
     unprotected. Returning that share count would tell a founder their Series A
     investor holds 4,000,000 shares when the negotiated formula may put them at
     4,516,129.

     SCOPE. It fires ONLY when (a) a class's anti-dilution method is genuinely
     absent — a stored "none" is a term ON RECORD and passes — and (b) the new
     round's price is strictly BELOW that class's original issue price. An up
     round, a flat round, or a fully-documented cap table is untouched. */
  const unprotected = adapted.unknownAntiDilutionClasses;
  if (unprotected.length > 0) {
    const priceStep = result.trace.find((t) => t.formulaId === "round.pricing.order");
    const nip = priceStep?.outputs?.pricePerShare;
    if (nip !== undefined && nip !== null && String(nip).trim() !== "") {
      let nipDec: InstanceType<typeof DiscountDec> | null = null;
      try {
        nipDec = new DiscountDec(String(nip) as never);
      } catch {
        nipDec = null;
      }
      if (nipDec !== null && nipDec.isFinite() && nipDec.gt(0)) {
        for (const u of unprotected) {
          let oipDec: InstanceType<typeof DiscountDec> | null = null;
          try {
            oipDec = new DiscountDec(u.originalIssuePrice as never);
          } catch {
            oipDec = null;
          }
          if (oipDec === null || !oipDec.isFinite() || !oipDec.gt(0)) continue;
          if (nipDec.lt(oipDec)) {
            throw new UnknownAntiDilutionTermError(
              u.securityId, u.series, oipDec.toFixed(), nipDec.toFixed(),
            );
          }
        }
      }
    }
  }
  return result;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 58b · DEFECT 3 — ONE FULLY-DILUTED PRE-MONEY BASE, RESOLVED IN ONE PLACE
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, reproduced exactly by independent review (`W58_REVIEW_1_MATH.md`
 * §"The three surfaces do not share one base") and by this wave's own
 * exact-decimal reference (`build_log/wave58b/w58b_exact_math.py`):
 *
 *   PMV $30,000,000 · raise $10,000,000 · target pool 15% of post-money FD
 *     wizard, typed base B = 10,000,000 -> pool 2,500,000  PPS $2.40
 *                                          investor 4,166,666  total 16,666,666
 *     engine, ledger base B =  8,000,000 -> pool 2,000,000  PPS $3.00
 *                                          investor 3,333,333  total 13,333,333
 *   A 500,000-SHARE DIVERGENCE on one round, from rival denominators. The founder
 *   was shown one number in the wizard and a different one in the Projection.
 *
 * WHY THE FIX IS NOT "CARRY THE TYPED OVERRIDE INTO THE ENGINE". It cannot be,
 * and this is stated rather than quietly worked around. The engine builds
 * ownership ROWS from ledger securities. If the declared base exceeds the ledger
 * there is no holder to attribute the difference to, so either the rows stop
 * summing to the base or the engine has to invent a shareholder. Inventing a
 * shareholder on a cap table is a worse defect than the one being fixed. The
 * remaining honest options are (a) use the ledger and silently discard the
 * founder's declared figure, or (b) RECONCILE, and REFUSE BY NAME when the two
 * disagree. (a) is a silent drop. So this is (b) — which is also the alternative
 * `W58_REVIEW_1_MATH.md` itself offers in its required-disposition item 5:
 * "one authoritative denominator across wizard and engine, or a hard refusal when
 * typed FD shares do not reconcile to current securities."
 *
 * WHY THIS CLOSES THE DIVERGENCE PROVABLY. The wizard, the `round-math` HTTP
 * route and the Projection all call THIS function with the same two inputs, so
 * they either use the same base or they all refuse with the same code. There is
 * no third path that can pick its own denominator.
 *
 * DB-DRIVEN (R21). Both inputs come from the database: `ledgerFdShares` from
 * `GET /api/companies/:id/securities`, `declaredFdPreMoneyShares` from the
 * `rounds.fdPreMoneyShares` column (a first-class column, whitelisted in
 * `roundsStore.UPDATE_WHITELIST`). Nothing is hardcoded and nothing is memoised.
 */

/** The resolution outcome. `source` names WHICH number won and why. */
export type FdBaseResolution =
  | {
      readonly ok: true;
      readonly base: bigint;
      readonly source: "RECONCILED" | "LEDGER_ONLY" | "DECLARED_NO_LEDGER";
      readonly ledgerFdShares: bigint;
      readonly declaredFdShares: bigint | null;
      /** On-screen label. Rendered, not just returned. */
      readonly label: string;
    }
  | {
      readonly ok: false;
      readonly code: "fd_base_divergence" | "fd_base_unavailable";
      readonly reason: string;
      readonly ledgerFdShares: bigint;
      readonly declaredFdShares: bigint | null;
    };

/**
 * The LEDGER's fully-diluted pre-money share count, taken from the engine itself
 * rather than re-implemented. `runEngine(secs, "fully_diluted").totalShares` is
 * the same number `compute.ts::currentFullyDilutedShares` produces, so this
 * cannot drift from the engine by construction — which is the entire point.
 *
 * WHAT IT COUNTS: issued common + issued preferred + option-plan shares (granted
 * and unallocated together) + warrants' underlying shares.
 * WHAT IT DOES NOT COUNT: UNCONVERTED SAFEs and notes (they hold no shares until
 * they convert), and unissued authorised capital (Capavate has no such field).
 * A company with outstanding convertibles therefore has a ledger FD that is
 * SMALLER than the pricing denominator the engine will use once they convert at
 * this round; `resolveFdPreMoneyBase` says so in its label rather than implying
 * the two are the same thing.
 */
export function ledgerFullyDilutedPreMoneyShares(secs: ApiSecurity[]): bigint {
  return runEngine(secs, "fully_diluted").totalShares;
}

/** Count of SAFEs/notes still outstanding, so the caller can disclose them. */
export function unconvertedConvertibleCount(secs: ApiSecurity[]): number {
  return secs.filter((s) => s.instrument === "safe" || s.instrument === "note").length;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 58c · A3 — A LEDGER THAT CANNOT BE READ IS A REFUSAL, NOT A THROW.
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, reproduced by EXECUTION (`build_log/wave58cd/probe_before.mts`,
 * transcript in `build_log/wave58cd/W58CD_NEW_TESTS.md`), not by reading:
 *
 *   ledgerFD([safe  discount:20])   -> THROW InvalidDiscountWireValueError
 *   ledgerFD([note  discount:20])   -> THROW InvalidDiscountWireValueError
 *   ledgerFD([common shares:null])  -> THROW TypeError  ("Cannot convert null to a BigInt")
 *   ledgerFD([common shares:1000.5])-> THROW RangeError
 *   ledgerFD([safe  discount:0.2])  -> OK 0
 *   ledgerFD([])                    -> OK 0
 *
 * `ledgerFullyDilutedPreMoneyShares` is called at RENDER SCOPE on three founder
 * screens (`RoundNew.tsx`, `Rounds.tsx` Edit-terms, `RoundDetail.tsx`
 * Projection). A throw there takes the whole screen to the `ErrorBoundary`
 * fallback (`client/src/App.tsx`), so a single unreadable row stops that company
 * raising money at all — a white-screen-class defect on the money path.
 *
 * WAVE 58e UPDATE — `discount: 20` IS NO LONGER A REFUSAL. Owner ruling R30 made
 * the unit question a settled one (storage is percent-as-written), and WAVE 58e ·
 * D1 added the single declared conversion at the adapter boundary
 * (`toWireDiscount` above), so `20` now converts to the wire fraction `0.2` and
 * computes. What still refuses here is a value that is out of range AFTER that
 * conversion — the live corrupt row `discount: 20260707` (R31-a). The two example
 * lines below are kept as the historical record of the contradiction:
 *   · producers say PERCENT-AS-WRITTEN — `shared/schema.ts:156`
 *     (`discount: real("discount")  // SAFE/Note discount %`) and
 *     `shared/schema.ts:1425` (`discountPct  // Decimal-as-string (e.g. "20" = 20%)`),
 *     passed through UNCHANGED by `server/routes.ts` `buildCompanySecurities`;
 *   · this adapter's consumer contract says FRACTIONAL — `readDiscountFraction`
 *     above rejects anything outside [0,1] (WAVE 3A/3F).
 * Reinterpreting `20` as `0.2` HERE would be exactly the `n > 1 ? n/100 : n`
 * heuristic the owner forbade and WAVE 3F removed, and it cannot distinguish 1%
 * from 100%. Reinterpreting `0.2` as 0.2% would silently re-price existing rows
 * in the other direction. NEITHER is done. The unit question is reported, and
 * until it is ruled on, the honest behaviour is: NAME THE ROW, NAME THE VALUE,
 * COMPUTE NOTHING.
 *
 * This function therefore adds NO new arithmetic and changes NO existing result:
 * where `ledgerFullyDilutedPreMoneyShares` returns, this returns the identical
 * bigint; where it throws, this returns a refusal a screen can render.
 * `ledgerFullyDilutedPreMoneyShares` itself is UNCHANGED — the server calls it
 * inside its handler `try` (`server/roundMathRoutes.ts`), where a throw is
 * already converted into an error response, and the 58b tests pin it.
 */
export type LedgerFdResolution =
  | { readonly ok: true; readonly shares: bigint }
  | {
      readonly ok: false;
      readonly code: "ledger_unreadable";
      /** On-screen refusal text. Rendered, not merely returned. */
      readonly reason: string;
      /** The underlying error name + message, for the founder to quote to support. */
      readonly detail: string;
    };

export function tryLedgerFullyDilutedPreMoneyShares(secs: ApiSecurity[]): LedgerFdResolution {
  try {
    return { ok: true, shares: ledgerFullyDilutedPreMoneyShares(secs) };
  } catch (err) {
    const e = err as Error;
    const detail = `${e?.name ?? "Error"}: ${e?.message ?? String(err)}`;
    const unitConflict = e?.name === "InvalidDiscountWireValueError";
    return {
      ok: false,
      code: "ledger_unreadable",
      reason:
        "Capavate cannot read your cap-table ledger well enough to state a fully-diluted share count, so it " +
        "will not quote a price per share or size an option pool against it. " +
        (unitConflict
          ? "One of your committed SAFE/note positions carries a discount that is OUT OF RANGE. A discount is a " +
            "percentage OFF the round price and must be at least 0 and less than 100 — Capavate converts the " +
            "stored percentage to the cap-table engine's fractional form for you (20 becomes 0.2), and this row " +
            "is still outside the permitted range after that conversion. The live example is a row holding " +
            "20260707, which is a date (2026-07-07) written into a percentage field, not a discount. Capavate " +
            "will not guess what it was meant to be — the magnitude of a number is not evidence of its unit " +
            "(owner ruling R16), and a wrong guess here changes what every SAFE holder converts into. "
          : "One of your committed positions holds a share count that is missing, fractional, or not a whole " +
            "number of shares, and a share count cannot be rounded into existence. ") +
        "Nothing has been changed and nothing has been computed. Correct the position on the cap table, or send " +
        "this refusal code and the detail below to support.",
      detail,
    };
  }
}

/**
 * Resolve the ONE fully-diluted pre-money base every surface must use.
 * `declaredFdPreMoneyShares` is the founder-declared `rounds.fdPreMoneyShares`
 * as stored (a string, or null/blank when never supplied).
 */
export function resolveFdPreMoneyBase(input: {
  readonly declaredFdPreMoneyShares: string | number | null | undefined;
  readonly ledgerFdShares: bigint;
  readonly outstandingConvertibles?: number;
}): FdBaseResolution {
  const ledger = input.ledgerFdShares;
  const rawDeclared = input.declaredFdPreMoneyShares;
  const declaredStr =
    rawDeclared === null || rawDeclared === undefined ? "" : String(rawDeclared).replace(/[,\s]/g, "");
  let declared: bigint | null = null;
  if (declaredStr !== "") {
    if (!/^\d+$/.test(declaredStr)) {
      return {
        ok: false,
        code: "fd_base_unavailable",
        reason:
          `The declared fully-diluted pre-money share count "${String(rawDeclared)}" is not a whole number of ` +
          `shares. Capavate will not round it or guess at it: a share count cannot be fractional, and the ` +
          `pool percentage and the price per share are both measured against this number.`,
        ledgerFdShares: ledger,
        declaredFdShares: null,
      };
    }
    declared = BigInt(declaredStr);
  }

  const convertibleNote =
    (input.outstandingConvertibles ?? 0) > 0
      ? ` NOTE: ${input.outstandingConvertibles} outstanding SAFE/note instrument(s) hold no shares yet and are ` +
        `in neither figure; when they convert at this round the engine's pricing denominator will be larger ` +
        `than the base shown here.`
      : "";

  if (declared === null) {
    if (ledger <= BigInt(0)) {
      return {
        ok: false,
        code: "fd_base_unavailable",
        reason:
          "Capavate has no fully-diluted pre-money share count for this company: the cap-table ledger holds no " +
          "securities and no count was declared on the round. It will not assume one — the price per share and " +
          "the option-pool percentage are both measured against this number, so a guess here would misstate " +
          "every ownership figure downstream.",
        ledgerFdShares: ledger,
        declaredFdShares: null,
      };
    }
    return {
      ok: true,
      base: ledger,
      source: "LEDGER_ONLY",
      ledgerFdShares: ledger,
      declaredFdShares: null,
      label:
        `Fully-diluted pre-money base: ${ledger.toString()} shares, taken from the cap-table ledger (no count ` +
        `was declared on this round).${convertibleNote}`,
    };
  }

  if (ledger <= BigInt(0)) {
    /* The ledger records nothing yet — which is the state of every company on
       this platform that has not committed a round. The declared figure is then
       the ONLY source there is, and that is said on screen rather than presented
       as a reconciled number. */
    return {
      ok: true,
      base: declared,
      source: "DECLARED_NO_LEDGER",
      ledgerFdShares: ledger,
      declaredFdShares: declared,
      label:
        `Fully-diluted pre-money base: ${declared.toString()} shares, as DECLARED on this round. The cap-table ` +
        `ledger holds no issued securities yet, so there is nothing to reconcile it against — this figure is ` +
        `your own declaration, not a verified count.${convertibleNote}`,
    };
  }

  if (declared === ledger) {
    return {
      ok: true,
      base: ledger,
      source: "RECONCILED",
      ledgerFdShares: ledger,
      declaredFdShares: declared,
      label:
        `Fully-diluted pre-money base: ${ledger.toString()} shares. The count declared on this round and the ` +
        `count in the cap-table ledger agree exactly, so the wizard, the round projection and the cap table all ` +
        `use this one number.${convertibleNote}`,
    };
  }

  const diff = declared > ledger ? declared - ledger : ledger - declared;
  return {
    ok: false,
    code: "fd_base_divergence",
    reason:
      `Capavate will not size an option pool or quote a price against two different share counts. The round ` +
      `declares ${declared.toString()} fully-diluted pre-money shares; the cap-table ledger holds ` +
      `${ledger.toString()} — a difference of ${diff.toString()} shares. Sized against the declared figure and ` +
      `against the ledger figure, the same negotiated pool percentage produces two different share counts and ` +
      `two different prices per share, and the wizard and the projection would show you both. Reconcile them ` +
      `first: either correct the declared count on the round, or issue the missing securities to the cap ` +
      `table.${convertibleNote}`,
    ledgerFdShares: ledger,
    declaredFdShares: declared,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 71 · D21 — THE PROJECTION'S OWN INPUT, FOR THE RECONCILIATION GATE.
 * ═══════════════════════════════════════════════════════════════════════════
 * `runCloseGate` (`packages/cap-table-engine/src/reconcile/closeGate.ts`) takes
 * `ComputeOptions` and runs the primary and reference engines over them. Before
 * this wave it had no non-test caller at all. Giving it a caller required handing
 * it the post-close projection's input — and the ONLY honest way to do that is to
 * take the input `projectPostClose` actually uses, not to rebuild it. This function
 * runs `projectPostClose` and returns the options it ran, so the reconciled cap
 * table is definitionally the projected cap table.
 *
 * It also inherits every one of `projectPostClose`'s refusals for free: a missing
 * note interest rate, an out-of-domain stored discount, an unreadable cap
 * convention, a zero or negative pre-money (D16) and an unprotected class on a down
 * round all throw here exactly as they do on the Projection. A reconciliation gate
 * that silently succeeded where the projection refuses would be worse than no gate.
 */
export function buildPostCloseComputeOptions(
  secs: ApiSecurity[],
  round: Parameters<typeof projectPostClose>[1],
  region: Region = "US",
  pricingOrderMode?: PricingOrderMode,
  /* WAVE 79 · ITEM 3 — PASSED THROUGH, not dropped. A wrapper that silently
     discards a parameter of the function it wraps is a second authority wearing a
     thin disguise (R21): a caller that fixed the clock would get today anyway. */
  asOf?: string,
): Parameters<typeof computeCapTable>[0] {
  let captured: Parameters<typeof computeCapTable>[0] | null = null;
  projectPostClose(secs, round, region, pricingOrderMode, (o) => { captured = o; }, asOf);
  if (captured === null) {
    /* Unreachable: the observer is called immediately before `computeCapTable`.
       Stated as a refusal rather than a non-null assertion, because a silent
       `undefined` reaching a reconciliation gate is exactly the class of thing
       this wave exists to remove. */
    throw new Error("buildPostCloseComputeOptions: the projection did not report its compute options");
  }
  return captured;
}

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 80 · ITEM 3 — THE SIX TERMS THAT WERE ACCEPTED WITH HTTP 200 AND DROPPED.
   ═══════════════════════════════════════════════════════════════════════════
   MEASURED, NOT ASSUMED. `PATCH /api/rounds/:id/terms` whitelisted six keys on
   `roundsStore.UPDATE_EXTRAS_WHITELIST` — `cap`, `expiryDate`, `poolSize`,
   `proRata`, `sharesAuthorized`, `useOfProceeds` — and put none of them into
   `updates`. The STORE would have persisted every one; only the ROUTE never
   passed them. A regression test PINNED that drop as correct behaviour. Wave 80
   removes the drop and corrects the pin.

   FOUR ARE PERSISTED, TWO ARE REFUSED BY NAME. Nothing is accepted and discarded.

   The two refusals follow the Wave 77 `MATURITY_DATE_NOT_WRITABLE` precedent
   exactly, and for the same reason: a SECOND SPELLING of a term the round
   already stores under a canonical name can disagree with the canonical one,
   and then nothing can say which is true. That is worse than refusing.

   NO MIGRATION. All four persisted keys already round-trip through
   `rounds.extras_json` (stashed by `POST /api/rounds`, re-spread by
   `roundsStore.rowToRound`). Migrations stay at 173, highest `0192`.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Upper bound for an authorised-share count. Same ceiling and same reasoning as
 *  `FD_PRE_MONEY_SHARES_MAX`: both are counts of shares in an INTEGER column,
 *  and a shared ceiling is what stops the two from drifting apart. */
export const SHARES_AUTHORIZED_MAX = FD_PRE_MONEY_SHARES_MAX;

/** Upper bound for an option-pool SHARE COUNT (not the percentage — that is
 *  `optionPoolPostPercent`, bounded separately and expressed percent-as-written).
 *  A pool cannot exceed the authorised share count, so it shares its ceiling. */
export const POOL_SIZE_MAX = SHARES_AUTHORIZED_MAX;

/**
 * `sharesAuthorized` — the count of shares the company is authorised to issue.
 *
 * A COUNT, never a price and never a percentage. Whole numbers only, because the
 * column is an integer and a fraction of an authorised share is not a fact a
 * corporate register can hold.
 */
export function validateSharesAuthorized(raw: unknown): TermValueVerdict {
  return boundedNumericTerm({
    field: "sharesAuthorized",
    label: "Shares authorised",
    raw,
    min: 0,
    max: SHARES_AUTHORIZED_MAX,
    exclusiveMin: false,
    wholeNumbersOnly: true,
    meaning:
      `This is a COUNT OF SHARES the company may issue, not a price and not a percentage. It is ` +
      `stored in an INTEGER column, so a fraction of a share cannot be recorded.`,
  });
}

/**
 * `poolSize` — the option pool expressed as a SHARE COUNT.
 *
 * Distinct from `optionPoolPostPercent`, which is the same pool expressed as a
 * percentage of fully diluted and is validated percent-as-written in `[0, 100)`.
 * Both spellings are legitimate because SAFEs/notes express a pool as a share
 * count while priced rounds express it as a percentage — they are two different
 * facts, not two names for one, which is why this one is stored rather than
 * refused.
 */
export function validatePoolSize(raw: unknown): TermValueVerdict {
  return boundedNumericTerm({
    field: "poolSize",
    label: "Option pool (shares)",
    raw,
    min: 0,
    max: POOL_SIZE_MAX,
    exclusiveMin: false,
    wholeNumbersOnly: true,
    meaning:
      `This is the option pool expressed as a COUNT OF SHARES. The pool expressed as a PERCENTAGE ` +
      `of fully diluted is a different field, "optionPoolPostPercent", which is percent-as-written ` +
      `(25 means 25%). Neither is derived from the other and neither is rescaled by magnitude.`,
  });
}

/**
 * WAVE 80 · ITEM 3 — `cap` IS A SECOND SPELLING OF `valuationCap`. REFUSED BY NAME.
 *
 * `PATCH /api/rounds/:id/terms` already validates and stores `valuationCap`
 * through `validateValuationCap` (bounded by R50 at `VALUATION_CAP_MAX`). Storing
 * a round-level `cap` alongside it would put the same money term on the same row
 * twice under two keys, and the SAFE conversion path reads exactly one of them —
 * so the other becomes an invisible, contradicting figure on a deal document.
 * This is the `maturityDate` situation with a different noun, and it gets the
 * same answer: refuse, and name the control that does work.
 *
 * IT IS A REFUSAL, NOT A SILENT DROP. Before this wave the route returned HTTP
 * 200 `{"ok":true}` and threw the value away.
 */
export const ROUND_CAP_ALIAS_NOT_WRITABLE = {
  error: "cap_not_writable",
  field: "cap",
  /* UNDER 240 CHARACTERS, DELIBERATELY. `client/src/lib/queryClient.ts` uses a
     server message as `ApiError.message` only below 240 characters and substitutes
     a generic sentence above it, so a longer refusal is one a founder never reads
     on the hand-written fetch paths. Measured by a test, not eyeballed. */
  message:
    "Capavate records a round's conversion cap as Valuation cap. A second key holding the same " +
    "money term can disagree with it, and nothing could then say which figure the SAFE converts " +
    "at. Set it on Edit terms -> Valuation cap.",
} as const;

/**
 * WAVE 80 · ITEM 3 — `expiryDate` IS DERIVED FROM `expiryYears`. REFUSED BY NAME.
 *
 * Exactly the `maturityDate` / `maturityMonths` rule (R71) applied to the warrant
 * term that has the identical shape: the platform records a DURATION and computes
 * the absolute date from it on every read, so two spellings of one date cannot be
 * stored and then disagree.
 */
export const EXPIRY_DATE_NOT_WRITABLE = {
  error: "expiry_date_not_writable",
  field: "expiryDate",
  /* Under 240 characters for the same measured reason as the cap refusal above. */
  message:
    "Capavate records a warrant's expiry as Expiry (years) and computes the date from it on every " +
    "read. Storing the date as well would let two spellings of one date disagree. Set it on " +
    `Edit terms -> Expiry (years), which accepts 0 to ${EXPIRY_YEARS_MAX}.`,
} as const;

/**
 * WAVE 80 · ITEM 2 + ITEM 3 — USE OF PROCEEDS ACCEPTS BOTH SHAPES IT IS WRITTEN IN.
 *
 * THE CONTRADICTION THIS RESOLVES, and the decision, stated plainly rather than
 * papered over. The founder round wizard collects use of proceeds as ONE FREE-TEXT
 * STRING. The two readers that display it — Founder Round Detail and the Investor
 * Invitation — were typed for an ARRAY of `{category, amount, percent}` rows, which
 * only `server/mockData.ts` ever produced.
 *
 * WAVE 80 KEEPS THE FREE TEXT AND WIDENS THE READERS. The alternative — deriving
 * `{category, amount, percent}` rows from a sentence a founder typed — would mean
 * this platform inventing per-bucket percentages and dollar amounts that the
 * founder never entered, and printing them on an investor-facing deal document.
 * That is a fabricated number in a money surface, which is the one thing this
 * project refuses to do. A structured editor remains a real product improvement
 * and is recorded as an owner question, not done quietly here.
 *
 * SO BOTH SHAPES ARE VALID ON THE WIRE, AND BOTH RENDER:
 *   · a non-empty STRING → stored trimmed, as typed, and rendered as the
 *     founder's own narrative paragraph on both reader surfaces;
 *   · an ARRAY of rows   → stored as given, and rendered as the existing bar
 *     breakdown, so nothing that already reads rows changes;
 *   · `null` or `""`     → EXPLICIT REMOVAL, stored as null;
 *   · ABSENT             → UNTOUCHED.
 * Anything else (a number, a bare object) is REFUSED BY NAME rather than coerced.
 */
export type UseOfProceedsRowShape = {
  readonly category: string;
  readonly percent: number;
  readonly amount: number;
};
export type UseOfProceedsStored = string | ReadonlyArray<UseOfProceedsRowShape>;

export type UseOfProceedsVerdict =
  | { readonly ok: true; readonly value: UseOfProceedsStored | null }
  | { readonly ok: false; readonly error: string; readonly field: string; readonly message: string };

export const USE_OF_PROCEEDS_INVALID_MESSAGE =
  "Use of proceeds is recorded either as the narrative you type on the round wizard — for example " +
  "\"50% engineering hires; 20% compute; 22% go-to-market; 8% legal\" — or as a list of rows, each " +
  "with a category, an amount and a percent. Send text, or a list of rows, or null to remove it. " +
  "It is never derived from anything else: Capavate will not invent per-bucket percentages you did " +
  "not enter.";

/** ABSENT is signalled by the caller (key not present), never by this function. */
export function validateUseOfProceeds(raw: unknown): UseOfProceedsVerdict {
  const refuse = (): UseOfProceedsVerdict => ({
    ok: false,
    error: "invalid_useOfProceeds",
    field: "useOfProceeds",
    message: USE_OF_PROCEEDS_INVALID_MESSAGE,
  });
  if (raw === null) return { ok: true, value: null };
  if (typeof raw === "string") {
    const t = raw.trim();
    return { ok: true, value: t.length === 0 ? null : t };
  }
  if (Array.isArray(raw)) {
    const rows: UseOfProceedsRowShape[] = [];
    for (const r of raw) {
      if (r === null || typeof r !== "object" || Array.isArray(r)) return refuse();
      const rec = r as Record<string, unknown>;
      const category = rec.category;
      const percent = Number(rec.percent);
      const amount = Number(rec.amount);
      if (typeof category !== "string" || category.trim().length === 0) return refuse();
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) return refuse();
      if (!Number.isFinite(amount) || amount < 0) return refuse();
      rows.push({ category: category.trim(), percent, amount });
    }
    return { ok: true, value: rows.length === 0 ? null : rows };
  }
  return refuse();
}

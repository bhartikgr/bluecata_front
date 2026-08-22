/**
 * v25.0 Track 1 — Capavate Core Endpoints (A1–A8)
 *
 * Endpoints wired:
 *   A1  GET  /api/founder/captable/waterfall
 *   A2  POST /api/founder/term-sheets/generate
 *       GET  /api/founder/term-sheets/:id/download
 *   A3  POST /api/founder/crm/import
 *   A4  POST /api/founder/data-room/files
 *       POST /api/founder/data-room/grants
 *       GET  /api/founder/data-room/files/:fileId
 *   A5  POST /api/investor/invitations/:token/kyc
 *   A6  POST /api/investor/documents/:id/sign
 *   A7  POST /api/rounds/:id/soft-circle/:scId/reject
 *   A8  POST /api/rounds/:id/updates
 *
 * All writes commit to DB before returning success.
 * All state-changing writes emit BridgeOutbound events.
 * All endpoints respect tenant isolation + ownership checks.
 */
import type { Express, Request, Response } from "express";
import { createHash, randomBytes } from "node:crypto";
import multer from "multer";
import { requireAuth } from "./lib/authMiddleware";
import { getUserContext } from "./lib/userContext";
import { rawDb } from "./db/connection";
import { emitBridgeEvent } from "./bridgeStore";
import type { OutboundEventType } from "./bridgeStore";
import { log } from "./lib/logger";
import { rateLimitMiddleware, resolveRateLimitClientIp } from "./lib/rateLimit";
import { getLedger } from "./captableCommitStore";
import { getRoundById } from "./roundsStore";
/* WAVE 71 · D11 — the ONE stored-terms reader, shared with `server/routes.ts`.
   Wave 70's handoff: "Call those; do not write a third reader." */
import { roundStoredTerms, SENIORITY_RANK_MAX, PARTICIPATION_CAP_MAX } from "./lib/roundStoredTerms";
import { currencyExponent } from "./lib/currency"; /* WAVE 33 OQ-33-2 — ISO 4217 exponent, never a hardcoded *100. WAVE 86B: `toMinor` is no longer imported because it no longer has a caller in this file — its `(amount: number, …)` signature forced a double on every ledger amount, which was one of the seven narrowings that destroyed money on this route. The exponent SOURCE is unchanged: `currencyExponent`. A dead import is not left behind. */
import { Decimal } from "decimal.js"; /* WAVE 75 · ITEM 3 — the waterfall summary is summed in EXACT decimals, not floats */
import { addContact } from "./crmStore";
import { insertContactForImport } from "./founderCrmStore";
import { emitNotification } from "./notificationsStore";
import { listForRound as softCircleListForRound } from "./softCircleStore";

// Helper to emit bridge events with our new event types (using cast to bypass strict type)
function emitBridge(eventType: string, aggregateId: string, aggregateKind: "company" | "investor" | "round" | "platform", payload: Record<string, unknown>): void {
  try {
    emitBridgeEvent({
      eventType: eventType as unknown as OutboundEventType,
      aggregateId,
      aggregateKind,
      payload,
    });
  } catch (err) {
    log.warn("[track1] bridge emit failed:", (err as Error).message);
  }
}

/* ── WAVE 86B · ITEM 1 (R72) — EXACT MONEY, ON A CLONE, NEVER THE GLOBAL ──────
   The `Decimal` imported above is the BARE GLOBAL instance (default precision
   20, and `server/lib/math-fns` writes that global). `plus()` rounds its RESULT
   to `precision` significant digits, so a 38-digit exit valuation was destroyed
   INSIDE `exactSum` even once the input parse became exact — a plausible-looking
   WRONG answer, which is worse than the obviously-wrong `1e+38` it replaced.

   `Decimal.set(...)` IS NOT THE ANSWER and is never called here: it mutates the
   one instance the SACRED cap-table engine imports and eight production
   consumers read, and it once faked a result by ~80 orders of magnitude.
   `Decimal.clone()` creates a NEW constructor and writes nothing global — the
   same mechanism `packages/cap-table-engine` already uses
   (`BaseDecimal.clone({ precision: 38, rounding: ROUND_HALF_EVEN })`).
   Engine isolation across import orders is a VERIFIED invariant; do not break
   it. */
const MoneyDec = Decimal.clone({
  precision: 80,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 91 · ITEM 2 — THE CLONE THAT MATCHES THE SACRED ENGINE, DIGIT FOR DIGIT.
   ═══════════════════════════════════════════════════════════════════════════
   `MoneyDec` above is precision 80: it is the SUMMER, and it must not lose a
   digit while adding legs together (Wave 86B). This clone is a different tool for
   a different job. Pari passu abatement hands the SACRED engine a pre-abated
   claim as decimal TEXT, and the engine parses that text on its own clone —
   `packages/cap-table-engine/src/primitives/bigDecimal.ts`, precision 38,
   ROUND_HALF_EVEN. A value produced at precision 80 would be rounded by the
   engine on the way in, so the figure this route computed and the figure the
   engine published would differ in the 39th significant digit and every equality
   check would have to be approximate.

   Producing the abated claim at 38 / HALF_EVEN instead makes the round trip
   EXACT: the engine multiplies a 38-significant-digit value by 1 and emits the
   same digits back, so the assertion after the second pass is a BYTE comparison
   rather than a tolerance. `Decimal.set` is still called nowhere in this file —
   this is a clone, it writes nothing global, and the SACRED engine's own instance
   is untouched (the invariant Wave 81 established and Wave 86B relied on).

   THE PRECISION CEILING IS DISCLOSED, NOT ELIMINATED. 38 significant digits is
   the engine's ceiling; a non-terminating abatement ratio (three equal classes on
   a $10,000,000 exit gives 5,882,352.941176470588235294117647058823529411…)
   is carried to 38 digits and rounded HALF_EVEN at the 39th, exactly as every
   other figure this engine has ever published. It is stated on the response. */
const EngineMatchDec = Decimal.clone({
  precision: 38,
  rounding: Decimal.ROUND_HALF_EVEN,
  toExpNeg: -9e15,
  toExpPos: 9e15,
});

/** Exact decimal parse of money-as-text. `null` means "not a number at all", so
 *  the caller REFUSES; it never returns a narrowed double. */
function parseExactMoney(raw: unknown): Decimal | null {
  const t = String(raw ?? "").trim();
  if (t === "") return null;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(t)) return null;
  try {
    const d = new MoneyDec(t);
    return d.isFinite() ? d : null;
  } catch { return null; }
}

/** Major units -> integer MINOR units, exactly, at the currency's ISO 4217
 *  exponent. Replaces `toMinor(Number(x), cur)`: SAME exponent source
 *  (`currencyExponent`), SAME half-up rounding of the sub-minor residue that
 *  `Math.round` performed, and NO double anywhere. Unparseable input returns 0,
 *  which is byte-for-byte what `toMinor`'s `!Number.isFinite` guard did. */
function toMinorExact(amount: unknown, currency: string): Decimal {
  const d = parseExactMoney(amount);
  if (d === null) return new MoneyDec(0);
  return d
    .mul(new MoneyDec(10).pow(currencyExponent(currency)))
    .toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}

/** A ledger share count as an exact integer. The SACRED commit store validates
 *  share counts with `SHARES_RE = /^-?\d+$/`, so an integer decimal string is
 *  the only shape that can reach here; anything else throws into the caller's
 *  existing `catch { /* skip bad rows *\/ }`. `Math.max(0, ...)` is preserved
 *  exactly, as a bigint clamp. */
function exactShareAddend(raw: unknown): bigint {
  const t = String(raw ?? "0").trim();
  if (!/^[+-]?\d+$/.test(t)) throw new Error("NON_INTEGER_SHARES");
  const b = BigInt(t);
  return b < BigInt(0) ? BigInt(0) : b;
}

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 91 · ITEMS 1 AND 2 — PARI PASSU: EQUAL-RANKING CLAIMS ABATE PRO RATA.
   ═══════════════════════════════════════════════════════════════════════════
   WHAT WAS WRONG, MEASURED, AND WHY IT IS TWO DEFECTS RATHER THAN ONE.

   The SACRED engine sorts `[...input.preferred].sort((a,b) => a.seniority -
   b.seniority)` and walks the sorted list paying `min(invested × multiple,
   prefBudget)`. With EQUAL seniority the comparator returns 0, `Array.prototype
   .sort` is stable, and THE ORDER OF THE LIST DECIDES WHO IS PAID. Executed at
   engine level (`spec/preflight_waterfall_evidence/10_instrument1_engine_equal_
   seniority.txt`) — A $10,000,000 1× non-participating, B $5,000,000 1×
   non-participating, exit $9,000,000:

       EQUAL seniority 0/0, A listed first  ->  A = $9,000,000   B = $0
       EQUAL seniority 0/0, B listed first  ->  B = $5,000,000   A = $4,000,000

   Two different answers on identical negotiated terms. So Wave 79 refused, and it
   was right to. But the refusal fired on EVERY equal-ranking cap table, and that
   is the second defect: when the exit COVERS every standing claim, the ranking
   cannot change any figure at all, so the answer the engine already computes is
   CORRECT and the refusal throws it away. Measured over 207 randomised ample-exit
   fixtures in four orderings each: 206 byte-identical, the single exception being
   one unit in the 38th significant digit of a $12.27m row — the documented
   HALF_EVEN residual at the engine's precision ceiling, not an economic
   difference (`21_claims_P1_P2_P3.txt`, `22_P1_counterexample.txt`).

   THE RULE, AND THE STANDARD IT COMES FROM. Pari passu means equal RANK, not
   equal split. When the assets are insufficient, equally-ranking claims abate PRO
   RATA TO CLAIM SIZE. NVCA Model Certificate of Incorporation §2.1: the holders
   "shall share ratably in any distribution of the assets available for
   distribution in proportion to the respective amounts which would otherwise be
   payable in respect of the shares held by them … if all amounts payable … were
   paid in full" (https://nvca.org/model-legal-documents/). It is the MODEL
   DEFAULT: the October 2025 model charter's own footnote reads "For simplicity,
   this model charter provides for pari passu preferred stock liquidation."

   ABATEMENT IS ON THE CLAIM, NOT ON THE INVESTMENT. A $10,000,000 class at 1×
   and a $5,000,000 class at 2× have the SAME $10,000,000 claim and take the same
   money. An implementation that abates on `invested` gets this wrong, so the
   figure below is always `invested × multiple`.

   WHY THE SACRED ENGINE IS NOT EDITED, AND DOES NOT NEED TO BE. Two corollaries
   of the rule do the work:
     · when every tier is covered, order is immaterial — so the engine's existing
       output IS the pari passu answer and this module changes nothing (Item 1);
     · when a tier abates, its budget reaches zero, so the residual is zero and
       participation and the common leg are all zero — a short pari passu exit is a
       PURE PREFERENCE-LEG calculation. That is why handing the engine each
       standing class's ABATED claim reproduces the reference figures exactly
       (`21_claims_P1_P2_P3.txt`, claim P3: exact on the terminating case, 38
       significant digits on the non-terminating one).
   R69 is untouched: `computeConversionProjections` is not called, not imported
   and not read here. The live path is unchanged — shares in, sacred
   `computeWaterfall`, payouts out.

   THE ELECTION IS DECIDED BEFORE THE ABATEMENT, AND THAT ORDER IS LOAD-BEARING.
   A holder elects the greater of its preference and its as-converted value on the
   term it NEGOTIATED, never on the reduced amount it will actually be paid (NVCA
   §2.1). So the engine runs FIRST on unabated inputs, the converter set is read
   off that pass, the abatement is applied only to the classes still standing, and
   the second pass cannot re-elect: every abated class is handed to the engine as
   PARTICIPATING WITH NO CAP, and the engine only ever flips a participating class
   to conversion when a recorded cap binds. Reversing the two steps would abate a
   claim a class had already waived (`S11` in the corpus, §6.9 of the pre-flight).
   ═══════════════════════════════════════════════════════════════════════════ */

/** One rank's worth of equally-ranking standing claims. */
type PariPassuTier = {
  seniority: number;
  classes: Array<{ classId: string; className: string; claimMinor: string; abatedClaimMinor: string }>;
  tierClaimMinor: string;
  availableMinor: string;
  abated: boolean;
  abatementFactor: string | null;
};

type PariPassuPlan = {
  tiers: PariPassuTier[];
  /** `true` when at least one tier of TWO OR MORE classes takes a partial payment. */
  rewriteRequired: boolean;
  abatedClaimByClassId: Record<string, string>;
  budgetMinor: string;
};

/** The claim a preference class stands on: `invested × multiple`, exact.
 *  `null` means the stored terms cannot produce a claim at all, and the caller
 *  REFUSES rather than guessing one. */
function pariPassuClaimMinor(invested: unknown, multiple: unknown): string | null {
  const inv = parseExactMoney(invested);
  if (inv === null || inv.isNegative()) return null;
  const m = Number(multiple);
  if (!Number.isFinite(m) || m < 0) return null;
  const claim = new EngineMatchDec(inv.toFixed()).mul(new EngineMatchDec(String(m)));
  if (!claim.isFinite() || claim.isNegative()) return null;
  return claim.toFixed();
}

/** THE WHOLE PARI PASSU FIX, IN ONE WALK. Tiers ascending; a covered tier is paid
 *  in full, and the first tier the budget cannot cover is paid
 *  `claim_i × available / tierClaims` — every class, in proportion to its claim —
 *  after which the budget is spent and every junior tier takes nothing. With
 *  DISTINCT ranks every tier is a singleton and this reduces EXACTLY to the
 *  sequential clamp the shipped engine already performs, which is why it cannot
 *  move a figure that computes today. `null` means a claim was not derivable. */
function buildPariPassuPlan(
  standing: ReadonlyArray<{ classId: string; className: string; seniority: number; ledgerIndex: number; claimMinor: string | null }>,
  budgetMinorText: string,
): PariPassuPlan | null {
  for (const s of standing) if (s.claimMinor === null) return null;
  const budget0 = parseExactMoney(budgetMinorText);
  if (budget0 === null || budget0.isNegative()) return null;

  const ranks: number[] = [];
  for (const s of standing) if (ranks.indexOf(s.seniority) === -1) ranks.push(s.seniority);
  ranks.sort((a, b) => a - b);

  const tiers: PariPassuTier[] = [];
  const abatedClaimByClassId: Record<string, string> = {};
  let rewriteRequired = false;
  let budget: Decimal = new EngineMatchDec(budget0.toFixed());

  for (const rank of ranks) {
    const members = standing.filter((s) => s.seniority === rank)
      .slice().sort((a, b) => a.ledgerIndex - b.ledgerIndex);
    const tierClaim = members.reduce<Decimal>(
      (acc, m) => acc.plus(new EngineMatchDec(String(m.claimMinor))), new EngineMatchDec(0),
    );
    const available = budget;
    const covered = available.gte(tierClaim);
    const rows: PariPassuTier["classes"] = [];
    if (covered) {
      for (const m of members) {
        const paid = String(m.claimMinor);
        abatedClaimByClassId[m.classId] = paid;
        rows.push({ classId: m.classId, className: m.className, claimMinor: paid, abatedClaimMinor: paid });
      }
      budget = available.minus(tierClaim);
    } else {
      /* ── PRO RATA TO CLAIM SIZE. THIS IS THE LINE. ─────────────────────── */
      for (const m of members) {
        const claim = new EngineMatchDec(String(m.claimMinor));
        const paid = tierClaim.isZero()
          ? new EngineMatchDec(0)
          : claim.mul(available).div(tierClaim);
        abatedClaimByClassId[m.classId] = paid.toFixed();
        rows.push({
          classId: m.classId, className: m.className,
          claimMinor: claim.toFixed(), abatedClaimMinor: paid.toFixed(),
        });
      }
      /* A tier of ONE, or a tier with nothing to share, needs no rewrite: the
         engine's own sequential clamp already pays exactly this figure, so those
         cap tables stay byte-identical. Only a genuine multi-class shortfall is
         re-delegated. */
      if (members.length > 1 && available.gt(0) && tierClaim.gt(0)) rewriteRequired = true;
      budget = new EngineMatchDec(0);
    }
    tiers.push({
      seniority: rank,
      classes: rows,
      tierClaimMinor: tierClaim.toFixed(),
      availableMinor: available.toFixed(),
      abated: !covered,
      abatementFactor: covered || tierClaim.isZero() ? null : available.div(tierClaim).toFixed(),
    });
  }

  return { tiers, rewriteRequired, abatedClaimByClassId, budgetMinor: budget0.toFixed() };
}

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 94 · ITEM 2 (R83.2, open item J-3) — A BINDING PARTICIPATION CAP RELEASES
   MONEY, AND THAT MONEY MUST GO TO THE OTHER STILL-PARTICIPATING CLASSES.
   ═══════════════════════════════════════════════════════════════════════════
   THE DEFECT, measured on three independent instruments
   (`build_log/wave94/W94_RELEASED_EXCESS.md`). When a participating class's cap
   binds but does NOT force it to convert, the sacred engine clamps that class's
   total to its cap and the money it no longer receives falls into `remaining`,
   which Step 2 of the engine divides among COMMON HOLDERS AND CONVERTERS ONLY.
   The other still-participating preference classes never see it: their
   participation was already computed against a denominator that still contained
   the capped class's shares.

   Executed, exit $56,000,000, Series A $10,000,000 1x participating UNCAPPED on
   4,000,000 shares, Series B $5,000,000 1x participating CAPPED AT 2x on
   2,000,000 shares, founders 8,000,000 common (the wire carries cents; dollars
   shown here for reading):

     treatment                                 A              B          founders
     ------------------------------------------------------------------------------
     cap IGNORED (this route before Wave 94)  21,714,285.71  10,857,142.86  23,428,571.43
     cap honoured, excess NOT redistributed   21,714,285.71  10,000,000.00  24,285,714.29
     CORRECT (this wave, both items together) 22,000,000.00  10,000,000.00  24,000,000.00

   Read the first and last rows together: THE FOUNDERS WERE BEING UNDERPAID
   $571,428.57 and Series A $285,714.29, while Series B was being OVERPAID
   $857,142.86. Now read the middle row: fixing the cap ALONE would have moved the
   founders to a DIFFERENT wrong number, $285,714.29 too high. That is exactly why
   R83.2 requires Items 1 and 2 in ONE measured step.

   THE STANDARD. NVCA Model Certificate of Incorporation, Article IV §2: a
   participating holder receives its preferential amount and thereafter shares in
   the remaining assets with the Common Stock on an as-converted basis; where a cap
   is recorded it shares only until its aggregate receipts equal the cap, and after
   that it is not among the holders entitled to share. The assets available are
   distributed among those who ARE so entitled, pro rata. A class that has reached
   its cap is therefore simply no longer in the pool — so what it leaves behind is
   divided among everyone who remains, which INCLUDES the other participating
   preferred and is not a windfall for the Common Stock alone.
   https://nvca.org/model-legal-documents/

   THE ALGORITHM: ONE PRICE PER SHARE, FOUND BY CONSTRAINED PROPORTIONAL
   ALLOCATION. Let `R` be the residual after the preferences actually taken, `s_i`
   the shares of each still-participating class, `B` the COMMON-EQUIVALENT block
   (common holders plus converters) and `h_i = cap_i − preference_i` the class's
   remaining headroom. Every participant takes `min(s_i × L, h_i)` and the block
   takes `B × L`, where `L` is the one per-share price that makes the total exactly
   `R`. It is computed by iterative removal: divide pro rata, cap whoever
   overshoots at its headroom, remove it from the pool, and re-divide what is left.

   WHY THAT TERMINATES, and why capping every overshooting class in one pass is
   safe. Removing a participant can only RAISE the price for those who remain, so a
   class already over its headroom stays over it and the bound set is monotonically
   NON-DECREASING. The pool strictly shrinks on every pass, so the loop ends in at
   most one pass per class. Convergence is by exact set equality, never a tolerance
   — the same argument the sacred engine's own converter fixed point uses.

   WHY THE FIXED POINT IS JOINT WITH THE CONVERSION ELECTION. Redistribution RAISES
   another class's participation, which can make ITS cap bind for the first time;
   and a class whose cap binds converts when its as-converted value exceeds the cap
   (the engine's own rule, reproduced unchanged). So the converter set and the bound
   set are solved together, seeded with the converter set the engine itself produced
   on the true, unabated terms. Monotone in the same direction, so it still
   terminates.

   THE ENGINE IS NOT EDITED, AND THE ENGINE STILL PUBLISHES EVERY FIGURE. At the
   fixed point the bound classes take exactly their caps, so they are handed to the
   UNMODIFIED engine as NON-PARTICIPATING classes standing on `invested = cap` at a
   multiple of 1. The engine then pays them their cap, leaves their shares out of
   both the participation denominator and the common pool — which is what "no
   longer entitled to share" means — and computes everybody else's participation
   over precisely the corrected denominator in its own single pass. No engine change
   is required for this and none was made; `npm run sacred` is 48/48 with nine
   ratified waivers before and after.

   AND THE PUBLISHED FIGURE IS CHECKED, NOT TRUSTED. Wave 91's safety net is
   EXTENDED to caps rather than copied: every published row — preference classes,
   common holders and converters alike — is compared against the allocation
   computed here independently of the engine, and `Σ payouts + remainder` must equal
   the exit EXACTLY. If either fails, the whole answer is REFUSED. This project
   shipped a waterfall that added up perfectly for the wrong exit value and a "fix"
   that made the founders' error three times larger while every conservation check
   passed, so conservation is necessary and NOT sufficient and both are asserted.
   ═══════════════════════════════════════════════════════════════════════════ */

/** A preference class as the cap plan needs to see it: its TRUE recorded terms. */
type CapPlanClass = {
  classId: string;
  className: string;
  investedMinor: string;
  multiple: number;
  capMultiple: number | null;
  participating: boolean;
  shares: bigint;
  seniority: number;
  ledgerIndex: number;
};

type CapRedistributionPlan = {
  /** Class ids whose cap BINDS and which do not convert. */
  bound: string[];
  /** Class ids the cap forces into conversion (the engine's own rule). */
  converters: string[];
  /** The correct TOTAL for every class that stands on a preference. */
  expectedTotalByClassId: Record<string, string>;
  /** The correct TOTAL for every common holder. */
  expectedTotalByHolderId: Record<string, string>;
  residualMinor: string;
  /** The one per-share price the residual is shared at, or `null` if none exists. */
  pricePerShareMinor: string | null;
  /** What a binding cap released back into the pool. `"0"` when nothing binds. */
  releasedExcessMinor: string;
  passes: number;
};

/** THE WHOLE J-3 FIX. Returns the correct allocation, or `null` when a figure is
 *  not derivable from the stored terms — in which case the caller REFUSES rather
 *  than guessing one. `seedConverters` is the converter set the engine itself
 *  produced on the true, unabated terms; the election is never recomputed from
 *  scratch here, only EXTENDED, because a class whose cap newly binds may elect to
 *  convert (NVCA §2.1 — the greater-of election is against the full preferential
 *  amount, decided before any reduction). */
function buildCapRedistributionPlan(
  classes: ReadonlyArray<CapPlanClass>,
  commonHolders: ReadonlyArray<{ holderId: string; shares: bigint }>,
  seedConverters: ReadonlyArray<string>,
  exitMinorText: string,
): CapRedistributionPlan | null {
  const exit0 = parseExactMoney(exitMinorText);
  if (exit0 === null || exit0.isNegative()) return null;
  const E = new EngineMatchDec(exit0.toFixed());

  let commonShares = BigInt(0);
  for (const c of commonHolders) commonShares += c.shares;
  let allPreferredShares = BigInt(0);
  for (const c of classes) allPreferredShares += c.shares;
  const totalAsConvertedShares = commonShares + allPreferredShares;

  const claimOf = (c: CapPlanClass): Decimal | null => {
    const inv = parseExactMoney(c.investedMinor);
    if (inv === null || inv.isNegative()) return null;
    if (!Number.isFinite(c.multiple) || c.multiple < 0) return null;
    const v = new EngineMatchDec(inv.toFixed()).mul(new EngineMatchDec(String(c.multiple)));
    return v.isFinite() && !v.isNegative() ? v : null;
  };
  const capOf = (c: CapPlanClass): Decimal | null => {
    if (c.capMultiple === null) return null;
    const inv = parseExactMoney(c.investedMinor);
    if (inv === null) return null;
    const v = new EngineMatchDec(inv.toFixed()).mul(new EngineMatchDec(String(c.capMultiple)));
    return v.isFinite() && !v.isNegative() ? v : null;
  };
  /* The engine's own as-converted value: shares × exit ÷ EVERY share, common and
     preferred alike, converters included. Reproduced, not reinvented. */
  const asConvertedAtFull = (c: CapPlanClass): Decimal =>
    totalAsConvertedShares === BigInt(0)
      ? new EngineMatchDec(0)
      : new EngineMatchDec(c.shares.toString()).mul(E).div(new EngineMatchDec(totalAsConvertedShares.toString()));

  for (const c of classes) {
    if (claimOf(c) === null) return null;
    if (c.capMultiple !== null && capOf(c) === null) return null;
  }

  /** The preference leg for one converter set: the SAME tier walk Wave 91 uses, so
   *  pari passu abatement and a participation cap can never disagree about who is
   *  owed what. One rule, one place (R21). */
  const preferenceLeg = (converters: ReadonlySet<string>): Record<string, string> | null => {
    const standing = classes.filter((c) => !converters.has(c.classId));
    const plan = buildPariPassuPlan(
      standing.map((c) => ({
        classId: c.classId,
        className: c.className,
        seniority: c.seniority,
        ledgerIndex: c.ledgerIndex,
        claimMinor: (claimOf(c) as Decimal).toFixed(),
      })),
      E.toFixed(),
    );
    return plan === null ? null : plan.abatedClaimByClassId;
  };

  let converters = new Set<string>(seedConverters);
  let passes = 0;
  let paidPref: Record<string, string> = {};
  let alloc: Record<string, string> = {};
  let bound = new Set<string>();
  let residual: Decimal = new EngineMatchDec(0);
  let price: Decimal | null = null;
  let blockShares = BigInt(0);
  let released: Decimal = new EngineMatchDec(0);

  for (let pass = 0; pass <= classes.length + 1; pass++) {
    passes = pass + 1;
    const leg = preferenceLeg(converters);
    if (leg === null) return null;
    paidPref = leg;

    let prefTotal: Decimal = new EngineMatchDec(0);
    for (const c of classes) {
      if (converters.has(c.classId)) continue;
      prefTotal = prefTotal.plus(new EngineMatchDec(String(paidPref[c.classId] ?? "0")));
    }
    residual = E.minus(prefTotal);
    if (residual.isNegative()) residual = new EngineMatchDec(0);

    let convShares = BigInt(0);
    for (const c of classes) if (converters.has(c.classId)) convShares += c.shares;
    blockShares = commonShares + convShares;

    const participants = classes.filter((c) => c.participating && !converters.has(c.classId));
    const headroom: Record<string, Decimal | null> = {};
    for (const p of participants) {
      const cap = capOf(p);
      headroom[p.classId] = cap === null
        ? null
        : cap.minus(new EngineMatchDec(String(paidPref[p.classId] ?? "0")));
    }

    /* ── THE CONSTRAINED PROPORTIONAL ALLOCATION ─────────────────────────────
       Divide pro rata; cap whoever overshoots at its headroom; remove it; repeat.
       `firstAlloc` records what the SHIPPED engine would have paid — one division,
       one clamp, no redistribution — so the released excess can be reported as a
       measured figure rather than described. */
    alloc = {};
    bound = new Set<string>();
    for (const p of participants) alloc[p.classId] = "0";
    let pool = participants.slice();
    let left: Decimal = residual;
    price = null;
    let firstDenom: bigint | null = null;
    const firstAlloc: Record<string, string> = {};
    for (let round = 0; round <= participants.length + 1; round++) {
      let poolShares = BigInt(0);
      for (const p of pool) poolShares += p.shares;
      const denom = poolShares + blockShares;
      if (denom === BigInt(0) || !left.gt(0)) break;
      if (firstDenom === null) {
        firstDenom = denom;
        for (const p of pool) {
          firstAlloc[p.classId] = new EngineMatchDec(p.shares.toString())
            .mul(left).div(new EngineMatchDec(denom.toString())).toFixed();
        }
      }
      const binders: CapPlanClass[] = [];
      for (const p of pool) {
        const h = headroom[p.classId];
        if (h === null || h === undefined) continue;
        const slice = new EngineMatchDec(p.shares.toString())
          .mul(left).div(new EngineMatchDec(denom.toString()));
        if (slice.gt(h)) binders.push(p);
      }
      if (binders.length === 0) {
        for (const p of pool) {
          alloc[p.classId] = new EngineMatchDec(p.shares.toString())
            .mul(left).div(new EngineMatchDec(denom.toString())).toFixed();
        }
        price = left.div(new EngineMatchDec(denom.toString()));
        left = new EngineMatchDec(0);
        break;
      }
      for (const p of binders) {
        const h = headroom[p.classId] as Decimal;
        const take = h.gt(0) ? h : new EngineMatchDec(0);
        alloc[p.classId] = take.toFixed();
        left = left.minus(take);
        bound.add(p.classId);
      }
      pool = pool.filter((p) => !bound.has(p.classId));
      if (left.isNegative()) left = new EngineMatchDec(0);
    }

    /* What a binding cap released, measured against the engine's own one-division
       answer on the same residual. Disclosed on the response. */
    released = new EngineMatchDec(0);
    if (bound.size > 0 && firstDenom !== null) {
      for (const id of Array.from(bound)) {
        const would = new EngineMatchDec(String(firstAlloc[id] ?? "0"));
        const took = new EngineMatchDec(String(alloc[id] ?? "0"));
        if (would.gt(took)) released = released.plus(would.minus(took));
      }
    }

    /* A class whose cap binds converts when its as-converted value beats the cap —
       the engine's own rule, and the reason the fixed point is joint. */
    const next = new Set<string>(converters);
    for (const p of participants) {
      if (!bound.has(p.classId)) continue;
      const cap = capOf(p);
      if (cap !== null && asConvertedAtFull(p).gt(cap)) next.add(p.classId);
    }
    if (next.size === converters.size) break;
    converters = next;
  }

  /* ── the rows ───────────────────────────────────────────────────────────── */
  const expectedTotalByClassId: Record<string, string> = {};
  let paidOut: Decimal = new EngineMatchDec(0);
  for (const c of classes) {
    if (converters.has(c.classId)) continue;
    const total = new EngineMatchDec(String(paidPref[c.classId] ?? "0"))
      .plus(new EngineMatchDec(String(alloc[c.classId] ?? "0")));
    expectedTotalByClassId[c.classId] = total.toFixed();
    paidOut = paidOut.plus(total);
  }
  let remaining: Decimal = E.minus(paidOut);
  if (remaining.isNegative()) remaining = new EngineMatchDec(0);

  const expectedTotalByHolderId: Record<string, string> = {};
  if (blockShares > BigInt(0) && remaining.gt(0)) {
    for (const h of commonHolders) {
      expectedTotalByHolderId[h.holderId] = new EngineMatchDec(h.shares.toString())
        .mul(remaining).div(new EngineMatchDec(blockShares.toString())).toFixed();
    }
    for (const c of classes) {
      if (!converters.has(c.classId)) continue;
      expectedTotalByClassId[c.classId] = new EngineMatchDec(c.shares.toString())
        .mul(remaining).div(new EngineMatchDec(blockShares.toString())).toFixed();
    }
  } else {
    for (const h of commonHolders) expectedTotalByHolderId[h.holderId] = "0";
    for (const c of classes) if (converters.has(c.classId)) expectedTotalByClassId[c.classId] = "0";
  }

  return {
    bound: Array.from(bound).sort(),
    converters: Array.from(converters).sort(),
    expectedTotalByClassId,
    expectedTotalByHolderId,
    residualMinor: residual.toFixed(),
    pricePerShareMinor: price === null ? null : price.toFixed(),
    releasedExcessMinor: released.toFixed(),
    passes,
  };
}

/** Agreement to 37 significant digits. The engine's ceiling is 38 and a repeating
 *  division rounds HALF_EVEN at the 39th, so a pin on the full string would go red
 *  on a rounding artefact and hide a real regression instead of catching it
 *  (`spec/UNVERIFIED_WATERFALL.md` · UV-W-4 asks for exactly this). */
function agreesTo37SignificantDigits(a: string, b: string): boolean {
  const A = parseExactMoney(a);
  const B = parseExactMoney(b);
  if (A === null || B === null) return false;
  if (A.eq(B)) return true;
  const scale = A.abs().gt(B.abs()) ? A.abs() : B.abs();
  if (scale.isZero()) return false;
  return A.minus(B).abs().div(scale).lte(new MoneyDec("1e-37"));
}

// ── helpers ──────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function newId(prefix: string): string {
  return `${prefix}_${randomBytes(8).toString("hex")}`;
}

/** Verify that the authenticated user owns (or is admin of) a company. */
function ownsCompany(ctx: ReturnType<typeof getUserContext>, companyId: string): boolean {
  if (!ctx) return false;
  if (ctx.isAdmin) return true;
  return ctx.founder.companies.some((c: { companyId: string }) => c.companyId === companyId);
}

/** Verify that the authenticated user owns (or is admin of) a round's company. */
function ownsRound(ctx: ReturnType<typeof getUserContext>, roundId: string): boolean {
  if (!ctx) return false;
  if (ctx.isAdmin) return true;
  const round = getRoundById(roundId);
  if (!round) return false;
  return ctx.founder.companies.some((c: { companyId: string }) => c.companyId === round.companyId);
}

// ── multer (for A3 CSV import) ────────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

// ── minimal PDF builder (same pattern as invoiceStore) ───────────────────────
function markdownToPdf(content: string): Buffer {
  // Simple %PDF-1.4 envelope embedding the text as a stream.
  // Same pattern as generateInvoicePdf() in invoiceStore.ts (no external dep).
  const escaped = content.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  // Chunk text into lines for PDF stream
  const lines = escaped.split("\n");
  const textOps = lines.map((l, i) => `BT /F1 11 Tf 40 ${800 - i * 14} Td (${l.substring(0, 120)}) Tj ET`).join("\n");

  const stream = `${textOps}\n`;
  const streamLen = Buffer.byteLength(stream, "utf8");

  const bodyParts: string[] = [];
  bodyParts.push("%PDF-1.4");
  // obj 1: catalog
  const off1 = bodyParts.join("\n").length + 1;
  bodyParts.push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj");
  // obj 2: pages
  const off2 = bodyParts.join("\n").length + 1;
  bodyParts.push("2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj");
  // obj 3: page
  const off3 = bodyParts.join("\n").length + 1;
  bodyParts.push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>\nendobj`);
  // obj 4: stream
  const off4 = bodyParts.join("\n").length + 1;
  bodyParts.push(`4 0 obj\n<< /Length ${streamLen} >>\nstream\n${stream}\nendstream\nendobj`);

  const xrefOffset = bodyParts.join("\n").length + 1;
  bodyParts.push("xref\n0 5");
  bodyParts.push(`0000000000 65535 f\r`);
  bodyParts.push(`${String(off1).padStart(10, "0")} 00000 n\r`);
  bodyParts.push(`${String(off2).padStart(10, "0")} 00000 n\r`);
  bodyParts.push(`${String(off3).padStart(10, "0")} 00000 n\r`);
  bodyParts.push(`${String(off4).padStart(10, "0")} 00000 n\r`);
  bodyParts.push(`trailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);

  return Buffer.from(bodyParts.join("\n"), "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// A1 — GET /api/founder/captable/waterfall
// ─────────────────────────────────────────────────────────────────────────────

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 74 · R67 — ONLY PREFERRED SHARES CARRY A LIQUIDATION PREFERENCE.
   ═══════════════════════════════════════════════════════════════════════════
   Wave 71's D11 refusal below is correct and stays. It was OVER-BROAD: it fired
   on all SEVEN instrument values the platform accepts, and six of them cannot
   have the term it demands. A SAFE, a convertible note, a warrant, an option
   pool and plain common/founder stock have no liquidation preference to record,
   so refusing them for lacking one refused a term the instrument cannot hold.
   Owner ruling R67 (2026-08-18), on R66's clarification: "narrow the CONDITION
   only. Never remove the refusal, its container, or the branch."

   THE SEVEN VALUES ARE READ FROM THE TREE, NOT ASSUMED. They are the
   `VALID_INSTRUMENTS` set the round writer enforces (`server/routes.ts`, the
   POST /api/rounds validator) and the `INSTRUMENTS` catalogue in
   `shared/schema.ts`: preferred, common, safe_post, safe_pre, convertible_note,
   warrant, option_pool. `preferred` is the one that carries the term; the SIX
   below are the ones that cannot.

   THE MATCH IS POSITIVE, AND THAT IS THE WHOLE SAFETY ARGUMENT. This set is
   asked "is this round definitely one of the six?" — never "is this round not
   preferred?". A round whose instrument is absent, empty, or any value not in
   this list is left on EXACTLY today's path, refusal included, because the
   platform does not know what it is and R6 forbids deciding for it. The change
   can therefore only ever turn a refusal into a computation, never the reverse:
   no round that computes today can begin refusing because of this line. Whether
   an unrecorded instrument type should itself refuse by name is an OWNER
   QUESTION and is recorded as one in build_log/wave74/.

   NOT A SILENT DROP. A round that leaves the preference stack here is reported
   on the response in `nonPreferenceClasses`, with its shares, its invested
   amount and the reason, so the figure a founder sees still accounts for every
   committed round on the cap table. */
const NON_PREFERENCE_INSTRUMENTS: ReadonlySet<string> = new Set([
  "safe_post",
  "safe_pre",
  "convertible_note",
  "warrant",
  "option_pool",
  "common",
]);

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 88 · THE CONVERTIBLE SUBGROUP — A SECOND SET BESIDE THE FIRST, NOT INSIDE IT.
   ═══════════════════════════════════════════════════════════════════════════
   WHAT WAS WRONG, MEASURED. R67 widened this route from 0-of-112 computing to
   104-of-112, and 48 of those 104 figures were economically wrong. A $10,000,000
   SAFE, outstanding on the cap table with its valuation cap on record, was paid
   **$0 and never even named**: `handleWaterfall`'s loop opened with
   `if (Number(data.sharesStr) === 0) continue;`, and an unpriced convertible
   commit carries ZERO shares by construction (the commit store refuses a share
   count on an unpriced instrument — `unexpected_shares_on_unpriced`). The
   `continue` fired BEFORE `nonPreferenceClasses.push`, so the instrument left the
   payout legs AND the disclosure in the same statement. The founders were handed
   the entire $50,000,000 exit and the investor was shown nothing.

   THAT IS A SILENT $0, and a silent $0 is a founder telling an investor they get
   nothing. Every instrument on this route is now either COMPUTED or REFUSED BY
   NAME. Nothing is omitted.

   WHY THE SUBGROUP IS ITS OWN SET. `NON_PREFERENCE_INSTRUMENTS` above keeps its
   exact membership and its exact meaning — "this instrument cannot carry a
   liquidation preference, so the preference refusal is not its refusal to fail".
   That is still true of a SAFE. What is ALSO true, and is what this set adds, is
   that a SAFE or a note is a CLAIM ON THE EXIT: it converts, or it is repaid, and
   either way it is paid before or alongside common. Those are two different facts
   about the same instrument, so they are two sets rather than one set asked to
   mean two things.

   ENGINE UNCHANGED, VERIFIED BEFORE THIS EDIT. `packages/cap-table-engine` is
   sacred and is not touched: `computeWaterfall` already pays an arbitrary number
   of common-leg holders exactly, so a converted convertible is a common-leg
   holder with its own id and the engine produces the split. Executed transcript,
   against the unmodified engine, BEFORE any line of this file changed:
   `build_log/wave88/transcripts/02_engine_needs_no_change.txt` —
     founder 8,000,000 + post-money SAFE 8,000,000 -> 2500000000 / 2500000000
     founder 8,000,000 + pre-money  SAFE 4,000,000 -> 3333333333.33… / 1666666666.66…

   NOT `computeConversionProjections` (`server/roundCarryForwardEngine.ts:770`).
   R69. Dead code, tripwire `W58F-F2f`, and it consumes already-fractional values.
   Four agents have proposed editing it and all four were wrong. This wave works on
   SAFE conversion at exit — the one task most likely to reach for it — and
   deliberately does not read it as a fix target, does not call it and does not
   edit it. The live conversion path is the one above: shares in, sacred engine,
   payouts out. */
const CONVERTIBLE_INSTRUMENTS: ReadonlySet<string> = new Set([
  "safe_post",
  "safe_pre",
  "convertible_note",
]);

/** The SAFE conventions this route can price at a liquidity event. */
const SAFE_INSTRUMENTS: ReadonlySet<string> = new Set(["safe_post", "safe_pre"]);

async function handleWaterfall(req: Request, res: Response): Promise<void> {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const { companyId, exitValuationMinor, preferredReturnPct } = req.query as Record<string, string>;

  if (!companyId) { res.status(422).json({ ok: false, error: "MISSING_COMPANY_ID" }); return; }
  if (!exitValuationMinor) { res.status(422).json({ ok: false, error: "MISSING_EXIT_VALUATION_MINOR" }); return; }

  if (!ownsCompany(ctx, companyId)) { res.status(403).json({ ok: false, error: "FORBIDDEN" }); return; }

  /* WAVE 86B · ITEM 1 (R72) — THIS LINE WAS THE DEFECT. `Number()` returned
     9007199254740992 for the input 9007199254740993 (one minor unit destroyed)
     and 1e+38 for a 38-digit input (which stopped being a decimal figure at
     all), and JSON then transported the damage faithfully to every API consumer
     and to the `captable.waterfall.computed` bridge event. Reproduced over HTTP
     twice independently: build_log/wave86b/transcripts/03_item1_http_before.txt.
     `exitMinor` is now EXACT DECIMAL TEXT. Every downstream use is UNCHANGED,
     including `String(exitMinor)`, which is now an identity — so the zero-ledger
     branch both failing rows took is fixed WITHOUT editing it, and the `W77-M2`
     source pin stays green untouched. */
  const exitMinorDec = parseExactMoney(exitValuationMinor);
  if (exitMinorDec === null || exitMinorDec.isNegative()) {
    res.status(422).json({ ok: false, error: "INVALID_EXIT_VALUATION_MINOR" }); return;
  }
  const exitMinor = exitMinorDec.toFixed();

  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 100 · ITEM 2 — AN EXIT VALUE THIS PLATFORM CANNOT CARRY EXACTLY IS
     REFUSED BY NAME. IT IS NOT ROUNDED AND THEN DECLARED EXACT.
     ═══════════════════════════════════════════════════════════════════════════
     THE DEFECT, measured over HTTP on a real company
     (`build_log/wave100/transcripts/02_digit_sweep_BEFORE.txt`): a 39-, 40-, 41-…
     significant-digit exit valuation was ACCEPTED, the published legs summed to
     ONE MINOR UNIT MORE than the caller submitted, the response said
     `conservationExact: true`, and the screen then rendered payout totals one cent
     ABOVE the sale price the founder typed
     (reviewer A, `final_review_2026_08_21/reviewerA/transcripts/11_screen41_render.txt`).

     WHERE THE DIGIT IS LOST, and why the fix is here rather than there. Wave 86B
     made the INPUT PARSE exact and the SUMMER exact, and said plainly that one
     residual remained: the arithmetic downstream runs at the SACRED cap-table
     engine's own declared ceiling — `Decimal.clone({ precision: 38,
     ROUND_HALF_EVEN })` in `packages/cap-table-engine/src/primitives/bigDecimal.ts`
     — and `packages/math-fns` sets the SHARED instance this file's bare `Decimal`
     uses to 40 / ROUND_HALF_UP. Both are READ here and NEITHER is edited: the
     engine's ceiling is sacred and the shared instance must not be mutated
     (`Decimal.set` is still called nowhere in this file). MEASURED, not assumed
     (`transcripts/01_precision_ceiling_measured.txt`): the engine returns an all-9s
     exit byte-identically up to 38 significant digits and moves it by one minor
     unit from 39 onwards. Reviewer A's first demonstrated failure was 41 digits;
     the true boundary is 39, and this refusal is placed at the MEASURED boundary
     rather than at the first number anybody happened to try.

     THE CEILING IS NOT HARDCODED. It is read off the two constructors the request
     will actually be computed on, and the input is round-tripped through both: if
     either would round it, the platform cannot publish an allocation of the value
     the caller sent, so it refuses. `.plus(0)` is the round-trip because decimal.js
     rounds the RESULT of an operation, never the constructor
     (`transcripts/01_precision_ceiling_measured.txt` §2 measures exactly that).

     WHY REFUSE RATHER THAN ROUND. This is the platform's own rule, applied to
     itself: Wave 88 refuses to price a convertible note rather than invent a
     figure; Wave 91 refuses to publish a split it cannot prove; Wave 94 refuses a
     cap it cannot reproduce. A silent one-unit round with `conservationExact: true`
     beside it is the one thing none of those would do. AND THE SCALE IS STATED
     HONESTLY: 39 significant digits of minor units is ~10^37 dollars, which no
     real exit approaches. The false `exact` claim, and a screen total above what
     the founder typed, are not scale-dependent. */
  const engineMatchCeiling = EngineMatchDec.precision;
  const sharedCeiling = Decimal.precision;
  const precisionCeilingSignificantDigits = Math.min(engineMatchCeiling, sharedCeiling);
  const exitAtEngineMatch = new EngineMatchDec(exitMinor).plus(0).toFixed();
  const exitAtShared = new Decimal(exitMinor).plus(0).toFixed();
  if (exitAtEngineMatch !== exitMinor || exitAtShared !== exitMinor) {
    res.status(422).json({
      ok: false,
      error: "EXIT_VALUATION_EXCEEDS_PRECISION_CEILING",
      refusal: "exit_valuation_exceeds_precision_ceiling",
      refusalName: "exit_valuation_exceeds_precision_ceiling",
      field: "exitValuationMinor",
      companyId,
      /* MACHINE-READABLE, beside the prose rather than inside it (R77). */
      submittedExitValuationMinor: exitMinor,
      submittedSignificantDigits: String(exitMinorDec.sd()),
      precisionCeilingSignificantDigits: String(precisionCeilingSignificantDigits),
      engineCeilingSignificantDigits: String(engineMatchCeiling),
      sharedInstanceCeilingSignificantDigits: String(sharedCeiling),
      wouldHavePublishedMinor: exitAtEngineMatch !== exitMinor ? exitAtEngineMatch : exitAtShared,
      message:
        `Capavate cannot compute an exit waterfall for this sale price. The figure submitted carries ` +
        `${exitMinorDec.sd()} significant digits and this calculation carries ` +
        `${precisionCeilingSignificantDigits}. Every payout would have to be worked out from a sale ` +
        `price that is not the one submitted — the nearest value the calculation can hold is ` +
        `${exitAtEngineMatch !== exitMinor ? exitAtEngineMatch : exitAtShared} minor units — so the ` +
        `payouts would add up to a different total from the one entered, and a screen would show a ` +
        `figure above the sale price. Capavate refuses rather than publishing a split of money it ` +
        `cannot represent exactly. Enter the sale price with at most ` +
        `${precisionCeilingSignificantDigits} significant digits.`,
    });
    return;
  }

  const lpPct = preferredReturnPct ? Number(preferredReturnPct) : 0;
  if (!Number.isFinite(lpPct) || lpPct < 0 || lpPct > 1) {
    res.status(422).json({ ok: false, error: "INVALID_PREFERRED_RETURN_PCT" }); return;
  }

  // Build waterfall input from cap table ledger entries for the company
  const ledger = getLedger();
  const companyEntries = ledger.filter((e: unknown) => (e as { companyId: string }).companyId === companyId && (e as { state: string }).state === "committed");

  // Group by roundId (share class proxy) — use string amounts to avoid BigInt literal TS errors
  const byRoundKeys: string[] = [];
  const byRoundData: Record<string, { amountStr: string; sharesStr: string; roundName: string }> = {};
  for (const entry of companyEntries) {
    const e = entry as { roundId: string; amount: string; shares: string };
    const round = getRoundById(e.roundId);
    if (!byRoundData[e.roundId]) {
      byRoundKeys.push(e.roundId);
      byRoundData[e.roundId] = { amountStr: "0", sharesStr: "0", roundName: round?.name ?? e.roundId };
    }
    const data = byRoundData[e.roundId];
    /* WAVE 33 OQ-33-2 sink 4 — was `Math.round(Number(e.amount) * 100)`, a
     * hardcoded ISO 4217 exponent of 2 on the waterfall's INVESTED figure.
     * The round is already resolved above via getRoundById, so the exponent
     * is derived from the round's own currency. For JPY (exponent 0) the old
     * form inflated every preferred class's invested amount 100x, which
     * inverts who clears their liquidation preference at a given exit. */
    const roundCurrency = (round as { currency?: string | null } | undefined)?.currency ?? "USD";
    try {
      /* WAVE 86B · ITEM 1 (R72) — the running totals narrowed TWICE per row: the
         accumulator and each ledger amount (`toMinor(amount: number, ...)` forced
         the second by signature). Both are exact now: money on the module-local
         `MoneyDec` clone, shares as `BigInt` because the SACRED commit store
         validates share counts with `SHARES_RE = /^-?\d+$/` and the engine's
         `shareCount.ts` returns `BigInt`. Same ISO 4217 exponent source, same
         half-up residue rounding, same `Math.max(0, ...)` clamp. */
      data.amountStr = new MoneyDec(data.amountStr).plus(toMinorExact(e.amount, roundCurrency)).toFixed();
      data.sharesStr = (BigInt(data.sharesStr) + exactShareAddend(e.shares)).toString();
    } catch { /* skip bad rows */ }
  }

  const exitProceeds = String(exitMinor);

  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 71 · D11 — THIS ROUTE FABRICATED THREE OF ITS OWN INPUTS.
     ═══════════════════════════════════════════════════════════════════════════
     `GET /api/founder/captable/waterfall` is the ONE reachable waterfall surface
     on the platform, and it invented three of the numbers it fed the engine.

     (1) `participating: false` WAS HARDCODED. Participating preferred was therefore
         UNREACHABLE here — no query parameter, no stored read, no way to express it
         — so the two participating scenarios in the QA document could not be
         produced through the API at all. It is now read from the issuing round's
         own `liquidationPreference` term through `roundStoredTerms`, the SAME
         single reader `server/routes.ts::buildCompanySecurities` uses and the same
         one `resolvePreferredTerms` normalises for the cap-table adapter. There is
         no second reader (Wave 70 handoff, R21).

     (2) `liquidationPreferenceMultiple: 1 + lpPct` WAS NOT A MULTIPLE. `lpPct` is
         the QUERY-STRING parameter `preferredReturnPct`, fenced to [0,1], and it
         models an SPV-style PREFERRED RETURN — a hurdle rate on a fund's capital.
         A liquidation preference multiple is a negotiated term of a preferred SHARE
         CLASS, recorded in that class's charter as "1x", "2x", "3x". Two different
         instruments, and one was being used as the other.
           THE CORRECT DERIVATION, stated as D11 requires: the multiple is READ, not
         derived. NVCA Model Certificate of Incorporation Article IV §2.1 fixes the
         preference at "the Original Issue Price ... multiplied by [1.0]" — the
         bracketed figure is the negotiated multiple and it lives in the charter.
         Capavate stores it in the round's free-text `liquidationPreference` field
         ("1x non-participating"), which `roundStoredTerms` now parses STRICTLY for
         a leading `<number>x`. https://nvca.org/model-legal-documents/
           `preferredReturnPct` is still accepted, still validated, and is now
         passed through to `formulaDef` ONLY (where it already went), so an existing
         caller's URL keeps working and stops silently changing a share-class term.

     (3) THE COMMON SHARE COUNT WAS INVENTED. `commonSharesNum = totalPrefSharesNum
         > 0 ? totalPrefSharesNum : 1`, pushed as a single holder `founder_common`,
         with the code's own comment reading "simplified: 1 common holder". The
         founders' leg of the waterfall was NOT read from the cap table — it was set
         equal to the preferred total. Every payout below the preference stack is
         `shares ÷ sharesInPool`, so this changed EVERY as-converted figure on the
         response. Executed on one $10,000,000 non-participating Series A class of
         4,000,000 shares at a $50,000,000 exit:

             FABRICATED common = 4,000,000   ->  Series A $25,000,000, founders $25,000,000
             REAL       common = 8,000,000   ->  Series A $16,666,666.67, founders $33,333,333.33

         The founders were understated by $8,333,333.33 on that single fixture.
         The real count now comes from the company's own cap table, via the
         securities provider this module is handed by `server/routes.ts` (the same
         `buildCompanySecurities` the cap-table and round-math routes read).

     ABSENT REFUSES, BY NAME, AND NEVER INVENTS (D11's instruction, verbatim: "If a
     term is absent, REFUSE — never invent"). A class with no liquidation term on
     record, or a company with no common shares on record, produces a named 422
     rather than a payout schedule built on a guess.

     R58 — WHO SEES THIS. These refusals stop at the API. `grep -ril "waterfall"
     client/src` finds NO founder screen that calls this endpoint; it is an
     API-only surface today (see `build_log/wave71/W71_VISIBILITY.md`). The
     refusal is correct and it is currently read by integrators and tests, not by
     a founder in a browser. That is stated rather than implied.
     ═══════════════════════════════════════════════════════════════════════════ */
  const preferred: unknown[] = [];
  const common: unknown[] = [];
  /* WAVE 74 · R67 — committed rounds that are NOT a preference class, disclosed
     rather than dropped. */
  const nonPreferenceClasses: Array<{
    roundId: string;
    className: string;
    instrument: string;
    shares: string;
    invested: string;
    reason: string;
  }> = [];
  /* ── WAVE 88 · DISCLOSED EXCLUSIONS, WITH THE MISSING FACTS NAMED ───────────
     A round that is genuinely undecidable is EXCLUDED and SAID SO, with the
     absent facts machine-readable in `missingFacts[]` rather than buried in
     prose. That is the line between a stated limitation and a silent $0. */
  const excludedFromPayout: Array<{
    roundId: string;
    className: string;
    instrument: string;
    shares: string;
    invested: string;
    reason: string;
    missingFacts: string[];
  }> = [];
  /* ── WAVE 88 · THE CONVERTIBLE CANDIDATES, COLLECTED NOT SKIPPED ────────────
     Priced at the liquidity event further down, once the cap table this route
     assembles is known. Collected here because THIS is the loop that used to
     drop them. */
  const convertibleRounds: Array<{
    roundId: string;
    className: string;
    instrument: string;
    currency: string;
    committedShares: string;
    /* The ledger's own committed amount, ALREADY in minor units via `toMinor`
       above. One reader of the invested figure, not a second. */
    investedMinor: string;
  }> = [];
  let classIdx = 0;
  for (const rid of byRoundKeys) {
    const data = byRoundData[rid];
    /* WAVE 88 — the instrument is read BEFORE the zero-share test, because the
       zero-share test is exactly what hid the SAFEs. `Number()` here is on a
       SHARE COUNT, not on a money string: `data.amountStr` is never coerced. */
    const preInstrument = String(
      (getRoundById(rid) as { instrument?: string | null } | undefined)?.instrument ?? "",
    ).trim().toLowerCase();
    if (CONVERTIBLE_INSTRUMENTS.has(preInstrument)) {
      /* NOT SKIPPED, AND NOT SILENTLY PAID $0. A convertible is a claim on the
         exit whether or not the commit ledger gave it a share count — and an
         unpriced commit never does. It is priced, or it is refused by name. */
      const cvCurrency = String(
        (getRoundById(rid) as { currency?: string | null } | undefined)?.currency ?? "USD",
      );
      convertibleRounds.push({
        roundId: rid,
        className: data.roundName,
        instrument: preInstrument,
        currency: cvCurrency,
        committedShares: data.sharesStr,
        investedMinor: data.amountStr,
      });
      continue;
    }
    /* WAVE 86B · ITEM 1 — an exact-zero test done in floating point. `BigInt(0)`
       rather than `0n`: this module's target predates BigInt literals and `0n`
       costs a TS error against the pinned tsc multiset. */
    if (BigInt(data.sharesStr) === BigInt(0)) {
      /* WAVE 88 · `R67F-13` — A ZERO-SHARE ROUND IS NO LONGER INVISIBLE. This
         `continue` used to be unconditional and unreported. A priced round that
         was committed with no share count cannot be paid — there is nothing to
         pay it on — but the founder reading this response is entitled to know a
         committed round was left out of every leg. */
      excludedFromPayout.push({
        roundId: rid,
        className: data.roundName,
        instrument: preInstrument || "not_on_record",
        shares: data.sharesStr,
        invested: data.amountStr,
        reason:
          `"${data.roundName}" is committed on this company's ledger but carries NO share count, so ` +
          `there is no basis on which this waterfall can pay it and it is excluded from every payout ` +
          `leg. It is named here rather than dropped: until Wave 88 a zero-share round left the payout ` +
          `legs and the disclosure in the same statement, which is how a $10,000,000 SAFE came to be ` +
          `paid nothing without appearing anywhere on this response. Record the round's committed share ` +
          `count, or record it as a convertible instrument, and it will be priced.`,
        missingFacts: ["committed_share_count"],
      });
      continue;
    }
    const terms = roundStoredTerms(rid);
    /* WAVE 74 · R67 — THE CONDITION IS NARROWED HERE, AND ONLY HERE. Read the
       round's own instrument through the same `getRoundById` this route already
       uses above; a positively-identified non-preference instrument is not part
       of the preference stack, so the refusal below is not its refusal to fail.
       Everything else — including an absent or unrecognised instrument — reaches
       the refusal exactly as it does today. */
    const roundInstrument = String(
      (getRoundById(rid) as { instrument?: string | null } | undefined)?.instrument ?? "",
    ).trim().toLowerCase();
    if (NON_PREFERENCE_INSTRUMENTS.has(roundInstrument)) {
      /* ════════════════════════════════════════════════════════════════════
         WAVE 88 · THE RESPONSE WAS TELLING THE READER SOMETHING FALSE.
         ════════════════════════════════════════════════════════════════════
         The sentence deleted from this string said the round's shares "are not
         added to the common leg". For a `common`-instrument round that is FALSE,
         and it was false on the wire, in prose, in an API response. Proved by a
         discriminating probe (`spec/preflight_r67_evidence/11_common_leg_
         discriminator.json`): adding a 4,000,000-share non-founder common round
         moves `lpProceeds` from 1666666666.666… (4/12 of the exit) to 1250000000
         (4/16 of the exit). $12,500,000 is only reachable if those shares are IN
         the common leg. They are. The engine was paying that investor correctly
         all along; the response denied it and reported the whole leg under the
         name `founderProceeds`, overstating founders by $16,666,666.67.

         The replacement text asserts nothing it cannot show. It points the reader
         at `byCommonHolder[]` and `commonLegProceeds`, both of which this response
         now carries, so the split is EVIDENCE on the payload rather than a claim
         in a paragraph. */
      const inCommonLeg = roundInstrument === "common";
      nonPreferenceClasses.push({
        roundId: rid,
        className: data.roundName,
        instrument: roundInstrument,
        shares: data.sharesStr,
        invested: data.amountStr,
        reason:
          `A ${roundInstrument} round carries no liquidation preference, so it is not a ` +
          `preference class in this waterfall and is not refused for lacking that term ` +
          `under Capavate's disclosure rule. Its committed shares are reported here rather than dropped; ` +
          `they are not paid a preference. ` +
          (inCommonLeg
            ? `Common stock IS paid through the common leg of this waterfall, which is read from the cap ` +
              `table's own common rows: see \`byCommonHolder\` for the per-holder split of that leg and ` +
              `\`commonLegProceeds\` for its total. \`founderProceeds\` is the TOTAL of the common leg, ` +
              `not the founders' share of it — on a cap table with a non-founder common holder those two ` +
              `figures are different, and reading the first as the second overstates what the founders keep.`
            : `A ${roundInstrument} is not paid by this waterfall at all: see \`excludedFromPayout\` for the ` +
              `exclusion and for the specific facts that are not on record, named in \`missingFacts\`.`),
      });
      /* WAVE 88 · `R67F-10` / `R67F-11` — WARRANTS AND THE OPTION POOL: EXCLUDED,
         AND THE EXCLUSION HARDENED. These 32 census fixtures were already the
         defensible ones — excluded but named. What they did NOT do is say WHICH
         facts are absent, so a consumer could not tell an undecidable case from a
         decided one. The facts are now machine-readable. */
      if (roundInstrument === "warrant") {
        excludedFromPayout.push({
          roundId: rid,
          className: data.roundName,
          instrument: roundInstrument,
          shares: data.sharesStr,
          invested: data.amountStr,
          reason:
            `"${data.roundName}" is a WARRANT and is excluded from every payout leg of this waterfall, ` +
            `because whether it pays anything at an exit depends on facts that are not on record. A ` +
            `warrant is a RIGHT to buy shares at a strike price, not a holding of shares: it pays only if ` +
            `it is exercised, the holder may or may not elect to exercise, a cash exercise brings strike ` +
            `money INTO the company while a net (cashless) exercise does not, and the two produce ` +
            `different proceeds for everybody else on the cap table. None of that is recorded against ` +
            `this round. The exclusion is stated rather than shown as a zero, because a zero would read ` +
            `as "this holder is owed nothing" and that is not what Capavate knows. Record the exercise ` +
            `election, the exercise mode and the treatment of the strike proceeds, and the warrant will ` +
            `be priced.`,
          missingFacts: [
            "exercise_election_at_exit",
            "exercise_mode_cash_or_net",
            "strike_proceeds_treatment",
            "shares_authorized_reconciliation",
          ],
        });
      } else if (roundInstrument === "option_pool") {
        excludedFromPayout.push({
          roundId: rid,
          className: data.roundName,
          instrument: roundInstrument,
          shares: data.sharesStr,
          invested: data.amountStr,
          reason:
            `"${data.roundName}" is an OPTION POOL and is excluded from every payout leg of this ` +
            `waterfall. A pool is an AUTHORISATION to grant options, not a holding: an UNALLOCATED pool ` +
            `is owed nothing at an exit and a zero for it would be correct, while VESTED, ` +
            `in-the-money grants out of that pool ARE owed money and a zero for them would be wrong. ` +
            `Capavate cannot tell the two apart here because no grant record exists against this round — ` +
            `there are no grants, no vesting status at the exit date, no strike prices and no allocated ` +
            `versus unallocated split. So the pool is excluded and said to be excluded, rather than ` +
            `reported as a zero that could mean either thing. Record the grants and their vesting, and ` +
            `the vested portion will be priced.`,
          missingFacts: [
            "grants",
            "vesting_status_at_exit",
            "strike_prices",
            "allocated_vs_unallocated_split",
          ],
        });
      }
      continue;
    }
    if (terms.liquidationPreferenceMultiple === null || terms.participatingPreferred === null) {
      res.status(422).json({
        ok: false,
        error: "LIQUIDATION_TERM_NOT_ON_RECORD",
        refusal: "liquidation_term_not_on_record",
        refusalName: "liquidation_term_not_on_record",
        field: "liquidationPreference",
        roundId: rid,
        className: data.roundName,
        message:
          `Capavate cannot compute an exit waterfall for "${data.roundName}" because that class's ` +
          `liquidation preference is not on record. ` +
          (terms.liquidationPreferenceRaw
            ? `The round's terms say "${terms.liquidationPreferenceRaw}", which does not state both a ` +
              `multiple (for example "1x") and whether the class is participating. `
            : `No liquidation preference is stored against the round at all. `) +
          `Those two terms decide who is paid first and how much: a 1x non-participating class takes ` +
          `the greater of its money back or its as-converted share, while a participating class takes ` +
          `its money back AND its pro-rata share of what is left. This route used to assume "1x" and ` +
          `"non-participating" for every class on every cap table, which made participating preferred ` +
          `impossible to express and quietly understated what a participating investor is owed. ` +
          `Record the liquidation preference on the round's terms — for example "1x non-participating" ` +
          `or "1x participating" — and the waterfall will compute.`,
      });
      return;
    }
    /* ═══════════════════════════════════════════════════════════════════════
       WAVE 94 · ITEM 1 (R83.2) — A RECORDED PARTICIPATION CAP IS EITHER READ AND
       APPLIED, OR REFUSED BY NAME. IT IS NEVER SILENTLY DROPPED.
       ═══════════════════════════════════════════════════════════════════════
       Before this wave this route never set `participationCapMultiple` at all, so
       "1x participating, capped at 2x" — an ordinary market term — was modelled as
       UNCAPPED. That OVERPAYS the capped class and UNDERPAYS THE FOUNDERS, and it
       did so silently: a wrong figure, not a refusal, which is why Wave 91 called
       it the most valuable thing it found and did not fix, and why R83.2 gave it
       its own measured wave.

       THE THREE WAYS A CAP CAN BE ON RECORD AND NOT USABLE ARE ALL REFUSED, because
       the one thing that must never happen again is a recorded cap quietly becoming
       no cap. `roundStoredTerms` distinguishes ABSENT from UNREADABLE precisely so
       these branches can exist. */
    if (terms.participationCapUnreadable) {
      res.status(422).json({
        ok: false,
        error: "PARTICIPATION_CAP_NOT_READABLE",
        refusal: "participation_cap_not_readable",
        refusalName: "participation_cap_not_readable",
        field: "capParticipation",
        roundId: rid,
        className: data.roundName,
        recordedValue: terms.participationCapRaw,
        message:
          `Capavate cannot compute an exit waterfall for "${data.roundName}" because that class has a ` +
          `participation CAP on record that cannot be read as a multiple. What is stored is ` +
          `"${terms.participationCapRaw}". A participation cap is the ceiling on what a participating ` +
          `class can take in total, as a multiple of the money it invested — for example "1x ` +
          `participating, capped at 2x". It must be a number greater than 0 and no more than ` +
          `${PARTICIPATION_CAP_MAX}. Capavate refuses rather than treating the class as UNCAPPED, ` +
          `because an uncapped model pays that class more than it agreed to take and pays the founders ` +
          `less than they are owed — and it would do it without saying so. Correct the recorded cap, or ` +
          `remove it if the class really is uncapped, and the waterfall will compute.`,
      });
      return;
    }
    if (terms.participationCapConflict) {
      res.status(422).json({
        ok: false,
        error: "PARTICIPATION_CAP_CONFLICT",
        refusal: "participation_cap_conflict",
        refusalName: "participation_cap_conflict",
        field: "capParticipation",
        roundId: rid,
        className: data.roundName,
        recordedValue: terms.participationCapRaw,
        message:
          `Capavate cannot compute an exit waterfall for "${data.roundName}" because that class has TWO ` +
          `different participation caps on record and they disagree: ${terms.participationCapRaw}. One is ` +
          `the round's own cap field and the other is inside the liquidation-preference wording. Capavate ` +
          `will not choose between two numbers the parties may have negotiated, because the choice moves ` +
          `money — a higher cap pays that class more and the founders less. Make the two agree, or remove ` +
          `one of them, and the waterfall will compute.`,
      });
      return;
    }
    if (
      terms.participationCapMultiple !== null &&
      terms.participatingPreferred === true &&
      terms.participationCapMultiple < terms.liquidationPreferenceMultiple
    ) {
      /* A cap BELOW the preference multiple is self-contradictory: the ceiling on
         the class's total is less than the preference it negotiated, so honouring
         the cap pays it less than its own money back. Measured at engine level: a
         2x preference with a 1.5x cap is clamped to 1.5x, and the difference is
         handed to everybody else. Both readings of that term move money, so
         Capavate publishes neither. */
      res.status(422).json({
        ok: false,
        error: "PARTICIPATION_CAP_BELOW_PREFERENCE",
        refusal: "participation_cap_below_preference",
        refusalName: "participation_cap_below_preference",
        field: "capParticipation",
        roundId: rid,
        className: data.roundName,
        capMultiple: terms.participationCapMultiple,
        liquidationPreferenceMultiple: terms.liquidationPreferenceMultiple,
        message:
          `Capavate cannot compute an exit waterfall for "${data.roundName}" because its participation cap ` +
          `(${terms.participationCapMultiple}x) is LOWER than its liquidation preference ` +
          `(${terms.liquidationPreferenceMultiple}x). A participation cap is a ceiling on the class's ` +
          `TOTAL proceeds, so a cap below the preference would pay the class less than the preference it ` +
          `negotiated — which is not what either side agreed. The two readings of that term (honour the ` +
          `preference, or honour the cap) pay different amounts to this class and therefore different ` +
          `amounts to everybody else, so Capavate publishes neither. Record a cap at or above the ` +
          `preference multiple, or remove the cap, and the waterfall will compute.`,
      });
      return;
    }
    preferred.push({
      classId: rid,
      className: data.roundName,
      invested: data.amountStr,
      // Waterfall engine accepts bigint for shares — convert via string cast
      shares: (BigInt as unknown as (s: string) => unknown)(data.sharesStr),
      /* WAVE 71 · D11 (2) — the negotiated multiple, READ. Was `1 + lpPct`. */
      liquidationPreferenceMultiple: terms.liquidationPreferenceMultiple,
      /* WAVE 71 · D11 (1) — the negotiated participation term, READ. Was `false`. */
      participating: terms.participatingPreferred,
      /* WAVE 79 · ITEM 2 — the negotiated RANKING, READ. Was `classIdx++`, the order
         the rounds happened to appear in the committed ledger. May be `null` here;
         the check immediately after this loop refuses in that case rather than
         letting a `null` reach the engine's `a.seniority - b.seniority` comparator,
         where it would sort as 0 and silently rebuild a fabricated order.
         `classIdx` is still incremented so a refusal can name classes in ledger
         order. */
      seniority: terms.seniorityRank,
      seniorityOnRecord: terms.seniorityRank !== null,
      /* WAVE 94 · ITEM 1 — THE NEGOTIATED PARTICIPATION CAP, THREADED AT LAST.
         This one spread is the whole of Item 1: the sacred engine has implemented
         `participationCapMultiple` since before this project's first wave and this
         route never supplied it. Omitted entirely when no cap is on record, so an
         uncapped class reaches the engine byte-for-byte as it always did —
         `participationCapMultiple === undefined` is the engine's own test for
         "uncapped", and an absent key and an explicit `undefined` are the same
         thing to it. A cap recorded against a NON-participating class is threaded
         too and is inert by construction (the engine's cap branch is inside
         `if (pref.participating)`), and it is DISCLOSED rather than dropped. */
      ...(terms.participationCapMultiple !== null
        ? { participationCapMultiple: terms.participationCapMultiple }
        : {}),
      participationCapOnRecord: terms.participationCapMultiple !== null,
      participationCapSource: terms.participationCapSource,
      /* A cap on a non-participating class cannot bind, because a non-participating
         class never participates. Said out loud on the response instead of silently
         ignored, because "we read your term and it does nothing" is a fact a
         founder is entitled to. */
      participationCapInert:
        terms.participationCapMultiple !== null && terms.participatingPreferred !== true,
      ledgerIndex: classIdx++,
    });
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 79 · ITEM 2 — THE SENIORITY RANKING IS READ, OR THE ROUTE REFUSES BY NAME.
     ═══════════════════════════════════════════════════════════════════════════
     `seniority: classIdx++` fabricated a strict total order out of ledger order,
     making the EARLIEST round the MOST senior. Market practice is the opposite or
     pari passu, and the ranking decides who is paid first and therefore who is paid
     AT ALL on a small exit. Measured at engine level on an $8,000,000 exit against
     $10,000,000 + $4,000,000 of 1x non-participating preferences:

       route's order (earliest = MOST senior)   early $8,000,000   late  $0
       market order  (latest  = MOST senior)    late  $4,000,000   early $4,000,000

     A $4,000,000 SWING ON AN $8m EXIT, from an order nobody negotiated. It is the
     same defect class as the fabricated common-share count Wave 71 fixed, and it
     appears in none of the eight wave reports.

     WHY A REFUSAL AND NOT A DEFAULT. There is no "natural" ordering to fall back on:
     ledger order, reverse ledger order and pari passu give three different answers
     and the difference is millions of dollars. R6 / R48 / R60 §4 all say the same
     thing — a negotiated term that is not on record is REFUSED BY NAME, never
     derived. R67 condition 1 governs the shape of this branch: it NARROWS what
     computes and it removes no existing refusal, branch or container.

     SCOPED TO WHERE IT BITES, so nothing that works today stops working needlessly:
       · ZERO or ONE preference class — a ranking cannot change any payout because
         there is nothing to rank, so a single class is given `0` (the engine's
         most-senior value) and the assumption is DISCLOSED on the response as
         `seniorityAssumed`. Every one-preference-class cap table — which is every
         round in Wave 74's 112-round census — is UNAFFECTED.
       · TWO OR MORE classes with ANY missing rank -> `SENIORITY_NOT_ON_RECORD`.
       · TWO OR MORE classes with DUPLICATE ranks -> `SENIORITY_RANKING_AMBIGUOUS`.
         Equal ranks mean PARI PASSU, which is the market default and a legitimate
         thing to record — but this waterfall pays preferences SEQUENTIALLY in sorted
         order and clamps each at the money still left, so on an exit that cannot
         cover the stack it pays the first-listed class in full and the second
         nothing, which is the opposite of pari passu. Reporting that as a
         pari-passu result would be a fabricated figure of exactly the kind this item
         exists to remove, so it refuses and the modelling gap is recorded as an
         OWNER QUESTION.
     ═══════════════════════════════════════════════════════════════════════════ */
  const prefRanked = preferred as Array<{
    classId: string; className: string;
    /* WAVE 91 · ITEM 2 — the two fields a CLAIM is made of, read here so the pari
       passu tier walk uses the same values the engine will. No second reader. */
    invested: string; liquidationPreferenceMultiple: number; participating: boolean;
    seniority: number | null; seniorityOnRecord: boolean; ledgerIndex: number;
  }>;
  let seniorityAssumed: string | null = null;
  /* WAVE 91 · ITEM 1 — the equally-ranked groups this cap table actually has, kept
     so the response can DISCLOSE that a pari passu tier was computed rather than
     leaving a reader to infer it from the figures. Empty when every rank is
     distinct, and always present on the response (the R67 rule this route already
     follows for `nonPreferenceClasses`). */
  let pariPassuDuplicateRanks: number[] = [];
  if (prefRanked.length === 1) {
    prefRanked[0].seniority = 0;
    seniorityAssumed =
      `This company has ONE preference class, so no seniority ranking can change any figure on this ` +
      `response and none is required. It is treated as the most senior class (0). A company with two or ` +
      `more preference classes must have a seniority recorded for each one.`;
  } else if (prefRanked.length > 1) {
    const missing = prefRanked.filter((p) => !p.seniorityOnRecord);
    if (missing.length > 0) {
      res.status(422).json({
        ok: false,
        error: "SENIORITY_NOT_ON_RECORD",
        refusal: "seniority_not_on_record",
        refusalName: "seniority_not_on_record",
        field: "seniority",
        companyId,
        classesMissingSeniority: missing.map((p) => ({ roundId: p.classId, className: p.className })),
        classesOnRecord: prefRanked.filter((p) => p.seniorityOnRecord)
          .map((p) => ({ roundId: p.classId, className: p.className, seniority: p.seniority })),
        message:
          `Capavate cannot compute an exit waterfall for this company because the seniority ranking of its ` +
          `${prefRanked.length} preference classes is not on record. ` +
          `${missing.map((p) => `"${p.className}"`).join(", ")} ${missing.length === 1 ? "has" : "have"} no ` +
          `recorded seniority. Seniority decides who is paid FIRST out of the exit proceeds, and therefore ` +
          `who is paid AT ALL when the exit does not cover every liquidation preference. On an $8,000,000 ` +
          `exit against a $10,000,000 and a $4,000,000 1x preference, ranking the earlier round senior pays ` +
          `it $8,000,000 and the later round nothing, while ranking the later round senior pays $4,000,000 ` +
          `to each — a $4,000,000 difference from the ordering alone. This route used to derive the ranking ` +
          `from the order the rounds appear in the committed ledger, which made the EARLIEST round the MOST ` +
          `senior; that is the opposite of the usual arrangement and nobody negotiated it. Record each ` +
          `preference class's seniority on the round (0 is the most senior, then 1, 2, … up to ` +
          `${SENIORITY_RANK_MAX}) and the waterfall will compute. A company with only ONE preference class ` +
          `needs no ranking and is unaffected. ` +
          /* ══ WAVE 91 · ITEM 4 — THE DEAD END AT THE END OF THIS SENTENCE. ═════
             This refusal instructed a founder to record a term, and there is no
             control anywhere in Capavate that records it — measured: zero screens
             set `seniority`, and the whole of `client/src` contains no reference to
             it. Sending someone to a control that does not exist is worse than
             saying nothing, because they will look for it. The sentence below stops
             the dead end WITHOUT claiming a screen exists, and it stops naming an
             unreachable action as if it were a button. The screen itself is the
             next step in this work and is deliberately NOT built here. */
          `Two classes can also rank EQUALLY — pari passu, the ordinary arrangement — and Capavate now ` +
          `computes that: the equally-ranked classes share a shortfall in proportion to what each is owed. ` +
          `There is no screen in Capavate that sets the payment order yet, so this is recorded against each ` +
          `round's terms by whoever maintains this company's rounds; a control for it is the next step in ` +
          `this work.`,
      });
      return;
    }
    const ranks = prefRanked.map((p) => Number(p.seniority));
    if (new Set(ranks).size !== ranks.length) {
      /* ════════════════════════════════════════════════════════════════════
         WAVE 91 · ITEM 1 — THIS REFUSAL IS NARROWED, NOT DELETED (R67 condition 1).
         ════════════════════════════════════════════════════════════════════
         EQUAL RANKS NO LONGER REFUSE BY THEMSELVES, and that is the whole of Item 1.
         Two measurements decided it, both in `spec/preflight_waterfall_evidence/`:
         when the exit COVERS every claim the ranking cannot change any figure
         (207 fixtures × 4 orderings, 206 byte-identical, the exception a 38th-digit
         HALF_EVEN residual), and when it does not, the abatement below computes the
         answer the two independent exact-rational references agree on 51 rows out
         of 51. Refusing a cap table whose answer is already correct served no one.

         THE BRANCH, ITS CONTAINER AND ITS IDENTIFIER ALL REMAIN, and the refusal
         stays REACHABLE from two sites. Here, when a claim cannot be derived at all
         — defence in depth of exactly the kind `CONVERTIBLE_ELECTION_NOT_CONVERGENT`
         already is on this handler, and stated as such rather than dressed up as
         likely: `invested` arrives from `MoneyDec.toFixed()` and the multiple is
         already fenced to `(0, 10]` by the one stored-terms reader, so a `null`
         claim here should be unreachable by construction. And after the engine's
         second pass (search WAVE 91 · ITEM 2 · SITE 2), where a published figure
         that fails to match the independently computed abatement refuses rather
         than shipping. A wrong split is worse than no split. */
      const claimPlanAtRankCheck = buildPariPassuPlan(
        prefRanked.map((p) => ({
          classId: p.classId, className: p.className,
          seniority: Number(p.seniority), ledgerIndex: p.ledgerIndex,
          claimMinor: pariPassuClaimMinor(p.invested, p.liquidationPreferenceMultiple),
        })),
        exitProceeds,
      );
      /* De-duplicated WITHOUT spreading a `Set`: this module is compiled below
         ES2015, and `[...new Set(x)]` costs a TS2802 against the tree's pinned 587
         type errors (the same reason the adapter writes `BigInt(0)` and not `0n`). */
      const dupes = ranks
        .filter((r, i) => ranks.indexOf(r) !== i)
        .filter((r, i, a) => a.indexOf(r) === i);
      pariPassuDuplicateRanks = dupes;
      if (claimPlanAtRankCheck === null) {
        res.status(422).json({
          ok: false,
          error: "SENIORITY_RANKING_AMBIGUOUS",
          refusal: "seniority_ranking_ambiguous",
          refusalName: "seniority_ranking_ambiguous",
          field: "seniority",
          companyId,
          duplicateRanks: dupes,
          /* WAVE 91 — the machine-readable reason for WHICH of the two narrowed
             conditions fired, on the PAYLOAD where machine codes belong (R77).
             It is never in `message`, so a screen can render `message` verbatim. */
          pariPassuReason: "claim_not_derivable",
          classes: prefRanked.map((p) => ({ roundId: p.classId, className: p.className, seniority: p.seniority })),
          message:
            `Capavate cannot compute an exit waterfall because two or more preference classes share the same ` +
            `recorded seniority (${dupes.join(", ")}) and, for at least one of them, the amount it is owed ` +
            `cannot be worked out from what is on record. Equal seniority means PARI PASSU — the classes rank ` +
            `equally, and when the exit cannot cover every preference each class takes a share of what is ` +
            `available in proportion to what it is owed. Capavate now computes that split, but it can only do ` +
            `so once every class in the equally-ranked group has an amount invested and a liquidation ` +
            `preference multiple on record. Check the invested amount and the liquidation preference recorded ` +
            `against each of these classes, and the waterfall will compute.`,
        });
        return;
      }
    }
  }

  /* WAVE 86B · ITEM 1 — SUMMED EXACTLY. The ONLY consumer of this value is the
     `=== 0` test below, so the exact bigint sum is collapsed to a 0/1 flag rather
     than narrowed with `Number()`, which reintroduced the 2^53 ceiling on a share
     count. THE IDENTIFIER AND THE COMPARISON TEXT BELOW ARE DELIBERATELY
     UNCHANGED, so the R67 pin `W74-R67-F` — which pins the literal
     `if (\n    totalPrefSharesNum === 0` — stays green and no WAVE 88 line has
     to move for this item. */
  const totalPrefSharesExact = preferred.reduce(
    (s: bigint, p: unknown) => s + BigInt(String((p as { shares: unknown }).shares)),
    BigInt(0) as bigint,
  );
  const totalPrefSharesNum = totalPrefSharesExact === BigInt(0) ? 0 : 1;
  /* WAVE 74 · R67 — THIS BRANCH IS NOT ALLOWED TO WIDEN ITS OWN MEANING. Its
     comment says "no ledger data", and it hands the founders the ENTIRE exit
     value without ever consulting the common-share count. Before R67 a company
     whose only committed rounds were SAFEs could not reach it — the refusal
     above stopped first. It must not now arrive here and be told it owns 100% of
     the exit: that is the fabricated-money-figure class R48 rules out. Adding
     `nonPreferenceClasses.length === 0` cannot change any input that reaches
     this branch today, because a round only enters that array from the path that
     previously ended in the refusal. A SAFE-only company now falls through to
     the common-shares check and either computes a real waterfall with no
     preference stack, or refuses COMMON_SHARES_NOT_ON_RECORD by name. */
  /* WAVE 88 — AND `convertibleRounds.length === 0` FOR THE SAME REASON, MEASURED.
     R67 fenced this branch with `nonPreferenceClasses.length === 0` so that a
     SAFE-only company could not arrive here and be told it owns 100% of the exit.
     That fence no longer holds on its own: a convertible round now leaves the loop
     through `convertibleRounds` and NEVER touches `nonPreferenceClasses`, so
     without this clause a company whose only committed round is a $10,000,000 SAFE
     would reach "no ledger data" and be handed `founderProceeds = exitMinor` — the
     exact fabricated figure R48 rules out, and a worse version of the defect this
     wave exists to fix. With the clause it falls through to the common-shares
     check and either computes or refuses `COMMON_SHARES_NOT_ON_RECORD` by name
     (`R67F-15`). */
  if (
    totalPrefSharesNum === 0 && preferred.length === 0 &&
    nonPreferenceClasses.length === 0 && convertibleRounds.length === 0
  ) {
    // No ledger data — return zero proceeds with empty breakdown
    res.json({
      ok: true,
      /* ── WAVE 77 · R72 — EXACT DECIMAL TEXT, IN THIS BRANCH TOO ───────────────
         R72 condition 1 is "enumerate every consumer first". This branch WAS a
         missed consumer of Wave 75's work: it emits the two money fields but
         never emitted the `*Exact` siblings Wave 75 declared authoritative, so a
         consumer that read `founderProceedsExact` got `undefined` here and any
         arithmetic on it produced `NaN` — the exact failure R72 condition 1 warns
         about, already present in the tree. Both are now emitted, in ONE format:
         exact decimal text. `exitMinor` is an integer count of minor units, so
         `String()` is its exact decimal representation — no rounding, no
         reformatting, no second money format. */
      lpProceeds: "0",
      founderProceeds: String(exitMinor),
      lpProceedsExact: "0",
      founderProceedsExact: String(exitMinor),
      byShareClass: [],
      breakpoints: [],
      /* WAVE 74 · R67 — always present, so a consumer never has to guess whether
         an absent key means "none" or "an older build". */
      nonPreferenceClasses,
      /* WAVE 88 — same R67 rule, extended to every key this wave adds: ALWAYS
         PRESENT, so a consumer never has to distinguish "none" from "an older
         build". This branch is reached only when there is no committed round at
         all, so there is no convertible, no exclusion and one implicit common
         leg. `commonLegProceeds` is the alias of `founderProceeds` (OQ-R67-5:
         keep the name, add the truth) and is byte-identical to it here. */
      convertibleProceeds: "0",
      convertibleProceedsExact: "0",
      byConvertible: [],
      byCommonHolder: [],
      commonLegProceeds: String(exitMinor),
      commonLegShares: "0",
      excludedFromPayout,
      /* WAVE 79 · ITEM 2 — same rule, same reason: the key is always present. This
         branch has NO preference class at all, so there is nothing to rank and
         nothing is assumed. */
      seniority: [],
      seniorityAssumed: null,
    });
    return;
  }

  /* ── WAVE 71 · D11 (3) — THE COMMON LEG, FROM THE CAP TABLE ────────────────
     Was: `commonSharesNum = totalPrefSharesNum > 0 ? totalPrefSharesNum : 1` and a
     single synthetic `founder_common` holder. Now: the company's real `common`
     rows, each as its own holder so the response can attribute proceeds per
     founder instead of to one invented aggregate. `founder_common` is retained as
     the id of the aggregate ONLY when the provider is unavailable — and in that
     case the route REFUSES rather than substituting a count. */
  const commonRows = readCompanyCommonRows(companyId);
  if (commonRows === null) {
    res.status(422).json({
      ok: false,
      error: "COMMON_SHARES_NOT_ON_RECORD",
      refusal: "common_shares_not_on_record",
      refusalName: "common_shares_not_on_record",
      field: "shares",
      companyId,
      message:
        `Capavate cannot compute an exit waterfall because this company has no common shares on ` +
        `record. Everything paid out below the preference stack is divided by the common share ` +
        `count, so an invented one changes every figure on this response: on a $50,000,000 exit ` +
        `with one $10,000,000 non-participating class of 4,000,000 shares, a common count of ` +
        `4,000,000 pays the founders $25,000,000 and a real count of 8,000,000 pays them ` +
        `$33,333,333.33. This route used to set the common count EQUAL to the total preferred ` +
        `count, with its own comment describing that as "simplified". It no longer guesses. ` +
        `Record the founders' common shares on the cap table.`,
    });
    return;
  }
  for (const row of commonRows) {
    common.push({ holderId: row.holderId, shares: (BigInt as unknown as (s: string) => unknown)(row.shares) });
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 88 · THE CONVERTIBLE LEG — COMPUTED WHERE THE TERMS ARE ON RECORD,
                REFUSED BY NAME WHERE THEY ARE NOT, NEVER $0 BY OMISSION.
     ═══════════════════════════════════════════════════════════════════════════
     A SAFE's exit entitlement is determined by three facts that are ALL on record
     and require NO convention to be invented: the purchase amount, the valuation
     cap, and the convention — post-money or pre-money — which is the round's own
     `instrument` value. A convertible NOTE's is not, and it refuses.

     THE 20% DISCOUNT IS DELIBERATELY NOT APPLIED, and this sentence exists so the
     next reader does not "fix" it in. A discount discounts the price of a NEW
     PRICED ROUND. A liquidity event has no new-round price to discount, so there is
     nothing for it to apply to. Using it here would invent a price.

     `Decimal.set` IS NOT CALLED ANYWHERE IN THIS BLOCK, and must never be. It
     mutates the shared decimal.js instance the sacred engine imports and eight
     production consumers read, one of them the sacred cap-table commit store; it
     once faked a result by ~80 orders of magnitude. Every figure below is built
     with `new Decimal(…)` on the instance as configured. */
  const minorFactorFor = (currency: string): Decimal =>
    new Decimal(10).pow(currencyExponent(currency));
  /* THE CAPITALISATION THE CONVERSION IS PRICED AGAINST: the cap table this route
     has already assembled, EXCLUDING any convertible's own converted shares. For
     a single outstanding convertible — every census fixture, and the only shape
     that reaches a computed figure while `mfn` is unrecorded — that is exactly the
     pre-money capitalisation the instrument's own terms refer to. Where TWO OR MORE
     convert simultaneously this basis is stated on every entry rather than implied,
     because simultaneous post-money conversion is circular and Capavate does not
     model it (recorded as an owner question, not solved here). */
  const preConversionShares = commonRows.reduce<Decimal>(
    (acc, r) => acc.plus(new Decimal(r.shares)), new Decimal(0),
  ).plus(
    preferred.reduce<Decimal>(
      (acc, p) => acc.plus(new Decimal(String((p as { shares: unknown }).shares))), new Decimal(0),
    ),
  );

  type ConvertibleLegEntry = {
    roundId: string; className: string; instrument: string; holderName: string;
    holderId: string; convention: string;
    purchaseAmountMinor: string; valuationCapMinor: string;
    convertedShares: string; convertedSharesUnrounded: string;
    cashOutFloorMinor: string;
    election: string; electionBasis: string;
    proceeds: string; proceedsExact: string;
    conversionBasis: string;
  };
  const convertibleLeg: ConvertibleLegEntry[] = [];

  if (convertibleRounds.length > 0) {
    const convertibleRows = readCompanyConvertibleRows(companyId) ?? [];
    const rowFor = (rid: string) => convertibleRows.filter((r) => r.roundId === rid)[0];

    /* ── (1) THE NOTE REFUSES, BY NAME, AND NAMES WHAT IS MISSING ──────────────
       A note's exit claim is principal PLUS ACCRUED INTEREST, and interest needs an
       elapsed period. This route accepts an exit VALUATION and no exit DATE;
       `maturityDate` is null, no day-count convention is stored anywhere, and no
       change-of-control repayment multiple is stored either. Executed on the census
       fixture ($10,000,000 note, 8%, 24-month maturity, $50,000,000 exit —
       `spec/preflight_r67_evidence/12_correct_payout_derivation.txt`) the note's
       payout moves from 1666666666.6666… at zero elapsed interest to
       1835443037.9746… at full maturity: a $1,687,763.71 swing on ONE fixture,
       from a period nobody recorded. Computing anyway means choosing that period
       silently, which is the invented-input class R48 and D11 rule out and the same
       shape as the fabricated seniority Wave 79 refused. So it refuses — and it is
       NEVER a 200 paying the note $0. */
    const notes = convertibleRounds.filter((c) => c.instrument === "convertible_note");
    if (notes.length > 0) {
      const n = notes[0];
      const nTerms = roundStoredTerms(n.roundId);
      res.status(422).json({
        ok: false,
        error: "NOTE_EXIT_CLAIM_NOT_DETERMINABLE",
        refusal: "note_exit_claim_not_determinable",
        refusalName: "note_exit_claim_not_determinable",
        field: "interestRate",
        companyId,
        roundId: n.roundId,
        className: n.className,
        /* MACHINE-READABLE, so a caller can act on it without parsing prose (R77:
           the identifier and these keys live in the PAYLOAD; none of them may be
           rendered as screen text). */
        missingFacts: ["exit_date", "day_count_convention", "change_of_control_repayment_multiple"],
        notesOutstanding: notes.map((x) => ({ roundId: x.roundId, className: x.className })),
        interestRate: nTerms.interestRate,
        maturityMonths: nTerms.maturityMonths,
        maturityDate: nTerms.maturityDate,
        message:
          `Capavate cannot compute an exit waterfall for this company because "${n.className}" is a ` +
          `CONVERTIBLE NOTE, and a note's claim on an exit is not determinable from what is on record. ` +
          `A note is DEBT: at a change of control it is repaid, or it converts, and either way it ranks ` +
          `AHEAD of the equity in this waterfall — so getting it wrong moves every other figure on the ` +
          `response. Its claim is the principal PLUS THE INTEREST ACCRUED to the exit, and three facts ` +
          `needed to compute that interest are not recorded. (1) There is NO EXIT DATE: this request ` +
          `carries an exit valuation only, so there is no elapsed period to accrue over. (2) There is no ` +
          `DAY-COUNT CONVENTION on the round — 30/360, actual/365 and actual/actual give different ` +
          `answers. (3) There is no CHANGE-OF-CONTROL REPAYMENT MULTIPLE, which is what decides whether ` +
          `a note is repaid at 1x its principal or at a negotiated premium. On this note — ` +
          `${nTerms.interestRate === null ? "no interest rate on record" : `${nTerms.interestRate}% interest`}, ` +
          `${nTerms.maturityMonths === null ? "no maturity on record" : `${nTerms.maturityMonths}-month maturity`} — ` +
          `the two ends of the range on a $10,000,000 principal at 8% over 24 months are $10,000,000 and ` +
          `$11,600,000, and Capavate has no basis for choosing between them. Refusing is the correct ` +
          `answer here: an invented elapsed period would publish a figure nobody negotiated. Record the ` +
          `exit date, the day-count convention and the change-of-control repayment multiple, and the ` +
          `waterfall will compute. Until then the note is NOT paid $0 — no figure is published at all.`,
      });
      return;
    }

    /* ── (2) MFN — INERT WITH ONE CONVERTIBLE, REFUSED WITH TWO ────────────────
       An MFN provision can pull a LATER convertible's better terms into an earlier
       one. With exactly one convertible outstanding there is nothing later to pull
       from, so `mfn === null` changes no figure and no assumption is being made.
       With two or more there is, and it must be recorded rather than guessed
       (OQ-R67-3). */
    if (convertibleRounds.length >= 2) {
      const mfnUnknown = convertibleRounds.filter((c) => roundStoredTerms(c.roundId).mfn === null);
      if (mfnUnknown.length > 0) {
        res.status(422).json({
          ok: false,
          error: "SAFE_MFN_STATUS_NOT_ON_RECORD",
          refusal: "safe_mfn_status_not_on_record",
          refusalName: "safe_mfn_status_not_on_record",
          field: "mfn",
          companyId,
          missingFacts: ["mfn"],
          convertiblesOutstanding: convertibleRounds.map((c) => ({
            roundId: c.roundId, className: c.className, instrument: c.instrument,
            mfn: roundStoredTerms(c.roundId).mfn,
          })),
          message:
            `Capavate cannot compute an exit waterfall for this company because ${convertibleRounds.length} ` +
            `convertible instruments are outstanding and the MOST-FAVORED-NATION status of ` +
            `${mfnUnknown.map((c) => `"${c.className}"`).join(", ")} is not on record. An MFN provision lets ` +
            `an earlier SAFE adopt the terms of a LATER convertible if those terms are better — a lower ` +
            `valuation cap, for example — which changes how many shares the earlier SAFE converts into and ` +
            `therefore what every holder on this cap table is paid at an exit. With only ONE convertible ` +
            `outstanding MFN cannot bite, because there is no later instrument for it to pull from, and ` +
            `Capavate computes without asking. With two or more it can bite, so it is refused rather than ` +
            `assumed either way: guessing "no MFN" would understate the earlier holder and guessing "MFN" ` +
            `would overstate it. Record MFN yes or no on each convertible round, and the waterfall will ` +
            `compute.`,
        });
        return;
      }
    }

    /* ── (3) PRICE EACH SAFE, OR REFUSE THAT SAFE BY NAME ───────────────────── */
    for (const cv of convertibleRounds) {
      if (!SAFE_INSTRUMENTS.has(cv.instrument)) continue; /* notes already returned above */
      const row = rowFor(cv.roundId);
      const factor = minorFactorFor(cv.currency);
      /* The purchase amount comes from the LEDGER's own committed figure, already
         converted to minor units with the round's own currency exponent by the
         grouping loop above. No second reader, and no hardcoded *100. */
      const purchaseMinor = new Decimal(cv.investedMinor);
      const capMinor = row && row.cap !== null ? new Decimal(row.cap).times(factor) : null;
      const holderName = row ? row.holderName : cv.className;

      /* NO CAP ON RECORD — an uncapped or discount-only SAFE has no liquidity price
         without a priced round to discount. Its cash-out floor is still its
         purchase amount, and the refusal says so, so the holder is not left
         thinking the answer is zero. */
      if (capMinor === null || !capMinor.isFinite() || capMinor.lte(0)) {
        res.status(422).json({
          ok: false,
          error: "SAFE_CONVERSION_PRICE_NOT_DETERMINABLE",
          refusal: "safe_conversion_price_not_determinable",
          refusalName: "safe_conversion_price_not_determinable",
          field: "valuationCap",
          companyId,
          roundId: cv.roundId,
          className: cv.className,
          missingFacts: ["valuationCap"],
          purchaseAmountMinor: purchaseMinor.toFixed(),
          message:
            `Capavate cannot compute an exit waterfall for this company because "${cv.className}" is a ` +
            `SAFE with NO VALUATION CAP on record. A SAFE converts at the lower of its cap and the price ` +
            `of the next priced round; a liquidity event has no next priced round, so with no cap there is ` +
            `no price at which it can convert and therefore no share count to pay it on. What Capavate ` +
            `DOES know is that this holder is not owed nothing: a SAFE's floor at a change of control is ` +
            `its purchase amount, ${purchaseMinor.toFixed()} minor units, and that is why this refuses ` +
            `instead of showing a zero. Record the valuation cap on the round and the waterfall will ` +
            `compute both the converted value and that floor, and pay whichever is greater.`,
        });
        return;
      }

      /* THE CONVENTION COMES FROM THE ROUND'S OWN `instrument` VALUE, which is
         authoritative and is already read by this route. `safeCapType` is NOT
         consulted (OQ-R67-4): it is null on every SAFE round the product's own
         writer creates, and two readers of the same fact is the drift R21 exists
         to prevent. */
      const postMoney = cv.instrument === "safe_post";
      let sharesUnrounded: Decimal;
      let conversionBasis: string;
      if (postMoney) {
        /* POST-MONEY: the SAFE's ownership is purchase ÷ post-money cap by
           definition of the instrument, so its share count is
           existing × f/(1−f). If the purchase equals or exceeds the cap the SAFE
           owns 100% or more of the company and there is no finite share count —
           that is a price that cannot be determined, not a payout. */
        if (purchaseMinor.gte(capMinor)) {
          res.status(422).json({
            ok: false,
            error: "SAFE_CONVERSION_PRICE_NOT_DETERMINABLE",
            refusal: "safe_conversion_price_not_determinable",
            refusalName: "safe_conversion_price_not_determinable",
            field: "valuationCap",
            companyId,
            roundId: cv.roundId,
            className: cv.className,
            missingFacts: ["valuationCap"],
            purchaseAmountMinor: purchaseMinor.toFixed(),
            valuationCapMinor: capMinor.toFixed(),
            message:
              `Capavate cannot compute an exit waterfall because "${cv.className}" is a POST-MONEY SAFE ` +
              `whose purchase amount (${purchaseMinor.toFixed()} minor units) is not smaller than its ` +
              `post-money valuation cap (${capMinor.toFixed()} minor units). A post-money SAFE's ownership ` +
              `is its purchase amount divided by its post-money cap, so those two figures imply this ` +
              `holder owns 100% or more of the company after conversion and there is no finite share ` +
              `count to pay it on. One of the two figures is wrong, or the instrument is not a post-money ` +
              `SAFE. Capavate refuses rather than publishing a figure derived from an impossible cap ` +
              `table. Check the purchase amount and the valuation cap on the round.`,
          });
          return;
        }
        const f = purchaseMinor.div(capMinor);
        sharesUnrounded = preConversionShares.times(f).div(new Decimal(1).minus(f));
        conversionBasis =
          `POST-MONEY SAFE. Ownership is the purchase amount divided by the post-money valuation cap ` +
          `(${purchaseMinor.toFixed()} / ${capMinor.toFixed()} = ${f.toFixed()}), so the converted share ` +
          `count is the capitalisation before conversion (${preConversionShares.toFixed()} shares) ` +
          `multiplied by f/(1-f). The convention was taken from the round's own instrument value ` +
          `"safe_post", not from safeCapType. The recorded discount is NOT applied: a discount discounts ` +
          `the price of a new priced round, and a liquidity event has no new-round price. Where more than ` +
          `one convertible converts at once, each is priced against the capitalisation excluding every ` +
          `convertible's own converted shares; Capavate does not model simultaneous post-money ` +
          `conversion, and states that here rather than implying it.`;
      } else {
        /* PRE-MONEY: the liquidity price is the cap divided by the pre-money
           capitalisation — the cap table before this SAFE's own shares exist — and
           the share count is the purchase amount at that price. */
        if (preConversionShares.lte(0)) {
          res.status(422).json({
            ok: false,
            error: "SAFE_CONVERSION_PRICE_NOT_DETERMINABLE",
            refusal: "safe_conversion_price_not_determinable",
            refusalName: "safe_conversion_price_not_determinable",
            field: "valuationCap",
            companyId,
            roundId: cv.roundId,
            className: cv.className,
            missingFacts: ["preMoneyCapitalisation"],
            message:
              `Capavate cannot compute an exit waterfall because "${cv.className}" is a PRE-MONEY SAFE and ` +
              `this company has no pre-money capitalisation on record to price it against. A pre-money ` +
              `SAFE converts at the valuation cap divided by the share count that exists BEFORE it ` +
              `converts, and dividing by nothing is not a price. Record the company's existing shares and ` +
              `the waterfall will compute.`,
          });
          return;
        }
        const price = capMinor.div(preConversionShares);
        sharesUnrounded = purchaseMinor.div(price);
        conversionBasis =
          `PRE-MONEY SAFE. The liquidity price is the valuation cap divided by the capitalisation before ` +
          `conversion (${capMinor.toFixed()} / ${preConversionShares.toFixed()} = ${price.toFixed()} minor ` +
          `units per share), and the converted share count is the purchase amount at that price. The ` +
          `convention was taken from the round's own instrument value "safe_pre", not from safeCapType. ` +
          `The recorded discount is NOT applied: a discount discounts the price of a new priced round, and ` +
          `a liquidity event has no new-round price.`;
      }

      /* WHOLE SHARES ONLY, AND ZERO IS A REFUSAL NOT A ROUNDING OUTCOME. A share
         count is an integer; the fraction is disclosed rather than hidden. A
         converted count that floors to zero means the inputs are wrong — this
         project has already shipped a zero-share financing that succeeded at an
         INFINITE price — so it refuses instead of paying the holder nothing
         (`R67F-14`, OQ-R67-8). */
      const sharesFloor = sharesUnrounded.floor();
      if (!sharesFloor.isFinite() || sharesFloor.lte(0)) {
        res.status(422).json({
          ok: false,
          error: "SAFE_CONVERSION_YIELDS_ZERO_SHARES",
          refusal: "safe_conversion_yields_zero_shares",
          refusalName: "safe_conversion_yields_zero_shares",
          field: "valuationCap",
          companyId,
          roundId: cv.roundId,
          className: cv.className,
          missingFacts: ["valuationCap", "purchaseAmount"],
          convertedSharesUnrounded: sharesUnrounded.isFinite() ? sharesUnrounded.toFixed() : "not_finite",
          purchaseAmountMinor: purchaseMinor.toFixed(),
          valuationCapMinor: capMinor.toFixed(),
          message:
            `Capavate cannot compute an exit waterfall because "${cv.className}" converts into ZERO whole ` +
            `shares on the figures recorded against it (purchase ${purchaseMinor.toFixed()} minor units, ` +
            `valuation cap ${capMinor.toFixed()} minor units, unrounded share count ` +
            `${sharesUnrounded.isFinite() ? sharesUnrounded.toFixed() : "not finite"}). A holder who paid ` +
            `real money does not own zero shares, so a zero here is a signal that one of the recorded ` +
            `figures is wrong — not a payout. Capavate refuses rather than paying this holder $0, because ` +
            `this platform has already shipped a financing that succeeded at an infinite price and a zero ` +
            `share count is the same defect seen from the other side. Check the purchase amount and the ` +
            `valuation cap on the round.`,
        });
        return;
      }

      convertibleLeg.push({
        roundId: cv.roundId,
        className: cv.className,
        instrument: cv.instrument,
        holderName,
        /* Namespaced so it can never collide with a common holder's id, and so the
           common leg's selector below stays exactly what it was. */
        holderId: `convertible:${cv.roundId}`,
        convention: postMoney ? "post_money_cap" : "pre_money_cap",
        purchaseAmountMinor: purchaseMinor.toFixed(),
        valuationCapMinor: capMinor.toFixed(),
        convertedShares: sharesFloor.toFixed(),
        convertedSharesUnrounded: sharesUnrounded.toFixed(),
        cashOutFloorMinor: purchaseMinor.toFixed(),
        election: "pending",
        electionBasis: "",
        proceeds: "0",
        proceedsExact: "0",
        conversionBasis,
      });
    }
  }

  // ── XT-C5 · WATERFALL BOUNDARY (2 of 3) ───────────────────────────────────
  // This is the FOUNDER-SIDE EXIT waterfall: liquidation preferences by share
  // class and breakpoints — who gets what if the COMPANY is sold. It is NOT
  // the SPV LP distribution waterfall and must never be substituted for it.
  //   · SPV LP distribution (canonical, persists, collects carry, hash-chained)
  //     → `spvEngineStore.recordDistribution` (server/spvEngineStore.ts:1697)
  //   · SPV distribution PREVIEW (persists nothing)
  //     → `computeDistributionSplit` (server/lib/spvOfflineOps.ts)
  // Three implementations, three capabilities, no rivalry. ENGINE_REGISTRY C-5.
  // Import waterfall engine (sacred — read-only)
  let computeWaterfall: (input: unknown) => unknown;
  try {
    const engine = await import("@capavate/cap-table-engine");
    computeWaterfall = (engine as unknown as { computeWaterfall: (i: unknown) => unknown }).computeWaterfall;
  } catch (err) {
    log.warn("[track1/waterfall] engine import failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "ENGINE_UNAVAILABLE" }); return;
  }

  const formulaId = `waterfall_${companyId}`;

  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 88 · THE GREATER-OF TEST, RESOLVED BY A TERMINATING ELECTION LOOP.
     ═══════════════════════════════════════════════════════════════════════════
     A SAFE at a change of control takes THE GREATER of its cash-out amount (its
     purchase amount) and its as-converted value. The as-converted value is not
     knowable until the engine has run, because it depends on the whole cap table
     — so the engine runs, the comparison is made, and if any holder is better off
     cashing out the engine runs again with that holder's cash-out taken off the top
     and its shares withdrawn.

     THIS LOOP TERMINATES, AND THAT IS AN ARGUMENT NOT A HOPE. Elections move in ONE
     direction only: a holder may flip from converting to cashing out and is never
     flipped back. Taking a cash-out off the top can only REDUCE the proceeds left
     for the remaining converters, so it can only ever create more cash-out
     elections, never fewer. There are finitely many convertibles, so at most one
     pass per convertible plus one confirming pass. The bound is asserted anyway and
     the route refuses by name if it is ever exceeded: this project has already
     shipped a non-convergence that produced 2.2e96 shares, and a loop on a money
     path is not given the benefit of the doubt.

     A TIE RESOLVES TO CASH-OUT (OQ-R67-7). `.gte` below, deliberately: cash-out is
     the deterministic, lower-variance leg and it is what a rational holder takes
     when indifferent. The boundary is testable one minor unit either side.

     THE CASH-OUT IS TAKEN OFF THE TOP, and that is a modelling choice, stated. A
     cash-out is a contractual payment to the holder ahead of the equity; Capavate
     does not model it as ranking pari passu with a preference class, because no
     ranking between a SAFE cash-out and a preferred class is on record anywhere.
     Every census fixture converts rather than cashing out, so no published census
     figure depends on this choice — it is disclosed on the response
     (`convertibleCashOutBasis`) and recorded as an owner question. */
  const exitDec = new Decimal(exitProceeds);
  const cashOutElected: Record<string, boolean> = {};
  const cashOutPaid: Record<string, string> = {};
  const maxElectionPasses = convertibleLeg.length + 1;
  let electionPasses = 0;
  let payouts: Array<{
    classId?: string; holderId?: string; className?: string;
    total: string; decision: string;
  }> = [];
  let engineRemainder = "0";
  let engineExitProceeds = exitProceeds;
  let settledCommonWithConvertibles: unknown[] = common;

  for (;;) {
    electionPasses += 1;
    const converting = convertibleLeg.filter((c) => !cashOutElected[c.holderId]);
    const cashingOut = convertibleLeg.filter((c) => cashOutElected[c.holderId]);
    let cashOutTotal = cashingOut.reduce<Decimal>(
      (acc, c) => acc.plus(new Decimal(c.cashOutFloorMinor)), new Decimal(0),
    );
    if (cashOutTotal.gt(exitDec)) {
      /* The exit does not cover the cash-out claims. With ONE claimant that is
         unambiguous — it takes what there is. With two or more, WHO is paid first
         decides who is paid at all, and that order is not on record: it is exactly
         the fabricated-ordering defect Wave 79 refused for preference seniority, so
         it refuses here too rather than picking an order. */
      if (cashingOut.length !== 1) {
        res.status(422).json({
          ok: false,
          error: "CONVERTIBLE_CASH_OUT_ORDER_NOT_ON_RECORD",
          refusal: "convertible_cash_out_order_not_on_record",
          refusalName: "convertible_cash_out_order_not_on_record",
          field: "seniority",
          companyId,
          missingFacts: ["convertible_cash_out_ranking"],
          exitProceedsMinor: exitProceeds,
          cashOutClaimsMinor: cashOutTotal.toFixed(),
          claimants: cashingOut.map((c) => ({
            roundId: c.roundId, className: c.className, cashOutFloorMinor: c.cashOutFloorMinor,
          })),
          message:
            `Capavate cannot compute an exit waterfall for this company because ${cashingOut.length} ` +
            `convertible holders are better off taking their money back than converting, their combined ` +
            `claims (${cashOutTotal.toFixed()} minor units) exceed the exit proceeds (${exitProceeds} ` +
            `minor units), and the order in which they are paid is not on record. When the money does not ` +
            `cover every claim, the ORDER decides who is paid in full and who is paid nothing — a ` +
            `difference of millions on a single exit — and nobody negotiated an order that Capavate could ` +
            `read. It refuses rather than paying them in whatever sequence they happen to appear on the ` +
            `ledger, which is the same defect this platform already found and removed from preference ` +
            `seniority. Record the ranking between these instruments and the waterfall will compute.`,
        });
        return;
      }
      cashOutTotal = exitDec;
      cashOutPaid[cashingOut[0].holderId] = exitDec.toFixed();
    } else {
      for (const c of cashingOut) cashOutPaid[c.holderId] = new Decimal(c.cashOutFloorMinor).toFixed();
    }
    engineExitProceeds = exitDec.minus(cashOutTotal).toFixed();

    /* The converted convertibles join the CAP TABLE as their own holders, each
       under a namespaced id. `common` itself is not mutated, so the common leg's
       selector below is byte-for-byte the one Wave 71b wrote and `founderProceeds`
       keeps its exact meaning: the total of the COMMON rows' leg. */
    const commonWithConvertibles = common.concat(
      converting.map((c) => ({
        holderId: c.holderId,
        shares: (BigInt as unknown as (s: string) => unknown)(c.convertedShares),
      })) as unknown[],
    );

    /* WAVE 91 · ITEM 2 — the settled cap table, kept for the abatement pass so the
       second engine run sees EXACTLY the pool the first one did. Rebuilding it
       would be a second source of truth for who converted (R21). */
    settledCommonWithConvertibles = commonWithConvertibles;
    const waterfallInput = {
      exitProceeds: engineExitProceeds,
      preferred,
      common: commonWithConvertibles,
      formulaId,
      formulaVersion: "v25.0",
      region: "US" as const,
      formulaDef: { preferredReturnPct: lpPct, exitMinor },
    };

    let result: unknown;
    try {
      result = computeWaterfall(waterfallInput);
    } catch (err) {
      log.warn("[track1/waterfall] compute failed:", (err as Error).message);
      res.status(422).json({ ok: false, error: "WATERFALL_COMPUTE_ERROR", message: (err as Error).message }); return;
    }

    const output = result as { payouts: unknown[]; remainder: string };
    payouts = output.payouts as Array<{
      classId?: string; holderId?: string; className?: string;
      total: string; decision: string;
    }>;
    engineRemainder = String(output.remainder);

    const newlyElected: string[] = [];
    for (const c of converting) {
      const hit = payouts.filter((p) => !p.classId && p.holderId != null && String(p.holderId) === c.holderId)[0];
      const asConverted = new Decimal(hit ? String(hit.total) : "0");
      /* TIE -> CASH-OUT. `.gte`, not `.gt`. */
      if (new Decimal(c.cashOutFloorMinor).gte(asConverted)) newlyElected.push(c.holderId);
    }
    if (newlyElected.length === 0) break;
    for (const h of newlyElected) cashOutElected[h] = true;
    if (electionPasses > maxElectionPasses) {
      res.status(422).json({
        ok: false,
        error: "CONVERTIBLE_ELECTION_NOT_CONVERGENT",
        refusal: "convertible_election_not_convergent",
        refusalName: "convertible_election_not_convergent",
        field: "valuationCap",
        companyId,
        passes: electionPasses,
        maxPasses: maxElectionPasses,
        message:
          `Capavate cannot compute an exit waterfall for this company because the greater-of test between ` +
          `each convertible's money-back amount and its as-converted value did not settle within ` +
          `${maxElectionPasses} passes, which should not be possible: an election can only ever move from ` +
          `converting to taking the money back, never the other way, so it must settle in at most one pass ` +
          `per convertible. Rather than publish a figure from a calculation that behaved unexpectedly, ` +
          `Capavate refuses and asks for this to be reported. This platform has previously shipped a ` +
          `non-convergent calculation that produced an absurd share count, and no money figure is worth ` +
          `more than that guarantee.`,
      });
      return;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 91 · ITEM 2 — PRO-RATA ABATEMENT, APPLIED IN THE CALLER, ENGINE UNTOUCHED.
     ═══════════════════════════════════════════════════════════════════════════
     The loop above has settled every convertible's election, so `payouts` is now
     the engine's answer on the TRUE, UNABATED terms — which is where the greater-of
     elections must come from (NVCA §2.1: a holder elects on the amount it
     negotiated, not on the reduced amount it will be paid).

     THE CONVERTER SET IS READ, NOT RECOMPUTED. A class that took its preference
     always carries a row (`preference_only` or `preference_then_participate`); a
     class that elected to convert either carries an `as_converted` row or, when
     nothing was left to share, carries NO ROW AT ALL. So "standing" is exactly
     "has a row, and that row is not `as_converted`", read off the engine's own
     output rather than reimplemented here. There is no second election model.

     WHEN NOTHING IS DONE, AND WHY THAT MATTERS MORE THAN WHAT IS. `rewriteRequired`
     is `false` unless a tier of TWO OR MORE standing classes takes a PARTIAL
     payment. Every distinct-rank cap table therefore leaves this block
     byte-identical, because with distinct ranks every tier is a singleton and the
     engine's own sequential clamp already pays precisely `claim × available /
     claim = available`. Wave 88's census, Wave 79's 22 tests, `W74-R67-*`,
     `W75-*` and `W77-M1` are untouched by construction, not by hope. */
  const prefStanding = prefRanked.filter((p) => {
    const rows = payouts.filter((q) => q.classId != null && String(q.classId) === p.classId);
    return rows.length > 0 && rows[0].decision !== "as_converted";
  });
  const pariPassuPlan = buildPariPassuPlan(
    prefStanding.map((p) => ({
      classId: p.classId, className: p.className,
      seniority: Number(p.seniority), ledgerIndex: p.ledgerIndex,
      claimMinor: pariPassuClaimMinor(p.invested, p.liquidationPreferenceMultiple),
    })),
    engineExitProceeds,
  );
  let pariPassuAbated = false;

  if (pariPassuPlan !== null && pariPassuPlan.rewriteRequired) {
    /* THE SECOND PASS. Each standing class is handed its ABATED claim as
       `invested × 1`, and handed to the engine as PARTICIPATING WITH NO CAP — which
       is the fence UV-W-5 asked for. The engine only ever flips a participating
       class into conversion when a recorded cap BINDS, so a class cannot be
       re-elected out of a preference it did elect; and because the abated claims
       consume the entire budget, the residual is zero, so participation adds
       nothing and the figure the engine publishes is the abated claim itself.
       A class that CONVERTED keeps its shares and is handed `invested: "0"`, so it
       is paid from the (zero) residual as common-equivalent, exactly as it was.
       Synthetic DISTINCT ranks are supplied because each class's claim now equals
       what it is to be paid, which makes the engine's sequential walk order-free. */
    const abatedOrder: string[] = [];
    for (const t of pariPassuPlan.tiers) for (const c of t.classes) abatedOrder.push(c.classId);
    const abatedPreferred = (preferred as Array<Record<string, unknown>>).map((raw) => {
      const p = raw as unknown as { classId: string };
      const abated = pariPassuPlan.abatedClaimByClassId[p.classId];
      const rank = abatedOrder.indexOf(p.classId);
      const out: Record<string, unknown> = { ...raw };
      if (abated === undefined) {
        /* A CONVERTER. Its preference is waived, so it stands on nothing. */
        out.invested = "0";
        out.participating = false;
        delete out.participationCapMultiple;
        out.seniority = abatedOrder.length + (raw.ledgerIndex as number);
      } else {
        out.invested = abated;
        out.liquidationPreferenceMultiple = 1;
        out.participating = true;
        delete out.participationCapMultiple;
        out.seniority = rank;
      }
      return out;
    }) as unknown[];

    let abatedResult: unknown;
    try {
      abatedResult = computeWaterfall({
        exitProceeds: engineExitProceeds,
        preferred: abatedPreferred,
        common: settledCommonWithConvertibles,
        formulaId,
        formulaVersion: "v25.0",
        region: "US" as const,
        formulaDef: { preferredReturnPct: lpPct, exitMinor },
      } as never);
    } catch (err) {
      log.warn("[track1/waterfall] pari passu compute failed:", (err as Error).message);
      res.status(422).json({ ok: false, error: "WATERFALL_COMPUTE_ERROR", message: (err as Error).message }); return;
    }
    const abatedOut = abatedResult as { payouts: unknown[]; remainder: string };
    const abatedPayouts = abatedOut.payouts as Array<{
      classId?: string; holderId?: string; className?: string;
      total: string; decision: string;
    }>;

    /* ══ WAVE 91 · ITEM 2 · SITE 2 — THE PUBLISHED FIGURE IS CHECKED, NOT TRUSTED. ══
       This project has shipped a waterfall that added up perfectly for the wrong
       exit value, and a "fix" that made the founders' error three times larger
       while every conservation check passed. Conservation is therefore necessary
       and NOT sufficient: every standing class's published figure is compared
       against the abatement computed here, independently of the engine, and the
       whole answer is refused if any of them disagrees. 37 significant digits,
       because the engine's ceiling is 38 (UV-W-4). */
    const mismatches: Array<{ classId: string; expectedMinor: string; publishedMinor: string }> = [];
    for (const s of prefStanding) {
      const expected = pariPassuPlan.abatedClaimByClassId[s.classId];
      const row = abatedPayouts.filter((q) => q.classId != null && String(q.classId) === s.classId)[0];
      const published = row ? String(row.total) : "0";
      if (expected === undefined || !agreesTo37SignificantDigits(expected, published)) {
        mismatches.push({ classId: s.classId, expectedMinor: String(expected), publishedMinor: published });
      }
    }
    const abatedTotal = abatedPayouts.reduce<Decimal>(
      (acc, p) => acc.plus(new MoneyDec(String(p.total))), new MoneyDec(0),
    ).plus(new MoneyDec(String(abatedOut.remainder)));
    const conserves = abatedTotal.eq(new MoneyDec(engineExitProceeds));
    if (mismatches.length > 0 || !conserves) {
      res.status(422).json({
        ok: false,
        error: "SENIORITY_RANKING_AMBIGUOUS",
        refusal: "seniority_ranking_ambiguous",
        refusalName: "seniority_ranking_ambiguous",
        field: "seniority",
        companyId,
        duplicateRanks: pariPassuDuplicateRanks,
        pariPassuReason: mismatches.length > 0 ? "abatement_not_reproduced" : "abatement_not_conserving",
        pariPassuMismatches: mismatches,
        exitProceedsMinor: engineExitProceeds,
        classes: prefRanked.map((p) => ({ roundId: p.classId, className: p.className, seniority: p.seniority })),
        message:
          `Capavate cannot publish an exit waterfall for this company. Two or more preference classes rank ` +
          `equally, the sale price does not cover everything they are owed, and the split Capavate computed ` +
          `did not survive its own check: the figures the calculation returned are not the figures the ` +
          `proportionate split requires, or they do not add up to the sale price exactly. Equally-ranked ` +
          `classes must each take a share in proportion to what they are owed, and Capavate will not publish ` +
          `a division of the money that it cannot prove. Please report this company and this sale price so it ` +
          `can be examined — a wrong split at an exit is worse than no split at all.`,
      });
      return;
    }

    payouts = abatedPayouts;
    engineRemainder = String(abatedOut.remainder);
    pariPassuAbated = true;
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 94 · ITEM 2 (R83.2, open item J-3) — THE RELEASED EXCESS, REDISTRIBUTED.
     ═══════════════════════════════════════════════════════════════════════════
     The full reasoning, the measured figures and the NVCA authority are on
     `buildCapRedistributionPlan` above. This block does four things and nothing
     else:

       1. compute the correct allocation in the CALLER, independently of the engine;
       2. compare it with what the engine has just published;
       3. if they already agree — which is EVERY cap table where no cap binds, and
          therefore every cap table that computed correctly before this wave — do
          NOTHING AT ALL, so not one byte moves;
       4. if they differ, hand the bound classes back to the UNMODIFIED engine as
          non-participating classes standing on their caps, publish the engine's own
          output, and REFUSE the whole answer if it does not reproduce the
          allocation exactly.

     WHEN NOTHING IS DONE, AND WHY THAT MATTERS MORE THAN WHAT IS. `capRewrite` is
     false unless a recorded cap actually BINDS and the correct figures differ from
     the published ones. A cap table with no cap on record produces no plan at all
     (`capsOnRecord` is false and the block is skipped), so Wave 88's 112-fixture
     census, Wave 79's 22 tests, `W74-R67-*`, `W75-*`, `W77-M1` and Wave 91's
     pari passu fixtures are untouched BY CONSTRUCTION, not by hope.

     THE PARI PASSU INTERACTION IS VERIFIED, NOT ASSUMED. Wave 91 argued
     structurally that abatement drives the residual to zero, so no cap can bind in
     an abating tier (`W91_PARI_PASSU.md` §4, recorded as UNVERIFIED in
     `W91_UNVERIFIED.md` · UV-W91-3 because a cap could not be expressed through
     this route at all). Now that it can, the argument is CHECKED on every request:
     when the abatement engaged, every capped standing class's published total must
     be at or below its cap, and the plan must find nothing bound. If either fails
     the answer is refused rather than published. */
  const capPlanClasses: CapPlanClass[] = (preferred as Array<Record<string, unknown>>).map((raw) => ({
    classId: String(raw.classId),
    className: String(raw.className),
    investedMinor: String(raw.invested),
    multiple: Number(raw.liquidationPreferenceMultiple),
    capMultiple:
      raw.participationCapMultiple === undefined || raw.participationCapMultiple === null
        ? null
        : Number(raw.participationCapMultiple),
    participating: raw.participating === true,
    shares: BigInt(String(raw.shares)),
    seniority: Number(raw.seniority),
    ledgerIndex: Number(raw.ledgerIndex),
  }));
  const capsOnRecord = capPlanClasses.some((c) => c.capMultiple !== null);
  let capRedistributed = false;
  let capPlanForResponse: CapRedistributionPlan | null = null;
  /* Published so a consumer can see whether the figures added up to the last digit
     or to the engine's declared 38-significant-digit ceiling. See the conservation
     note at the check below. `true` and `"0"` on every cap table that does not
     rewrite, because nothing was recomputed. */
  let capConservationExact = true;
  let capConservationResidualMinor = "0";

  if (capsOnRecord) {
    /* The converter set the ENGINE produced on the true, unabated terms — read off
       its own output exactly as Wave 91 reads it, never recomputed here (R21). */
    const engineConverters = capPlanClasses
      .filter((c) => {
        const rows = payouts.filter((q) => q.classId != null && String(q.classId) === c.classId);
        return rows.length === 0 || rows[0].decision === "as_converted";
      })
      .map((c) => c.classId);
    const commonForPlan = (settledCommonWithConvertibles as Array<Record<string, unknown>>).map((h) => ({
      holderId: String(h.holderId),
      shares: BigInt(String(h.shares)),
    }));
    const plan = buildCapRedistributionPlan(
      capPlanClasses,
      commonForPlan,
      engineConverters,
      engineExitProceeds,
    );
    if (plan === null) {
      /* Defence in depth on the maths, and honestly labelled as such: every claim
         reaching here came from `MoneyDec.toFixed()` and every multiple is fenced
         to `(0, 10]` by the ONE stored-terms reader, so this branch is unreachable
         with valid stored data. It exists because publishing a payout from a plan
         that could not be built is the one thing worse than refusing. */
      res.status(422).json({
        ok: false,
        error: "PARTICIPATION_CAP_NOT_COMPUTABLE",
        refusal: "participation_cap_not_computable",
        refusalName: "participation_cap_not_computable",
        field: "capParticipation",
        companyId,
        exitProceedsMinor: engineExitProceeds,
        message:
          `Capavate cannot publish an exit waterfall for this company. At least one preference class has a ` +
          `participation cap on record, and the ceiling that cap places on that class's proceeds could not ` +
          `be derived from the stored terms. A participation cap changes what every holder on the cap ` +
          `table receives, so Capavate refuses to publish a split rather than publish one computed as ` +
          `though the cap were not there. Please report this company and this sale price so it can be ` +
          `examined.`,
      });
      return;
    }
    capPlanForResponse = plan;

    /* Does the engine's published answer already match the correct allocation? */
    const capMismatches: Array<{ id: string; expectedMinor: string; publishedMinor: string }> = [];
    for (const [classId, expected] of Object.entries(plan.expectedTotalByClassId)) {
      const row = payouts.filter((q) => q.classId != null && String(q.classId) === classId)[0];
      const published = row ? String(row.total) : "0";
      if (!agreesTo37SignificantDigits(expected, published)) {
        capMismatches.push({ id: classId, expectedMinor: expected, publishedMinor: published });
      }
    }
    for (const [holderId, expected] of Object.entries(plan.expectedTotalByHolderId)) {
      const row = payouts.filter((q) => !q.classId && q.holderId != null && String(q.holderId) === holderId)[0];
      const published = row ? String(row.total) : "0";
      if (!agreesTo37SignificantDigits(expected, published)) {
        capMismatches.push({ id: holderId, expectedMinor: expected, publishedMinor: published });
      }
    }

    if (capMismatches.length > 0 && pariPassuAbated) {
      /* Wave 91's structural argument says this cannot happen: an abating tier
         leaves a zero residual, so no cap can bind and the plan cannot differ.
         It is CHECKED rather than trusted, and a failure refuses. */
      res.status(422).json({
        ok: false,
        error: "PARTICIPATION_CAP_NOT_REPRODUCED",
        refusal: "participation_cap_not_reproduced",
        refusalName: "participation_cap_not_reproduced",
        field: "capParticipation",
        companyId,
        capReason: "abated_tier_cap_interaction",
        capMismatches,
        capBound: plan.bound,
        exitProceedsMinor: engineExitProceeds,
        message:
          `Capavate cannot publish an exit waterfall for this company. Two or more preference classes rank ` +
          `equally and the sale price does not cover everything they are owed, AND at least one of them has ` +
          `a participation cap on record. Those two terms interacted in a way this calculation did not ` +
          `expect, so the figures it produced are not the figures the terms require. A wrong split at an ` +
          `exit is worse than no split at all. Please report this company and this sale price so it can be ` +
          `examined.`,
      });
      return;
    }

    if (capMismatches.length > 0) {
      /* ── THE REWRITE PASS. Every bound class becomes a NON-PARTICIPATING class
         standing on `invested = its cap` at a multiple of 1, so the engine pays it
         exactly its cap and leaves its shares out of both the participation
         denominator and the common pool — which is what "no longer entitled to
         share" means. Everything else keeps its true recorded terms, INCLUDING its
         own cap, so a cap that does not bind still cannot be exceeded and the check
         below still has something to catch.

         A class the cap forced to CONVERT is handed `invested: "0"` and
         `participating: false`, exactly as Wave 91 hands a converter, so it keeps
         its shares and is paid out of the residual as common-equivalent.

         RANKS ARE NOT SYNTHESISED. Wave 91's abatement pass had to renumber
         seniority because abated claims inside one tier are not what the engine's
         sequential clamp would pay. Here the total of the preferences handed over
         is `Σ claims of the unbound + Σ caps of the bound`, which is at most the
         exit (each bound class's cap equals its preference plus a slice of a
         residual that exists), so no clamp can bite and the recorded ranks are
         passed through untouched. */
      const boundSet = new Set<string>(plan.bound);
      const convSet = new Set<string>(plan.converters);
      const cappedPreferred = (preferred as Array<Record<string, unknown>>).map((raw) => {
        const classId = String(raw.classId);
        const out: Record<string, unknown> = { ...raw };
        if (convSet.has(classId)) {
          out.invested = "0";
          out.participating = false;
          delete out.participationCapMultiple;
          return out;
        }
        if (boundSet.has(classId)) {
          const inv = parseExactMoney(raw.invested);
          const capMultiple = Number(raw.participationCapMultiple);
          if (inv === null || !Number.isFinite(capMultiple)) return out;
          out.invested = new EngineMatchDec(inv.toFixed())
            .mul(new EngineMatchDec(String(capMultiple))).toFixed();
          out.liquidationPreferenceMultiple = 1;
          out.participating = false;
          delete out.participationCapMultiple;
          return out;
        }
        return out;
      }) as unknown[];

      let cappedResult: unknown;
      try {
        cappedResult = computeWaterfall({
          exitProceeds: engineExitProceeds,
          preferred: cappedPreferred,
          common: settledCommonWithConvertibles,
          formulaId,
          formulaVersion: "v25.0",
          region: "US" as const,
          formulaDef: { preferredReturnPct: lpPct, exitMinor },
        } as never);
      } catch (err) {
        log.warn("[track1/waterfall] participation cap compute failed:", (err as Error).message);
        res.status(422).json({ ok: false, error: "WATERFALL_COMPUTE_ERROR", message: (err as Error).message }); return;
      }
      const cappedOut = cappedResult as { payouts: unknown[]; remainder: string };
      const cappedPayouts = cappedOut.payouts as Array<{
        classId?: string; holderId?: string; className?: string;
        total: string; decision: string;
      }>;

      /* ══ THE PUBLISHED FIGURE IS CHECKED, NOT TRUSTED — WAVE 91'S NET, EXTENDED
         TO CAPS. Every row is compared against the allocation computed above, and
         `Σ payouts + remainder` must equal the exit EXACTLY. Conservation is
         necessary and NOT sufficient: this project shipped a waterfall that added
         up perfectly for the wrong exit value. Both are asserted. */
      const postMismatches: Array<{ id: string; expectedMinor: string; publishedMinor: string }> = [];
      for (const [classId, expected] of Object.entries(plan.expectedTotalByClassId)) {
        const row = cappedPayouts.filter((q) => q.classId != null && String(q.classId) === classId)[0];
        const published = row ? String(row.total) : "0";
        if (!agreesTo37SignificantDigits(expected, published)) {
          postMismatches.push({ id: classId, expectedMinor: expected, publishedMinor: published });
        }
      }
      for (const [holderId, expected] of Object.entries(plan.expectedTotalByHolderId)) {
        const row = cappedPayouts.filter((q) => !q.classId && q.holderId != null && String(q.holderId) === holderId)[0];
        const published = row ? String(row.total) : "0";
        if (!agreesTo37SignificantDigits(expected, published)) {
          postMismatches.push({ id: holderId, expectedMinor: expected, publishedMinor: published });
        }
      }
      const cappedTotal = cappedPayouts.reduce<Decimal>(
        (acc, p) => acc.plus(new MoneyDec(String(p.total))), new MoneyDec(0),
      ).plus(new MoneyDec(String(cappedOut.remainder)));
      /* ══ CONSERVATION, AND THE ONE PLACE THIS WAVE COULD NOT ASSERT IT EXACTLY.
         MEASURED, not assumed. On `W94-CAP-04` — two caps binding at 2x and 1.5x
         beside an uncapped class — the residual price per share is 3,050,000,000 ÷
         9,000,000, which does not terminate. The engine emits each row rounded
         HALF_EVEN at its declared 38 significant digits, and on this fixture the
         roundings do NOT cancel, so `Σ payouts + remainder` differs from the exit
         in about the 38th significant digit: measured
         `conservationResidualMinor` of order 1e-29 minor units, which is roughly a
         hundred-thousandth of a trillionth of a cent.

         WHY THIS IS NOT A WEAKENING OF WAVE 91'S CHECK. Wave 91's abatement path
         asserts EXACT conservation and still does, untouched — an abating tier
         consumes the whole budget, so its figures either terminate or their
         roundings cancelled on every fixture it measured. A binding cap leaves a
         LIVE residual to divide, so a non-terminating price is ordinary here rather
         than exceptional. `spec/UNVERIFIED_WATERFALL.md` · UV-W-4 asked for exactly
         37 significant digits for precisely this reason: a pin on the full string
         goes red on a rounding artefact and hides a real regression instead of
         catching it. A REAL failure of conservation moves whole minor units, not the
         38th digit, and 37 significant digits catches it with 1e29 to spare.

         AND IT IS DISCLOSED, NOT ABSORBED. `conservationExact` and the measured
         `conservationResidualMinor` are both published on every response, so a
         consumer can see whether the figures it is reading added up to the last
         digit or to the engine's ceiling. Nothing is hidden inside a tolerance. */
      const conservationResidual = cappedTotal.minus(new MoneyDec(engineExitProceeds));
      const cappedConservesExactly = conservationResidual.isZero();
      const cappedConserves = agreesTo37SignificantDigits(cappedTotal.toFixed(), engineExitProceeds);
      capConservationExact = cappedConservesExactly;
      capConservationResidualMinor = conservationResidual.toFixed();

      /* ══ WAVE 100 · ITEM 2 — AND NOW AGAINST THE VALUE THE CALLER SUBMITTED,
         NOT ONLY AGAINST THIS ROUTE'S OWN RECOMPUTATION.
         REVIEWER A DEFEATED THE CHECK ABOVE, and this is how. Every figure in it —
         `cappedTotal`, `plan.expectedTotal*`, `engineExitProceeds` — is derived from
         the exit AFTER it has already been rounded to the arithmetic's ceiling, so a
         request that lost a minor unit on the way IN is perfectly self-consistent on
         the way OUT: `Σ payouts + remainder` equalled `engineExitProceeds` exactly,
         the check passed, and the route published a split of 10^41 when the caller
         asked for 10^41 − 1 (`transcripts/10_cap41_result.txt`, difference +1).
         A self-check that only ever compares a computation with itself cannot catch
         an input that was changed before the computation began.

         SO THE SUBMITTED FIGURE IS NOW A TERM IN THE CHECK. `exitMinor` is the
         caller's own value, parsed exactly and never rounded (Wave 86B), and any
         convertible cash-out taken off the top is added back, because those minor
         units are paid too. The tolerance is ABSOLUTE, not relative: a relative
         tolerance is precisely what let this through (one unit in 10^41 is 1e-41
         relatively, far inside 37 significant digits) while the money at stake was a
         whole payable cent. Below one minor unit is the engine's documented
         non-terminating-price residual and is DISCLOSED on the response; one minor
         unit or more is money, and money is refused. */
      const cappedCashOutTotal = Object.keys(cashOutPaid).reduce<Decimal>(
        (acc, h) => acc.plus(new MoneyDec(String(cashOutPaid[h]))), new MoneyDec(0),
      );
      const cappedVsSubmitted = cappedTotal.plus(cappedCashOutTotal).minus(new MoneyDec(exitMinor));
      const cappedReproducesSubmitted = cappedVsSubmitted.abs().lt(new MoneyDec(1));

      if (postMismatches.length > 0 || !cappedConserves || !cappedReproducesSubmitted) {
        res.status(422).json({
          ok: false,
          error: "PARTICIPATION_CAP_NOT_REPRODUCED",
          refusal: "participation_cap_not_reproduced",
          refusalName: "participation_cap_not_reproduced",
          field: "capParticipation",
          companyId,
          capReason:
            postMismatches.length > 0
              ? "allocation_not_reproduced"
              : !cappedConserves
                ? "allocation_not_conserving"
                : "allocation_does_not_reproduce_submitted_exit",
          conservationResidualMinor: capConservationResidualMinor,
          /* WAVE 100 · ITEM 2 — the residual against the SUBMITTED sale price, which
             is the term reviewer A's counterexample moved and the older one did not. */
          submittedExitValuationMinor: exitMinor,
          residualAgainstSubmittedExitMinor: cappedVsSubmitted.toFixed(),
          capMismatches: postMismatches,
          capBound: plan.bound,
          capConverters: plan.converters,
          exitProceedsMinor: engineExitProceeds,
          message:
            `Capavate cannot publish an exit waterfall for this company. At least one preference class has ` +
            `a participation cap that binds on this sale price, and the split Capavate computed did not ` +
            `survive its own check: the figures the calculation returned are not the figures the capped ` +
            `terms require, or they do not add up to the sale price exactly. When a cap binds, the ` +
            `participation the capped class no longer receives belongs to the other classes still sharing ` +
            `— and Capavate will not publish a division of the money that it cannot prove. Please report ` +
            `this company and this sale price so it can be examined; a wrong split at an exit is worse ` +
            `than no split at all.`,
        });
        return;
      }

      payouts = cappedPayouts;
      engineRemainder = String(cappedOut.remainder);
      capRedistributed = true;
    }
  }


  /* Each convertible's settled payout: the engine's own exact decimal for a
     converter, and the cash-out amount for a holder who took the money back. */
  for (const c of convertibleLeg) {
    if (cashOutElected[c.holderId]) {
      c.election = "cash_out";
      c.electionBasis =
        `The money-back amount (${c.cashOutFloorMinor} minor units) is greater than or equal to the ` +
        `as-converted value on this exit, so this holder takes its purchase amount. A tie resolves to ` +
        `the money-back amount. It is paid ahead of the equity and the remaining ${engineExitProceeds} ` +
        `minor units are distributed by the waterfall.`;
      c.proceeds = String(cashOutPaid[c.holderId] ?? c.cashOutFloorMinor);
      c.proceedsExact = c.proceeds;
    } else {
      const hit = payouts.filter((p) => !p.classId && p.holderId != null && String(p.holderId) === c.holderId)[0];
      c.election = "as_converted";
      c.electionBasis =
        `The as-converted value is greater than the money-back amount (${c.cashOutFloorMinor} minor ` +
        `units), so this holder converts and is paid on ${c.convertedShares} shares.`;
      c.proceeds = hit ? String(hit.total) : "0";
      c.proceedsExact = c.proceeds;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 75 · ITEM 3 — WHERE AN EXACT DECIMAL BECAME A FLOAT (W74 finding N-4).
     ═══════════════════════════════════════════════════════════════════════════
     THE DEFECT, measured. `W74-R67-C` expected $33,333,333.33 of founder proceeds
     and got `3333333333.3333335` minor units — a third of a cent of IEEE-754
     residue on a payout figure. THE ENGINE IS NOT AT FAULT: every `payouts[].total`
     is an EXACT decimal string produced by `packages/cap-table-engine/src/waterfall/
     liquidationWaterfall.ts` through `primitives/bigDecimal.ts`, which locks
     decimal.js at 38 significant digits. **The boundary where the exactness was
     lost is `Number(p.total)` in these three reducers**, and that is where it is
     fixed — not with a display-layer round, which would hide it and let the next
     consumer inherit it.

     WHAT THIS FIXES AND WHAT IT HONESTLY CANNOT. Summing in decimal.js removes all
     ACCUMULATION error: n payouts now add up exactly, whatever n is. It cannot make
     a JSON `number` hold a non-terminating decimal — one third of $100,000,000 is
     `3333333333.333…` and no IEEE-754 double is that value. So the exact figure is
     ALSO emitted, as a string, on the additive `*Exact` fields below, and THOSE are
     the authoritative money values. The legacy numeric fields keep their name,
     their position and their meaning (removing them would be a silent drop) and now
     carry the closest double to the EXACT sum rather than the closest double to a
     float accumulation. NO MONEY MOVED in this wave: the numeric fields are
     unchanged to the last representable digit on the documented fixture, which is
     why `W74-R67-C` still passes untouched. Whether the numeric field should instead
     be integer-allocated to whole minor units — `server/lib/money.ts::
     allocateResidualCents`, the platform's declared largest-remainder allocator — is
     an OWNER QUESTION (W75 Q-C), because it WOULD move a founder's reported figure
     by a third of a cent and R67 condition 3 says founder money moves once, in one
     measured step.

     ════════════════════════════════════════════════════════════════════════
     WAVE 77 · R72 — THE PARAGRAPH ABOVE IS NOW SUPERSEDED, AND SAYS SO.
     ════════════════════════════════════════════════════════════════════════
     Wave 75 was correct that a JSON `number` cannot hold `33,333,333.333…`, and it
     recorded that as open item J-1. The owner answered with R72: **carry the money
     as exact decimal text — an authorised INTERFACE CHANGE.** So the four money
     fields on this response (`lpProceeds`, `founderProceeds`,
     `byShareClass[].proceeds`, `breakpoints[].exitMinor`) are now the engine's own
     exact decimal strings, and the `*Exact` fields Wave 75 added REMAIN, emitting
     byte-identical values, as aliases — removing them would be a silent drop for
     any consumer Wave 75 told to read them.

     ONE FORMAT, NOT TWO (R72 condition 2): the representation is exactly the one
     the engine already uses for share counts and prices — a decimal string,
     unrounded, unformatted, no exponent, no thousands separators, no currency
     symbol. NOTHING IS ROUNDED HERE (R72 condition 3): any rounding belongs at a
     display layer, once, with the convention stated, and no screen renders this
     figure yet (R72 condition 5 — the reason the change is cheap now).
     NO `Number(...)` ON A MONEY STRING (R72 condition 4), policed as source text by
     `W77-M4` in `server/__tests__/w77_maturity_convergence_and_exact_money.test.ts`.
     Every consumer was enumerated BEFORE this edit:
     `build_log/wave77/W77_MONEY_CONSUMERS.md`. */
  /* WAVE 86B · ITEM 1 — THE "EXACT" SUMMER WAS NOT EXACT ABOVE 20 SIGNIFICANT
     DIGITS. `new Decimal(...)` here was the BARE GLOBAL instance at precision 20,
     so `plus()` rounded the RESULT and a 38-digit sum was destroyed inside the
     summer. `MoneyDec` is a module-local `Decimal.clone` at precision 80 — the
     global instance the SACRED engine imports is untouched, and `Decimal.set` is
     still called nowhere in this file. The signature text is unchanged so the
     `W77-M3` pin on it stays green, and `MoneyDec` instances are typed `Decimal`
     so tsc is unaffected. */
  const exactSum = (rows: Array<{ total: string }>): Decimal =>
    rows.reduce<Decimal>((acc, p) => acc.plus(new MoneyDec(String(p.total))), new MoneyDec(0));

  const lpProceedsExactDec = exactSum(payouts.filter((p) => p.classId));
  /* WAVE 77 · R72 — EXACT DECIMAL TEXT, not a double. `.toNumber()` was the
     narrowing; `.toFixed()` with no argument emits the Decimal's full precision
     and rounds NOTHING (R72 condition 3). See the block above `res.json`. */
  const lpProceeds = lpProceedsExactDec.toFixed();
  /* ── WAVE 71b — THE COMMON LEG WAS BEING REPORTED AS ZERO ──────────────────
     Wave 71's D11(3) stopped emitting the invented `founder_common` aggregate and
     started pushing the company's REAL common holders, each under its own
     `holderId` from `readCompanyCommonRows`. This summary was left filtering on the
     literal `"founder_common"`, an id the route can no longer produce, so
     `founderProceeds` became structurally 0 on every response. Measured on a
     correct fixture (one 1x non-participating JPY class, 8,000,000 real common
     shares, exit 2,000,000 minor): the engine paid 1,000,000 to the preference and
     1,000,000 to common, and this line reported the common 1,000,000 as `0`.

     THE FIX IS TO SUM THE LEG, NOT A NAME. Every id in `common` above is a
     holder of the common leg by construction, so the leg is exactly the payouts
     carrying one of those ids. `founder_common` is kept in the accepted set so the
     figure still adds up if any path ever emits the aggregate again — it is a
     fallback, not the selector. D11's refusal guarantees `common` is non-empty
     whenever this line runs. */
  const commonLegHolderIds = new Set<string>([
    "founder_common",
    ...common.map((c) => String((c as { holderId: unknown }).holderId)),
  ]);
  /* WAVE 75 · ITEM 3 — exact, for the reasons in the block above. The SELECTOR is
     byte-for-byte Wave 71b's; only the arithmetic changed. */
  const founderProceedsExactDec = exactSum(
    payouts.filter((p) => !p.classId && p.holderId != null && commonLegHolderIds.has(String(p.holderId))),
  );
  /* WAVE 77 · R72 — the figure the ruling was issued about. `.toNumber()` here is
     what rendered `3333333333.3333335`: one third of $100,000,000 is a
     non-terminating decimal and NO IEEE-754 double is that value. `.toFixed()`
     carries every digit the engine computed, exactly as the engine already does
     for share counts and prices. */
  const founderProceeds = founderProceedsExactDec.toFixed();

  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 88 · THE THIRD LEG, AND THE COMMON LEG ATTRIBUTED PER HOLDER.
     ═══════════════════════════════════════════════════════════════════════════
     `founderProceeds` above is, and always was, THE TOTAL OF THE COMMON LEG — not
     the founders' share of it. On a cap table carrying a non-founder common holder
     those are different figures, and reporting the first under the second's name
     overstated the founders by $16,666,666.67 on the census fixture. The name is
     KEPT (removing it is a silent drop for the tests and the e2e caller that read
     it — OQ-R67-5) and the truth is ADDED: `commonLegProceeds` as a byte-identical
     alias that says what the figure is, and `byCommonHolder[]` for the split.

     Exactness rule unchanged: `exactSum` is still the ONE place a leg is added, in
     `Decimal`, `.toFixed()` with no argument, and no `Number()` on a money string. */
  const convertibleProceedsExactDec = convertibleLeg.reduce<Decimal>(
    (acc, c) => acc.plus(new Decimal(c.proceeds)), new Decimal(0),
  );
  const convertibleProceeds = convertibleProceedsExactDec.toFixed();

  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 91 · ITEM 3 — A HOLDER PAID $0 IS NAMED. BEING ABSENT IS A DEFECT.
     ═══════════════════════════════════════════════════════════════════════════
     THE DEFECT, measured on three scenarios and reproduced on three independent
     instruments (`spec/preflight_waterfall_evidence/20_three_instrument_
     reconciliation.txt`: `S2`, `S8s`, `S9` — all `engine=ABSENT` vs `reference=0`).
     The SACRED engine's Step 2 is gated on `sharesInPool > 0n && remaining.gt(0)`,
     so when the sale price does not reach the common leg it emits **no row at all**
     for a common holder rather than a `$0` row. This list was built by FILTERING
     `payouts`, so on a short exit it was `[]` — and the founders vanished from the
     answer entirely.

     THIS IS THE SAME DEFECT CLASS WAVE 88 REMOVED, ARRIVING FROM THE OTHER SIDE. A
     $10,000,000 SAFE holder was paid $0 and never named; a founder paid $0 was not
     named either. Being told you receive nothing is a fact. Being absent is a
     defect — a reader cannot tell "nothing" from "not considered".

     THE LIST IS NOW DRIVEN BY THE CAP TABLE, NOT BY THE PAYOUT ROWS. One row per
     holder in `commonRows`, in the cap table's own order, joined to the engine's
     figure where there is one and showing an explicit `"0"` where there is not.
     Nothing moved: the arithmetic is untouched, `founderProceeds` /
     `commonLegProceeds` are still `exactSum` over the engine's OWN rows, and on
     every cap table that reached the common leg the rows, their order and their
     figures are byte-identical to Wave 88's. What changed is that a holder can no
     longer disappear. `emittedByEngine` says which of the two happened, on the
     payload, where a machine-readable flag belongs (R77). */
  const byCommonHolder = commonRows.map((row) => {
    const hit = payouts.filter(
      (p) => !p.classId && p.holderId != null && String(p.holderId) === row.holderId,
    )[0];
    return {
      holderId: row.holderId,
      holderName: row.holderId,
      shares: row.shares,
      /* ONE MONEY FORMAT: the engine's own exact decimal string, unrounded, and
         the `*Exact` sibling byte-identical to it, exactly as `byShareClass`
         already does. `"0"` is this route's own figure, and it is a FIGURE — it is
         not a placeholder and it is not a missing value. */
      proceeds: hit ? String(hit.total) : "0",
      proceedsExact: hit ? String(hit.total) : "0",
      decision: hit ? hit.decision : "no_proceeds_reached_common",
      emittedByEngine: hit !== undefined,
      /* Why the figure is zero, in plain English, so a screen never has to invent
         the sentence and two screens cannot word it differently. */
      basis: hit
        ? null
        : `The sale price did not reach the common shares: the preference claims ranking ahead of them ` +
          `absorbed all of it, so this holder receives nothing on this sale. The shares are on the cap ` +
          `table and the holding is unaffected — it is this sale price that pays them nothing.`,
    };
  });
  /* AND NOTHING THE ENGINE PAID IS DROPPED ON THE WAY. Wave 71b kept the legacy
     `founder_common` aggregate id in the leg's accepted set as a FALLBACK, so a
     row could in principle be paid under an id that is not on `commonRows`.
     Driving the list from the cap table would have silently dropped such a row —
     the exact defect class this item exists to close — so any paid leg row without
     a cap-table holder is appended rather than lost. */
  for (const p of payouts) {
    if (p.classId || p.holderId == null) continue;
    const hid = String(p.holderId);
    if (!commonLegHolderIds.has(hid)) continue;
    if (commonRows.filter((r) => r.holderId === hid).length > 0) continue;
    byCommonHolder.push({
      holderId: hid, holderName: hid, shares: null as unknown as string,
      proceeds: String(p.total), proceedsExact: String(p.total),
      decision: p.decision, emittedByEngine: true, basis: null,
    });
  }
  const commonLegShares = commonRows.reduce<Decimal>(
    (acc, r) => acc.plus(new Decimal(r.shares)), new Decimal(0),
  ).toFixed();

  const byConvertible = convertibleLeg.map((c) => ({
    roundId: c.roundId,
    className: c.className,
    instrument: c.instrument,
    holderName: c.holderName,
    holderId: c.holderId,
    convention: c.convention,
    purchaseAmountMinor: c.purchaseAmountMinor,
    valuationCapMinor: c.valuationCapMinor,
    convertedShares: c.convertedShares,
    convertedSharesUnrounded: c.convertedSharesUnrounded,
    cashOutFloorMinor: c.cashOutFloorMinor,
    election: c.election,
    electionBasis: c.electionBasis,
    proceeds: c.proceeds,
    proceedsExact: c.proceedsExact,
    conversionBasis: c.conversionBasis,
  }));

  /* ══ WAVE 91 · ITEM 3, SECOND HALF — A PREFERENCE CLASS PAID $0 IS NAMED TOO. ══
     The same engine gate that hides a $0 common holder hides a preference class
     that elected to convert on a sale which then left nothing to convert INTO: its
     row is only pushed inside `sharesInPool > 0n && remaining.gt(0)`. Driving this
     list from the company's own preference stack rather than from the payout rows
     means every class on the cap table appears exactly once, in ledger order, with
     an explicit `"0"` where the engine emitted nothing. On every cap table that
     computes today every class already has a row, so this list is byte-identical
     there — it can only ever ADD a line that was missing.

     AND THE DECISION IS LABELLED TRUTHFULLY. When pari passu abatement engaged, the
     class was handed to the engine as participating-with-no-cap so that the engine
     could not re-elect it (see WAVE 91 · ITEM 2), and the engine therefore labels
     the row `preference_then_participate`. That is the mechanism, not the term the
     class negotiated. `decision` states what happened — an abated preference — and
     `engineDecision` keeps the engine's own word beside it, so nothing is hidden
     and nothing is misdescribed. */
  /* ORDER IS PRESERVED EXACTLY. The rows the engine paid keep the engine's own
     order — so every response that computes today is byte-identical, key order
     included — and a class the engine emitted no row for is APPENDED, in ledger
     order. A reordered list would be a silent change to a published contract. */
  const byShareClassOrder: string[] = [];
  for (const p of payouts) {
    if (p.classId == null) continue;
    const cid = String(p.classId);
    if (byShareClassOrder.indexOf(cid) === -1) byShareClassOrder.push(cid);
  }
  for (const s of prefRanked) {
    if (byShareClassOrder.indexOf(s.classId) === -1) byShareClassOrder.push(s.classId);
  }
  const byShareClass = byShareClassOrder
    .map((cid) => prefRanked.filter((q) => q.classId === cid)[0])
    .filter((s) => s !== undefined)
    .map((s) => {
      const hit = payouts.filter((q) => q.classId != null && String(q.classId) === s.classId)[0];
      const abatedRow = pariPassuAbated
        ? prefStanding.filter((q) => q.classId === s.classId).length > 0 &&
          pariPassuPlan !== null &&
          pariPassuPlan.tiers.filter(
            (t) => t.abated && t.classes.filter((c) => c.classId === s.classId).length > 0,
          ).length > 0
        : false;
      const p = hit ?? {
        classId: s.classId, className: s.className, total: "0",
        decision: "no_proceeds_after_senior_claims",
      };
      return {
      classId: p.classId,
      className: p.className ?? p.classId,
      /* WAVE 77 · R72 — `Number(p.total)` was here. The engine's `total` IS
         already an exact decimal string, so the correct code is to pass it
         through untouched: no parse, no format, no rounding. The field keeps its
         name and its position (no silent drop) and now carries the same
         representation as its `proceedsExact` sibling, so there is ONE money
         format on this response rather than two. */
      proceeds: String(p.total),
      /* WAVE 75 · ITEM 3 — retained as an ALIAS, byte-identical to `proceeds`
         above. Removing it would be a silent drop for any consumer Wave 75 told
         to read it. */
      proceedsExact: String(p.total),
      decision: abatedRow ? "preference_abated_pari_passu" : p.decision,
      engineDecision: hit ? hit.decision : null,
      emittedByEngine: hit !== undefined,
      /* The class's OWN recorded terms, echoed beside the figure, so a reader never
         has to infer them from the shape of the answer. */
      seniority: s.seniority,
      seniorityOnRecord: s.seniorityOnRecord,
      participatingOnRecord: s.participating,
      liquidationPreferenceMultiple: s.liquidationPreferenceMultiple,
      investedMinor: s.invested,
      claimMinor: pariPassuClaimMinor(s.invested, s.liquidationPreferenceMultiple),
      abated: abatedRow,
      };
    });

  // Compute breakpoints: at what exit value LP and founder proceeds cross
  const breakpoints: Array<{ exitMinor: string; description: string }> = [
    {
      /* WAVE 75 · ITEM 3 — the same quantity as `lpProceeds`, so it is now the same
         exact value rather than a second float sum of the same rows.
         WAVE 77 · R72 — and therefore the same REPRESENTATION: it is assigned from
         `lpProceeds`, which is now exact decimal text. A number here beside a
         string there would be the second money format R72 condition 2 forbids. */
      exitMinor: lpProceeds,
      description: "liquidation_preference_covered",
    },
  ];

  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 100 · ITEM 1 — `conservationExact` NOW STATES WHAT WAS MEASURED.
     ═══════════════════════════════════════════════════════════════════════════
     THE DEFECT, and it is the root of this wave. `capConservationExact` was
     INITIALISED to `true` and `capConservationResidualMinor` to `"0"`, and only the
     cap-REWRITE branch ever summed anything. Every other response — which is almost
     every response — therefore published a claim about arithmetic that nothing had
     performed. Reviewer A re-summed all 200 bodies of the 28-scenario HTTP probe
     independently and found FIVE ordinary-size responses whose legs did NOT add to
     the sale price while the payload said they did
     (`final_review_2026_08_21/reviewerA/transcripts/06_independent_conservation_check.txt`):
     `+4E-29`, `-3E-29`, `-8E-29`, `+1E-28`, `-4E-29`, each beside
     `conservationResidualMinor: "0"` and `conservationExact: true`.

     A FIELD NAMED `conservationExact` READING `true` WHEN THE SUM DOES NOT CONSERVE
     IS A LIE IN A MONEY API. It is also the field the screen keys off: Wave 92's
     residual disclosure is rendered only in the `false` branch, so the false `true`
     SUPPRESSED the one sentence that would have told a reader the figures are carried
     to a ceiling. Nothing about the arithmetic is changed here and no money moves —
     the legs are byte-identical — the RESPONSE STOPS ASSERTING SOMETHING FALSE.

     WHAT IS SUMMED, precisely: every payout row the engine emitted, plus the
     engine's own remainder, plus any convertible cash-out paid off the top, against
     the SUBMITTED sale price. On the `MoneyDec` clone at precision 80, so the
     measurement cannot itself round (Wave 86B), and `Decimal.set` is still called
     nowhere in this file.

     AND THE MEASUREMENT IS ALSO A REFUSAL. Below one minor unit the residual is the
     engine's documented 38-significant-digit rounding of a non-terminating price and
     is DISCLOSED. One minor unit or more is payable money that does not add up, and
     this route will not publish it — the same rule as the cap self-check above,
     applied to every branch rather than one. */
  const publishedCashOutTotalDec = Object.keys(cashOutPaid).reduce<Decimal>(
    (acc, h) => acc.plus(new MoneyDec(String(cashOutPaid[h]))), new MoneyDec(0),
  );
  const publishedTotalDec = exactSum(payouts)
    .plus(new MoneyDec(engineRemainder))
    .plus(publishedCashOutTotalDec);
  const measuredConservationResidualDec = publishedTotalDec.minus(new MoneyDec(exitMinor));
  const measuredConservationExact = measuredConservationResidualDec.isZero();
  const measuredConservationResidualMinor = measuredConservationResidualDec.toFixed();
  if (measuredConservationResidualDec.abs().gte(new MoneyDec(1))) {
    res.status(422).json({
      ok: false,
      error: "WATERFALL_ALLOCATION_NOT_CONSERVING",
      refusal: "waterfall_allocation_not_conserving",
      refusalName: "waterfall_allocation_not_conserving",
      field: "exitValuationMinor",
      companyId,
      submittedExitValuationMinor: exitMinor,
      publishedTotalMinor: publishedTotalDec.toFixed(),
      conservationResidualMinor: measuredConservationResidualMinor,
      precisionCeilingSignificantDigits: String(precisionCeilingSignificantDigits),
      message:
        `Capavate cannot publish an exit waterfall for this company. The payouts it computed add up to ` +
        `${publishedTotalDec.toFixed()} minor units against a sale price of ${exitMinor} — a difference ` +
        `of ${measuredConservationResidualMinor}, which is at least one whole unit of currency and ` +
        `therefore money somebody would be paid or not paid. Capavate refuses to publish a division of ` +
        `the money that does not add up to the sale price. Please report this company and this sale ` +
        `price so it can be examined; a wrong split at an exit is worse than no split at all.`,
    });
    return;
  }

  /* WAVE 88 — the bridge payload gains the convertible leg. It has NO
     non-snapshot consumer (`spec/preflight_r67_evidence/15_consumer_census.txt`),
     so this is a disclosure rather than a contract break, and a subscriber that
     read only `founderProceeds` would otherwise inherit the same mislabelling the
     response has now stopped publishing. */
  emitBridge("captable.waterfall.computed", companyId, "company", {
    companyId, exitMinor, lpProceeds, founderProceeds,
    convertibleProceeds, commonLegProceeds: founderProceeds,
  });

  res.json({
    ok: true,
    lpProceeds,
    founderProceeds,
    /* WAVE 75 · ITEM 3 — ADDITIVE, and the authoritative money figures. The engine's
       own exact decimals, carried as strings so a consumer inherits exactness instead
       of a float. Nothing was removed: `lpProceeds` and `founderProceeds` keep their
       names, their order and their meaning. */
    /* WAVE 77 · R72 — ALIASES NOW, not a second representation: byte-identical to
       `lpProceeds` / `founderProceeds` above. Kept because Wave 75 published them
       as the authoritative fields and a consumer may already read them. */
    lpProceedsExact: lpProceedsExactDec.toFixed(),
    founderProceedsExact: founderProceedsExactDec.toFixed(),
    byShareClass,
    breakpoints,
    /* WAVE 74 · R67 — every committed round that is not a preference class,
       named on the response. NO SILENT DROPS. */
    nonPreferenceClasses,
    /* ════════════════════════════════════════════════════════════
       WAVE 88 — ADDITIVE ONLY. NOTHING ABOVE WAS REMOVED, RENAMED OR MOVED.
       ════════════════════════════════════════════════════════════
       `founderProceeds`, `lpProceeds`, both `*Exact` aliases, `byShareClass`,
       `breakpoints`, `nonPreferenceClasses`, `seniority` and `seniorityAssumed` all
       keep their names, their positions and their meanings. Every key below is new,
       and every one of them is ALWAYS PRESENT so a consumer never has to tell
       "none" apart from "an older build". */
    convertibleProceeds,
    convertibleProceedsExact: convertibleProceedsExactDec.toFixed(),
    /* THE INSTRUMENT THAT USED TO BE PAID $0 AND NEVER NAMED. Each entry carries
       its own holder, its purchase amount, its cap, the convention taken from the
       round's instrument value, the converted share count with its unrounded
       original, the money-back floor it was compared against, which of the two it
       took and WHY. */
    byConvertible,
    /* THE COMMON LEG, ATTRIBUTED. `founderProceeds` is this leg's TOTAL; these are
       the holders it is made of. */
    byCommonHolder,
    commonLegProceeds: founderProceeds,
    commonLegShares,
    /* WAVE 88 — what this waterfall did NOT pay, and the facts that are missing.
       A disclosed exclusion is a stated limitation; a silent $0 is the
       indefensible case, and there are none left on this route. */
    excludedFromPayout,
    /* The modelling choice a cash-out election rests on, stated on the response
       rather than left in the source. Empty when nothing cashed out. */
    convertibleCashOutBasis: byConvertible.filter((c) => c.election === "cash_out").length > 0
      ? "A convertible holder that takes its money back is paid ahead of the equity, out of the exit " +
        "proceeds, before the preference stack and the common leg. No ranking between a convertible's " +
        "money-back claim and a preferred class is on record anywhere on this platform, so this ordering " +
        "is Capavate's stated model rather than a recorded term."
      : null,
    /* The engine's own leftover after every leg. Zero on a well-formed cap table;
       published so a consumer can see it is zero rather than trust that it is. */
    remainder: engineRemainder,
    /* WAVE 79 · ITEM 2 — the seniority ranking, DISCLOSED. Either every class's
       recorded rank is echoed back so a consumer can see which order produced
       these figures, or — for a single-class company, where no ranking can change
       anything — the assumption is stated in words. It is never silently derived.
       Always present, so a consumer never has to guess whether an absent key means
       "none" or "an older build" (the R67 rule this route already follows for
       `nonPreferenceClasses`). */
    seniority: prefRanked.map((p) => ({
      roundId: p.classId, className: p.className,
      seniority: p.seniority, onRecord: p.seniorityOnRecord,
    })),
    seniorityAssumed,
    /* ═══════════════════════════════════════════════════════════════
       WAVE 91 · ITEMS 1 AND 2 — THE ABATEMENT, PUBLISHED SO IT CAN BE CHECKED.
       ═══════════════════════════════════════════════════════════════
       ADDITIVE, and ALWAYS PRESENT so a consumer never has to tell "no pari passu
       tier" apart from "an older build". An investor asked to accept 60% of what
       they are owed is entitled to see the three numbers that produced the 60%:
       what the tier was owed in total, what was available to it, and the factor.
       Every figure here is exact decimal text, unrounded — no `Number()`, no
       `.toFixed(<digits>)`, one money format (R72). */
    pariPassu: {
      equalRankingDetected: pariPassuDuplicateRanks.length > 0,
      duplicateRanks: pariPassuDuplicateRanks,
      abatementEngaged: pariPassuAbated,
      /* The exit actually available to the preference stack — after any convertible
         money-back claim taken off the top, which is why it is published beside the
         tiers rather than left to be inferred from `exitMinor`. */
      availableToPreferenceStackMinor: engineExitProceeds,
      tiers: pariPassuPlan === null ? [] : pariPassuPlan.tiers.map((t) => ({
        seniority: t.seniority,
        classes: t.classes,
        tierClaimMinor: t.tierClaimMinor,
        availableMinor: t.availableMinor,
        abated: t.abated,
        abatementFactor: t.abatementFactor,
      })),
      precisionCeiling: "38",
      basis:
        `Classes recorded with the same seniority rank equally — pari passu. When the sale price cannot ` +
        `cover everything they are owed, each of them takes a share of what is available in proportion to ` +
        `what it is owed, and the class listed first takes no advantage from being listed first. What each ` +
        `class is owed is its invested amount multiplied by its liquidation preference multiple, so a ` +
        `$5,000,000 class at 2x is owed the same as a $10,000,000 class at 1x and the two take the same ` +
        `money. Whether a class takes its preference or converts to common is decided on the full amount ` +
        `it negotiated, before any reduction is applied. This follows the NVCA model certificate of ` +
        `incorporation, which has the holders share ratably in proportion to the respective amounts that ` +
        `would otherwise be payable if all amounts payable were paid in full. Figures are carried to 38 ` +
        `significant digits; a ratio that does not terminate is rounded there and nowhere earlier.`,
    },
    /* ═════════════════════════════════════════════════════════════
       WAVE 94 · ITEMS 1 AND 2 — THE CAP, AND WHAT A BINDING CAP RELEASED.
       ═════════════════════════════════════════════════════════════
       ADDITIVE, and ALWAYS PRESENT so a consumer never has to tell "no capped
       class" apart from "an older build". A founder whose proceeds changed because
       an investor's cap bound is entitled to see the three facts that produced the
       change: which class was capped, what the cap was, and how much money the cap
       released back into the pool. Exact decimal text, unrounded — no `Number()`,
       no `.toFixed(<digits>)`, one money format (R72). */
    participationCaps: {
      anyOnRecord: capsOnRecord,
      classes: (preferred as Array<Record<string, unknown>>).map((p) => ({
        roundId: String(p.classId),
        className: String(p.className),
        onRecord: p.participationCapOnRecord === true,
        capMultiple:
          p.participationCapMultiple === undefined ? null : Number(p.participationCapMultiple),
        source: (p.participationCapSource ?? null) as string | null,
        /* A cap recorded against a NON-participating class cannot bind, because a
           non-participating class never participates. Stated, not dropped. */
        inert: p.participationCapInert === true,
        capAmountMinor:
          p.participationCapMultiple === undefined
            ? null
            : new EngineMatchDec(String(p.invested))
                .mul(new EngineMatchDec(String(p.participationCapMultiple))).toFixed(),
      })),
      capBound: capPlanForResponse === null ? [] : capPlanForResponse.bound,
      capForcedConversion:
        capPlanForResponse === null
          ? []
          : capPlanForResponse.converters.filter((id) => !capPlanForResponse!.bound.includes(id)),
      releasedExcessMinor: capPlanForResponse === null ? "0" : capPlanForResponse.releasedExcessMinor,
      releasedExcessRedistributed: capRedistributed,
      /* Did `Σ payouts + remainder` equal the sale price to the LAST DIGIT, or
         only to the engine's declared 38-significant-digit ceiling? Stated rather
         than absorbed into a tolerance.
         WAVE 100 · ITEM 1 — these two fields KEEP their names, their positions and
         their meanings, and now carry the MEASURED result of summing the published
         rows against the submitted sale price rather than a value initialised to
         `true`/`"0"` on every branch that did not rewrite. See the measurement
         block above `emitBridge`. */
      conservationExact: measuredConservationExact,
      conservationResidualMinor: measuredConservationResidualMinor,
      /* ADDITIVE, so nothing is dropped and a consumer can tell the two apart:
         WHAT was summed, and — where the cap rewrite ran — the rewrite pass's own
         self-check figure, which is the number Wave 94 published here. */
      conservationScope:
        "every payout row the engine emitted, plus its remainder, plus any convertible cash-out " +
        "paid off the top, against the sale price as submitted",
      capRewriteConservationExact: capConservationExact,
      capRewriteConservationResidualMinor: capConservationResidualMinor,
      /* The ceiling this request was actually computed at, READ off the constructors
         rather than asserted. `precisionCeiling` below keeps its published value and
         its prose; this is the measured figure beside it. */
      precisionCeilingSignificantDigitsMeasured: String(precisionCeilingSignificantDigits),
      residualSharedMinor: capPlanForResponse === null ? null : capPlanForResponse.residualMinor,
      residualPricePerShareMinor: capPlanForResponse === null ? null : capPlanForResponse.pricePerShareMinor,
      precisionCeiling: "38",
      basis:
        `A participation cap is a ceiling on the TOTAL a participating preference class can take at an ` +
        `exit, expressed as a multiple of the money it invested: "1x participating, capped at 2x" means ` +
        `the class takes its preference and then shares in what is left until its total reaches twice its ` +
        `investment, and nothing after that. When the cap binds, the class stops sharing and the ` +
        `participation it no longer receives goes to the holders who are still entitled to share — the ` +
        `other participating preference classes as well as the common stock, in proportion to their ` +
        `shares, at one price per share. It is not a windfall for the common stock alone. Where a capped ` +
        `class would do better by converting to common than by taking its cap, it converts instead and is ` +
        `paid as a common holder. This follows the NVCA model certificate of incorporation, under which a ` +
        `holder that has received its capped amount is no longer among the holders entitled to share in ` +
        `the remaining assets. Figures are carried to 38 significant digits; a price that does not ` +
        `terminate is rounded there and nowhere earlier.`,
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// A2 — POST /api/founder/term-sheets/generate
//      GET  /api/founder/term-sheets/:id/download
// ─────────────────────────────────────────────────────────────────────────────

function buildTermSheetMarkdown(round: ReturnType<typeof getRoundById>): string {
  if (!round) return "# Term Sheet\n\n_Round not found._\n";
  const terms = (round as unknown as { terms?: Record<string, unknown> }).terms ?? {};
  const lines = [
    `# Term Sheet — ${round.name}`,
    ``,
    `**Company ID:** ${round.companyId}`,
    `**Round Type:** ${round.type}`,
    `**State:** ${round.state}`,
    `**Target Amount:** ${round.targetAmount?.toLocaleString() ?? "N/A"} ${round.currency ?? "USD"}`,
    `**Pre-Money Valuation:** ${round.preMoney?.toLocaleString() ?? "N/A"}`,
    `**Price Per Share:** ${round.pricePerShare ?? "N/A"}`,
    `**Close Date:** ${round.closeDate ?? "TBD"}`,
    `**Instrument:** ${round.instrument ?? "SAFE"}`,
    ``,
    `## Terms`,
    ``,
    ...(Object.keys(terms).length > 0
      ? Object.entries(terms).map(([k, v]) => `- **${k}:** ${v}`)
      : ["_No terms defined on this round._"]),
    ``,
    `## Summary`,
    ``,
    round.termsSummary ?? "_No summary available._",
    ``,
    `---`,
    `*Generated by Capavate v25.0 at ${nowIso()}*`,
  ];
  return lines.join("\n");
}

function handleTermSheetGenerate(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const { roundId, format } = req.body as { roundId?: string; format?: string };
  if (!roundId) { res.status(422).json({ ok: false, error: "MISSING_ROUND_ID" }); return; }
  if (format && format !== "markdown" && format !== "pdf") {
    res.status(422).json({ ok: false, error: "INVALID_FORMAT", message: "format must be 'markdown' or 'pdf'" }); return;
  }

  const round = getRoundById(roundId);
  if (!round) { res.status(404).json({ ok: false, error: "ROUND_NOT_FOUND" }); return; }

  if (!ownsCompany(ctx, round.companyId)) { res.status(403).json({ ok: false, error: "FORBIDDEN" }); return; }

  const resolvedFormat = (format as "markdown" | "pdf") ?? "markdown";
  const contentMd = buildTermSheetMarkdown(round);
  const docId = newId("ts");
  const createdAt = nowIso();

  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO term_sheets (id, round_id, owner_id, format, content_md, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(docId, roundId, ctx.userId, resolvedFormat, contentMd, createdAt);
  } catch (err) {
    log.error("[track1/term-sheet] DB insert failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "DB_ERROR" }); return;
  }

  emitBridge("termSheet.generated", roundId, "round", { docId, roundId, format: resolvedFormat, ownerId: ctx.userId });

  res.status(201).json({
    ok: true,
    docId,
    format: resolvedFormat,
    downloadUrl: `/api/founder/term-sheets/${docId}/download`,
    generatedAt: createdAt,
  });
}

function handleTermSheetDownload(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const { id } = req.params;
  let row: { id: string; round_id: string; owner_id: string; format: string; content_md: string; created_at: string } | undefined;
  try {
    const db = rawDb();
    row = db.prepare(`SELECT * FROM term_sheets WHERE id = ?`).get(id) as typeof row;
  } catch (err) {
    log.warn("[track1/term-sheet-download] DB read failed:", (err as Error).message);
  }

  if (!row) { res.status(404).json({ ok: false, error: "NOT_FOUND" }); return; }

  // Ownership: owner OR admin
  if (row.owner_id !== ctx.userId && !ctx.isAdmin) {
    res.status(403).json({ ok: false, error: "FORBIDDEN" }); return;
  }

  if (row.format === "pdf") {
    const pdfBuf = markdownToPdf(row.content_md);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="term-sheet-${id}.pdf"`);
    res.send(pdfBuf);
  } else {
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="term-sheet-${id}.md"`);
    res.send(row.content_md);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// A3 — POST /api/founder/crm/import
// ─────────────────────────────────────────────────────────────────────────────

function parseCsvText(text: string): Array<Record<string, string>> {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((line) => {
    const vals = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (vals[i] ?? "").trim(); });
    return row;
  });
}

function handleCrmImport(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  let csvText: string | undefined;

  // Support both multipart upload and text/csv content-type
  const contentType = req.headers["content-type"] ?? "";
  if (contentType.includes("text/csv") || contentType.includes("text/plain")) {
    csvText = req.body as string;
  } else if ((req as unknown as { file?: { buffer: Buffer } }).file) {
    csvText = (req as unknown as { file: { buffer: Buffer } }).file.buffer.toString("utf8");
  } else if (typeof req.body === "string") {
    csvText = req.body;
  }

  if (!csvText || csvText.trim().length === 0) {
    res.status(422).json({ ok: false, error: "MISSING_CSV", message: "Provide CSV as body or file upload" }); return;
  }

  // v25.0 B-J5-3 fix: extract companyId so we can write to founderCrmStore
  // (the source for GET /api/founder/crm/contacts). Accept from multipart field,
  // query param, or JSON body.
  const companyId: string | undefined =
    (typeof (req as any).body === "object" && typeof (req as any).body?.companyId === "string"
      ? (req as any).body.companyId
      : undefined) ??
    (typeof req.query.companyId === "string" ? req.query.companyId : undefined) ??
    // Multipart: multer puts non-file fields in req.body
    (typeof (req as any).body?.companyId === "string" ? (req as any).body.companyId : undefined) ??
    ctx.founder?.activeCompanyId ?? undefined;

  const rows = parseCsvText(csvText);
  if (rows.length === 0) {
    res.status(422).json({ ok: false, error: "EMPTY_CSV" }); return;
  }
  if (rows.length > 1000) {
    res.status(422).json({ ok: false, error: "TOO_MANY_ROWS", message: "Max 1000 rows per import" }); return;
  }

  let imported = 0;
  let skipped = 0;
  // v25.52 (GPT-5.5 R6 blocker) — track founder-CRM persistence separately from
  // roster import so a null from insertContactForImport (duplicate skip, dedup
  // guard unavailable, or DB write failure) is not silently reported as an
  // imported founder CRM row.
  let crmPersisted = 0;
  let crmSkipped = 0;
  const errors: Array<{ row: number; reason: string }> = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const email = (row["email"] ?? "").trim().toLowerCase();
    if (!email) {
      skipped++;
      continue;
    }

    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push({ row: i + 2, reason: `invalid_email: ${email}` });
      skipped++;
      continue;
    }

    try {
      addContact({
        name: row["name"] ?? email,
        email,
        kind: "ecosystem" as const,
        firm: row["organization"] ?? row["firmname"] ?? row["firm"] ?? "",
        pipelineStage: "lead" as const,
      }, ctx.userId);
      // v25.0 B-J5-3 fix: ALSO write to founderCrmStore so GET /api/founder/crm/contacts returns these rows.
      // v25.52 (GPT-5.5 R6): insertContactForImport now returns null on duplicate
      // / dedup-guard-unavailable / DB write failure. Count CRM persistence
      // separately and record a per-row note so the caller can see the founder
      // CRM row was NOT created even though the roster contact was added.
      if (companyId) {
        const crmRow = insertContactForImport({
          companyId,
          email,
          name: row["name"] ?? email,
          firmName: row["organization"] ?? row["firmname"] ?? row["firm"] ?? "",
          stage: row["stage"] ?? "lead",
          series: row["series"] ?? "—",
        });
        if (crmRow) crmPersisted++;
        else { crmSkipped++; errors.push({ row: i + 2, reason: `crm_contact_skipped_or_persist_failed: ${email}` }); }
      }
      imported++;
    } catch (err) {
      errors.push({ row: i + 2, reason: (err as Error).message });
      skipped++;
    }
  }

  emitBridge("crm.import.completed", ctx.userId, "platform", { imported, skipped, crmPersisted, crmSkipped, errorCount: errors.length, userId: ctx.userId });

  // `imported` = roster contacts added; `crmPersisted`/`crmSkipped` = founder CRM
  // rows actually written vs skipped (duplicate/guard-unavailable/DB-fail).
  res.status(201).json({ ok: true, imported, skipped, crmPersisted, crmSkipped, errors });
}

// ─────────────────────────────────────────────────────────────────────────────
// A4 — POST /api/founder/data-room/files
//      POST /api/founder/data-room/grants
//      GET  /api/founder/data-room/files/:fileId
// ─────────────────────────────────────────────────────────────────────────────

const MAX_FILE_BYTES_B64 = 5 * 1024 * 1024 * 4 / 3; // ~6.67MB base64 for 5MB binary

function handleDataRoomUpload(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const { roundId, filename, contentBase64, mimeType } = req.body as {
    roundId?: string; filename?: string; contentBase64?: string; mimeType?: string;
  };

  if (!roundId) { res.status(422).json({ ok: false, error: "MISSING_ROUND_ID" }); return; }
  if (!filename) { res.status(422).json({ ok: false, error: "MISSING_FILENAME" }); return; }
  if (!contentBase64) { res.status(422).json({ ok: false, error: "MISSING_CONTENT_BASE64" }); return; }
  if (!mimeType) { res.status(422).json({ ok: false, error: "MISSING_MIME_TYPE" }); return; }

  if (contentBase64.length > MAX_FILE_BYTES_B64) {
    res.status(422).json({ ok: false, error: "FILE_TOO_LARGE", message: "Max file size is 5MB" }); return;
  }

  const round = getRoundById(roundId);
  if (!round) { res.status(404).json({ ok: false, error: "ROUND_NOT_FOUND" }); return; }

  if (!ownsCompany(ctx, round.companyId)) { res.status(403).json({ ok: false, error: "FORBIDDEN" }); return; }

  const fileId = newId("drf");
  const uploadedAt = nowIso();

  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO data_room_files (id, round_id, owner_id, filename, content_base64, mime_type, uploaded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(fileId, roundId, ctx.userId, filename, contentBase64, mimeType, uploadedAt);
  } catch (err) {
    log.error("[track1/data-room-upload] DB insert failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "DB_ERROR" }); return;
  }

  emitBridge("dataRoom.file.uploaded", roundId, "round", { fileId, roundId, filename, mimeType, ownerId: ctx.userId });

  res.status(201).json({ ok: true, fileId, uploadedAt });
}

function handleDataRoomGrant(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const { fileId, investorId, ttlMinutes } = req.body as {
    fileId?: string; investorId?: string; ttlMinutes?: number;
  };

  if (!fileId) { res.status(422).json({ ok: false, error: "MISSING_FILE_ID" }); return; }
  if (!investorId) { res.status(422).json({ ok: false, error: "MISSING_INVESTOR_ID" }); return; }

  const ttl = Number(ttlMinutes ?? 60);
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 43200) {
    res.status(422).json({ ok: false, error: "INVALID_TTL", message: "ttlMinutes must be 1–43200" }); return;
  }

  let fileRow: { round_id: string; owner_id: string } | undefined;
  try {
    const db = rawDb();
    fileRow = db.prepare(`SELECT round_id, owner_id FROM data_room_files WHERE id = ?`).get(fileId) as typeof fileRow;
  } catch (err) {
    log.warn("[track1/data-room-grant] DB read failed:", (err as Error).message);
  }

  if (!fileRow) { res.status(404).json({ ok: false, error: "FILE_NOT_FOUND" }); return; }

  const round = getRoundById(fileRow.round_id);
  if (!round) { res.status(404).json({ ok: false, error: "ROUND_NOT_FOUND" }); return; }

  if (!ownsCompany(ctx, round.companyId)) { res.status(403).json({ ok: false, error: "FORBIDDEN" }); return; }

  const token = randomBytes(32).toString("hex");
  const grantId = newId("drg");
  const expiresAt = new Date(Date.now() + ttl * 60 * 1000).toISOString();
  const createdAt = nowIso();

  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO data_room_grants (id, file_id, investor_id, token, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(grantId, fileId, investorId, token, expiresAt, createdAt);
  } catch (err) {
    log.error("[track1/data-room-grant] DB insert failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "DB_ERROR" }); return;
  }

  emitBridge("dataRoom.grant.created", fileId, "round", { grantId, fileId, investorId, expiresAt });

  // Notify the investor
  try {
    emitNotification({
      userId: investorId,
      kind: "dataroom.access_granted",
      title: "Data room access granted",
      body: `You have been granted access to a document. Token expires at ${expiresAt}.`,
      link: `/api/public/data-room/files/${fileId}?grant=${token}`,
    });
  } catch { /* best-effort */ }

  res.status(201).json({ ok: true, grantToken: token, expiresAt });
}

function handleDataRoomFileGet(req: Request, res: Response): void {
  const { fileId } = req.params;
  const grantToken = req.query["grant"] as string | undefined;

  // Check grant token path (no auth session required for this path)
  if (grantToken) {
    let grant: { file_id: string; investor_id: string; expires_at: string } | undefined;
    let fileRow: { filename: string; content_base64: string; mime_type: string } | undefined;
    try {
      const db = rawDb();
      grant = db.prepare(`SELECT * FROM data_room_grants WHERE token = ? AND file_id = ?`).get(grantToken, fileId) as typeof grant;
      if (grant) {
        fileRow = db.prepare(`SELECT filename, content_base64, mime_type FROM data_room_files WHERE id = ?`).get(fileId) as typeof fileRow;
      }
    } catch (err) {
      log.warn("[track1/data-room-get] DB read failed:", (err as Error).message);
    }

    if (!grant) { res.status(403).json({ ok: false, error: "INVALID_GRANT" }); return; }
    if (new Date(grant.expires_at) < new Date()) { res.status(403).json({ ok: false, error: "GRANT_EXPIRED" }); return; }
    if (!fileRow) { res.status(404).json({ ok: false, error: "FILE_NOT_FOUND" }); return; }

    const buf = Buffer.from(fileRow.content_base64, "base64");
    res.setHeader("Content-Type", fileRow.mime_type);
    res.setHeader("Content-Disposition", `attachment; filename="${fileRow.filename}"`);
    res.send(buf);
    return;
  }

  // Without grant token, require auth + ownership
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  let fileRow: { round_id: string; owner_id: string; filename: string; content_base64: string; mime_type: string; uploaded_at: string } | undefined;
  try {
    const db = rawDb();
    fileRow = db.prepare(`SELECT * FROM data_room_files WHERE id = ?`).get(fileId) as typeof fileRow;
  } catch (err) {
    log.warn("[track1/data-room-get] DB read failed:", (err as Error).message);
  }

  if (!fileRow) { res.status(404).json({ ok: false, error: "FILE_NOT_FOUND" }); return; }

  const round = getRoundById(fileRow.round_id);
  if (!round) { res.status(404).json({ ok: false, error: "ROUND_NOT_FOUND" }); return; }

  if (!ownsCompany(ctx, round.companyId)) { res.status(403).json({ ok: false, error: "FORBIDDEN" }); return; }

  const buf = Buffer.from(fileRow.content_base64, "base64");
  res.setHeader("Content-Type", fileRow.mime_type);
  res.setHeader("Content-Disposition", `attachment; filename="${fileRow.filename}"`);
  res.send(buf);
}

// ─────────────────────────────────────────────────────────────────────────────
// A5 — POST /api/investor/invitations/:token/kyc
// ─────────────────────────────────────────────────────────────────────────────

function handleInvestorKyc(req: Request, res: Response): void {
  const token = String(req.params["token"] ?? "");
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const { accredited, jurisdiction, source_of_funds, attestations } = req.body as {
    accredited?: boolean; jurisdiction?: string; source_of_funds?: string; attestations?: unknown[];
  };

  if (typeof accredited !== "boolean") {
    res.status(422).json({ ok: false, error: "MISSING_ACCREDITED", message: "accredited (boolean) is required" }); return;
  }
  if (!jurisdiction || typeof jurisdiction !== "string") {
    res.status(422).json({ ok: false, error: "MISSING_JURISDICTION" }); return;
  }
  if (!source_of_funds || typeof source_of_funds !== "string") {
    res.status(422).json({ ok: false, error: "MISSING_SOURCE_OF_FUNDS" }); return;
  }
  if (!Array.isArray(attestations)) {
    res.status(422).json({ ok: false, error: "MISSING_ATTESTATIONS", message: "attestations must be an array" }); return;
  }

  // Validate the invitation token
  let invitation: { id: string; investor_email: string; state: string } | undefined;
  try {
    const db = rawDb();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    invitation = db.prepare(
      `SELECT id, investor_email, state FROM round_invitations WHERE token_hash = ? LIMIT 1`
    ).get(tokenHash) as typeof invitation;
  } catch (err) {
    log.warn("[track1/kyc] invitation lookup failed:", (err as Error).message);
  }

  if (!invitation) { res.status(404).json({ ok: false, error: "INVITATION_NOT_FOUND" }); return; }

  // The investor must own this invitation (their session email matches)
  const investorId = ctx.userId;
  const kycId = newId("kyc");
  const createdAt = nowIso();
  const attestationsJson = JSON.stringify(attestations);

  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO investor_kyc (id, investor_id, accredited, jurisdiction, source_of_funds, attestations_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(kycId, investorId, accredited ? 1 : 0, jurisdiction, source_of_funds, attestationsJson, createdAt);
  } catch (err) {
    log.error("[track1/kyc] DB insert failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "DB_ERROR" }); return;
  }

  // Update investor profile: kyc_completed = true, accreditation = accredited
  try {
    const db = rawDb();
    db.prepare(
      `UPDATE profilestore_investor_profile SET updated_at = ? WHERE investor_id = ?`
    ).run(createdAt, investorId);
  } catch { /* best-effort profile update */ }

  emitBridge("kyc.status_changed", investorId, "investor", { investorId, accredited, jurisdiction, kycId, invitationId: invitation.id });

  try {
    emitNotification({
      userId: investorId,
      kind: "kyc.status_changed",
      title: "KYC completed",
      body: "Your KYC attestation has been recorded.",
    });
  } catch { /* best-effort */ }

  res.status(201).json({
    ok: true,
    kycId,
    investorId,
    accredited,
    jurisdiction,
    createdAt,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// A6 — POST /api/investor/documents/:id/sign
// ─────────────────────────────────────────────────────────────────────────────

function handleDocumentSign(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const documentId = String(req.params["id"] ?? "");
  const { signature, signed_at } = req.body as { signature?: string; signed_at?: string };

  if (!signature || typeof signature !== "string" || signature.trim().length === 0) {
    res.status(422).json({ ok: false, error: "MISSING_SIGNATURE" }); return;
  }

  const signerId = ctx.userId;
  const resolvedSignedAt = signed_at ?? nowIso();

  // Idempotency: check if already signed by this user
  let existing: { id: string; document_id: string; signer_id: string; signature_text: string; signed_at: string } | undefined;
  try {
    const db = rawDb();
    existing = db.prepare(
      `SELECT * FROM document_signatures WHERE document_id = ? AND signer_id = ?`
    ).get(documentId, signerId) as typeof existing;
  } catch (err) {
    log.warn("[track1/sign] DB read failed:", (err as Error).message);
  }

  if (existing) {
    // Return existing record (idempotent)
    res.json({
      ok: true,
      signatureId: existing.id,
      documentId: existing.document_id,
      signerId: existing.signer_id,
      signedAt: existing.signed_at,
      alreadySigned: true,
    });
    return;
  }

  const sigId = newId("sig");
  /* WAVE 22 · ITEM 2 (REVIEW B F-3) — this used to read the LEFTMOST
   * `x-forwarded-for` entry, which is caller-supplied text. A signature's
   * `ip_address` column is evidence; anything a signer can dictate is not
   * evidence. Resolution now goes through the ONE hardened resolver
   * (`server/lib/rateLimit.ts#resolveRateLimitClientIp`, Wave 19 WAIVER-2 +
   * Wave 21) rather than a second local copy of the same security decision.
   * Fail-closed: with no `TRUSTED_PROXY_HOPS` configured the socket peer is
   * used and the header is ignored completely. */
  const ipAddress = resolveRateLimitClientIp(req);

  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO document_signatures (id, document_id, signer_id, signature_text, signed_at, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(sigId, documentId, signerId, signature, resolvedSignedAt, ipAddress);
  } catch (err) {
    log.error("[track1/sign] DB insert failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "DB_ERROR" }); return;
  }

  emitBridge("document.signed", documentId, "round", { sigId, documentId, signerId, signedAt: resolvedSignedAt });

  res.status(201).json({
    ok: true,
    signatureId: sigId,
    documentId,
    signerId,
    signedAt: resolvedSignedAt,
    alreadySigned: false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// A7 — POST /api/rounds/:id/soft-circle/:scId/reject
// ─────────────────────────────────────────────────────────────────────────────

function handleSoftCircleReject(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const roundId = String(req.params["id"] ?? "");
  const scId = String(req.params["scId"] ?? "");
  const { reason } = req.body as { reason?: string };

  if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
    res.status(422).json({ ok: false, error: "MISSING_REASON" }); return;
  }

  if (!ownsRound(ctx, roundId)) { res.status(403).json({ ok: false, error: "FORBIDDEN" }); return; }

  // Look up soft circle in memory store
  const circles = softCircleListForRound(roundId);
  const sc = circles.find((c: { id: string }) => c.id === scId);
  if (!sc) { res.status(404).json({ ok: false, error: "SOFT_CIRCLE_NOT_FOUND" }); return; }

  const scAny = sc as unknown as {
    id: string; roundId: string; status: string; investorName: string;
    rejectedAt?: string; rejectedReason?: string; updatedAt?: string;
  };

  // Idempotency: if already rejected, return same response
  if (scAny.status === "rejected" && scAny.rejectedAt) {
    res.json({
      ok: true,
      scId,
      status: "rejected",
      rejectedAt: scAny.rejectedAt,
      rejectedReason: scAny.rejectedReason ?? reason,
      alreadyRejected: true,
    });
    return;
  }

  // Validate current status allows rejection
  const REJECTABLE_STATUSES = ["intent", "confirmed", "wired"];
  if (!REJECTABLE_STATUSES.includes(scAny.status)) {
    res.status(422).json({
      ok: false,
      error: "INVALID_STATUS_TRANSITION",
      message: `Cannot reject a soft circle in '${scAny.status}' state`,
    }); return;
  }

  const rejectedAt = nowIso();

  // Update in memory cache
  scAny.status = "rejected" as unknown as string;
  scAny.rejectedAt = rejectedAt;
  scAny.rejectedReason = reason;
  scAny.updatedAt = rejectedAt;

  // Persist to DB
  try {
    const db = rawDb();
    db.prepare(
      `UPDATE soft_circles SET status = 'rejected', rejected_at = ?, rejected_reason = ?, updated_at = ? WHERE id = ?`
    ).run(rejectedAt, reason, rejectedAt, scId);
  } catch (err) {
    log.error("[track1/sc-reject] DB update failed:", (err as Error).message);
    // Don't fail — in-memory updated; DB write best-effort on this column
  }

  emitBridge("softCircle.rejected", roundId, "round", { scId, roundId, reason, rejectedAt, investorName: scAny.investorName });

  res.json({
    ok: true,
    scId,
    status: "rejected",
    rejectedAt,
    rejectedReason: reason,
    alreadyRejected: false,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// A8 — POST /api/rounds/:id/updates
// ─────────────────────────────────────────────────────────────────────────────

function handleRoundUpdate(req: Request, res: Response): void {
  const ctx = getUserContext(req);
  if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }

  const roundId = String(req.params["id"] ?? "");
  const { title, body, visibility } = req.body as {
    title?: string; body?: string; visibility?: string;
  };

  if (!title || typeof title !== "string" || title.trim().length === 0) {
    res.status(422).json({ ok: false, error: "MISSING_TITLE" }); return;
  }
  if (!body || typeof body !== "string" || body.trim().length === 0) {
    res.status(422).json({ ok: false, error: "MISSING_BODY" }); return;
  }
  const validVisibilities = ["all", "committed", "collective_only"];
  const resolvedVisibility = visibility ?? "all";
  if (!validVisibilities.includes(resolvedVisibility)) {
    res.status(422).json({ ok: false, error: "INVALID_VISIBILITY", message: "visibility must be 'all', 'committed', or 'collective_only'" }); return;
  }

  if (!ownsRound(ctx, roundId)) { res.status(403).json({ ok: false, error: "FORBIDDEN" }); return; }

  const round = getRoundById(roundId);
  if (!round) { res.status(404).json({ ok: false, error: "ROUND_NOT_FOUND" }); return; }

  const updateId = newId("upd");
  const publishedAt = nowIso();

  try {
    const db = rawDb();
    db.prepare(
      `INSERT INTO round_updates (id, round_id, author_id, title, body, visibility, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(updateId, roundId, ctx.userId, title.trim(), body.trim(), resolvedVisibility, publishedAt);
  } catch (err) {
    log.error("[track1/round-update] DB insert failed:", (err as Error).message);
    res.status(500).json({ ok: false, error: "DB_ERROR" }); return;
  }

  // Notification fanout: notify committed investors (and collective if visibility=collective_only|all)
  const circles = softCircleListForRound(roundId);
  const committedInvestors = circles
    .filter((sc: unknown) => (sc as { status: string }).status === "committed" || (sc as { status: string }).status === "wired")
    .map((sc: unknown) => (sc as { investorUserId?: string }).investorUserId)
    .filter((id): id is string => typeof id === "string");

  const notifySet = new Set<string>(committedInvestors);
  const notifyArr = Array.from(notifySet);

  for (const investorId of notifyArr) {
    try {
      emitNotification({
        userId: investorId,
        kind: "investor_report.published",
        title: `New update: ${title}`,
        body: `${round.name} published a new update.`,
        link: `/rounds/${roundId}/updates/${updateId}`,
      });
    } catch { /* best-effort */ }
  }

  emitBridge("round.update.published", roundId, "round", {
      updateId, roundId, authorId: ctx.userId, title, visibility: resolvedVisibility,
      notifiedCount: notifySet.size, publishedAt,
    });

  res.status(201).json({
    ok: true,
    updateId,
    roundId,
    authorId: ctx.userId,
    title: title.trim(),
    visibility: resolvedVisibility,
    publishedAt,
    notifiedCount: notifySet.size,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Registration
// ─────────────────────────────────────────────────────────────────────────────

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 71 · D11 (3) — WHERE THE REAL COMMON SHARE COUNT COMES FROM.
   ═══════════════════════════════════════════════════════════════════════════
   `buildCompanySecurities` lives inside `server/routes.ts::registerRoutes`'s
   closure and cannot be imported. `server/routes.ts` ALREADY solves exactly this
   for the round-math routes by INJECTING it:

       registerRoundMathRoutes(app, (cid) => buildCompanySecurities(cid) as never);

   The same pattern is used here rather than inventing a second way to reach the
   cap table, and rather than re-deriving the rows from the sacred ledger (which
   would be a third reader of the same fact). `null` from the provider, or a
   provider that was never supplied, means "not on record" and the route REFUSES —
   it never falls back to a count. */
type CompanySecuritiesProvider = (companyId: string) => Array<Record<string, unknown>>;
let companySecuritiesProvider: CompanySecuritiesProvider | null = null;

/** A common holder as the waterfall needs it: an id and an exact share string. */
function readCompanyCommonRows(companyId: string): Array<{ holderId: string; shares: string }> | null {
  if (!companySecuritiesProvider) return null;
  let rows: Array<Record<string, unknown>>;
  try {
    rows = companySecuritiesProvider(String(companyId)) ?? [];
  } catch (err) {
    log.warn("[track1/waterfall] securities provider failed:", (err as Error).message);
    return null;
  }
  const out: Array<{ holderId: string; shares: string }> = [];
  for (const r of rows) {
    if (String(r.instrument ?? "") !== "common") continue;
    /* Integer share counts only, exact via string. A fractional share count is not
       a share count and is skipped rather than rounded into existence.
       WAVE 86B · ITEM 1 — decided EXACTLY. `String(Number("1000000000000000000000"))`
       is `"1e+21"`, and the caller feeds this string straight to `BigInt(...)`,
       which THROWS on an exponent — a 500 on a large but entirely legal cap
       table. The three acceptance rules are unchanged (finite, integer, > 0). */
    const sd = parseExactMoney(r.shares ?? 0);
    if (sd === null || !sd.isInteger() || sd.lte(0)) continue;
    out.push({ holderId: String(r.holderName ?? r.id ?? "common"), shares: sd.toFixed() });
  }
  return out.length > 0 ? out : null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   WAVE 88 · THE SIBLING PROJECTION — ONE PROVIDER, TWO PROJECTIONS, NO THIRD READER.
   ═══════════════════════════════════════════════════════════════════════════
   `readCompanyCommonRows` above is UNCHANGED. This reads the SAME injected
   provider — `server/routes.ts::buildCompanySecurities`, the one the cap table and
   the round-math routes already read — and projects the OTHER shape out of it: the
   unpriced convertible positions, with the purchase amount and the valuation cap
   the cap-table screen already shows a founder today.

   WHY IT MUST BE THIS PROVIDER AND NOT `roundStoredTerms`. Measured in
   `spec/preflight_r67_evidence/16_terms_on_record.txt`: `roundStoredTerms` carries
   NO valuation-cap field at all. The cap reaches the securities row from the COMMIT
   LEDGER (`e.valuationCap`). So the cap is read where it lives, and
   `roundStoredTerms` stays read-only with no new field — which is also why this
   wave needs no migration.

   R21 — NOT A SECOND READER OF THE SAME FACT. The cap table and this waterfall now
   disagree about nothing, because they are looking at the same rows. That
   disagreement is precisely the defect: the cap table showed the SAFE and its
   principal while the waterfall paid it $0. */
function readCompanyConvertibleRows(
  companyId: string,
): Array<{ roundId: string; holderName: string; instrument: string; purchaseAmount: string; cap: string | null }> | null {
  if (!companySecuritiesProvider) return null;
  let rows: Array<Record<string, unknown>>;
  try {
    rows = companySecuritiesProvider(String(companyId)) ?? [];
  } catch (err) {
    log.warn("[track1/waterfall] securities provider failed (convertibles):", (err as Error).message);
    return null;
  }
  const out: Array<{ roundId: string; holderName: string; instrument: string; purchaseAmount: string; cap: string | null }> = [];
  for (const r of rows) {
    const inst = String(r.instrument ?? "");
    /* The provider's OWN labels for the unpriced projection: `safe` and `note`.
       The round's `instrument` value (`safe_post` / `safe_pre` /
       `convertible_note`) is the authority on the CONVENTION and is read by the
       caller — these two must never become rival readers of the convention
       (OQ-R67-4). This filter is only asking "is this row a convertible position". */
    if (inst !== "safe" && inst !== "note") continue;
    out.push({
      roundId: String(r.roundId ?? ""),
      holderName: String(r.holderName ?? r.id ?? "convertible holder"),
      instrument: inst,
      /* Major units, exactly as the provider holds them. Carried as TEXT so no
         float ever touches a money figure on this path. */
      purchaseAmount: String(r.investmentAmount ?? "0"),
      cap: r.cap == null ? null : String(r.cap),
    });
  }
  return out;
}

export function registerTrack1Routes(
  app: Express,
  /* WAVE 71 · D11 — optional so every existing caller compiles unchanged; when it
     is absent the waterfall route REFUSES by name instead of fabricating the
     common leg, which is the whole point of the finding. */
  securitiesProvider?: CompanySecuritiesProvider,
): void {
  if (securitiesProvider) companySecuritiesProvider = securitiesProvider;
  // A1 — waterfall (read — no rate-limit mutation guard)
  app.get("/api/founder/captable/waterfall", requireAuth, (req, res) => {
    handleWaterfall(req, res).catch((err) => {
      log.error("[track1/waterfall] unhandled:", (err as Error).message);
      res.status(500).json({ ok: false, error: "INTERNAL_ERROR" });
    });
  });

  // A2 — term-sheet generation
  app.post("/api/founder/term-sheets/generate", requireAuth, rateLimitMiddleware, handleTermSheetGenerate);
  app.get("/api/founder/term-sheets/:id/download", requireAuth, handleTermSheetDownload);

  // A3 — CRM CSV import (supports both multipart upload and text/csv body)
  const textBodyParser = (req: Request, res: Response, next: import("express").NextFunction) => {
    const ct = req.headers["content-type"] ?? "";
    if (!ct.includes("text/csv") && !ct.includes("text/plain")) return next();
    // Already parsed if body is a string; re-parse raw bytes if Buffer
    if (typeof req.body === "string" && req.body.length > 0) return next();
    let data = "";
    req.on("data", (chunk: Buffer) => { data += chunk.toString("utf8"); });
    req.on("end", () => { (req as unknown as { body: string }).body = data; next(); });
    req.on("error", () => next());
  };
  app.post(
    "/api/founder/crm/import",
    requireAuth,
    rateLimitMiddleware,
    textBodyParser,
    upload.single("file"),
    handleCrmImport,
  );

  // A4 — data room
  app.post("/api/founder/data-room/files", requireAuth, rateLimitMiddleware, handleDataRoomUpload);
  app.post("/api/founder/data-room/grants", requireAuth, rateLimitMiddleware, handleDataRoomGrant);
  // GET with grant token — registered under /api/public/ to bypass global requireAuth (token IS the credential)
  app.get("/api/public/data-room/files/:fileId", handleDataRoomFileGet);
  // GET for owners (full auth) — registered under founder path too
  app.get("/api/founder/data-room/files/:fileId", requireAuth, handleDataRoomFileGet);

  // A5 — KYC
  app.post("/api/investor/invitations/:token/kyc", requireAuth, rateLimitMiddleware, handleInvestorKyc);

  // A6 — document sign
  app.post("/api/investor/documents/:id/sign", requireAuth, rateLimitMiddleware, handleDocumentSign);

  // A7 — soft-circle reject
  app.post("/api/rounds/:id/soft-circle/:scId/reject", requireAuth, rateLimitMiddleware, handleSoftCircleReject);

  // A8 — round updates (POST creates; GET reads the feed)
  app.post("/api/rounds/:id/updates", requireAuth, rateLimitMiddleware, handleRoundUpdate);
  app.get("/api/rounds/:id/updates", requireAuth, (req: Request, res: Response): void => {
    const ctx = getUserContext(req);
    if (!ctx?.isAuthed) { res.status(401).json({ ok: false, error: "UNAUTHORIZED" }); return; }
    const roundId = String(req.params["id"] ?? "");
    const round = getRoundById(roundId);
    if (!round) { res.status(404).json({ ok: false, error: "ROUND_NOT_FOUND" }); return; }

    // v25.2: founders see all updates for their round; investors see only updates
    // whose visibility includes them (all | committed if they have committed SC).
    const isFounder = ownsRound(ctx, roundId);

    try {
      const db = rawDb();
      const rows = db.prepare(
        `SELECT id, round_id AS roundId, author_id AS authorId, title, body,
                visibility, published_at AS publishedAt
         FROM round_updates WHERE round_id = ? ORDER BY published_at DESC LIMIT 200`
      ).all(roundId) as Array<{ id: string; roundId: string; authorId: string; title: string; body: string; visibility: string; publishedAt: string }>;

      let visible = rows;
      if (!isFounder) {
        // Investor filter: include only updates whose visibility is reachable for them
        const circles = softCircleListForRound(roundId);
        const myStatus = circles.find((sc: unknown) => (sc as { investorUserId?: string }).investorUserId === ctx.userId);
        const hasCommitted = myStatus && ((myStatus as { status: string }).status === "committed" || (myStatus as { status: string }).status === "wired");
        visible = rows.filter(r => {
          if (r.visibility === "all") return true;
          if (r.visibility === "committed") return !!hasCommitted;
          if (r.visibility === "collective_only") return ctx.collective?.status === "active";
          return false;
        });
      }
      res.json({ ok: true, roundId, updates: visible, count: visible.length });
    } catch (err) {
      log.error("[track1/round-update GET] DB read failed:", (err as Error).message);
      res.status(500).json({ ok: false, error: "DB_ERROR" });
    }
  });
}

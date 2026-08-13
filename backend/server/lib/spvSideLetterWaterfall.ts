/**
 * WAVE 32 · CP-SPV-30 · CAPABILITY 2 — SIDE-LETTER ECONOMICS IN THE WATERFALL.
 *
 * WHAT THIS IS. A negotiated per-LP carry rate that OVERRIDES the fund default
 * for that LP only. A founder-friendly anchor LP on 10% carry sits in the same
 * vehicle as everyone else on 20%, and the distribution must reflect that. This
 * is the single most common side-letter term in real funds and its absence is
 * the first thing a fund-admin diligence process notices.
 *
 * WHAT THIS DELIBERATELY IS NOT. It is NOT a second waterfall.
 * `spvEngineStore.recordDistribution` remains the one canonical money path
 * (XT-C5, boundary 3 of 3); this module is a pure function it calls between
 * `allocateDistributionMinor` and `_collectCarryObligation`, and it returns the
 * BASE ALLOCATION UNCHANGED — by identity, asserted — when no active side
 * letter carries a carry override. A vehicle with no side letters therefore
 * computes byte-for-byte what it computed before Wave 32.
 *
 * WHY IT SITS EXACTLY THERE. Wave 3B's pinned CALL-GRAPH-1 test slices the
 * source of `recordDistribution` and asserts the literal ordering
 *   COMBINED_CARRY_EXCEEDS_CAP < allocateDistributionMinor( <
 *   _collectCarryObligation( < persist("spv_distribution"
 * That ordering is the proof that a throw aborts with nothing written and no
 * money moved. Inserting this call between the allocator and the collection
 * preserves every one of those relative positions, so the proof still holds —
 * and it must run BEFORE the collection, because it changes how much carry is
 * collected at all.
 *
 * ── MONEY, EXACTLY ────────────────────────────────────────────────────────
 * The base allocator splits ONE total across LPs by largest remainder. Side
 * letters make that shape wrong: each LP's carry is now their OWN rate applied
 * to their OWN share of the carry base, so the total is a CONSEQUENCE of the
 * parts rather than the thing being divided.
 *
 * The arithmetic follows that reality:
 *   1. the carry base is split across LPs by `allocateResidualCents` (exact,
 *      largest remainder, pinned comparator) — this is a true allocation;
 *   2. each LP's carry is `carryBaseShare_i × rate_i / 1e9` in exact BigInt,
 *      rounded HALF-EVEN, where `rate_i` is their side-letter rate or the fund
 *      rate;
 *   3. the new totals are DEFINED as the sums of the parts, so cents cannot
 *      appear or vanish;
 *   4. the reduced total is split back into the GP and platform legs by
 *      `allocateResidualCents` over the original legs — an allocation again,
 *      because that IS one.
 *
 * Step 2 is not the forbidden "Math.round a per-party share". The prohibition
 * exists because rounding independent shares of a FIXED TOTAL breaks
 * conservation. Here there is no fixed total to break: the total is the sum.
 * Conservation is asserted at the end regardless — `sum(perLp.carry)` must
 * equal the new total exactly, and `sum(perLp.net)` must equal
 * `gross − totalCarry` exactly, or this function throws and the distribution
 * aborts with nothing written.
 *
 * ── RATES ARE FRACTIONS ───────────────────────────────────────────────────
 * Every rate here is an integer count of billionths (`CARRY_FRACTION_SCALE`,
 * 1e9). 20% is 200000000. The forbidden `n > 1 ? n / 100 : n` repair appears
 * nowhere: it cannot distinguish a 1% carry written as 1 from a 100% carry
 * written as 1, and Wave 5 / P-4 is what that guessing cost — an "8" meant as
 * 8% was read as the fraction 8 and an SPV silently acquired a 100% preferred
 * return.
 *
 * ── THE CAP STILL BINDS ───────────────────────────────────────────────────
 * A side letter may lower an LP's carry, and may raise it, but it may NEVER
 * carry an LP above the durable combined-carry cap (`spv_carry_cap_policy`,
 * migration 0150, resolved fail-closed). An override above the cap THROWS
 * (`SIDE_LETTER_CARRY_EXCEEDS_CAP`) rather than being clamped. Clamping is how
 * Wave 5 / P-4 turned a typo into a 100% preferred return: a value outside its
 * domain is a question for a human, not something to round into range.
 */
import { allocateResidualCents, CARRY_FRACTION_SCALE } from "./money";

const B_ZERO = BigInt(0);
const B_ONE = BigInt(1);
const B_TWO = BigInt(2);
const B_SCALE = BigInt(CARRY_FRACTION_SCALE);

/** Half-even division. Same tie-break as `basisPoints` and `spvNav`. */
function divRoundHalfEven(num: bigint, den: bigint): bigint {
  if (den <= B_ZERO) throw new RangeError("divRoundHalfEven: denominator must be positive");
  const neg = num < B_ZERO;
  const n = neg ? -num : num;
  const q = n / den;
  const r = n % den;
  const twice = r * B_TWO;
  let out: bigint;
  if (twice < den) out = q;
  else if (twice > den) out = q + B_ONE;
  else out = q % B_TWO === B_ZERO ? q : q + B_ONE;
  return neg ? -out : out;
}

export interface WaterfallLpLine {
  investorId: string;
  grossMinor: number;
  carryMinor: number;
  netMinor: number;
}

/** One LP's negotiated carry, as read from an ACTIVE `spv_side_letter` row. */
export interface SideLetterCarryOverride {
  investorId: string;
  /** Integer billionths. Null is not representable here — the store filters. */
  carryFractionScaled: number;
  sideLetterId: string;
}

export interface SideLetterWaterfallInput {
  /** The base allocation, exactly as `allocateDistributionMinor` produced it. */
  perLp: WaterfallLpLine[];
  /** Commitment weights, in the SAME ORDER as `perLp`. */
  lpWeightsMinor: number[];
  grossMinor: number;
  carryBaseMinor: number;
  gpCarryMinor: number;
  platformCarryMinor: number;
  /** The fund's combined carry (GP + platform) as integer billionths. */
  fundCombinedCarryScaled: number;
  /** The durable cap from `spv_carry_cap_policy`, as integer billionths. */
  combinedCarryCapScaled: number;
  overrides: SideLetterCarryOverride[];
}

export interface SideLetterWaterfallResult {
  /** False when nothing applied; `perLp` is then the input array by identity. */
  adjusted: boolean;
  perLp: WaterfallLpLine[];
  gpCarryMinor: number;
  platformCarryMinor: number;
  totalCarryMinor: number;
  distributableMinor: number;
  /** One entry per LP whose economics a side letter actually changed. */
  adjustments: Array<{
    investorId: string;
    sideLetterId: string;
    fundCarryScaled: number;
    lpCarryScaled: number;
    carryBeforeMinor: number;
    carryAfterMinor: number;
    netBeforeMinor: number;
    netAfterMinor: number;
  }>;
}

/**
 * Apply side-letter carry overrides to a computed distribution.
 *
 * Throws — aborting the distribution with nothing written — rather than
 * producing a figure it cannot stand behind.
 */
export function applySideLetterCarry(input: SideLetterWaterfallInput): SideLetterWaterfallResult {
  const base: SideLetterWaterfallResult = {
    adjusted: false,
    perLp: input.perLp,
    gpCarryMinor: input.gpCarryMinor,
    platformCarryMinor: input.platformCarryMinor,
    totalCarryMinor: input.gpCarryMinor + input.platformCarryMinor,
    distributableMinor: input.grossMinor - (input.gpCarryMinor + input.platformCarryMinor),
    adjustments: [],
  };

  /* NO SIDE LETTERS -> THE BASE ALLOCATION, BY IDENTITY. Not a recomputation
     that happens to agree: the same array object, so a vehicle without side
     letters cannot drift by so much as a rounding decision. */
  const relevant = input.overrides.filter((o) =>
    input.perLp.some((l) => l.investorId === o.investorId),
  );
  if (relevant.length === 0) return base;

  const capScaled = BigInt(input.combinedCarryCapScaled);
  const fundScaled = BigInt(input.fundCombinedCarryScaled);
  if (fundScaled > capScaled) throw new Error("COMBINED_CARRY_EXCEEDS_CAP");

  const rateByInvestor = new Map<string, { scaled: bigint; sideLetterId: string }>();
  for (const o of relevant) {
    const scaled = BigInt(Math.trunc(o.carryFractionScaled));
    if (scaled < B_ZERO || scaled > B_SCALE) throw new Error("SIDE_LETTER_CARRY_OUT_OF_DOMAIN");
    // The cap binds every LP individually. A side letter is a negotiation
    // between the GP and one LP; it cannot authorise economics the vehicle's
    // own durable policy forbids. Refused, never clamped.
    if (scaled > capScaled) throw new Error("SIDE_LETTER_CARRY_EXCEEDS_CAP");
    if (rateByInvestor.has(o.investorId)) throw new Error("SIDE_LETTER_DUPLICATE_ACTIVE");
    rateByInvestor.set(o.investorId, { scaled, sideLetterId: o.sideLetterId });
  }

  const weights = input.lpWeightsMinor.map((w) => BigInt(Math.trunc(w)));
  if (weights.length !== input.perLp.length) throw new Error("SIDE_LETTER_WEIGHT_LENGTH_MISMATCH");
  const carryBase = BigInt(Math.trunc(input.carryBaseMinor));
  const weightTotal = weights.reduce((a, w) => a + w, B_ZERO);

  // Step 1 — the carry BASE across LPs. A true allocation of a fixed total, so
  // it goes through the pinned largest-remainder allocator.
  const baseShares =
    carryBase === B_ZERO || weightTotal === B_ZERO
      ? weights.map(() => B_ZERO)
      : allocateResidualCents(carryBase, weights);

  /* The split of the base is itself money and must conserve: the shares of the
     carry base have to sum to the carry base exactly. A proportional float
     split (`round(base * w / total)`) does NOT — with three equal LPs on a base
     of 5 it produces 2 + 2 + 2 = 6 and manufactures a unit out of nothing —
     which is why the pinned largest-remainder allocator is used above and why
     this assertion is here to prove it stayed. */
  const baseSharesSum = baseShares.reduce((a, x) => a + x, B_ZERO);
  const expectedBaseSum = weightTotal === B_ZERO ? B_ZERO : carryBase;
  if (baseSharesSum !== expectedBaseSum) throw new Error("SIDE_LETTER_BASE_SPLIT_NOT_CONSERVED");

  // Step 2 — each LP's carry at THEIR OWN rate, exactly.
  const newCarry: bigint[] = [];
  for (let i = 0; i < input.perLp.length; i++) {
    const own = rateByInvestor.get(input.perLp[i].investorId);
    const rate = own ? own.scaled : fundScaled;
    newCarry.push(divRoundHalfEven(baseShares[i] * rate, B_SCALE));
  }

  // Step 3 — totals are the SUM of the parts, so nothing can be lost.
  const totalCarry = newCarry.reduce((a, c) => a + c, B_ZERO);
  if (totalCarry > BigInt(Math.trunc(input.grossMinor))) throw new Error("SIDE_LETTER_CARRY_EXCEEDS_GROSS");
  // No rate exceeds 100%, so the carry can never exceed the base it is charged
  // on. If it does, the base split lost integrity upstream.
  if (totalCarry > carryBase) throw new Error("SIDE_LETTER_CARRY_EXCEEDS_BASE");

  // Step 4 — split the new total back into the GP and platform legs in the
  // proportion the fund's own fee schedule established. An allocation again.
  const gpBefore = BigInt(Math.trunc(input.gpCarryMinor));
  const platBefore = BigInt(Math.trunc(input.platformCarryMinor));
  let gpAfter: bigint;
  let platAfter: bigint;
  if (gpBefore + platBefore === B_ZERO) {
    // The fund charges no carry at all, yet a side letter set a rate. There is
    // no leg to attribute it to, and inventing one would put money somewhere
    // nobody agreed to. Refuse.
    if (totalCarry !== B_ZERO) throw new Error("SIDE_LETTER_CARRY_WITHOUT_FEE_SCHEDULE");
    gpAfter = B_ZERO;
    platAfter = B_ZERO;
  } else {
    [gpAfter, platAfter] = allocateResidualCents(totalCarry, [gpBefore, platBefore]);
  }

  const perLp: WaterfallLpLine[] = input.perLp.map((l, i) => {
    const carry = Number(newCarry[i]);
    const net = l.grossMinor - carry;
    if (net < 0) throw new Error("SIDE_LETTER_NEGATIVE_LP_NET");
    return { investorId: l.investorId, grossMinor: l.grossMinor, carryMinor: carry, netMinor: net };
  });

  /* ── CONSERVATION, ASSERTED. A violation throws, and because this runs before
     `_collectCarryObligation` the distribution aborts with no money moved and
     no row written. These are not decorative: they are the reason step 2's
     per-LP rounding is safe. */
  const sumCarry = perLp.reduce((a, l) => a + l.carryMinor, 0);
  const sumNet = perLp.reduce((a, l) => a + l.netMinor, 0);
  const sumGross = perLp.reduce((a, l) => a + l.grossMinor, 0);
  const totalCarryNum = Number(totalCarry);
  if (sumCarry !== totalCarryNum) throw new Error("SIDE_LETTER_CARRY_NOT_CONSERVED");
  if (Number(gpAfter + platAfter) !== totalCarryNum) throw new Error("SIDE_LETTER_LEG_SPLIT_NOT_CONSERVED");
  if (sumGross !== input.grossMinor) throw new Error("SIDE_LETTER_GROSS_NOT_CONSERVED");
  if (sumNet !== input.grossMinor - totalCarryNum) throw new Error("SIDE_LETTER_NET_NOT_CONSERVED");

  const adjustments = input.perLp
    .map((l, i) => {
      const own = rateByInvestor.get(l.investorId);
      if (!own) return null;
      return {
        investorId: l.investorId,
        sideLetterId: own.sideLetterId,
        fundCarryScaled: Number(fundScaled),
        lpCarryScaled: Number(own.scaled),
        carryBeforeMinor: l.carryMinor,
        carryAfterMinor: perLp[i].carryMinor,
        netBeforeMinor: l.netMinor,
        netAfterMinor: perLp[i].netMinor,
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return {
    adjusted: true,
    perLp,
    gpCarryMinor: Number(gpAfter),
    platformCarryMinor: Number(platAfter),
    totalCarryMinor: totalCarryNum,
    distributableMinor: input.grossMinor - totalCarryNum,
    adjustments,
  };
}

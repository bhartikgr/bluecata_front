/**
 * WAVE 52 — ROUND & CAP-TABLE MATHEMATICS.
 *
 * Pure, exact-decimal derivations for the round wizard, with two absolute rules:
 *
 *   1. EVERY PERCENTAGE CARRIES ITS DENOMINATOR LABEL. The same founder is
 *      legitimately 40.000% / 48.485% / 51.613% on three different denominators.
 *      A percentage without a named denominator is a defect (AC-7), so this
 *      module cannot emit a bare number: `Pct` requires a `DenomLabel`.
 *
 *   2. WHEN A FIGURE CANNOT BE COMPUTED, IT REFUSES BY NAME. Never `0`, never a
 *      blank, never a substituted denominator. Every public function returns a
 *      discriminated `Refusable`, and the reason is display copy (AC-5, AC-6,
 *      AC-16, AC-17). A genuine zero still renders as zero — `ok:true, "0"`.
 *
 * PERCENT CONVENTION (owner ruling R16 / OR-1): percent-as-written, 1 = 1%.
 * Nothing in this module multiplies or divides a percent by 100 except the two
 * clearly-named boundary helpers `pctFromFraction` / `fractionFromPct`, which
 * convert between an exact ownership FRACTION (0..1, the mathematical object)
 * and a percent-as-written display value. Pool-size inputs in this wave are
 * SHARE COUNTS, not percentages (Wave 50, item 4).
 *
 * MONEY: exact `Decimal`. No float arithmetic anywhere on a money or share path.
 * SHARES: integers, carried as `bigint`. Tolerance is exactly zero shares
 * (§11.4.4).
 */
import Decimal from "decimal.js";

/* Match the engine's configured precision so this module and the engine cannot
   disagree because of a precision setting. */
const Dec = Decimal.clone({ precision: 38, toExpNeg: -40, toExpPos: 40 });
export type Dm = InstanceType<typeof Dec>;
export const dm = (v: string | number | Dm): Dm => new Dec(v as never);

/* `ZERO_SHARES` / `1n` literals raise TS2737 under this repo's tsconfig (no explicit
   target), exactly as server/captableCommitStore.ts records. BigInt() calls are
   TS-safe and byte-equivalent. */
const ZERO_SHARES: bigint = BigInt(0);

/* ------------------------------------------------------------------------- */
/* 1. DENOMINATOR LABELS — the substance of Shadie items 2a and 4a, and AC-7. */
/* ------------------------------------------------------------------------- */

/**
 * The five denominators this product may divide by. They are NOT
 * interchangeable and a percentage is meaningless without naming which one it
 * used. `FD_POST` and `FD_POST_EX_POOL` are distinct labels and must not
 * silently alias each other whenever unallocated pool + top-up > 0 (I-8).
 */
export const DENOM_LABELS = [
  "OUTSTANDING",
  "FD_PRE",
  "FD_PRE_INCL_POOL",
  "FD_POST",
  "FD_POST_EX_POOL",
] as const;
export type DenomLabel = (typeof DENOM_LABELS)[number];

/** Founder-facing text for each label. Shown next to every percentage. */
export const DENOM_LABEL_TEXT: Record<DenomLabel, string> = {
  OUTSTANDING:
    "of issued and outstanding shares (common + preferred actually issued; excludes options, warrants and unconverted instruments)",
  FD_PRE:
    "of fully-diluted pre-money shares, BEFORE this round's pool top-up",
  FD_PRE_INCL_POOL:
    "of fully-diluted pre-money shares INCLUDING this round's pool top-up — this is the pricing denominator",
  FD_POST:
    "of fully-diluted post-money shares (pricing denominator + new shares issued in this round)",
  FD_POST_EX_POOL:
    "of fully-diluted post-money shares EXCLUDING the unallocated option pool",
};

/** Short badge form, for tables where the long text will not fit. */
export const DENOM_LABEL_SHORT: Record<DenomLabel, string> = {
  OUTSTANDING: "outstanding",
  FD_PRE: "FD pre-money (pre-pool)",
  FD_PRE_INCL_POOL: "FD pre-money (incl. pool) — pricing denominator",
  FD_POST: "FD post-money",
  FD_POST_EX_POOL: "FD post-money ex-pool",
};

/** A percentage that cannot exist without its denominator. */
export type Pct = {
  /** Percent AS WRITTEN, R16: `40.000` means 40%. Fixed to `decimals`. */
  readonly value: string;
  readonly denominator: DenomLabel;
  /** The exact integer share count that was divided by. */
  readonly denominatorShares: string;
  readonly decimals: number;
};

/** Display precision for every percentage in this wave (§11.4.4, d = 3). */
export const PCT_DECIMALS = 3;

/**
 * Exact fraction (0..1) → percent-as-written string. This is the ONLY
 * multiplication by 100 in the module and it is a display boundary, not a
 * stored conversion (R16 / OR-1).
 */
export function pctFromFraction(
  fraction: Dm,
  denominator: DenomLabel,
  denominatorShares: bigint,
  decimals: number = PCT_DECIMALS,
): Pct {
  return {
    value: fraction.mul(100).toFixed(decimals, Decimal.ROUND_HALF_UP),
    denominator,
    denominatorShares: denominatorShares.toString(),
    decimals,
  };
}

/** Percent-as-written → exact fraction. The inverse boundary. */
export function fractionFromPct(pctAsWritten: string | number): Dm {
  return dm(pctAsWritten).div(100);
}

/** Render a percentage so the denominator can never be dropped in transit. */
export function formatPct(p: Pct): string {
  return `${p.value}% ${DENOM_LABEL_SHORT[p.denominator]}`;
}

/* ------------------------------------------------------------------------- */
/* 2. REFUSALS — an honest "cannot compute" instead of a fabricated number.   */
/* ------------------------------------------------------------------------- */

export type Refusal = {
  readonly ok: false;
  /** Stable machine code, used by tests and by the fence. */
  readonly code: string;
  /** Founder-facing sentence. Says what is missing and what to do. */
  readonly reason: string;
};
export type Ok<T> = { readonly ok: true } & T;
export type Refusable<T> = Ok<T> | Refusal;

export const refuse = (code: string, reason: string): Refusal => ({ ok: false, code, reason });

/** True when a string is a usable positive number. Blank is NOT zero. */
function posNum(s: string | number | null | undefined): Dm | null {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/[,\s$]/g, "");
  if (t === "") return null;
  let d: Dm;
  try {
    d = dm(t);
  } catch {
    return null;
  }
  if (!d.isFinite() || d.lte(0)) return null;
  return d;
}

/** True when a string is a usable non-negative number. Blank is NOT zero. */
function nonNegNum(s: string | number | null | undefined): Dm | null {
  if (s === null || s === undefined) return null;
  const t = String(s).replace(/[,\s$]/g, "");
  if (t === "") return null;
  let d: Dm;
  try {
    d = dm(t);
  } catch {
    return null;
  }
  if (!d.isFinite() || d.lt(0)) return null;
  return d;
}

/**
 * Share counts are integers (I-9). A fractional share-count INPUT is rejected
 * with a named error rather than silently rounded — silent rounding would pass
 * every other invariant while changing the economics. The policy is keyed to
 * the governing statute of the vehicle, never to the currency (AC-9).
 */
export function parseShareCount(
  s: string | number | null | undefined,
  field: string,
): Refusable<{ shares: bigint }> {
  const d = nonNegNum(s);
  if (d === null) return refuse(`${field}_missing`, `${field} is required.`);
  if (!d.isInteger()) {
    return refuse(
      `${field}_fractional`,
      `${field} must be a whole number of shares — “${String(s)}” is fractional. ` +
        `Rounding it silently would change the economics of the round.`,
    );
  }
  return { ok: true, shares: BigInt(d.toFixed(0)) };
}

/* ------------------------------------------------------------------------- */
/* 3. THE PRICING DENOMINATOR — itemised, so the founder can see what it is.  */
/* ------------------------------------------------------------------------- */

/** One line of the pricing denominator, each with its own share count. */
export type DenomItem = {
  readonly key:
    | "common"
    | "preferred_as_converted"
    | "granted_options"
    | "unallocated_pool"
    | "warrants"
    | "converting_instruments"
    | "new_pool_topup"
    | "fd_pre_money_input";
  readonly label: string;
  readonly shares: bigint;
  /**
   * When the data model cannot separate this line from another, the line says
   * so on screen instead of implying a precision the platform does not have.
   * This is the honest answer to Shadie item 4a.
   */
  readonly unavailable?: string;
};

export type Denominator = {
  readonly label: DenomLabel;
  readonly items: readonly DenomItem[];
  readonly shares: bigint;
  /** Set when at least one line is `unavailable`. */
  readonly incomplete: boolean;
  readonly incompleteReasons: readonly string[];
};

export function assembleDenominator(
  label: DenomLabel,
  items: readonly DenomItem[],
): Denominator {
  const shares = items.reduce<bigint>((s, i) => s + i.shares, ZERO_SHARES);
  const incompleteReasons = items
    .filter((i) => i.unavailable)
    .map((i) => `${i.label}: ${i.unavailable}`);
  return { label, items, shares, incomplete: incompleteReasons.length > 0, incompleteReasons };
}

/* ------------------------------------------------------------------------- */
/* 4. PRICE PER SHARE — no fallback. Shadie item 5a.                          */
/* ------------------------------------------------------------------------- */

export type PricingInput = {
  /** Pre-money valuation, in currency units, as typed. */
  readonly preMoneyValuation: string;
  /**
   * Fully-diluted PRE-MONEY share count, as typed by the founder. This is the
   * only acceptable base. It is NOT `sharesAuthorized`, which means "new shares
   * issued in this round" and is a NUMERATOR — see the DB-key note below.
   */
  readonly fdPreMoneyShares: string;
  /** New pool shares carved out of the pre-money, as a SHARE COUNT (Wave 50). */
  readonly poolTopUpShares?: string | null;
  /** Foundation rounds price manually; they have no prior FD count. */
  readonly isFoundationRound?: boolean;
  /** A manual override the founder typed. Wins over derivation when present. */
  readonly manualPricePerShare?: string | null;
};

export type Pricing = {
  /** Exact price per share, full precision. */
  readonly pricePerShare: string;
  readonly denominator: Denominator;
  /** True when the founder typed the price rather than the platform deriving it. */
  readonly manual: boolean;
  /**
   * Pre-money less the value of the new pool carve — what the founder is
   * actually being paid for the pre-existing company (§13.6 of the response).
   */
  readonly effectivePreMoney: string;
};

/**
 * WAVE 52 · ITEM 5a — THE FALLBACK IS GONE.
 *
 * WHAT WAS WRONG. `basePreMoneyShares` read `form.fdPreMoneyShares` and, when
 * it was blank, silently substituted `Number(form.sharesAuthorized)` — the
 * count of NEW shares this round will issue. It then divided the pre-money
 * valuation by that number and printed the result as a price per share, and
 * printed the substituted number on screen next to the words `FD =`.
 *
 * That is wrong in two separate ways. FIRST, it is a numerator used as a
 * denominator: it counts shares that do not exist yet and omits every share
 * that does — founders, granted options, the existing unallocated pool, and any
 * SAFE or note that will convert. SECOND, the number is mislabelled twice: the
 * input is called "Shares authorized" while meaning new shares issued, and the
 * substituted value is displayed as `FD`.
 *
 * DIRECTION OF THE ERROR: the denominator is too small, so the price per share
 * is too high, so the incoming investor is overcharged and every existing
 * holder's percentage is overstated.
 *
 * (Deliberately NOT cited here: charter-authorized capital. The platform never
 * reads an authorized figure — there is no authorized field — so an
 * authorized-capital rationale would put a false sentence in front of a
 * founder. Strategy Review 1 struck it.)
 *
 * DB-KEY MISMATCH, recorded per §11.1: the wire/DB key is still
 * `sharesAuthorized` while its meaning is "new shares issued in this round".
 * The key is persisted through `extras_json` / `UPDATE_EXTRAS_WHITELIST`
 * (server/roundsStore.ts) so renaming it is a data migration with a mirror, and
 * is a named follow-on. Only the UI label is renamed in this wave.
 */
export function derivePricePerShare(input: PricingInput): Refusable<Pricing> {
  const manual = posNum(input.manualPricePerShare);

  const fdInput = posNum(input.fdPreMoneyShares);
  const poolRaw = input.poolTopUpShares ?? null;
  const poolParsed =
    poolRaw === null || String(poolRaw).replace(/[,\s$]/g, "") === ""
      ? { ok: true as const, shares: ZERO_SHARES }
      : parseShareCount(poolRaw, "Pool size (shares)");
  if (!poolParsed.ok) return poolParsed;

  if (input.isFoundationRound) {
    if (!manual) {
      return refuse(
        "foundation_requires_manual_pps",
        "A Foundation round is the formation event: there is no prior fully-diluted " +
          "share count to divide by, so the price per share must be entered manually.",
      );
    }
    const denominator = assembleDenominator("FD_PRE_INCL_POOL", []);
    return {
      ok: true,
      pricePerShare: manual.toFixed(),
      denominator,
      manual: true,
      effectivePreMoney: "0",
    };
  }

  if (fdInput === null) {
    return refuse(
      "fd_pre_money_shares_missing",
      "Cannot price this round: Fully-diluted pre-money shares is blank. " +
        "Capavate will not substitute another number for it — the count of NEW shares " +
        "this round issues is a numerator, not a denominator, and using it would " +
        "overprice the round and overstate every existing holder's percentage.",
    );
  }
  const fdIntegral = parseShareCount(input.fdPreMoneyShares, "Fully-diluted pre-money shares");
  if (!fdIntegral.ok) return fdIntegral;

  const denominator = assembleDenominator("FD_PRE_INCL_POOL", [
    {
      key: "fd_pre_money_input",
      label: "Fully-diluted pre-money shares (as entered)",
      shares: fdIntegral.shares,
      unavailable:
        "the data model cannot yet separate granted options from the unallocated pool, " +
        "so this single figure covers common, preferred as-converted, granted options, " +
        "the existing unallocated pool and warrants without itemising them",
    },
    {
      key: "new_pool_topup",
      label: "New option-pool top-up carved out of the pre-money",
      shares: poolParsed.shares,
    },
  ]);

  if (manual) {
    /* A manual price is a fact the founder asserted; we do not overwrite it.
       We still itemise the denominator so the implied valuation is visible. */
    return {
      ok: true,
      pricePerShare: manual.toFixed(),
      denominator,
      manual: true,
      effectivePreMoney: dm(denominator.shares.toString())
        .minus(poolParsed.shares.toString())
        .mul(manual)
        .toFixed(),
    };
  }

  const pmv = posNum(input.preMoneyValuation);
  if (pmv === null) {
    return refuse(
      "pre_money_missing",
      "Cannot price this round: Pre-money valuation is blank. A blank valuation is " +
        "not $0 — enter the agreed pre-money, or enter a price per share directly.",
    );
  }
  if (denominator.shares <= ZERO_SHARES) {
    return refuse(
      "denominator_zero",
      "Cannot price this round: the fully-diluted pre-money share count is zero.",
    );
  }

  /* p = PMV ÷ D, where D INCLUDES the new pool top-up. A share count
     round-trips exactly: for a pool of S shares on a pre-pool base of F,
     π = S/(F+S) and F/(1−π) == F + S exactly (Wave 50, invariant I-7). */
  const pps = pmv.div(dm(denominator.shares.toString()));
  const poolValue = dm(poolParsed.shares.toString()).mul(pps);

  return {
    ok: true,
    pricePerShare: pps.toFixed(),
    denominator,
    manual: false,
    effectivePreMoney: pmv.minus(poolValue).toFixed(),
  };
}

/* ------------------------------------------------------------------------- */
/* 5. INVESTOR SHARES FROM A CHEQUE — Shadie item 3a, and AC-14.              */
/* ------------------------------------------------------------------------- */

/**
 * `I` is two quantities and they are never conflated (§11.4.2):
 *   I_committed — what the investor subscribed / wired
 *   I_applied   — N·p, the cash actually converted into shares
 *   r           — I_committed − I_applied, with 0 ≤ r < p
 */
export type ShareDerivation = {
  readonly shares: bigint;
  readonly committed: string;
  readonly applied: string;
  readonly residual: string;
  readonly pricePerShare: string;
  /** The micro-scaled integer path the ledger's batch handler uses. */
  readonly sharesMicroPath: bigint;
  /** True when the two production paths agree, which they must on any fixture. */
  readonly pathsAgree: boolean;
};

/**
 * Reproduces the ledger's derivation EXACTLY, both of its paths.
 *
 * Path A (`server/captableCommitStore.ts` reconcile reference):
 *     floor( Decimal(amount) ÷ Decimal(pps) )
 * Path B (the batch commit handler's micro-scaled integer path):
 *     amtMicro = round(amount × 1e6); ppsMicro = round(pps × 1e6)
 *     floor( (amtMicro × SCALE) ÷ (ppsMicro × SCALE) )   — SCALE cancels exactly
 *
 * Both are `floor`, never `round`: `round` would fabricate a share at the
 * boundary and the ledger would refuse the founder's own preview. Neither
 * sacred file is edited; this preview is held to their observed behaviour.
 */
export function deriveInvestorShares(
  amountCommitted: string,
  pricePerShare: string,
): Refusable<ShareDerivation> {
  const amt = nonNegNum(amountCommitted);
  if (amt === null) {
    return refuse(
      "amount_missing",
      "Cannot derive a share count: the investment amount is blank. A blank amount is not $0.",
    );
  }
  const p = posNum(pricePerShare);
  if (p === null) {
    return refuse(
      "pps_missing",
      "Cannot derive a share count: there is no price per share yet.",
    );
  }

  const sharesDec = amt.div(p).floor();
  const shares = BigInt(sharesDec.toFixed(0));
  const applied = sharesDec.mul(p);
  const residual = amt.minus(applied);

  const SCALE = BigInt("1000000");
  const amtMicro = BigInt(amt.mul(1_000_000).toFixed(0));
  const ppsMicro = BigInt(p.mul(1_000_000).toFixed(0));
  const sharesMicroPath = ppsMicro > ZERO_SHARES ? (amtMicro * SCALE) / (ppsMicro * SCALE) : ZERO_SHARES;

  return {
    ok: true,
    shares,
    committed: amt.toFixed(),
    applied: applied.toFixed(),
    residual: residual.toFixed(),
    pricePerShare: p.toFixed(),
    sharesMicroPath,
    pathsAgree: shares === sharesMicroPath,
  };
}

/**
 * Residual disposition is a STORED, ENUMERATED value, not prose (§11.4.3).
 * There is NO default: a round with a non-zero residual and no disposition is
 * an incomplete round and the disclosure says so.
 */
export const RESIDUAL_DISPOSITIONS = [
  "returned",
  "not_called",
  "credited_next_close",
  "waived",
  "subscription_receivable",
  "subscription_payable",
  "retained_by_agreement",
] as const;
export type ResidualDisposition = (typeof RESIDUAL_DISPOSITIONS)[number];

export const RESIDUAL_DISPOSITION_TEXT: Record<ResidualDisposition, string> = {
  returned: "refunded to the investor — it leaves the cap table",
  not_called: "never drawn — disclose as uncalled",
  credited_next_close: "held against a future closing and re-applied at that close's price",
  waived: "waived by the investor — a contribution without shares",
  subscription_receivable: "booked as a subscription receivable, not as shares",
  subscription_payable: "booked as a subscription payable, not as shares",
  retained_by_agreement: "retained under the subscription agreement",
};

export function describeResidual(
  d: ShareDerivation,
  disposition: ResidualDisposition | null,
): string {
  if (dm(d.residual).isZero()) {
    return `$${d.committed} at $${d.pricePerShare} per share buys ${d.shares.toString()} shares exactly; nothing is left unapplied.`;
  }
  const head =
    `$${d.committed} at $${d.pricePerShare} per share buys ${d.shares.toString()} shares ` +
    `(rounded DOWN); $${d.residual} remains unapplied.`;
  if (!disposition) {
    return (
      head +
      " This round is INCOMPLETE until the residual's disposition is recorded — " +
      "Capavate will not guess what happens to the money."
    );
  }
  return `${head} Recorded disposition: ${RESIDUAL_DISPOSITION_TEXT[disposition]}.`;
}

/* ------------------------------------------------------------------------- */
/* 6. POST-MONEY — one source, with the residual named. Shadie item 1a.       */
/* ------------------------------------------------------------------------- */

export type PostMoney = {
  /** T·p — the ONE post-money this product may show. */
  readonly postMoneyValuation: string;
  /** PMV + I_committed, shown BESIDE T·p whenever they differ. */
  readonly preMoneyPlusCommitted: string | null;
  /** Σr — why the two figures differ. */
  readonly residualTotal: string;
  /** Post-money fully-diluted share count, T. */
  readonly postMoneyShares: bigint;
  readonly pricePerShare: string;
  /** True when T·p and PMV + I differ and both must therefore be rendered. */
  readonly figuresDiffer: boolean;
  /** The reconciliation equation, as displayable text. */
  readonly reconciliation: string;
};

/**
 * WAVE 52 · ITEM 1a — THE BOX WAS THE BUG.
 *
 * WHAT WAS WRONG. Step 2 rendered "Implied post-money" as
 * `Number(form.preMoney) + Number(form.targetAmount)` under a tooltip promising
 * "pre-money + target raise". On a Common round `targetAmount` is not a field
 * the instrument collects, so the addend was always `NaN → 0` and the box
 * displayed the PRE-money under a post-money label. The box was structurally
 * incapable of being a calculation. It is the bug, not the missing input.
 *
 * WHAT REPLACES IT. Post-money has exactly ONE source: T·p, where
 * T = D + N is the post-money fully-diluted count and p is the round price.
 *
 * WHAT IS NOT "FIXED". For a Common round the server derives the raise as
 * `pricePerShare × sharesAuthorized` and stores it as `targetAmount`
 * (server/routes.ts). Since the multiplicand means NEW SHARES ISSUED, the
 * product is price × new shares = the NOTIONAL PRIMARY RAISE. That is a
 * defensible derivation and it is disclosed AS A RAISE AMOUNT. It is not turned
 * into a post-money.
 *
 * THE IDENTITY, STATED HONESTLY (§11.4.1). Given N = floor(I/p) and
 * r = I − N·p with 0 ≤ r < p:
 *     T·p = (T − N)·p + N·p
 *     if T − N = D:  T·p = PMV + I − r      ← the only form asserted
 * Exact `T·p = PMV + I` requires BOTH T − N = D AND r = 0. The biconditional
 * some earlier drafts asserted is withdrawn in both directions.
 */
export function computePostMoney(args: {
  readonly denominator: Denominator;
  readonly pricePerShare: string;
  readonly derivations: readonly ShareDerivation[];
  readonly preMoneyValuation?: string | null;
  /** Shares issued post-closing that sit OUTSIDE the priced denominator. */
  readonly sharesOutsideDenominator?: bigint;
}): Refusable<PostMoney> {
  const p = posNum(args.pricePerShare);
  if (p === null) {
    return refuse("pps_missing", "Post-money cannot be computed without a price per share.");
  }
  if (args.denominator.shares <= ZERO_SHARES) {
    return refuse(
      "denominator_missing",
      "Post-money cannot be computed without a fully-diluted pre-money share count. " +
        "It is not $0 — it is unknown, and Capavate will not print a number it cannot compute.",
    );
  }
  if (args.derivations.length === 0) {
    return refuse(
      "no_investment",
      "Post-money cannot be computed yet: no investment amount has been entered for this round.",
    );
  }

  const outside = args.sharesOutsideDenominator ?? ZERO_SHARES;
  const newShares = args.derivations.reduce<bigint>((s, d) => s + d.shares, ZERO_SHARES);
  const T = args.denominator.shares + newShares + outside;
  const Tp = dm(T.toString()).mul(p);

  const committedTotal = args.derivations.reduce<Dm>((s, d) => s.plus(dm(d.committed)), dm(0));
  const residualTotal = args.derivations.reduce<Dm>((s, d) => s.plus(dm(d.residual)), dm(0));

  const pmv = args.preMoneyValuation === undefined || args.preMoneyValuation === null
    ? null
    : nonNegNum(args.preMoneyValuation);
  const pmvPlusI = pmv === null ? null : pmv.plus(committedTotal);
  const figuresDiffer = pmvPlusI !== null && !pmvPlusI.eq(Tp);

  /* Universal reconciliation, asserted in ALL cases including multi-close:
       T·p − PMV − ΣI == −Σr + Σ(shares outside D)·p                       */
  const lhs = pmv === null ? null : Tp.minus(pmv).minus(committedTotal);
  const rhs = residualTotal.neg().plus(dm(outside.toString()).mul(p));
  const reconciliation =
    lhs === null
      ? `T·p = ${T.toString()} × $${p.toFixed()} = $${Tp.toFixed()}. ` +
        `Pre-money was not supplied, so PMV + I cannot be shown for comparison.`
      : `T·p − PMV − ΣI = $${lhs.toFixed()}, and −Σr + Σ(shares outside the priced denominator)·p = $${rhs.toFixed()}. ` +
        (lhs.eq(rhs)
          ? "These agree exactly, as they must."
          : "THESE DO NOT AGREE — the round does not reconcile and must not be created.");

  return {
    ok: true,
    postMoneyValuation: Tp.toFixed(),
    preMoneyPlusCommitted: pmvPlusI === null ? null : pmvPlusI.toFixed(),
    residualTotal: residualTotal.toFixed(),
    postMoneyShares: T,
    pricePerShare: p.toFixed(),
    figuresDiffer,
    reconciliation,
  };
}

/**
 * The Common-round NOTIONAL PRIMARY RAISE, disclosed as a raise amount and
 * never as a post-money. Uses the same exact-decimal multiplication as the
 * server's derivation so the founder is shown what the platform will store.
 */
export function commonNotionalRaise(
  pricePerShare: string,
  newSharesIssued: string,
): Refusable<{ raise: string; newShares: bigint }> {
  const p = posNum(pricePerShare);
  if (p === null) return refuse("pps_missing", "No price per share yet.");
  const n = parseShareCount(newSharesIssued, "New shares issued in this round");
  if (!n.ok) return n;
  return { ok: true, raise: p.mul(dm(n.shares.toString())).toFixed(), newShares: n.shares };
}

/* ------------------------------------------------------------------------- */
/* 7. CONVERSION TRIGGER — fail-closed. §11.5.1 / AC-17.                      */
/* ------------------------------------------------------------------------- */

export const CONVERSION_STATUSES = [
  "converts_in_this_round",
  "does_not_convert",
  "undetermined",
] as const;
export type ConversionStatus = (typeof CONVERSION_STATUSES)[number];

export const CONVERSION_TRIGGER_BASES = [
  "qualified_financing_threshold_met",
  "elective",
  "cap_binding",
  "discount_binding",
  "mfn",
] as const;
export type ConversionTriggerBasis = (typeof CONVERSION_TRIGGER_BASES)[number];

export type ConvertingInstrument = {
  readonly id: string;
  readonly kind: "safe_post" | "safe_pre" | "convertible_note";
  readonly status: ConversionStatus;
  readonly triggerBasis?: ConversionTriggerBasis | null;
  /** As-converted share count, when it can be computed. */
  readonly shares?: bigint | null;
  /** Notes only: whether the accrued-interest data path is complete. */
  readonly accruedInterestModelled?: boolean;
};

export type ConversionDisclosure = {
  /** Shares that enter `D`. `undetermined` instruments are EXCLUDED. */
  readonly includedShares: bigint;
  readonly included: readonly ConvertingInstrument[];
  readonly excluded: readonly ConvertingInstrument[];
  /** True when the price must be presented as PROVISIONAL, not final. */
  readonly priceIsProvisional: boolean;
  readonly provisionalReasons: readonly string[];
};

/**
 * `undetermined` FAILS CLOSED: the instrument is excluded from `D` AND the
 * denominator disclosure states that a converting instrument is unresolved and
 * the price is provisional. It is never silently included and never silently
 * dropped — both of those change `D`, `p`, `N` and every holder's percentage.
 *
 * A note whose accrued interest is not modelled produces a REFUSAL to call the
 * price final, not a silent zero-interest conversion: the wizard collects APR
 * and maturity months but no issue date, day-count convention or compounding
 * term, so elapsed years cannot be supplied. Omitting accrued interest
 * understates note shares and overstates founders.
 */
export function discloseConversions(
  instruments: readonly ConvertingInstrument[],
): ConversionDisclosure {
  const included: ConvertingInstrument[] = [];
  const excluded: ConvertingInstrument[] = [];
  const provisionalReasons: string[] = [];

  for (const i of instruments) {
    if (i.status === "converts_in_this_round") {
      if (i.shares === null || i.shares === undefined) {
        excluded.push(i);
        provisionalReasons.push(
          `${i.id} is marked as converting in this round but its as-converted share count ` +
            `cannot be computed, so it is EXCLUDED from the pricing denominator and the price is provisional.`,
        );
        continue;
      }
      if (i.kind === "convertible_note" && i.accruedInterestModelled !== true) {
        included.push(i);
        provisionalReasons.push(
          `${i.id}: accrued interest is not modelled — the wizard collects an interest rate and a ` +
            `maturity but no issue date, day-count convention or compounding term, so elapsed years ` +
            `cannot be supplied. The note's converting share count is therefore NOT final, and ` +
            `omitting accrued interest understates the note and overstates founders.`,
        );
        continue;
      }
      included.push(i);
      continue;
    }
    if (i.status === "does_not_convert") {
      excluded.push(i);
      continue;
    }
    /* undetermined — fail closed. */
    excluded.push(i);
    provisionalReasons.push(
      `${i.id} has an UNRESOLVED conversion trigger. It is excluded from the pricing ` +
        `denominator and the price is PROVISIONAL until the trigger is determined. ` +
        `Including it or dropping it silently would change the price and every holder's percentage.`,
    );
  }

  return {
    includedShares: included.reduce<bigint>((s, i) => s + (i.shares ?? ZERO_SHARES), ZERO_SHARES),
    included,
    excluded,
    priceIsProvisional: provisionalReasons.length > 0,
    provisionalReasons,
  };
}

/* ------------------------------------------------------------------------- */
/* 8. THE REVIEW-STEP PREVIEW — the promise Step 1 makes and nothing kept.    */
/* ------------------------------------------------------------------------- */

export type PreviewHolderRow = {
  readonly holder: string;
  readonly shares: bigint;
  /** One percentage per denominator. Never a bare number. */
  readonly percentages: readonly Pct[];
};

export type CapTablePreview = {
  readonly pricing: Pricing;
  readonly derivations: readonly ShareDerivation[];
  readonly postMoney: PostMoney | null;
  readonly rows: readonly PreviewHolderRow[];
  /** Separately rounded exact total — never the sum of the rounded column (I-4). */
  readonly displayedTotals: readonly Pct[];
  readonly conversions: ConversionDisclosure;
  readonly notes: readonly string[];
};

export type PreviewInput = {
  readonly instrument: string;
  readonly pricing: PricingInput;
  /** Existing holders, pre-round. Share counts only; no percentages supplied. */
  readonly existingHolders?: readonly { name: string; shares: string }[];
  /** Committed amounts for this round, per investor. */
  readonly investments?: readonly { name: string; amount: string }[];
  readonly convertingInstruments?: readonly ConvertingInstrument[];
  /** Unallocated pool shares, when the data model can separate them. */
  readonly unallocatedPoolShares?: string | null;
};

/**
 * WAVE 52 · §0 — THE DEAD PROMISE.
 *
 * Step 1 of the wizard tells the founder, verbatim, "Cap-table impact is
 * computed live on Review", and no instrument delivered it: Review rendered one
 * line of text and three checkboxes. Four live walkthroughs confirmed it on
 * Preferred, Common, both SAFEs, the Note and the Option Pool.
 *
 * This function is the instrument that keeps the promise. It returns EITHER a
 * preview OR a named refusal — never a zero and never a blank. Every percentage
 * it emits carries its denominator (AC-7, AC-16).
 */
export function buildCapTablePreview(input: PreviewInput): Refusable<CapTablePreview> {
  const pricing = derivePricePerShare(input.pricing);
  if (!pricing.ok) return pricing;

  const conversions = discloseConversions(input.convertingInstruments ?? []);

  const investments = input.investments ?? [];
  const derivations: ShareDerivation[] = [];
  for (const inv of investments) {
    const d = deriveInvestorShares(inv.amount, pricing.pricePerShare);
    if (!d.ok) return d;
    derivations.push(d);
  }

  const postMoney =
    derivations.length === 0
      ? null
      : (() => {
          const pm = computePostMoney({
            denominator: pricing.denominator,
            pricePerShare: pricing.pricePerShare,
            derivations,
            preMoneyValuation: input.pricing.preMoneyValuation,
          });
          return pm.ok ? pm : null;
        })();

  /* Build the four denominators explicitly. FD_POST and FD_POST_EX_POOL must
     be DISTINCT whenever unallocated pool + top-up > 0 (I-8). */
  const newShares = derivations.reduce<bigint>((s, d) => s + d.shares, ZERO_SHARES);
  const poolItem = pricing.denominator.items.find((i) => i.key === "new_pool_topup");
  const topUp = poolItem?.shares ?? ZERO_SHARES;
  const unallocatedParsed =
    input.unallocatedPoolShares === undefined || input.unallocatedPoolShares === null
      ? { ok: true as const, shares: ZERO_SHARES }
      : parseShareCount(input.unallocatedPoolShares, "Unallocated pool shares");
  if (!unallocatedParsed.ok) return unallocatedParsed;

  const D_pre_incl_pool = pricing.denominator.shares;
  const D_pre = D_pre_incl_pool - topUp;
  const D_post = D_pre_incl_pool + newShares;
  const D_post_ex_pool = D_post - topUp - unallocatedParsed.shares;

  const denomFor: Record<DenomLabel, bigint> = {
    OUTSTANDING: D_pre_incl_pool - topUp - unallocatedParsed.shares,
    FD_PRE: D_pre,
    FD_PRE_INCL_POOL: D_pre_incl_pool,
    FD_POST: D_post,
    FD_POST_EX_POOL: D_post_ex_pool,
  };

  const activeLabels: DenomLabel[] = ["FD_PRE", "FD_PRE_INCL_POOL", "FD_POST"];
  if (D_post_ex_pool !== D_post) activeLabels.push("FD_POST_EX_POOL");

  const holderRows: PreviewHolderRow[] = [];
  for (const h of input.existingHolders ?? []) {
    const parsed = parseShareCount(h.shares, `Shares for ${h.name}`);
    if (!parsed.ok) return parsed;
    holderRows.push({
      holder: h.name,
      shares: parsed.shares,
      percentages: activeLabels
        .filter((l) => denomFor[l] > ZERO_SHARES)
        .map((l) =>
          pctFromFraction(
            dm(parsed.shares.toString()).div(dm(denomFor[l].toString())),
            l,
            denomFor[l],
          ),
        ),
    });
  }
  derivations.forEach((d, idx) => {
    holderRows.push({
      holder: investments[idx]?.name ?? `Investor ${idx + 1}`,
      shares: d.shares,
      percentages: activeLabels
        .filter((l) => denomFor[l] > ZERO_SHARES)
        .map((l) =>
          pctFromFraction(
            dm(d.shares.toString()).div(dm(denomFor[l].toString())),
            l,
            denomFor[l],
          ),
        ),
    });
  });

  /* I-4: the displayed total is a SEPARATELY ROUNDED exact total. Summing the
     rounded column is not an invariant and is never asserted. */
  const totalShares = holderRows.reduce<bigint>((s, r) => s + r.shares, ZERO_SHARES);
  const displayedTotals = activeLabels
    .filter((l) => denomFor[l] > ZERO_SHARES)
    .map((l) =>
      pctFromFraction(dm(totalShares.toString()).div(dm(denomFor[l].toString())), l, denomFor[l]),
    );

  const notes: string[] = [];
  if (pricing.denominator.incomplete) notes.push(...pricing.denominator.incompleteReasons);
  if (conversions.priceIsProvisional) notes.push(...conversions.provisionalReasons);
  notes.push(
    "Structured multi-close is NOT implemented. This round has a single free-text tranche note, " +
      "not dated closings, so a first-close-then-second-close sequence has no model in the platform " +
      "and this preview does not represent one.",
  );
  notes.push(
    "Authorized / issued / reserved / available cannot be shown: Capavate has no authorized-capital " +
      "field, so there is no ceiling to compare against. This is a named follow-on, not a computed blank.",
  );

  return {
    ok: true,
    pricing,
    derivations,
    postMoney,
    rows: holderRows,
    displayedTotals,
    conversions,
    notes,
  };
}

/* ------------------------------------------------------------------------- */
/* 7. WAVE 58 · R27 — THE OPTION POOL IS A PERCENTAGE OF FULLY DILUTED.       */
/* ------------------------------------------------------------------------- */

/**
 * WAVE 58 · owner ruling R27 — "make it a percentage."
 *
 * The wizard's only pool control was a raw SHARE COUNT labelled
 * "Pool size (shares)", which contradicted the platform's own glossary
 * ("ESOP: sized as a % of fully-diluted, refreshed at each round") and is not
 * what investors negotiate. R27 makes the percentage the INPUT and the share
 * count the DERIVED OUTPUT, shown to the founder.
 *
 * UNITS (R16 / OR-1, percent-as-written): `poolPercentPostMoney` is `"25"` for
 * 25%. It is never divided by 100 on the way in and never multiplied by 100 on
 * the way out. The algebra below is stated in percent units for that reason —
 * exactly as `packages/cap-table-engine/src/instruments/esopTopUp.ts` does — so
 * there is no layer at which a unit changes.
 *
 * WHICH DENOMINATOR THE PERCENTAGE IS OF, stated because it is the whole
 * question. It is the **post-money fully-diluted total**, i.e.
 *
 *     (u + S) / (B + S + N) = q
 *
 * where B is the fully-diluted PRE-money base before the top-up but INCLUDING
 * any pool already reserved, u is that pre-existing pool, S is the new top-up
 * and N is the new investor share count. Investors state the pool as a
 * percentage of post-closing fully-diluted capitalisation
 * ([Cooley GO](https://www.cooleygo.com/negotiating-option-pool/)), and the
 * engine's `computeEsopTopUp` solves exactly that condition, so this function
 * and the engine answer the SAME question. That is deliberate: Wave 52c's whole
 * reason for existing was a percentage path the screens did not feed.
 *
 * THE CLOSED FORM. S sits on both sides, because the pool is inside the
 * pre-money denominator that sets the price that sets N. With
 * k = I/(PMV + I) we have B + S + N = (B + S)/(1 − k), so
 *
 *     (u + S) = q·(B + S)/(1 − k)
 *  ⟹  S·((1 − k) − q) = q·B − u·(1 − k)
 *  ⟹  S = (q·B − u·(1 − k)) / ((1 − k) − q)
 *
 * which is `spec/strategy/CAPTABLE_MATH_INDUSTRY_STANDARD.md` §4.3 verbatim
 * (`S = (q·B/(1−k) − u)/(1 − q/(1−k))`, multiplied through by (1 − k)). In
 * percent units, writing qp for the percent-as-written target and noting
 * 1 − k = PMV/(PMV + I):
 *
 *     S = (qp·B·(PMV + I) − 100·u·PMV) / (100·PMV − qp·(PMV + I))
 *
 * ROUNDING. S rounds UP to the next whole share, so the target percentage is
 * MET rather than missed (§4.3: "convention: round up to the next whole share
 * so the target percentage is met, then re-derive p"). The re-derived
 * percentage is returned alongside, so what is displayed is what the share
 * count actually produces and not what was asked for.
 *
 * WHAT THIS FUNCTION DOES NOT DO. It does not guess `u`. If the caller cannot
 * establish the pool already reserved it passes `null`, and this function
 * REFUSES BY NAME rather than assuming zero — assuming zero would over-size the
 * top-up and hand the founder a bigger dilution than they agreed to. That is
 * the R6 honest-refusal rule applied to a share count.
 */
export type PoolPlacement = "pre_money" | "post_money";

/**
 * ═════════════════════════════════════════════════════════════════════════════
 * WAVE 58b · DEFECT 1 — PLACEMENT IS NOW AN ARGUMENT, AND IT CHANGES THE NUMBERS
 * ═════════════════════════════════════════════════════════════════════════════
 * BEFORE THIS WAVE `derivePoolTopUpFromPercent` TOOK NO PLACEMENT ARGUMENT AT
 * ALL. The wizard offered the founder a live choice between
 * `"Pre-money — the founders pay for it alone"` and
 * `"Post-money — everyone pays for it pro-rata"` and then rendered BYTE-IDENTICAL
 * NUMBERS for both, because the selected mode never reached this function. The
 * choice was a dead input of exactly the R21 class. It is now load-bearing.
 *
 * THE ONE THING THAT IS THE SAME IN BOTH MODES — the target condition. In both
 * placements the founder is negotiating a pool measured as a percentage of the
 * POST-money fully-diluted total:
 *
 *     (u + S) / (B + N + S) = q            [q the target, u the existing pool]
 *
 * THE ONE THING THAT DIFFERS — whether S sits inside the PRICING denominator:
 *
 *     pre-money placement :  p = PMV / (B + S)     ← S INSIDE
 *     post-money placement:  p = PMV /  B          ← S OUTSIDE
 *
 * and that single difference is what decides WHO PAYS.
 *
 * AUTHORITY FOR THE PRE-MONEY CONVENTION (and for it being the MARKET DEFAULT).
 * Cooley GO, "Negotiating the option pool": "The pool typically represents the %
 * of the post-closing fully-diluted capitalization of the company available for
 * future employee option grants… Most investors require that the full amount of
 * this 'post-closing' percentage be deemed to be part of the pre-closing
 * capitalization for purposes of calculating their price per share, which means
 * it only dilutes existing holders, not the new shares."
 * <https://www.cooleygo.com/negotiating-option-pool/>
 * The algebra with S on both sides is
 * `spec/strategy/CAPTABLE_MATH_INDUSTRY_STANDARD.md` §4.3, and the
 * effective-pre-money adjustment is the Brown Rudnick / Venture Hacks "option
 * pool shuffle" point recorded in §4.1 of the same file.
 *
 * AUTHORITY FOR THE POST-MONEY CONVENTION — WEAKER, AND SAID SO PLAINLY. There
 * is no NVCA/Cooley/WSGR model form that prices a round with the new reserve
 * OUTSIDE the pre-money denominator; the model documents assume the pre-money
 * placement above. Post-money placement is a NEGOTIATED DEPARTURE from the model
 * form, most often seen when a founder refuses the shuffle. The arithmetic used
 * here is therefore derived from first principles from the same target condition
 * — it is NOT quoted from an authority, and this comment does not imply a
 * consensus that does not exist. What IS load-bearing and checkable is that the
 * result is exactly pro-rata: see `W58B_PLACEMENT_MATH.md`, which proves the
 * founders' and the new investor's percentage-point giveback stand in exactly
 * the ratio of their pre-pool holdings.
 *
 * WHICH "FULLY DILUTED" — STATED, BECAUSE AN UNSTATED DEFINITION IS THE SINGLE
 * MOST COMMON SOURCE OF CAP-TABLE DISPUTES. `B` here is whatever the caller
 * supplies as `fdPreMoneyShares`, and on the wizard that is the founder-declared
 * fully-diluted pre-money count. `fdDefinition` on the result names its
 * composition so the screen can print it. Capavate's composition is:
 * issued common + issued preferred + ALL option-plan shares (granted AND
 * unallocated, which the data model cannot separate) + warrants' underlying
 * shares + shares from SAFEs/notes THAT CONVERT AT THIS ROUND. It EXCLUDES
 * unissued authorised (charter) capital — there is no authorised-capital field
 * anywhere in the schema, so it could not be included even if the convention
 * called for it (WSGR: authorised capital is not a denominator).
 */
export type PoolPercentInput = {
  /** PERCENT-AS-WRITTEN (R16). `"25"` = 25%. Range `[0, 100)`. */
  readonly poolPercentPostMoney: string;
  /**
   * WAVE 58b · DEFECT 1 — WHO PAYS. `"pre_money"` puts the new reserve inside
   * the pricing denominator (Cooley/WSGR market default, founders bear it
   * alone); `"post_money"` leaves it outside, so founders and the incoming
   * investor dilute pro-rata. REQUIRED, not optional and not defaulted here: a
   * default inside this function is how the old code silently priced every
   * post-money round as pre-money.
   */
  readonly poolPlacement: PoolPlacement;
  /**
   * Fully-diluted PRE-money share count before the top-up, INCLUDING any pool
   * already reserved. This is the wizard's `fdPreMoneyShares` field.
   */
  readonly fdPreMoneyShares: string;
  /** Pre-money valuation, as typed. */
  readonly preMoneyValuation: string;
  /** The round's committed/target raise, as typed. */
  readonly investmentAmount: string;
  /**
   * Shares ALREADY reserved under the plan, as an integer string. `null` means
   * "not established" and produces a named refusal, never an assumed zero.
   */
  readonly existingPoolShares: string | null;
};

export type PoolPercentDerivation = {
  /** The derived top-up, rounded UP to a whole share. */
  readonly poolTopUpShares: bigint;
  /** Existing + derived, i.e. what the plan will hold after the round. */
  readonly resultingPoolShares: bigint;
  /** Post-money fully-diluted total the percentage below is measured against. */
  readonly postMoneyFdShares: bigint;
  /**
   * The percentage the DERIVED SHARE COUNT actually produces, percent-as-written,
   * with its denominator label attached. Never the number the founder typed.
   */
  readonly resultingPoolPercent: Pct;
  /** The target as typed, echoed in the same unit it arrived in. */
  readonly targetPercentAsWritten: string;
  /** New investor shares implied by the grossed-up price. */
  readonly newInvestorShares: bigint;
  /** Price per share after the gross-up — the number Step 2 must show. */
  readonly pricePerShare: string;
  /**
   * WAVE 58 · SCOPE 3 — the pool-adjusted pre-money. A PRE-MONEY pool dilutes
   * founders alone, so the headline pre-money is not what the founder is being
   * paid for the company they already have.
   */
  readonly effectivePreMoney: string;
  /** WAVE 58b · DEFECT 1 — echoed back so a caller can never lose it. */
  readonly placement: PoolPlacement;
  /**
   * WAVE 58b · DEFECT 1 — the PRICING denominator actually used. Under
   * pre-money placement this is `B + S`; under post-money placement it is `B`.
   * This is the number that makes the two modes produce different prices, so it
   * is returned rather than left to be re-derived.
   */
  readonly pricingDenominatorShares: bigint;
  /**
   * WAVE 58b · DEFECT 1 — plain-language statement of WHO BEARS THE DILUTION
   * under the selected placement, with the derivation. Rendered on screen.
   */
  readonly whoPays: string;
  /**
   * WAVE 58b — the fully-diluted definition `B` was measured under, named so a
   * founder can hand the screen to their lawyer and have it reconcile.
   */
  readonly fdDefinition: string;
  /** On-screen derivation lines. Rendered, not just returned. */
  readonly derivation: readonly string[];
};

/** R16 range check for a user-supplied percentage. Named refusals only. */
export function parsePoolPercentAsWritten(
  raw: string | number | null | undefined,
  field = "Pool size (% of fully-diluted)",
): Refusable<{ percent: Dm }> {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return refuse(
      "pool_percent_missing",
      `${field} is required. A blank pool target is not 0% — enter the percentage you have agreed, or turn the option pool off.`,
    );
  }
  const t = String(raw).replace(/[,\s%]/g, "");
  let d: Dm;
  try {
    d = dm(t);
  } catch {
    return refuse(
      "pool_percent_not_a_number",
      `${field} must be a number. “${String(raw)}” is not one, and Capavate will not guess at what you meant.`,
    );
  }
  if (!d.isFinite()) {
    return refuse(
      "pool_percent_not_finite",
      `${field} must be a finite number. “${String(raw)}” is not.`,
    );
  }
  if (d.lt(0)) {
    return refuse(
      "pool_percent_negative",
      `${field} cannot be negative. A negative pool would un-reserve shares, which is a cancellation, not a top-up.`,
    );
  }
  /* R16 range is [0, 100). 100% is refused BY NAME because it means the pool is
     the entire company: the gross-up 1/(1 − 1) does not exist. */
  if (d.gte(100)) {
    return refuse(
      "pool_percent_out_of_range",
      `${field} must be less than 100%. “${String(raw)}” would reserve the whole company for the option plan — the gross-up divides by (100 − target), which is zero or negative here.`,
    );
  }
  /* R16 is explicit that magnitude is NOT evidence of unit: 0.25 is a quarter of
     one percent and is a legitimate value, not a mis-scaled 25%. So there is no
     "did you mean 25?" coercion here, only the honest range. */
  return { ok: true, percent: d };
}

export function derivePoolTopUpFromPercent(
  input: PoolPercentInput,
): Refusable<PoolPercentDerivation> {
  const pct = parsePoolPercentAsWritten(input.poolPercentPostMoney);
  if (!pct.ok) return pct;
  const qp = pct.percent;

  const base = parseShareCount(input.fdPreMoneyShares, "Fully-diluted pre-money shares");
  if (!base.ok) return base;
  const B = base.shares;
  if (B <= ZERO_SHARES) {
    return refuse(
      "pool_percent_base_zero",
      "Cannot size the option pool: the fully-diluted pre-money share count is zero, so there is nothing to take a percentage of.",
    );
  }

  if (input.existingPoolShares === null) {
    return refuse(
      "existing_pool_unknown",
      "Cannot size the option pool: Capavate has not established how many shares are already reserved under your plan. " +
        "It will not assume zero — assuming zero would over-size the top-up and dilute you by more than you agreed.",
    );
  }
  const existing = parseShareCount(input.existingPoolShares, "Shares already reserved");
  if (!existing.ok) return existing;
  const u = existing.shares;

  const pmv = posNum(input.preMoneyValuation);
  if (pmv === null) {
    return refuse(
      "pre_money_missing_for_pool",
      "Cannot size the option pool as a percentage of post-money: Pre-money valuation is blank. " +
        "A blank valuation is not $0 — the pool percentage is measured against the post-money total, which needs it.",
    );
  }
  const inv = posNum(input.investmentAmount);
  if (inv === null) {
    return refuse(
      "investment_missing_for_pool",
      "Cannot size the option pool as a percentage of post-money: the round's raise amount is blank. " +
        "The post-money total is pre-money shares plus the pool plus the shares the raise buys, so the raise is required.",
    );
  }

  const pmvPlusI = pmv.plus(inv);
  const isPostMoneyPlacement = input.poolPlacement === "post_money";

  /* ═══════════════════════════════════════════════════════════════════════════
     WAVE 58b · DEFECT 1 — THE TWO PLACEMENTS, SOLVED SEPARATELY.
     ═══════════════════════════════════════════════════════════════════════════
     Both solve the SAME target condition (u + S)/(B + N + S) = q. They differ in
     one place only: whether S is inside the pricing denominator.

     PRE-MONEY (Cooley GO, market default — S INSIDE). p = PMV/(B + S), so N
     depends on S and S is on both sides. `CAPTABLE_MATH_INDUSTRY_STANDARD.md`
     §4.3 solves it; in percent-as-written units (R16, no conversion layer):

         S = (qp·B·(PMV + I) − 100·u·PMV) / (100·PMV − qp·(PMV + I))

     POST-MONEY (negotiated departure — S OUTSIDE). p = PMV/B is fixed by the
     valuation alone, so N is known before S and S no longer appears on both
     sides. The same target condition collapses to a one-line gross-up, which is
     the ordinary §4.2 form `F/(1 − p) = F + S` applied to the post-round base:

         S = (qp·(B + N) − 100·u) / (100 − qp)

     Neither branch divides a percentage by 100 anywhere: both are the fraction
     form multiplied through by 100 on numerator AND denominator (R16). */
  let S: bigint;
  let pps: Dm;
  let N: bigint;
  let D: bigint;
  if (isPostMoneyPlacement) {
    /* The price is set by the pre-money valuation over the EXISTING base. The
       pool is created after the round closes, so it never touches this price. */
    D = B;
    pps = pmv.div(dm(B.toString()));
    N = BigInt(inv.div(pps).floor().toFixed(0));      // share counts round DOWN
    const numerator = qp.mul(dm((B + N).toString())).minus(dm(u.toString()).mul(100));
    const denominator = dm(100).minus(qp);
    if (denominator.lte(0)) {
      /* Unreachable through `parsePoolPercentAsWritten` (which caps at <100), but
         fail-closed by name rather than relying on a caller's validation. */
      return refuse(
        "pool_percent_ungrossable",
        `A pool of ${qp.toFixed()}% of post-money cannot be created: the gross-up denominator 100 − target is zero or negative.`,
      );
    }
    const sExact = numerator.div(denominator);
    S = sExact.lte(0) ? ZERO_SHARES : BigInt(sExact.ceil().toFixed(0));
  } else {
    /* S = (qp·B·(PMV + I) − 100·u·PMV) / (100·PMV − qp·(PMV + I)), exact decimals. */
    const numerator = qp.mul(dm(B.toString())).mul(pmvPlusI).minus(dm(u.toString()).mul(100).mul(pmv));
    const denominator = pmv.mul(100).minus(qp.mul(pmvPlusI));
    if (denominator.lte(0)) {
      return refuse(
        "pool_percent_ungrossable",
        `A pool of ${qp.toFixed()}% of post-money cannot be created at this valuation and raise: ` +
          `the gross-up denominator 100·pre-money − target·(pre-money + raise) is zero or negative. ` +
          `The raise is large enough relative to the pre-money that the requested pool cannot be carved out of it.`,
      );
    }

    /* A negative S means the pool ALREADY exceeds the target: no top-up, and we
       say so rather than reserving a negative number of shares. */
    const sExact = numerator.div(denominator);
    S = sExact.lte(0) ? ZERO_SHARES : BigInt(sExact.ceil().toFixed(0));

    D = B + S;                                       // pricing denominator
    pps = pmv.div(dm(D.toString()));
    N = BigInt(inv.div(pps).floor().toFixed(0));      // share counts round DOWN
  }

  const T = B + S + N;                               // post-money FD total
  const resultingPool = u + S;

  const resultingPct = pctFromFraction(
    dm(resultingPool.toString()).div(dm(T.toString())),
    "FD_POST",
    T,
  );

  /* ═══════════════════════════════════════════════════════════════════════════
     EFFECTIVE PRE-MONEY — ONE DEFINITION, BOTH MODES: B · p.
     ═══════════════════════════════════════════════════════════════════════════
     The value the round's own price puts on the shares that existed BEFORE it.
     Under PRE-money placement B·p = PMV − S·p, which is the Brown Rudnick /
     Venture Hacks "illusory pre-money" figure verbatim
     (`CAPTABLE_MATH_INDUSTRY_STANDARD.md` §4.1 and §12 Step 3). Under POST-money
     placement S is not in the pricing denominator, so B·p = PMV exactly: the
     headline valuation is honest and the founder is NOT charged for the pool at
     the pricing step. Using ONE formula for both is deliberate — two formulas
     would let the two screens disagree, which is the whole class of defect this
     wave is closing. */
  const effectivePreMoney = dm(B.toString()).mul(pps);

  /* WAVE 58b · DEFECT 1 — WHO PAYS, IN PLAIN LANGUAGE, WITH THE DERIVATION.
     Rendered on screen (`addon-pool-who-pays`), not merely returned. */
  const poolCostToExistingHolders = pmv.minus(effectivePreMoney);
  const whoPays = isPostMoneyPlacement
    ? `POST-MONEY placement — EVERYONE PAYS, PRO-RATA. The ${S.toLocaleString()} new pool shares are ` +
      `created after the round closes, so they are NOT in the pricing denominator: the price per share is ` +
      `pre-money ÷ ${B.toLocaleString()} = ${pps.toFixed()}, unchanged by the pool. Effective pre-money is ` +
      `therefore the full ${effectivePreMoney.toFixed()} — the headline figure, with nothing carved out of it. ` +
      `You and the incoming investor are then diluted by the pool in exact proportion to what each of you ` +
      `holds immediately after the raise. NOTE, because it matters commercially: this is a NEGOTIATED ` +
      `DEPARTURE from the NVCA/Cooley model form, and the incoming investor ends up with LESS than the ` +
      `${dm(100).mul(inv).div(pmvPlusI).toFixed(4)}% of post-money that their money would otherwise buy, so ` +
      `expect it to be pushed back on.`
    : `PRE-MONEY placement — THE EXISTING HOLDERS PAY FOR IT ALONE. The ${S.toLocaleString()} new pool shares ` +
      `sit INSIDE the pre-money pricing denominator (${B.toLocaleString()} + ${S.toLocaleString()} = ` +
      `${D.toLocaleString()}), which lowers the price per share to ${pps.toFixed()} and hands the incoming ` +
      `investor more shares for the same money. Effective pre-money is ${B.toLocaleString()} × ${pps.toFixed()} = ` +
      `${effectivePreMoney.toFixed()} against a headline of ${pmv.toFixed()} — a difference of ` +
      `${poolCostToExistingHolders.toFixed()}, which is what the pool costs you. This is the market default ` +
      `(Cooley GO, "Negotiating the option pool"): most investors require it.`;

  const fdDefinition =
    "Fully diluted = issued common + issued preferred + ALL option-plan shares (granted options AND the " +
    "unallocated reserve — Capavate's data model cannot separate them) + warrants' underlying shares + " +
    "shares from SAFEs/notes converting at this round. It EXCLUDES unissued authorised (charter) capital, " +
    "which Capavate never treats as a denominator.";

  const derivation = [
    `Target: ${qp.toFixed()}% of post-money fully-diluted (percent-as-written — 25 means 25%).`,
    `Placement: ${isPostMoneyPlacement ? "POST-MONEY — everyone pays pro-rata" : "PRE-MONEY — the existing holders pay alone (market default)"}.`,
    `Already reserved under the plan: ${u.toLocaleString()} shares.`,
    `Fully-diluted pre-money shares before the top-up: ${B.toLocaleString()}.`,
    isPostMoneyPlacement
      ? `Price per share FIRST, because a post-money pool is not in the pricing denominator: pre-money ÷ ${B.toLocaleString()} = ${pps.toFixed()}.`
      : `New top-up derived: S = (${qp.toFixed()}·${B.toLocaleString()}·(pre-money + raise) − 100·${u.toLocaleString()}·pre-money) ÷ (100·pre-money − ${qp.toFixed()}·(pre-money + raise)) = ${S.toLocaleString()} shares (rounded UP so the target is met, never missed).`,
    isPostMoneyPlacement
      ? `New investor shares: raise ÷ price = ${N.toLocaleString()} (rounded down).`
      : `Pricing denominator: ${B.toLocaleString()} + ${S.toLocaleString()} = ${D.toLocaleString()} shares — the pool is INSIDE the pre-money, so it lowers the price per share.`,
    isPostMoneyPlacement
      ? `New top-up derived on the POST-ROUND base: S = (${qp.toFixed()}·(${B.toLocaleString()} + ${N.toLocaleString()}) − 100·${u.toLocaleString()}) ÷ (100 − ${qp.toFixed()}) = ${S.toLocaleString()} shares (rounded UP so the target is met, never missed).`
      : `Price per share: pre-money ÷ ${D.toLocaleString()} = ${pps.toFixed()}.`,
    isPostMoneyPlacement
      ? `Pricing denominator: ${D.toLocaleString()} shares — the pool is OUTSIDE it, so the price is unchanged by the pool.`
      : `New investor shares: raise ÷ price = ${N.toLocaleString()} (rounded down).`,
    `Post-money fully-diluted total: ${B.toLocaleString()} + ${S.toLocaleString()} + ${N.toLocaleString()} = ${T.toLocaleString()} shares.`,
    `Resulting pool: ${u.toLocaleString()} + ${S.toLocaleString()} = ${resultingPool.toLocaleString()} shares = ${formatPct(resultingPct)}.`,
    `Effective (pool-adjusted) pre-money: ${B.toLocaleString()} × ${pps.toFixed()} = ${effectivePreMoney.toFixed()} (headline ${pmv.toFixed()}). ` +
      (isPostMoneyPlacement
        ? `A post-money pool leaves the headline pre-money intact — nothing is carved out of it — and its dilution is shared pro-rata with the incoming investor.`
        : `A pre-money pool is paid for by the existing holders alone.`),
    fdDefinition,
  ];

  return {
    ok: true,
    poolTopUpShares: S,
    resultingPoolShares: resultingPool,
    postMoneyFdShares: T,
    resultingPoolPercent: resultingPct,
    targetPercentAsWritten: qp.toFixed(),
    newInvestorShares: N,
    pricePerShare: pps.toFixed(),
    effectivePreMoney: effectivePreMoney.toFixed(),
    placement: input.poolPlacement,
    pricingDenominatorShares: D,
    whoPays,
    fdDefinition,
    derivation,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 58c · A1 — THE SAVED PRICE AND THE DERIVED PRICE, COMPARED EXACTLY.
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT (independent review `W58B_REVIEW_3_RISK.md` §5.1, `file:line`
 * evidence taken from that review rather than re-derived): in the Edit-terms
 * dialog `client/src/pages/founder/Rounds.tsx`, `pricePerShare` is plain dialog
 * state seeded from the round (`:305`), edited only by the "Price per share
 * (USD)" input (`:458`) and sent VERBATIM on save (`:399`), while the pool block
 * renders a DERIVED price (`:613`). `setPricePerShare` occurs exactly twice in
 * that file, so there is no effect, no synchronisation and no warning between
 * them: the dialog can display "$1.60" derived and "1.80" in the input at the
 * same time, and SAVE STORES 1.80.
 *
 * WHY THAT IS DATA AND NOT PIXELS. The stored price is what the SACRED funded
 * commit path turns dollars into shares with:
 * `server/captableCommitStore.ts:1131` derives
 * `shares = floor(amount ÷ round.pricePerShare)` in cent-units. A price that
 * ignores a pool the round now carries issues TOO FEW SHARES TO EVERY INVESTOR
 * IN THAT ROUND, in the immutable ledger, silently. `captableCommitStore.ts` is
 * SACRED and is NOT edited by this wave — it is read, and quoted here, so the
 * consequence is on the record beside the check that prevents it.
 *
 * WHY EXACT DECIMALS AND NOT `Number(a) !== Number(b)`. The derived price is a
 * `Decimal.toFixed()` STRING (e.g. "1.714285714285714285714285714285714286"),
 * the field is a JS number. Float comparison would report a spurious mismatch on
 * a repeating decimal that the founder cannot possibly resolve by typing, and
 * would report agreement for two values that differ below float resolution. So
 * both sides are compared as exact decimals at the engine's own precision, and
 * agreement is judged AT THE PRECISION THE FIELD CAN ACTUALLY HOLD (see
 * `comparableDecimals` below) — otherwise the refusal could never be cleared,
 * which would be a new dead end rather than a fix.
 */
export type PricePerShareAgreement = {
  /** True when the two prices agree to the precision the input can hold. */
  readonly agrees: boolean;
  /** The value currently in the "Price per share (USD)" field, exact. */
  readonly savedExact: string;
  /** The value the pool derivation produced, exact. */
  readonly derivedExact: string;
  /** `derived − saved`, exact and signed. Stated on screen, per the spec. */
  readonly differenceExact: string;
  /** The derived price rounded to what the field can hold — the "apply" value. */
  readonly applyValue: string;
  /**
   * True when the derived price cannot be represented exactly in the field
   * (a repeating decimal such as $1.714285…). The refusal then says so and the
   * "apply" action stores the rounded value, which is the same number the
   * wizard's own price field holds for the same terms.
   */
  readonly derivedIsRepeating: boolean;
};

/** Decimal places the "Price per share (USD)" field and the DB column carry. */
export const PRICE_PER_SHARE_DECIMALS = 6;

export function comparePricePerShare(
  savedFieldValue: string | number | null | undefined,
  derivedPriceExact: string | null | undefined,
): PricePerShareAgreement | null {
  /* `null` means THERE IS NOTHING TO COMPARE — no pool derivation on screen.
     It is not "they agree": a caller must not read absence as agreement. */
  if (derivedPriceExact === null || derivedPriceExact === undefined || String(derivedPriceExact).trim() === "") {
    return null;
  }
  let derived: Dm;
  try {
    derived = dm(String(derivedPriceExact).replace(/[,\s$]/g, ""));
  } catch {
    return null;
  }
  if (!derived.isFinite()) return null;

  const savedRaw = savedFieldValue === null || savedFieldValue === undefined ? "" : String(savedFieldValue).replace(/[,\s$]/g, "");
  let saved: Dm;
  try {
    saved = savedRaw === "" ? dm(0) : dm(savedRaw);
  } catch {
    saved = dm(0);
  }
  if (!saved.isFinite()) saved = dm(0);

  const applyValue = derived.toDecimalPlaces(PRICE_PER_SHARE_DECIMALS, Decimal.ROUND_HALF_UP);
  const derivedIsRepeating = !applyValue.eq(derived);
  /* Judged at the field's own precision so the founder can always clear it. */
  const savedAtFieldPrecision = saved.toDecimalPlaces(PRICE_PER_SHARE_DECIMALS, Decimal.ROUND_HALF_UP);
  const agrees = savedAtFieldPrecision.eq(applyValue);
  return {
    agrees,
    savedExact: saved.toFixed(),
    derivedExact: derived.toFixed(),
    differenceExact: derived.minus(saved).toFixed(),
    applyValue: applyValue.toFixed(),
    derivedIsRepeating,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 58c · A2 — THE POOL AS A SHARE COUNT, FOR ROUNDS THAT HAVE NO PRICE.
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS, AND WHY THE SPEC'S SUGGESTED FIX WOULD NOT HAVE WORKED.
 *
 * A2 says the pool "stops working on SAFE and note rounds" because those
 * instruments collect no fully-diluted share count, so the base resolver returns
 * `fd_base_unavailable`. That is TRUE BUT IT IS ONLY THE FIRST OF TWO REFUSALS,
 * and the spec's proposed remedies (collect the FD base / fall back to a stored
 * count / derive from the ledger) close only the first. Proved by EXECUTION
 * (`build_log/wave58cd/probe_before.mts`), with the FD base supplied:
 *
 *   derivePoolTopUpFromPercent({ fdPreMoneyShares: "10000000",
 *                                preMoneyValuation: "",  investmentAmount: "500000" })
 *     -> { ok:false, code:"pre_money_missing_for_pool" }
 *
 * A pool expressed as "% of POST-MONEY fully-diluted" is only definable when the
 * round has a PRE-MONEY VALUATION, because the post-money share total is
 * `B + S + (raise ÷ price)` and the price comes from the valuation. SAFE and note
 * rounds have no pre-money valuation at all — they have a valuation CAP, which is
 * a ceiling on a FUTURE priced round, not this round's price. So on those
 * instruments the percentage is not merely unsupplied, it is UNDEFINED.
 *
 * THE HONEST RESTORATION IS THEREFORE THE UNIT LIVE ALREADY USES: a share count.
 * `LIVE_AUDIT_2026_08_15.md` records the live Review-step add-on as
 * "Pool size (shares)", a typed share count, which created the child
 * `option_pool` round. That capability is restored exactly, with the two
 * validation holes the same audit found on that field CLOSED rather than copied:
 * live accepted `-5` with NO error and `999999999` silently.
 */
export function parsePoolShareCountAsWritten(
  raw: string | number | null | undefined,
  field = "Pool size (shares)",
): Refusable<{ shares: bigint }> {
  if (raw === null || raw === undefined || String(raw).trim() === "") {
    return refuse(
      "pool_shares_missing",
      `${field} is required. A blank pool is not a pool of zero shares — enter the number of shares you are ` +
        `reserving, or turn the option pool off.`,
    );
  }
  const t = String(raw).replace(/[,\s]/g, "");
  let d: Dm;
  try {
    d = dm(t);
  } catch {
    return refuse(
      "pool_shares_not_a_number",
      `${field} must be a number. “${String(raw)}” is not one, and Capavate will not guess at what you meant.`,
    );
  }
  if (!d.isFinite()) {
    return refuse("pool_shares_not_finite", `${field} must be a finite number. “${String(raw)}” is not.`);
  }
  if (d.lt(0)) {
    /* THE LIVE HOLE, CLOSED. `LIVE_AUDIT_2026_08_15.md`: `-5` was "accepted, NO
       error" on this field while the standalone percentage field rejected it —
       the same app disagreeing with itself about a negative pool. */
    return refuse(
      "pool_shares_negative",
      `${field} cannot be negative. A negative pool would un-reserve shares, which is a cancellation, not a top-up.`,
    );
  }
  if (d.isZero()) {
    return refuse(
      "pool_shares_zero",
      `${field} must be greater than zero. If you are not reserving any shares, turn the option pool off instead — ` +
        `a pool of zero shares and no pool at all are different statements on a cap table.`,
    );
  }
  if (!d.isInteger()) {
    return refuse(
      "pool_shares_fractional",
      `${field} must be a whole number of shares — “${String(raw)}” is fractional. Capavate will not round a share ` +
        `count, because rounding it changes who owns what.`,
    );
  }
  return { ok: true, shares: BigInt(d.toFixed(0)) };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * WAVE 58d · B2 — IMPLIED FULLY-DILUTED CAPITALISATION, RECONCILED TO THE
 *                 NOMINAL POST-MONEY.
 * ═══════════════════════════════════════════════════════════════════════════
 * `spec/strategy/CAPTABLE_MATH_INDUSTRY_STANDARD.md` requires the platform to
 * compute `T × PPS` and DISCLOSE IT whenever it differs from
 * `pre-money + new money`. Wave 58b computed both quantities and headlined
 * neither difference. `W58B_REVIEW_1_MATH.md` §2.3 ranked that HIGH:
 *
 *   post-money placement, canonical fixture
 *     nominal post-money                  $40,000,000.00
 *     12,549,019 × $3.75                  $47,058,821.25
 *     difference                          $ 7,058,821.25
 *
 * It is NOT an arithmetic error. Under post-money placement the reserve is issued
 * OUTSIDE the pricing denominator, so the shares that exist after close, valued at
 * the round's own price, exceed pre-money + raise by the value of that reserve —
 * less the cash residual created by flooring investor shares. Under pre-money
 * placement the same identity runs the other way and the difference is only the
 * floor residual (−$1.00 on the canonical fixture). Both must be SHOWN, because a
 * founder otherwise reads "$30m pre / $10m raise / $40m post" beside a cap table
 * capitalised at $47.059m at the same price per share.
 *
 * NOTHING HERE IS A NEW CONVENTION. It is a reconciliation of two figures the
 * platform already produces, in exact decimals, with the residual attributed to
 * the two named causes rather than left as an unexplained gap.
 */
export type ImpliedCapitalisation = {
  /** `pre-money + raise` — the figure the wizard headlines today. */
  readonly nominalPostMoney: string;
  /** `T × PPS` — every share that will exist after close, at the round's price. */
  readonly impliedFullyDilutedCapitalisation: string;
  /** `implied − nominal`, exact and signed. */
  readonly difference: string;
  /** True when the two agree to the cent, so the screen can say "reconciles". */
  readonly reconciles: boolean;
  /** The value of the new reserve at the round price, `S × PPS`. */
  readonly poolValueAtPrice: string;
  /**
   * The cash left over by flooring investor shares: `raise − (N × PPS)`. Always
   * ≥ 0 and < PPS. This is the ONLY part of the difference that is a rounding
   * artefact; the rest is the reserve, which is economics.
   */
  readonly investorFloorResidual: string;
  /** Plain-English statement, rendered on screen. */
  readonly explanation: string;
};

export function reconcileImpliedCapitalisation(input: {
  readonly preMoneyValuation: string | number;
  readonly investmentAmount: string | number;
  readonly derivation: PoolPercentDerivation;
}): Refusable<ImpliedCapitalisation> {
  const pmv = posNum(input.preMoneyValuation);
  const inv = posNum(input.investmentAmount);
  if (pmv === null || inv === null) {
    return refuse(
      "implied_cap_inputs_missing",
      "Cannot reconcile the implied fully-diluted capitalisation: the pre-money valuation or the raise amount is " +
        "blank. A blank figure is not zero, and this reconciliation is a comparison of two real numbers.",
    );
  }
  const d = input.derivation;
  const pps = dm(d.pricePerShare);
  const T = dm(d.postMoneyFdShares.toString());
  const S = dm(d.poolTopUpShares.toString());
  const N = dm(d.newInvestorShares.toString());

  const nominal = pmv.plus(inv);
  const implied = T.mul(pps);
  const difference = implied.minus(nominal);
  const poolValue = S.mul(pps);
  const residual = inv.minus(N.mul(pps));
  const isPost = d.placement === "post_money";

  const explanation = isPost
    ? `POST-MONEY placement puts the ${d.poolTopUpShares.toLocaleString()} reserve shares OUTSIDE the pricing ` +
      `denominator, so they are not paid for at the pricing step. Every share that exists after close, valued at ` +
      `this round's own price of ${pps.toFixed()}, therefore comes to ${implied.toFixed()} — ` +
      `${difference.toFixed()} more than the nominal ${nominal.toFixed()} you get from pre-money plus raise. ` +
      `That difference is the reserve at this price (${d.poolTopUpShares.toLocaleString()} × ${pps.toFixed()} = ` +
      `${poolValue.toFixed()}) LESS ${residual.toFixed()} of your raise that buys no whole share because new ` +
      `investor shares round DOWN. This is not an error and it is not a second valuation: it is the reason ` +
      `counsel will push back on a post-money pool.`
    : `PRE-MONEY placement puts the ${d.poolTopUpShares.toLocaleString()} reserve shares INSIDE the pricing ` +
      `denominator, so they are already paid for by the existing holders at the pricing step. Every share that ` +
      `exists after close, valued at this round's price of ${pps.toFixed()}, comes to ${implied.toFixed()} ` +
      `against the nominal ${nominal.toFixed()} — a difference of ${difference.toFixed()}, which is entirely the ` +
      `${residual.toFixed()} of your raise that buys no whole share because new investor shares round DOWN. ` +
      `There is no unexplained valuation gap on this placement.`;

  return {
    ok: true,
    nominalPostMoney: nominal.toFixed(),
    impliedFullyDilutedCapitalisation: implied.toFixed(),
    difference: difference.toFixed(),
    /* "To the cent" and not "exactly": a sub-cent difference is not a figure a
       founder can act on, and calling it a mismatch would train them to ignore
       the line. Anything a cent or more IS shown. */
    reconciles: difference.abs().lt(dm("0.01")),
    poolValueAtPrice: poolValue.toFixed(),
    investorFloorResidual: residual.toFixed(),
    explanation,
  };
}

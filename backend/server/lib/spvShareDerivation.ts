/**
 * WAVE 33 · CP-SPV-31 — SHARE DERIVATION FOR A DEPLOYMENT.
 *
 * ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
 * `SpvDeploymentLifecyclePanel` asks the GP to TYPE a share count into a free
 * text box, and the commit route validates it with `/^-?\d+$/` and nothing
 * else. That string is then written into the SACRED, append-only cap-table
 * ledger via `commitFunded`. A single mistyped digit permanently records the
 * wrong ownership for the SPV in a real company's cap table, and nothing
 * anywhere compares the typed figure against the round's own price.
 *
 * The three rungs of the ladder were all fail-closed on the MONEY (founder
 * confirmation, a real wire reference, docs on file, fees settled, coverage by
 * committed LP capital) and completely open on the SHARES. The one number that
 * determines what the SPV actually owns was the one number nobody checked.
 *
 * ── WHAT THIS DOES ──────────────────────────────────────────────────────────
 * Derives the share count from rows that already exist — the deployment amount
 * and the round's `pricePerShare` — and states the answer, including when it
 * cannot state one.
 *
 * IT DOES NOT DECIDE. The commit route still takes the GP's number; this makes
 * the correct number visible and makes a divergence from it explicit. Silently
 * substituting a derived figure would replace one unchecked number with
 * another, and share counts can legitimately differ from a naive division
 * (side letters, rounding conventions agreed with the company, anti-dilution).
 *
 * ── EXACTNESS ───────────────────────────────────────────────────────────────
 * All arithmetic is integer BigInt on minor units. A division that does not
 * come out even is NOT rounded: the whole-share count and the exact residual
 * are both reported, because "your money buys 1,428 shares and leaves $0.57
 * unallocated" is a fact the GP must see, and `Math.round` on a per-party share
 * is forbidden outright.
 *
 * Percentages are never involved here. Nulls are never zeros: an absent or
 * unusable price yields a stated refusal, not a share count of 0 — a derived
 * "0 shares" would be a claim that the money bought nothing.
 */
import { currencyExponent } from "./money";

export type ShareDerivationRefusal =
  | "NO_PRICE_PER_SHARE"
  | "PRICE_NOT_POSITIVE"
  | "PRICE_NOT_REPRESENTABLE"
  | "AMOUNT_NOT_POSITIVE";

export interface ShareDerivation {
  /** Whole shares the amount buys at the round price. Null when refused. */
  wholeShares: string | null;
  /** Minor units left over after buying `wholeShares`. Null when refused. */
  residualMinor: number | null;
  /** True only when the division is exact. */
  exact: boolean;
  /** Set when no derivation is possible. Null when a derivation was produced. */
  refusal: ShareDerivationRefusal | null;
  /** Server-authored, printed verbatim by the client. Never assembled there. */
  copy: string;
  /** Echoed back so the client never recomputes them. */
  amountMinor: number;
  currency: string;
  pricePerShare: number | null;
}

const REFUSAL_COPY: Record<ShareDerivationRefusal, string> = {
  NO_PRICE_PER_SHARE:
    "This round records no price per share, so the share count for this deployment cannot be derived. Enter the figure agreed with the company — it is written to the cap table exactly as typed and cannot be edited afterwards.",
  PRICE_NOT_POSITIVE:
    "This round records a price per share of zero or less, which cannot buy shares. The share count cannot be derived until the round's price is corrected.",
  PRICE_NOT_REPRESENTABLE:
    "This round's price per share cannot be represented exactly in this currency, so deriving a share count from it would require rounding the price. It is not derived rather than derived wrongly.",
  AMOUNT_NOT_POSITIVE:
    "This deployment has no positive amount, so no share count can be derived from it.",
};

function refuse(
  refusal: ShareDerivationRefusal,
  amountMinor: number,
  currency: string,
  pricePerShare: number | null,
): ShareDerivation {
  return {
    wholeShares: null,
    residualMinor: null,
    exact: false,
    refusal,
    copy: REFUSAL_COPY[refusal],
    amountMinor,
    currency,
    pricePerShare,
  };
}

/**
 * `pricePerShare` is stored as a float in MAJOR units (`rounds.price_per_share`
 * is a REAL column), so it is converted here rather than trusted as-is.
 *
 * The conversion goes through a fixed-precision decimal string at the
 * currency's own exponent and then REJECTS anything that did not survive the
 * round trip. A price of $0.001 in a 2-decimal currency is not silently
 * flattened to $0.00 (which would divide by zero) or to $0.01 (which would
 * understate the shares tenfold) — it is refused.
 */
function priceToMinor(pricePerShare: number, currency: string): bigint | null {
  const exp = currencyExponent(currency);
  if (!Number.isFinite(pricePerShare)) return null;
  const fixed = pricePerShare.toFixed(exp);
  const asMinor = BigInt(fixed.replace(".", "").replace("-", ""));
  // Round-trip check: the fixed-precision form must equal the original value at
  // this currency's precision, or the price is not representable here.
  if (Math.abs(Number(fixed) - pricePerShare) > Number.EPSILON * Math.max(1, Math.abs(pricePerShare))) {
    return null;
  }
  return pricePerShare < 0 ? -asMinor : asMinor;
}

export function deriveShares(input: {
  amountMinor: number;
  currency: string;
  pricePerShare: number | null | undefined;
}): ShareDerivation {
  const { amountMinor, currency } = input;
  const pricePerShare =
    input.pricePerShare === undefined || input.pricePerShare === null ? null : input.pricePerShare;

  if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
    return refuse("AMOUNT_NOT_POSITIVE", amountMinor, currency, pricePerShare);
  }
  if (pricePerShare === null) {
    return refuse("NO_PRICE_PER_SHARE", amountMinor, currency, pricePerShare);
  }
  if (pricePerShare <= 0) {
    return refuse("PRICE_NOT_POSITIVE", amountMinor, currency, pricePerShare);
  }
  const priceMinor = priceToMinor(pricePerShare, currency);
  if (priceMinor === null || priceMinor <= BigInt(0)) {
    return refuse("PRICE_NOT_REPRESENTABLE", amountMinor, currency, pricePerShare);
  }

  const amt = BigInt(Math.trunc(amountMinor));
  const whole = amt / priceMinor;
  const residual = amt % priceMinor;
  const exact = residual === BigInt(0);

  const copy = exact
    ? `At the round's recorded price per share, this deployment buys exactly ${whole.toString()} shares.`
    : `At the round's recorded price per share, this deployment buys ${whole.toString()} whole shares and leaves a residual that buys no further whole share. Confirm with the company whether the residual is returned, rounded up, or held — the share count you commit is written to the cap table exactly as entered and cannot be edited afterwards.`;

  return {
    wholeShares: whole.toString(),
    residualMinor: Number(residual),
    exact,
    refusal: null,
    copy,
    amountMinor,
    currency,
    pricePerShare,
  };
}

/**
 * Compares what the GP typed against what the rows imply.
 *
 * Returns null when there is nothing to say (no derivation available, or the
 * figures agree). Otherwise returns copy stating the divergence. This is a
 * WARNING, not a gate: see the module header on why the derived figure is not
 * substituted automatically.
 */
export function describeShareDivergence(
  typedShares: string,
  derivation: ShareDerivation,
): string | null {
  if (derivation.refusal !== null || derivation.wholeShares === null) return null;
  const typed = String(typedShares).trim();
  if (!/^-?\d+$/.test(typed)) return null;
  if (BigInt(typed) === BigInt(derivation.wholeShares)) return null;
  return `You entered ${typed} shares. The round's recorded price implies ${derivation.wholeShares}. Committing writes your figure to the cap table permanently — check it against the company's own allocation before continuing.`;
}

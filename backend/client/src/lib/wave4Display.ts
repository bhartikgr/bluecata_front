/**
 * Wave 4 (v26.1.x) — pure, display-only helpers for the investor deal surfaces
 * (COS-1..COS-5). Presentation only: no stored id/name/value is ever mutated,
 * no server payload is derived from these. Kept React-free so they are
 * unit-testable in a plain `.test.ts` (excluded from the tsc budget).
 *
 * Ozan's Wave-4 decisions (WAVE4_BUILD_BRIEF.md):
 *  - COS-1: always show a calm "Not provided" line for empty deal fields —
 *           sections are NOT hidden.
 *  - COS-3: LEAVE user-entered names EXACTLY as typed (never re-case a name like
 *           "TeST ROund"). Only obvious *id* tokens are normalized for display,
 *           and only where an id renders in prose. Stored ids/names never change.
 *  - COS-4: render exactly "Not set" when PPS is 0 / null / unset.
 *  - COS-5: bind the illustrative cap-table position to the investor's ENTERED
 *           soft-circle amount; when none is entered, the position is an Example.
 */

/** Canonical muted placeholder for an empty deal field (COS-1). */
export const NOT_PROVIDED = "Not provided" as const;

/** Canonical label for an unset / zero price-per-share (COS-4). */
export const PPS_NOT_SET = "Not set" as const;

/**
 * COS-4 — price-per-share display. Returns exactly "Not set" when the PPS is
 * null/undefined or 0 (an unset priced round), otherwise the formatted dollar
 * value at `decimals` places. Never renders "$0.0000". Display only.
 */
export function ppsDisplay(
  pps: number | null | undefined,
  decimals: number,
): string {
  if (pps == null || !Number.isFinite(pps) || pps === 0) return PPS_NOT_SET;
  return `$${pps.toFixed(decimals)}`;
}

/**
 * COS-1 — collapse a possibly-empty free-text field to its trimmed value, or ""
 * when blank. The caller renders the NOT_PROVIDED treatment when this is "".
 */
export function orNotProvidedText(v: string | null | undefined): string {
  return (v ?? "").trim();
}

/**
 * COS-3 — display-only normalization for an *id* token shown in prose (e.g.
 * "zz-gate0-test-safe" → "ZZ-GATE0-TEST-SAFE"). Applied ONLY to ids, NEVER to
 * user-entered names. Returns the input unchanged when it is blank. This never
 * mutates the stored id — callers pass the value only into JSX text.
 *
 * NOTE (Wave 4): the investor deal surfaces do not currently render any raw id
 * in prose (round *names* like "TeST ROund" are names, left verbatim per Ozan),
 * so this helper is provided for correctness/reuse and covered by tests; there
 * is no name re-casing anywhere.
 */
export function displayId(id: string | null | undefined): string {
  const trimmed = (id ?? "").trim();
  if (!trimmed) return trimmed;
  return trimmed.toUpperCase();
}

/** Parsed, non-negative soft-circle amount, or null when blank/invalid. */
export function parseAmount(raw: string | null | undefined): number | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

export type IllustrativePosition = {
  /** The dollar amount the illustration is computed from. */
  amount: number;
  /** Shares the investor would receive at the round PPS (display estimate). */
  shares: number;
  /** Implied post-money ownership %, or null when post-money is unknown. */
  ownershipPct: number | null;
  /** True when a pro-rata reservation applies at this amount. */
  proRata: boolean;
  /** True when NO amount was entered → the card is a labelled Example. */
  isExample: boolean;
};

/**
 * COS-5 — compute the illustrative post-round position. Binds to the investor's
 * ENTERED soft-circle amount when present; otherwise falls back to the min
 * ticket and flags `isExample` so the UI can label it "Example". This is a
 * DISPLAY estimate only — it never writes to the ledger or the money core.
 *
 * @param enteredRaw  the raw value from the soft-circle amount input
 * @param minTicket   the round's minimum ticket (example fallback basis)
 * @param pricePerShare round PPS (null/0 → shares estimate uses 1 as a divisor)
 * @param postMoney   round post-money valuation (0/undefined → ownership null)
 */
export function computeIllustrativePosition(
  enteredRaw: string | null | undefined,
  minTicket: number,
  pricePerShare: number | null | undefined,
  postMoney: number | null | undefined,
): IllustrativePosition {
  const entered = parseAmount(enteredRaw);
  const isExample = entered == null;
  const amount = entered ?? (minTicket > 0 ? minTicket : 0);
  const pps = pricePerShare != null && Number.isFinite(pricePerShare) && pricePerShare > 0
    ? pricePerShare
    : 1;
  const shares = Math.round(amount / pps);
  const ownershipPct =
    postMoney != null && Number.isFinite(postMoney) && postMoney > 0
      ? (amount / postMoney) * 100
      : null;
  const proRata = amount >= 250000;
  return { amount, shares, ownershipPct, proRata, isExample };
}

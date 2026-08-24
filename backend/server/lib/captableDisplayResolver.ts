/* W-FIX1a (2026-07-19) — cap-table DISPLAY resolver (A1 + A2).
 *
 * Read-only, additive, fail-open projection helpers used by the cap-table
 * display bridges in `server/routes.ts` (the /securities and /captable/interim
 * endpoints) to resolve friendly investor name + email and a human round NAME,
 * so those surfaces never leak a raw `u_…` / `rnd_…` id.
 *
 * SACRED files are only CALLED here, never modified:
 *   - getUserContextForId  (server/lib/userContext.ts) — DB-hydrated identity
 *   - getRoundById         (server/roundsStore.ts)     — round metadata
 *
 * Every function is defensive (try/catch + safe fallbacks): a resolution miss
 * must degrade to a friendly placeholder, never throw and never break the read.
 */
import { getUserContextForId } from "./userContext";
import { getRoundById as roundsGetById } from "../roundsStore";

export type HolderDisplay = { name: string; email: string };

/** True when the string looks like a raw internal entity id we must never show. */
function looksLikeRawId(v: unknown): boolean {
  if (typeof v !== "string") return false;
  return /^(u_|co_|rnd_|company:|cmp_|inv_|spv_)/i.test(v.trim());
}

/**
 * Resolve an investor's display name + email for a cap-table row.
 * Preference order:
 *   1. ledger-stored holder first/last name (already on the entry)
 *   2. DB-hydrated identity via getUserContextForId (SACRED, read-only)
 *   3. friendly placeholder "Investor (pending profile)" — NEVER a raw id
 */
export function resolveHolderDisplay(
  investorId: string | null | undefined,
  holderFirstName?: string | null,
  holderLastName?: string | null,
): HolderDisplay {
  const ledgerName = `${holderFirstName ?? ""} ${holderLastName ?? ""}`.trim();
  let name = ledgerName;
  let email = "";
  try {
    const id = String(investorId ?? "").trim();
    if (id) {
      const ctx = getUserContextForId(id);
      if (ctx?.isAuthed) {
        if (ctx.identity?.email) email = ctx.identity.email;
        if (!name && ctx.identity?.name) name = ctx.identity.name.trim();
        if (!name && ctx.identity?.screenName) name = ctx.identity.screenName.trim();
      }
    }
  } catch { /* fail-open to placeholder */ }
  if (!name || looksLikeRawId(name)) name = "Investor (pending profile)";
  return { name, email };
}

/**
 * Resolve a round's human NAME from its id.
 * Falls back to a short-id label "Round <last6>" (never the bare raw id) so the
 * UI is always legible even if the round row is missing.
 */
export function resolveRoundName(roundId: string | null | undefined): string {
  const id = String(roundId ?? "").trim();
  if (!id) return "—";
  try {
    const rnd = roundsGetById(id) as any;
    const nm = (rnd?.name ?? rnd?.series ?? "").toString().trim();
    if (nm) return nm;
  } catch { /* fall through */ }
  const short = id.replace(/^rnd_/i, "").slice(-6);
  return short ? `Round ${short}` : "—";
}

/* WAVE 116 · FINDING 3 — WHY THIS PERCENTAGE IS STILL COMPUTED HERE, AND WHAT IT
 * NOW SAYS ABOUT ITSELF.
 * ══════════════════════════════════════════════════════════════════════
 * FIRST, WHAT IS *NOT* WRONG WITH IT. This is not an invented denominator. The
 * basis is a real quantity read from real rows: the sum of share counts across
 * the committed entries of THIS company. The `null` returns are already correct —
 * a zero or non-finite basis refuses instead of dividing (R47/R48, D18).
 *
 * WHAT WAS WRONG. It had no name. The number reached
 * `client/src/components/founder/CapTableInterim.tsx` as a bare `ownershipPct`
 * and was rendered as a bare `%`, next to figures whose denominators are
 * different quantities entirely (issued shares, fully-diluted shares,
 * as-converted shares — `client/src/lib/captable/exportProvenance.ts`). Wave 113
 * measured disagreements up to 11.91 percentage points between bases on this
 * platform, so an unnamed percentage is not a rounding nuisance, it is an
 * unanswerable number.
 *
 * WHY IT CANNOT ROUTE THROUGH THE CAP-TABLE ENGINE (the honest limit). The
 * engine's input is the SECURITIES ledger — issued instruments. The rows here
 * are the committed and funded QUEUES: money and share counts agreed but not yet
 * issued as securities. There is no security row for the engine to consume, so
 * the engine has nothing to divide. Feeding it synthesised rows to obtain a
 * number would be the Finding 2 defect in a different file. WHAT IT WOULD TAKE:
 * commitment acceptance would have to issue (or provisionally issue) a security
 * row, at which point this interim view disappears and the engine answers it.
 * That is a data-model change well outside this wave and is recorded as an open
 * question in `build_log/wave116/W116_TESTS.md`.
 *
 * SO: same arithmetic, exported name for the basis, and every renderer prints it. */

/** Machine token for the basis this percentage divides by. */
export const COMMITTED_LEDGER_BASIS = "committed_ledger_shares" as const;

/** The basis, named the way a reader would say it (short form, for a column header). */
export const COMMITTED_LEDGER_BASIS_LABEL = "committed shares on this company's ledger";

/** The basis, as a full sentence — for a footnote, a tooltip or a PDF paragraph. */
export const COMMITTED_LEDGER_BASIS_SENTENCE =
  "Percentages are each holder's share of the total COMMITTED shares recorded for this company. " +
  "That is not the same denominator as Basic (issued shares), Fully Diluted (issued plus options, " +
  "warrants and unallocated pool) or As Converted (plus convertibles at their conversion terms), so " +
  "these figures are not comparable with the cap-table views and will change when commitments are issued.";

/** A percentage together with the basis it divides by. Neither travels alone. */
export interface CommittedOwnership {
  /** Holder's share of `COMMITTED_LEDGER_BASIS`, or `null` when undeterminable. */
  pct: number | null;
  basis: typeof COMMITTED_LEDGER_BASIS;
  basisLabel: string;
  basisSentence: string;
  /** The denominator actually used, so a caller can show its own working. */
  totalShares: number;
}

/**
 * Compute committed ownership % for a holder (holderShares ÷ totalCommittedShares)
 * TOGETHER WITH THE NAME OF THAT DENOMINATOR.
 * Returns `pct: null` when the basis is zero/unknown so the FE can render "pending".
 */
export function computeCommittedOwnership(
  holderShares: number,
  totalCommittedShares: number,
): CommittedOwnership {
  const determinable =
    Number.isFinite(holderShares) &&
    Number.isFinite(totalCommittedShares) &&
    totalCommittedShares > 0 &&
    holderShares > 0;
  return {
    pct: determinable ? (holderShares / totalCommittedShares) * 100 : null,
    basis: COMMITTED_LEDGER_BASIS,
    basisLabel: COMMITTED_LEDGER_BASIS_LABEL,
    basisSentence: COMMITTED_LEDGER_BASIS_SENTENCE,
    totalShares: Number.isFinite(totalCommittedShares) ? totalCommittedShares : 0,
  };
}

/**
 * WAVE 116 — kept as a thin delegation to `computeCommittedOwnership` so no
 * existing caller or test changes behaviour. New callers should use
 * `computeCommittedOwnership`, because it cannot hand back a percentage without
 * also handing back the denominator's name.
 */
export function computeOwnershipPct(
  holderShares: number,
  totalCommittedShares: number,
): number | null {
  return computeCommittedOwnership(holderShares, totalCommittedShares).pct;
}

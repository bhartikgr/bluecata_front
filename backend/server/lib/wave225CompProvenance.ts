/**
 * WAVE 225 · ITEM A — PROVENANCE GATE FOR COMPARABLE-TRANSACTION DATA.
 *
 * R193.2. The nine entries in `maPublicComps.ts` were authored as literals and
 * described in that file's own header as "REAL, publicly-observable M&A
 * transactions". Nothing in the platform can show that they are. They reached
 * accredited investors as an on-screen table AND as `comparable_exits.csv`.
 *
 * A comparable-exits table is the evidential basis for a valuation argument, so
 * an unsourced row is not a cosmetic defect: it is manufactured support for a
 * price. And a *plausible* comparable invites no second look, which is why this
 * gate is mechanical rather than a review convention.
 *
 * WHAT THIS MODULE DOES: it decides, per comparable, whether the platform can
 * say where the figure came from. A row is emitted only if it carries BOTH a
 * non-empty `source` and a real calendar `sourceDate`. Today that is ZERO of
 * nine — which is the correct output, not a failure of this module.
 *
 * WHAT IT DELIBERATELY DOES NOT DO:
 *   - it does not correct, replace, research or "improve" any figure. A
 *     wrong-but-plausible comparable is the defect whether it came from a
 *     hardcoded array or from a hurried search;
 *   - it does not delete the nine entries. They stay in `maPublicComps.ts`
 *     behind this gate so nothing is lost. If a licensed comps feed is wired in
 *     later and supplies a source and a date per row, they flow again with no
 *     further change here.
 *
 * R143.4 — "Capavate will not show a zero total for a figure it does not hold."
 * The same principle applied to a table: the surface refuses and names the
 * missing fact. It does not print a plausible row, and it does not blame scope.
 *
 * Non-sacred module, introduced by this wave. `maPublicComps.ts` and
 * `collectiveMaIntelStore.ts` are not frozen either (checked against
 * `scripts/sacred_check.sh --list`), so no interception layer was needed for
 * freeze reasons — this file exists to keep the decision in one testable place.
 */

/**
 * The 240-character `looksHuman` gate. A refusal longer than that is not
 * recognised as human copy downstream, so a verbose statement is a statement
 * that may never reach a screen. `fitToGate` is the platform's existing helper
 * for exactly this and is reused rather than reimplemented (waves 195/198).
 */
import { fitToGate } from "../../shared/refusalHeadlineGate";

/** Machine-readable status for a consumer that must not read empty as zero. */
export const COMPS_PROVENANCE_STATUS_VERIFIED = "verified_sources_only" as const;
export const COMPS_PROVENANCE_STATUS_NONE_HELD = "no_verified_comparable_transaction_data" as const;

export type CompsProvenanceStatus =
  | typeof COMPS_PROVENANCE_STATUS_VERIFIED
  | typeof COMPS_PROVENANCE_STATUS_NONE_HELD;

/**
 * The provenance verdict that accompanies every comps response.
 *
 * `heldUnsourced` is reported rather than hidden: the platform DOES hold nine
 * comparable-transaction rows, and it is more honest to say that they exist and
 * are unusable than to imply the library is empty.
 */
export interface CompsProvenanceVerdict {
  status: CompsProvenanceStatus;
  /** Rows emitted — i.e. rows carrying both a source and a source date. */
  verified: number;
  /** Rows held but withheld for want of a source, a source date, or both. */
  heldUnsourced: number;
  /** Plain-language statement, safe to render verbatim to an investor. */
  statement: string;
}

/** Minimal shape this gate needs. Kept structural so it does not import upward. */
export interface ProvenanceCandidate {
  source?: string;
  sourceDate?: string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real calendar date, not merely a well-shaped string. `2025-02-30` matches
 * the regex and must still be rejected: a date that does not exist cannot be
 * the date a transaction was reported.
 */
export function isRealIsoDate(value: string | undefined): boolean {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map((p) => Number.parseInt(p, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return (
    probe.getUTCFullYear() === y &&
    probe.getUTCMonth() === m - 1 &&
    probe.getUTCDate() === d
  );
}

/**
 * TRUE only when the platform can say where this figure came from and when.
 *
 * Both halves are required and neither is negotiable. A source without a date
 * cannot be checked for staleness; a date without a source names nothing. An
 * empty or whitespace-only source is absent, not present.
 */
export function hasVerifiedProvenance(candidate: ProvenanceCandidate): boolean {
  const source = typeof candidate.source === "string" ? candidate.source.trim() : "";
  if (source.length === 0) return false;
  return isRealIsoDate(candidate.sourceDate);
}

/** The gate. Everything without both a source and a real source date is dropped. */
export function verifiedComps<T extends ProvenanceCandidate>(all: readonly T[]): T[] {
  return all.filter((c) => hasVerifiedProvenance(c));
}

/**
 * The statement rendered to the investor and returned on the API.
 *
 * Deliberately says three things, because saying fewer moves the misstatement
 * instead of removing it: (1) the platform holds no verified data; (2) the
 * absence is nothing to do with the caller's scope or permissions; (3) rows
 * exist but are withheld, and why.
 */
export function compsProvenanceStatement(verified: number, heldUnsourced: number): string {
  const held =
    heldUnsourced > 0
      ? ` ${heldUnsourced} held row${heldUnsourced === 1 ? " is" : "s are"} withheld for want of a recorded source or source date.`
      : "";
  if (verified > 0) {
    return fitToGate(() =>
      "Every comparable transaction shown carries the source it came from and the date that " +
      `source reported it. Rows without both are withheld.${held}`,
    );
  }
  return fitToGate(() =>
    "Capavate holds no verified comparable-transaction data, so no comparable exits are shown " +
    `or available to export.${held} This is not a limit of your scope, your permissions or ` +
    "the date filter.",
  );
}

/** One call for the whole verdict, so callers cannot compute half of it. */
export function compsProvenanceVerdict<T extends ProvenanceCandidate>(
  all: readonly T[],
): { emitted: T[]; verdict: CompsProvenanceVerdict } {
  const emitted = verifiedComps(all);
  const heldUnsourced = all.length - emitted.length;
  return {
    emitted,
    verdict: {
      status:
        emitted.length > 0
          ? COMPS_PROVENANCE_STATUS_VERIFIED
          : COMPS_PROVENANCE_STATUS_NONE_HELD,
      verified: emitted.length,
      heldUnsourced,
      statement: compsProvenanceStatement(emitted.length, heldUnsourced),
    },
  };
}

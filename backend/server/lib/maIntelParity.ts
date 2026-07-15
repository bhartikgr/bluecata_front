/**
 * server/lib/maIntelParity.ts — W7 (2026-07-14).
 *
 * Shared M&A-intelligence PARITY envelope so every surface (Investor, Collective
 * member, Founder, Partner) speaks ONE contract for the three distinct outcomes
 * of "show me company X's M&A intelligence":
 *
 *   1. hasData:true,  redacted:false  → the caller may see (some tier of) data.
 *   2. hasData:true,  redacted:true   → data EXISTS but is withheld at the
 *                                       caller's access tier (AGGREGATE-only, or
 *                                       narrative/buyers hidden). "Redacted".
 *   3. hasData:false, redacted:false  → the caller is entitled to look, but the
 *                                       company has NOT entered M&A readiness
 *                                       data yet. "No data" — NOT hidden.
 *
 * ANTI-ENUMERATION (v25.36) is preserved OUTSIDE this envelope: a company the
 * caller cannot even see (out-of-scope / NONE on a per-company detail route)
 * still returns the existing opaque 404 so chapter membership cannot be probed.
 * This envelope only ever describes companies the caller is ALREADY entitled to
 * know exist.
 *
 * The `accessMessage` copy is deliberately DIRECT, THOROUGH, and written in a
 * member/founder-friendly tone (no jargon, no scolding) — it explains exactly
 * why a value is limited and what, if anything, unlocks more.
 *
 * Pure functions only. No DB writes, no sacred file touched.
 */
import type { MaAccessLevel, MaAccessDecision } from "./maAuthzGate";

/** The three-state parity envelope attached to every M&A intel response. */
export interface MaParityEnvelope {
  /** True when the company has ANY stored M&A readiness data. */
  hasData: boolean;
  /**
   * True when data exists but is withheld/limited at the caller's tier
   * (AGGREGATE, or FULL/DETAIL with narrative/buyers hidden). False when the
   * caller sees everything their tier can show, or when there is simply no data.
   */
  redacted: boolean;
  /** The access tier that produced this envelope. */
  accessLevel: MaAccessLevel;
  /**
   * Machine-readable reason, stable for UI branching + tests:
   *   "ok"            — full/detail data, nothing withheld.
   *   "aggregate"     — only anonymized scores/sector returned (names withheld).
   *   "detail_partial"— detail tier but narrative and/or buyers withheld.
   *   "no_data"       — entitled to view, but company has no M&A data yet.
   */
  reason: "ok" | "aggregate" | "detail_partial" | "no_data";
  /** Direct, member/founder-friendly explanation for the UI. */
  accessMessage: string;
}

const COPY = {
  no_data:
    "This company hasn’t added its M&A readiness profile yet. There’s nothing to " +
    "hide here — the founder simply hasn’t completed the M&A section. You’ll see " +
    "scores, strategic-buyer fit, and readiness detail here as soon as they do.",
  aggregate:
    "You’re seeing this company’s anonymized M&A summary — readiness scores and " +
    "sector only. Detailed strategic-buyer names, comparable exits, and the " +
    "readiness narrative are shared at the company’s discretion with its own " +
    "chapter and direct investors. Full detail unlocks if the company shares more " +
    "broadly or once you hold a qualifying position.",
  detail_partial:
    "You have detailed access to this company’s M&A scores and metrics. A few " +
    "elements — the strategic-buyer shortlist and/or the readiness narrative — are " +
    "held back per the company’s current sharing settings. Everything shown here is " +
    "complete and reconciles to the same source used across the platform.",
  ok:
    "You have full access to this company’s M&A intelligence. These figures come " +
    "from the same single source used everywhere on the platform — the view is " +
    "tailored to this surface, but the underlying data is identical.",
} as const;

/**
 * Build the parity envelope for a company the caller IS entitled to see
 * (i.e. not an out-of-scope 404 case). `hasData=false` means the company has no
 * stored M&A profile; in that case the tier is reported as-is but reason=no_data.
 */
export function buildMaParityEnvelope(
  decision: Pick<MaAccessDecision, "level" | "canSeeNarrative" | "canSeeBuyers">,
  hasData: boolean,
): MaParityEnvelope {
  if (!hasData) {
    return {
      hasData: false,
      redacted: false,
      accessLevel: decision.level,
      reason: "no_data",
      accessMessage: COPY.no_data,
    };
  }
  if (decision.level === "AGGREGATE") {
    return {
      hasData: true,
      redacted: true,
      accessLevel: "AGGREGATE",
      reason: "aggregate",
      accessMessage: COPY.aggregate,
    };
  }
  // FULL / DETAIL — redacted only if some element (narrative or buyers) is held back.
  const partiallyWithheld = !decision.canSeeNarrative || !decision.canSeeBuyers;
  if (partiallyWithheld) {
    return {
      hasData: true,
      redacted: true,
      accessLevel: decision.level,
      reason: "detail_partial",
      accessMessage: COPY.detail_partial,
    };
  }
  return {
    hasData: true,
    redacted: false,
    accessLevel: decision.level,
    reason: "ok",
    accessMessage: COPY.ok,
  };
}

/** Exposed for tests / reuse. */
export const MA_PARITY_COPY = COPY;

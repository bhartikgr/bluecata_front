/**
 * WAVE 33 · CP-PIPE-06 — PROVENANCE CANNOT BE OMITTED OR ACQUIRED.
 *
 * PIPE-05 ("provenance columns") is BUILT AND WIRED: `partner_attributions`
 * carries `attribution_source`, `attributed_by`, `attributed_at`, a revision
 * chain and a revisions table. The columns exist and are populated.
 *
 * PIPE-06 is the RULE those columns were supposed to carry, and it was never
 * written. Two halves, both open:
 *
 * ── OMITTED ─────────────────────────────────────────────────────────────────
 * `POST /api/admin/partners/:id/attributions` read `source` from the request
 * body and passed `source ?? "admin_manual"`. A caller who sent no source did
 * not get a refusal — they got a row permanently asserting the attribution was
 * an administrative decision. That is not a default; it is a FABRICATED
 * provenance, indistinguishable afterwards from a real one, in the table the
 * spec designates the SSOT for who originated a relationship. The validator
 * immediately above it already rejected an *unknown* source with a 400, so
 * omission was the one case that got a fiction instead of an error.
 *
 * ── ACQUIRED ────────────────────────────────────────────────────────────────
 * Uniqueness is enforced on `(partner_id, company_id) WHERE revoked_at IS NULL`
 * — PER PAIR. Nothing anywhere looked at the company alone. So partner B could
 * attribute a company already actively attributed to partner A, through a
 * SELF-SERVICE source (`partner_claim`, `referral_code`, `partner_portfolio`)
 * that requires no adjudication, and both rows would sit there as equally valid
 * provenance. Attribution is revenue-bearing; that is a route to acquiring
 * another partner's originated relationship by asserting it.
 *
 * ── WHAT THIS ENGINE DOES ───────────────────────────────────────────────────
 * Pure. No DB, no request, no clock — so both poles of every rule are directly
 * assertable, and neither the store nor the route can hold a copy of the logic
 * that drifts.
 *
 * It does NOT make displacement impossible. An incumbent claim can be wrong,
 * and a platform that can never correct one is worse than one that can. The
 * rule is that displacement must be ADJUDICATED (`admin_manual`, by a named
 * actor, recorded as a displacement) rather than SELF-ASSERTED. Self-service
 * sources are refused against an incumbent; admin action is admitted and
 * flagged.
 */

/** The 0114 CHECK set. Mirrored here so the engine stays free of store imports. */
export const PROVENANCE_SOURCES = [
  "admin_manual",
  "referral_code",
  "partner_claim",
  "partner_portfolio",
] as const;

export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number];

/**
 * Sources a partner can assert about THEMSELVES, with no third party agreeing.
 *
 * This is an explicit ALLOW-LIST of the adjudicated case rather than a
 * deny-list of self-service ones: a source added to the union later is treated
 * as self-service — the restrictive answer — until someone deliberately says
 * otherwise. A deny-list would silently admit it.
 */
const ADJUDICATED_SOURCES: readonly string[] = ["admin_manual"];

export function isProvenanceSource(v: unknown): v is ProvenanceSource {
  return typeof v === "string" && (PROVENANCE_SOURCES as readonly string[]).includes(v);
}

export function isSelfServiceSource(source: string): boolean {
  return !ADJUDICATED_SOURCES.includes(source);
}

export type ProvenanceVerdict =
  | "ADMIT"
  | "ADMIT_ALREADY_HELD"
  | "ADMIT_ADJUDICATED_DISPLACEMENT"
  | "REFUSE_SOURCE_OMITTED"
  | "REFUSE_SOURCE_UNKNOWN"
  | "REFUSE_ACTOR_OMITTED"
  | "REFUSE_ACQUISITION";

export interface ProvenanceIncumbent {
  partnerId: string;
  attributionSource: string;
  attributedAt: string;
}

export interface ProvenanceAssessment {
  verdict: ProvenanceVerdict;
  admit: boolean;
  /** Set only when an admitted write displaces another partner's live claim. */
  displaces: ProvenanceIncumbent | null;
  /** Server-authored. Printed verbatim; never assembled on the client. */
  copy: string;
}

const COPY: Record<ProvenanceVerdict, string> = {
  ADMIT:
    "Provenance recorded. This attribution names its source and the person who made it, and no other partner holds a live claim on this company.",
  ADMIT_ALREADY_HELD:
    "This partner already holds a live attribution for this company. The existing record is kept, with its original provenance intact — re-recording it would overwrite who originated the relationship and when.",
  ADMIT_ADJUDICATED_DISPLACEMENT:
    "Another partner holds a live attribution for this company. An administrator may displace it, but the displacement is recorded as such: the incumbent claim is not quietly overwritten, and both claims remain in the revision history.",
  REFUSE_SOURCE_OMITTED:
    "This attribution names no source, so it cannot be recorded. Provenance is not optional and is not assumed — recording an unstated source as an administrative decision would fabricate a fact that later readers cannot distinguish from a real one.",
  REFUSE_SOURCE_UNKNOWN:
    "This attribution names a source that is not one of the recognised kinds, so it cannot be recorded. An unrecognised provenance is treated as no provenance rather than being stored as free text.",
  REFUSE_ACTOR_OMITTED:
    "This attribution names no person responsible for it, so it cannot be recorded. Provenance identifies who made the attribution as well as how it arose; a record with only one of the two cannot be audited.",
  REFUSE_ACQUISITION:
    "Another partner already holds a live attribution for this company, and this claim asserts itself without adjudication. Attribution is revenue-bearing and cannot be acquired by assertion. An administrator can review the competing claims and decide.",
};

/**
 * @param incumbents ACTIVE (non-revoked) attributions on the company, from any
 *   partner. Revoked rows must be excluded by the caller: a revoked claim is
 *   released, and treating it as live would freeze a company to whoever
 *   attributed it first, forever.
 */
export function assessAdmission(input: {
  requestedPartnerId: string;
  source: unknown;
  actor: unknown;
  incumbents: readonly ProvenanceIncumbent[];
}): ProvenanceAssessment {
  const { requestedPartnerId, source, actor, incumbents } = input;

  const verdict = (v: ProvenanceVerdict, displaces: ProvenanceIncumbent | null = null): ProvenanceAssessment => ({
    verdict: v,
    admit: v.startsWith("ADMIT"),
    displaces,
    copy: COPY[v],
  });

  // ── OMISSION ──────────────────────────────────────────────────────────────
  // Checked before anything else: a write with no provenance is refused
  // regardless of whether it would also have been an acquisition, because the
  // more fundamental fact is that nothing is known about where it came from.
  if (source === undefined || source === null || (typeof source === "string" && source.trim() === "")) {
    return verdict("REFUSE_SOURCE_OMITTED");
  }
  if (!isProvenanceSource(source)) {
    return verdict("REFUSE_SOURCE_UNKNOWN");
  }
  if (typeof actor !== "string" || actor.trim() === "") {
    return verdict("REFUSE_ACTOR_OMITTED");
  }

  // ── ACQUISITION ───────────────────────────────────────────────────────────
  const own = incumbents.find((i) => i.partnerId === requestedPartnerId);
  if (own) return verdict("ADMIT_ALREADY_HELD");

  const foreign = incumbents.filter((i) => i.partnerId !== requestedPartnerId);
  if (foreign.length > 0) {
    // Oldest live claim is the one being displaced — the originator, not
    // whoever most recently asserted.
    const oldest = foreign
      .slice()
      .sort((a, b) => (a.attributedAt < b.attributedAt ? -1 : a.attributedAt > b.attributedAt ? 1 : 0))[0];
    if (isSelfServiceSource(source)) return verdict("REFUSE_ACQUISITION", oldest);
    return verdict("ADMIT_ADJUDICATED_DISPLACEMENT", oldest);
  }

  return verdict("ADMIT");
}

/**
 * Integrity of an attribution ALREADY on file.
 *
 * Rows written before this rule existed can carry provenance that would not be
 * admitted today. They are reported, never rewritten: back-filling a plausible
 * source onto a historical row would manufacture exactly the fiction this item
 * exists to prevent.
 */
export function assessExistingRow(row: {
  attributionSource: unknown;
  attributedBy: unknown;
  attributedAt: unknown;
}): { intact: boolean; issues: string[]; copy: string } {
  const issues: string[] = [];
  if (!isProvenanceSource(row.attributionSource)) issues.push("source");
  if (typeof row.attributedBy !== "string" || row.attributedBy.trim() === "") issues.push("actor");
  if (typeof row.attributedAt !== "string" || row.attributedAt.trim() === "") issues.push("date");

  if (issues.length === 0) {
    return { intact: true, issues, copy: "Provenance complete: source, responsible person and date are all recorded." };
  }
  const names: Record<string, string> = {
    source: "how this attribution arose",
    actor: "who made it",
    date: "when it was made",
  };
  return {
    intact: false,
    issues,
    copy: `Provenance incomplete — this record does not state ${issues
      .map((i) => names[i])
      .join(" or ")}. It is shown as it stands rather than filled in, because a supplied value would be indistinguishable from a recorded one.`,
  };
}

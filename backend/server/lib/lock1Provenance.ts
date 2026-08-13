/**
 * WAVE 33 · CP-PIPE-10 — LOCK 1.
 *
 * LOCK 1 has TWO parts, and the register conflates them under the single label
 * "LOCK-1 wording". They have completely different statuses and must not be
 * treated as one item:
 *
 *   PART A — THE MECHANISM: "soft-circle provenance single-write path".
 *     Migration 0133 added `sourced_from_partner_id` and
 *     `sourced_from_partner_attribution_id` to `soft_circles`, and 0132's own
 *     header states the rule plainly: "LOCK 1 only imposes a CO-WRITE
 *     discipline on the APPLICATION LAYER for these pre-existing columns."
 *     An application-layer discipline that nothing enforces is not a
 *     discipline. It was never written. BUILDABLE — and built here.
 *
 *   PART B — THE WORDING: the verbatim LOCK 1 text the pipeline surface must
 *     carry. OQ-5. The text lives in the owner's LOCK register and was never
 *     captured into any document available to this build.
 *     **PARAPHRASING A LOCK IS NOT ACCEPTABLE**, so no text is invented here.
 *     The MECHANISM that carries the wording ships; the VALUE is supplied by
 *     the owner through an admin route, with no code change. Until then the
 *     surface renders an explicit statement that the wording has not been
 *     supplied — never a paraphrase, and never silence, because silence would
 *     make an unsatisfied lock look satisfied.
 *
 * ── WHY PART A MATTERED ─────────────────────────────────────────────────────
 * `partnerConsortiumRoutes.ts` holds the only writer of a partner-sourced
 * soft circle. It wrote `source_type='partner'` and `source_id=<partnerId>` and
 * NEVER touched either of the two columns 0133 created for exactly this
 * purpose. So the provenance columns the lock exists to govern were populated
 * by nobody, while the table, the index and the migration all existed — the
 * single-write path looked built from every angle except the one that matters.
 *
 * This engine is PURE: no DB, no request, no clock, so both poles of every rule
 * are directly assertable.
 */

export type Lock1Refusal =
  | "LOCK1_PARTNER_ID_MISSING"
  | "LOCK1_ATTRIBUTION_MISSING"
  | "LOCK1_ATTRIBUTION_PARTNER_MISMATCH"
  | "LOCK1_ATTRIBUTION_COMPANY_MISMATCH"
  | "LOCK1_ATTRIBUTION_REVOKED";

export interface Lock1Verdict {
  ok: boolean;
  refusal: Lock1Refusal | null;
  /** Server-authored. Printed verbatim; never assembled on the client. */
  copy: string;
  /** The pair that must be co-written. Null on refusal — never a partial pair. */
  coWrite: { sourcedFromPartnerId: string; sourcedFromPartnerAttributionId: string } | null;
}

const REFUSAL_COPY: Record<Lock1Refusal, string> = {
  LOCK1_PARTNER_ID_MISSING:
    "This soft circle is recorded as partner-sourced but names no partner, so it cannot be written. A partner-sourced record without a partner is a claim with nothing behind it.",
  LOCK1_ATTRIBUTION_MISSING:
    "This soft circle names a sourcing partner but no attribution establishing that partner's relationship with the company. Both are written together or neither is written — a partner id on its own records who claims the deal without recording what entitles them to.",
  LOCK1_ATTRIBUTION_PARTNER_MISMATCH:
    "The attribution offered as provenance belongs to a different partner than the one sourcing this soft circle. The pair must refer to the same partner, or the provenance describes someone else's relationship.",
  LOCK1_ATTRIBUTION_COMPANY_MISMATCH:
    "The attribution offered as provenance is for a different company than this soft circle. Provenance from an unrelated company would attribute the deal on the strength of a relationship that has nothing to do with it.",
  LOCK1_ATTRIBUTION_REVOKED:
    "The attribution offered as provenance has been revoked, so it no longer establishes a relationship with this company. A revoked attribution cannot be used to source new deals.",
};

const OK_COPY =
  "Partner sourcing and the attribution behind it are written together, as a single record of where this deal came from.";

/**
 * THE CO-WRITE RULE.
 *
 * Only applies to partner-sourced rows: a soft circle that is not
 * partner-sourced has no partner provenance to co-write, and demanding one
 * would block ordinary investor soft circles entirely.
 *
 * On refusal `coWrite` is null — deliberately, so a caller cannot spread a
 * half-populated pair. A partner id without its attribution is precisely the
 * state LOCK 1 exists to prevent, and handing one back on the failure path
 * would make it easy to write by accident.
 */
export function assertLock1CoWrite(input: {
  sourceType: string;
  sourcedFromPartnerId: string | null | undefined;
  companyId: string;
  attribution:
    | { id: string; partnerId: string; companyId: string; revokedAt: string | null }
    | null
    | undefined;
}): Lock1Verdict {
  const refuse = (r: Lock1Refusal): Lock1Verdict => ({
    ok: false,
    refusal: r,
    copy: REFUSAL_COPY[r],
    coWrite: null,
  });

  if (input.sourceType !== "partner") {
    // Not in scope for LOCK 1. Stated rather than silently returning ok, so a
    // reader can see the boundary is deliberate.
    return {
      ok: true,
      refusal: null,
      copy: "This soft circle is not partner-sourced, so LOCK 1's co-write rule does not apply to it.",
      coWrite: null,
    };
  }

  const partnerId = (input.sourcedFromPartnerId ?? "").trim();
  if (!partnerId) return refuse("LOCK1_PARTNER_ID_MISSING");

  const attr = input.attribution;
  if (!attr || !attr.id) return refuse("LOCK1_ATTRIBUTION_MISSING");
  if (attr.partnerId !== partnerId) return refuse("LOCK1_ATTRIBUTION_PARTNER_MISMATCH");
  if (attr.companyId !== input.companyId) return refuse("LOCK1_ATTRIBUTION_COMPANY_MISMATCH");
  if (attr.revokedAt) return refuse("LOCK1_ATTRIBUTION_REVOKED");

  return {
    ok: true,
    refusal: null,
    copy: OK_COPY,
    coWrite: { sourcedFromPartnerId: partnerId, sourcedFromPartnerAttributionId: attr.id },
  };
}

/* ── PART B — THE WORDING (OQ-5) ─────────────────────────────────────────── */

export const LOCK1_TEXT_KEY = "LOCK_1";

export interface LockNotice {
  key: string;
  /** The owner's verbatim text. NULL until supplied — never a placeholder. */
  text: string | null;
  supplied: boolean;
  setBy: string | null;
  setAt: string | null;
  /** What the surface renders. Never a paraphrase of an unsupplied lock. */
  copy: string;
}

/**
 * NOT-SUPPLIED copy. This is deliberately ABOUT the absence rather than an
 * approximation of the lock, and it is the single hardest constraint in this
 * item: the temptation is to write something reassuring that sounds like the
 * lock. That would be a paraphrase wearing a disclaimer, and it is exactly what
 * OQ-5 forbids.
 *
 * Rendering nothing at all would be worse still — an unsatisfied lock would
 * look satisfied, which is the failure mode this whole build keeps finding.
 */
const NOT_SUPPLIED_COPY =
  "The wording for this lock has not been supplied by the owner, so it is not shown. It is deliberately not summarised or approximated: an approximate lock is not a lock. This notice will be replaced by the exact text once it is provided.";

export function describeLockNotice(row: {
  key: string;
  text: string | null | undefined;
  setBy?: string | null;
  setAt?: string | null;
}): LockNotice {
  const text = typeof row.text === "string" && row.text.trim() !== "" ? row.text : null;
  return {
    key: row.key,
    text,
    supplied: text !== null,
    setBy: row.setBy ?? null,
    setAt: row.setAt ?? null,
    // When supplied, the owner's text IS the copy, byte for byte. Nothing is
    // prepended, appended, trimmed into, or wrapped around it.
    copy: text !== null ? text : NOT_SUPPLIED_COPY,
  };
}

/** The unsupplied notice, exported so tests can assert it is not a paraphrase. */
export const LOCK_NOT_SUPPLIED_COPY = NOT_SUPPLIED_COPY;

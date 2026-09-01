/**
 * ════════════════════════════════════════════════════════════════════════════
 * WAVE 230C — R227.2 APPLIED TO WHAT THE PLATFORM *SENDS*, NOT ONLY TO WHAT IT
 * SHOWS.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * R233.3: "EMAIL TEMPLATES ARE AN UNSWEPT SURFACE and must be inventoried in
 * full … An email is more durable than a screen — it sits in the recipient's
 * inbox, forwardable, indefinitely."
 *
 * ── WHY THIS FILE EXISTS AT ALL, AND WHY A CODE EDIT ALONE WOULD SHIP NOTHING
 *
 * `server/emailStore.ts` holds a seed array of 21 templates. On boot,
 * `seedAndLoadTemplatesFromDb()` pushes them into `email_templates` with
 * **INSERT OR IGNORE**, and `findTemplate()` is **DB-first**. That combination
 * is correct for its original purpose (never clobber an admin's edit) and has
 * one consequence that matters here:
 *
 *   ON ANY DATABASE THAT HAS ALREADY BOOTED ONCE, CORRECTING THE SEED LITERAL
 *   IN `emailStore.ts` CHANGES NOTHING. The stale row wins forever.
 *
 * Measured against the real `data.db` (read-only copy): 21 rows present, every
 * one of them `updated_by = 'system:seed'` and byte-identical to the seed. So
 * the live platform would have kept sending the old text after a release that
 * only edited the code. The correction therefore needs BOTH halves: the seed
 * literal (so a fresh database is born correct) and the remediation below (so
 * an existing database is corrected on the next boot).
 *
 * ── WHAT IT WILL AND WILL NOT OVERWRITE
 *
 * The UPDATE is fully predicated: it fires only when the row still holds the
 * exact superseded bytes AND was last written by the seeder or by a previous
 * run of this same corrector. **An admin edit is never clobbered** — if
 * somebody has already rewritten the template by hand, the corrector reports
 * `skipped_admin_edited` and leaves it alone. That is the same asymmetry R228.1
 * chose for the test-data work: reversible under-reach beats unrecoverable
 * over-reach.
 *
 * ── THE COPY IS THE PLATFORM'S OWN, NOT INVENTED PROSE
 *
 * Every replacement sentence already exists in this tree and is already proved
 * by a passing test elsewhere:
 *   · "This records your declaration. It is not a check of it."
 *       — client/src/components/investor/AccreditationDeclaration.tsx:318
 *   · "Capavate does not conduct KYC or AML verification"
 *       — client/src/lib/legalDocs.ts:166 (the Privacy Policy)
 *   · "Capavate does not perform it on your behalf."
 *       — client/src/components/investor/AccreditationDeclaration.tsx (in the
 *         restyle baseline as an asserted string)
 *
 * Nothing is deleted (R195.5): the superseded text is retained here, in the
 * open, as the predicate the corrector matches on. It is the record of what was
 * withdrawn and it is what makes the remediation auditable.
 */
import { rawDb } from "../db/connection";

/** Words R227.2 prohibits when asserted **about a person, a holding, or an
 *  eligibility**. Lower-cased; matched on word boundaries by the scanner. */
export const R227_2_PROHIBITED_TERMS: readonly string[] = [
  "verified",
  "verification",
  "verify",
  "vetted",
  "screened",
  "approved",
  "certified",
  "guaranteed",
  "compliant",
  "accredited",
  "kyc",
  "aml",
  "due diligence",
];

/** One superseded → corrected pair. `fromSubject` / `fromBodyHtml` are the
 *  bytes the live row must still hold for the remediation to fire. */
export interface Wave230cTemplateCorrection {
  slug: string;
  fromSubject: string;
  fromBodyHtml: string;
  fromBodyText: string;
  toSubject: string;
  toBodyHtml: string;
  toBodyText: string;
  /** Why it is Class A, in one line, for the owner-facing report. */
  rationale: string;
}

/** The honest-register sentences, kept as named constants so a test can assert
 *  the corrected copy contains the platform's OWN words rather than new ones. */
export const HONEST_DECLARATION_SENTENCE =
  "This records your declaration. It is not a check of it.";
export const HONEST_NO_KYC_SENTENCE =
  "Capavate does not conduct KYC or AML verification and does not perform it on your behalf.";

/**
 * CLASS A — the only one in the 21. A template in the "compliance" category
 * that tells a person their KYC status, on a platform whose own Terms and
 * Privacy Policy both state it does not conduct KYC or AML verification, and
 * whose seeded demo row renders the literal word "verified" about a named
 * individual.
 *
 * The correction keeps the message (your document's recorded status changed)
 * and drops the claim (that Capavate checked you).
 */
export const WAVE230C_EMAIL_TEMPLATE_CORRECTIONS: readonly Wave230cTemplateCorrection[] = [
  {
    slug: "kyc_update",
    fromSubject: "Your KYC status: {{new_status}}",
    fromBodyHtml:
      "<p>Hi {{recipient_name}}, your KYC status is now {{new_status}}. {{action_required}}</p>",
    fromBodyText: "KYC update.",
    toSubject: "Your Capavate document status: {{new_status}}",
    toBodyHtml:
      "<p>Hi {{recipient_name}}, the status recorded against the document you uploaded is now {{new_status}}. {{action_required}}</p>" +
      `<p>${HONEST_DECLARATION_SENTENCE} ${HONEST_NO_KYC_SENTENCE}</p>`,
    toBodyText: `Document status update. ${HONEST_DECLARATION_SENTENCE} ${HONEST_NO_KYC_SENTENCE}`,
    rationale:
      'Category "compliance"; subject and body assert a KYC status about a person. ' +
      'The Privacy Policy and the Terms both state Capavate "does not conduct KYC or AML verification", ' +
      'and the seeded outbox row renders {{new_status}} as the literal word "verified". R227.2 prohibits ' +
      "exactly that word about a person.",
  },
];

export type Wave230cCorrectionOutcome =
  | { slug: string; state: "applied" }
  | { slug: string; state: "already_corrected" }
  | { slug: string; state: "skipped_admin_edited" }
  | { slug: string; state: "not_present" }
  | { slug: string; state: "unreadable"; message: string };

/** The marker written into `updated_by`. Also the value a re-run accepts, so
 *  the remediation is idempotent without being able to overwrite a human. */
export const WAVE230C_UPDATED_BY = "system:wave230c_r227_2";

/** Value written by the original seeder. Only rows still bearing it (or this
 *  corrector's own marker) are eligible. */
const SEED_UPDATED_BY = "system:seed";

/**
 * Apply the Class A corrections to the canonical `email_templates` rows.
 *
 * Never throws: a database that has not run migration 0081 simply reports
 * `unreadable` and the caller carries on with the seed set, which is already
 * corrected in code. Degrading to "nothing corrected" is honest; degrading to
 * "boot failed" would take the platform down over a copy fix.
 */
export function wave230cApplyEmailTemplateCorrections(): Wave230cCorrectionOutcome[] {
  const out: Wave230cCorrectionOutcome[] = [];
  let db: ReturnType<typeof rawDb>;
  try {
    db = rawDb();
  } catch (err) {
    return WAVE230C_EMAIL_TEMPLATE_CORRECTIONS.map((c) => ({
      slug: c.slug,
      state: "unreadable" as const,
      message: (err as Error).message,
    }));
  }

  for (const c of WAVE230C_EMAIL_TEMPLATE_CORRECTIONS) {
    try {
      const row = db
        .prepare(
          `SELECT subject, body_html AS bodyHtml, body_text AS bodyText, updated_by AS updatedBy
             FROM email_templates WHERE slug = ?`,
        )
        .get(c.slug) as
        | { subject: string; bodyHtml: string; bodyText: string; updatedBy: string | null }
        | undefined;

      if (!row) {
        out.push({ slug: c.slug, state: "not_present" });
        continue;
      }
      if (row.subject === c.toSubject && row.bodyHtml === c.toBodyHtml) {
        out.push({ slug: c.slug, state: "already_corrected" });
        continue;
      }
      const eligibleWriter =
        row.updatedBy === SEED_UPDATED_BY || row.updatedBy === WAVE230C_UPDATED_BY;
      const stillSuperseded = row.subject === c.fromSubject && row.bodyHtml === c.fromBodyHtml;
      if (!eligibleWriter || !stillSuperseded) {
        /* Somebody has edited this template by hand. Their words stand; the
           correction is reported to the operator instead of imposed. */
        out.push({ slug: c.slug, state: "skipped_admin_edited" });
        continue;
      }
      db.prepare(
        `UPDATE email_templates
            SET subject = ?, body_html = ?, body_text = ?, updated_at = ?, updated_by = ?
          WHERE slug = ? AND subject = ? AND body_html = ? AND updated_by = ?`,
      ).run(
        c.toSubject,
        c.toBodyHtml,
        c.toBodyText,
        new Date().toISOString(),
        WAVE230C_UPDATED_BY,
        c.slug,
        c.fromSubject,
        c.fromBodyHtml,
        row.updatedBy,
      );
      out.push({ slug: c.slug, state: "applied" });
    } catch (err) {
      out.push({ slug: c.slug, state: "unreadable", message: (err as Error).message });
    }
  }
  return out;
}

export interface Wave230cProhibitedHit {
  slug: string;
  field: "subject" | "bodyHtml" | "bodyText";
  term: string;
}

/**
 * The R227.2 scanner used by both the inventory document and the fence test.
 *
 * It reports **term occurrences**, deliberately without judging whether the
 * occurrence is about a person. That judgement is the human classification
 * (Class A / B / C) recorded in EMAIL_TEMPLATE_INVENTORY.md — a regex cannot
 * make it, and a scanner that pretended to would be the ninth
 * unconditionally-true predicate on this platform. What the scanner IS good for
 * is the regression fence: the corrected `kyc_update` must produce no hit
 * outside the disclaiming sentence, and no NEW template may arrive carrying a
 * prohibited term without somebody classifying it.
 */
export function wave230cScanProhibited(
  templates: ReadonlyArray<{ slug: string; subject: string; bodyHtml: string; bodyText?: string | null }>,
): Wave230cProhibitedHit[] {
  const hits: Wave230cProhibitedHit[] = [];
  for (const t of templates) {
    const fields: Array<["subject" | "bodyHtml" | "bodyText", string]> = [
      ["subject", t.subject ?? ""],
      ["bodyHtml", t.bodyHtml ?? ""],
      ["bodyText", t.bodyText ?? ""],
    ];
    for (const [field, value] of fields) {
      const hay = value.toLowerCase();
      for (const term of R227_2_PROHIBITED_TERMS) {
        const re = new RegExp(`(^|[^a-z])${term.replace(/ /g, "\\s+")}([^a-z]|$)`, "i");
        if (re.test(hay)) hits.push({ slug: t.slug, field, term });
      }
    }
  }
  return hits;
}

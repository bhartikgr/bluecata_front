/**
 * ============================================================================
 * WAVE 230C — FENCE FOR THE R227.2 EMAIL CORRECTION
 * ============================================================================
 *
 * The defect this fences is NOT "the seed array said KYC". That half is trivial
 * to fix and trivially proved. The defect is the one that would have shipped a
 * release that changed nothing:
 *
 *   `seedAndLoadTemplatesFromDb()` seeds with INSERT OR IGNORE and
 *   `findTemplate()` is DB-first. Every row in the real `data.db` is already
 *   present and still `updated_by = 'system:seed'`. Correcting the literal
 *   alone leaves the stale row in place and the platform keeps sending it.
 *
 * So §2 below is the test that matters, and it is written to FAIL if the code
 * seed were the only thing corrected: it writes the SUPERSEDED text into the
 * row FIRST, then runs the remediation, then re-reads the ROW — not the seed
 * array. A fixture the fix cannot move would prove nothing (tenth inert
 * mechanism), so the fixture is deliberately placed in the defective state
 * before every assertion. The last test in §2 goes further and asks the real
 * production lookup, `findTemplate`, what it would actually send.
 *
 * §3 is the counter-fence: an admin-edited row must survive untouched. A
 * remediation that also silently overwrote a human's words would trade one
 * dishonesty for a worse one.
 *
 * NOTE ON THE DATABASE: vitest.config.ts pins NODE_ENV=test, and
 * server/db/connection.ts resolves that to ":memory:". Every row this file
 * writes lives in a per-worker in-memory database. The tree's real `data.db`
 * is never opened, never written and never destroyed by this test — which is
 * also why the test drives `rawDb()` rather than opening the file itself.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { rawDb } from "../db/connection";
import { hydrateEmailStore, findTemplate } from "../emailStore";

import {
  WAVE230C_EMAIL_TEMPLATE_CORRECTIONS,
  WAVE230C_UPDATED_BY,
  HONEST_DECLARATION_SENTENCE,
  HONEST_NO_KYC_SENTENCE,
  R227_2_PROHIBITED_TERMS,
  wave230cScanProhibited,
  wave230cApplyEmailTemplateCorrections,
} from "../lib/wave230cEmailTemplateHonesty";

const CORRECTION = WAVE230C_EMAIL_TEMPLATE_CORRECTIONS.find((c) => c.slug === "kyc_update")!;
const EMAIL_STORE_SRC = path.resolve(__dirname, "../emailStore.ts");

/** Put the row into the DEFECTIVE state so the assertion that follows can
 *  distinguish the fix from the defect. */
function arm(updatedBy: string): void {
  rawDb()
    .prepare(
      `UPDATE email_templates SET subject=?, body_html=?, body_text=?, updated_by=? WHERE slug='kyc_update'`,
    )
    .run(CORRECTION.fromSubject, CORRECTION.fromBodyHtml, CORRECTION.fromBodyText, updatedBy);
}

function readRow() {
  return rawDb()
    .prepare(
      `SELECT subject, body_html AS bodyHtml, body_text AS bodyText, updated_by AS updatedBy
         FROM email_templates WHERE slug='kyc_update'`,
    )
    .get() as { subject: string; bodyHtml: string; bodyText: string; updatedBy: string };
}

describe("W230C S1 - the corrected copy is the platform's OWN register, not new prose", () => {
  it("the seed literal in emailStore.ts byte-matches the correction module", () => {
    /* Two independently-written expressions. emailStore.ts spells the strings
     * out; the module composes them from named constants. If a future edit
     * moves one and not the other, the seed and the remediation would disagree
     * about what "corrected" means and the remediation would fire forever. */
    const src = readFileSync(EMAIL_STORE_SRC, "utf8");
    expect(src).toContain(`subject: ${JSON.stringify(CORRECTION.toSubject)}`);
    expect(src).toContain(`bodyHtml: ${JSON.stringify(CORRECTION.toBodyHtml)}`);
    expect(src).toContain(`bodyText: ${JSON.stringify(CORRECTION.toBodyText)}`);
  });

  it("the superseded KYC claim is gone from the live seed array", () => {
    const src = readFileSync(EMAIL_STORE_SRC, "utf8");
    /* Strip line and block comments before concluding, and PROVE the stripper
     * stripped in BOTH directions: the retained-history comment does mention
     * the old subject, and that mention must not count as a live claim; the
     * code around it must survive. */
    const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
    expect(src).toContain('was: subject "Your KYC status: {{new_status}}"'); // stripper had work to do
    expect(stripped).not.toContain("was: subject"); // it did the work
    expect(stripped).toContain("tpl_kyc_update"); // it did not eat the code
    expect(stripped).not.toContain('subject: "Your KYC status:');
    expect(stripped).not.toContain("your KYC status is now");
  });

  it("the replacement sentences exist verbatim elsewhere in the tree", () => {
    const decl = readFileSync(
      path.resolve(__dirname, "../../client/src/components/investor/AccreditationDeclaration.tsx"),
      "utf8",
    );
    const legal = readFileSync(path.resolve(__dirname, "../../client/src/lib/legalDocs.ts"), "utf8");
    expect(decl).toContain(HONEST_DECLARATION_SENTENCE);
    expect(legal).toContain("does not conduct KYC or AML verification");
    expect(CORRECTION.toBodyHtml).toContain(HONEST_DECLARATION_SENTENCE);
    expect(CORRECTION.toBodyHtml).toContain(HONEST_NO_KYC_SENTENCE);
  });
});

describe("W230C S2 - the remediation reaches an ALREADY-SEEDED database row", () => {
  beforeEach(() => {
    hydrateEmailStore();
    arm("system:seed");
  });

  it("is armed: the row genuinely holds the superseded text before the fix runs", () => {
    const before = readRow();
    expect(before.subject).toBe(CORRECTION.fromSubject);
    expect(before.subject).toContain("KYC status");
  });

  it("corrects the ROW (not the seed array) and marks the writer", () => {
    const outcomes = wave230cApplyEmailTemplateCorrections();
    expect(outcomes).toContainEqual({ slug: "kyc_update", state: "applied" });

    const after = readRow();
    expect(after.subject).toBe(CORRECTION.toSubject);
    expect(after.bodyHtml).toBe(CORRECTION.toBodyHtml);
    expect(after.bodyText).toBe(CORRECTION.toBodyText);
    expect(after.updatedBy).toBe(WAVE230C_UPDATED_BY);
    expect(after.subject).not.toContain("KYC status");
  });

  it("is idempotent - a second run reports already_corrected and rewrites nothing", () => {
    wave230cApplyEmailTemplateCorrections();
    const first = readRow();
    const outcomes = wave230cApplyEmailTemplateCorrections();
    expect(outcomes).toContainEqual({ slug: "kyc_update", state: "already_corrected" });
    expect(readRow()).toEqual(first);
  });

  it("what the SEND path resolves after a boot is the corrected text", () => {
    /* The end-to-end claim, and the one a seed-only fix would fail: arm the row
     * to the defective state, boot the store the way the server boots it, then
     * ask the production lookup - findTemplate, DB-first - what it would send. */
    arm("system:seed");
    expect(readRow().subject).toContain("KYC status");
    hydrateEmailStore();
    const t = findTemplate("kyc_update");
    expect(t).not.toBeNull();
    expect(t!.subject).toBe(CORRECTION.toSubject);
    expect(t!.bodyHtml).toContain(HONEST_DECLARATION_SENTENCE);
  });
});

describe("W230C S3 - an admin's own edit is never clobbered", () => {
  it("skips a row whose updated_by is a human, and leaves the bytes intact", () => {
    hydrateEmailStore();
    rawDb()
      .prepare(
        `UPDATE email_templates SET subject=?, body_html=?, body_text=?, updated_by=? WHERE slug='kyc_update'`,
      )
      .run("Admin's own subject", "<p>Admin's own body</p>", "admin text", "u_admin_real");

    const outcomes = wave230cApplyEmailTemplateCorrections();
    expect(outcomes).toContainEqual({ slug: "kyc_update", state: "skipped_admin_edited" });

    const after = readRow();
    expect(after.subject).toBe("Admin's own subject");
    expect(after.updatedBy).toBe("u_admin_real");
  });
});

describe("W230C S4 - the R227.2 scanner is not an unconditionally-true predicate", () => {
  it("finds a prohibited term when one is present", () => {
    const hits = wave230cScanProhibited([
      { slug: "probe", subject: "Your KYC status: verified", bodyHtml: "<p>ok</p>", bodyText: "" },
    ]);
    expect(hits.map((h) => h.term).sort()).toEqual(["kyc", "verified"]);
  });

  it("finds nothing in copy that carries none", () => {
    expect(
      wave230cScanProhibited([
        { slug: "probe", subject: "Your round closed", bodyHtml: "<p>done</p>", bodyText: "" },
      ]),
    ).toEqual([]);
  });

  it("does not match a prohibited term buried inside a longer word", () => {
    expect(
      wave230cScanProhibited([
        { slug: "probe", subject: "Unverifiable amlodipine screenshots", bodyHtml: "", bodyText: "" },
      ]),
    ).toEqual([]);
  });

  it("the corrected template's subject is clean and its body hits are only the denial", () => {
    const hits = wave230cScanProhibited([
      {
        slug: CORRECTION.slug,
        subject: CORRECTION.toSubject,
        bodyHtml: CORRECTION.toBodyHtml,
        bodyText: CORRECTION.toBodyText,
      },
    ]);
    /* The subject - the durable, forwardable line - must be clean. */
    expect(hits.filter((h) => h.field === "subject")).toEqual([]);
    /* The body still contains "KYC", "AML" and "verification" - inside the
     * sentence that DENIES the check. That is R227.2 satisfied, not violated,
     * so it is asserted explicitly rather than waved past. */
    expect(hits.length).toBeGreaterThan(0);
    expect(CORRECTION.toBodyHtml).toContain(HONEST_NO_KYC_SENTENCE);
    for (const h of hits) {
      expect(["kyc", "aml", "verification"]).toContain(h.term);
    }
  });

  it("covers every term R227.2 names", () => {
    expect(R227_2_PROHIBITED_TERMS).toEqual(
      expect.arrayContaining([
        "verified", "verification", "verify", "vetted", "screened", "approved",
        "certified", "guaranteed", "compliant", "accredited", "kyc", "aml", "due diligence",
      ]),
    );
  });
});

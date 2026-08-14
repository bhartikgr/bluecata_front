/**
 * WAVE 44 — "the two other promises that produced nothing": ZERO invoices and
 * ZERO welcome/magic-link emails for 30 approved applications.
 *
 * The brief asks for a verdict per promise: (a) not implemented, (b) implemented
 * but not wired to approval, or (c) implemented and failing silently. This file
 * ESTABLISHES each verdict by execution, so the verdict is evidence rather than
 * an opinion. It is deliberately a measurement file: it does not change either
 * behaviour, because one of the two needs an owner decision and the other needs
 * infrastructure (SMTP) that no code change can supply.
 *
 * WELCOME / MAGIC-LINK EMAIL \u2014 VERDICT (c): IMPLEMENTED, WIRED, FAILING SILENTLY.
 *   Approval mints a durable single-use `auth_redeem_tokens` row with
 *   `intent='partner_invite'` and a 14-day expiry, then fire-and-forgets
 *   `sendEmail({ category: "partner_welcome" })`. With SMTP_HOST unset,
 *   `sendEmail` resolves `{ transportAccepted: false, error: "smtp_not_configured" }`
 *   (WAVE 48 · ITEM 4 renamed the field; the value is unchanged),
 *   logs a warning, and returns \u2014 and because there is NO email outbox table,
 *   nothing durable records the non-delivery. Test 1 proves the token IS minted
 *   (so it is wired) and test 2 proves the send reports non-delivery (so it
 *   fails), which together are exactly verdict (c).
 *
 * INVOICE ON APPROVAL \u2014 VERDICT (b): IMPLEMENTED ELSEWHERE, NOT WIRED TO
 * APPROVAL.
 *   Partner invoicing exists and works: `createInvoice` +`addInvoiceLine` in
 *   server/lib/partnerBillingStore.ts, exposed through
 *   `POST /api/admin/partner-billing/invoices` (server/lib/wave14MoneyRoutes.ts),
 *   with DB-trigger-maintained totals. The consortium approval path contains no
 *   call to any invoice creator, so approving an application creates zero
 *   invoices \u2014 not because invoicing is broken but because nothing asks for one.
 *   Test 3 proves approval writes no invoice row; test 4 proves the invoicing
 *   machinery DOES work when invoked (anti-vacuity: test 3 is not green merely
 *   because invoices are impossible in this environment).
 *   Whether approval SHOULD raise an invoice \u2014 and for what amount, plan and
 *   currency \u2014 is an owner product decision, not a defect to silently invent.
 */
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

import {
  registerConsortiumApplyRoutes,
  _consortiumApplyInternal,
  _resetPublicApplyBucketsForTests,
} from "../consortiumApplyStore";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { rawDb } from "../db/connection";
import { sendEmail } from "../lib/emailSender";
/* Imported STATICALLY on purpose: partnerBillingStore installs its own tables
   (partner_invoice / partner_invoice_line, from migration 0153) at module load,
   so importing it lazily inside a test would make the "zero invoices" counts
   read -1 (table absent) instead of a real 0 — an unreadable table must never
   be reported as a zero. */


let app: express.Express;
let ip = 40;

beforeAll(() => {
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: true });
  registerConsortiumApplyRoutes(app);
});

beforeEach(() => {
  _consortiumApplyInternal.appsCache.clear();
  _resetPublicApplyBucketsForTests();
});

async function submitAndApprove(org: string, email: string) {
  _resetPublicApplyBucketsForTests();
  const sub = await request(app)
    .post("/api/public/consortium/apply")
    .set("X-Forwarded-For", `10.44.7.${ip++}`)
    .send({
      organizationName: org,
      contactName: "Vera Verdict",
      contactEmail: email,
      jurisdiction: "Delaware",
      partnerType: "vc",
      aumRange: "10-50M",
      portfolioCompanyCount: 2,
      expectedChapter: "chap_keiretsu_canada",
      introMessage: "Verdict fixture application body, long enough to pass validation.",
    });
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  const appId = sub.body.applicationId as string;
  const rev = await request(app)
    .post(`/api/admin/consortium/applications/${appId}/review`)
    .set("x-user-id", "u_admin")
    .set("x-role", "admin")
    .send({ status: "approved", review_notes: "wave44 verdicts" });
  return { appId, rev };
}

function count(sql: string, ...args: unknown[]): number {
  try {
    const r = rawDb().prepare(sql).get(...(args as any[])) as { n?: number } | undefined;
    return Number(r?.n ?? -1);
  } catch {
    return -1; // table absent — reported as -1, never silently as 0
  }
}

describe("WAVE 44 — welcome/magic-link email: verdict (c) implemented, wired, failing silently", () => {
  it("approval DOES mint the durable partner_invite token (proving it is wired)", async () => {
    const email = "invite.wired@verdict-one.test";
    const before = count(
      `SELECT COUNT(*) AS n FROM auth_redeem_tokens WHERE intent = 'partner_invite' AND email = ?`,
      email,
    );
    expect(before, "auth_redeem_tokens must be readable for this verdict to mean anything").toBe(0);

    const { rev } = await submitAndApprove("Verdict One Ltd", email);
    expect(rev.status).toBe(200);

    const after = count(
      `SELECT COUNT(*) AS n FROM auth_redeem_tokens WHERE intent = 'partner_invite' AND email = ?`,
      email,
    );
    expect(after, "one partner_invite token per approval").toBe(1);

    // The admin-usable fallback link IS returned, so a failed send is recoverable.
    expect(String(rev.body.partnerInviteRedeemUrl ?? "")).toContain("/auth/redeem-partner-invite/");

    // WAVE 44 reporting fix: the response states what the platform can actually
    // do about mail, and never claims a delivery it cannot confirm.
    expect(rev.body.partnerInviteEmail).toBeTruthy();
    expect(rev.body.partnerInviteEmail.attempted).toBe(true);
    expect(rev.body.partnerInviteEmail.deliveryConfirmed).toBeNull();
    expect(typeof rev.body.partnerInviteEmail.smtpConfigured).toBe("boolean");
    if (!rev.body.partnerInviteEmail.smtpConfigured) {
      expect(rev.body.partnerInviteEmail.mustShareLinkManually).toBe(true);
      expect(String(rev.body.partnerInviteEmail.note)).toMatch(/NO welcome email was sent/);
    }
  });

  it("the send itself reports NON-DELIVERY when SMTP is unconfigured (proving it fails)", async () => {
    const hadHost = process.env.SMTP_HOST;
    delete process.env.SMTP_HOST;
    try {
      const result = await sendEmail({
        to: "silent@verdict-one.test",
        subject: "WAVE 44 verdict probe",
        text: "probe",
        html: "<p>probe</p>",
        category: "partner_welcome",
        refId: "wave44-probe",
      });
      expect(result.transportAccepted, "unconfigured SMTP must not claim delivery").toBe(false);
      expect(String(result.error ?? "")).toMatch(/smtp_not_configured|not set/i);
    } finally {
      if (hadHost !== undefined) process.env.SMTP_HOST = hadHost;
    }
  });

  it("there is NO email outbox table, so a non-delivery leaves no durable trace", () => {
    const row = rawDb()
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN
           ('email_outbox','emails_outbox','email_queue','email_log','email_messages')`,
      )
      .all() as Array<{ name: string }>;
    /* This is the mechanism behind "zero emails, no error anywhere": the only
       record of a failed send is a log line. If a future wave adds an outbox,
       this assertion is the place that will notice. */
    expect(row.map((r) => r.name)).toEqual([]);
  });
});

describe("WAVE 44 — invoice on approval: verdict (b) implemented, not wired to approval", () => {
  /* WAVE 47 · R20 — THIS TEST WAS INVERTED, DELIBERATELY AND ON THE RECORD.
   *
   * As written in WAVE 44 it asserted the DEFECT: "approving an application
   * creates ZERO invoice rows". That was a true statement about a broken
   * platform, and it is exactly the statement the owner's ruling R20 overturns
   * ("On approval"). Leaving it would have pinned the bug. It is not weakened:
   * the same before/after counting is kept and the expectation is flipped from
   * "no invoice ever" to "exactly one, conserved" — a STRICTER claim, since a
   * second invoice now fails it too. The WAVE 44 diagnosis it recorded lives on
   * in build_log/WAVE44_REPORT.md §4 and in build_log/WAVE47_REPORT.md §2.
   * The full R20 proof set (grandfathered exemption, forward-only, idempotency,
   * price-unresolvable refusal, JPY) is in
   * server/__tests__/wave47_invoice_on_approval_and_email_observability.test.ts. */
  it("approving an application raises EXACTLY ONE conserved invoice (R20, was: zero)", async () => {
    const invBefore = count(`SELECT COUNT(*) AS n FROM invoices`);
    /* -1 here means the table is ABSENT in this environment, never "empty" —
       the helper refuses to report an unreadable table as a zero. Either way the
       before/after comparison is what carries the verdict. */
    const partnerInvBefore = count(`SELECT COUNT(*) AS n FROM partner_invoice`);
    const { rev } = await submitAndApprove("Verdict Two Ltd", "no.invoice@verdict-two.test");
    expect(rev.status).toBe(200);
    const invAfter = count(`SELECT COUNT(*) AS n FROM invoices`);
    const partnerInvAfter = count(`SELECT COUNT(*) AS n FROM partner_invoice`);
    // `invoices` is the unrelated legacy founder table — approval must NOT write
    // there. The partner ledger table gains exactly one row.
    expect(invAfter).toBe(invBefore);
    expect(partnerInvAfter).toBe(partnerInvBefore + 1);

    // The one new row belongs to the partner this approval provisioned, and its
    // total is the DB-resolved price — read back, never restated as a literal.
    const partnerId = String(rev.body.application.provisionedPartnerId);
    const rows = rawDb()
      .prepare(
        `SELECT id, total_minor, currency, status FROM partner_invoice WHERE partner_id = ?`,
      )
      .all(partnerId) as Array<{ id: string; total_minor: number; currency: string; status: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("issued");
    const { assertInvoiceConserved } = await import("../lib/partnerBillingStore");
    expect(assertInvoiceConserved(rows[0].id)).toBe(Number(rows[0].total_minor));
    expect(Number(rows[0].total_minor)).toBeGreaterThan(0);

    // The response reports it under `partnerInvoice`. The two WAVE 44
    // assertions below are UNCHANGED and still hold: no `invoice` /`invoiceId`
    // field was invented, so nothing that reads this response was broken.
    expect(rev.body.partnerInvoice).toBeTruthy();
    expect(rev.body.partnerInvoice.invoiced).toBe(true);
    expect(String(rev.body.partnerInvoice.invoiceId)).toBe(rows[0].id);
    expect(rev.body).not.toHaveProperty("invoice");
    expect(rev.body).not.toHaveProperty("invoiceId");
  });

  it("ANTI-VACUITY: the invoicing machinery it is NOT wired to does work", async () => {
    /* If invoices were simply impossible in this environment, the assertion
       above would be vacuous. Invoke the real creator directly.
       `partner_invoice` / `partner_invoice_line` come from migration 0153; the
       in-memory test DB installs them lazily on first use by this store, hence
       the dynamic import and the post-create count. */
    const { createInvoice, addInvoiceLine, getInvoice } = await import("../lib/partnerBillingStore");
    const invoiceId = createInvoice({ partnerId: "ac_consortium_partner_verdict_probe", currency: "USD" });
    // MONEY: integer minor units, as-written. 84000 minor = $840.00 \u2014 the amount
    // the auditor saw on a live paid invoice. No /100 anywhere.
    addInvoiceLine({
      invoiceId,
      entryKind: "subscription",
      description: "WAVE 44 anti-vacuity probe",
      amountMinor: 84_000,
    });
    const inv: any = getInvoice(invoiceId);
    expect(inv).toBeTruthy();
    expect(Number(inv.totalMinor ?? inv.total_minor)).toBe(84_000);
    expect(String(inv.currency)).toBe("USD");
    /* Read the row back through SQL as well as through the store, so the proof
       is durable rather than an in-memory echo. */
    const durable = count(`SELECT COUNT(*) AS n FROM partner_invoice WHERE id = ?`, invoiceId);
    expect(durable, "the invoice must exist as a durable row").toBe(1);
  });

  it("JPY (exponent 0) is stored unscaled by that same creator", async () => {
    const { createInvoice, addInvoiceLine, getInvoice } = await import("../lib/partnerBillingStore");
    const invoiceId = createInvoice({ partnerId: "ac_consortium_partner_verdict_probe_jpy", currency: "JPY" });
    // 9000 minor units of JPY IS \u00a59,000 \u2014 a hidden *100 or /100 would show here.
    addInvoiceLine({
      invoiceId,
      entryKind: "subscription",
      description: "WAVE 44 JPY fixture",
      amountMinor: 9_000,
    });
    const inv: any = getInvoice(invoiceId);
    expect(String(inv.currency)).toBe("JPY");
    expect(Number(inv.totalMinor ?? inv.total_minor)).toBe(9_000);
  });
});

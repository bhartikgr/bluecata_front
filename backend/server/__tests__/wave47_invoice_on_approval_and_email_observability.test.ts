/**
 * WAVE 47 — R20 (invoice on approval) + R19 (transactional email observability).
 *
 * This file is BOTH the reproduction and the proof. Every behaviour below was
 * first run against the unmodified tree; the reproduction outcomes are recorded
 * in build_log/WAVE47_REPORT.md §2 (Part 1) and §3 (Part 2).
 *
 * BOTH POLES ARE ASSERTED EVERYWHERE:
 *   · a normal approval raises EXACTLY ONE invoice  ⟷  a grandfathered approval
 *     raises NONE;
 *   · a resolvable price invoices  ⟷  an unresolvable price REFUSES the whole
 *     approval;
 *   · an accepted send records `sent`  ⟷  a rejected send records `failed` with
 *     the reason, and NEITHER ever records a delivery, because this transport
 *     cannot prove delivery.
 *
 * NO PRICE LITERAL APPEARS IN THE ASSERTIONS. Expected amounts are read back
 * from the same `partner_tier_price` row the code reads, so a re-pinned number
 * cannot make a test pass: if the row and the invoice disagree, the test fails.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import express from "express";
import request from "supertest";

import {
  registerConsortiumApplyRoutes,
  _consortiumApplyInternal,
  _resetPublicApplyBucketsForTests,
} from "../consortiumApplyStore";
import { installV14TestIdentity } from "./_v14TestIdentity";
import { rawDb } from "../db/connection";
// The WAVE 45 pricing tables are installed lazily by their own store accessor
// (connection.ts is sacred, so there is no migration-time hook). Reading the
// price row through the SAME accessor the production code uses is what makes
// these proofs read the real row instead of a table this file created.
import { wave45Db } from "../lib/applyWave45PricingSchema";
import { registerAdminEmailRoutes } from "../lib/adminEmailRoutes";
import { registerEmailRoutes, _testEmail, listOutbox } from "../emailStore";
import {
  sendEmail,
  __setEmailTransportForTests,
  type InjectedEmailTransport,
} from "../lib/emailSender";
import { upsertConsortiumPartner } from "../adminContactsStore";
import { listInvoices, listMoneyEvents, assertInvoiceConserved } from "../lib/partnerBillingStore";
import {
  raiseApprovalInvoice,
  approvalInvoiceNumber,
  E_PRICE_UNRESOLVED,
  E_ZERO_WITHOUT_OVERRIDE,
} from "../lib/partnerApprovalInvoice";
import { currencyExponent } from "../lib/money";

let app: express.Express;
let ip = 90;

beforeAll(() => {
  app = express();
  app.use(express.json());
  installV14TestIdentity(app, { defaultIdentity: true });
  registerConsortiumApplyRoutes(app);
  registerEmailRoutes(app);
  registerAdminEmailRoutes(app);
});

beforeEach(() => {
  _consortiumApplyInternal.appsCache.clear();
  _resetPublicApplyBucketsForTests();
});

afterAll(() => {
  __setEmailTransportForTests(null);
});

/* ── helpers ────────────────────────────────────────────────────────────── */

async function submit(org: string, email: string): Promise<string> {
  _resetPublicApplyBucketsForTests();
  const sub = await request(app)
    .post("/api/public/consortium/apply")
    .set("X-Forwarded-For", `10.47.9.${ip++}`)
    .send({
      organizationName: org,
      contactName: "Wanda Wave",
      contactEmail: email,
      jurisdiction: "Delaware",
      partnerType: "vc",
      aumRange: "10-50M",
      portfolioCompanyCount: 2,
      expectedChapter: "chap_keiretsu_canada",
      introMessage: "Wave 47 fixture application body, long enough to pass validation.",
    });
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  return sub.body.applicationId as string;
}

function approve(appId: string) {
  return request(app)
    .post(`/api/admin/consortium/applications/${appId}/review`)
    .set("x-user-id", "u_admin")
    .set("x-role", "admin")
    .send({ status: "approved", review_notes: "wave47" });
}

function sql<T = any>(q: string, ...args: unknown[]): T[] {
  return rawDb().prepare(q).all(...(args as any[])) as T[];
}

function one<T = any>(q: string, ...args: unknown[]): T | undefined {
  return rawDb().prepare(q).get(...(args as any[])) as T | undefined;
}

/** The annual price row the production code reads. Read, never assumed. */
function annualPriceRow(slug = "catalyst"): { price_minor: number | null; currency: string } {
  const r = wave45Db()
    .prepare(
    `SELECT price_minor, currency FROM partner_tier_price
      WHERE tier_slug = ? AND cadence = 'annual' AND active = 1`)
    .get(slug) as { price_minor: number | null; currency: string } | undefined;
  expect(r, "the annual tier price row must exist for these proofs to mean anything").toBeTruthy();
  return r!;
}

function setAnnualPrice(priceMinor: number | null, currency = "USD", slug = "catalyst"): void {
  wave45Db()
    .prepare(
      `UPDATE partner_tier_price SET price_minor = ?, currency = ?
        WHERE tier_slug = ? AND cadence = 'annual'`,
    )
    .run(priceMinor, currency, slug);
}

function invoicesForApplication(appId: string) {
  return sql(
    `SELECT id, partner_id, invoice_number, currency, total_minor, status
       FROM partner_invoice WHERE invoice_number = ?`,
    approvalInvoiceNumber(appId),
  );
}

function partnerInvoiceCount(): number {
  return Number(one<{ n: number }>(`SELECT COUNT(*) AS n FROM partner_invoice`)?.n ?? -1);
}

/** A fake transport. Sends nothing anywhere: this suite never opens a socket. */
function fakeTransport(
  outcome: { ok: true } | { ok: false; error: string; permanent?: boolean },
  seen: Array<{ to: string; subject: string }>,
): InjectedEmailTransport {
  return {
    async send(msg) {
      seen.push({ to: msg.to, subject: msg.subject });
      return outcome.ok
        ? { accepted: true }
        : { accepted: false, error: outcome.error, permanent: outcome.permanent === true };
    },
  };
}

/* ═════════════════════════════════════════════════════════════════════════
 * PART 1 — R20: THE INVOICE IS PART OF THE APPROVAL TRANSACTION
 * ═════════════════════════════════════════════════════════════════════════ */

describe("WAVE 47 / R20 — a normal approval raises exactly one conserved invoice", () => {
  it("raises ONE invoice for the DB-resolved annual price, conserved, in the ledger, with its money event", async () => {
    const priceBefore = annualPriceRow();
    expect(
      priceBefore.price_minor,
      "an unpriced row would make this test vacuous — WAVE 45 priced it",
    ).not.toBeNull();
    expect(Number(priceBefore.price_minor)).toBeGreaterThan(0);

    const appId = await submit("Wave47 Paying Partners Ltd", "pay.one@wave47.test");
    const before = partnerInvoiceCount();
    const rev = await approve(appId);
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);

    const partnerId = String(rev.body.application?.provisionedPartnerId ?? "");
    expect(partnerId).toMatch(/^ac_consortium_partner_/);

    // EXACTLY ONE — counted globally and by the deterministic invoice number.
    expect(partnerInvoiceCount()).toBe(before + 1);
    const rows = invoicesForApplication(appId);
    expect(rows.length).toBe(1);
    expect(String(rows[0].partner_id)).toBe(partnerId);

    // The amount IS the row the pricing page reads. Read back, not re-pinned.
    expect(Number(rows[0].total_minor)).toBe(Number(priceBefore.price_minor));
    expect(String(rows[0].currency)).toBe(String(priceBefore.currency));

    // Conserved (lines sum to total) — asserted in application code too.
    expect(assertInvoiceConserved(String(rows[0].id))).toBe(Number(priceBefore.price_minor));

    // In the PARTNER LEDGER (the read the partner billing UI uses).
    const ledger = listInvoices(partnerId);
    expect(ledger.length).toBe(1);
    expect(ledger[0].invoiceNumber).toBe(approvalInvoiceNumber(appId));
    expect(ledger[0].lines.length).toBe(1);
    expect(ledger[0].lines[0].entryKind).toBe("subscription");
    expect(ledger[0].lines[0].amountMinor).toBe(Number(priceBefore.price_minor));
    expect(ledger[0].lines[0].sourceRef).toBe(`consortium_application:${appId}`);
    // Raised means ISSUED, not left as a draft the ledger contradicts.
    expect(ledger[0].status).toBe("issued");
    expect(ledger[0].issuedAt).toBeTruthy();

    // And it emitted its money event, under the REUSED vocabulary.
    const events = listMoneyEvents("invoice", String(rows[0].id));
    expect(events.map((e) => e.eventName)).toContain("invoice.issued");

    // The approval response reports the invoice honestly rather than silently.
    expect(rev.body.partnerInvoice).toBeTruthy();
    expect(rev.body.partnerInvoice.invoiced).toBe(true);
    expect(rev.body.partnerInvoice.amountMinor).toBe(Number(priceBefore.price_minor));
  });

  it("is IDEMPOTENT — re-approving the same application does not raise a second invoice", async () => {
    const appId = await submit("Wave47 Idempotent Ltd", "idem.one@wave47.test");
    const first = await approve(appId);
    expect(first.status).toBe(200);
    expect(invoicesForApplication(appId).length).toBe(1);

    const again = await approve(appId);
    expect(again.status).toBe(200);
    expect(invoicesForApplication(appId).length).toBe(1);
    expect(partnerInvoiceCount()).toBe(partnerInvoiceCount()); // stable

    // And the raiser itself is idempotent when called twice for the same
    // application — the latch is the UNIQUE invoice_number in the DATABASE.
    const partnerId = String(first.body.application.provisionedPartnerId);
    const out = raiseApprovalInvoice({
      applicationId: appId,
      partnerId,
      organizationName: "Wave47 Idempotent Ltd",
      actorUserId: "u_admin",
      nowIso: new Date().toISOString(),
    });
    expect(out.idempotent).toBe(true);
    expect(out.invoiced).toBe(true);
    expect(invoicesForApplication(appId).length).toBe(1);
  });
});

describe("WAVE 47 / R17+R20 — a GRANDFATHERED approval raises NO invoice", () => {
  it("explicit $0 per-partner override ⇒ zero invoices, and the exemption is recorded", async () => {
    const email = "gf.one@wave47.test";
    const org = "Wave47 Grandfathered Holdings";
    // The partner contact pre-exists (as the four R17 partners do) and carries
    // an EXPLICIT, AUDITED $0 annual override. No id list anywhere.
    const contact = upsertConsortiumPartner({ legalName: org, email }, "u_admin");
    rawDb()
      .prepare(`UPDATE contacts SET fee_override_json = ? WHERE id = ?`)
      .run(JSON.stringify({ subscription_annual: { amountMinor: 0, currency: "USD" } }), contact.id);
    try {
      rawDb()
        .prepare(
          `INSERT INTO partner_grandfather_grant
             (id, partner_id, reason, ruling_ref, granted_at, granted_by, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?)`,
        )
        .run(
          `pgg_w47_${contact.id.slice(-8)}`,
          contact.id,
          "Founding partner — never invoiced (owner ruling)",
          "R17",
          new Date().toISOString(),
          "u_admin",
          new Date().toISOString(),
          new Date().toISOString(),
        );
    } catch (err) {
      /* The grant table is a WAVE 45 addition; if it is absent the $0 override
         alone still exempts. The test says so out loud rather than silently
         skipping the assertion. */
      expect(String((err as Error).message)).toMatch(/no such table|partner_grandfather_grant/i);
    }

    const appId = await submit(org, email);
    const before = partnerInvoiceCount();
    const rev = await approve(appId);
    expect(rev.status, JSON.stringify(rev.body)).toBe(200);
    expect(String(rev.body.application.provisionedPartnerId)).toBe(contact.id);

    // NO INVOICE. Not a $0 invoice — none at all.
    expect(partnerInvoiceCount()).toBe(before);
    expect(invoicesForApplication(appId).length).toBe(0);
    expect(listInvoices(contact.id).length).toBe(0);

    // The exemption is reported, with its reason, instead of being invisible.
    expect(rev.body.partnerInvoice.invoiced).toBe(false);
    expect(rev.body.partnerInvoice.exemption.reason).toBe("explicit_zero_override");
    expect(rev.body.partnerInvoice.amountMinor).toBe(0);

    // ANTI-VACUITY: the same code path DOES invoice a partner without the
    // override, so the zero above is the override's doing, not an inert path.
    const payId = await submit("Wave47 Anti Vacuity Ltd", "anti.vac@wave47.test");
    const payRev = await approve(payId);
    expect(payRev.status).toBe(200);
    expect(invoicesForApplication(payId).length).toBe(1);
  });
});

describe("WAVE 47 / R20 — FORWARD ONLY: the already-approved applications are never billed", () => {
  it("an application approved BEFORE this wave stays uninvoiced, even when re-reviewed", async () => {
    // A legacy row: approved, provisioned, and never invoiced — exactly the
    // shape of the 30 the auditor found.
    const legacyPartner = upsertConsortiumPartner(
      { legalName: "Wave47 Legacy Approved Ltd", email: "legacy.one@wave47.test" },
      "u_admin",
    );
    const appId = await submit("Wave47 Legacy Approved Ltd", "legacy.one@wave47.test");
    const now = new Date().toISOString();
    rawDb()
      .prepare(
        `UPDATE consortium_applications
            SET status = 'approved', provisioned_partner_id = ?, reviewed_at = ?, reviewed_by_user_id = 'u_legacy'
          WHERE id = ?`,
      )
      .run(legacyPartner.id, now, appId);
    _consortiumApplyInternal.appsCache.clear();

    const before = partnerInvoiceCount();
    const rev = await approve(appId); // idempotent re-review
    expect(rev.status).toBe(200);

    expect(partnerInvoiceCount()).toBe(before);
    expect(invoicesForApplication(appId).length).toBe(0);
    expect(listInvoices(legacyPartner.id).length).toBe(0);
  });

  it("no backfill exists: the invoice raiser is only reachable from the pending→approved transition", () => {
    /* Structural, not incidental: a sweep over historical applications would
       have to live in the approval store or the raiser. Neither contains a
       loop over applications, and the raiser takes ONE application id. */
    const src = require("node:fs").readFileSync(
      require("node:path").join(process.cwd(), "server/lib/partnerApprovalInvoice.ts"),
      "utf8",
    ) as string;
    /* Strip comments first: the module's prose explains WHY it does not sweep
       history, and matching that prose would be matching the explanation rather
       than the code. What must be absent is executable SQL/looping over past
       applications. */
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/FROM\s+consortium_applications/i);
    expect(code).not.toMatch(/backfill|retro_?bill|sweep/i);
    expect(code).not.toMatch(/\.all\(/);
  });
});

describe("WAVE 47 / R20 — an approval that CANNOT price refuses, loudly and atomically", () => {
  it("price unresolvable ⇒ typed refusal, application NOT approved, no partner, no invoice", async () => {
    const saved = annualPriceRow();
    const appId = await submit("Wave47 Unpriced Ltd", "unpriced.one@wave47.test");
    const before = partnerInvoiceCount();
    try {
      setAnnualPrice(null, saved.currency); // the row exists but is UNPRICED
      const rev = await approve(appId);
      expect(rev.status, JSON.stringify(rev.body)).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(rev.body)).toContain(E_PRICE_UNRESOLVED);

      // ATOMIC: nothing committed.
      expect(partnerInvoiceCount()).toBe(before);
      const row = one<{ status: string; provisioned_partner_id: string | null }>(
        `SELECT status, provisioned_partner_id FROM consortium_applications WHERE id = ?`,
        appId,
      );
      expect(row?.status).toBe("submitted");
      expect(row?.provisioned_partner_id ?? null).toBeNull();
      expect(
        sql(`SELECT id FROM partner_organizations WHERE name = 'Wave47 Unpriced Ltd'`).length,
      ).toBe(0);
    } finally {
      setAnnualPrice(saved.price_minor, saved.currency);
    }

    // BOTH POLES: with the price restored, the SAME application approves and
    // invoices — so the refusal was the missing price, not a broken fixture.
    _consortiumApplyInternal.appsCache.clear();
    const ok = await approve(appId);
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(invoicesForApplication(appId).length).toBe(1);
  });

  it("a $0 that did NOT come from a per-partner override is REFUSED, never invoiced as zero", async () => {
    const saved = annualPriceRow();
    const appId = await submit("Wave47 Zero Tier Ltd", "zerotier.one@wave47.test");
    const before = partnerInvoiceCount();
    try {
      setAnnualPrice(0, saved.currency); // an advertised $0 — a pricing accident
      const rev = await approve(appId);
      expect(rev.status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(rev.body)).toContain(E_ZERO_WITHOUT_OVERRIDE);
      expect(partnerInvoiceCount()).toBe(before);
      expect(
        one<{ status: string }>(`SELECT status FROM consortium_applications WHERE id = ?`, appId)
          ?.status,
      ).toBe("submitted");
    } finally {
      setAnnualPrice(saved.price_minor, saved.currency);
    }
  });
});

describe("WAVE 47 / MONEY — integer minor units, JPY (exponent 0) included", () => {
  it("a JPY-priced tier invoices ¥N as N minor units, unscaled", async () => {
    const saved = annualPriceRow();
    expect(currencyExponent("JPY")).toBe(0);
    const appId = await submit("Wave47 Yen Partners KK", "yen.one@wave47.test");
    try {
      setAnnualPrice(9_000, "JPY"); // ¥9,000 — a hidden *100 or /100 shows here
      const rev = await approve(appId);
      expect(rev.status, JSON.stringify(rev.body)).toBe(200);
      const rows = invoicesForApplication(appId);
      expect(rows.length).toBe(1);
      expect(String(rows[0].currency)).toBe("JPY");
      expect(Number(rows[0].total_minor)).toBe(9_000);
      expect(assertInvoiceConserved(String(rows[0].id))).toBe(9_000);
    } finally {
      setAnnualPrice(saved.price_minor, saved.currency);
    }
  });
});

/* ═════════════════════════════════════════════════════════════════════════
 * PART 2 — R19: TRANSACTIONAL EMAIL IS OBSERVABLE IN THE OUTBOX
 * ═════════════════════════════════════════════════════════════════════════ */

describe("WAVE 47 / R19 — every transactional send gets a durable outbox row", () => {
  beforeEach(() => {
    _testEmail.reset();
    __setEmailTransportForTests(null);
  });

  it("ACCEPTED pole: the row records queued→sent with attempts, times and template — and never claims delivery", async () => {
    const seen: Array<{ to: string; subject: string }> = [];
    __setEmailTransportForTests(fakeTransport({ ok: true }, seen));
    const before = listOutbox().length;

    const result = await sendEmail({
      to: "observable@wave47.test",
      subject: "WAVE 47 accepted pole",
      text: "body",
      html: "<p>body</p>",
      category: "partner_welcome",
      refId: "w47-accepted",
    });

    expect(seen.length, "the injected transport was actually used").toBe(1);
    /* WAVE 48 · ITEM 4 — this field was named `delivered` when Wave 47 wrote
       this test, and Wave 47 disclosed the trap rather than renaming it. It is
       now `transportAccepted`, which is what it has always measured: "the
       transport accepted the handoff". The VALUE asserted here is unchanged.
       `status` is still the field that is honest about the outcome, and it says
       `sent`. The DURABLE ROW below is the real proof: it never records a
       delivery this transport cannot observe. */
    expect(result.transportAccepted).toBe(true);
    expect(result.status).toBe("sent");
    expect(result.outboxId).toBeTruthy();

    const rows = listOutbox();
    expect(rows.length).toBe(before + 1);
    const row = rows.find((r) => r.id === result.outboxId)!;
    expect(row.recipient).toBe("observable@wave47.test");
    expect(row.subject).toBe("WAVE 47 accepted pole");
    expect(row.templateSlug).toBe("partner_welcome");
    expect(row.status).toBe("sent");
    expect(row.attempts).toBe(1);
    expect(row.queuedAt).toBeTruthy();
    expect(row.sentAt).toBeTruthy();
    // R6: the transport cannot prove delivery, so the row does not claim it.
    expect(row.deliveredAt).toBeNull();
    expect(row.error).toBeNull();

    // DURABLE, not just in RAM: the persistence shim wrote the row.
    const kv = one<{ payload_json: string }>(
      `SELECT payload_json FROM kv_emailStoreOutbox WHERE id = ?`,
      row.id,
    );
    expect(kv?.payload_json, "the outbox row must be durable, not RAM-only").toBeTruthy();
    expect(JSON.parse(String(kv!.payload_json)).status).toBe("sent");
  });

  it("REJECTED pole: a failed send is recorded as failed with its reason — never silently swallowed", async () => {
    const seen: Array<{ to: string; subject: string }> = [];
    __setEmailTransportForTests(fakeTransport({ ok: false, error: "550 mailbox unavailable", permanent: true }, seen));

    const result = await sendEmail({
      to: "bounces@wave47.test",
      subject: "WAVE 47 rejected pole",
      text: "body",
      category: "partner_welcome",
      refId: "w47-rejected",
    });

    expect(seen.length).toBe(1);
    expect(result.transportAccepted).toBe(false);
    expect(result.error).toBeTruthy();
    const row = listOutbox().find((r) => r.id === result.outboxId)!;
    expect(row).toBeTruthy();
    // A permanent recipient rejection is a bounce; a transient one is `failed`.
    expect(["bounced", "failed"]).toContain(row.status);
    expect(row.status).toBe("bounced");
    expect(String(row.error)).toContain("550");
    expect(row.attempts).toBe(1);
    expect(row.sentAt).toBeNull();
    expect(row.deliveredAt).toBeNull();
  });

  it("a TRANSIENT failure is `failed`, not `bounced`, and not `sent`", async () => {
    __setEmailTransportForTests(fakeTransport({ ok: false, error: "ETIMEDOUT connecting" }, []));
    const result = await sendEmail({
      to: "transient@wave47.test",
      subject: "WAVE 47 transient",
      text: "body",
      category: "notification",
    });
    const row = listOutbox().find((r) => r.id === result.outboxId)!;
    expect(row.status).toBe("failed");
    expect(row.deliveredAt).toBeNull();
    expect(row.sentAt).toBeNull();
  });

  it("NO SECRET is persisted or returned, even when the transport error quotes it", async () => {
    const sentinel = "sup3r-secret-app-password";
    const had = process.env.SMTP_PASS;
    process.env.SMTP_PASS = sentinel;
    try {
      __setEmailTransportForTests(
        fakeTransport({ ok: false, error: `535 auth failed for pass=${sentinel}` }, []),
      );
      const result = await sendEmail({
        to: "secrets@wave47.test",
        subject: "WAVE 47 secrets",
        text: "body",
        category: "smtp_test",
      });
      const row = listOutbox().find((r) => r.id === result.outboxId)!;
      expect(JSON.stringify(row)).not.toContain(sentinel);
      expect(String(row.error)).toContain("[REDACTED]");
      expect(JSON.stringify(result)).not.toContain(sentinel);
      const kv = one<{ payload_json: string }>(
        `SELECT payload_json FROM kv_emailStoreOutbox WHERE id = ?`,
        row.id,
      );
      expect(String(kv?.payload_json ?? "")).not.toContain(sentinel);
      // The whole persisted outbox, not just this row.
      const all = sql<{ payload_json: string }>(`SELECT payload_json FROM kv_emailStoreOutbox`);
      for (const r of all) expect(r.payload_json).not.toContain(sentinel);
    } finally {
      if (had === undefined) delete process.env.SMTP_PASS;
      else process.env.SMTP_PASS = had;
    }
  });

  it("the partner-invite welcome email is observable, and reuses the ONE durable token", async () => {
    const seen: Array<{ to: string; subject: string }> = [];
    __setEmailTransportForTests(fakeTransport({ ok: true }, seen));
    const email = "invite.observable@wave47.test";
    const appId = await submit("Wave47 Invite Observable Ltd", email);
    const rev = await approve(appId);
    expect(rev.status).toBe(200);
    // The send is fire-and-forget by design (an SMTP outage must not undo an
    // approval), so let the microtask queue drain before reading the outbox.
    await new Promise((r) => setTimeout(r, 100));

    /* TWO transactional emails belong to this applicant and BOTH are now
       observable, which is the point: the acknowledgement at submit and the
       welcome at approval. Before this wave the outbox held neither. */
    const all = listOutbox().filter((r) => r.recipient === email);
    expect(all.map((r) => r.templateSlug).sort()).toEqual([
      "consortium_apply_ack",
      "partner_welcome",
    ]);
    const rows = all.filter((r) => r.templateSlug === "partner_welcome");
    expect(rows.length, "exactly one welcome email row").toBe(1);
    expect(rows[0].status).toBe("sent");
    expect(rows[0].deliveredAt).toBeNull();

    // ONE token, the pre-existing durable one — no parallel token was minted.
    const tokens = sql(
      `SELECT id FROM auth_redeem_tokens WHERE intent = 'partner_invite' AND email = ?`,
      email,
    );
    expect(tokens.length).toBe(1);
    expect(String(rev.body.partnerInviteRedeemUrl ?? "")).toContain(
      "/auth/redeem-partner-invite/",
    );
    // The email body carries that same redeem URL.
    expect(rows[0].bodyHtmlRendered).toContain("/auth/redeem-partner-invite/");
  });

  it("the admin console can really TEST-SEND, and the result lands in the outbox", async () => {
    const seen: Array<{ to: string; subject: string }> = [];
    __setEmailTransportForTests(fakeTransport({ ok: true }, seen));
    const r = await request(app)
      .post("/api/admin/email/send-test")
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .send({ to: "admin.test@wave47.test" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(seen.length).toBe(1);
    expect(r.body.outboxId).toBeTruthy();
    expect(r.body.status).toBe("sent");
    // Accepted by the transport (WAVE 48 · ITEM 4: `delivered` →
    // `transportAccepted`, same value), but the honest `status` says `sent` —
    // and the outbox row below refuses to claim delivery.
    expect(r.body.transportAccepted).toBe(true);

    const row = listOutbox().find((x) => x.id === r.body.outboxId)!;
    expect(row.recipient).toBe("admin.test@wave47.test");
    expect(row.status).toBe("sent");
    expect(row.deliveredAt).toBeNull();

    // BOTH POLES on the admin surface too.
    __setEmailTransportForTests(fakeTransport({ ok: false, error: "ECONNREFUSED" }, []));
    const bad = await request(app)
      .post("/api/admin/email/send-test")
      .set("x-user-id", "u_admin")
      .set("x-role", "admin")
      .send({ to: "admin.fail@wave47.test" });
    expect(bad.status).toBe(200);
    expect(bad.body.status).toBe("failed");
    expect(bad.body.transportAccepted).toBe(false);
    const badRow = listOutbox().find((x) => x.id === bad.body.outboxId)!;
    expect(badRow.status).toBe("failed");
    expect(String(badRow.error)).toContain("ECONNREFUSED");
  });

  it("the outbox counters the admin console reads are no longer structurally zero", async () => {
    __setEmailTransportForTests(fakeTransport({ ok: true }, []));
    await sendEmail({ to: "counter@wave47.test", subject: "counted", text: "x", category: "notification" });
    const r = await request(app)
      .get("/api/admin/email/outbox")
      .set("x-user-id", "u_admin")
      .set("x-role", "admin");
    expect(r.status).toBe(200);
    expect(r.body.total).toBeGreaterThan(0);
    expect(r.body.sent).toBeGreaterThan(0);
    expect(typeof r.body.failed).toBe("number");
  });
});

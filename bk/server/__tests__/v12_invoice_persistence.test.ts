/**
 * Patch v12 Day 2 Wave 2 — invoiceStore persistence test.
 *
 * Verifies the audit §3.12 contract:
 *   - createInvoice writes through to `invoices` table
 *   - Status transitions persist (markInvoicePaid, voidInvoice, refundInvoice)
 *   - Invoice numbers are monotonic across simulated restart
 *   - Hydrator rebuilds caches + year counter from DB
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  createInvoice,
  markInvoicePaid,
  voidInvoice,
  refundInvoice,
  getInvoice,
  listInvoicesForCompany,
  hydrateInvoiceStore,
  _testInvoices,
} from "../invoiceStore";
import { getDb } from "../db/connection";
import { invoices as invoicesTable } from "../../shared/schema";
import { eq } from "drizzle-orm";

describe("v12 invoiceStore — DB persistence (audit §3.12)", () => {
  beforeEach(() => {
    _testInvoices.reset();
  });

  it("createInvoice persists to DB with all v12 columns", () => {
    const inv = createInvoice({
      companyId: "co_alpha",
      subscriptionId: "sub_1",
      planLabel: "Founder Plan",
      periodStart: "2026-01-01",
      periodEnd: "2026-01-31",
      amountMinor: 4900,
      currency: "USD",
    });

    const db = getDb();
    const rows = db.select().from(invoicesTable).where(eq(invoicesTable.id, inv.id)).all() as any[];
    expect(rows.length).toBe(1);
    const r = rows[0];
    expect(r.invoiceNumber).toBe(inv.invoiceNumber);
    expect(r.tenantId).toBe("tenant_co_co_alpha");
    expect(r.subscriptionId).toBe("sub_1");
    expect(r.totalMinor).toBe(4900);
    expect(r.status).toBe("issued");
    expect(r.revisionHash).toBe(inv.hash);
    expect(r.prevRevisionHash).toBe("GENESIS");
    expect(JSON.parse(r.lineItemsJson)).toEqual(inv.lineItems);
  });

  it("invoice numbers are monotonic and gap-free in a single year", () => {
    const a = createInvoice({ companyId: "co_a", subscriptionId: "s", planLabel: "P", periodStart: "2026-01-01", periodEnd: "2026-01-31", amountMinor: 100, currency: "USD" });
    const b = createInvoice({ companyId: "co_a", subscriptionId: "s", planLabel: "P", periodStart: "2026-02-01", periodEnd: "2026-02-28", amountMinor: 100, currency: "USD" });
    const c = createInvoice({ companyId: "co_b", subscriptionId: "s", planLabel: "P", periodStart: "2026-03-01", periodEnd: "2026-03-31", amountMinor: 100, currency: "USD" });
    const numbers = [a, b, c].map((i) => i.invoiceNumber);
    // All should share same year prefix and increment 000001..000003
    const year = new Date().getFullYear();
    expect(numbers).toEqual([
      `CAP-${year}-000001`,
      `CAP-${year}-000002`,
      `CAP-${year}-000003`,
    ]);
  });

  it("markInvoicePaid persists status transition", () => {
    const inv = createInvoice({ companyId: "co_a", subscriptionId: "s", planLabel: "P", periodStart: "2026-01-01", periodEnd: "2026-01-31", amountMinor: 100, currency: "USD" });
    const paid = markInvoicePaid(inv.id, "pe_1", "4242", "system");
    expect(paid.status).toBe("paid");

    const db = getDb();
    const rows = db.select().from(invoicesTable).where(eq(invoicesTable.id, inv.id)).all() as any[];
    expect(rows[0].status).toBe("paid");
    expect(rows[0].paidAt).toBeTruthy();
    expect(rows[0].cardLast4).toBe("4242");
    expect(rows[0].version).toBe(2);
    expect(rows[0].prevRevisionHash).toBe(inv.hash);
  });

  it("voidInvoice persists the void state", () => {
    const inv = createInvoice({ companyId: "co_a", subscriptionId: "s", planLabel: "P", periodStart: "2026-01-01", periodEnd: "2026-01-31", amountMinor: 100, currency: "USD" });
    voidInvoice(inv.id, "system");

    const db = getDb();
    const rows = db.select().from(invoicesTable).where(eq(invoicesTable.id, inv.id)).all() as any[];
    expect(rows[0].status).toBe("void");
    expect(rows[0].voidedAt).toBeTruthy();
  });

  it("refundInvoice persists original.refunded + new negative invoice", () => {
    const inv = createInvoice({ companyId: "co_a", subscriptionId: "s", planLabel: "P", periodStart: "2026-01-01", periodEnd: "2026-01-31", amountMinor: 5000, currency: "USD", paymentEntryId: "pe_1" });
    const refund = refundInvoice(inv.id, 5000, "customer_request", "admin");

    const db = getDb();
    const all = db.select().from(invoicesTable).all() as any[];
    expect(all.length).toBe(2);
    const original = all.find((r) => r.id === inv.id);
    const refundRow = all.find((r) => r.id === refund.id);
    expect(original.status).toBe("refunded");
    expect(original.refundedAt).toBeTruthy();
    expect(refundRow.totalMinor).toBe(-5000);
    expect(refundRow.relatedInvoiceId).toBe(inv.id);
  });

  it("hydrator rebuilds in-memory caches + year counter from DB", async () => {
    createInvoice({ companyId: "co_a", subscriptionId: "s", planLabel: "P", periodStart: "2026-01-01", periodEnd: "2026-01-31", amountMinor: 100, currency: "USD" });
    createInvoice({ companyId: "co_a", subscriptionId: "s", planLabel: "P", periodStart: "2026-02-01", periodEnd: "2026-02-28", amountMinor: 100, currency: "USD" });
    createInvoice({ companyId: "co_b", subscriptionId: "s", planLabel: "P", periodStart: "2026-03-01", periodEnd: "2026-03-31", amountMinor: 100, currency: "USD" });

    // Simulate cache loss while DB stays.
    const beforeIds = Array.from(_testInvoices.invoiceMap.keys()).sort();
    _testInvoices.invoiceMap.clear();
    _testInvoices.companyInvoices.clear();
    _testInvoices.yearCounters.clear();

    await hydrateInvoiceStore();

    const afterIds = Array.from(_testInvoices.invoiceMap.keys()).sort();
    expect(afterIds).toEqual(beforeIds);
    expect(listInvoicesForCompany("co_a").length).toBe(2);
    expect(listInvoicesForCompany("co_b").length).toBe(1);

    // Year counter restored
    const year = new Date().getFullYear();
    expect(_testInvoices.yearCounters.get(year)).toBe(3);

    // The NEXT createInvoice after hydrate should be 000004, proving the
    // counter was correctly rebuilt from MAX().
    const next = createInvoice({ companyId: "co_a", subscriptionId: "s", planLabel: "P", periodStart: "2026-04-01", periodEnd: "2026-04-30", amountMinor: 100, currency: "USD" });
    expect(next.invoiceNumber).toBe(`CAP-${year}-000004`);
  });

  it("getInvoice returns the cached invoice with all v12 fields after hydration", async () => {
    const inv = createInvoice({
      companyId: "co_a", subscriptionId: "sub_1",
      planLabel: "Pro",
      periodStart: "2026-01-01", periodEnd: "2026-01-31",
      amountMinor: 9900, currency: "USD",
      paymentEntryId: "pe_1", cardLast4: "4242",
    });

    _testInvoices.invoiceMap.clear();
    _testInvoices.companyInvoices.clear();
    await hydrateInvoiceStore();

    const reloaded = getInvoice(inv.id);
    expect(reloaded).toBeTruthy();
    if (reloaded) {
      expect(reloaded.invoiceNumber).toBe(inv.invoiceNumber);
      expect(reloaded.status).toBe("paid");
      expect(reloaded.cardLast4).toBe("4242");
      expect(reloaded.paymentEntryId).toBe("pe_1");
      expect(reloaded.lineItems.length).toBeGreaterThan(0);
      expect(reloaded.hash).toBe(inv.hash);
    }
  });
});

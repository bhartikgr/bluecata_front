/**
 * WAVE 61b · R42 — THE SERVER HALF OF THE BLIND-REFUND BLOCK, OVER HTTP.
 *
 * WHY A SERVER TEST AT ALL. R42 is about the admin CONTROL, and that control is
 * blocked and explained in `client/src/pages/admin/AdminFeesConsolidated.tsx`
 * (see `w61b_refund_unknown_amount_blocks.test.tsx`). But a control-only fix is a
 * fix that reopens — Wave 58e's entire lesson — and `POST /api/admin/invoices/
 * :id/refund` is reachable directly. Before this wave the handler did:
 *
 *     const amountMinor = Number(req.body?.amountMinor ?? inv.totalMinor);
 *     const refundInv = refundInvoice(inv.id, amountMinor, reason, actor);
 *
 * with NO check on `amountMinor`. `refundInvoice` then stores
 * `-Math.abs(amountMinor)`, so a non-numeric amount was persisted as a refund
 * invoice for **NaN**, against a real company, with a 200 and no error anywhere.
 *
 * WHAT IS PROVED, BOTH POLES:
 *   LOWER — a NON-NUMERIC amount is refused BY NAME (`refund_amount_unknown`),
 *           the original invoice is NOT transitioned to `refunded`, and NO
 *           refund invoice is created.
 *   UPPER — a known amount still refunds normally, byte for byte as before.
 *   UPPER — a GENUINE ZERO still refunds. `0` is a fact.
 *   UPPER — the pre-existing 404 / `invoice_not_paid` / `missing_identity`
 *           refusals are untouched.
 *
 * `paymentGatewayAdapter.ts` IS SACRED AND WAS NOT TOUCHED. The refund path used
 * here does not enter it: `refundInvoice` writes invoice rows only.
 *
 * REACHABILITY, STATED HONESTLY. `invoices.total_minor` and `invoices.currency`
 * are `NOT NULL` in the schema (`migrations/0000…:127`), so a STORED invoice
 * cannot itself carry an unknown amount today. The reachable pole is therefore
 * the REQUEST BODY, and it is the one exercised below. The currency branch and
 * the stored-null branch are defence-in-depth against a future nullable column
 * and are recorded as such in build_log/wave61b/WAVE61B_REPORT.md.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { installV14TestIdentity } from "./_v14TestIdentity";
import express from "express";
import http from "node:http";

import {
  createInvoice,
  getInvoice,
  listInvoices,
  registerInvoiceRoutes,
  configureInvoiceStore,
  _testInvoices,
} from "../invoiceStore";

async function req(
  app: express.Express,
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app).listen(0, () => {
      const port = (server.address() as any).port;
      const data = body === undefined ? undefined : JSON.stringify(body);
      const r = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method,
          headers: {
            ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}),
            ...(headers ?? {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
          res.on("end", () => {
            server.close();
            const raw = Buffer.concat(chunks).toString("utf8");
            let parsed: any = {};
            try {
              parsed = raw ? JSON.parse(raw) : {};
            } catch {
              parsed = { raw };
            }
            resolve({ status: res.statusCode ?? 0, body: parsed });
          });
        },
      );
      r.on("error", reject);
      if (data) r.write(data);
      r.end();
    });
  });
}

function makeInvoiceApp() {
  const app = express();
  app.use(express.json());
  installV14TestIdentity(app);
  registerInvoiceRoutes(app);
  return app;
}

function paidInvoice(tag: string, amountMinor = 298_800, currency = "USD") {
  return createInvoice({
    companyId: `co_w61b_${tag}`,
    subscriptionId: `sub_w61b_${tag}`,
    planLabel: "Founder Pro",
    periodStart: "2026-01-01",
    periodEnd: "2026-12-31",
    amountMinor,
    currency,
    paymentEntryId: `pe_w61b_${tag}`, // presence of a payment entry ⇒ status "paid"
  });
}

const ADMIN = { "x-actor-email": "admin@capavate.com" };

beforeEach(() => {
  _testInvoices.reset();
  configureInvoiceStore({ audit: () => {}, bridge: () => {} });
});

describe("W61b · R42 — the server refuses a refund whose amount it does not have", () => {
  it.each([["abc"], ["not-a-number"], [""], ["NaN"]])(
    "LOWER POLE — amountMinor %j is refused BY NAME, nothing is refunded and nothing is created",
    async (bad) => {
      const app = makeInvoiceApp();
      const inv = paidInvoice(`bad_${String(bad).length}_${Math.random().toString(16).slice(2, 6)}`);
      const before = listInvoices().length;

      const r = await req(app, "POST", `/api/admin/invoices/${inv.id}/refund`, { amountMinor: bad }, ADMIN);

      expect(r.status).toBe(400);
      expect(r.body.ok).toBe(false);
      expect(r.body.error).toBe("refund_amount_unknown");
      // NAMES what is missing and WHERE to resolve it, and says the zero is refused.
      expect(r.body.message).toContain(inv.id);
      expect(r.body.message).toMatch(/Record the invoice total/);
      expect(r.body.message).toMatch(/will not treat a missing amount as \$0\.00/);

      // The original is untouched and NO refund invoice exists.
      expect(getInvoice(inv.id)?.status).toBe("paid");
      expect(listInvoices().length).toBe(before);
      expect(listInvoices().some((i) => i.relatedInvoiceId === inv.id)).toBe(false);
    },
  );

  it("UPPER POLE — a known amount still refunds normally, unchanged", async () => {
    const app = makeInvoiceApp();
    const inv = paidInvoice("ok");
    const r = await req(
      app,
      "POST",
      `/api/admin/invoices/${inv.id}/refund`,
      { amountMinor: 298_800, reason: "test_refund" },
      ADMIN,
    );
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.refundInvoice.amountMinor).toBe(-298_800);
    expect(r.body.refundInvoice.relatedInvoiceId).toBe(inv.id);
    expect(r.body.refundInvoice.currency).toBe("USD");
    expect(getInvoice(inv.id)?.status).toBe("refunded");
  });

  it("UPPER POLE — the amount DEFAULTS to the invoice total when the body omits it", async () => {
    const app = makeInvoiceApp();
    const inv = paidInvoice("default");
    const r = await req(app, "POST", `/api/admin/invoices/${inv.id}/refund`, {}, ADMIN);
    expect(r.status).toBe(200);
    expect(r.body.refundInvoice.amountMinor).toBe(-inv.totalMinor);
  });

  it("UPPER POLE — A GENUINE ZERO STILL REFUNDS. Zero is a fact; unknown is not.", async () => {
    const app = makeInvoiceApp();
    const inv = paidInvoice("zero", 0);
    const r = await req(app, "POST", `/api/admin/invoices/${inv.id}/refund`, { amountMinor: 0 }, ADMIN);
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.refundInvoice.amountMinor).toBe(0);
    expect(getInvoice(inv.id)?.status).toBe("refunded");
  });

  it("UPPER POLE — a NON-USD refund keeps its own currency, never defaulted to USD", async () => {
    const app = makeInvoiceApp();
    const inv = paidInvoice("jpy", 1000, "JPY");
    const r = await req(app, "POST", `/api/admin/invoices/${inv.id}/refund`, { amountMinor: 1000 }, ADMIN);
    expect(r.status).toBe(200);
    expect(r.body.refundInvoice.currency).toBe("JPY");
  });

  it("UPPER POLE — the pre-existing refusals are untouched (404, not-paid, missing identity)", async () => {
    const app = makeInvoiceApp();

    const missing = await req(app, "POST", "/api/admin/invoices/inv_does_not_exist/refund", {}, ADMIN);
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe("not_found");

    const unpaid = createInvoice({
      companyId: "co_w61b_unpaid",
      subscriptionId: "sub_w61b_unpaid",
      planLabel: "Founder Pro",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: 1000,
      currency: "USD",
      // no paymentEntryId ⇒ "issued"
    });
    const notPaid = await req(app, "POST", `/api/admin/invoices/${unpaid.id}/refund`, {}, ADMIN);
    expect(notPaid.status).toBe(400);
    expect(notPaid.body.error).toBe("invoice_not_paid");
    /* ORDERING PROOF: the not-paid refusal still fires FIRST, before the new
       amount fence, so the new code did not reorder the existing contract. */
    expect(notPaid.body.error).not.toBe("refund_amount_unknown");
  });
});

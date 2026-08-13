/**
 * WAVE 34 — the INVOICING money-exponent sinks, EXECUTED.
 *
 * WHY THIS FILE EXISTS. Wave 33C's re-sweep came back NON-EMPTY and named
 * three server sites that convert integer minor units to a display amount with
 * a hardcoded `/ 100`, i.e. an assumed ISO 4217 exponent of 2:
 *
 *   1. server/invoiceStore.ts:620  formatMoney → Intl .format(amountMinor / 100)
 *   2. server/invoiceStore.ts:622  formatMoney → the Intl-throws fallback path
 *   3. server/invoiceStore.ts:787  the invoice EMAIL's local fmtMoney
 *
 * All three take the invoice's own `currency` and hand it to `Intl` as the
 * currency CODE while ignoring its EXPONENT. For JPY (exponent 0) the invoice
 * PDF and the invoice email therefore under-report the amount by a factor of
 * 100: a ¥1,000,000 invoice prints ¥10,000. This is money rendered directly to
 * a paying customer.
 *
 * Every case carries a JPY (exponent 0) fixture AND its USD (exponent 2) twin
 * for the SAME minor amount, and asserts BOTH POLES:
 *   · the JPY pole pins the fixed rendering (1,000,000 minor → ¥1,000,000), and
 *   · the USD pole pins that a division still happens at all
 *     (1,000,000 minor → $10,000.00).
 * A mutant that restores `/ 100` fails the JPY pole; a mutant that removes the
 * conversion entirely fails the USD pole. Neither pole alone is sufficient —
 * a USD-only fixture passes against the defect AND against the fix, which is
 * exactly why this class survived seven previous discoveries.
 *
 * Assertions are on what each sink EMITS (the PDF byte stream, the argument
 * actually handed to the mail transport), never on what it consults.
 *
 * This file establishes all of its own preconditions, never reads
 * `process.env`, and uses static imports only.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import fs from "node:fs";

/* The founder invoice routes sit behind the real auth middleware. It is
 * replaced with a pass-through carrying an EXPLICIT, TEST-OWNED identity.
 * Group (G) separately asserts that the SHIPPED route registrations still name
 * the real middleware, so this stub cannot hide an unauthenticated endpoint. */
const TEST_ACTOR = "u_w34_founder";

vi.mock("../lib/authMiddleware", () => ({
  requireAuth: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
  requireAuthenticated: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

/* The mail transport is captured, not stubbed away: the assertions below read
 * the ARGUMENT the route actually handed it. A stub that returned success
 * without recording the argument would let the email sink pass untested. */
type CapturedMail = { to: string; subject: string; html: string; text?: string };
const { sentMail } = vi.hoisted(() => ({ sentMail: [] as CapturedMail[] }));
vi.mock("../emailTransport", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    sendMail: async (args: CapturedMail) => {
      sentMail.push(args);
      return { ok: true, messageId: "w34-captured" };
    },
  };
});

import {
  createInvoice,
  generateInvoicePdf,
  registerInvoiceRoutes,
  type Invoice,
} from "../invoiceStore";
import { currencyExponent, formatMinor } from "../lib/currency";

const CO_JPY = "co_w34_jpy";
const CO_USD = "co_w34_usd";

/** The SAME integer minor amount in both currencies. At exponent 0 it renders
 * as ¥1,000,000; at exponent 2 as $10,000.00. The defect renders the JPY pole
 * as ¥10,000 — the two answers differ by exactly the defect's factor of 100. */
const MINOR = 1_000_000;
const TAX_MINOR = 50_000;

let app: Express;
let invJpy: Invoice;
let invUsd: Invoice;

beforeAll(() => {
  const mk = (companyId: string, currency: string): Invoice =>
    createInvoice({
      companyId,
      subscriptionId: `sub_w34_${currency.toLowerCase()}`,
      planLabel: `W34 ${currency} Plan`,
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: MINOR,
      currency,
      taxMinor: TAX_MINOR,
      actor: TEST_ACTOR,
    });

  invJpy = mk(CO_JPY, "JPY");
  invUsd = mk(CO_USD, "USD");

  app = express();
  app.use(express.json());
  registerInvoiceRoutes(app);
});

beforeEach(() => {
  sentMail.length = 0;
});

/** Extract the human-readable text the PDF actually paints. `generateInvoicePdf`
 * writes each line as a `(…) Tj` content-stream operator, so this reads what a
 * reader would SEE, not an internal figure. */
function pdfText(inv: Invoice): string {
  const buf = generateInvoicePdf(inv);
  return buf.toString("utf8");
}

/* ── (F) THE FIXTURES THEMSELVES ─────────────────────────────────────────── */

describe("F — preconditions", () => {
  it("F1 JPY is exponent 0 and USD is exponent 2 in the shared table", () => {
    expect(currencyExponent("JPY")).toBe(0);
    expect(currencyExponent("USD")).toBe(2);
  });

  it("F2 both fixtures exist, carry the SAME minor amounts, and differ only in currency", () => {
    expect(invJpy.currency).toBe("JPY");
    expect(invUsd.currency).toBe("USD");
    expect(invJpy.amountMinor).toBe(MINOR);
    expect(invUsd.amountMinor).toBe(MINOR);
    expect(invJpy.totalMinor).toBe(MINOR + TAX_MINOR);
    expect(invUsd.totalMinor).toBe(MINOR + TAX_MINOR);
    // Non-empty line items: an empty list would make the PDF assertions vacuous.
    expect(invJpy.lineItems.length).toBeGreaterThan(0);
    expect(invUsd.lineItems.length).toBeGreaterThan(0);
  });

  it("F3 the shared helper is the reference answer at both poles", () => {
    expect(formatMinor(MINOR, "JPY", { locale: "en-US" })).toBe("¥1,000,000");
    expect(formatMinor(MINOR, "USD", { locale: "en-US" })).toBe("$10,000.00");
  });
});

/* ── (P) SINKS 1 + 2 — the invoice PDF ───────────────────────────────────── */

describe("P — server/invoiceStore.ts formatMoney: the invoice PDF", () => {
  it("P1 JPY: 1,000,000 minor units are PAINTED as ¥1,000,000, not ¥10,000", () => {
    const text = pdfText(invJpy);
    expect(text).toContain("¥1,000,000");
    // The defect's answer must be absent, not merely un-asserted.
    expect(text).not.toContain("¥10,000.00");
    expect(text).not.toMatch(/Subtotal: ¥10,000(?!,)/);
  });

  it("P2 USD: the SAME 1,000,000 minor units are PAINTED as $10,000.00", () => {
    const text = pdfText(invUsd);
    expect(text).toContain("$10,000.00");
    // A mutant that deletes the conversion entirely would print $1,000,000.00.
    expect(text).not.toContain("$1,000,000.00");
  });

  it("P3 the two currencies do NOT render the same figure for the same minor amount", () => {
    const jpy = pdfText(invJpy);
    const usd = pdfText(invUsd);
    const jpyTotal = /TOTAL: ([^\n)]+)/.exec(jpy)?.[1];
    const usdTotal = /TOTAL: ([^\n)]+)/.exec(usd)?.[1];
    expect(jpyTotal).toBeTruthy();
    expect(usdTotal).toBeTruthy();
    expect(jpyTotal).not.toBe(usdTotal);
    expect(jpyTotal).toBe("¥1,050,000");
    expect(usdTotal).toBe("$10,500.00");
  });

  it("P4 every money line of the JPY PDF — line items, subtotal, tax, total — is at exponent 0", () => {
    const text = pdfText(invJpy);
    expect(text).toContain("W34 JPY Plan: ¥1,000,000");
    expect(text).toContain("Subtotal: ¥1,000,000");
    expect(text).toContain("Tax: ¥50,000");
    expect(text).toContain("TOTAL: ¥1,050,000");
    // No JPY figure may carry a fraction separator — exponent 0 has none.
    const jpyFigures = text.match(/¥[\d,]+(\.\d+)?/g) ?? [];
    expect(jpyFigures.length).toBeGreaterThan(0);
    for (const f of jpyFigures) expect(f).not.toMatch(/\./);
  });

  it("P5 the same JPY PDF is served byte-for-byte over the shipped route", async () => {
    const res = await request(app)
      .get(`/api/founder/invoices/${invJpy.id}/pdf`)
      .query({ companyId: CO_JPY });
    expect(res.status).toBe(200);
    const body = Buffer.isBuffer(res.body) ? res.body.toString("utf8") : String(res.text);
    expect(body).toContain("¥1,050,000");
    expect(body).not.toContain("¥10,500");
  });

  it("P6 KRW proves the exponent is table-driven, not a JPY special case", () => {
    const krw = createInvoice({
      companyId: "co_w34_krw",
      subscriptionId: "sub_w34_krw",
      planLabel: "W34 KRW Plan",
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      amountMinor: MINOR,
      currency: "KRW",
      taxMinor: 0,
      actor: TEST_ACTOR,
    });
    expect(currencyExponent("KRW")).toBe(0);
    expect(pdfText(krw)).toContain("₩1,000,000");
  });
});

/* ── (E) SINK 3 — the invoice EMAIL ──────────────────────────────────────── */

describe("E — server/invoiceStore.ts fmtMoney: the invoice email", () => {
  async function emailInvoice(inv: Invoice, companyId: string) {
    const res = await request(app)
      .post(`/api/founder/invoices/${inv.id}/email`)
      .send({ companyId, email: "founder@example.test" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    // The transport must actually have been called — a route that silently
    // skipped sending would satisfy any assertion about "no wrong figure".
    expect(sentMail.length).toBe(1);
    return sentMail[0];
  }

  it("E1 JPY: the emitted email body renders ¥1,050,000, not ¥10,500", async () => {
    const mail = await emailInvoice(invJpy, CO_JPY);
    expect(mail.html).toContain("¥1,000,000");
    expect(mail.html).toContain("¥1,050,000");
    expect(mail.html).not.toContain("¥10,500");
    expect(mail.text).toContain("Total: ¥1,050,000");
  });

  it("E2 USD: the SAME minor amounts render $10,000.00 / $10,500.00", async () => {
    const mail = await emailInvoice(invUsd, CO_USD);
    expect(mail.html).toContain("$10,000.00");
    expect(mail.html).toContain("$10,500.00");
    // A deleted conversion would print $1,050,000.00.
    expect(mail.html).not.toContain("$1,050,000.00");
    expect(mail.text).toContain("Total: $10,500.00");
  });

  it("E3 the two currencies do NOT produce the same email figure", async () => {
    const jpy = await emailInvoice(invJpy, CO_JPY);
    sentMail.length = 0;
    const usd = await emailInvoice(invUsd, CO_USD);
    const pick = (t?: string) => /Total: ([^\n]+)/.exec(t ?? "")?.[1];
    expect(pick(jpy.text)).toBe("¥1,050,000");
    expect(pick(usd.text)).toBe("$10,500.00");
    expect(pick(jpy.text)).not.toBe(pick(usd.text));
  });
});

/* ── (S) THE SOURCE NO LONGER HOLDS A HARDCODED EXPONENT ─────────────────── */

describe("S — the three sites are gone from the source", () => {
  const strip = (src: string) =>
    src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("S0 the comment stripper actually strips, and still sees code", () => {
    expect(strip("/* minor / 100 */\nconst a = 1;")).not.toMatch(/minor \/ 100/);
    expect(strip("// minor / 100\nconst a = 1;")).not.toMatch(/minor \/ 100/);
    expect(strip("/* c */ const a = minor / 100;")).toMatch(/minor \/ 100/);
  });

  it("S1 invoiceStore performs no hardcoded /100 anywhere in live code", () => {
    const src = strip(fs.readFileSync("server/invoiceStore.ts", "utf8"));
    expect(src).not.toMatch(/amountMinor \/ 100/);
    expect(src).not.toMatch(/minor \/ 100/);
    expect(src).not.toMatch(/\/ 100\b/);
  });

  it("S2 invoiceStore delegates both formatters to the shared exponent helper", () => {
    const src = strip(fs.readFileSync("server/invoiceStore.ts", "utf8"));
    expect(src).toMatch(/import \{[^}]*formatMinor[^}]*\} from "\.\/lib\/currency"/);
    expect(src).toMatch(/return formatMinor\(amountMinor, currency, \{ locale: "en-US" \}\)/);
    expect(src).toMatch(/formatMinor\(minor, currency, \{ locale: "en-US" \}\)/);
  });
});

/* ── (G) THE STUB CANNOT HIDE AN UNAUTHENTICATED ENDPOINT ────────────────── */

describe("G — the SHIPPED routes are wired to the real middleware", () => {
  it("G1 the founder invoice list is registered behind requireAuth in the shipped source", () => {
    const src = fs.readFileSync("server/invoiceStore.ts", "utf8");
    expect(src).toMatch(/app\.get\("\/api\/founder\/invoices", requireAuth,/);
    expect(src).toMatch(/import \{ requireAuth \} from "\.\/lib\/authMiddleware"/);
  });

  it("G2 the per-invoice PDF and email routes still enforce company ownership", () => {
    const src = fs.readFileSync("server/invoiceStore.ts", "utf8");
    const guards = src.match(/if \(inv\.companyId !== companyId\)/g) ?? [];
    expect(guards.length).toBeGreaterThanOrEqual(3);
  });

  it("G3 a cross-company request for the JPY invoice is refused, so P5 proved ownership too", async () => {
    const res = await request(app)
      .get(`/api/founder/invoices/${invJpy.id}/pdf`)
      .query({ companyId: CO_USD });
    expect(res.status).toBe(403);
  });
});

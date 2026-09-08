import { describe, it, expect } from "vitest";
import { generateInvoicePdf } from "../invoiceStore";

/* ═══════════════════════════════════════════════════════════════════════════════
   ITEM 4 — THE INVALID `/Length`.
   ═══════════════════════════════════════════════════════════════════════════════
   THE BRIEFED COORDINATE DID NOT HOLD. The brief described "a PDF with an
   invalid /Length — declared 101, actual 90 bytes". No such file exists: 609
   PDFs in the tree were parsed and none declares /Length 101, and the producer
   named in the older note (server/dataroomStore.ts) had already been corrected.

   THE DEFECT IS REAL, at a DIFFERENT producer: server/invoiceStore.ts wrote
   `/Length ${stream.length}` — UTF-16 code units — into a file serialised as
   UTF-8. These tests MEASURE the emitted bytes rather than trusting either
   number, and they are written so they would have FAILED before the fix. */

function parse(buf: Buffer) {
  const s = buf.toString("latin1");
  const m = /\/Length (\d+) >>\nstream\n/.exec(s);
  if (!m) return null;
  const start = (m.index ?? 0) + m[0].length;
  const end = s.indexOf("\nendstream", start);
  if (end < 0) return null;
  return { declared: Number(m[1]), actual: Buffer.byteLength(s.slice(start, end), "latin1") };
}

function invoice(over: Record<string, unknown> = {}) {
  return {
    id: "inv_1", invoiceNumber: "INV-0001", companyId: "co_1", planLabel: "Growth",
    periodStart: "2026-01-01", periodEnd: "2026-01-31",
    lineItems: [{ label: "Subscription", amountMinor: 100000 }],
    amountMinor: 100000, taxMinor: 0, totalMinor: 100000,
    currency: "USD", status: "paid", issuedAt: "2026-02-01",
    paidAt: "2026-02-01", cardLast4: "4242", hash: "abc123",
    ...over,
  } as unknown as Parameters<typeof generateInvoicePdf>[0];
}

describe("Item 4 · the invoice PDF declares its stream length in BYTES", () => {
  it("CONTROL — the parser really finds a stream, so the checks below are not vacuous", () => {
    const p = parse(generateInvoicePdf(invoice()));
    expect(p, "no /Length … stream block was found; the assertions would be vacuous").not.toBeNull();
    expect(p!.actual).toBeGreaterThan(0);
  });

  it("a card-paid invoice — the `••••` bullets are 3 bytes each and used to be counted as 1", () => {
    /* THIS IS THE CASE THAT WAS ALREADY BROKEN IN PRODUCTION. */
    const buf = generateInvoicePdf(invoice({ cardLast4: "4242" }));
    expect(buf.toString("utf8"), "the fixture must actually contain the bullets").toContain("••••");
    const p = parse(buf)!;
    expect(p.declared, `declared ${p.declared} but wrote ${p.actual} bytes`).toBe(p.actual);
  });

  it.each([["GBP", "£"], ["EUR", "€"], ["JPY", "¥"]])(
    "a %s invoice — the currency symbol is multi-byte and is counted correctly",
    (currency) => {
      const p = parse(generateInvoicePdf(invoice({ currency, cardLast4: null, paidAt: null })))!;
      expect(p.declared, `declared ${p.declared} but wrote ${p.actual} bytes`).toBe(p.actual);
    },
  );

  it("a purely ASCII invoice still agrees — the fix changed nothing for the simple case", () => {
    const p = parse(generateInvoicePdf(invoice({ currency: "USD", cardLast4: null, paidAt: null })))!;
    expect(p.declared).toBe(p.actual);
  });

  it("NEGATIVE CONTROL — the parser catches a deliberately wrong declaration", () => {
    const rigged = Buffer.from("5 0 obj\n<< /Length 999 >>\nstream\nAB\nendstream", "latin1");
    const p = parse(rigged)!;
    expect(p.declared).toBe(999);
    expect(p.actual).toBe(2);
    expect(p.declared).not.toBe(p.actual);
  });
});

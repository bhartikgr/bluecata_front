/**
 * WAVE 73 · ITEM 9 — THE DOWNLOADED CAP-TABLE PDF STOPS PRINTING A FABRICATED
 * `0.000%` OWNERSHIP.
 * ═══════════════════════════════════════════════════════════════════════════
 * THE DEFECT, quoted from the tree as it was (`server/routes.ts:5221`):
 *
 *     const pct = totalSharesNum > 0 ? (v.shares / totalSharesNum) * 100 : 0;
 *
 * On a cap table whose total share count is zero, every holder was written into
 * the PDF at `0.000%`. 0 ÷ 0 is UNDEFINED, not zero — and the cap-table engine
 * already answers `null` for exactly this case (ruling D18,
 * `packages/cap-table-engine/src/captable/views.ts:105`), so the PDF was
 * contradicting the engine. It is S2 rather than S1 because the total is derived
 * rather than asserted and a reconciliation note is printed — but a PDF is the
 * artifact an investor keeps on disk.
 *
 * HOW THE STRING IS PROVED TO REACH THE ARTIFACT. There is no DOM here, so the
 * equivalent is asserted directly: `pdfkit` is replaced with a recorder that
 * captures every `doc.text(...)` call, and the assertions read that transcript.
 * That is the PDF's own output, not a claim about a handler having run.
 *
 * BOTH POLES:
 *   HONEST pole      — a zero-share table: every ownership cell is an em-dash, the
 *                      total is an em-dash, `0.000%` appears NOWHERE, and the note
 *                      says the ratio is undefined and NOT zero. Share counts and
 *                      invested amounts are still printed.
 *   LEGITIMATE pole  — a populated table: the percentages and the 100.000% total
 *                      print exactly as before, and the undefined-note is absent.
 *
 * MUTATION TRANSCRIPT: build_log/wave73/W73_TESTS.md.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

/** Every string handed to `doc.text(...)`, in order. */
let written: string[] = [];

vi.mock("pdfkit", () => {
  class FakeDoc {
    public y = 100;
    private handlers: Record<string, Array<(...a: unknown[]) => void>> = {};
    pipe() { return this; }
    on(evt: string, cb: (...a: unknown[]) => void) { (this.handlers[evt] ??= []).push(cb); return this; }
    font() { return this; }
    fontSize() { return this; }
    fillColor() { return this; }
    moveDown() { return this; }
    addPage() { return this; }
    image() { return this; }
    rect() { return this; }
    fill() { return this; }
    stroke() { return this; }
    moveTo() { return this; }
    lineTo() { return this; }
    text(t?: unknown) { if (t !== undefined) written.push(String(t)); return this; }
    end() { for (const cb of this.handlers["end"] ?? []) cb(); return this; }
  }
  return { default: FakeDoc };
});

import { streamCapTablePdf, type CapTableEntry } from "../lib/pdfGenerators";

/** A minimal `res` that swallows the stream. */
function fakeRes() {
  return {
    setHeader: () => undefined,
    writeHead: () => undefined,
    write: () => true,
    end: () => undefined,
    on: () => undefined,
    once: () => undefined,
    emit: () => undefined,
    headersSent: false,
  } as never;
}

function run(entries: CapTableEntry[], totalShares: number) {
  written = [];
  streamCapTablePdf(fakeRes(), {
    companyId: "co_w73",
    companyName: "W73 Holdings",
    asOf: "2026-08-18",
    entries,
    totals: { totalShares, totalInvested: 0, holderCount: entries.length },
    generatedAt: "2026-08-18T00:00:00Z",
  });
  return written.join("\n");
}

beforeEach(() => { written = []; });

describe("WAVE 73 · ITEM 9 — a zero-share cap-table PDF refuses instead of printing 0.000%", () => {
  it("HONEST POLE — undefined ownership prints an em-dash, no total, and says it is NOT zero", () => {
    const out = run(
      [
        { shareholder: "Ada Founder", securityKind: "commit", shares: 0, pctOwnership: null, invested: null, currency: "USD" },
        { shareholder: "Bo Investor", securityKind: "commit", shares: 0, pctOwnership: null, invested: 25_000, currency: "USD" },
      ],
      0,
    );

    /* THE STRING THAT MUST NOT BE IN THE ARTIFACT. */
    expect(out).not.toContain("0.000%");
    /* THE HONEST OUTPUT, in the cells and in the total. */
    expect(written.filter((t) => t === "—").length).toBeGreaterThanOrEqual(3); /* 2 cells + total */
    expect(out).toContain("is undefined — it is NOT zero");
    expect(out).toContain("total share count is zero");
    /* The old reconciliation note must NOT also fire — it would report a
       discrepancy against 100% that is really an absent denominator. */
    expect(out).not.toContain("This is a reconciliation discrepancy");

    /* NO SILENT DROP — the rest of the row is still on the page. */
    expect(out).toContain("Ada Founder");
    expect(out).toContain("Bo Investor");
    expect(out).toContain("W73 Holdings");
  });

  it("LEGITIMATE POLE — a populated table prints its percentages and its 100.000% total unchanged", () => {
    const out = run(
      [
        { shareholder: "Ada Founder", securityKind: "commit", shares: 750_000, pctOwnership: 75, invested: null, currency: "USD" },
        { shareholder: "Bo Investor", securityKind: "commit", shares: 250_000, pctOwnership: 25, invested: 250_000, currency: "USD" },
      ],
      1_000_000,
    );
    expect(out).toContain("75.000%");
    expect(out).toContain("25.000%");
    expect(out).toContain("100.000%");
    /* The undefined-note must be absent on a real table. */
    expect(out).not.toContain("is undefined — it is NOT zero");
    expect(out).not.toContain("This is a reconciliation discrepancy");
  });

  it("SOURCE — the producer no longer coalesces to 0", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const routes = fs
      .readFileSync(path.resolve(__dirname, "..", "routes.ts"), "utf8")
      /* Comments stripped: the fix quotes the expression it removed. */
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(routes).not.toContain("totalSharesNum > 0 ? (v.shares / totalSharesNum) * 100 : 0");
    expect(routes).toContain("totalSharesNum > 0 ? (v.shares / totalSharesNum) * 100 : null");
  });
});
